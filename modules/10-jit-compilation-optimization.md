---
titre: Compilation JIT et optimisation
cours: 01-js-runtime
notions: [hot functions et tiering-up, optimisation spéculative via type feedback, guards et hypothèses de types, inlining, escape analysis, bounds check elimination, constant folding, déoptimisation eager lazy soft, coût d'une deopt, stabilité des types monomorphisme, trace-opt et trace-deopt]
outcomes: [expliquer le cycle optimisation puis déoptimisation de TurboFan, provoquer et lire une déoptimisation avec --trace-deopt, stabiliser les types d'une fonction chaude pour éviter les deopts]
prerequis: [09-v8-architecture]
next: 11-hidden-classes-inline-caching
libs: []
tribuzen: Moteur — fonction de scoring de l'API TribuZen déoptimisée par des types instables, stabilisée et mesurée
last-reviewed: 2026-07
---

# Compilation JIT et optimisation

> **Outcomes — tu sauras FAIRE :** expliquer le cycle optimisation → déoptimisation de TurboFan, provoquer puis lire une déoptimisation avec `--trace-deopt`, stabiliser les types d'une fonction chaude pour éliminer les deopts.
> **Difficulté :** :star::star::star::star:

## 1. Cas concret d'abord

Le backend TribuZen expose un endpoint de scoring qui classe les membres d'une famille par activité. Le cœur, c'est cette fonction, appelée des millions de fois par jour :

```js
// scoring.js — API TribuZen, cœur du endpoint /families/:id/ranking
function computeScore(base, bonus) {
  return base + bonus * 1.5;
}
```

En prod, la latence de cet endpoint est **4x** ce qu'elle devrait être. Pourtant le code est trivial. Tu lances le diagnostic :

```bash
node --trace-opt --trace-deopt scoring.js
```

Et tu vois défiler ça en boucle :

```
[marking 0x… <JSFunction computeScore> for optimization to turbofan]
[compiling method 0x… <JSFunction computeScore> using TurboFan]
[completed optimizing 0x… <JSFunction computeScore>]
[deoptimizing (DEOPT eager): begin 0x… <JSFunction computeScore>]
    ;;; deoptimize at <scoring.js:2:15>, reason: not a Number
[deoptimizing (DEOPT eager): end … -> interpreter]
```

V8 optimise la fonction, puis la **jette** (déoptimise), la ré-optimise, la re-jette… en boucle. La cause : un appelant passe parfois un `base` qui est un `number`, parfois une `string` (`"120"` venant d'un champ de formulaire non parsé). Chaque changement de type viole l'hypothèse sur laquelle TurboFan a spécialisé le code machine.

Ce module explique **pourquoi** ce cycle existe, **comment** le lire dans les traces, et **comment** stabiliser les types pour que la fonction reste optimisée.

---

## 2. Théorie complète, concise

### 2.1 Hot functions et tiering-up

Rappel du module 09 : V8 exécute d'abord tout le code dans l'interpréteur **Ignition** (démarrage instantané, exécution lente). Pendant qu'Ignition exécute, il **compte** les appels et les itérations de boucle, et il **enregistre les types observés** dans le *feedback vector* de la fonction.

Quand une fonction devient **chaude** (hot) — appelée assez souvent, ou boucle itérée assez de fois — V8 la promeut vers un tier plus rapide. C'est le **tiering-up** :

```
Ignition  →  Sparkplug  →  Maglev  →  TurboFan
(interp.)    (baseline)     (mid)      (optimisant)
 froid        tiède          chaud       très chaud
```

Seuls Maglev et TurboFan utilisent le type feedback pour **spécialiser** le code. TurboFan est le plus agressif : c'est lui qui parie sur les types, et donc lui qui peut déoptimiser. Ce module se concentre sur le couple TurboFan ↔ déoptimisation.

### 2.2 Optimisation spéculative : parier sur les types

Un compilateur AOT (C, Rust) ne connaît pas les types à l'exécution — il génère du code générique. L'avantage **unique** du JIT, c'est qu'il a vu passer les vraies valeurs. TurboFan **spécule** : il parie que les types observés jusqu'ici resteront stables, et génère du code machine taillé pour ces types-là.

Pour `computeScore(base, bonus)` appelée 100 000 fois avec des entiers, le feedback dit « `base` et `bonus` sont toujours des nombres ». TurboFan génère alors une addition machine directe. Mais comme c'est un **pari**, il doit se protéger : il insère des **guards** (vérifications) avant chaque opération spéculée.

```
Code optimisé pour (Number, Number) — pseudo-assembleur :

  ; GUARD : base est-il bien un Number ?
  check_number base   → sinon: DEOPT
  ; GUARD : bonus est-il bien un Number ?
  check_number bonus  → sinon: DEOPT
  ; opération spécialisée (rapide, ~3 instructions)
  r = base + bonus * 1.5
  return r
```

Le guard est le point de bascule : tant qu'il passe, on reste sur le code rapide. Dès qu'il échoue, c'est la déoptimisation.

### 2.3 Les optimisations clés de TurboFan

Une fois qu'il spécule sur les types, TurboFan enchaîne des optimisations. Les quatre à connaître :

**Inlining** — copier le corps d'une petite fonction directement dans l'appelant. Élimine le coût d'appel et débloque toutes les autres optimisations en cascade.

```js
// AVANT — deux appels de fonction
function square(x) { return x * x; }
function sumSq(a, b) { return square(a) + square(b); }

// APRÈS inlining (conceptuel) — plus aucun appel
function sumSq(a, b) {
  return (a * a) + (b * b);
}
```

TurboFan a un **budget** d'inlining : il n'inline pas une fonction trop grosse, récursive, polymorphique (plusieurs cibles possibles), ou contenant `eval`.

**Constant folding** — si une valeur est prouvée constante à la compilation, la remplacer par son résultat.

```js
function taxe() {
  const taux = 0.2;
  const base = 100;
  return base * taux;   // TurboFan génère directement : return 20;
}
```

**Escape analysis** — un objet qui ne « s'échappe » pas de la fonction (pas retourné, pas stocké ailleurs, pas passé à une fonction non inlinée) n'a pas besoin d'être alloué sur le tas. Ses champs deviennent des registres. Zéro allocation → zéro pression GC.

```js
// Les objets p1/p2 ne s'échappent pas → escape analysis les élimine
function distance(x1, y1, x2, y2) {
  const p1 = { x: x1, y: y1 };  // pas alloué : scalar-replaced
  const p2 = { x: x2, y: y2 };  // pas alloué : scalar-replaced
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}
```

Si l'objet s'échappe (`array.push(p1)`, retour, closure), l'escape analysis échoue et l'allocation redevient obligatoire.

**Bounds check elimination** — TurboFan prouve que l'index d'une boucle reste dans les bornes du tableau, et supprime la vérification `0 <= i < arr.length` normalement faite à chaque `arr[i]`.

```js
function sum(arr) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i];  // bounds check supprimé : i est prouvé dans [0, length[
  }
  return total;
}
```

### 2.4 Déoptimisation : quand le pari est perdu

Une **déoptimisation** (deopt) survient quand une hypothèse spéculée est violée. V8 **abandonne le code machine optimisé** et renvoie l'exécution vers Ignition — au milieu de l'exécution s'il le faut. Il y a trois formes :

| Forme | Déclencheur | Trace |
|---|---|---|
| **eager** | Un guard échoue *pendant* l'exécution du code optimisé (la valeur n'a pas le type attendu). | `DEOPT eager … not a Number` |
| **lazy** | Une hypothèse est invalidée par un événement *externe* (une Map d'objet a changé, un prototype modifié). Le code est marqué ; la deopt se produit au prochain retour dedans. | `DEOPT lazy … wrong map` |
| **soft** | V8 déoptimise *volontaire­ment* pour recollecter du feedback et recompiler mieux. Ce n'est pas un échec. | `DEOPT soft … insufficient type feedback` |

Le cas du module 1 (`base` tantôt `number`, tantôt `string`) est une **deopt eager** : le guard `check_number base` échoue.

### 2.5 Le coût d'une deopt

Une déoptimisation n'est pas gratuite. À chaque deopt, V8 doit :

1. **Traduire** le frame optimisé (registres machine) en frame interpréteur (registres virtuels Ignition) — c'est la *deopt translation*.
2. Reprendre l'exécution dans Ignition, plus lent.
3. Perdre le code machine optimisé (qui avait coûté du temps de compilation).
4. Éventuellement re-chauffer et recompiler plus tard.

Un aller-retour coûte de l'ordre de la centaine de microsecondes. Anecdotique une fois. **Catastrophique** dans une boucle chaude qui deopt à chaque itération : on paie la traduction + l'interprétation en continu, sans jamais profiter du code rapide. C'est exactement le symptôme du cas concret.

Pire cas : si une fonction deopt en boucle (~10 fois), V8 la marque **« don't optimize »** et la laisse en Sparkplug/Ignition pour toujours. Trace : `disabled optimization for … `. Le code devient définitivement lent — seule une correction du source la sauve.

### 2.6 Garder les types stables

La règle d'or pour éviter les deopts : **une fonction chaude doit voir des types stables**. Concrètement :

- Un paramètre qui est `number` doit **toujours** être `number` (pas `number | string`).
- Un objet accédé par la fonction doit **toujours** avoir la même forme (même Hidden Class).

On parle de **monomorphisme** quand un site d'opération n'a vu qu'un seul type/forme (idéal), de **polymorphisme** pour 2 à 4, et de **mégamorphisme** au-delà (V8 renonce à spécialiser). Le mécanisme précis (Maps, inline caches, transitions) est le sujet du **module 11** — ici, retiens simplement : *un type par variable, une forme par objet, sur toute la durée de vie de la fonction chaude*.

Correction du cas concret : parser en amont pour garantir un `number`.

```js
// L'appelant garantit le type AVANT d'atteindre la fonction chaude
function computeScore(base, bonus) {
  return base + bonus * 1.5;   // base et bonus toujours Number → pas de deopt
}
// côté appelant :
const base = Number(rawBase);   // "120" → 120 une seule fois, en périphérie
computeScore(base, bonus);
```

### 2.7 Les outils : --trace-opt et --trace-deopt

Deux flags Node.js (qui passent directement à V8) suffisent pour tout diagnostiquer :

```bash
node --trace-opt   script.js   # quand et vers quel tier V8 optimise
node --trace-deopt script.js   # quand et pourquoi V8 déoptimise
node --trace-opt --trace-deopt script.js   # les deux ensemble (recommandé)
```

Lecture de `--trace-opt` :

```
[marking … <JSFunction f> for optimization to turbofan]  ← f est devenue chaude
[compiling method … <JSFunction f> using TurboFan]        ← compilation (en arrière-plan)
[completed optimizing … <JSFunction f>]                   ← code machine installé
```

Lecture de `--trace-deopt` :

```
[deoptimizing (DEOPT eager): begin … <JSFunction f>]
    ;;; deoptimize at <script.js:2:15>, reason: not a Number
[deoptimizing (DEOPT eager): end … -> interpreter]
```

Trois infos clés dans une ligne de deopt : **la forme** (`eager`/`lazy`/`soft`), **la raison** (`not a Number`, `wrong map`, `insufficient type feedback`), et **la position** (`<script.js:2:15>` = fichier:ligne:colonne). La position pointe vers le code source exact à corriger.

> **Astuce** : `--allow-natives-syntax` débloque `%OptimizeFunctionOnNextCall(f)` et `%GetOptimizationStatus(f)` pour forcer/inspecter l'état d'optimisation dans un script de test. Pratique pour un lab, à ne jamais utiliser en prod.

---

## 3. Worked examples

### Exemple 1 — Provoquer et lire une deopt (le cas TribuZen, résolu)

On reproduit le bug de scoring, on le lit dans la trace, on le corrige.

```js
// deopt-demo.js
// Lancer : node --trace-opt --trace-deopt deopt-demo.js

function computeScore(base, bonus) {
  return base + bonus * 1.5;
}

// Phase 1 — chauffer avec des Number stables → TurboFan optimise
for (let i = 0; i < 100_000; i++) {
  computeScore(i, i + 1);
}
console.log('Phase 1 : computeScore optimisée pour (Number, Number)');

// Phase 2 — un appel avec une string : le guard échoue → DEOPT eager
computeScore('120', 5);
console.log('Phase 2 : deopt provoquée (base = string)');

// Phase 3 — on rechauffe : V8 recompile, cette fois plus prudent
for (let i = 0; i < 100_000; i++) {
  computeScore(i, i + 1);
}
console.log('Phase 3 : re-optimisation');
```

Sortie annotée :

```
# Phase 1
[marking … <JSFunction computeScore> for optimization to turbofan]
[completed optimizing … <JSFunction computeScore>]     ← code rapide installé

# Phase 2
[deoptimizing (DEOPT eager): begin … <JSFunction computeScore>]
    ;;; deoptimize at <deopt-demo.js:5:10>, reason: not a Number  ← LA cause + LA ligne
[deoptimizing (DEOPT eager): end … -> interpreter]     ← retour à Ignition

# Phase 3
[marking … <JSFunction computeScore> for optimization to turbofan]  ← rechauffe
[completed optimizing … <JSFunction computeScore>]
```

**Diagnostic** : `reason: not a Number` à la ligne 5 → un opérande n'était pas un nombre. **Correction** : convertir en `Number` avant d'appeler, une seule fois, à la frontière de l'API :

```js
// L'appelant (contrôleur HTTP) normalise AVANT la fonction chaude
function rankMembers(rows) {
  return rows.map(r => ({
    id: r.id,
    // Number() une fois, en périphérie — computeScore ne voit que des Number
    score: computeScore(Number(r.base), Number(r.bonus)),
  }));
}
```

Après correction, `--trace-deopt` ne produit plus **aucune** ligne de deopt sur `computeScore`.

### Exemple 2 — Vérifier l'état d'optimisation avec les natives V8

Sur un cas plus subtil (deopt par changement de forme d'objet), on utilise `%GetOptimizationStatus` pour confirmer sans lire des centaines de lignes de trace.

```js
// opt-status.js
// Lancer : node --allow-natives-syntax opt-status.js

function readBase(member) {
  return member.base;   // spéculé sur UNE forme d'objet
}

// forme A : { base } — monomorphe
const a = { base: 10 };
for (let i = 0; i < 100_000; i++) readBase(a);

// Force l'optimisation puis inspecte
%OptimizeFunctionOnNextCall(readBase);
readBase(a);
console.log('optimisée ?', isOptimized(readBase));   // true

// forme B : { base, extra } — nouvelle Map → polymorphe → deopt
const b = { base: 20, extra: true };
readBase(b);
console.log('après forme B :', isOptimized(readBase)); // false (déoptimisée)

function isOptimized(fn) {
  // bit 0b10 du statut = "optimized"
  return (%GetOptimizationStatus(fn) & 0b10) !== 0;
}
```

**Ce que ça montre** : un simple `member.extra` en plus sur un objet suffit à changer sa Hidden Class, invalider l'hypothèse de forme, et déoptimiser `readBase`. Le *pourquoi* (Maps, transitions, inline caches) est détaillé au module 11 — ici on **observe** l'effet et on retient la règle : même forme d'objet partout dans une fonction chaude.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « La déoptimisation est un bug de V8 »

Faux. La deopt est un **mécanisme normal et sain** : c'est le filet de sécurité qui autorise la spéculation. Sans deopt, V8 ne pourrait jamais parier sur les types. Le problème n'est pas *une* deopt (inévitable au premier changement de type), mais une deopt **récurrente en boucle** qui empêche le code de rester optimisé. Objectif : zéro deopt *dans les hot loops*, pas zéro deopt absolu.

### PIÈGE #2 — Confondre eager et lazy deopt

```js
// EAGER : le guard échoue pendant l'exécution du code optimisé
function add(a, b) { return a + b; }
add(1, 2);        // optimisé pour Number
add('x', 'y');    // → DEOPT eager : "not a Number", ici, maintenant

// LAZY : une hypothèse est invalidée de l'extérieur, la deopt vient plus tard
const obj = { x: 1 };
function getX(o) { return o.x; }
// … getX optimisé pour la forme de obj …
Object.setPrototypeOf(obj, {});  // invalide l'hypothèse → DEOPT lazy au prochain retour dans getX
```

**Discrimination** : eager = « la valeur passée ne colle pas, deopt immédiate ». lazy = « le monde a changé sous les pieds du code optimisé, deopt différée ».

### PIÈGE #3 — Croire que `number | string` est « juste un peu plus lent »

```js
// ❌ Type instable : chaque bascule number↔string = une deopt eager
function score(v) { return v * 2; }
score(10);      // Number
score('10');    // String → deopt
score(20);      // Number → re-deopt possible

// ✅ Un seul type sur toute la vie de la fonction chaude
function score(v) { return v * 2; }   // v TOUJOURS Number, normalisé en amont
```

Ce n'est pas linéaire : une fonction qui deopt à répétition finit **marquée « don't optimize »** et reste lente *pour toujours*. Le coût n'est pas « un peu », c'est « plus jamais optimisée ».

### PIÈGE #4 — `arguments`, `eval`, `with` tuent l'optimisation

```js
// ❌ arguments qui "fuit" empêche l'inlining et l'optimisation
function old() {
  const args = Array.prototype.slice.call(arguments);
  return args.reduce((a, b) => a + b);
}

// ❌ même un eval vide rend le scope dynamique → pas de TurboFan
function bad(x) { eval(''); return x * 2; }

// ✅ rest params + pas d'eval → optimisable normalement
function modern(...args) {
  return args.reduce((a, b) => a + b);
}
```

Dans `--trace-opt`, ces fonctions n'apparaissent **jamais** avec `completed optimizing` : V8 refuse de les promouvoir.

### PIÈGE #5 — Micro-optimiser du code froid

La spéculation ne s'applique qu'au code **chaud**. Passer une heure à stabiliser les types d'une fonction appelée trois fois au démarrage ne rapporte rien — elle reste dans Ignition de toute façon. On stabilise **ce qui est chaud** : les boucles, les handlers de requête, les fonctions du chemin critique. Le reste, on laisse.

---

## 5. Ancrage TribuZen

**Couche fil-rouge : Moteur.** Le module 10 travaille le cœur de calcul de l'API TribuZen — les fonctions du chemin critique appelées à haute fréquence, là où une deopt récurrente coûte cher.

Cible concrète : l'endpoint `GET /families/:id/ranking` qui classe les membres d'une famille par score d'activité. Son cœur, `computeScore(base, bonus)`, est appelé une fois par membre, à chaque requête, sur des milliers de familles — c'est une **hot function** typique.

Le bug réel : les valeurs `base`/`bonus` viennent de sources hétérogènes (BDD `number`, formulaires `string`, imports CSV `string`). Sans normalisation, `computeScore` reçoit un type instable, deopt en boucle, et l'endpoint traîne à 4x sa latence cible. La correction TribuZen tient en une ligne — `Number()` à la frontière du contrôleur — mais elle divise la latence par 4.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/api/src/
  families/
    ranking.controller.ts   # normalise les types (Number) en périphérie
    scoring.ts              # computeScore : hot function, types stables garantis
```

C'est le lab 10 : provoquer la deopt sur `computeScore`, la lire dans `--trace-deopt`, la stabiliser, mesurer le gain.

---

## 6. Points clés

1. Une fonction **chaude** est promue (tiering-up) jusqu'à TurboFan, seul tier à spéculer agressivement sur les types.
2. L'**optimisation spéculative** parie sur les types du feedback et protège chaque pari par un **guard**.
3. TurboFan enchaîne **inlining**, **constant folding**, **escape analysis** (zéro allocation) et **bounds check elimination**.
4. Une **déoptimisation** abandonne le code machine et revient à Ignition quand un guard échoue (eager), qu'une hypothèse externe tombe (lazy), ou volontairement (soft).
5. Le **coût** d'une deopt = traduction de frame + retour à l'interpréteur ; catastrophique en boucle, et après ~10 deopts la fonction est marquée « don't optimize » définitivement.
6. La règle de stabilité : **un type par variable, une forme par objet** sur toute la vie de la fonction chaude (monomorphisme ; détaillé au module 11).
7. `--trace-opt` montre les promotions, `--trace-deopt` montre forme + raison + `fichier:ligne:colonne` de chaque deopt.

---

## 7. Seeds Anki

```
Qu'est-ce qu'une "hot function" et que déclenche-t-elle ?|Une fonction appelée assez souvent (ou dont la boucle itère assez) pour que V8 la promeuve vers un tier plus rapide (tiering-up), jusqu'à TurboFan qui la compile en code machine spécialisé sur les types observés.
Pourquoi le JIT peut-il faire de l'optimisation spéculative alors qu'un compilateur AOT ne le peut pas ?|Le JIT a observé les vrais types à l'exécution (type feedback) et peut parier dessus. L'AOT compile avant exécution, sans connaître les types, donc il génère du code générique.
À quoi sert un "guard" dans le code optimisé par TurboFan ?|C'est une vérification insérée avant une opération spéculée (ex : "cette valeur est-elle bien un Number ?"). S'il passe, on reste sur le code rapide ; s'il échoue, il déclenche une déoptimisation.
Quelles sont les 3 formes de déoptimisation et leur déclencheur ?|eager : un guard échoue pendant l'exécution du code optimisé (mauvais type). lazy : une hypothèse est invalidée de l'extérieur (Map/prototype changé), deopt différée. soft : V8 déoptimise volontairement pour recollecter du feedback et recompiler mieux.
Que coûte une déoptimisation, et quel est le pire cas ?|Coût : traduction du frame optimisé en frame interpréteur + retour à Ignition (~100 µs) + perte du code compilé. Pire cas : après ~10 deopts en boucle, V8 marque la fonction "don't optimize" et la laisse lente pour toujours.
Qu'est-ce que l'escape analysis et quand échoue-t-elle ?|Optimisation qui n'alloue pas sur le tas un objet ne s'échappant pas de la fonction (ses champs deviennent des registres). Elle échoue si l'objet est retourné, stocké dans un tableau, capturé par une closure, ou passé à une fonction non inlinée.
Quelle règle suivre pour éviter les deopts dans une fonction chaude ?|Types stables : un type par variable (pas number|string) et une forme d'objet unique (même Hidden Class) sur toute la vie de la fonction. Normaliser les types en périphérie, avant d'atteindre le hot path.
Comment lire une ligne de --trace-deopt ?|Trois infos : la forme (eager/lazy/soft), la raison (not a Number, wrong map, insufficient type feedback), et la position source fichier:ligne:colonne qui pointe le code exact à corriger.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-10-jit-deoptimization/README.md`. Provoquer une déoptimisation sur la fonction de scoring TribuZen en lui passant des types instables, l'observer dans `--trace-deopt`, la stabiliser et mesurer le gain avec `performance.now()`.
