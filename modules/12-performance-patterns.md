---
titre: Performance patterns — mesurer d'abord, optimiser ensuite
cours: 01-js-runtime
notions: [profiling avant optimisation, benchmark correct (warm-up JIT, dead-code elimination, performance.now), Map vs objet, Set, typed arrays, éviter les allocations en hot path, churn GC, packed vs holey arrays, string building, megamorphic sites]
outcomes: [profiler un programme Node avant d'optimiser, écrire un micro-benchmark fiable, choisir la structure de données adaptée à un hot path, supprimer les allocations qui pressurisent le GC]
prerequis: [11-hidden-classes-inline-caching]
next: 13-scheduling-concurrence
libs: []
tribuzen: "profilage d'un endpoint chaud de l'API TribuZen — hot path, typed array et Map pour supprimer le churn GC"
last-reviewed: 2026-07
---

# Performance patterns — mesurer d'abord, optimiser ensuite

> **Outcomes — tu sauras FAIRE :** profiler un programme Node avant de toucher au code, écrire un micro-benchmark qui ne ment pas (warm-up JIT, anti dead-code elimination), choisir la structure de données adaptée à un hot path, et supprimer les allocations qui pressurisent le GC.
> **Difficulté :** :star::star::star:

## 1. Cas concret d'abord

L'endpoint `GET /families/:id/stats` de l'API TribuZen agrège les scores de bien-être de tous les membres d'une famille. En prod il tient 120 ms p95, et le dashboard des familles nombreuses rame. Un collègue a « optimisé au feeling » en remplaçant un `.map()` par une boucle `for`. Aucun gain. Voici le handler :

```ts
// families.service.ts — AVANT
function computeFamilyStats(readings: Reading[]): FamilyStats {
  let csv = '';
  const summary: Record<string, { sum: number; count: number }> = {};

  for (const r of readings) {
    // 1 objet éphémère par lecture — 10 000 lectures = 10 000 objets
    const point = {
      memberId: r.memberId,
      normalized: r.value / r.max,
      label: `member-${r.memberId}-${r.ts}`,
    };
    csv += point.label + '\n';                 // concat en boucle
    const key = point.label.split('-')[1];     // re-parse ce qu'on vient de construire
    (summary[key] ??= { sum: 0, count: 0 });
    summary[key].sum += point.normalized;
    summary[key].count++;
  }

  return Object.keys(summary).map((k) => ({
    memberId: k,
    avg: summary[k].sum / summary[k].count,
  }));
}
```

**Trois questions avant de toucher quoi que ce soit :**
1. Où passe réellement le temps ? Le GC ? La construction des chaînes ? Le `split` ? On ne sait pas — personne n'a profilé.
2. Le collègue a changé la boucle sans mesurer : il a optimisé un truc qui ne coûtait rien.
3. Combien d'objets et de chaînes éphémères cette boucle alloue-t-elle par requête ? (Réponse : ~30 000, à 60 req/s ça fait 1,8 M d'allocations/s.)

Ce module te donne la méthode : **profiler → trouver le hot path → corriger la vraie cause → re-mesurer**. Jamais l'inverse.

---

## 2. Théorie complète, concise

### 2.1 La règle unique : mesurer avant d'optimiser

Le cerveau humain est un mauvais profileur. On croit toujours savoir où est le goulot ; on se trompe presque toujours. Le workflow non négociable :

```
1. Reproduire le scénario lent (charge réaliste)
2. MESURER avec un profiler (--prof, --cpu-prof, DevTools)
3. Identifier le hot path (la fonction qui mange ≥ 80 % du temps self)
4. Comprendre POURQUOI (allocation ? megamorphic ? algo ?)
5. Appliquer UNE correction ciblée
6. RE-MESURER — gain réel ? sinon revenir à l'étape 3
```

**Loi d'Amdahl.** Optimiser une fonction qui pèse 5 % du temps, même de 10×, ne rend l'ensemble que ~4,7 % plus rapide. On ne touche qu'au hot path prouvé. Optimiser à l'aveugle, c'est ajouter de la complexité (code plus dur à lire) sans contrepartie mesurable.

### 2.2 Profiler un programme Node

Deux outils suffisent au quotidien.

```bash
# 1. Tick sampling — vue "quelle fonction mange le CPU"
node --prof app.js
node --prof-process isolate-*.log > profile.txt
# Lire la section [Summary] : part JS / C++ / GC.
# GC élevé (>10 %) => trop d'allocations éphémères.

# 2. CPU profile chargeable dans Chrome DevTools
node --cpu-prof app.js
# Ouvrir le .cpuprofile dans DevTools > Performance.
```

Dans Chrome DevTools (onglet Performance), trois vues complémentaires :
- **Flame chart** : la pile d'appels dans le temps ; barre large = temps CPU élevé.
- **Bottom-Up** : trié par temps *self* (hors enfants) — c'est là qu'on lit le hot path.
- **Call Tree** : la hiérarchie depuis la racine — pour comprendre *comment* on y arrive.

Flags de diagnostic ciblés : `--trace-gc` (fréquence/durée des pauses GC), `--trace-ic` (états d'inline cache, rappel module 11), `--trace-deopt` (déoptimisations).

### 2.3 Écrire un micro-benchmark qui ne ment pas

Un micro-benchmark naïf donne des chiffres faux. Quatre pièges à neutraliser :

**a) Warm-up JIT.** Les premières exécutions tournent en interprété (Ignition), puis baseline (Sparkplug), puis optimisé (TurboFan). Si tu mesures les 100 premières itérations, tu mesures le compilateur, pas le code. Il faut *chauffer* la fonction avant de chronométrer.

**b) Dead-code elimination.** Si le résultat n'est pas utilisé, TurboFan peut supprimer tout le calcul. Ton benchmark mesure alors zéro. Il faut *consommer* le résultat (l'accumuler, le logger).

**c) `performance.now()` et pas `Date.now()`.** `performance.now()` est monotone et sub-milliseconde ; `Date.now()` a une résolution ms et peut reculer (NTP).

**d) Constantes repliées.** `bench(() => 2 + 2)` mesure une constante calculée à la compilation. Passer des entrées variables (issues d'un tableau) pour empêcher le constant folding.

```ts
import { performance } from 'node:perf_hooks';

function bench(label: string, fn: () => number, iters = 1_000_000): void {
  // (a) warm-up : laisser TurboFan optimiser
  for (let i = 0; i < 10_000; i++) fn();

  let sink = 0;                        // (b) accumulateur anti dead-code
  const t0 = performance.now();        // (c) horloge monotone
  for (let i = 0; i < iters; i++) sink += fn();
  const dt = performance.now() - t0;

  if (sink === Number.MAX_VALUE) console.log('never');  // force l'usage de sink
  console.log(`${label}: ${dt.toFixed(2)} ms`);
}
```

> Un micro-benchmark reste local. Il te dit qu'une opération isolée est plus rapide, pas que ton appli l'est. La vérité finale, c'est le profil de bout en bout sous charge réaliste.

### 2.4 Choisir la structure de données

| Besoin | Bon choix | Pourquoi |
|---|---|---|
| Clés dynamiques / arbitraires | `Map` | Pas de hidden-class thrashing, pas de collision avec le prototype, `.size` O(1) |
| Forme fixe et connue | objet / classe | Hidden class stable, accès par offset (module 11) |
| Test d'appartenance | `Set` | `.has()` O(1), dé-duplication gratuite |
| Nombres homogènes en masse | typed array (`Float64Array`…) | Mémoire contiguë, pas de boxing, cache-friendly |

Le piège classique : utiliser un objet `{}` comme dictionnaire à clés dynamiques (`obj[userInput] = …`). Chaque nouvelle clé fait muter la hidden class ; les sites d'accès deviennent megamorphic. `Map` est fait exactement pour ça.

```ts
// ❌ objet comme dictionnaire dynamique — hidden class instable + risque __proto__
const counts: Record<string, number> = {};
for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;

// ✅ Map — conçu pour des clés dynamiques
const counts = new Map<string, number>();
for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
```

### 2.5 Typed arrays pour le numérique

Un `Array` classique de nombres stocke des valeurs *tagged* (chaque élément peut être n'importe quel type JS). Un `Float64Array` stocke des doubles bruts, contigus, sans header par élément.

```ts
// Layout SoA : [x0,y0,z0, x1,y1,z1, ...] — mémoire contiguë
const positions = new Float64Array(3 * n);
const velocities = new Float64Array(3 * n);

for (let i = 0; i < n; i++) {
  const b = i * 3;
  positions[b]     += velocities[b]     * dt;
  positions[b + 1] += velocities[b + 1] * dt;
  positions[b + 2] += velocities[b + 2] * dt;
}
// TurboFan génère un accès par offset fixe, sans type-check par élément.
```

Bonus : un typed array est alloué une fois. Zéro pression GC pendant la boucle, contrairement à un `Array<{x,y,z}>` qui alloue N objets.

### 2.6 Éviter les allocations en hot path (churn GC)

Chaque objet/chaîne/tableau créé dans une boucle chaude finit dans la *young generation*. Trop d'éphémères ⇒ Scavenges fréquents ⇒ micro-pauses. C'est le **churn GC** : le coût n'est pas l'allocation, c'est la collecte.

```ts
// ❌ 1 objet par itération — 1 M pixels = 1 M objets éphémères
for (let i = 0; i < pixels.length; i++) {
  const color = { r: pixels[i] & 0xff, g: (pixels[i] >> 8) & 0xff, b: (pixels[i] >> 16) & 0xff };
  applyFilter(color);
}

// ✅ 1 objet réutilisé — 0 allocation dans la boucle
const color = { r: 0, g: 0, b: 0 };
for (let i = 0; i < pixels.length; i++) {
  color.r = pixels[i] & 0xff;
  color.g = (pixels[i] >> 8) & 0xff;
  color.b = (pixels[i] >> 16) & 0xff;
  applyFilter(color);
}
```

Corollaire : éviter `JSON.parse(JSON.stringify(x))` pour cloner en boucle (deux parcours + une chaîne intermédiaire). Préférer un spread `{ ...x }` (shallow) ou `structuredClone(x)` (deep natif) selon le besoin.

### 2.7 Packed vs holey arrays (V8)

V8 classe les tableaux par *elements kind*. Un tableau **PACKED** (dense, sans trou) a un chemin d'accès rapide ; un tableau **HOLEY** (avec des trous) force un check de trou + une remontée du prototype à chaque accès indexé. La transition PACKED → HOLEY est irréversible.

```ts
// ❌ HOLEY dès la création — new Array(n) crée n trous
const out = new Array(1_000_000);
for (let i = 0; i < out.length; i++) out[i] = compute(i);

// ✅ PACKED — rempli d'entrée, aucun trou
const out = Array.from({ length: 1_000_000 }, (_, i) => compute(i));

// Ce qui rend un tableau HOLEY : new Array(n), arr[1000]=x sur un petit tableau,
// [1, , 3] (trou littéral), delete arr[i].
```

### 2.8 String building

Concaténer avec `+=` en boucle crée des *ConsStrings* (arbres de chaînes paresseux). Tant qu'on n'y touche pas c'est bon marché, mais tout `indexOf`, `str[i]` ou envoi réseau force un *flattening* O(n) de l'arbre. Sur des dizaines de milliers de concaténations, c'est prohibitif.

```ts
// ❌ concat en boucle — flattening répété
let csv = '';
for (const row of rows) csv += row.join(',') + '\n';

// ✅ collecter puis join une seule fois
const lines = new Array(rows.length);
for (let i = 0; i < rows.length; i++) lines[i] = rows[i].join(',');
const csv = lines.join('\n');
```

### 2.9 Éviter les sites megamorphic (rappel module 11)

Un site d'accès `obj.x` qui voit ≥ 5 hidden classes différentes passe **megamorphic** : V8 abandonne l'inline cache et fait un lookup générique (~5-10× plus lent). En hot path, garde des formes d'objets uniformes : même constructeur, mêmes propriétés, même ordre, pas de `delete`, pas de changement de type. C'est le lien direct avec le module 11 — la performance d'accès aux propriétés dépend de la stabilité des Maps.

---

## 3. Worked examples

### Exemple 1 — Profiler puis corriger l'endpoint stats (TribuZen)

Reprise du cas concret, **méthode complète**.

**Étape 1-2 : mesurer.** On lance le handler sous charge et on profile.

```bash
node --cpu-prof --trace-gc bench-stats.mjs
# --trace-gc montre des Scavenges toutes les ~4 Mo, en rafale.
# Le .cpuprofile (Bottom-Up dans DevTools) révèle le temps self :
#   Runtime_StringAdd      31 %   <- la concat csv += ...
#   String.split           18 %   <- le re-parse du label
#   (GC)                    14 %   <- les 30 000 éphémères / requête
#   computeFamilyStats      12 %
```

**Étape 3-4 : le hot path est le triptyque allocation + concat + split**, pas la boucle. Le collègue avait tort de toucher au `for`.

**Étape 5 : corriger la vraie cause.**

```ts
// families.service.ts — APRÈS
function computeFamilyStats(readings: Reading[]): FamilyStats {
  // Map réutilisable : clés dynamiques (memberId) sans hidden-class thrashing
  const summary = new Map<string, { sum: number; count: number }>();

  // Une seule passe. Aucun objet "point", aucune chaîne, aucun split.
  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    const normalized = r.value / r.max;
    let entry = summary.get(r.memberId);          // accès direct à l'id
    if (entry === undefined) {
      entry = { sum: 0, count: 0 };
      summary.set(r.memberId, entry);
    }
    entry.sum += normalized;
    entry.count++;
  }

  // Sortie pré-allouée et PACKED
  const out = new Array(summary.size);
  let idx = 0;
  for (const [memberId, entry] of summary) {
    out[idx++] = { memberId, avg: entry.sum / entry.count };
  }
  return out;
}
```

**Étape 6 : re-mesurer.** Nouveau profil : le GC retombe sous 3 %, `StringAdd` et `split` disparaissent. p95 passe de 120 ms à ~18 ms. Gain **prouvé**, pas supposé.

Ce qui a changé et pourquoi :
- Objet `point` éphémère supprimé → ~10 000 allocations/req en moins.
- `label` + `split` supprimés → ~20 000 chaînes/req en moins (on avait l'`id` sous la main).
- Objet `{}` dictionnaire remplacé par `Map` → clés dynamiques sans instabilité de hidden class.
- Sortie via `new Array(size)` + index → tableau dense, pré-alloué.

### Exemple 2 — Benchmark fiable : concat vs join

On veut *prouver* que `Array.join` bat `+=` sur de gros volumes, sans se faire piéger par le JIT.

```ts
import { performance } from 'node:perf_hooks';

const rows = Array.from({ length: 200_000 }, (_, i) => [i, `item_${i}`, Math.random().toFixed(4)]);

function withConcat(data: (string | number)[][]): string {
  let csv = '';
  for (const row of data) csv += row.join(',') + '\n';
  return csv;
}
function withJoin(data: (string | number)[][]): string {
  const lines = new Array(data.length);
  for (let i = 0; i < data.length; i++) lines[i] = data[i].join(',');
  return lines.join('\n');
}

// Warm-up : petite tranche, plusieurs fois, pour laisser TurboFan compiler.
for (let i = 0; i < 5; i++) { withConcat(rows.slice(0, 500)); withJoin(rows.slice(0, 500)); }

// Mesure — on consomme .length pour empêcher la dead-code elimination.
const t0 = performance.now(); const a = withConcat(rows);
const t1 = performance.now(); const b = withJoin(rows);
const t2 = performance.now();

console.log(`concat += : ${(t1 - t0).toFixed(1)} ms`);
console.log(`join      : ${(t2 - t1).toFixed(1)} ms`);
console.log(`ratio     : ${((t1 - t0) / (t2 - t1)).toFixed(2)}x`);
console.log(`sanity    : ${a.length} / ${b.length}`);  // usage réel des résultats
```

Sans le warm-up, la première fonction mesurée paierait la compilation et paraîtrait injustement lente. Sans le `console.log` des `.length`, TurboFan pourrait éliminer les appels.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Optimiser sans profiler

Changer une boucle `.map()` en `for`, remplacer `let` par `const`, « parce que c'est plus rapide ». Sans profil, tu ne sais pas si ça touche le hot path. **Correct :** profiler d'abord ; ne toucher qu'à la fonction qui domine le temps *self*. 95 % des micro-optimisations de syntaxe n'ont aucun effet mesurable.

### PIÈGE #2 — Le micro-benchmark sans warm-up

```ts
// ❌ mesure la compilation, pas le code
const t0 = performance.now();
for (let i = 0; i < 100; i++) doWork();
console.log(performance.now() - t0);
```

Les 100 premières itérations tournent en interprété/baseline. **Correct :** chauffer (des milliers d'appels) avant de chronométrer, puis mesurer sur un grand nombre d'itérations.

### PIÈGE #3 — Le benchmark dont le résultat est jeté

```ts
// ❌ TurboFan supprime tout : le résultat n'est jamais lu
for (let i = 0; i < 1e7; i++) Math.sqrt(i);
```

Le calcul est *dead code*. Ton chrono affiche ~0 et tu conclus « c'est gratuit ». **Correct :** accumuler dans un `sink` et l'utiliser après la boucle.

### PIÈGE #4 — Confondre `Map` et objet

Utiliser un objet `{}` pour des clés qui viennent de l'extérieur (`obj[req.query.key]`) : hidden class qui mute, sites megamorphic, et faille `__proto__`/`constructor`. Inversement, utiliser une `Map` pour une forme fixe et connue est du gaspillage (une classe est plus rapide et plus lisible). **Règle :** clés dynamiques → `Map` ; forme fixe → objet/classe.

### PIÈGE #5 — Croire que `new Array(n)` optimise

`new Array(n)` semble « pré-allouer », mais crée un tableau **HOLEY** (n trous) → chemin d'accès lent et irréversible. **Correct :** `Array.from({ length: n }, fn)` pour un tableau PACKED, ou remplir par index un `new Array(n)` *immédiatement et intégralement* si tu contrôles le remplissage complet.

### PIÈGE #6 — Réutiliser un objet partagé qui fuit

L'astuce « un seul objet réutilisé dans la boucle » (§2.6) est fausse si tu **stockes** cet objet quelque part (`results.push(color)`) : toutes les entrées pointeraient le même objet muté. La réutilisation ne vaut que si l'objet est consommé *dans* l'itération et jamais retenu. **Correct :** réutiliser pour passer à une fonction ; allouer un objet neuf si tu dois le conserver.

---

## 5. Ancrage TribuZen

Le hot path de ce module vit dans l'API TribuZen (NestJS), côté agrégation de données famille.

**`families.service.ts` → `computeFamilyStats()`** (`src/families/families.service.ts`) — l'endpoint `GET /families/:id/stats`. C'est le cas concret : profilé avec `--cpu-prof`, on découvre que le coût est l'allocation d'objets/chaînes éphémères et le churn GC, pas la boucle. Correction : `Map` pour l'agrégat à clés dynamiques (`memberId`), suppression des `label`/`split`, sortie pré-allouée PACKED.

**`members` numériques** — la timeline de scores de bien-être (des milliers de points `{ ts, value }` par famille) part en `Float64Array` (`[ts0, value0, ts1, value1, …]`) pour les calculs de moyenne glissante : mémoire contiguë, zéro allocation par point, pas de pression GC.

**Liste des membres** — l'array des membres d'une famille est construit dense (PACKED) via `Array.from`, jamais `new Array(n)` puis remplissage partiel, pour garder le chemin d'accès rapide lors des rendus de listes.

Méthode imposée sur le projet : **tout PR de perf joint un avant/après profilé** (`--cpu-prof` ou `--trace-gc`). Pas de « je pense que c'est plus rapide » — un chiffre mesuré, ou rien.

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/src/
  families/
    families.service.ts       # computeFamilyStats — hot path profilé
    families.controller.ts     # GET /families/:id/stats
  members/
    scores.timeseries.ts       # Float64Array pour la timeline de scores
  common/
    bench/bench.ts             # helper de micro-benchmark (warm-up + sink)
```

---

## 6. Points clés

1. Ne jamais optimiser sans profil : mesurer → hot path → cause → correction → re-mesurer.
2. Loi d'Amdahl : seul le hot path prouvé (≥ 80 % du temps self) mérite qu'on le touche.
3. Profiler avec `--prof`/`--prof-process`, `--cpu-prof` (DevTools), `--trace-gc` ; lire la vue Bottom-Up pour le temps self.
4. Un micro-benchmark fiable exige : warm-up JIT, anti dead-code elimination (sink consommé), `performance.now()`, entrées variables.
5. Clés dynamiques → `Map` (hidden class stable) ; forme fixe → objet/classe ; appartenance → `Set`.
6. Typed arrays (`Float64Array`…) pour le numérique en masse : contigu, sans boxing, sans allocation par élément.
7. Les allocations en hot path créent le churn GC : réutiliser un objet (sans le retenir) ou passer en typed array.
8. Tableaux : rester PACKED (`Array.from`), fuir HOLEY (`new Array(n)`, trous, `delete`) — transition irréversible.
9. String building : collecter dans un tableau puis `join` une fois, plutôt que `+=` en boucle (flattening des ConsStrings).
10. En hot path, garder des formes d'objets uniformes pour éviter les sites megamorphic (module 11).

---

## 7. Seeds Anki

```
Quelle est la première étape avant toute optimisation de performance ?|Profiler pour localiser le hot path réel (--cpu-prof, --prof, DevTools Bottom-Up). Le cerveau est un mauvais profileur : on ne touche qu'à la fonction qui domine le temps self, jamais à l'aveugle.
Que dit la loi d'Amdahl pour l'optimisation ?|Optimiser une fonction qui pèse X % du temps total plafonne le gain global à ~X %. Optimiser un hot path à 5 % même de 10x ne gagne que ~4,7 %. On concentre l'effort sur les 80 %.
Cite les 4 conditions d'un micro-benchmark fiable en JS.|(1) Warm-up JIT avant de chronométrer, (2) consommer le résultat pour empêcher la dead-code elimination, (3) performance.now() (monotone) pas Date.now(), (4) entrées variables pour éviter le constant folding.
Pourquoi le warm-up est-il indispensable dans un benchmark JS ?|Les premières exécutions tournent en interprété (Ignition) puis baseline (Sparkplug) avant TurboFan. Sans warm-up on mesure le compilateur, pas le code optimisé. Il faut chauffer par milliers d'appels puis mesurer.
Quand choisir Map plutôt qu'un objet {} ?|Pour des clés dynamiques/arbitraires : Map garde une structure stable, .size en O(1), pas de collision prototype (__proto__), pas de hidden-class thrashing ni de sites megamorphic. Un objet {} convient pour une forme fixe et connue.
Pourquoi un typed array (Float64Array) bat un Array de nombres en hot path numérique ?|Mémoire contiguë de doubles bruts, pas de boxing ni de header par élément, accès par offset fixe compilé par TurboFan, et allocation unique donc zéro pression GC pendant la boucle.
Qu'est-ce que le churn GC et comment l'éviter en hot path ?|C'est le coût de collecter des milliers d'objets éphémères (Scavenges young-gen fréquents). On l'évite en réutilisant un objet dans la boucle (sans le retenir) ou en passant à des typed arrays.
Packed vs holey array en V8 : quelle différence et quel piège ?|PACKED = dense, accès rapide ; HOLEY = avec trous, check de trou + remontée prototype à chaque accès, transition irréversible. Piège : new Array(n) crée un tableau HOLEY. Préférer Array.from({length:n}, fn) pour rester PACKED.
Pourquoi éviter la concaténation += en boucle pour construire une grosse chaîne ?|+= crée des ConsStrings (arbres paresseux) ; tout accès/envoi force un flattening O(n) répété. Sur des dizaines de milliers de concats c'est prohibitif. Collecter dans un tableau puis join() une seule fois.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-12-performance-profiling/README.md`. Profiler un script Node volontairement lent avec `--cpu-prof` / `--trace-gc`, localiser le hot path, appliquer une correction ciblée (typed array / Map / réutilisation), puis re-mesurer le gain. Corrigé complet inline + variante J+30 + portage TribuZen.
