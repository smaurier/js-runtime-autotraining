# Module 14 — Projet Final

> **Objectif** : Consolider l'ensemble des connaissances acquises dans ce cours en réalisant un projet en trois parties : implémenter un mini event loop, construire un scheduler de tâches coopératif, et réaliser un audit de performance sur un programme volontairement défaillant.

> **Difficulté** : ⭐⭐⭐⭐⭐ (Synthèse) — Mobilise tout ce que tu as appris.

---

## Prérequis

Ce projet final mobilise les connaissances de **tous les modules précédents** :

| Module | Connaissances mobilisées |
|--------|--------------------------|
| 01 — Call Stack & Contexte d'exécution | Simulation de la pile d'appels |
| 02 — Scope, Closures & Mémoire | Closures dans les callbacks |
| 03 — Event Loop | Architecture et phases de la boucle d'événements |
| 04 — Microtasks & Macrotasks | Ordre d'exécution, priorité des microtâches |
| 05 — Promises Internals | Résolution de promesses, chaînage |
| 06 — Async/Await Under the Hood | Transformation async/await en state machine |
| 07 — Garbage Collector | Détection de fuites mémoire |
| 08 — Memory Leaks | Patterns de fuite et correction |
| 09 — V8 Engine Architecture | Pipeline de compilation, déoptimisations |
| 11 — Hidden Classes & Inline Caching | Formes d'objets, IC mégamorphiques |
| 12 — Performance Patterns | Profiling, anti-patterns, optimisation |
| 13 — Scheduling & Concurrence | Workers, time slicing, priorités |

---

## Théorie

> **Analogie pour débuter** : Ce projet final, c'est ta thèse. Tu vas construire les mécanismes que tu as étudiés dans les 14 modules précédents.

### 1. Vue d'ensemble du projet

Le projet se compose de trois parties indépendantes mais complémentaires.
Chaque partie teste un aspect différent de votre compréhension des internals
du runtime JavaScript.

```
  Architecture du projet final
  ==============================

  +-----------------------------------------------------+
  |                    Projet Final                      |
  +-----------------------------------------------------+
  |                                                     |
  |  Partie 1          Partie 2          Partie 3       |
  |  Mini Event Loop   Task Scheduler    Audit Perf     |
  |                                                     |
  |  +-------------+   +-------------+   +------------+ |
  |  | Call Stack  |   | Priority Q  |   | Profiling  | |
  |  | Microtask Q |   | Time Slice  |   | Memory     | |
  |  | Macrotask Q |   | Dependencies|   | Deopt      | |
  |  | Timers      |   | Cancellation|   | Blocking   | |
  |  +-------------+   +-------------+   +------------+ |
  |        |                  |                |         |
  |  Modules 01-06      Modules 12-13    Modules 07-12  |
  +-----------------------------------------------------+
```

### 2. Partie 1 — Mini Event Loop

#### 2.1. Spécification fonctionnelle

Vous devez implémenter une simulation de la boucle d'événements JavaScript
qui reproduit fidèlement le comportement du runtime.

```
  Architecture du Mini Event Loop
  =================================

  +----------------------------------------------------------+
  |                     MiniEventLoop                        |
  +----------------------------------------------------------+
  |                                                          |
  |  Call Stack (LIFO)         Microtask Queue (FIFO)        |
  |  +-----------------+       +-------------------------+   |
  |  | frame_2         |       | microTask_0 | microTask_1|  |
  |  | frame_1         |       +-------------------------+   |
  |  | frame_0 (main)  |                                     |
  |  +-----------------+       Macrotask Queue (FIFO)        |
  |                            +-------------------------+   |
  |  Timer Registry            | macroTask_0 | macroTask_1|  |
  |  +------------------+      +-------------------------+   |
  |  | id: 1, delay: 100|                                    |
  |  | id: 2, delay: 0  |      Rendering Pipeline            |
  |  | id: 3, delay: 50 |      (optionnel)                   |
  |  +------------------+      +-------------------------+   |
  |                            | requestAnimationFrame   |   |
  +----------------------------------------------------------+
  |                                                          |
  |  Horloge virtuelle : currentTime (ms)                    |
  |  Avance à chaque tick du loop                            |
  +----------------------------------------------------------+
```

#### 2.2. API requise

```typescript
class MiniEventLoop {
  constructor()

  // --- Pile d'appels ---
  pushFrame(name: string, fn: () => void): void
  popFrame(): void
  getCallStack(): string[]

  // --- Macrotasks ---
  setTimeout(callback: () => void, delay: number): number
  setImmediate(callback: () => void): number
  clearTimeout(id: number): void

  // --- Microtasks ---
  queueMicrotask(callback: () => void): void
  promiseResolve<T>(value: T): { then(cb: (val: T) => void): void }

  // --- Boucle principale ---
  tick(): boolean
  run(): void
  drain(): void

  // --- Observabilité ---
  onTaskExecuted(listener: (info: { type: string; name: string }) => void): void
  getStats(): { microtasksRun: number; macrotasksRun: number;
                currentTime: number; callStackDepth: number }
}
```

#### 2.3. Algorithme de la boucle — un tick

L'algorithme d'un cycle (tick) de votre event loop doit respecter cet ordre :

```
  Algorithme d'un tick()
  =======================

  1. Vérifier les timers expirés
     |
     | Pour chaque timer dont deadline <= currentTime :
     |   - Retirer le timer du registre
     |   - Ajouter son callback à la Macrotask Queue
     |
     v
  2. Exécuter UN macrotask (le premier de la file)
     |
     | - Dépiler le macrotask de la file
     | - Empiler un frame "macrotask:N" sur la call stack
     | - Exécuter le callback
     | - Dépiler le frame
     |
     v
  3. Drainer TOUTES les microtasks
     |
     | while (microtaskQueue.length > 0) {
     |   - Dépiler la microtask
     |   - Empiler un frame "microtask:N"
     |   - Exécuter le callback
     |   - Dépiler le frame
     |   - (si le callback ajoute de nouvelles microtasks,
     |      elles sont exécutées dans ce même drain)
     | }
     |
     v
  4. Avancer l'horloge virtuelle
     |
     | - Si aucune tâche n'a été exécutée, avancer au
     |   prochain timer expiré (fast-forward)
     | - Sinon, avancer de 1ms
     |
     v
  5. Retourner true si des tâches restent, false sinon
```

#### 2.4. Comportements critiques à implémenter

**Microtasks drainées avant le prochain macrotask :**

```typescript
const loop = new MiniEventLoop();

loop.setTimeout(() => console.log('A - macrotask 1'), 0);
loop.setTimeout(() => console.log('D - macrotask 2'), 0);

loop.queueMicrotask(() => {
  console.log('B - microtask 1');
  // Microtask ajoutée PENDANT le drain : doit s'exécuter AVANT macrotask 2
  loop.queueMicrotask(() => console.log('C - microtask 2'));
});

loop.run();
// Sortie attendue : A, B, C, D
// (PAS A, B, D, C — les microtasks sont drainées entre chaque macrotask)
```

**Timers respectent le délai :**

```typescript
const loop = new MiniEventLoop();
const order: string[] = [];

loop.setTimeout(() => order.push('100ms'), 100);
loop.setTimeout(() => order.push('50ms'), 50);
loop.setTimeout(() => order.push('0ms'), 0);

loop.run();
// order === ['0ms', '50ms', '100ms']
```

**Promise.resolve().then() est une microtask :**

```typescript
const loop = new MiniEventLoop();
const order: string[] = [];

loop.setTimeout(() => order.push('macro'), 0);
const p = loop.promiseResolve(42);
p.then((val) => order.push(`micro:${val}`));

loop.run();
// order === ['micro:42', 'macro']
// (les microtasks passent avant les macrotasks au premier drain)
```

### 3. Partie 2 — Task Scheduler

#### 3.1. Spécification fonctionnelle

Vous devez implémenter un scheduler coopératif de tâches avec gestion des
priorités, time slicing, annulation et dépendances.

```
  Architecture du Task Scheduler
  ================================

  +----------------------------------------------------------+
  |                   TaskScheduler                          |
  +----------------------------------------------------------+
  |                                                          |
  |  Priority Queues                                         |
  |  +----------+  +----------+  +----------+                |
  |  |  HIGH    |  |  NORMAL  |  |   LOW    |                |
  |  | task_0   |  | task_2   |  | task_5   |                |
  |  | task_1   |  | task_3   |  | task_6   |                |
  |  |          |  | task_4   |  |          |                |
  |  +----------+  +----------+  +----------+                |
  |       |              |             |                     |
  |       +-------+------+------+------+                     |
  |               v                                          |
  |         Scheduler Loop                                   |
  |         +----------------------------+                   |
  |         | 1. Pick highest-prio task  |                   |
  |         | 2. Run for <= timeBudget   |                   |
  |         | 3. If not done, re-queue   |                   |
  |         | 4. Yield to event loop     |                   |
  |         +----------------------------+                   |
  |                                                          |
  |  Dependency Graph                Time Tracker            |
  |  task_3 depends on [task_0]      performance.now()       |
  |  task_5 depends on [task_2,3]    timeBudget: 5ms         |
  +----------------------------------------------------------+
```

#### 3.2. API requise

```typescript
const PRIORITY = { HIGH: 0, NORMAL: 1, LOW: 2 } as const;

type PriorityLevel = typeof PRIORITY[keyof typeof PRIORITY];

interface SchedulerOptions {
  timeBudget?: number;
  yieldFn?: (fn: () => void) => void;
}

interface TaskOptions {
  priority?: PriorityLevel;
  name?: string;
  dependencies?: number[];
  signal?: AbortSignal;
}

interface TaskHandle {
  id: number;
  name: string;
  promise: Promise<unknown>;
  cancel(): void;
}

class TaskScheduler {
  constructor(options?: SchedulerOptions)
  // options.timeBudget : ms max par chunk (défaut: 5)
  // options.yieldFn   : fonction de yield (défaut: setTimeout(fn, 0))

  // --- Gestion des tâches ---
  schedule(taskFn: () => unknown | Promise<unknown>, options?: TaskOptions): TaskHandle
  // taskFn    : fonction (peut être async ou générateur)
  // options   : { priority, name, dependencies, signal }
  // retourne  : { id, name, promise, cancel() }
  //
  // priority     : PRIORITY.HIGH | NORMAL | LOW
  // name         : string (pour le debug)
  // dependencies : [taskId, taskId, ...] (attend la fin de ces tâches)
  // signal       : AbortSignal (pour annulation externe)

  // --- Contrôle ---
  start()          // Démarre le scheduler
  pause()          // Met en pause (finit le chunk en cours)
  resume()         // Reprend après pause
  cancelAll()      // Annule toutes les tâches en attente

  // --- Observabilité ---
  getStats()       // { pending, running, completed, cancelled,
                   //   avgTaskDuration, totalYields }
  onTaskComplete(listener)  // listener(taskInfo)
  onYield(listener)         // listener(yieldInfo)
}
```

#### 3.3. Tâche avec time slicing (fonctions génératrices)

Le scheduler doit supporter des tâches qui **cèdent le contrôle** via des
fonctions génératrices. Cela permet le time slicing : le scheduler peut
interrompre une longue tâche après N ms et la reprendre plus tard.

```typescript
// Tâche simple (non-interruptible)
scheduler.schedule(() => {
  return computeResult(data);
}, { priority: PRIORITY.NORMAL, name: 'compute' });

// Tâche interruptible (générateur)
scheduler.schedule(function* () {
  const results = [];
  for (let i = 0; i < 1_000_000; i++) {
    results.push(transform(data[i]));
    // yield permet au scheduler de vérifier le budget temps
    if (i % 1000 === 0) yield; // point de yield
  }
  return results;
}, { priority: PRIORITY.LOW, name: 'long-transform' });
```

```
  Exécution d'un générateur avec time slicing
  =============================================

  Tick 1 (budget: 5ms)          Tick 2 (budget: 5ms)
  +------------------------+    +------------------------+
  | gen.next() x 3000 iter |    | gen.next() x 3000 iter |
  | yield (2ms)            |    | yield (2ms)            |
  | gen.next() x 3000 iter |    | gen.next() x 3000 iter |
  | yield (4ms)            |    | yield (4ms)            |
  | gen.next() x 1000 iter |    | gen.next() x 2000 iter |
  | yield (5ms) BUDGET!    |    | { done: true }         |
  +----------+-------------+    +------------------------+
             |                         |
             v                         v
        yield au loop             tâche terminée
        (setTimeout 0)            resolve(results)
```

#### 3.4. Dépendances entre tâches

```
  Graphe de dépendances
  ======================

  task_A (HIGH) ----+
                    |----> task_C (NORMAL) ----> task_E (LOW)
  task_B (HIGH) ----+                    |
                                         |
  task_D (NORMAL) -----------------------+

  Exécution :
  1. task_A et task_B en parallèle (HIGH, pas de dépendances)
  2. task_D démarre aussi (NORMAL, pas de dépendances)
  3. task_C attend que A ET B soient terminées
  4. task_E attend que C ET D soient terminées
```

```typescript
const taskA: TaskHandle = scheduler.schedule(() => fetchData('A'), {
  priority: PRIORITY.HIGH, name: 'fetch-A'
});

const taskB: TaskHandle = scheduler.schedule(() => fetchData('B'), {
  priority: PRIORITY.HIGH, name: 'fetch-B'
});

const taskC: TaskHandle = scheduler.schedule((results: unknown[]) => merge(results), {
  priority: PRIORITY.NORMAL,
  name: 'merge',
  dependencies: [taskA.id, taskB.id],
});

const taskD: TaskHandle = scheduler.schedule(() => fetchData('D'), {
  priority: PRIORITY.NORMAL, name: 'fetch-D'
});

const taskE: TaskHandle = scheduler.schedule((results: unknown[]) => finalize(results), {
  priority: PRIORITY.LOW,
  name: 'finalize',
  dependencies: [taskC.id, taskD.id],
});

// taskE.promise se résout quand tout est fini
const finalResult: unknown = await taskE.promise;
```

#### 3.5. Annulation

```typescript
// Annulation via cancel()
const task: TaskHandle = scheduler.schedule(function* (): Generator<unknown> {
  for (let i = 0; ; i++) {
    yield processChunk(i);
  }
}, { name: 'infinite-work' });

// Plus tard...
task.cancel(); // la tâche est retirée de la file
// task.promise est rejetée avec une erreur CancellationError

// Annulation via AbortSignal
const controller: AbortController = new AbortController();

scheduler.schedule(function* () {
  while (true) {
    yield pollForUpdates();
  }
}, { name: 'polling', signal: controller.signal });

// Plus tard...
controller.abort(); // équivalent à cancel()
```

### 4. Partie 3 — Audit de Performance

#### 4.1. Le programme à auditer

On vous fournit un programme Node.js volontairement mal écrit. Il contient
**au moins 8 problèmes de performance** dans les catégories suivantes :

```
  Catégories de problèmes à identifier
  =======================================

  +------------------+----------------------------------+
  | Catégorie        | Exemples de problèmes            |
  +------------------+----------------------------------+
  | Mémoire          | - Fuite via closure              |
  |                  | - Fuite via event listener        |
  |                  | - Allocation en hot loop          |
  |                  | - Tableau qui grandit sans limite |
  +------------------+----------------------------------+
  | CPU / Deopt      | - Hidden class thrashing          |
  |                  | - IC mégamorphique               |
  |                  | - Changement de type dans un      |
  |                  |   tableau (PACKED -> HOLEY)       |
  +------------------+----------------------------------+
  | Blocking         | - fs.readFileSync dans handler   |
  |                  | - Boucle CPU > 100ms             |
  |                  | - RegExp catastrophique (ReDoS)  |
  +------------------+----------------------------------+
  | Anti-patterns    | - JSON.parse/stringify en loop   |
  |                  | - Concaténation string en loop   |
  |                  | - for...in sur un tableau        |
  +------------------+----------------------------------+
```

#### 4.2. Le programme défaillant

```typescript
// broken-app.mjs — Programme à auditer
// Ce serveur HTTP traite des données de capteurs IoT

import http from 'node:http';
import fs from 'node:fs';

// ==========================================
// PROBLÈME 1 : Fuite mémoire — cache sans limite
// ==========================================
const cache: Record<string, { readings: Record<string, unknown>[]; metadata: unknown }> = {};

function getCachedData(sensorId: string): { readings: Record<string, unknown>[]; metadata: unknown } {
  if (!cache[sensorId]) {
    // Chaque nouveau capteur ajoute une entrée qui n'est JAMAIS nettoyée
    cache[sensorId] = {
      readings: [],
      metadata: JSON.parse(
        fs.readFileSync(`./sensors/${sensorId}.json`, 'utf8') // PROBLÈME 2
      ),
    };
  }
  return cache[sensorId];
}

// ==========================================
// PROBLÈME 3 : Hidden class thrashing
// ==========================================
function createReading(data: Record<string, unknown>): Record<string, unknown> {
  const reading: Record<string, unknown> = {};
  if (data.temperature !== undefined) {
    reading.temperature = data.temperature;
    reading.unit = 'celsius';
  }
  if (data.humidity !== undefined) {
    reading.humidity = data.humidity;
    reading.unit = '%';
  }
  if (data.pressure !== undefined) {
    reading.pressure = data.pressure;
    reading.unit = 'hPa';
  }
  reading.timestamp = Date.now();
  reading.id = Math.random().toString(36);  // PROBLÈME 4 : allocation string
  return reading;
}

// ==========================================
// PROBLÈME 5 : Mégamorphic IC
// ==========================================
function getReadingValue(reading: Record<string, unknown>): number {
  // Appelé avec des objets de formes très variées (voir createReading)
  return (reading.temperature || reading.humidity || reading.pressure || 0) as number;
}

// ==========================================
// PROBLÈME 6 : Boucle CPU-intensive bloquante
// ==========================================
function computeStatistics(readings: Record<string, unknown>[]): Record<string, unknown> {
  // Tri à chaque appel au lieu de maintenir une structure triée
  const sorted = readings.slice().sort((a, b) => {
    return getReadingValue(a) - getReadingValue(b);
  });

  let sum = 0;
  let output = '';
  for (const r of sorted) {
    const val: number = getReadingValue(r);
    sum += val;
    // PROBLÈME 7 : concaténation string en boucle
    output += `${r.id}:${val}\n`;
  }

  return {
    mean: sum / sorted.length,
    median: getReadingValue(sorted[Math.floor(sorted.length / 2)]),
    min: getReadingValue(sorted[0]),
    max: getReadingValue(sorted[sorted.length - 1]),
    report: output,
    // PROBLÈME 8 : deep clone inutile du tableau complet
    snapshot: JSON.parse(JSON.stringify(sorted)),
  };
}

// ==========================================
// Serveur HTTP
// ==========================================
const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  if (req.method === 'POST' && req.url === '/reading') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => {
      const data: Record<string, unknown> = JSON.parse(body);
      const sensorData = getCachedData(data.sensorId as string);
      const reading = createReading(data);
      sensorData.readings.push(reading);

      // Recalculer les stats à chaque lecture (PROBLÈME 6 aggravé)
      const stats = computeStatistics(sensorData.readings);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    });
  }
});

server.listen(3000, () => console.log('Server on :3000'));
```

#### 4.3. Méthodologie d'audit

Votre rapport doit suivre cette structure pour chaque problème identifié :

```
  Structure du rapport d'audit (par problème)
  =============================================

  1. IDENTIFICATION
     - Description du problème
     - Fichier et ligne(s) concernée(s)
     - Catégorie (mémoire / CPU / blocking / anti-pattern)

  2. IMPACT
     - Mesure AVANT correction (temps, mémoire, latence)
     - Outil utilisé pour la mesure (--cpu-prof, --trace-gc, etc.)

  3. EXPLICATION
     - Pourquoi c'est un problème (mécanisme V8 sous-jacent)
     - Module du cours qui couvre ce sujet

  4. CORRECTION
     - Code corrigé
     - Justification du choix de correction

  5. VÉRIFICATION
     - Mesure APRÈS correction
     - Comparaison avant/après (ratio d'amélioration)
```

### 5. Squelette de code de départ

#### 5.1. Squelette — Partie 1 (Mini Event Loop)

```typescript
// mini-event-loop.mjs — Squelette à compléter

export class MiniEventLoop {
  private _callStack: Array<{ name: string; fn: () => unknown }>;
  private _microtaskQueue: Array<() => void>;
  private _macrotaskQueue: Array<() => void>;
  private _timers: Map<number, { fn: () => void; deadline: number }>;
  private _nextTimerId: number;
  private _currentTime: number;
  private _stats: { microtasksRun: number; macrotasksRun: number };
  private _listeners: Array<(info: { type: string; name: string }) => void>;

  constructor() {
    this._callStack = [];
    this._microtaskQueue = [];
    this._macrotaskQueue = [];
    this._timers = new Map();
    this._nextTimerId = 1;
    this._currentTime = 0;
    this._stats = { microtasksRun: 0, macrotasksRun: 0 };
    this._listeners = [];
  }

  // --- Call Stack ---

  pushFrame(name: string, fn: () => unknown): void {
    // TODO: empiler { name, fn } sur this._callStack
    // Exécuter fn()
    // Gérer les erreurs (try/catch)
  }

  popFrame(): void {
    // TODO: dépiler le dernier frame
  }

  getCallStack(): string[] {
    return this._callStack.map(f => f.name);
  }

  // --- Timers (Macrotasks) ---

  setTimeout(callback: () => void, delay: number = 0): number {
    const id = this._nextTimerId++;
    // TODO: enregistrer le timer avec deadline = this._currentTime + delay
    return id;
  }

  setImmediate(callback: () => void): void {
    // TODO: ajouter directement à la macrotask queue (delay = 0)
  }

  clearTimeout(id: number): void {
    // TODO: retirer le timer du registre
  }

  // --- Microtasks ---

  queueMicrotask(callback: () => void): void {
    // TODO: ajouter à la microtask queue
  }

  promiseResolve(value: unknown): { then(cb: (val: unknown) => void): void } {
    // TODO: retourner un objet avec une méthode then(cb)
    // then(cb) doit ajouter une microtask qui appelle cb(value)
  }

  // --- Boucle principale ---

  drain(): void {
    // TODO: exécuter TOUTES les microtasks
    // Y compris celles ajoutées pendant le drain
    // CRITIQUE : boucle while, pas forEach
  }

  tick(): boolean {
    // TODO: implémenter l'algorithme décrit dans la section 2.3
    // 1. Vérifier timers expirés -> macrotask queue
    // 2. Exécuter UN macrotask
    // 3. Drainer toutes les microtasks
    // 4. Avancer l'horloge
    // 5. Retourner true/false
  }

  run(): void {
    // TODO: appeler tick() en boucle jusqu'à ce que tout soit vide
  }

  // --- Observabilité ---

  onTaskExecuted(listener: (info: { type: string; name: string }) => void): void {
    this._listeners.push(listener);
  }

  getStats(): { microtasksRun: number; macrotasksRun: number; currentTime: number; callStackDepth: number } {
    return {
      ...this._stats,
      currentTime: this._currentTime,
      callStackDepth: this._callStack.length,
    };
  }
}
```

#### 5.2. Squelette — Partie 2 (Task Scheduler)

```typescript
// task-scheduler.mjs — Squelette à compléter

export const PRIORITY = Object.freeze({ HIGH: 0, NORMAL: 1, LOW: 2 }) as const;

interface SchedulerOptions {
  timeBudget?: number;
  yieldFn?: () => Promise<void>;
}

interface TaskInfo {
  id: number;
  name: string;
  priority: number;
  state: string;
  taskFn: (() => unknown) | (() => Generator<unknown>);
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  dependencies: number[];
  signal: AbortSignal | null;
}

export class TaskScheduler {
  private _timeBudget: number;
  private _yieldFn: () => Promise<void>;
  private _queues: Array<TaskInfo[]>;
  private _nextId: number;
  private _running: boolean;
  private _paused: boolean;
  private _tasks: Map<number, TaskInfo>;
  private _stats: { pending: number; running: number; completed: number; cancelled: number; totalYields: number };
  private _completionListeners: Array<(info: TaskInfo) => void>;
  private _yieldListeners: Array<() => void>;

  constructor(options: SchedulerOptions = {}) {
    this._timeBudget = options.timeBudget ?? 5; // ms
    this._yieldFn = options.yieldFn ?? (() =>
      new Promise<void>(r => setTimeout(r, 0))
    );
    this._queues = [[], [], []]; // [HIGH, NORMAL, LOW]
    this._nextId = 1;
    this._running = false;
    this._paused = false;
    this._tasks = new Map(); // id -> taskInfo
    this._stats = {
      pending: 0, running: 0, completed: 0,
      cancelled: 0, totalYields: 0,
    };
    this._completionListeners = [];
    this._yieldListeners = [];
  }

  schedule(taskFn: (() => unknown) | (() => Generator<unknown>), options: { priority?: number; name?: string; dependencies?: number[]; signal?: AbortSignal } = {}): TaskHandle {
    const id = this._nextId++;
    const priority = options.priority ?? PRIORITY.NORMAL;
    const name = options.name ?? `task-${id}`;
    const dependencies = options.dependencies ?? [];
    const signal = options.signal ?? null;

    // TODO:
    // 1. Créer un objet taskInfo avec id, name, priority, state, etc.
    // 2. Créer une Promise (et stocker resolve/reject)
    // 3. Si signal fourni, écouter l'événement 'abort'
    // 4. Si des dépendances existent, attendre qu'elles soient résolues
    //    avant d'ajouter la tâche à la queue
    // 5. Retourner { id, name, promise, cancel() }

    return { id, name, promise: null, cancel: () => {} } as unknown as TaskHandle; // placeholder
  }

  start(): void {
    // TODO: démarrer la boucle d'exécution
    // Appeler _runLoop() qui exécute les tâches une par une
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    // TODO: relancer la boucle si nécessaire
  }

  cancelAll(): void {
    // TODO: annuler toutes les tâches en attente
    // Rejeter leurs promises avec CancellationError
  }

  async _runLoop(): Promise<void> {
    // TODO:
    // while (il y a des tâches ET pas en pause) {
    //   1. Choisir la tâche de plus haute priorité
    //   2. Si c'est un générateur, exécuter avec time slicing
    //   3. Si c'est une fonction simple, l'exécuter directement
    //   4. Yield au event loop
    // }
  }

  async _executeGenerator(gen: Generator<unknown>, taskInfo: TaskInfo): Promise<unknown> {
    // TODO:
    // Boucle :
    //   const start = performance.now()
    //   while (elapsed < this._timeBudget) {
    //     const { value, done } = gen.next()
    //     if (done) return value
    //     elapsed = performance.now() - start
    //   }
    //   yield au event loop (this._yieldFn)
    //   recommencer
  }

  getStats(): { pending: number; running: number; completed: number; cancelled: number; totalYields: number } { return { ...this._stats }; }
  onTaskComplete(listener: (info: TaskInfo) => void): void { this._completionListeners.push(listener); }
  onYield(listener: () => void): void { this._yieldListeners.push(listener); }
}
```

### 6. Jeux de tests

#### 6.1. Tests — Mini Event Loop

```typescript
// tests/event-loop.test.mjs
import { MiniEventLoop } from '../mini-event-loop.mjs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('MiniEventLoop', () => {
  it('exécute les microtasks avant les macrotasks', () => {
    const loop = new MiniEventLoop();
    const order: string[] = [];

    loop.setTimeout(() => order.push('macro'), 0);
    loop.queueMicrotask(() => order.push('micro'));

    loop.run();
    assert.deepStrictEqual(order, ['micro', 'macro']);
  });

  it('draine les microtasks imbriquées avant le macrotask suivant', () => {
    const loop = new MiniEventLoop();
    const order: string[] = [];

    loop.setTimeout(() => order.push('A'), 0);
    loop.setTimeout(() => order.push('D'), 0);
    loop.queueMicrotask(() => {
      order.push('B');
      loop.queueMicrotask(() => order.push('C'));
    });

    loop.run();
    assert.deepStrictEqual(order, ['B', 'C', 'A', 'D']);
  });

  it('respecte l\'ordre des timers par délai', () => {
    const loop = new MiniEventLoop();
    const order: string[] = [];

    loop.setTimeout(() => order.push('100ms'), 100);
    loop.setTimeout(() => order.push('50ms'), 50);
    loop.setTimeout(() => order.push('0ms'), 0);

    loop.run();
    assert.deepStrictEqual(order, ['0ms', '50ms', '100ms']);
  });

  it('promiseResolve().then() est une microtask', () => {
    const loop = new MiniEventLoop();
    const order: string[] = [];

    loop.setTimeout(() => order.push('macro'), 0);
    loop.promiseResolve(42).then((v: unknown) => order.push(`micro:${v}`));

    loop.run();
    assert.deepStrictEqual(order, ['micro:42', 'macro']);
  });

  it('clearTimeout annule un timer', () => {
    const loop = new MiniEventLoop();
    const order: string[] = [];

    const id: number = loop.setTimeout(() => order.push('cancelled'), 0);
    loop.setTimeout(() => order.push('kept'), 0);
    loop.clearTimeout(id);

    loop.run();
    assert.deepStrictEqual(order, ['kept']);
  });

  it('gère un scénario complexe d\'imbrication', () => {
    const loop = new MiniEventLoop();
    const order: string[] = [];

    loop.setTimeout(() => {
      order.push('T1');
      loop.queueMicrotask(() => {
        order.push('T1-micro');
        loop.queueMicrotask(() => order.push('T1-micro-micro'));
      });
    }, 0);

    loop.setTimeout(() => {
      order.push('T2');
    }, 0);

    loop.queueMicrotask(() => order.push('M1'));

    loop.run();
    assert.deepStrictEqual(order, ['M1', 'T1', 'T1-micro', 'T1-micro-micro', 'T2']);
  });

  it('maintient des statistiques correctes', () => {
    const loop = new MiniEventLoop();

    loop.setTimeout(() => {}, 0);
    loop.setTimeout(() => {}, 10);
    loop.queueMicrotask(() => {});
    loop.queueMicrotask(() => {});

    loop.run();
    const stats = loop.getStats();
    assert.equal(stats.macrotasksRun, 2);
    assert.equal(stats.microtasksRun, 2);
    assert.ok(stats.currentTime >= 10);
  });
});
```

#### 6.2. Tests — Task Scheduler

```typescript
// tests/scheduler.test.mjs
import { TaskScheduler, PRIORITY } from '../task-scheduler.mjs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('TaskScheduler', () => {
  it('exécute les tâches par ordre de priorité', async () => {
    const scheduler = new TaskScheduler();
    const order: string[] = [];

    scheduler.schedule(() => order.push('low'), {
      priority: PRIORITY.LOW, name: 'low'
    });
    scheduler.schedule(() => order.push('high'), {
      priority: PRIORITY.HIGH, name: 'high'
    });
    scheduler.schedule(() => order.push('normal'), {
      priority: PRIORITY.NORMAL, name: 'normal'
    });

    scheduler.start();
    // Attendre la fin de toutes les tâches
    await new Promise<void>(r => setTimeout(r, 100));

    assert.deepStrictEqual(order, ['high', 'normal', 'low']);
  });

  it('supporte l\'annulation', async () => {
    const scheduler = new TaskScheduler();
    const order: string[] = [];

    const task: TaskHandle = scheduler.schedule(() => order.push('cancelled'), {
      name: 'to-cancel'
    });
    scheduler.schedule(() => order.push('kept'), { name: 'keeper' });

    task.cancel();
    scheduler.start();
    await new Promise<void>(r => setTimeout(r, 100));

    assert.deepStrictEqual(order, ['kept']);
  });

  it('respecte les dépendances', async () => {
    const scheduler = new TaskScheduler();
    const order: string[] = [];

    const a: TaskHandle = scheduler.schedule(() => {
      order.push('A');
      return 'resultA';
    }, { name: 'A', priority: PRIORITY.HIGH });

    const b: TaskHandle = scheduler.schedule(() => {
      order.push('B');
    }, { name: 'B', priority: PRIORITY.HIGH, dependencies: [a.id] });

    scheduler.start();
    await b.promise;

    assert.deepStrictEqual(order, ['A', 'B']);
  });

  it('gère le time slicing avec les générateurs', async () => {
    const scheduler = new TaskScheduler({ timeBudget: 1 });
    let yieldCount = 0;

    scheduler.onYield(() => yieldCount++);

    const task: TaskHandle = scheduler.schedule(function* (): Generator<undefined, string> {
      for (let i = 0; i < 100_000; i++) {
        if (i % 1000 === 0) yield;
      }
      return 'done';
    }, { name: 'long-task' });

    scheduler.start();
    const result: unknown = await task.promise;

    assert.equal(result, 'done');
    assert.ok(yieldCount > 0, 'Le scheduler devrait avoir yield au moins une fois');
  });
});
```

### 7. Critères d'évaluation

```
  Grille d'évaluation
  =====================

  +-------------------+--------+----------+-----------+
  |                   | Bon    | Très bon | Excellent |
  |                   | (14+)  | (16+)    | (18+)     |
  +-------------------+--------+----------+-----------+
  | PARTIE 1          |        |          |           |
  | Event Loop        |        |          |           |
  +-------------------+--------+----------+-----------+
  | Microtask/Macro   | Ordre  | Drain    | Micro     |
  | ordering          | basique| complet  | imbriquées|
  |                   |        |          | récursives|
  +-------------------+--------+----------+-----------+
  | Timers            | Basique| Ordre    | clearTime |
  |                   |        | correct  | + horloge |
  |                   |        |          | virtuelle |
  +-------------------+--------+----------+-----------+
  | Promise simulation| then() | Chaînage | Rejet +   |
  |                   | simple | .then()  | .catch()  |
  |                   |        | .then()  |           |
  +-------------------+--------+----------+-----------+
  | Call stack trace  | Non    | Basique  | Complet   |
  |                   |        |          | avec noms |
  +-------------------+--------+----------+-----------+
  |                   |        |          |           |
  | PARTIE 2          |        |          |           |
  | Scheduler         |        |          |           |
  +-------------------+--------+----------+-----------+
  | Priorités         | 2 lvl  | 3 levels | Dynamic   |
  |                   |        | strict   | re-prio   |
  +-------------------+--------+----------+-----------+
  | Time slicing      | Non    | Budget   | Générateur|
  |                   |        | fixe     | + resume  |
  +-------------------+--------+----------+-----------+
  | Dépendances       | Non    | Linéaire | DAG +     |
  |                   |        | (A->B)   | détection |
  |                   |        |          | de cycles |
  +-------------------+--------+----------+-----------+
  | Annulation        | Non    | cancel() | Abort     |
  |                   |        |          | Signal    |
  +-------------------+--------+----------+-----------+
  |                   |        |          |           |
  | PARTIE 3          |        |          |           |
  | Audit Perf        |        |          |           |
  +-------------------+--------+----------+-----------+
  | Problèmes trouvés | 4/8    | 6/8      | 8/8       |
  +-------------------+--------+----------+-----------+
  | Mesures avant/    | Non    | Partiel  | Complet   |
  | après             |        |          | avec outil|
  +-------------------+--------+----------+-----------+
  | Explication V8    | Non    | Basique  | Détaillée |
  | du problème       |        |          | (module   |
  |                   |        |          | référencé)|
  +-------------------+--------+----------+-----------+
  | Corrections       | Partiel| Toutes   | Toutes +  |
  |                   |        | correctes| optimales |
  +-------------------+--------+----------+-----------+
```

### 8. Différences entre solution "bonne" et "excellente"

#### Partie 1 — Event Loop

**Bon** : l'event loop fonctionne pour les cas simples (un setTimeout, un
queueMicrotask, ordre de base respecté).

**Excellent** : l'event loop gère correctement :
- Les microtasks ajoutées pendant le drain d'autres microtasks
- Le chaînage de `.then().then()` avec passage de valeur
- La gestion d'erreurs dans les callbacks (try/catch, pas de crash)
- L'horloge virtuelle avec fast-forward (pas de boucle vide)
- Un mode verbose qui trace chaque opération (pour le debug)

#### Partie 2 — Task Scheduler

**Bon** : le scheduler exécute les tâches dans l'ordre des priorités,
supporte l'annulation basique.

**Excellent** : le scheduler supporte en plus :
- Le time slicing avec des générateurs (yield + reprise)
- La détection de dépendances circulaires (cycle dans le DAG)
- L'intégration avec `AbortSignal`
- Des métriques détaillées (temps d'attente, throughput, etc.)
- La capacité de re-prioriser une tâche en cours d'attente

#### Partie 3 — Audit

**Bon** : 4-5 problèmes identifiés avec corrections fonctionnelles.

**Excellent** : 8 problèmes identifiés avec :
- Mesures quantitatives avant/après pour chaque correction
- Référence au module du cours qui explique le mécanisme sous-jacent
- Utilisation de vrais outils de profiling (--cpu-prof, --trace-gc, etc.)
- Suggestions d'architecture (ex: cache LRU, stream processing, etc.)

---

## Démonstration

### Démo 1 — Event Loop minimal fonctionnel (référence)

```typescript
// demo-mini-loop.mjs
// Implémentation de référence minimale pour illustrer le concept

class DemoEventLoop {
  microtasks: Array<() => void>;
  macrotasks: Array<() => void>;
  timers: Array<{ id: number; fn: () => void; deadline: number }>;
  time: number;
  nextTimerId: number;

  constructor() {
    this.microtasks = [];
    this.macrotasks = [];
    this.timers = [];
    this.time = 0;
    this.nextTimerId = 1;
  }

  setTimeout(fn: () => void, delay: number = 0): number {
    const id = this.nextTimerId++;
    this.timers.push({ id, fn, deadline: this.time + delay });
    this.timers.sort((a, b) => a.deadline - b.deadline);
    return id;
  }

  queueMicrotask(fn: () => void): void {
    this.microtasks.push(fn);
  }

  promiseResolve(val: unknown): { then(cb: (v: unknown) => void): { then(cb: (v: unknown) => void): void } } {
    const self = this;
    return {
      then(cb: (v: unknown) => void) {
        self.queueMicrotask(() => cb(val));
        return self.promiseResolve(undefined);
      }
    };
  }

  drainMicrotasks(): void {
    while (this.microtasks.length > 0) {
      const fn = this.microtasks.shift()!;
      fn();
    }
  }

  tick(): boolean {
    // 1. Timers expirés -> macrotask queue
    while (this.timers.length > 0 && this.timers[0].deadline <= this.time) {
      const timer = this.timers.shift();
      this.macrotasks.push(timer.fn);
    }

    // 2. Exécuter un macrotask
    if (this.macrotasks.length > 0) {
      const task = this.macrotasks.shift()!;
      task();
    }

    // 3. Drainer les microtasks
    this.drainMicrotasks();

    // 4. Avancer le temps
    if (this.macrotasks.length === 0 && this.microtasks.length === 0) {
      if (this.timers.length > 0) {
        this.time = this.timers[0].deadline; // fast-forward
      }
    } else {
      this.time += 1;
    }

    return this.macrotasks.length > 0
      || this.microtasks.length > 0
      || this.timers.length > 0;
  }

  run(): void {
    let safety = 0;
    while (this.tick() && safety++ < 10000) {}
    if (safety >= 10000) console.warn('Safety limit reached');
  }
}

// --- Test ---
const loop = new DemoEventLoop();
const order: string[] = [];

loop.setTimeout(() => {
  order.push('T1');
  loop.queueMicrotask(() => {
    order.push('T1-micro');
    loop.queueMicrotask(() => order.push('T1-micro-micro'));
  });
}, 0);

loop.setTimeout(() => order.push('T2'), 0);
loop.setTimeout(() => order.push('T3-delayed'), 50);
loop.queueMicrotask(() => order.push('M1'));
loop.promiseResolve(99).then(v => order.push(`P:${v}`));

loop.run();

console.log('Ordre d\'exécution :', order);
console.log('Attendu           : M1, P:99, T1, T1-micro, T1-micro-micro, T2, T3-delayed');
console.log('Correct           :', JSON.stringify(order) ===
  JSON.stringify(['M1', 'P:99', 'T1', 'T1-micro', 'T1-micro-micro', 'T2', 'T3-delayed']));
```

### Démo 2 — Scheduler avec générateur et time slicing

```typescript
// demo-scheduler-generator.mjs
import { performance } from 'node:perf_hooks';

class DemoScheduler {
  budget: number;
  queue: Array<{ genFn: () => Generator<unknown>; name: string; resolve: (value: unknown) => void; reject: (reason: unknown) => void }>;

  constructor(budget: number = 5) {
    this.budget = budget; // ms
    this.queue = [];
  }

  schedule(genFn: () => Generator<unknown>, name: string = 'task'): Promise<unknown> {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
    this.queue.push({ genFn, name, resolve, reject });
    return promise;
  }

  async run(): Promise<void> {
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      const gen = task.genFn();
      let result: unknown;

      while (true) {
        const chunkStart: number = performance.now();
        let done = false;

        // Exécuter le générateur jusqu'au budget temps
        while (performance.now() - chunkStart < this.budget) {
          const step = gen.next();
          if (step.done) {
            result = step.value;
            done = true;
            break;
          }
        }

        if (done) {
          console.log(`  [${task.name}] terminé`);
          task.resolve(result);
          break;
        }

        // Budget épuisé : yield
        console.log(`  [${task.name}] yield après ${this.budget}ms`);
        await new Promise<void>(r => setTimeout(r, 0));
      }
    }
  }
}

// --- Test ---
const scheduler = new DemoScheduler(2); // budget de 2ms

const p1 = scheduler.schedule(function* () {
  let sum = 0;
  for (let i = 0; i < 1_000_000; i++) {
    sum += Math.sqrt(i);
    if (i % 10_000 === 0) yield; // point de yield
  }
  return sum;
}, 'sqrt-sum');

const p2 = scheduler.schedule(function* () {
  const arr = [];
  for (let i = 0; i < 500_000; i++) {
    arr.push(i * 2);
    if (i % 5_000 === 0) yield;
  }
  return arr.length;
}, 'array-build');

scheduler.run().then(async () => {
  console.log('sqrt-sum result  :', await p1);
  console.log('array-build count:', await p2);
});
```

### Démo 3 — Détection des 8 problèmes du programme défaillant

```typescript
// demo-audit-findings.mjs
// Ce script illustre comment détecter chacun des 8 problèmes

console.log('=== Audit de broken-app.mjs ===\n');

console.log('PROBLÈME 1 : Cache sans limite (fuite mémoire)');
console.log('  Ligne : const cache = {}');
console.log('  Impact : la mémoire croît indéfiniment avec le nombre de capteurs');
console.log('  Fix : utiliser un cache LRU avec taille maximale');
console.log('  Module : 08 — Memory Leaks\n');

console.log('PROBLÈME 2 : fs.readFileSync dans un handler HTTP');
console.log('  Ligne : fs.readFileSync(`./sensors/${sensorId}.json`)');
console.log('  Impact : bloque l\'event loop pendant le I/O disque');
console.log('  Fix : utiliser fs.promises.readFile (async)');
console.log('  Module : 03 — Event Loop\n');

console.log('PROBLÈME 3 : Hidden class thrashing dans createReading');
console.log('  Ligne : ajout conditionnel de temperature/humidity/pressure');
console.log('  Impact : chaque combinaison crée une hidden class différente');
console.log('  Fix : initialiser TOUTES les propriétés dans un ordre fixe');
console.log('  Module : 11 — Hidden Classes\n');

console.log('PROBLÈME 4 : Math.random().toString(36) dans hot path');
console.log('  Ligne : reading.id = Math.random().toString(36)');
console.log('  Impact : allocation de chaîne à chaque lecture');
console.log('  Fix : compteur numérique incrémental');
console.log('  Module : 12 — Performance Patterns\n');

console.log('PROBLÈME 5 : IC mégamorphique dans getReadingValue');
console.log('  Ligne : reading.temperature || reading.humidity || ...');
console.log('  Impact : objets de formes variées => megamorphic IC');
console.log('  Fix : normaliser la forme (toujours une prop "value")');
console.log('  Module : 11 — Hidden Classes\n');

console.log('PROBLÈME 6 : Tri complet à chaque requête');
console.log('  Ligne : readings.slice().sort(...)');
console.log('  Impact : O(n log n) à chaque insertion, copie du tableau');
console.log('  Fix : maintenir un tableau trié (insertion dichotomique)');
console.log('  Module : 12 — Performance Patterns\n');

console.log('PROBLÈME 7 : Concaténation string dans la boucle');
console.log('  Ligne : output += `${r.id}:${val}\\n`');
console.log('  Impact : O(n^2) en mémoire pour n lectures');
console.log('  Fix : Array.join() ou stream');
console.log('  Module : 12 — Performance Patterns\n');

console.log('PROBLÈME 8 : JSON.parse(JSON.stringify(sorted))');
console.log('  Ligne : snapshot: JSON.parse(JSON.stringify(sorted))');
console.log('  Impact : sérialisation + parsing de tout le dataset');
console.log('  Fix : supprimer le snapshot ou utiliser structuredClone');
console.log('  Module : 12 — Performance Patterns\n');

// --- Version corrigée (squelette) ---
console.log('=== Version corrigée (extrait) ===\n');

const correctedCode = `
import fs from 'node:fs/promises';

// Fix 1 : cache LRU avec taille maximale
class LRUCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const val = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }
  set(key, val) {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(key, val);
  }
}

// Fix 2 : lecture async
async function getCachedData(sensorId) {
  let data = sensorCache.get(sensorId);
  if (!data) {
    const raw = await fs.readFile(\`./sensors/\${sensorId}.json\`, 'utf8');
    data = { readings: [], metadata: JSON.parse(raw) };
    sensorCache.set(sensorId, data);
  }
  return data;
}

// Fix 3+5 : forme d'objet uniforme
let nextReadingId = 0;
function createReading(data) {
  return {
    temperature: data.temperature ?? null,
    humidity: data.humidity ?? null,
    pressure: data.pressure ?? null,
    value: data.temperature ?? data.humidity ?? data.pressure ?? 0,
    timestamp: Date.now(),
    id: nextReadingId++, // Fix 4 : compteur au lieu de string
  };
}
`;
console.log(correctedCode);
```

### Démo 4 — Benchmark avant/après correction (Problème 7)

```typescript
// demo-audit-benchmark.mjs
import { performance } from 'node:perf_hooks';

// Simuler des lectures de capteurs
const N = 50_000;
const readings = Array.from({ length: N }, (_, i) => ({
  id: `sensor-${i}`,
  val: Math.random() * 100,
}));

// --- AVANT : concaténation string en boucle ---
function reportBefore(readings: Array<{ id: string; val: number }>): string {
  let output = '';
  for (const r of readings) {
    output += `${r.id}:${r.val.toFixed(2)}\n`;
  }
  return output;
}

// --- APRÈS : Array.join ---
function reportAfter(readings: Array<{ id: string; val: number }>): string {
  const lines: string[] = new Array(readings.length);
  for (let i = 0; i < readings.length; i++) {
    lines[i] = `${readings[i].id}:${readings[i].val.toFixed(2)}`;
  }
  return lines.join('\n');
}

// Warmup
reportBefore(readings.slice(0, 100));
reportAfter(readings.slice(0, 100));

// Benchmark
const t1 = performance.now();
const r1 = reportBefore(readings);
const t2 = performance.now();
const r2 = reportAfter(readings);
const t3 = performance.now();

console.log('=== Problème 7 : Concaténation string ===');
console.log(`  AVANT (+=)      : ${(t2 - t1).toFixed(1)} ms`);
console.log(`  APRÈS (join)    : ${(t3 - t2).toFixed(1)} ms`);
console.log(`  Amélioration    : ${((t2 - t1) / (t3 - t2)).toFixed(1)}x`);
console.log(`  Tailles output  : ${r1.length} / ${r2.length}`);
```

### Démo 5 — Scheduler complet avec dépendances

```typescript
// demo-scheduler-deps.mjs
import { performance } from 'node:perf_hooks';

interface FullTask {
  id: number;
  fn: () => unknown | Promise<unknown>;
  deps: number[];
  name: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  promise: Promise<unknown>;
  cancelled: boolean;
}

class FullScheduler {
  tasks: Map<number, FullTask>;
  nextId: number;
  completed: Set<number>;

  constructor() {
    this.tasks = new Map();
    this.nextId = 1;
    this.completed = new Set();
  }

  schedule(fn: () => unknown | Promise<unknown>, deps: number[] = [], name: string = ''): { id: number; promise: Promise<unknown>; cancel: () => void } {
    const id = this.nextId++;
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
    this.tasks.set(id, {
      id, fn, deps, name: name || `task-${id}`,
      resolve, reject, promise, cancelled: false,
    });
    return { id, promise, cancel: () => { this.tasks.get(id)!.cancelled = true; } };
  }

  _getReady(): FullTask | null {
    for (const [id, task] of this.tasks) {
      if (task.cancelled) {
        task.reject(new Error('Cancelled'));
        this.tasks.delete(id);
        continue;
      }
      if (task.deps.every(d => this.completed.has(d))) {
        return task;
      }
    }
    return null;
  }

  _detectCycle(): boolean {
    // Simple DFS pour détecter les cycles
    const visited = new Set<number>();
    const stack = new Set<number>();

    const visit = (id: number): boolean => {
      if (stack.has(id)) return true; // cycle
      if (visited.has(id)) return false;
      visited.add(id);
      stack.add(id);
      const task = this.tasks.get(id);
      if (task) {
        for (const dep of task.deps) {
          if (this.tasks.has(dep) && visit(dep)) return true;
        }
      }
      stack.delete(id);
      return false;
    };

    for (const id of this.tasks.keys()) {
      if (visit(id)) return true;
    }
    return false;
  }

  async run(): Promise<void> {
    if (this._detectCycle()) {
      throw new Error('Dépendance circulaire détectée !');
    }

    while (this.tasks.size > 0) {
      const task = this._getReady();
      if (!task) {
        await new Promise<void>(r => setTimeout(r, 0));
        continue;
      }

      this.tasks.delete(task.id);
      const start: number = performance.now();

      try {
        const result: unknown = await task.fn();
        const duration: number = performance.now() - start;
        console.log(`  [${task.name}] terminé en ${duration.toFixed(1)}ms`);
        task.resolve(result);
      } catch (e) {
        task.reject(e);
      }

      this.completed.add(task.id);
    }
  }
}

// --- Test avec DAG de dépendances ---
const sched = new FullScheduler();

const fetch1 = sched.schedule(async () => {
  await new Promise(r => setTimeout(r, 20));
  return { users: 100 };
}, [], 'fetch-users');

const fetch2 = sched.schedule(async () => {
  await new Promise(r => setTimeout(r, 30));
  return { orders: 500 };
}, [], 'fetch-orders');

const merge = sched.schedule(async () => {
  return { merged: true };
}, [fetch1.id, fetch2.id], 'merge-data');

const report = sched.schedule(async () => {
  return 'rapport généré';
}, [merge.id], 'generate-report');

console.log('=== Exécution du DAG ===');
console.log('  fetch-users ----+');
console.log('                  +--> merge-data --> generate-report');
console.log('  fetch-orders ---+\n');

sched.run().then(async () => {
  console.log('\nRésultat final:', await report.promise);
});
```

---

## Points clés

1. **Le mini event loop** est l'exercice fondamental pour vérifier que vous comprenez l'ordonnancement microtask/macrotask et le rôle de chaque file d'attente.
2. **L'ordre est critique** : les microtasks sont TOUJOURS drainées entièrement (y compris celles ajoutées pendant le drain) avant de passer au macrotask suivant.
3. **Le scheduler coopératif** repose sur le fait que les tâches cèdent volontairement le contrôle (via `yield` dans un générateur ou `await`).
4. **Le time slicing** nécessite un budget temps et une vérification régulière avec `performance.now()`.
5. **Les dépendances entre tâches** forment un DAG (graphe acyclique dirigé) — la détection de cycles est essentielle.
6. **L'annulation** doit être propagée proprement : rejeter la Promise, nettoyer les ressources, ne pas exécuter de code après l'annulation.
7. **L'audit de performance** est un exercice de rigueur : chaque affirmation doit être étayée par une mesure.
8. **La méthodologie** est plus importante que le résultat : un audit bien structuré (mesure, analyse, correction, vérification) vaut mieux qu'une liste de corrections sans justification.

### Note multi-moteurs (V8 / SpiderMonkey / JSC)

> Ton mini event loop et ton scheduler reposent sur la **spécification ECMAScript** et les APIs Web standard (setTimeout, queueMicrotask, Promise). Le comportement est donc **identique** quel que soit le moteur.
>
> Cependant, pour la **Partie 3 (audit de performance)**, les outils de diagnostic diffèrent :
>
> | Outil | V8 / Chrome / Node.js | SpiderMonkey / Firefox |
> |---|---|---|
> | Profiler CPU | Chrome DevTools → Performance | Firefox Profiler (profiler.firefox.com) |
> | Heap snapshot | Chrome DevTools → Memory | Firefox DevTools → Mémoire |
> | Flags JIT | `--trace-opt`, `--trace-deopt` | Pas d'équivalent CLI direct |
> | GC trace | `--trace-gc`, `--expose-gc` | `about:memory`, GC logging interne |
>
> **Conseil** : réalise l'audit dans Chrome/Node d'abord (les outils V8 sont plus détaillés), puis vérifie que les corrections améliorent aussi les performances dans Firefox. Un bon fix est **universel**.

---

## Lab associé

Ce module **est** le lab. Les trois parties constituent le projet final évalué.

**Livrables attendus :**

```
projet-final/
  |- mini-event-loop.mjs          (Partie 1)
  |- mini-event-loop.test.mjs     (tests unitaires)
  |- task-scheduler.mjs            (Partie 2)
  |- task-scheduler.test.mjs       (tests unitaires)
  |- audit/
  |    |- broken-app.mjs           (programme original, non modifié)
  |    |- fixed-app.mjs            (programme corrigé)
  |    |- rapport-audit.md         (rapport structuré)
  |    |- benchmarks/              (captures, profils, mesures)
  |- README.md                     (instructions d'exécution)
```

**Date limite** : 2 semaines après la fin du Module 13.

---

## Pour aller plus loin

- [WHATWG — HTML Living Standard: Event Loops](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops)
- [Node.js — Event Loop, Timers, and process.nextTick](https://nodejs.org/en/guides/event-loop-timers-and-nexttick)
- [V8 Blog — Trash talk: the Orinoco garbage collector](https://v8.dev/blog/trash-talk)
- [MDN — queueMicrotask](https://developer.mozilla.org/fr/docs/Web/API/queueMicrotask)
- [MDN — AbortController](https://developer.mozilla.org/fr/docs/Web/API/AbortController)
- [MDN — Scheduler API](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler)
- [TC39 — ECMAScript: Jobs and Host Operations](https://tc39.es/ecma262/#sec-jobs)
- [Jake Archibald — In The Loop (JSConf.Asia)](https://www.youtube.com/watch?v=cCOL7MC4Pl0)
- [Clinic.js — Documentation](https://clinicjs.org/documentation/)
- [web.dev — Optimize Long Tasks](https://web.dev/articles/optimize-long-tasks)

---

## Défi

Considérez cette implémentation d'un mini event loop. Elle contient
**3 bugs subtils**. Trouvez-les.

```typescript
class BuggyEventLoop {
  microtasks: Array<() => void>;
  macrotasks: Array<() => void>;
  timers: Array<{ fn: () => void; deadline: number }>;
  time: number;

  constructor() {
    this.microtasks = [];
    this.macrotasks = [];
    this.timers = [];
    this.time = 0;
  }

  setTimeout(fn: () => void, delay: number): void {
    this.timers.push({ fn, deadline: this.time + delay });
  }

  queueMicrotask(fn: () => void): void {
    this.microtasks.push(fn);
  }

  tick(): boolean {
    // Timers
    for (let i = 0; i < this.timers.length; i++) {
      if (this.timers[i].deadline <= this.time) {
        this.macrotasks.push(this.timers[i].fn);
        this.timers.splice(i, 1);  // <--- ligne A
      }
    }

    // Macrotask
    if (this.macrotasks.length > 0) {
      const task = this.macrotasks.shift();
      task();
    }

    // Microtasks
    const len = this.microtasks.length;  // <--- ligne B
    for (let i = 0; i < len; i++) {
      this.microtasks[i]();
    }
    this.microtasks.splice(0, len);

    this.time++;

    return this.macrotasks.length > 0
      || this.microtasks.length > 0
      || this.timers.length > 0;
  }

  run(): void {
    while (this.tick()) {}  // <--- ligne C
  }
}
```

<details>
<summary>Réponse</summary>

**Bug 1 — Ligne A : `splice(i, 1)` dans une boucle `for`**

Quand on supprime un élément avec `splice` à l'index `i`, tous les éléments
suivants sont décalés d'un cran vers la gauche. Mais `i++` dans le `for`
fait sauter l'élément suivant.

Exemple : `timers = [t0, t1, t2]`, tous expirés.
- i=0 : on supprime t0 -> timers = [t1, t2], i passe à 1
- i=1 : on traite t2 (pas t1 !) -> t1 est sauté

**Fix** : itérer en sens inverse (`for (let i = timers.length - 1; i >= 0; i--)`)
ou utiliser `filter()` pour créer un nouveau tableau.

```typescript
// Fix
const expired: Array<{ fn: () => void; deadline: number }> = this.timers.filter(t => t.deadline <= this.time);
this.timers = this.timers.filter(t => t.deadline > this.time);
for (const t of expired) {
  this.macrotasks.push(t.fn);
}
```

**Bug 2 — Ligne B : `const len = this.microtasks.length` avant la boucle**

Les microtasks doivent être drainées **complètement**, y compris celles
ajoutées pendant le drain. En fixant `len` avant la boucle, les nouvelles
microtasks ajoutées par les callbacks ne seront pas exécutées dans ce tick.

Selon la spécification, le drain des microtasks doit traiter TOUTES les
microtasks, y compris celles enqueued pendant l'exécution.

**Fix** : utiliser un `while` au lieu d'un `for` avec longueur fixe.

```typescript
// Fix
while (this.microtasks.length > 0) {
  const fn = this.microtasks.shift()!;
  fn();
}
```

**Bug 3 — Ligne C : `while (this.tick()) {}` ne traite pas les microtasks initiales**

Si des microtasks sont ajoutées avant le premier `tick()`, elles ne seront
traitées qu'APRÈS le premier macrotask. Or, selon la spécification, les
microtasks doivent être drainées AVANT le premier macrotask si elles sont
déjà présentes.

Plus précisément, dans `tick()`, l'ordre est : timers -> macrotask -> microtasks.
Mais si le programme commence par `loop.queueMicrotask(fn)` puis `loop.run()`,
la microtask ne sera exécutée qu'après le premier macrotask (s'il y en a un)
ou pas du tout (si `tick()` retourne `false` car il n'y a pas de macrotask
mais seulement des microtasks dans la file initiale).

En fait, le bug est plus subtil : si le premier `tick()` ne trouve pas de
macrotask, il exécute les microtasks, puis `time++`, et retourne `false`
car toutes les files sont vides. Mais si un timer a `delay=0` ET qu'une
microtask existe, l'ordre d'exécution sera `macrotask -> microtask` au lieu
de `microtask -> macrotask` (les microtasks pré-existantes devraient
passer en premier).

**Fix** : drainer les microtasks AU DÉBUT de chaque tick, avant de traiter
les macrotasks.

```typescript
tick(): boolean {
  // 1. D'abord drainer les microtasks existantes
  this.drainMicrotasks();

  // 2. Puis timers -> macrotask queue
  // 3. Exécuter UN macrotask
  // 4. Drainer les nouvelles microtasks
  // ...
}
```

</details>
