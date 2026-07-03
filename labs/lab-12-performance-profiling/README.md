# Lab 12 — Performance profiling : mesurer, corriger, re-mesurer

> **Outcome :** à la fin, tu sais profiler un script Node avec `--cpu-prof` / `--trace-gc`, localiser le hot path, appliquer une correction ciblée (typed array / Map / réutilisation d'objet) et **prouver** le gain par une seconde mesure.
> **Vrai outil :** Node.js `--cpu-prof` + `--trace-gc` + `node:perf_hooks` + Chrome DevTools (onglet Performance). Aucun harnais simulé, aucun test auto-correcteur.
> **Feedback :** le coach valide en session — il te demande de montrer les deux profils (avant/après) et de commenter le hot path.

## Énoncé

On te donne un script `slow-stats.mjs` qui simule l'endpoint `GET /families/:id/stats` de TribuZen : il agrège des dizaines de milliers de lectures de scores. Il est **volontairement lent**. Ta mission n'est pas de deviner pourquoi — c'est de le **profiler**, puis de corriger la cause réelle, puis de re-mesurer.

Règle d'or du lab : **tu n'as pas le droit de modifier une ligne avant d'avoir un profil**. Si tu optimises avant de mesurer, tu as raté l'exercice même si le résultat est plus rapide.

Starter à créer toi-même dans le dossier du lab (`slow-stats.mjs`) :

```js
// slow-stats.mjs — version LENTE volontaire (ne PAS optimiser avant de profiler)
import { performance } from 'node:perf_hooks';

// Génère des lectures réalistes : ~40 000 lectures, ~500 membres
function makeReadings(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ memberId: `m${i % 500}`, value: Math.random() * 100, max: 100, ts: Date.now() + i });
  }
  return out;
}

function computeFamilyStats(readings) {
  let csv = '';
  const summary = {};
  for (const r of readings) {
    const point = {
      memberId: r.memberId,
      normalized: r.value / r.max,
      label: `member-${r.memberId}-${r.ts}`,
    };
    csv += point.label + '\n';                  // concat en boucle
    const key = point.label.split('-')[1];      // re-parse ce qu'on vient de construire
    (summary[key] ??= { sum: 0, count: 0 });
    summary[key].sum += point.normalized;
    summary[key].count++;
  }
  return Object.keys(summary).map((k) => ({ memberId: k, avg: summary[k].sum / summary[k].count }));
}

const readings = makeReadings(40_000);

// Boucle de charge : simule 200 requêtes
const t0 = performance.now();
let sink = 0;
for (let i = 0; i < 200; i++) sink += computeFamilyStats(readings).length;
const dt = performance.now() - t0;
console.log(`200 requêtes : ${dt.toFixed(1)} ms  (sink=${sink})`);
```

## Étapes (en friction)

1. **Mesurer la baseline.** Lance `node slow-stats.mjs` et note le temps des 200 requêtes. C'est ton point de référence.
2. **Profiler le GC.** Relance avec `node --trace-gc slow-stats.mjs`. Observe la fréquence des `Scavenge`. Note : est-ce que le GC tourne en rafale ? Ça signale du churn d'allocations.
3. **Profiler le CPU.** Lance `node --cpu-prof slow-stats.mjs`. Ouvre le `.cpuprofile` généré dans Chrome DevTools (onglet Performance → charger le fichier), passe en vue **Bottom-Up** et lis le **temps self**. Écris à la main les 3 fonctions qui dominent.
4. **Formuler une hypothèse** à partir du profil (pas de ton intuition) : quelle est la cause du hot path ? Allocation d'objets `point` ? Concat `csv` ? `split` ? GC ?
5. **Corriger UNE cause à la fois.** Applique la correction (voir corrigé) et **re-mesure** après chaque changement pour vérifier que le gain est réel.
6. **Re-profiler.** Relance `--cpu-prof` + `--trace-gc` sur la version corrigée. Vérifie que le GC a chuté et que les fonctions du hot path ont disparu du top. Compare le temps des 200 requêtes à la baseline de l'étape 1.
7. **Documenter le gain** en une phrase chiffrée : « baseline X ms → corrigé Y ms, GC de A % à B % ».

## Corrigé complet commenté

```js
// fast-stats.mjs — version corrigée, APRÈS profilage
import { performance } from 'node:perf_hooks';

function makeReadings(n) {
  // Array.from => tableau PACKED (dense), pas de new Array(n) HOLEY
  return Array.from({ length: n }, (_, i) => ({
    memberId: `m${i % 500}`,
    value: Math.random() * 100,
    max: 100,
    ts: Date.now() + i,
  }));
}

function computeFamilyStats(readings) {
  // Map : clés dynamiques (memberId) sans hidden-class thrashing ni site megamorphic.
  // Réutilisée à chaque appel via .clear() pour ne pas réallouer la structure.
  const summary = new Map();

  // Une seule passe. Aucun objet "point" éphémère, aucune chaîne, aucun split :
  // c'était ça le churn GC révélé par --trace-gc + Bottom-Up.
  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    const normalized = r.value / r.max;   // pas de clone, accès direct
    let entry = summary.get(r.memberId);  // l'id est déjà là : plus de label+split
    if (entry === undefined) {
      entry = { sum: 0, count: 0 };
      summary.set(r.memberId, entry);
    }
    entry.sum += normalized;
    entry.count++;
  }

  // Sortie pré-allouée et remplie intégralement => reste PACKED.
  const out = new Array(summary.size);
  let idx = 0;
  for (const [memberId, entry] of summary) {
    out[idx++] = { memberId, avg: entry.sum / entry.count };
  }
  return out;
}

const readings = makeReadings(40_000);

// Warm-up : laisser TurboFan optimiser avant de chronométrer (sinon on mesure le JIT).
for (let i = 0; i < 20; i++) computeFamilyStats(readings);

// Mesure — sink consommé pour empêcher la dead-code elimination.
const t0 = performance.now();
let sink = 0;
for (let i = 0; i < 200; i++) sink += computeFamilyStats(readings).length;
const dt = performance.now() - t0;
console.log(`200 requêtes : ${dt.toFixed(1)} ms  (sink=${sink})`);
```

**Ce que le profil AVANT montrait (et ce qui a été corrigé) :**
- `Runtime_StringAdd` en tête → concat `csv += …` supprimée (on ne construisait le CSV pour rien).
- `String.split` élevé → `label` + `split('-')[1]` supprimés ; l'`id` était déjà accessible.
- GC ~14 % → objet `point` éphémère supprimé (~40 000 allocations/appel en moins) → GC retombe sous 3 %.
- Objet `{}` comme dictionnaire → `Map`, structure stable pour des clés dynamiques.

**Vérification attendue :** temps des 200 requêtes divisé par ~5 à ~7, et `--trace-gc` nettement plus calme. Le chiffre exact dépend de la machine — ce qui compte, c'est le **delta mesuré**, pas une valeur absolue.

## Variante J+30 (fading)

Reprends l'exercice **sans relire le corrigé**, avec deux contraintes ajoutées :
1. La `value` doit être traitée comme un flux numérique : stocke les lectures d'un membre dans un **`Float64Array`** pré-dimensionné et calcule la moyenne dessus (pas d'objet `{ sum, count }`).
2. Impose-toi de produire **trois profils** : baseline, version intermédiaire (Map seule), version finale (Map + typed array), et de commenter le gain marginal de chaque étape. Objectif : montrer que la 2e optimisation n'apporte parfois presque rien — donc qu'il faut la mesurer, pas la supposer.

## Application TribuZen

Porte la correction dans `smaurier/tribuzen` :
- Profile réellement `GET /families/:id/stats` (`src/families/families.service.ts`) sous charge avec `node --cpu-prof dist/main.js` puis un tir de charge (`autocannon`/`k6`), et ouvre le `.cpuprofile` dans DevTools.
- Applique le pattern `Map` + suppression des chaînes intermédiaires + sortie PACKED dans `computeFamilyStats()`.
- Ajoute `src/members/scores.timeseries.ts` : la timeline de scores d'un membre en `Float64Array` pour la moyenne glissante.
- Commit sur `smaurier/tribuzen` avec, dans le message, l'avant/après chiffré (p95 et part GC). Règle du repo : **aucun PR de perf sans profil joint**.
