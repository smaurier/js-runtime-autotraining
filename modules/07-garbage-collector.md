# Module 07 — Le Garbage Collector

> **Objectif** : Comprendre en profondeur le fonctionnement du ramasse-miettes de V8 (Orinoco), depuis les algorithmes fondamentaux (reference counting, mark-and-sweep) jusqu'aux stratégies avancées (GC générationnel, tri-color marking, marquage incrémental et concurrent), afin de pouvoir anticiper et diagnostiquer les pauses GC en production.

> **Difficulté** : ⭐⭐⭐ (Avancé)

---

## Prérequis

- Maîtrise de JavaScript (closures, prototypes, objets)
- Notions de gestion mémoire (pile vs tas / stack vs heap)
- Familiarité avec Node.js et ses flags de démarrage
- Avoir suivi les modules 01 à 06 (Event Loop, Call Stack, Heap)

---

## Théorie

> 🎯 **Analogie** : Le Garbage Collector, c'est comme un service de nettoyage dans un bureau. Il passe régulièrement, identifie les papiers que personne n'utilise plus (objets sans référence), et les jette. Il ne touche jamais à ce qui est encore sur un bureau (référencé).

### 1. Pourquoi un Garbage Collector ?

En C/C++, le développeur alloue et libère la mémoire manuellement :

```c
// C — gestion manuelle
char *buf = (char *)malloc(1024);
// ... utilisation ...
free(buf);        // oubli = fuite mémoire
free(buf);        // double free = crash / vulnérabilité
buf[0] = 'A';    // use-after-free = comportement indéfini
```

Les trois erreurs classiques de la gestion manuelle :

```
  ┌────────────────────┬──────────────────────────────────────┐
  │ Erreur             │ Conséquence                          │
  ├────────────────────┼──────────────────────────────────────┤
  │ Oubli de free()    │ Fuite mémoire (memory leak)          │
  │ Double free()      │ Crash, corruption du tas             │
  │ Use-after-free     │ Comportement indéfini, faille sécu   │
  └────────────────────┴──────────────────────────────────────┘
```

JavaScript délègue cette responsabilité au **Garbage Collector** (GC) intégré au moteur. Le développeur n'appelle jamais `free()` — le GC identifie automatiquement les objets inaccessibles et récupère leur mémoire.

### 2. Reference Counting vs Mark-and-Sweep

**Note importante** : les moteurs JavaScript modernes (V8, SpiderMonkey, JavaScriptCore) n'utilisent **pas** le reference counting. Ils utilisent tous des variantes de mark-and-sweep. Le reference counting est présenté ici à titre historique et pédagogique.

#### 2.1 Reference Counting (comptage de références)

Chaque objet possède un compteur : le nombre de références pointant vers lui. Quand le compteur tombe à zéro, l'objet est libéré.

```
  Objet A (refcount: 1) ──referenceA──> Objet B (refcount: 2)
                                              ^
  Objet C (refcount: 1) ──referenceC──────────┘
```

**Avantage** : libération immédiate dès que refcount = 0.

**Problème fatal** : les **cycles de références**.

```
  ┌─────────┐        ┌─────────┐
  │ Objet X │───────>│ Objet Y │
  │ ref: 1  │<───────│ ref: 1  │
  └─────────┘        └─────────┘

  Même si plus rien ne pointe vers X et Y depuis la racine,
  leurs refcounts restent à 1 → jamais collectés → fuite !
```

Ce problème était celui d'Internet Explorer 6/7 avec les objets DOM et les closures JS.

#### 2.2 Mark-and-Sweep (marquage et balayage)

Algorithme utilisé par tous les moteurs JS modernes :

1. **Mark** : partir des racines (globales, pile d'appels, registres) et marquer tous les objets accessibles.
2. **Sweep** : parcourir tout le tas et libérer les objets non marqués.

```
        RACINES (roots)
        ┌──────────┐
        │  global   │
        │  stack    │
        │ registers │
        └────┬─────┘
             │
     ┌───────┴───────┐
     v               v
 ┌───────┐      ┌───────┐
 │ Obj A │─────>│ Obj B │     ┌───────┐
 │MARQUE │      │MARQUE │     │ Obj D │  <── non atteint
 └───────┘      └───┬───┘     │  non  │      = collecte
                    │          │marque │
                    v          └───────┘
               ┌───────┐
               │ Obj C │
               │MARQUE │
               └───────┘

  Phase SWEEP : Obj D est libéré, A/B/C sont conservés.
```

**Avantage** : gère parfaitement les cycles.
**Inconvénient** : nécessite une pause (stop-the-world) pour marquer.

### 3. Le GC générationnel de V8

V8 exploite l'**hypothèse générationnelle** : la majorité des objets meurent jeunes. Le tas est donc divisé en deux générations.

```
  ┌──────────────────────────────────────────────────────┐
  │                    V8 HEAP                            │
  │                                                      │
  │  ┌─────────────────────┐  ┌────────────────────────┐ │
  │  │   YOUNG GENERATION  │  │    OLD GENERATION      │ │
  │  │   (New Space)       │  │    (Old Space)         │ │
  │  │   1-8 Mo            │  │    Jusqu'à plusieurs   │ │
  │  │                     │  │    Go                   │ │
  │  │  ┌───────┬───────┐  │  │                        │ │
  │  │  │ From  │  To   │  │  │  Objets ayant survécu  │ │
  │  │  │ Space │ Space │  │  │  à 2+ cycles de GC     │ │
  │  │  │       │(vide) │  │  │  mineur                │ │
  │  │  └───────┴───────┘  │  │                        │ │
  │  │                     │  │                        │ │
  │  │  Scavenger          │  │  Mark-Sweep-Compact    │ │
  │  │  (Minor GC)         │  │  (Major GC)            │ │
  │  └─────────────────────┘  └────────────────────────┘ │
  └──────────────────────────────────────────────────────┘
```

### 4. Young Generation : Scavenger (Minor GC)

La Young Generation utilise un **semi-space** divisé en deux moitiés égales : **from-space** et **to-space**.

**Note** : les objets dépassant un certain seuil de taille (typiquement > 256 Ko dans V8) sont alloués directement dans le **Large Object Space** (LOS) de l'Old Generation, contournant entièrement la Young Generation. Cela évite de remplir le semi-space avec un seul gros objet.

#### Algorithme de Cheney (Cheney's Algorithm)

L'algorithme de Cheney est un algorithme de copie en largeur (BFS) qui n'utilise pas de pile de récursion. Il parcourt les objets vivants et les copie dans le to-space en utilisant deux pointeurs : un pointeur de scan et un pointeur d'allocation.

Déroulement :

1. Les nouveaux objets sont alloués dans le **from-space**.
2. Quand le from-space est plein, le Scavenger démarre.
3. Les racines GC sont parcourues. Chaque objet vivant est **copié** dans le to-space.
4. Pour chaque objet copié, une **forwarding address** est laissée dans le from-space (pour mettre à jour les pointeurs d'autres objets).
5. Le pointeur de scan avance dans le to-space : pour chaque objet copié, ses références filles sont elles aussi copiées (si pas déjà fait).
6. Quand scan == allocation, tous les objets vivants sont copiés.
7. Les rôles sont inversés : l'ancien to-space devient le nouveau from-space.
8. Les objets ayant survécu **deux** cycles de Minor GC sont **promus** dans l'Old Generation.

```
  AVANT le Scavenger :
  ┌─────────────────────────────┬─────────────────────────────┐
  │         FROM-SPACE          │         TO-SPACE             │
  │  [A][B][C][D][E][F][G]     │         (vide)               │
  └─────────────────────────────┴─────────────────────────────┘
         ^
   allocation ici

  Racines → A, C, E sont accessibles (B, D, F, G sont morts)

  PENDANT le Scavenger (Cheney BFS) :
  ┌─────────────────────────────┬─────────────────────────────┐
  │         FROM-SPACE          │         TO-SPACE             │
  │  [fwd][B][fwd][D][fwd][F]  │  [A'][C'][E']               │
  │   ^A→A'    ^C→C'   ^E→E'   │   ^scan    ^alloc           │
  └─────────────────────────────┴─────────────────────────────┘
  fwd = forwarding pointer vers la copie dans le to-space

  APRÈS le Scavenger :
  ┌─────────────────────────────┬─────────────────────────────┐
  │    (ancien FROM, libéré)    │  NOUVEAU FROM-SPACE          │
  │         (vide)              │  [A'][C'][E']                │
  │  (sera le prochain To)      │  (copié, compacté)           │
  └─────────────────────────────┴─────────────────────────────┘
                                       ^
                                 allocation ici

  Les rôles s'inversent à chaque cycle.
```

**Propriétés clés** :
- Très rapide (ne visite que les objets vivants, pas les morts).
- Compacte automatiquement (pas de fragmentation).
- Coût proportionnel au nombre d'objets **survivants**, pas au nombre total.
- Limite : utilise seulement 50% de l'espace à tout moment.

### 5. Old Generation : Mark-Sweep-Compact (Major GC)

Les objets promus dans l'Old Generation sont collectés par un algorithme plus lourd mais adapté aux objets à longue durée de vie.

#### 5.1 Tri-Color Marking (marquage tricolore)

V8 utilise un schéma de marquage en trois couleurs pour gérer le marquage de façon incrémentale et concurrente :

```
  ┌─────────┬────────────────────────────────────────────────────┐
  │ Couleur │ Signification                                      │
  ├─────────┼────────────────────────────────────────────────────┤
  │ Blanc   │ Pas encore visité (potentiellement mort)            │
  │ Gris    │ Visité, mais ses enfants pas encore tous visités    │
  │ Noir    │ Visité, tous ses enfants visités (vivant)           │
  └─────────┴────────────────────────────────────────────────────┘
```

L'invariant fondamental du tri-color marking est : **un objet noir ne pointe jamais directement vers un objet blanc**. Si le thread principal modifie un objet noir pour qu'il pointe vers un objet blanc pendant que le marquage concurrent tourne, un **write barrier** intercepte l'écriture et marque l'objet en gris (ou l'objet cible en gris).

```
  Étape 1 : Tous les objets sont BLANCS
  ○ ○ ○ ○ ○ ○ ○ ○     (○ = blanc)

  Étape 2 : Les racines directes passent en GRIS
  ◐ ○ ◐ ○ ○ ○ ○ ○     (◐ = gris)

  Étape 3 : Traiter un objet gris → marquer ses enfants en gris, lui en NOIR
  ● ◐ ● ○ ◐ ○ ○ ○     (● = noir)

  Étape 4 : Continuer jusqu'à vider la liste grise
  ● ● ● ○ ● ○ ○ ○

  Étape 5 (Sweep) : Tous les objets encore BLANCS sont morts → libérés
  ● ● ●   ●           (les blancs sont supprimés)
```

#### 5.2 Mark-Sweep vs Mark-Compact

- **Mark-Sweep** : libère les objets blancs en place → peut créer de la fragmentation.
- **Mark-Compact** : déplace les objets vivants pour les regrouper → élimine la fragmentation, mais plus coûteux (mise à jour de tous les pointeurs).

```
  Mark-Sweep (fragmentation possible) :
  [A][ ][ ][B][ ][C][ ][ ][D]   ← trous entre les objets

  Mark-Compact (compactage) :
  [A][B][C][D][         libre         ]   ← espace contigu
```

V8 combine les deux : Mark-Sweep pour les pages peu fragmentées, Mark-Compact pour les pages très fragmentées. La décision est prise page par page en fonction du taux de fragmentation.

### 6. Marquage incrémental, concurrent et parallèle dans V8

Le GC de V8 (nom de code **Orinoco**) utilise plusieurs stratégies pour réduire les pauses :

```
  ┌───────────────────────────────────────────────────────────────┐
  │                 STRATEGIES DE MARQUAGE V8                     │
  ├───────────────────────────────────────────────────────────────┤
  │                                                               │
  │  Stop-the-world (ancien, V8 pre-2015) :                       │
  │  Thread JS : ████████░░░░░░░░░░░░░░████████████████████████  │
  │  GC        :         ████████████████                         │
  │                       ^^ longue pause (100+ ms)               │
  │                                                               │
  │  Incremental (incremental marking) :                          │
  │  Thread JS : ████░██░████░██░████░██████████████████████████  │
  │  GC        :     █  █    █  █    █                            │
  │              petites tranches (~5ms) intercalées avec le JS   │
  │                                                               │
  │  Concurrent (concurrent marking) :                            │
  │  Thread JS : ████████████████████████████████████████████████ │
  │  GC Thread :   ████████████████████████                       │
  │              marquage sur un thread séparé pendant que le      │
  │              JS continue de s'exécuter                        │
  │                                                               │
  │  Parallèle (parallel scavenging / compaction) :               │
  │  Thread JS : ████████░░░░░░░████████████████████████████████  │
  │  GC Thr 1  :         ██████                                   │
  │  GC Thr 2  :         ██████                                   │
  │  GC Thr 3  :         ██████                                   │
  │              pause courte mais avec N threads GC en parallèle  │
  └───────────────────────────────────────────────────────────────┘
```

**Orinoco** combine les trois :
1. Le marquage démarre de façon **concurrente** (thread GC séparé) pendant que le JS s'exécute.
2. Le thread principal aide périodiquement de façon **incrémentale** quand il est idle.
3. À la fin, une courte pause de **finalisation** se produit pour traiter les derniers objets gris.
4. La phase de compaction et le scavenging sont **parallèles** (N threads GC en même temps).
5. Le sweeping est **concurrent** (thread séparé, aucune pause).

Résultat : les pauses GC en V8 sont typiquement < 1-2 ms pour le Minor GC et < 5-10 ms pour le Major GC sur des tas de taille raisonnable.

### 7. Pauses GC et impact sur la latence

```
  Requête HTTP typique avec pause GC :

  ┌──────┐  ┌──────────┐  ┌────────┐  ┌──────┐
  │ Recv │→ │ Process   │→ │GC PAUSE│→ │ Send │
  │ 1ms  │  │ 5ms       │  │ 15ms   │  │ 1ms  │
  └──────┘  └──────────┘  └────────┘  └──────┘

  Temps total = 22 ms au lieu de 7 ms sans la pause.
  Percentile P99 dégradé par les pauses GC sporadiques.
```

```
  Impact des pauses GC sur les percentiles :

  Latence (ms)
  60 │                                          ×  ← GC Major
  50 │                               ×
  40 │                    ×
  30 │          ×
  20 │    ×  ×
  10 │ ×  ×  ×  ×  ×  ×  ×  ×  ×
   5 │ ×  ×  ×  ×  ×  ×  ×  ×  ×  ×  ×  ×
     └──────────────────────────────────────
      P50            P95      P99    P99.9

  Les pauses GC créent une "longue traîne" de latence.
```

Bonnes pratiques pour réduire l'impact :
- Réduire le taux d'allocation (moins d'objets temporaires).
- Pré-allouer les buffers pour les opérations fréquentes.
- Réutiliser les objets (object pooling) dans les hot paths.
- Surveiller les pauses avec `--trace-gc`.
- Ajuster `--max-old-space-size` et `--max-semi-space-size`.

### 8. `--expose-gc` et `global.gc()`

V8 ne permet pas de déclencher le GC depuis JS par défaut. Le flag `--expose-gc` expose la fonction `global.gc()`.

```js
// Lancer avec : node --expose-gc script.js

// Forcer un GC complet (Major GC)
global.gc();

// Forcer un Minor GC uniquement
global.gc({ type: 'minor' });

// Vérifier la mémoire avant/après
const before = process.memoryUsage().heapUsed;
global.gc();
const after = process.memoryUsage().heapUsed;
console.log(`Libéré : ${((before - after) / 1024 / 1024).toFixed(2)} Mo`);
```

**Attention** : ne jamais utiliser `global.gc()` en production. C'est un outil de diagnostic uniquement. Forcer le GC provoque une pause complète et synchrone.

Pour le diagnostic en production, préférez `v8.writeHeapSnapshot()` qui génère un fichier `.heapsnapshot` analysable dans Chrome DevTools sans nécessiter le flag `--expose-gc` :

```js
const v8 = require('v8');
// Génère un heap snapshot dans le répertoire courant
const filename = v8.writeHeapSnapshot();
console.log(`Heap snapshot écrit : ${filename}`);
```

### 9. WeakRef et FinalizationRegistry (ES2021)

#### 9.1 WeakRef

Une `WeakRef` permet de garder une référence vers un objet **sans empêcher sa collecte** par le GC.

```js
let obj = { data: 'important' };
const weakRef = new WeakRef(obj);

// Accéder à l'objet (peut retourner undefined si collecté)
const deref = weakRef.deref();
if (deref) {
  console.log(deref.data); // 'important'
}

// Si on supprime la seule référence forte :
obj = null;
// À un moment futur (non déterministe), weakRef.deref() retournera undefined
```

Différence fondamentale avec WeakMap/WeakSet :
- `WeakMap`/`WeakSet` : les **clés** sont faibles (l'objet-clé peut être collecté).
- `WeakRef` : la **valeur référencée** elle-même peut être collectée.

#### 9.2 FinalizationRegistry

Permet d'enregistrer un callback exécuté quand un objet est collecté.

```js
const registry = new FinalizationRegistry((heldValue) => {
  console.log(`Objet collecté, valeur associée : ${heldValue}`);
  // Nettoyer des ressources externes ici (fichier, socket, handle natif)
});

let target = { name: 'cible' };
registry.register(target, 'ma-cible-id');

target = null;
// Après un GC, le callback sera appelé avec 'ma-cible-id'
```

**Avertissements** :
- Les callbacks de finalisation ne sont **pas garantis** d'être appelés (le programme peut se terminer avant).
- Le timing est non déterministe.
- Ne jamais utiliser pour de la logique critique ou du nettoyage indispensable.
- Cas d'usage valide : nettoyage de ressources externes en "dernier recours" (handles natifs via N-API, par exemple).

### 10. Orinoco : l'architecture GC de V8

Orinoco est le nom de code donné à l'ensemble des améliorations du GC de V8 depuis 2015-2016 :

```
  ┌──────────────────┬────────────────────────────────────────────┐
  │ Composant        │ Rôle                                       │
  ├──────────────────┼────────────────────────────────────────────┤
  │ Parallel         │ Minor GC (Scavenger) sur N threads         │
  │ Scavenger        │ en même temps → pause très courte          │
  ├──────────────────┼────────────────────────────────────────────┤
  │ Concurrent       │ Marquage de l'Old Gen sans bloquer         │
  │ Marking          │ le thread JS principal                     │
  ├──────────────────┼────────────────────────────────────────────┤
  │ Incremental      │ Marquage par petites étapes sur le         │
  │ Marking          │ thread principal (entre les tâches JS)     │
  ├──────────────────┼────────────────────────────────────────────┤
  │ Concurrent       │ Libération de mémoire sur un thread        │
  │ Sweeping         │ séparé, sans aucune pause                  │
  ├──────────────────┼────────────────────────────────────────────┤
  │ Lazy Sweeping    │ Balayage différé page par page, seulement  │
  │                  │ quand la page est nécessaire                │
  ├──────────────────┼────────────────────────────────────────────┤
  │ Parallel         │ Compactage des pages fragmentées sur N     │
  │ Compaction       │ threads en parallèle                       │
  └──────────────────┴────────────────────────────────────────────┘
```

```
  ┌─────────────────────────────────────────────────┐
  │               ORINOCO (V8 GC)                   │
  │                                                 │
  │  ┌──────────────┐    ┌────────────────────────┐ │
  │  │  Scavenger   │    │  Major GC              │ │
  │  │  (Young Gen) │    │  (Old Gen)             │ │
  │  │  - parallel  │    │  - concurrent marking  │ │
  │  │  - copying   │    │  - incremental marking │ │
  │  │  - ~1ms      │    │  - parallel compaction │ │
  │  │              │    │  - concurrent sweeping │ │
  │  │              │    │  - ~5-10ms pause       │ │
  │  └──────────────┘    └────────────────────────┘ │
  │                                                 │
  │  Write Barrier : intercepte les écritures dans  │
  │  les objets noirs vers des objets blancs pendant│
  │  le marquage concurrent (maintient l'invariant  │
  │  tri-color).                                    │
  │                                                 │
  │  Remembered Set : ensemble des pointeurs de     │
  │  l'Old Gen vers la Young Gen, pour éviter de    │
  │  scanner toute l'Old Gen lors du Minor GC.      │
  └─────────────────────────────────────────────────┘
```

### 11. Quand le GC s'exécute-t-il ?

Le GC est **non déterministe**. V8 utilise des heuristiques :

- **Minor GC** : quand le from-space de la Young Generation est plein (~1-8 Mo selon la config).
- **Major GC** : quand l'Old Generation dépasse un seuil dynamique (ajusté après chaque cycle).
- **Idle-time GC** : pendant les périodes d'inactivité (idle tasks) du navigateur — utilise `requestIdleCallback` internement.
- **Allocation failure** : quand une allocation échoue par manque d'espace.
- **Pression mémoire externe** : quand l'OS signale une pression mémoire.

---

## Démonstration

### Demo 1 : Observer le GC avec `--trace-gc`

```js
// demo-trace-gc.js
// Lancer : node --trace-gc demo-trace-gc.js

const objects = [];

function allocateObjects(count) {
  for (let i = 0; i < count; i++) {
    objects.push({
      index: i,
      data: new Array(100).fill(`item-${i}`),
      timestamp: Date.now(),
    });
  }
}

function releaseOldObjects(keepLast) {
  if (objects.length > keepLast) {
    objects.splice(0, objects.length - keepLast);
  }
}

console.log('--- Phase 1 : Allocation massive ---');
allocateObjects(100000);

console.log('\n--- Phase 2 : Libération partielle ---');
releaseOldObjects(1000);

console.log('\n--- Phase 3 : Nouvelle allocation ---');
allocateObjects(50000);

console.log('\n--- Phase 4 : Libération totale ---');
objects.length = 0;

// Avec --trace-gc, vous verrez des lignes comme :
//
// [12345:0x7f...]   12 ms: Scavenge 4.2 (8.0) -> 3.1 (8.0) MB, 0.8 / 0.0 ms ...
// [12345:0x7f...]   45 ms: Mark-Compact 15.3 (20.0) -> 8.7 (18.0) MB, 5.2 / 0.0 ms
//
// Format : [PID:isolate] temps_depuis_start: Type avant (total) -> après (total) MB, durée ms
//
// "Scavenge"     = Minor GC (Young Generation)
// "Mark-Compact" = Major GC (Old Generation)
```

### Demo 2 : Mesurer les pauses GC avec PerformanceObserver

```js
// demo-gc-pauses.js
// Lancer : node --expose-gc demo-gc-pauses.js

const { PerformanceObserver } = require('perf_hooks');

// Observer les événements GC via l'API PerformanceObserver
const gcEvents = [];
const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    const kindNames = {
      0: 'Major (Mark-Compact)',
      1: 'Minor (Scavenge)',
      2: 'Incremental',
      4: 'Weak Callbacks',
    };
    const kind = kindNames[entry.detail?.kind] ?? `Unknown(${entry.detail?.kind})`;
    const info = {
      kind,
      duration: entry.duration.toFixed(3),
    };
    gcEvents.push(info);
    console.log(`  GC ${kind} | durée: ${info.duration} ms`);
  }
});
obs.observe({ entryTypes: ['gc'] });

// Provoquer des allocations
function provokeGC() {
  const arrays = [];
  for (let i = 0; i < 50000; i++) {
    arrays.push(new Array(200).fill(Math.random()));
  }
  return arrays.length; // empêcher l'optimisation dead-code
}

console.log('=== Allocation en cours... ===');
provokeGC();

console.log('\n=== Forcer un Major GC : ===');
global.gc();

console.log('\n=== Forcer un Minor GC : ===');
global.gc({ type: 'minor' });

setTimeout(() => {
  obs.disconnect();
  console.log('\n=== Résumé ===');
  console.log(`Total événements GC capturés : ${gcEvents.length}`);

  const majors = gcEvents.filter((e) => e.kind.includes('Major'));
  const minors = gcEvents.filter((e) => e.kind.includes('Minor'));
  console.log(`  Major GC : ${majors.length}`);
  console.log(`  Minor GC : ${minors.length}`);
}, 500);
```

### Demo 3 : Comportement de WeakRef et FinalizationRegistry

```js
// demo-weakref.js
// Lancer : node --expose-gc demo-weakref.js

class WeakCache {
  #entries = new Map();
  #registry;

  constructor() {
    this.#registry = new FinalizationRegistry((key) => {
      console.log(`  [FinalizationRegistry] Objet pour clé "${key}" collecté.`);
      this.#entries.delete(key);
    });
  }

  set(key, value) {
    const ref = new WeakRef(value);
    this.#entries.set(key, ref);
    this.#registry.register(value, key);
    console.log(`  Cache.set("${key}") — objet stocké via WeakRef`);
  }

  get(key) {
    const ref = this.#entries.get(key);
    if (!ref) return undefined;
    const obj = ref.deref();
    if (obj === undefined) {
      console.log(`  Cache.get("${key}") — objet déjà collecté !`);
      this.#entries.delete(key);
      return undefined;
    }
    return obj;
  }

  get size() {
    return this.#entries.size;
  }
}

const cache = new WeakCache();

// Créer des objets et les mettre en cache
let userData = { id: 1, name: 'Alice', payload: new Array(10000).fill('x') };
let sessionData = { id: 2, name: 'Bob', payload: new Array(10000).fill('y') };

cache.set('user', userData);
cache.set('session', sessionData);

console.log(`\nTaille du cache : ${cache.size}`);
console.log(`user: ${cache.get('user')?.name}`);       // Alice
console.log(`session: ${cache.get('session')?.name}`);  // Bob

// Supprimer la référence forte vers userData
console.log('\n--- Suppression de la référence forte vers userData ---');
userData = null;

// Forcer le GC et attendre que le FinalizationRegistry s'exécute
global.gc();

setTimeout(() => {
  global.gc();
  setTimeout(() => {
    console.log(`\nTaille du cache : ${cache.size}`);
    console.log(`user: ${cache.get('user')}`);            // undefined (collecte)
    console.log(`session: ${cache.get('session')?.name}`); // Bob (toujours en vie)
  }, 100);
}, 100);
```

### Demo 4 : Comparer allocation éphémère vs réutilisation de buffer

```js
// demo-alloc-pressure.js
// Lancer : node --expose-gc --trace-gc demo-alloc-pressure.js
//
// Observez le nombre d'événements GC dans chaque approche.

function withEphemeralAllocation(iterations) {
  let total = 0;
  const start = process.hrtime.bigint();

  for (let i = 0; i < iterations; i++) {
    // Nouvel objet à chaque itération → forte pression d'allocation
    const point = { x: Math.random(), y: Math.random() };
    total += point.x + point.y;
  }

  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  return { total, elapsed };
}

function withBufferReuse(iterations) {
  let total = 0;
  const start = process.hrtime.bigint();

  // Un seul objet réutilisé → zéro allocation dans la boucle
  const point = { x: 0, y: 0 };

  for (let i = 0; i < iterations; i++) {
    point.x = Math.random();
    point.y = Math.random();
    total += point.x + point.y;
  }

  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  return { total, elapsed };
}

const N = 5_000_000;

global.gc();
console.log('\n=== Allocation éphémère (nouvel objet par itération) ===');
const r1 = withEphemeralAllocation(N);
console.log(`Temps : ${r1.elapsed.toFixed(1)} ms\n`);

global.gc();
console.log('=== Réutilisation de buffer (un seul objet) ===');
const r2 = withBufferReuse(N);
console.log(`Temps : ${r2.elapsed.toFixed(1)} ms\n`);

console.log(`Gain : ${((1 - r2.elapsed / r1.elapsed) * 100).toFixed(1)}% plus rapide`);
console.log('Comptez le nombre de "Scavenge" dans les logs --trace-gc pour chaque phase.');
```

### Demo 5 : Explorer les espaces mémoire du heap V8

```js
// demo-heap-spaces.js
// Lancer : node --expose-gc demo-heap-spaces.js

const v8 = require('v8');

function printHeapSpaces(label) {
  const spaces = v8.getHeapSpaceStatistics();
  console.log(`\n  [${label}]`);
  console.log('  ' + '-'.repeat(72));
  console.log(
    '  ' +
      'Espace'.padEnd(25) +
      'Utilisé'.padStart(12) +
      'Disponible'.padStart(14) +
      'Taille'.padStart(14)
  );
  console.log('  ' + '-'.repeat(72));

  for (const space of spaces) {
    const used = (space.space_used_size / 1024 / 1024).toFixed(2) + ' Mo';
    const avail = (space.space_available_size / 1024 / 1024).toFixed(2) + ' Mo';
    const size = (space.space_size / 1024 / 1024).toFixed(2) + ' Mo';
    console.log(
      '  ' +
        space.space_name.padEnd(25) +
        used.padStart(12) +
        avail.padStart(14) +
        size.padStart(14)
    );
  }
}

console.log('=== État initial ===');
global.gc();
printHeapSpaces('Initial');

console.log('\n=== Après allocation de 100 000 objets ===');
const data = [];
for (let i = 0; i < 100000; i++) {
  data.push({ id: i, value: `item-${i}`, nested: { a: i, b: i * 2 } });
}
printHeapSpaces('100k objets alloués');

console.log('\n=== Après GC (objets toujours référencés → promus en Old Space) ===');
global.gc();
printHeapSpaces('Après GC, objets vivants');

console.log('\n=== Après libération et GC ===');
data.length = 0;
global.gc();
printHeapSpaces('Après libération');

// Observez : new_space diminue, old_space augmente après la promotion.
// Après libération + GC, old_space diminue.
```

---

### V8 vs SpiderMonkey (Firefox) vs JavaScriptCore (Safari)

> 📋 **Rappel** : Tous les moteurs JS modernes utilisent un GC automatique basé sur le mark-and-sweep. Les algorithmes fondamentaux sont les mêmes — seuls les noms, les paramètres et les stratégies d'optimisation diffèrent.

Le garbage collection n'est **pas** défini par la spécification ECMAScript (la spec dit seulement que la mémoire est gérée automatiquement). Chaque moteur est donc libre d'implémenter sa propre stratégie. Malgré cela, les trois grands moteurs ont convergé vers des approches très similaires.

**Comparaison des architectures GC** :

| Aspect | V8 (Chrome/Node.js) | SpiderMonkey (Firefox) | JavaScriptCore (Safari/Bun) |
|--------|---------------------|------------------------|-----------------------------|
| **Nom de code** | **Orinoco** | Pas de nom de code officiel | **Riptide** |
| **Type** | Générationnel | Générationnel | **Non générationnel**, concurrent |
| **Young Gen** | New Space (semi-space, Scavenger) | **Nursery** (bump allocation) | N/A (pas de séparation générationnelle classique) |
| **Old Gen** | Old Space (Mark-Sweep-Compact) | **Tenured** (Mark-Sweep) | Heap unique avec marquage concurrent |
| **Marquage** | Tri-color, incrémental + concurrent | Tri-color, **incrémental par « slices »** | Concurrent (thread séparé) |
| **Compaction** | Parallèle (N threads) | Compaction incrémentale | Compaction concurrente |
| **Sweeping** | Concurrent (thread séparé) | Concurrent / incrémental | Concurrent |

**SpiderMonkey en détail** :

- **Nursery** (équivalent de la Young Generation) : SpiderMonkey utilise une allocation par **bump pointer** dans la Nursery — c'est extrêmement rapide (un simple incrément de pointeur). Quand la Nursery est pleine, un Minor GC copie les objets survivants vers l'espace Tenured, comme le Scavenger de V8.
- **Tenured** (équivalent de l'Old Generation) : les objets promus y vivent. Le Major GC utilise un marquage incrémental découpé en **« slices »** (tranches) de quelques millisecondes, intercalées avec l'exécution JavaScript. Cela réduit les pauses perceptibles.
- **GC incrémental par slices** : au lieu d'une longue pause, SpiderMonkey découpe le marquage en petites tranches (~5ms). Entre chaque tranche, le code JS s'exécute normalement. C'est conceptuellement similaire au marquage incrémental de V8 (Orinoco), mais l'implémentation et le scheduling des slices diffèrent.

**JavaScriptCore (Riptide)** :

- **Riptide** est le GC de JavaScriptCore (moteur JS de Safari, également utilisé par Bun). Contrairement à V8 et SpiderMonkey, Riptide est **non générationnel** dans sa conception classique — il ne divise pas le heap en Young/Old de la même manière.
- Riptide utilise un **marquage concurrent** : le marquage se fait sur un thread séparé pendant que le code JS s'exécute, avec des barrières d'écriture pour maintenir la cohérence.
- L'approche de Riptide est adaptée aux contraintes de Safari (appareils mobiles avec peu de mémoire).

**Observer le GC selon le moteur** :

| Outil | V8 (Chrome/Node.js) | SpiderMonkey (Firefox) | JavaScriptCore |
|-------|---------------------|------------------------|----------------|
| Forcer un GC | `--expose-gc` + `global.gc()` | N/A depuis JS (accès via DevTools) | N/A depuis JS |
| Tracer le GC | `node --trace-gc` | `about:config` → `javascript.options.mem.log` | Instruments (macOS) |
| Heap snapshot | Chrome DevTools Memory tab / `v8.writeHeapSnapshot()` | **Firefox DevTools → onglet Mémoire** (snapshot, allocation tracking) | Safari Web Inspector → Timelines |
| Pauses GC | `PerformanceObserver` (`entryTypes: ['gc']`) | Firefox Performance tab (markers GC) | Safari Timelines |

> **Important** : `--expose-gc` et `global.gc()` sont spécifiques à V8/Node.js. Il n'y a pas d'équivalent en ligne de commande pour SpiderMonkey depuis du code JS. Pour observer le GC dans Firefox, utilise l'**onglet Mémoire** des DevTools Firefox, qui offre des snapshots, du suivi d'allocation et des arbres de domination.

**Conclusion** : tous les moteurs modernes utilisent un GC générationnel (ou quasi-générationnel) avec des stratégies concurrentes et incrémentales pour minimiser les pauses. Les concepts fondamentaux (mark-and-sweep, tri-color marking, write barriers) sont partagés. Les différences portent sur les noms (Nursery vs New Space), les paramètres de tuning et les stratégies de scheduling des pauses. En tant que développeur, les bonnes pratiques pour réduire la pression GC (réduire les allocations temporaires, réutiliser les objets, éviter les fuites mémoire) s'appliquent à **tous** les moteurs.

---

## Points clés

1. Le GC libère automatiquement la mémoire des objets inaccessibles depuis les racines GC.
2. Le **reference counting** est simple mais ne gère pas les cycles ; le **mark-and-sweep** les gère. Les moteurs modernes (V8, SpiderMonkey, JSC) n'utilisent pas le reference counting.
3. V8 utilise un GC **générationnel** : Young Generation (Minor GC / Scavenger) et Old Generation (Major GC / Mark-Compact).
4. La Young Generation utilise un **semi-space** (from/to) avec l'algorithme de **Cheney** : seuls les objets vivants sont copiés.
5. L'Old Generation utilise le **tri-color marking** (blanc/gris/noir) pour un marquage sûr et incrémental/concurrent.
6. **Orinoco** est le nom de l'architecture GC de V8, combinant marquage concurrent, incrémental et compaction parallèle.
7. Les pauses GC impactent directement la latence (P99) — réduire la pression d'allocation est la meilleure optimisation.
8. Le **write barrier** maintient l'invariant tri-color lors du marquage concurrent.
9. `--trace-gc` et `PerformanceObserver` avec `entryTypes: ['gc']` permettent d'observer le GC en temps réel.
10. `WeakRef` et `FinalizationRegistry` permettent de référencer un objet sans empêcher sa collecte, mais leur comportement est non déterministe.
11. Les objets dépassant un seuil de taille sont alloués dans le **Large Object Space** (LOS) et contournent la Young Generation.
12. `v8.writeHeapSnapshot()` permet de générer un heap snapshot en production pour le diagnostic mémoire.

---

## Lab associé

**Lab 07 — Analyse du comportement GC et WeakRef Cache**

Fichier : `labs/lab-07-gc-analysis/`

1. Écrire un programme qui alloue des objets en boucle et observer `--trace-gc`.
2. Identifier les Scavenge (Minor) vs Mark-Compact (Major) dans les logs.
3. Mesurer l'impact de `--max-semi-space-size` sur la fréquence du Minor GC.
4. Construire un cache LRU (Least Recently Used) qui combine `Map` pour les entrées actives et `WeakRef` + `FinalizationRegistry` pour les entrées évincées.
5. Mesurer la consommation mémoire avec `process.memoryUsage()` et vérifier que les entrées évincées sont bien collectées par le GC.
6. Comparer les performances d'un object pool vs allocation éphémère dans une boucle chaude.

---

## Pour aller plus loin

- [V8 Blog — Trash talk: the Orinoco garbage collector](https://v8.dev/blog/trash-talk)
- [V8 Blog — Concurrent marking in V8](https://v8.dev/blog/concurrent-marking)
- [V8 Blog — Getting garbage collection for free](https://v8.dev/blog/free-garbage-collection)
- [V8 Blog — Jank Busters: building a better GC](https://v8.dev/blog/jank-busters)
- [MDN — Gestion de la mémoire](https://developer.mozilla.org/fr/docs/Web/JavaScript/Memory_management)
- [MDN — WeakRef](https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Global_Objects/WeakRef)
- [MDN — FinalizationRegistry](https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry)
- [TC39 — WeakRefs Proposal](https://github.com/tc39/proposal-weakrefs)
- [Chromium Design Doc — Orinoco GC](https://docs.google.com/document/d/1kMR0sVCp2yQMGANzmjEGJKP69cnVMJRJ6qace0vMNDo)

---

## Défi

Considérez le code suivant :

```js
// node --expose-gc defi.js
const registry = new FinalizationRegistry((id) => {
  console.log(`Finalized: ${id}`);
});

function createLeaky() {
  const big = new Array(1_000_000).fill(42);
  const obj = { data: 'hello' };
  registry.register(obj, 'obj-1');

  return function () {
    return obj.data;  // la closure capture `obj`
  };
}

const fn = createLeaky();
// Question 1 : `big` sera-t-il collecté par le GC ?
// Question 2 : `obj` sera-t-il collecté ? Sous quelles conditions ?
// Question 3 : le callback du FinalizationRegistry sera-t-il appelé ? Quand ?
```

<details>
<summary>Réponse</summary>

**`big` sera collecté** : bien que `big` soit dans le même scope que la closure retournée, les moteurs modernes (V8, SpiderMonkey) effectuent une **analyse des variables capturées** (context analysis). La closure retournée ne capture que `obj`, pas `big`. Donc `big` n'est pas référencé après le retour de `createLeaky()` et sera collecté lors du prochain GC.

On peut le vérifier avec `--trace-gc` : après un `global.gc()`, la mémoire occupée par le tableau de 1M éléments est libérée.

**`obj` ne sera PAS collecté** tant que `fn` est vivant : la closure retournée capture `obj` via la référence `obj.data`. Tant que `fn` est accessible depuis une racine GC, `obj` l'est aussi via la chaîne : racine → `fn` → closure context → `obj`.

**Le callback du FinalizationRegistry** ne sera appelé que si :
1. `fn` est mis à `null` (ou sort du scope), ce qui rend `obj` inaccessible.
2. Un GC se produit ensuite et collecte `obj`.
3. Le programme ne se termine pas avant que le callback ait eu l'occasion de s'exécuter.

Les callbacks de `FinalizationRegistry` sont planifiés dans la microtask queue, mais leur exécution n'est pas garantie si le programme se termine avant.

**Note** : si on avait écrit `return function() { return big.length + obj.data; }`, alors `big` serait aussi capturé et ne serait pas collecté. Mais ici, seul `obj` est référencé dans le corps de la closure.

</details>
