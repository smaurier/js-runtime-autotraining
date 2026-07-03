# Module 15 — Session de debugging réelle

> **Objectif** : Apprendre à diagnostiquer et corriger un problème de performance JavaScript en conditions réelles, de la détection au fix vérifié.

> **Difficulté** : ⭐⭐⭐⭐⭐ (Synthèse) — Le module capstone. Tu mobilises tout ce que tu as appris.

> **Analogie pour débuter** : Ce module, c'est comme passer ton examen final de médecine : on te présente un « patient » (un programme lent ou qui fuit), et tu dois poser un diagnostic avec les bons outils (profiler, heap snapshot, traces V8), identifier la cause, prescrire un traitement (fix), et vérifier la guérison (mesure avant/après).

---

## Prérequis

Ce module synthétise les connaissances de la seconde moitié du cours :

| Module | Connaissances mobilisées |
|--------|--------------------------|
| 07 — Garbage Collector | Mécanismes du GC générationnel, Scavenge, Mark-Compact |
| 08 — Memory Leaks | Patterns de fuite mémoire, heap snapshots |
| 09 — V8 Engine Architecture | Pipeline Ignition/TurboFan, déoptimisations |
| 10 — JIT Compilation & Optimization | Compilation tiered, feedback vectors |
| 11 — Hidden Classes & Inline Caching | Formes d'objets, IC mono/poly/mégamorphique |
| 12 — Performance Patterns | Profiling, anti-patterns, outils V8 |
| 13 — Scheduling & Concurrence | Workers, event loop, time slicing |
| 14 — Projet Final | Intégration des connaissances |

---

## Théorie

### 1. La méthodologie de diagnostic

L'erreur la plus fréquente face à un problème de performance est de deviner
la cause et d'appliquer une "optimisation" au hasard. Le cerveau humain est
un très mauvais profileur. La seule approche fiable est méthodique.

#### Le processus en 5 étapes

```
  OBSERVER  -->  MESURER  -->  HYPOTHÈSE  -->  CORRIGER  -->  VÉRIFIER
     |              |              |               |              |
     v              v              v               v              v
  "Quelque       Profiling,     Formuler       Appliquer      Mesurer à
   chose est     métriques,     une cause      UNE seule      nouveau.
   lent/qui      traces GC,     précise        correction     Le problème
   consomme"     heap snap.     et testable    ciblée         a disparu ?
                                                                  |
                                                          oui /     \ non
                                                             v       v
                                                        Documenter  Revenir
                                                        & commiter  à l'étape 2
```

**Règle fondamentale** : ne jamais sauter directement à l'étape "Corriger".
Chaque correction doit être précédée d'une preuve mesurable du problème et
suivie d'une preuve mesurable de l'amélioration.

#### Arbre de décision : quel outil pour quel symptôme ?

```
  Symptôme observé
  ==================

  "Mon app est lente globalement"
      |
      +--> node --cpu-prof app.js
      |    Ouvrir le .cpuprofile dans Chrome DevTools > Performance
      |    Lire le flame chart, identifier le hotspot (Bottom-Up)
      |
      +--> Chrome DevTools > Performance tab (pour le navigateur)

  "La mémoire monte sans cesse"
      |
      +--> node --heap-prof app.js
      |    Ouvrir le .heapprofile dans Chrome DevTools > Memory
      |
      +--> Heap Snapshots (3 snapshots : avant, pendant, après charge)
      |    Comparer "Objects allocated between Snapshot 1 and 2"
      |    non libérés dans Snapshot 3
      |
      +--> process.memoryUsage() en monitoring continu

  "Mon API a des spikes de latence"
      |
      +--> node --trace-gc app.js
      |    Chercher les pauses Mark-Compact > 50ms
      |
      +--> PerformanceObserver avec entryTypes: ['gc']
      |    Corréler les pauses GC avec les spikes de latence

  "Une fonction spécifique est lente"
      |
      +--> node --trace-opt --trace-deopt app.js
      |    Chercher les déoptimisations répétées de la fonction
      |
      +--> node --print-bytecode --print-bytecode-filter=nomFonction app.js
      |    Analyser le bytecode Ignition généré

  "Mes objets/propriétés sont lents"
      |
      +--> node --trace-ic app.js
      |    Chercher les sites MEGAMORPHIC
      |
      +--> node --allow-natives-syntax
           %DebugPrint(obj) pour inspecter la hidden class
           %HaveSameMap(obj1, obj2) pour vérifier que deux objets
           partagent la même forme
```

### 2. Comment lire la spec ECMAScript (sidebar)

La spécification ECMA-262 est le document de référence qui définit le
comportement exact de JavaScript. Savoir la lire est une compétence
fondamentale pour comprendre les internals du langage. C'est un manque
important dans la formation d'un développeur JavaScript avancé.

#### Navigation dans ECMA-262

La spec est organisée en clauses numérotées. Les plus utiles :

```
  Structure de ECMA-262 (tc39.es/ecma262)
  =========================================

  Clause 5   : Conventions de notation
  Clause 6   : Types du langage (Undefined, Null, Boolean, String,
                Symbol, Number, BigInt, Object)
  Clause 7   : Opérations abstraites (moteur interne)
  Clause 8   : Environnements d'exécution, Realms
  Clause 9   : Objets ordinaires et exotiques
  Clause 10  : Code source et mode strict
  Clause 13  : Expressions
  Clause 14  : Statements
  Clause 22  : Objets structurés (Array, Map, Set, etc.)
  Clause 25  : Control Abstraction (Promise, GeneratorFunction)
  Clause 27  : Mémoire (SharedArrayBuffer, Atomics)
```

#### Conventions de notation

```
  Notation de la spec         Signification
  =======================     ============================================
  ? OperationName(args)       Appeler l'opération ; si elle retourne un
                               abrupt completion (throw), propager l'erreur

  ! OperationName(args)       Appeler l'opération ; on GARANTIT qu'elle
                               ne lance jamais d'erreur

  Let x be ...                Déclaration de variable locale dans
                               l'algorithme

  Return x                    Valeur de retour de l'opération abstraite

  Assert: condition           Invariant qui doit être vrai ; si faux,
                               c'est un bug dans la spec elle-même

  Type(x)                     Retourne le type du langage de x
                               (Undefined, Null, Boolean, String, etc.)

  Completion Record           Triplet { [[Type]], [[Value]], [[Target]] }
  { [[Type]]: normal,         Type = normal, return, throw, break, continue
    [[Value]]: value }
```

#### Exemple : tracer Promise.resolve(thenable)

Suivons l'exécution de `Promise.resolve(thenable)` dans la spec
(clause 25.6.4.5 — Promise.resolve).

```
  Promise.resolve(x)  — Spec Walkthrough
  ========================================

  1. Let C be the this value.
     --> C = Promise (le constructeur)

  2. If Type(C) is not Object, throw a TypeError.
     --> Promise est un objet, OK

  3. Return ? PromiseResolve(C, x).
     --> On délègue à l'opération abstraite PromiseResolve

  PromiseResolve(C, x)  (clause 25.6.4.5.1)
  ============================================

  1. If IsPromise(x) is true:
     a. Let xConstructor be ? Get(x, "constructor").
     b. If SameValue(xConstructor, C) is true, return x.
        --> Si x est déjà une Promise du même constructeur, on la retourne
        --> C'est pourquoi Promise.resolve(existingPromise) === existingPromise

  2. Let promiseCapability be ? NewPromiseCapability(C).
     --> Crée une nouvelle Promise avec ses resolve/reject internes

  3. Perform ? Call(promiseCapability.[[Resolve]], undefined, << x >>).
     --> Appelle la fonction resolve interne avec x comme argument

  4. Return promiseCapability.[[Promise]].

  Si x est un thenable (objet avec méthode .then) :
  =================================================

  La fonction resolve interne (Promise Resolve Functions, 25.6.1.3.2) fait :

  6. If Type(resolution) is not Object, fulfill avec resolution.

  7. Let then be ? Get(resolution, "then").
     --> On lit la propriété .then du thenable

  8. If IsCallable(then) is false, fulfill avec resolution.

  9. Let thenAction be then.
  10. Let job be NewPromiseResolveThenableJob(promise, resolution, thenAction).
  11. Perform HostEnqueuePromiseJob(job, ...).
      --> CRUCIAL : le .then() du thenable est appelé dans un MICRO-JOB
      --> C'est pourquoi Promise.resolve(thenable) est toujours ASYNCHRONE
      --> même si thenable.then() appelle resolve() immédiatement
```

Ce walkthrough révèle un comportement subtil : `Promise.resolve(thenable)`
crée toujours une microtask supplémentaire, contrairement à
`Promise.resolve(42)` qui est synchrone. C'est une source fréquente de
bugs de timing dans les tests.

### 3. Cas 1 — Memory leak en production

#### Le contexte

```
  Application : API Express qui reçoit des webhooks
  Stack : Node.js 20, Express 4, process derrière un reverse proxy
  Environnement : conteneur Docker, 2 Go de RAM alloués
  Symptôme : le heap passe de 100 Mo à 1 Go en 24h
             OOM kill par le conteneur toutes les nuits
```

#### Étape 1 : Observer — Confirmer le symptôme

Ajouter un endpoint de monitoring :

```typescript
// monitoring.mjs
import { performance } from 'node:perf_hooks';

const startTime = Date.now();

export function getMemoryStats(): Record<string, string | number> {
  const mem: NodeJS.MemoryUsage = process.memoryUsage();
  return {
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
    heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(2),
    rssMB: (mem.rss / 1024 / 1024).toFixed(2),
    externalMB: (mem.external / 1024 / 1024).toFixed(2),
  };
}

// Endpoint Express :
// app.get('/_health', (req, res) => res.json(getMemoryStats()));
```

Résultats observés sur 24 heures :

```
  Heure    heapUsed    heapTotal    RSS
  ======   =========   =========   ======
  00:00      98 Mo       140 Mo    180 Mo    (démarrage)
  04:00     280 Mo       320 Mo    400 Mo
  08:00     510 Mo       580 Mo    650 Mo
  12:00     720 Mo       800 Mo    870 Mo
  16:00     890 Mo       950 Mo   1020 Mo
  20:00    1050 Mo      1100 Mo   1200 Mo    --> OOM kill imminent
  ~22:30   Killed (OOMKilled, exit code 137)
```

Le heap croît de manière linéaire : ~40 Mo/heure. Ce n'est PAS un pattern
de consommation temporaire — c'est une fuite mémoire.

#### Étape 2 : Mesurer — Heap Snapshots

On prend 3 heap snapshots via Chrome DevTools (connecté a Node avec
`node --inspect app.js`) :

```
  Snapshot 1 : immédiatement après démarrage (baseline)
  Snapshot 2 : après 1 000 requêtes webhook
  Snapshot 3 : après 5 000 requêtes webhook
```

Pour prendre un snapshot programmatiquement :

```typescript
import { writeHeapSnapshot } from 'node:v8';

// Prendre un snapshot à la demande
app.get('/_heapdump', (req: unknown, res: { json: (body: unknown) => void }) => {
  const filename: string = writeHeapSnapshot();
  res.json({ filename });
});
```

#### Étape 3 : Analyser — Comparer les snapshots

Dans Chrome DevTools > Memory, on sélectionne Snapshot 3 et on choisit
"Objects allocated between Snapshot 1 and Snapshot 2" :

```
  Heap Snapshot Comparison (Snapshot 3 vs Snapshot 1)
  =====================================================

  Constructor          | # New  | # Deleted | # Delta | Size Delta
  ---------------------|--------|-----------|---------|------------
  (string)             | 52340  | 12100     | +40240  | +3.2 Mo
  Object               | 28500  | 8200      | +20300  | +1.8 Mo
  (array)              | 15200  | 4800      | +10400  | +0.9 Mo
  IncomingMessage      | 5000   | 4998      | +2      | +0.1 Mo
  ServerResponse       | 5000   | 4998      | +2      | +0.1 Mo
  Socket               | 5000   | 4995      | +5      | +0.2 Mo
  ---------------------|--------|-----------|---------|------------
  TOTAL                |        |           |         | +6.3 Mo

  ==> 40 240 chaînes non libérées + 20 300 objets non libérés
  ==> Croissance ~6.3 Mo pour 5 000 requêtes = ~1.26 Ko/requête
```

On explore les retainers (chaîne de références qui empêche le GC de
collecter l'objet) :

```
  Retainers Tree pour les 40 240 chaînes non libérées
  =====================================================

  (string) "webhook_evt_a8f3c2..."
    ^
    |-- key in Map (table@0x2f4a)
    |     ^
    |     |-- sessionCache (property of global scope)
    |           ^
    |           |-- (root) GC Root
    |
    |-- value.payload.eventId
          ^
          |-- Object @0x3b2c
                ^
                |-- value in Map (table@0x2f4a)
                      ^
                      |-- sessionCache (property of global scope)

  ==> La Map "sessionCache" retient TOUTES les entrées indéfiniment
```

On explore aussi les retainers pour les objets Socket qui ne sont pas
libérés :

```
  Retainers Tree pour Socket +5
  ================================

  Socket @0x7fa2
    ^
    |-- listeners.data[3] (EventEmitter internal)
    |     ^
    |     |-- webhook handler (closure)
    |           ^
    |           |-- scope variable "socket"
    |
    |-- listeners.error[2]
          ^
          |-- error handler (closure)
                ^
                |-- scope variable "socket"

  ==> Des handlers d'événements sont ajoutés au socket à chaque requête
  ==> mais jamais retirés => le socket ne peut pas être GC
```

#### Étape 4 : Identifier la cause racine

Deux problèmes identifiés :

```typescript
// PROBLÈME 1 : Map sans limite, jamais nettoyée
const sessionCache = new Map<string, { payload: unknown; timestamp: number; processed: boolean }>();

app.post('/webhook', (req: { body: { eventId: string }; socket: import('node:net').Socket }, res: { sendStatus: (code: number) => void }) => {
  const eventId: string = req.body.eventId;
  // Chaque webhook est stocké, JAMAIS supprimé
  sessionCache.set(eventId, {
    payload: req.body,
    timestamp: Date.now(),
    processed: false,
  });
  // ... traitement ...
  res.sendStatus(200);
});
// Après 100 000 webhooks : 100 000 entrées dans la Map
// À ~1 Ko par entrée : ~100 Mo de mémoire retenue indéfiniment

// PROBLÈME 2 : listeners ajoutés par requête, jamais retirés
app.post('/webhook', (req, res) => {
  const socket = req.socket;
  // Handler ajouté à CHAQUE requête
  socket.on('data', function onData(chunk) {
    // traitement supplémentaire...
  });
  socket.on('error', function onError(err) {
    console.error('Socket error:', err);
  });
  // Les handlers ne sont JAMAIS retirés avec removeListener()
  // => accumulation de closures => fuite mémoire
  res.sendStatus(200);
});
```

#### Étape 5 : Corriger

```typescript
// FIX 1 : Map bornée avec éviction LRU
class LRUCache<V> {
  private _map: Map<string, V>;
  private _maxSize: number;

  constructor(maxSize: number) {
    this._map = new Map();
    this._maxSize = maxSize;
  }

  get(key: string): V | undefined {
    if (!this._map.has(key)) return undefined;
    const value = this._map.get(key)!;
    // Remettre en fin (plus récent) pour l'ordre LRU
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._maxSize) {
      // Supprimer le plus ancien (premier élément du Map)
      const oldestKey: string = this._map.keys().next().value!;
      this._map.delete(oldestKey);
    }
    this._map.set(key, value);
  }

  get size(): number { return this._map.size; }
}

const sessionCache = new LRUCache<{ payload: unknown; timestamp: number; processed: boolean }>(10_000); // Max 10 000 entrées

// FIX 2 : AbortController pour nettoyer les listeners
app.post('/webhook', (req: { body: { eventId: string }; socket: import('node:net').Socket }, res: { on: (event: string, cb: () => void) => void; sendStatus: (code: number) => void }) => {
  const controller = new AbortController();
  const { signal } = controller;

  const socket = req.socket;
  socket.on('data', function onData(chunk: Buffer) {
    // traitement supplémentaire...
  }, { signal } as any); // Le signal permet de retirer le listener automatiquement

  socket.on('error', function onError(err: Error) {
    console.error('Socket error:', err);
  }, { signal } as any);

  // À la fin de la requête, retirer tous les listeners
  res.on('finish', () => {
    controller.abort();
  });

  sessionCache.set(req.body.eventId, {
    payload: req.body,
    timestamp: Date.now(),
    processed: false,
  });

  res.sendStatus(200);
});
```

#### Étape 6 : Vérifier

Après le fix, on relance le monitoring sur 24 heures :

```
  Heure    heapUsed    heapTotal    RSS
  ======   =========   =========   ======
  00:00      98 Mo       140 Mo    180 Mo    (démarrage)
  04:00     145 Mo       180 Mo    220 Mo
  08:00     152 Mo       190 Mo    230 Mo
  12:00     148 Mo       185 Mo    225 Mo    (GC récupère la mémoire)
  16:00     155 Mo       195 Mo    235 Mo
  20:00     150 Mo       190 Mo    230 Mo
  24:00     153 Mo       192 Mo    232 Mo

  ==> Le heap se stabilise à ~150 Mo. La fuite est corrigée.
```

### 4. Cas 2 — Cascade de déoptimisations

#### Le contexte

```
  Application : pipeline de traitement de données
  Entrée : fichiers CSV de 100 000 lignes
  Tâche : parser, transformer, agréger
  Symptôme : le traitement prend 8 secondes au lieu des 2 secondes attendues
```

#### Étape 1 : Profiling CPU

```bash
node --cpu-prof pipeline.mjs data.csv
```

Le flame chart révèle que 70% du temps est passe dans `transformRecord()` :

```
  Flame Chart (simplifié)
  ========================

  +--[ main() ]-----------------------------------------------+
  |  +--[ parseCSV() ]----+  +--[ transformRecords() ]-------+|
  |  |    12% CPU         |  |           70% CPU             ||
  |  |                    |  |  +--[ transformRecord() ]---+ ||
  |  |                    |  |  |       68% CPU            | ||
  |  |                    |  |  +--------------------------+ ||
  |  +--------------------+  +-------------------------------+|
  +------------------------------------------------------------+
```

#### Étape 2 : Détecter les déoptimisations

```bash
node --trace-deopt pipeline.mjs data.csv 2>&1 | head -40
```

Sortie (annotée) :

```
  [deoptimizing (DEOPT eager): begin 0x3f4a <JSFunction transformRecord>]
      ;;; deopt id 12 @ bytecode offset 48
      ;;; Reason: wrong map
      ;;; Input frame:
      ;;;   0: 0x3f4a (JSFunction transformRecord)
      ;;;   1: 0x2b3c <Object map=0x1a2b>           <-- record argument
      ;;;   2: 0x0000 (Smi 0)
      ;;; Output frame(s):
      ;;;   InterpretedFrame: bytecode=0x1234 offset=48

  [deoptimizing (DEOPT eager): begin 0x3f4a <JSFunction transformRecord>]
      ;;; deopt id 15 @ bytecode offset 48
      ;;; Reason: wrong map                          <-- même raison !
      ;;;   1: 0x4c5d <Object map=0x3e4f>            <-- MAP DIFFERENTE !

  [deoptimizing (DEOPT eager): begin 0x3f4a <JSFunction transformRecord>]
      ;;; Reason: wrong map                          <-- encore !
      ;;;   1: 0x5d6e <Object map=0x5a6b>            <-- ENCORE une map différente

  ==> La fonction transformRecord() est déoptimisée à CHAQUE appel
  ==> car elle reçoit des objets avec des hidden classes différentes
  ==> V8 compile un code optimisé pour une shape, puis doit abandonner
  ==> quand une shape différente arrive => retour a Ignition (interpréteur)
```

#### Étape 3 : Identifier les formes inconsistantes avec --trace-ic

```bash
node --trace-ic pipeline.mjs data.csv 2>&1 | grep transformRecord | head -20
```

```
  [LoadIC in transformRecord @ offset 24] : . -> 1 (monomorphic)
  [LoadIC in transformRecord @ offset 24] : 1 -> P (polymorphic)
  [LoadIC in transformRecord @ offset 24] : P -> P (polymorphic, 3 maps)
  [LoadIC in transformRecord @ offset 24] : P -> N (MEGAMORPHIC)
      ^                                        ^
      |                                        |
  Site d'accès ".name"               Transition vers mégamorphique
                                     car > 4 shapes différentes
```

#### Étape 4 : Trouver la cause racine

Le problème est dans le parser CSV :

```typescript
// PROBLÈME : le parser crée des objets avec des shapes différentes
function parseCSVLine(headers: string[], values: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    if (values[i] !== undefined && values[i] !== '') {
      record[headers[i]] = values[i]; // Ajoute la propriété SEULEMENT si non vide
    }
    // Si la valeur est vide, la propriété N'EXISTE PAS sur l'objet
  }
  return record;
}

// Résultat : des objets avec des shapes différentes
// Ligne 1 : { name: "Alice", age: "30", city: "Paris" }         --> Shape A
// Ligne 2 : { name: "Bob", city: "Lyon" }                        --> Shape B (pas d'age)
// Ligne 3 : { name: "Charlie", age: "25" }                       --> Shape C (pas de city)
// Ligne 4 : { name: "Diana", age: "28", city: "Marseille" }      --> Shape A
// Ligne 5 : { name: "Eve" }                                      --> Shape D (seulement name)

// V8 voit 4+ shapes différentes => MEGAMORPHIC pour tous les accès
```

#### Étape 5 : Corriger — Normaliser les formes

```typescript
// FIX : toujours créer des objets avec la MÊME shape
function parseCSVLine(headers: string[], values: string[]): Record<string, string | null> {
  const record: Record<string, string | null> = {};
  for (let i = 0; i < headers.length; i++) {
    // Assigner TOUTES les propriétés, même si la valeur est vide
    record[headers[i]] = (values[i] !== undefined && values[i] !== '')
      ? values[i]
      : null; // null au lieu de propriété absente => même shape
  }
  return record;
}

// Résultat : TOUS les objets ont la même shape
// Ligne 1 : { name: "Alice", age: "30", city: "Paris" }         --> Shape unique
// Ligne 2 : { name: "Bob", age: null, city: "Lyon" }            --> Shape unique
// Ligne 3 : { name: "Charlie", age: "25", city: null }          --> Shape unique
// Ligne 4 : { name: "Diana", age: "28", city: "Marseille" }     --> Shape unique

// V8 : MONOMORPHIC pour tous les accès => inline cache hit à chaque fois
```

#### Étape 6 : Vérifier

```
  Avant correction :
  ===================
  node --trace-deopt pipeline.mjs data.csv 2>&1 | grep -c "deoptimizing"
  --> 847 déoptimisations

  Temps de traitement (100k records) : 8.2 secondes

  Après correction :
  ==================
  node --trace-deopt pipeline.mjs data.csv 2>&1 | grep -c "deoptimizing"
  --> 0 déoptimisations

  Temps de traitement (100k records) : 1.5 secondes

  Amélioration : 5.5x plus rapide
```

### 5. Cas 3 — Pauses GC causant des spikes de latence

#### Le contexte

```
  Application : serveur WebSocket poussant des données temps réel
  Clients : ~200 connexions simultanées
  Fréquence : 1 message/client/100ms (10 messages/seconde/client)
  Symptôme : p99 latence passe de 5ms à 200ms toutes les ~30 secondes
```

#### Étape 1 : Tracer le GC

```bash
node --trace-gc server.mjs 2>&1 | head -30
```

Sortie :

```
  [12345:0x5a3b]    1052 ms: Scavenge 4.2 (8.0) -> 3.8 (8.0) MB, 0.6 / 0.0 ms
  [12345:0x5a3b]    1234 ms: Scavenge 4.5 (8.0) -> 3.9 (8.0) MB, 0.7 / 0.0 ms
  [12345:0x5a3b]    1456 ms: Scavenge 4.8 (8.0) -> 4.1 (9.0) MB, 0.8 / 0.0 ms
  [12345:0x5a3b]    1678 ms: Scavenge 5.1 (9.0) -> 4.5 (10.0) MB, 0.9 / 0.0 ms
  ...
  [12345:0x5a3b]    2890 ms: Scavenge 8.2 (12.0) -> 7.1 (14.0) MB, 1.2 / 0.0 ms
  [12345:0x5a3b]    3456 ms: Scavenge 10.5 (14.0) -> 9.2 (16.0) MB, 1.5 / 0.0 ms
  ...
  [12345:0x5a3b]   30123 ms: Mark-Compact 42.1 (64.0) -> 18.2 (48.0) MB, 187.3 / 0.0 ms
                                                                          ^^^^^^^^
                                                                          187 ms de pause !
  [12345:0x5a3b]   30456 ms: Scavenge 18.8 (48.0) -> 18.5 (48.0) MB, 0.5 / 0.0 ms
  ...
  [12345:0x5a3b]   61234 ms: Mark-Compact 45.3 (64.0) -> 19.1 (48.0) MB, 203.1 / 0.0 ms
                                                                          ^^^^^^^^
                                                                          203 ms de pause !
```

Lecture de la sortie :

```
  Format --trace-gc :
  [PID:isolate]  timestamp: TYPE from (capacity) -> to (capacity) MB, pause / concurrent ms

  Types importants :
  - Scavenge         : GC de la Young Génération (rapide, < 2ms généralement)
  - Mark-Compact     : GC de la Old Génération (LENT, peut dépasser 100ms)
  - Mark-Sweep       : Phase de marquage + balayage (généralement concurrent)

  Ce qu'on observe :
  - Scavenge toutes les ~200ms, pause < 2ms => OK
  - Mark-Compact toutes les ~30 secondes, pause ~190ms => PROBLÈME
  - La Old Génération monte de 18 Mo à 42 Mo entre les Mark-Compact
  - => ~24 Mo d'objets sont promus vers la Old Génération en 30 secondes
  - => Beaucoup d'objets survivent assez longtemps pour être promus
```

#### Étape 2 : Corréler GC et latence

```typescript
// Monitoring GC programmatique
import { PerformanceObserver, PerformanceObserverEntryList } from 'node:perf_hooks';

const gcObserver = new PerformanceObserver((list: PerformanceObserverEntryList) => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 10) { // Pauses > 10ms
      console.warn(
        `[GC] ${(entry as any).detail.kind} pause: ${entry.duration.toFixed(1)}ms ` +
        `at ${new Date().toISOString()}`
      );
    }
  }
});
gcObserver.observe({ entryTypes: ['gc'] });
```

Résultats corrélés avec les métriques de latence :

```
  Timestamp                 GC Event              p99 Latency
  ========================  ====================  ===========
  2024-01-15T10:00:30.123   Mark-Compact 187ms    195ms
  2024-01-15T10:01:01.456   Mark-Compact 203ms    212ms
  2024-01-15T10:01:32.789   Mark-Compact 178ms    186ms

  ==> Corrélation parfaite : chaque Mark-Compact cause un spike de latence
  ==> Le p99 = temps GC + temps de traitement normal (~5ms)
```

#### Étape 3 : Trouver la cause racine

Le code du broadcast :

```typescript
// PROBLÈME : allocations massives dans la boucle de broadcast
interface WsClient {
  id: string;
  send(data: Buffer): void;
}

function broadcastUpdate(clients: WsClient[], data: unknown): void {
  for (const client of clients) {
    // PROBLÈME 1 : nouvelle chaîne JSON pour CHAQUE client
    const message: string = JSON.stringify({
      type: 'update',
      timestamp: Date.now(),
      payload: data,
      clientId: client.id,
    });

    // PROBLÈME 2 : Buffer.from() alloue un nouveau buffer à chaque fois
    const buffer: Buffer = Buffer.from(message, 'utf-8');

    client.send(buffer);
  }
}

// Appele 10x/seconde pour 200 clients :
// = 2 000 objets JSON + 2 000 chaînes + 2 000 buffers par seconde
// = 120 000 objets/minute
// = 7.2 millions objets/heure
// La plupart sont éphémères mais certains survivent un ou deux Scavenge
// et sont promus vers la Old Génération => Mark-Compact fréquent
```

#### Étape 4 : Corriger — Réduire les allocations

```typescript
// FIX : minimiser les allocations dans le chemin chaud

// Pré-allouer un buffer réutilisable
const SEND_BUFFER_SIZE: number = 64 * 1024; // 64 Ko
let sendBuffer: Buffer = Buffer.alloc(SEND_BUFFER_SIZE);

function broadcastUpdate(clients: WsClient[], data: unknown): void {
  // FIX 1 : sérialiser UNE SEULE FOIS (le payload est identique pour tous)
  const baseMessage: string = JSON.stringify({
    type: 'update',
    timestamp: Date.now(),
    payload: data,
  });

  // FIX 2 : encoder dans le buffer pré-alloué
  const byteLength: number = Buffer.byteLength(baseMessage, 'utf-8');
  if (byteLength > sendBuffer.length) {
    sendBuffer = Buffer.alloc(byteLength * 2); // Agrandir si nécessaire
  }
  sendBuffer.write(baseMessage, 0, 'utf-8');
  const messageSlice: Buffer = sendBuffer.subarray(0, byteLength);

  for (const client of clients) {
    // Envoyer le même buffer à tous les clients
    // (pas d'allocation par client)
    client.send(messageSlice);
  }
}

// Résultat : 1 objet JSON + 1 encodage par broadcast au lieu de 200
// Réduction des allocations de 200x dans le chemin chaud
```

#### Étape 5 : Vérifier

```
  Avant correction :
  ==================
  Mark-Compact toutes les ~30s, pause 180-210ms
  p99 latence : 195-215ms

  Après correction :
  ===================
  Mark-Compact toutes les ~5 minutes, pause 12-18ms
  p99 latence : 8-12ms

  Amélioration :
  - Fréquence Mark-Compact : 10x moins fréquent
  - Durée des pauses : 12x plus courtes
  - p99 latence : 18x plus bas
```

#### Tuning supplémentaire du GC

```bash
# Augmenter la taille du semi-space (Young Génération)
# Par défaut : 16 Mo. Plus grand = Scavenge moins fréquent
# mais chaque Scavenge est plus long
node --max-semi-space-size=64 server.mjs

# Augmenter la taille max du heap
# Par défaut : ~1.5 Go (64-bit). Pour les processus gourmands :
node --max-old-space-size=4096 server.mjs

# Régler la fréquence de sondage du GC entre les allocations
# V8 utilise déjà du marquage incrémental par défaut.
# --gc-interval=N contrôle le nombre d'allocations entre chaque
# vérification GC (probe), pas la durée des pauses :
node --gc-interval=100 server.mjs
```

### 6. Cas 4 — Blocage de l'event loop

#### Le contexte

```
  Application : API REST avec un endpoint de génération de rapports
  Symptôme : quand /report est appelé, TOUS les endpoints deviennent lents
             pendant 2-3 secondes
  Cause : /report fait un calcul CPU-intensif sur le thread principal
```

#### Diagnostic rapide

```typescript
// Détecter le blocage de l'event loop
import { monitorEventLoopDelay, IntervalHistogram } from 'node:perf_hooks';

const h: IntervalHistogram = monitorEventLoopDelay({ resolution: 10 });
h.enable();

setInterval(() => {
  const p50: number = h.percentile(50) / 1e6; // nanosecondes -> millisecondes
  const p99: number = h.percentile(99) / 1e6;
  const max: number = h.max / 1e6;
  console.log(`Event Loop Delay — p50: ${p50.toFixed(1)}ms, p99: ${p99.toFixed(1)}ms, max: ${max.toFixed(1)}ms`);
  h.reset();
}, 5000);
```

```
  Sortie pendant un appel /report :
  Event Loop Delay — p50: 1.2ms, p99: 2450.3ms, max: 2892.1ms
                                        ^^^^^^^         ^^^^^^^
                                        BLOQUÉ pendant ~2.5 secondes
```

#### Fix : décharger vers un Worker Thread

```typescript
// report-worker.mjs (exécuté dans un thread séparé)
import { parentPort, workerData } from 'node:worker_threads';

function generateReport(data: unknown): unknown {
  // Calcul CPU-intensif (2-3 secondes)
  const result: unknown = heavyComputation(data);
  return result;
}

const result: unknown = generateReport(workerData);
parentPort!.postMessage(result);
```

```typescript
// Dans le handler Express
import { Worker } from 'node:worker_threads';

app.get('/report', async (req: unknown, res: { json: (body: unknown) => void }) => {
  const data: unknown = await getReportData((req as any).query);

  const result: unknown = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker('./report-worker.mjs', {
      workerData: data,
    });
    worker.on('message', resolve);
    worker.on('error', reject);
  });

  res.json(result);
});

// Le thread principal reste libre pour traiter les autres requêtes
// pendant que le Worker génère le rapport
```

Ce cas est un lien direct vers le Module 13 (Scheduling & Concurrence)
qui couvre les Worker Threads en détail.

### 7. Comparaison cross-engine (bonus)

JavaScript ne tourne pas que dans V8. Comprendre les différences entre
moteurs permet d'écrire du code performant partout.

```
  Moteur          Utilisé par                      JIT Compiler
  ==============  ==============================   =====================
  V8              Chrome, Node.js, Deno, Edge      Sparkplug -> Maglev
                                                   -> TurboFan (3 tiers)

  SpiderMonkey    Firefox                          Baseline -> WarpMonkey
                                                   (2 tiers principaux)

  JavaScriptCore  Safari, Bun, React Native        LLInt -> Baseline ->
  (JSC)                                            DFG -> FTL (4 tiers)
```

#### Stratégies d'optimisation différentes

```
  Aspect               V8                SpiderMonkey         JSC
  ==================   ================  ==================   ==================
  Hidden Classes       "Maps" (chaînes   "Shapes" (similaire  "Structures"
                       de transition)    mais partage         (chaînes de
                                         différent)           transition)

  Inline Caching       Feedback Vector   CacheIR              StructureStubInfo
                       (4 slots poly,    (IC spécialisés       (IC polymorphique
                       megamorphic       par opération)        plus agressif)
                       après)

  GC                   Orinoco           Nursery + Tenured    Riptide
                       (générationnel,   (générationnel,      (concurrent,
                       incrémental,      incrémental,         générationnel)
                       concurrent)       zone-based nursery)

  Tiering              3 niveaux         2 niveaux            4 niveaux
                       (Sparkplug,       (Baseline,           (LLInt, Baseline,
                       Maglev,           WarpMonkey)          DFG, FTL)
                       TurboFan)

  Inlining             Agressif          Modéré               Très agressif
                       (TurboFan)                             (FTL/DFG)

  Speculation          Type feedback     Type inference        Type profiling
                       vectors           + CacheIR            + OSR probes
```

#### Exemples de différences pratiques

```typescript
// Pattern 1 : arguments objet
// V8 : déoptimisé si `arguments` est passé à une autre fonction
// JSC : optimisé même avec `arguments` dans certains cas
// SpiderMonkey : gère via une représentation spéciale (MagicArguments)

function sum(): number {
  return Array.prototype.reduce.call(arguments, (a: number, b: number) => a + b, 0);
}
// Préférer les rest parameters pour être portable :
function sum(...args: number[]): number {
  return args.reduce((a, b) => a + b, 0);
}

// Pattern 2 : delete sur un objet
// V8 : casse la hidden class, passe en "slow mode" (dictionary mode)
// JSC : gère mieux le delete avec les Structures
// SpiderMonkey : conséquence similaire à V8

const obj = { a: 1, b: 2, c: 3 };
delete obj.b; // ÉVITER dans les chemins chauds

// Pattern 3 : for-in sur un objet avec prototype chain
// V8 : énumère les clés + remonte le prototype (peut être lent)
// JSC : optimisé fortement les for-in avec FTL
// SpiderMonkey : optimisé via Shape-based enumeration
```

#### Conseil pratique

Ne jamais optimiser pour un seul moteur. Les bonnes pratiques sont
universelles :

1. Objets avec des shapes consistantes
2. Éviter `delete` sur les objets dans les chemins chauds
3. Préférer les rest parameters à `arguments`
4. Éviter le polymorphisme excessif dans les chemins chauds
5. Minimiser les allocations dans les boucles chaudes

### 8. Checklist de performance production

Cette checklist est un résumé des bonnes pratiques à vérifier avant un
déploiement en production. Elle peut servir de revue de code ciblée
pour les chemins critiques de l'application.

#### Mémoire

```
  [ ] Aucun cache sans limite (Map, Set, Array)
      => Utiliser un LRU cache borné ou un TTL
  [ ] Tous les listeners retirés au nettoyage
      => AbortController, removeListener, ou { once: true }
  [ ] Pas de références circulaires involontaires dans les closures
      => Vérifier que les closures ne capturent pas des objets lourds
  [ ] Pas de variables globales qui accumulent des données
      => Revue des modules-level Map/Set/Array
  [ ] WeakMap/WeakRef pour les caches non-critiques
      => Le GC peut récupèrer les valeurs si plus de référence forte
```

#### CPU et optimisation V8

```
  [ ] Formes d'objets consistantes dans les chemins chauds
      => Même propriétés, même ordre, même types
  [ ] Pas de polymorphisme excessif (> 4 shapes) sur un même site d'accès
      => Vérifier avec --trace-ic
  [ ] Pas de déoptimisations répétées
      => Vérifier avec --trace-deopt
  [ ] Pas de delete sur les objets dans les chemins chauds
      => Utiliser null au lieu de delete
  [ ] Pas de JSON.parse/stringify dans les boucles chaudes
      => Spread, structuredClone, ou éviter le clone
```

#### Event loop et concurrence

```
  [ ] Pas de I/O synchrone dans la boucle d'événements
      => readFileSync, execSync, etc. interdits en runtime
      => OK au démarrage (chargement de config)
  [ ] Calculs CPU-intensifs délégués aux Worker Threads
      => Tout ce qui prend > 50ms devrait être dans un Worker
  [ ] Event loop delay monitorisé
      => monitorEventLoopDelay() ou clinic doctor
  [ ] Pas de boucle while(true) sans yield
      => Utiliser setImmediate() ou queueMicrotask() pour coopérer
```

#### GC et allocations

```
  [ ] Pauses GC monitorisées (PerformanceObserver gc entries)
      => Alerter si Mark-Compact > 50ms
  [ ] Pas d'allocation d'objets dans les boucles chaudes
      => Réutiliser, pré-allouer, ou utiliser un pool
  [ ] Tableaux pré-alloués quand la taille est connue
      => new Array(n) au lieu de push() répété
  [ ] Typed Arrays pour le travail numerique intensif
      => Float64Array, Int32Array au lieu de Array pour les calculs
  [ ] Concaténation de chaînes hors boucle ou via Array.join()
      => Éviter += dans les boucles à forte itération
```

#### Monitoring

```
  [ ] process.memoryUsage() exposé via endpoint ou métriques
  [ ] CPU profiling activable à la demande (--inspect ou --cpu-prof)
  [ ] Heap snapshots prenables à la demande (v8.writeHeapSnapshot())
  [ ] Alertes configurées sur RSS, heap used, event loop delay
  [ ] Logs structurés avec timestamps pour corréler GC et latence
```

---

## Démonstration

### Démo 1 — Diagnostic complet d'une fuite mémoire

```typescript
// demo-memory-leak-diagnostic.mjs
// Lancer avec : node --expose-gc demo-memory-leak-diagnostic.mjs
import { performance } from 'node:perf_hooks';

// Simuler une fuite mémoire avec un cache sans limite
const leakyCache = new Map<string, { id: string; payload: string; timestamp: number; headers: Record<string, string> }>();
let requestId = 0;

function simulateLeakyRequest(): void {
  const id = `req_${requestId++}`;
  // Chaque "requête" ajoute des données au cache, JAMAIS supprimées
  leakyCache.set(id, {
    id,
    payload: Buffer.alloc(1024).toString('hex'), // ~2 Ko par entrée
    timestamp: Date.now(),
    headers: { 'content-type': 'application/json', 'x-request-id': id },
  });
}

// Simuler le fix : cache LRU borné
class BoundedCache<V> {
  private _map: Map<string, V>;
  private _maxSize: number;

  constructor(maxSize: number) {
    this._map = new Map();
    this._maxSize = maxSize;
  }
  set(key: string, value: V): void {
    if (this._map.size >= this._maxSize) {
      const oldest: string = this._map.keys().next().value!;
      this._map.delete(oldest);
    }
    this._map.set(key, value);
  }
  get size(): number { return this._map.size; }
}

const fixedCache = new BoundedCache<{ id: string; payload: string; timestamp: number; headers: Record<string, string> }>(100);
let fixedRequestId = 0;

function simulateFixedRequest(): void {
  const id = `req_${fixedRequestId++}`;
  fixedCache.set(id, {
    id,
    payload: Buffer.alloc(1024).toString('hex'),
    timestamp: Date.now(),
    headers: { 'content-type': 'application/json', 'x-request-id': id },
  });
}

// Comparaison : evolution mémoire
console.log('=== Démo : Diagnostic de fuite mémoire ===\n');

console.log('--- Version avec fuite (cache sans limite) ---');
for (let batch = 0; batch < 10; batch++) {
  for (let i = 0; i < 1000; i++) {
    simulateLeakyRequest();
  }
  if (globalThis.gc) globalThis.gc(); // Forcer le GC
  const mem = process.memoryUsage();
  console.log(
    `  Après ${(batch + 1) * 1000} requêtes : ` +
    `heap = ${(mem.heapUsed / 1024 / 1024).toFixed(1)} Mo, ` +
    `cache size = ${leakyCache.size}`
  );
}

console.log('\n--- Version corrigée (cache borné à 100) ---');
for (let batch = 0; batch < 10; batch++) {
  for (let i = 0; i < 1000; i++) {
    simulateFixedRequest();
  }
  if (globalThis.gc) globalThis.gc();
  const mem = process.memoryUsage();
  console.log(
    `  Après ${(batch + 1) * 1000} requêtes : ` +
    `heap = ${(mem.heapUsed / 1024 / 1024).toFixed(1)} Mo, ` +
    `cache size = ${fixedCache.size}`
  );
}

console.log('\n=== Conclusion ===');
console.log(`Cache sans limite : ${leakyCache.size} entrées (mémoire croissante)`);
console.log(`Cache borné : ${fixedCache.size} entrées (mémoire stable)`);
```

### Démo 2 — Détection de cascade de déoptimisations

```typescript
// demo-deopt-cascade.mjs
// Lancer avec : node --trace-deopt demo-deopt-cascade.mjs 2>&1 | head -30
import { performance } from 'node:perf_hooks';

// Version problematique : objets avec shapes inconsistantes
function processRecordSlow(record: { name: string; value: number; [key: string]: unknown }): string {
  return record.name.toUpperCase() + ':' + record.value * 2;
}

// Version corrigée : objets avec shapes uniformes
function processRecordFast(record: { name: string; value: number; category: string | null; priority: number | null; active: boolean }): string {
  return record.name.toUpperCase() + ':' + record.value * 2;
}

// Générer des records avec shapes INCONSISTANTES
function generateInconsistentRecords(n: number): Array<{ name: string; value: number; [key: string]: unknown }> {
  const records: Array<{ name: string; value: number; [key: string]: unknown }> = [];
  for (let i = 0; i < n; i++) {
    const r = { name: `item_${i}` };
    if (i % 3 === 0) r.value = i;           // parfois .value
    if (i % 5 === 0) r.category = 'A';      // parfois .category
    if (i % 7 === 0) r.priority = 1;        // parfois .priority
    if (i % 2 === 0) r.active = true;       // parfois .active
    if (!r.value) r.value = 0;
    records.push(r);
  }
  return records;
}

// Générer des records avec shapes UNIFORMES
function generateConsistentRecords(n: number): Array<{ name: string; value: number; category: string | null; priority: number | null; active: boolean }> {
  const records: Array<{ name: string; value: number; category: string | null; priority: number | null; active: boolean }> = [];
  for (let i = 0; i < n; i++) {
    records.push({
      name: `item_${i}`,
      value: i % 3 === 0 ? i : 0,
      category: i % 5 === 0 ? 'A' : null,
      priority: i % 7 === 0 ? 1 : null,
      active: i % 2 === 0,
    });
  }
  return records;
}

const N = 200_000;

console.log('=== Démo : Cascade de déoptimisations ===\n');

// Test avec shapes inconsistantes
const inconsistent = generateInconsistentRecords(N);
const t1 = performance.now();
let sum1 = 0;
for (const r of inconsistent) {
  const result = processRecordSlow(r);
  sum1 += result.length;
}
const t2 = performance.now();

// Test avec shapes uniformes
const consistent = generateConsistentRecords(N);
const t3 = performance.now();
let sum2 = 0;
for (const r of consistent) {
  const result = processRecordFast(r);
  sum2 += result.length;
}
const t4 = performance.now();

console.log(`Shapes inconsistantes : ${(t2 - t1).toFixed(1)} ms (${N} records)`);
console.log(`Shapes uniformes      : ${(t4 - t3).toFixed(1)} ms (${N} records)`);
console.log(`Ratio                 : ${((t2 - t1) / (t4 - t3)).toFixed(2)}x`);
console.log('\nLancer avec --trace-deopt pour voir les déoptimisations en détail.');
```

### Démo 3 — Monitoring GC en temps réel

```typescript
// demo-gc-monitoring.mjs
// Lancer avec : node --trace-gc --expose-gc demo-gc-monitoring.mjs
import { PerformanceObserver } from 'node:perf_hooks';

// Observer les événements GC
const gcObserver = new PerformanceObserver((list: PerformanceObserverEntryList) => {
  for (const entry of list.getEntries()) {
    const kind: string = (entry as any).detail?.kind ?? 'unknown';
    const flag: string = entry.duration > 10 ? ' *** PAUSE LONGUE ***' : '';
    console.log(
      `  [GC] ${kind.toString().padEnd(12)} ` +
      `${entry.duration.toFixed(2).padStart(8)} ms${flag}`
    );
  }
});
gcObserver.observe({ entryTypes: ['gc'] });

console.log('=== Démo : Monitoring GC en temps réel ===\n');

// Phase 1 : allocations massives (pression GC)
console.log('--- Phase 1 : Allocations massives (pression GC élevée) ---');
const ephemeral = [];
for (let i = 0; i < 100_000; i++) {
  ephemeral.push({
    id: i,
    data: `payload_${i}_${'x'.repeat(100)}`,
    nested: { a: i, b: i * 2, c: [i, i + 1, i + 2] },
  });
  if (i % 20_000 === 0 && i > 0) {
    console.log(`  ... ${i} objets alloués`);
  }
}

// Phase 2 : libérer et forcer GC
console.log('\n--- Phase 2 : Libération + GC forcé ---');
ephemeral.length = 0; // Libérer les références
if (globalThis.gc) {
  globalThis.gc(); // Scavenge
  globalThis.gc(); // Mark-Compact potentiel
}

// Phase 3 : allocations raisonnables (pool)
console.log('\n--- Phase 3 : Object pool (pression GC faible) ---');
const pool = [];
for (let i = 0; i < 100; i++) {
  pool.push({ id: 0, data: '', nested: { a: 0, b: 0, c: [0, 0, 0] } });
}
let poolIdx = 0;

for (let i = 0; i < 100_000; i++) {
  const obj = pool[poolIdx];
  obj.id = i;
  obj.data = `payload_${i}`;
  obj.nested.a = i;
  // ... traitement ...
  poolIdx = (poolIdx + 1) % pool.length;
}

console.log('\n--- Comparaison terminée ---');
console.log('Observer la différence de fréquence et durée GC entre Phase 1 et Phase 3.');

gcObserver.disconnect();
```

### Démo 4 — Lecture de la spec ECMAScript en pratique

```typescript
// demo-spec-reading.mjs
// Cette demo illustre des comportements subtils
// qui ne sont compréhensibles qu'en lisant la spec

console.log('=== Démo : Comportements subtils de la spec ECMAScript ===\n');

// --- Cas 1 : Promise.resolve(thenable) est TOUJOURS asynchrone ---
console.log('--- Cas 1 : Promise.resolve(thenable) ---');
const thenable: { then(resolve: (value: number) => void): void } = {
  then(resolve: (value: number) => void) {
    console.log('  2. thenable.then() appelé');
    resolve(42);
  }
};

console.log('1. Avant Promise.resolve(thenable)');
const p: Promise<number> = Promise.resolve(thenable) as Promise<number>;
p.then((value: number) => {
  console.log(`  4. Promise résolue avec: ${value}`);
});
console.log('3. Après Promise.resolve(thenable)');
// Ordre : 1, 2... non! Ordre réel : 1, 3, 2, 4
// Car thenable.then() est appelé dans un PromiseResolveThenableJob (microtask)
// Cf. spec 25.6.1.3.2 étape 11 : HostEnqueuePromiseJob

await p; // Attendre la resolution pour la suite de la demo

console.log('\n--- Cas 2 : typeof null === "object" (bug historique) ---');
console.log(`  typeof null        = "${typeof null}"`);
console.log(`  typeof undefined   = "${typeof undefined}"`);
console.log(`  typeof 42          = "${typeof 42}"`);
// La spec définit typeof null comme "object" (Table 41, clause 6.1.1)
// C'est un bug historique de la première implémentation JS jamais corrigé

console.log('\n--- Cas 3 : [] + [] === "" et [] + {} === "[object Object]" ---');
console.log(`  [] + []  = "${[] + []}"`);
console.log(`  [] + {}  = "${[] + {}}"`);
console.log(`  {} + []  = ${(() => ({} + []))()} (en expression)`);
// Spec : l'opérateur + appelle ToPrimitive sur les deux opérandes
// ToPrimitive sur un Array appelle toString() qui retourne ""
// "" + "" = ""
// "" + "[object Object]" = "[object Object]"

console.log('\n--- Cas 4 : 0.1 + 0.2 !== 0.3 ---');
const result: number = 0.1 + 0.2;
console.log(`  0.1 + 0.2 = ${result}`);
console.log(`  0.1 + 0.2 === 0.3 ? ${result === 0.3}`);
console.log(`  Difference : ${Math.abs(result - 0.3)}`);
console.log(`  Number.EPSILON : ${Number.EPSILON}`);
console.log(`  Correct check : Math.abs(result - 0.3) < Number.EPSILON ? ${Math.abs(result - 0.3) < Number.EPSILON}`);
// Spec clause 6.1.6.1 : Number est IEEE 754 double precision
// 0.1 ne peut pas être représenté exactement en binaire

console.log('\n=== Conclusion ===');
console.log('Lire la spec permet de comprendre POURQUOI ces comportements existent,');
console.log('pas seulement de les constater. Ref: https://tc39.es/ecma262/');
```

### Démo 5 — Event loop blocking et Worker Threads

```typescript
// demo-event-loop-blocking.mjs
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

// Calcul CPU-intensif : trouver des nombres premiers
function findPrimes(limit: number): number {
  const primes: number[] = [];
  for (let n = 2; n <= limit; n++) {
    let isPrime = true;
    for (let d = 2; d <= Math.sqrt(n); d++) {
      if (n % d === 0) { isPrime = false; break; }
    }
    if (isPrime) primes.push(n);
  }
  return primes.length;
}

if (!isMainThread) {
  // Code du Worker
  const result: number = findPrimes(500_000);
  parentPort!.postMessage(result);
} else {
  // Code du thread principal
  console.log('=== Démo : Blocage event loop vs Worker Thread ===\n');

  // Monitoring event loop delay
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();

  // Simuler des requêtes concurrentes (intervalle 50ms)
  let requestCount = 0;
  const interval = setInterval(() => {
    requestCount++;
  }, 50);

  // Test 1 : calcul sur le thread principal (BLOQUANT)
  console.log('--- Test 1 : Calcul sur le thread principal ---');
  const t1 = performance.now();
  const result1: number = findPrimes(500_000);
  const t2: number = performance.now();
  const delay1: number = h.percentile(99) / 1e6;
  console.log(`  Primes trouvés : ${result1}`);
  console.log(`  Durée : ${(t2 - t1).toFixed(0)} ms`);
  console.log(`  Event loop delay p99 : ${delay1.toFixed(1)} ms`);
  console.log(`  Requêtes traitées pendant le calcul : ${requestCount}`);
  h.reset();
  requestCount = 0;

  // Test 2 : calcul dans un Worker (NON BLOQUANT)
  console.log('\n--- Test 2 : Calcul dans un Worker Thread ---');
  const t3: number = performance.now();
  const worker = new Worker(__filename);
  worker.on('message', (result2: number) => {
    const t4: number = performance.now();
    const delay2: number = h.percentile(99) / 1e6;
    console.log(`  Primes trouvés : ${result2}`);
    console.log(`  Durée : ${(t4 - t3).toFixed(0)} ms`);
    console.log(`  Event loop delay p99 : ${delay2.toFixed(1)} ms`);
    console.log(`  Requêtes traitées pendant le calcul : ${requestCount}`);

    console.log('\n=== Conclusion ===');
    console.log('Le Worker Thread libere l\'event loop pour traiter les requêtes.');
    console.log(`Thread principal : ~0 requêtes traitées (bloqué)`);
    console.log(`Worker Thread : ${requestCount} requêtes traitées (libre)`);

    clearInterval(interval);
    h.disable();
  });
}
```

---

## Points clés

1. **La méthodologie en 5 étapes** (Observer, Mesurer, Hypothèse, Corriger, Vérifier) est la seule approche fiable pour le debugging de performance. Ne jamais sauter directement au fix.

2. **L'arbre de décision des outils** permet de choisir le bon outil selon le symptôme : `--cpu-prof` pour la lenteur globale, heap snapshots pour les fuites, `--trace-gc` pour les spikes de latence, `--trace-deopt` pour les déoptimisations.

3. **Les heap snapshots comparés** (3 snapshots + comparaison delta) sont la méthode la plus fiable pour trouver les fuites mémoire. Les retainers montrent la chaîne de références qui empêche le GC.

4. **Les déoptimisations en cascade** sont souvent causées par des objets avec des shapes inconsistantes. `--trace-deopt` et `--trace-ic` révèlent le problème, et la normalisation des shapes le corrige.

5. **Les pauses Mark-Compact** du GC sont la cause principale des spikes de latence. Réduire le taux d'allocation (object pooling, buffers pré-alloués) réduit dramatiquement la fréquence et la durée des pauses.

6. **Lire la spec ECMA-262** est une compétence indispensable pour comprendre les comportements subtils du langage et déboguer les cas limites.

7. **Le blocage de l'event loop** par du calcul CPU-intensif affecte TOUTES les requêtes. Les Worker Threads sont la solution pour isoler le travail CPU.

8. **La comparaison cross-engine** (V8, SpiderMonkey, JSC) montre que les bonnes pratiques sont universelles : shapes consistantes, allocations minimales, pas de delete dans les chemins chauds.

9. **La checklist de production** couvre les quatre axes critiques : mémoire, CPU/V8, event loop, et GC. Elle doit être utilisée comme revue de code pour les chemins critiques.

10. **Chaque correction doit être mesurée** avant ET après. Un fix sans mesure n'est qu'une supposition.

---

## Lab associe

**Lab 15 — Diagnostic de performance** (`labs/lab-15-debugging-session/`)

Dans ce lab, vous recevrez un "simulateur de serveur" Node.js contenant
6 problèmes de performance intentionnels. Vous devrez :

1. Lancer le programme avec différents flags V8 (`--trace-gc`, `--trace-deopt`, `--cpu-prof`)
2. Identifier les 6 problèmes en utilisant la méthodologie de diagnostic
3. Rédiger un commentaire de diagnostic pour chaque problème (outil utilisé, cause racine)
4. Corriger chaque problème
5. Vérifier les améliorations avec `performance.mark` / `performance.measure`

---

## Pour aller plus loin

- [ECMA-262 — The ECMAScript Language Specification](https://tc39.es/ecma262/) — La spec complète du langage
- [How to Read the ECMAScript Specification (Timothy Gu)](https://timothygu.me/es-howto/) — Guide pratique pour naviguer la spec
- [V8 Blog — Trash Talk: the Orinoco Garbage Collector](https://v8.dev/blog/trash-talk) — Architecture du GC V8
- [V8 Blog — Blazingly Fast Parsing](https://v8.dev/blog/scanner) — Parsing et compilation dans V8
- [Chrome DevTools — Fix Memory Problems](https://developer.chrome.com/docs/devtools/memory-problems) — Guide officiel heap snapshots
- [Chrome DevTools — Analyze Runtime Performance](https://developer.chrome.com/docs/devtools/performance) — Flame charts et profiling
- [Node.js — Diagnostics Guide](https://nodejs.org/en/guides/diagnostics) — Guide officiel de diagnostic Node.js
- [SpiderMonkey Internals](https://firefox-source-docs.mozilla.org/js/index.html) — Documentation interne de SpiderMonkey
- [WebKit JavaScriptCore](https://webkit.org/blog/10308/speculation-in-javascriptcore/) — Spéculation dans JSC
- [Clinic.js — Documentation](https://clinicjs.org/documentation/) — Suite de diagnostic Node.js

---

## Défi

Vous recevez le rapport de monitoring suivant d'une application Node.js en production :

```
  Heure    Heap Used    RSS      Event Loop p99    GC Mark-Compact   Requêtes/s
  ======   =========    ======   ================  =================  ==========
  00:00    120 Mo       200 Mo   2.1 ms            -                  500
  02:00    180 Mo       280 Mo   2.3 ms            45 ms @ 01:47      480
  04:00    250 Mo       360 Mo   3.1 ms            78 ms @ 03:52      450
  06:00    340 Mo       450 Mo   5.2 ms            125 ms @ 05:38     420
  08:00    450 Mo       580 Mo   12.3 ms           189 ms @ 07:45     380
  10:00    580 Mo       720 Mo   25.1 ms           267 ms @ 09:31     320
  12:00    Killed (OOMKilled, exit code 137)
```

L'application est un serveur Express qui :
- Reçoit des fichiers JSON via POST (taille moyenne 50 Ko)
- Parse chaque fichier et en extrait des données structurées
- Stocke les résultats en base de données
- Maintient un cache en mémoire des 1 000 derniers résultats

Le code suspect :

```typescript
import { EventEmitter } from 'node:events';

const cache: Record<string, unknown> = {};
const emitter = new EventEmitter();

app.post('/upload', async (req: { body: string }, res: { json: (body: unknown) => void }) => {
  const data = JSON.parse(req.body) as { id: string; items: Array<{ type: string; value: number; extra?: unknown }> };
  const result = processData(data);

  cache[result.id] = result;

  emitter.on('flush', () => {
    flushToDatabase(cache);
  });

  res.json({ id: result.id, status: 'ok' });
});

function processData(data: { id: string; items: Array<{ type: string; value: number; extra?: unknown }> }): { id: string; records: Record<string, unknown>[]; raw: unknown } {
  const records: Record<string, unknown>[] = [];
  for (const item of data.items) {
    const copy: Record<string, unknown> = JSON.parse(JSON.stringify(item));
    if (item.type === 'A') {
      copy.score = item.value * 2;
    }
    if (item.type === 'B') {
      copy.score = item.value * 3;
      copy.bonus = item.extra;
    }
    records.push(copy);
  }
  return { id: data.id, records, raw: data };
}
```

**Questions** :

1. Identifiez **au moins 5 problèmes** dans ce code qui expliquent le
   rapport de monitoring.

2. Pour chaque problème, indiquez quel outil vous utiliseriez pour le
   confirmer.

3. Proposez une version corrigée du code.

4. Estimez l'impact de chaque correction sur les métriques du rapport.

<details>
<summary>Réponse</summary>

**5+ problèmes identifiés :**

1. **Fuite mémoire — cache objet sans limite** (`cache[result.id] = result`)
   Le `cache` est un objet plain qui grandit sans cesse. Il n'y a aucune
   éviction. Chaque POST ajoute une entrée, jamais supprimée.
   - Outil : heap snapshots comparés (3 snapshots)
   - Fix : LRU cache borné (`new Map()` + éviction à 1000 entrées)

2. **Fuite mémoire — listeners accumulés** (`emitter.on('flush', ...)`)
   Un nouveau listener est ajouté à CHAQUE requête POST, mais jamais retiré.
   Après 100 000 requêtes, il y a 100 000 closures dans l'emitter.
   - Outil : `emitter.listenerCount('flush')` ou heap snapshot (retainers)
   - Fix : enregistrer le listener UNE SEULE FOIS hors du handler, ou
     utiliser `{ once: true }`

3. **Fuite mémoire — `raw: data` dans le résultat** (`return { ..., raw: data }`)
   Chaque résultat en cache retient l'INTÉGRALITÉ du JSON d'entrée (50 Ko).
   Avec un cache qui grandit, ça accumule des Mo de données brutes inutiles.
   - Outil : heap snapshot, inspecter les retainers des grosses chaînes
   - Fix : ne pas stocker `raw` dans le résultat cache

4. **Shapes inconsistantes** dans `processData`
   Les records ont des propriétés différentes selon `item.type` :
   type A a `{ score }`, type B a `{ score, bonus }`.
   Ça crée des shapes inconsistantes => déoptimisation.
   - Outil : `--trace-deopt`, `--trace-ic`
   - Fix : toujours inclure toutes les propriétés (`bonus: null` pour type A)

5. **JSON.parse/stringify inutile** dans `processData`
   Deep clone de chaque item via JSON round-trip dans une boucle chaude.
   - Outil : `--cpu-prof` (flame chart montre JSON.parse comme hotspot)
   - Fix : copie superficielle avec spread `{ ...item }`

6. **Cache objet plain au lieu de Map**
   `cache[result.id] = result` utilise un objet comme dictionnaire.
   V8 va éventuellement passer en "slow mode" (dictionary mode) avec
   beaucoup de clés. Une `Map` est plus efficace pour les clés dynamiques.
   - Outil : `%HasFastProperties(cache)` avec `--allow-natives-syntax`
   - Fix : utiliser `new Map()`

**Version corrigée :**

```typescript
import { EventEmitter } from 'node:events';

// FIX 1+6 : Map bornée au lieu d'objet sans limite
class LRUCache<V> {
  private _map: Map<string, V>;
  private _max: number;

  constructor(max: number) {
    this._map = new Map();
    this._max = max;
  }
  set(key: string, value: V): void {
    if (this._map.has(key)) this._map.delete(key);
    else if (this._map.size >= this._max) {
      this._map.delete(this._map.keys().next().value!);
    }
    this._map.set(key, value);
  }
  get values(): Map<string, V> { return this._map; }
}

interface ProcessedResult {
  id: string;
  records: Array<{ score: number; bonus: unknown; [key: string]: unknown }>;
}

const cache = new LRUCache<ProcessedResult>(1_000);
const emitter = new EventEmitter();

// FIX 2 : listener enregistré UNE SEULE FOIS
emitter.on('flush', () => {
  flushToDatabase(cache.values);
});

app.post('/upload', async (req: { body: string }, res: { json: (body: unknown) => void }) => {
  const data = JSON.parse(req.body) as { id: string; items: Array<{ type: string; value: number; extra?: unknown }> };
  const result: ProcessedResult = processData(data);

  cache.set(result.id, result); // FIX 1 : cache borné

  res.json({ id: result.id, status: 'ok' });
});

function processData(data: { id: string; items: Array<{ type: string; value: number; extra?: unknown }> }): ProcessedResult {
  const records = new Array<{ score: number; bonus: unknown; [key: string]: unknown }>(data.items.length); // Pré-allocation
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    // FIX 4 : shapes consistantes + FIX 5 : pas de JSON clone
    records[i] = {
      ...item,
      score: item.type === 'A' ? item.value * 2
           : item.type === 'B' ? item.value * 3
           : 0,
      bonus: item.type === 'B' ? item.extra : null, // FIX 4
    };
  }
  return { id: data.id, records }; // FIX 3 : pas de raw
}
```

**Impact estimé :**
- Heap stabilisé à ~150-200 Mo (au lieu de OOM à 12h)
- GC Mark-Compact < 30ms (au lieu de 267ms)
- Event loop p99 < 5ms (au lieu de 25ms)
- Requêtes/s stables à ~500 (au lieu de dégradation vers 320)

</details>

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 15 debugging](../screencasts/screencast-15-debugging.md)
2. **Lab** : [lab-15-debugging-session](../labs/lab-15-debugging-session/README)
3. **Quiz** : [quiz 15 debugging](../quizzes/quiz-15-debugging.html)
:::

---

<!-- navigation-inter-cours -->

::: info Cours suivant
Bravo, tu as termine le cours **JS Runtime** ! 
Le prochain cours du curriculum est **Vue.js**.

[Commencer Vue.js →](../../03-vue/cours/01-debutant/00-typer-vue3.md)
:::
