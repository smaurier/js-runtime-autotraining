# Module 13 — Scheduling & Concurrence

> **Objectif** : Comprendre et maîtriser les mécanismes de planification de tâches et de concurrence en JavaScript, depuis le modèle mono-thread avec I/O asynchrone jusqu'au vrai parallélisme avec Workers, SharedArrayBuffer et les API de scheduling modernes.

> **Difficulté** : ⭐⭐⭐ (Avancé)

---

## Prérequis

- Module 07 — Event Loop (boucle d'événements, macrotâches, microtâches, phases Node.js)
- Module 08 — Async Internals (Promises, async/await, files d'attente)
- Module 12 — Performance Patterns (profiling, anti-patterns)
- Aucune connaissance préalable des threads nécessaire (introduit dans ce module)

---

## Théorie

> **Analogie pour débuter** : Le scheduling, c'est comme un chef d'orchestre. Il ne joue d'aucun instrument lui-même (single-threaded), mais il coordonne tous les musiciens (tâches) pour que la symphonie sonne bien.

### 1. Le modèle de concurrence JavaScript

JavaScript utilise un modèle **mono-thread avec I/O asynchrone non-bloquant**.
Cela signifie qu'un seul contexte d'exécution JS tourne à la fois, mais les
opérations d'I/O (réseau, disque, timers) sont déléguées au système d'exploitation
et ne bloquent pas le thread principal.

```
  Modèle de concurrence JS
  =========================

  Thread principal JS
  +--------------------------------------------------+
  |  Call Stack    |  Microtask Queue  | Macrotask Q  |
  |  +---------+   |  [p1] [p2] [p3]   | [t1] [t2]   |
  |  | func()  |   |                   |              |
  |  +---------+   |                   |              |
  |  | main()  |   |                   |              |
  |  +---------+   |                   |              |
  +--------------------------------------------------+
          |
          | délègue I/O
          v
  +--------------------------------------------------+
  |  Libuv / OS threads (pool de threads)            |
  |  [DNS] [File I/O] [Crypto] [Compression]         |
  +--------------------------------------------------+
          |
          | callbacks
          v
  Retour dans la Macrotask Queue
```

**Conséquence fondamentale** : toute opération CPU-intensive exécutée sur le
thread principal bloque l'ensemble de l'application (UI freeze dans le
navigateur, latence des requêtes dans Node.js).

### Rappel : qu'est-ce qu'un thread ?

Si tu n'as jamais travaillé avec des threads, voici l'essentiel :

> **Analogie** : imagine un restaurant avec **un seul cuisinier** (= 1 thread). Il doit tout faire en séquence : couper les légumes, faire cuire la viande, préparer la sauce. C'est JavaScript : mono-thread.
>
> Ajouter des **cuisiniers supplémentaires** (= threads) permet de cuisiner en parallèle. Mais il faut se coordonner : deux cuisiniers ne peuvent pas utiliser le **même couteau** en même temps. Si l'un lit un ingrédient pendant que l'autre le modifie, on obtient un résultat incohérent — c'est une **race condition**.

**Vocabulaire clé :**

| Terme | Définition simple |
|-------|------------------|
| **Thread** | Un fil d'exécution indépendant. Chaque thread exécute du code en parallèle des autres. |
| **Race condition** | Quand deux threads accèdent à la même donnée en même temps et que le résultat dépend de l'ordre d'exécution (imprévisible). |
| **Mutex / Lock** | Un mécanisme pour empêcher deux threads d'accéder à la même ressource en même temps (comme un verrou sur la porte de la cuisine). |
| **Mémoire partagée** | Une zone mémoire accessible par plusieurs threads. C'est ce que `SharedArrayBuffer` permet en JavaScript. |

JavaScript contourne ces problèmes en étant **mono-thread par défaut**. Les Web Workers et Worker Threads ajoutent du parallélisme, mais chaque Worker a **sa propre mémoire isolée** — sauf si tu utilises explicitement `SharedArrayBuffer`.

> **Pas de panique** : dans 99% des cas en JavaScript, tu n'auras jamais de race condition parce que le modèle par défaut (message passing via `postMessage`) est sûr. `SharedArrayBuffer` + `Atomics` sont des outils avancés pour les cas rares ou la copie de données est trop coûteuse.

### 2. Web Workers / Worker Threads : vrai parallélisme

Les Workers fournissent du **vrai parallélisme** en créant des threads séparés,
chacun avec son propre contexte JavaScript (heap, call stack, event loop).

```
  Architecture multi-workers
  ===========================

  +-------------------+     +-------------------+
  |  Thread principal |     |  Worker Thread 1  |
  |  +--------------+ |     |  +--------------+ |
  |  | Event Loop   | |     |  | Event Loop   | |
  |  | Call Stack   | |     |  | Call Stack   | |
  |  | Heap         | |     |  | Heap         | |
  |  +--------------+ |     |  +--------------+ |
  +--------+----------+     +--------+----------+
           |                          |
           |    postMessage(data)     |
           +------------------------->|
           |                          |
           |<-------------------------+
           |    postMessage(result)   |
           |                          |
  +--------+----------+     +--------+----------+
  |  Worker Thread 2  |     |  Worker Thread 3  |
  |  +--------------+ |     |  +--------------+ |
  |  | Event Loop   | |     |  | Event Loop   | |
  |  | Call Stack   | |     |  | Call Stack   | |
  |  | Heap         | |     |  | Heap         | |
  |  +--------------+ |     |  +--------------+ |
  +-------------------+     +-------------------+
```

**Navigateur — Web Workers :**

```typescript
// main.js
const worker = new Worker('worker.js');

worker.postMessage({ task: 'fibonacci', n: 45 });

worker.onmessage = (e) => {
  console.log('Résultat:', e.data.result);
  console.log('Durée:', e.data.duration, 'ms');
};

worker.onerror = (e) => {
  console.error('Erreur Worker:', e.message);
};
```

```typescript
// worker.js
function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

self.onmessage = (e: MessageEvent) => {
  const start = performance.now();
  const result = fibonacci(e.data.n);
  const duration = performance.now() - start;
  self.postMessage({ result, duration });
};
```

**Node.js — Worker Threads :**

```typescript
// main.mjs
import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL('./worker.mjs', import.meta.url));

worker.postMessage({ task: 'fibonacci', n: 45 });

worker.on('message', (msg) => {
  console.log('Résultat:', msg.result);
  console.log('Durée:', msg.duration, 'ms');
});

worker.on('error', (err) => {
  console.error('Erreur Worker:', err);
});
```

```typescript
// worker.mjs
import { parentPort } from 'node:worker_threads';

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

parentPort!.on('message', (msg: { n: number }) => {
  const start = performance.now();
  const result = fibonacci(msg.n);
  const duration = performance.now() - start;
  parentPort!.postMessage({ result, duration });
});
```

### 3. SharedArrayBuffer et Atomics

Par défaut, `postMessage` effectue un **structured clone** des données (copie
profonde). Pour les gros volumes de données, cette copie est coûteuse.

`SharedArrayBuffer` permet de partager de la mémoire entre threads.

> **Pré-requis navigateur** : depuis janvier 2018 (attaques Spectre/Meltdown),
> `SharedArrayBuffer` n'est disponible dans les navigateurs que si la page est
> servie avec les en-têtes d'**isolation cross-origin** :
> ```
> Cross-Origin-Opener-Policy: same-origin
> Cross-Origin-Embedder-Policy: require-corp
> ```
> Sans ces en-têtes, `new SharedArrayBuffer(...)` lève une `TypeError`.
> En Node.js, `SharedArrayBuffer` est toujours disponible sans restriction.

```
  Mémoire partagée
  =================

  Thread principal          SharedArrayBuffer          Worker Thread
  +----------------+    +---------------------+    +----------------+
  |                |    | Byte 0  | Byte 1    |    |                |
  | const sab =    |--->| Byte 2  | Byte 3    |<---| const sab =    |
  | new SAB(1024)  |    | ...     | ...       |    | workerData.sab |
  |                |    | Byte 1022| Byte 1023|    |                |
  +----------------+    +---------------------+    +----------------+
         |                       ^                        |
         |    Atomics.store()    |    Atomics.load()      |
         +-------> écriture -----+------- lecture --------+
                                 |
                    Atomics.wait() / Atomics.notify()
                    (synchronisation entre threads)
```

```typescript
// main.mjs — Partage mémoire avec un Worker
import { Worker } from 'node:worker_threads';

// Créer un buffer partagé de 1024 entiers 32-bit
const sharedBuffer = new SharedArrayBuffer(1024 * 4);
const sharedArray = new Int32Array(sharedBuffer);

// Initialiser les données
for (let i = 0; i < 1024; i++) {
  sharedArray[i] = i;
}

const worker = new Worker(new URL('./atomic-worker.mjs', import.meta.url), {
  workerData: { sharedBuffer },
});

// Attendre que le Worker ait fini (via Atomics)
worker.on('message', () => {
  // Lire les résultats directement depuis la mémoire partagée
  console.log('Somme calculée par le worker:', sharedArray[0]);
});
```

```typescript
// atomic-worker.mjs
import { parentPort, workerData } from 'node:worker_threads';

const sharedArray = new Int32Array(workerData.sharedBuffer);

// Calculer la somme dans le Worker
let sum = 0;
for (let i = 0; i < 1024; i++) {
  sum += Atomics.load(sharedArray, i); // lecture atomique
}

// Écrire le résultat de manière atomique
Atomics.store(sharedArray, 0, sum);

parentPort.postMessage('done');
```

#### Les opérations Atomics

```
  Opérations Atomics
  ===================

  Atomics.load(arr, idx)        Lecture atomique
  Atomics.store(arr, idx, val)  Écriture atomique
  Atomics.add(arr, idx, val)    Addition atomique (retourne l'ancienne valeur)
  Atomics.sub(arr, idx, val)    Soustraction atomique
  Atomics.and(arr, idx, val)    ET binaire atomique
  Atomics.or(arr, idx, val)     OU binaire atomique
  Atomics.xor(arr, idx, val)    XOR binaire atomique
  Atomics.exchange(arr, idx, v) Échange atomique
  Atomics.compareExchange(...)  Compare-and-swap (CAS)

  Synchronisation :
  Atomics.wait(arr, idx, val)   Bloque jusqu'à notification
  Atomics.notify(arr, idx, n)   Réveille n threads en attente
  Atomics.waitAsync(arr, idx, v) Version non-bloquante (Promise)
```

> **Attention** : `Atomics.wait()` est **interdit sur le thread principal**
> du navigateur car il est bloquant (il gèlerait l'UI). L'appeler depuis le
> main thread lève une `TypeError`. Utilisez `Atomics.waitAsync()` à la place,
> qui retourne une Promise et ne bloque pas. En Node.js, `Atomics.wait()` peut
> être appelé depuis n'importe quel thread (principal ou Worker).

### 4. Structured cloning et objets transférables

```
  postMessage — Clone vs Transfert
  ==================================

  Clone (défaut) :
  Thread A               Thread B
  +--------+             +--------+
  | data   |---copie---->| data'  |   Deux copies en mémoire
  | (1 Mo) |             | (1 Mo) |   Coût: O(n) copie
  +--------+             +--------+

  Transfert :
  Thread A               Thread B
  +--------+             +--------+
  | data   |--transfert->| data   |   Une seule copie déplacée
  | (vide) |             | (1 Mo) |   Coût: O(1), quasi-instantané
  +--------+             +--------+
  (data n'est plus
   utilisable ici)
```

```typescript
// Transfert d'un ArrayBuffer (coût O(1))
const buffer = new ArrayBuffer(1024 * 1024); // 1 Mo

// Le buffer est TRANSFÉRÉ, pas copié
worker.postMessage({ data: buffer }, [buffer]);
// buffer.byteLength === 0 après le transfert (neutered)

// Types transférables :
// - ArrayBuffer
// - MessagePort
// - ReadableStream
// - WritableStream
// - TransformStream
// - OffscreenCanvas (navigateur)
// - ImageBitmap (navigateur)
```

### 5. `requestAnimationFrame` — Synchronisé avec le rafraîchissement

`requestAnimationFrame` (rAF) est appelé par le navigateur juste avant le
repaint, synchronisé avec le taux de rafraîchissement de l'écran (60 Hz
typiquement = 16.67 ms par frame).

```
  Cycle de rendu navigateur
  ==========================

  |-- Frame (16.67ms @60Hz) --|-- Frame --|-- Frame --|
  |                            |            |            |
  | [Input] [rAF] [Layout]    | [Input]    | ...        |
  |         [Paint] [Compos.]  | [rAF]     |            |
  |                            | [Paint]   |            |
  |                            |            |            |

  rAF s'insère ICI dans le cycle :
  1. Traiter les événements d'entrée (click, scroll, etc.)
  2. Exécuter les callbacks requestAnimationFrame
  3. Calculer le layout (si DOM modifié)
  4. Peindre (Paint)
  5. Composite (GPU)
```

```typescript
// Animation fluide avec rAF
let lastTime: number = 0;
const speed = 200; // pixels par seconde

function animate(currentTime: number): void {
  const dt = (currentTime - lastTime) / 1000; // delta en secondes
  lastTime = currentTime;

  // Mise à jour basée sur le temps écoulé (frame-rate independent)
  element.style.transform = `translateX(${position}px)`;
  position += speed * dt;

  if (position < maxPosition) {
    requestAnimationFrame(animate);
  }
}

requestAnimationFrame(animate);
```

### 6. `requestIdleCallback` — Tâches pendant le temps mort

`requestIdleCallback` exécute du code quand le navigateur n'a rien d'autre
à faire, c'est-à-dire pendant les périodes d'inactivité entre les frames.

```
  Temps d'inactivité (idle time)
  ===============================

  Frame 16.67ms                Frame 16.67ms
  |-- travail --|-- idle --|    |-- travail --|-- idle --|
  |  10ms       |  6.67ms  |    |  12ms       |  4.67ms  |
  |             | ^^^^^^^^^|    |             | ^^^^^^^^ |
  |             | idle     |    |             | idle     |
  |             | callback |    |             | callback |

  Si le travail prend toute la frame => pas d'idle callback cette frame-ci
  |-- travail 16ms --|  (pas d'idle time)
```

```typescript
// Traiter une file de tâches non-urgentes pendant le temps mort
const taskQueue: (() => void)[] = [];

function scheduleIdleWork(): void {
  requestIdleCallback((deadline: IdleDeadline) => {
    // deadline.timeRemaining() : ms restantes dans la période idle
    while (taskQueue.length > 0 && deadline.timeRemaining() > 1) {
      const task = taskQueue.shift();
      task(); // exécuter une tâche
    }

    // S'il reste des tâches, replanifier
    if (taskQueue.length > 0) {
      scheduleIdleWork();
    }
  }, { timeout: 2000 }); // timeout max : garantit l'exécution sous 2s
}

// Ajouter des tâches non-urgentes
function addIdleTask(task: () => void): void {
  taskQueue.push(task);
  if (taskQueue.length === 1) {
    scheduleIdleWork();
  }
}

// Exemple : indexation en arrière-plan
addIdleTask(() => buildSearchIndex(documents.slice(0, 100)));
addIdleTask(() => buildSearchIndex(documents.slice(100, 200)));
addIdleTask(() => prefetchImages(nextPageImages));
```

### 7. Scheduler API (`scheduler.postTask`)

L'API Scheduler (actuellement supportée dans Chrome/Edge) permet de planifier
des tâches avec des **niveaux de priorité** explicites.

```
  Niveaux de priorité
  ====================

  Priorité          | Cas d'usage                    | Délai typique
  ------------------|--------------------------------|---------------
  "user-blocking"   | Réponse à un clic, saisie      | < 1 frame
  "user-visible"    | Rendu, mise à jour visible      | < 100ms
  "background"      | Analytics, prefetch, logs       | Quand possible

  File d'exécution :
  +--[ user-blocking ]--+--[ user-visible ]--+--[ background ]--+
  | Exécuté en premier  | Après user-blocking| Quand rien d'autre|
  +---------------------+--------------------+-------------------+
```

```typescript
// Planifier avec priorités
async function handleUserClick(): Promise<void> {
  // Haute priorité : mise à jour visuelle immédiate
  await scheduler.postTask(() => {
    updateButtonState('loading');
  }, { priority: 'user-blocking' });

  // Priorité normale : charger les données
  const data = await scheduler.postTask(async () => {
    return await fetch('/api/data').then(r => r.json());
  }, { priority: 'user-visible' });

  // Basse priorité : analytics
  scheduler.postTask(() => {
    sendAnalytics('button_clicked', data.id);
  }, { priority: 'background' });
}

// Annulation avec AbortController
const controller = new AbortController();

scheduler.postTask(() => {
  expensiveComputation();
}, {
  priority: 'background',
  signal: controller.signal,
});

// Plus tard, si la tâche n'est plus nécessaire :
controller.abort();
```

### 8. Time slicing : découper les longues tâches

Une tâche qui prend plus de 50ms est considérée comme une **Long Task** par le
navigateur, et bloque l'interactivité.

```
  Avant : une longue tâche bloquante
  ====================================
  |--- Tâche longue (300ms) --------------------------------|
  |  Input bloqué  |  Rendu bloqué  |  Tout gelé            |
  |-----------------------------------------------------------

  Après : time slicing
  =====================
  |-- Chunk 1 --|  yield  |-- Chunk 2 --|  yield  |-- Chunk 3 --|
  |   (50ms)    |  (rAF)  |   (50ms)    |  (rAF)  |   (50ms)    |
  |             |  rendu  |             |  rendu  |             |
  |             |  input  |             |  input  |             |
```

```typescript
// Pattern : time slicing avec setTimeout
async function processLargeArray<T>(items: T[], processFn: (item: T, index: number) => void, chunkSize: number = 100): Promise<void> {
  let index = 0;

  return new Promise((resolve) => {
    function processChunk(): void {
      const end = Math.min(index + chunkSize, items.length);

      for (; index < end; index++) {
        processFn(items[index], index);
      }

      if (index < items.length) {
        // Yield au navigateur : setTimeout(fn, 0) cède la main
        setTimeout(processChunk, 0);
      } else {
        resolve();
      }
    }

    processChunk();
  });
}

// Utilisation
await processLargeArray(millionItems, (item) => {
  transformAndStore(item);
});
```

```typescript
// Pattern moderne : scheduler.yield() (Chrome 129+)
async function processWithYield<T>(items: T[], processFn: (item: T, index: number) => void): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    processFn(items[i], i);

    // Yield périodiquement pour ne pas bloquer
    if (i % 100 === 0) {
      await scheduler.yield();
    }
  }
}
```

### 9. Node.js Worker Threads en profondeur

```typescript
// main.mjs — Pool de workers pour paralléliser du travail
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';

const NUM_WORKERS = cpus().length;

class WorkerPool {
  private workers: Worker[];
  private queue: { data: unknown; resolve: (value: unknown) => void; reject: (reason: unknown) => void }[];
  private freeWorkers: (Worker & { _currentTask?: { resolve: (value: unknown) => void; reject: (reason: unknown) => void } | null })[];

  constructor(workerPath: URL, size: number) {
    this.workers = [];
    this.queue = [];
    this.freeWorkers = [];

    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerPath);
      worker.on('message', (result) => {
        const { resolve } = worker._currentTask;
        resolve(result);
        worker._currentTask = null;
        this.freeWorkers.push(worker);
        this._processQueue();
      });
      worker.on('error', (err) => {
        const { reject } = worker._currentTask;
        reject(err);
        worker._currentTask = null;
        this.freeWorkers.push(worker);
        this._processQueue();
      });
      this.workers.push(worker);
      this.freeWorkers.push(worker);
    }
  }

  exec(data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push({ data, resolve, reject });
      this._processQueue();
    });
  }

  _processQueue(): void {
    while (this.queue.length > 0 && this.freeWorkers.length > 0) {
      const worker = this.freeWorkers.pop();
      const task = this.queue.shift();
      worker._currentTask = task;
      worker.postMessage(task.data);
    }
  }

  async destroy(): Promise<void> {
    for (const worker of this.workers) {
      await worker.terminate();
    }
  }
}

// Utilisation
const pool = new WorkerPool(new URL('./compute-worker.mjs', import.meta.url), NUM_WORKERS);

const results = await Promise.all([
  pool.exec({ task: 'hash', data: buffer1 }),
  pool.exec({ task: 'hash', data: buffer2 }),
  pool.exec({ task: 'hash', data: buffer3 }),
  pool.exec({ task: 'hash', data: buffer4 }),
]);

await pool.destroy();
```

### 10. Scheduling coopératif et yield vers l'event loop

En Node.js, il n'y a pas de `requestAnimationFrame` ni de `requestIdleCallback`.
Le pattern de yield utilise `setImmediate` ou `setTimeout(fn, 0)`.

```
  Node.js — Yield vers l'event loop
  ====================================

  setImmediate(fn)     : exécuté dans la phase "check" de l'event loop
                         (après I/O, avant les timers du prochain cycle)

  setTimeout(fn, 0)    : exécuté dans la phase "timers" du prochain cycle
                         (léger overhead du timer)

  process.nextTick(fn) : exécuté IMMÉDIATEMENT après l'opération courante
                         ATTENTION : ne yield PAS vraiment à l'event loop !

  Ordre dans un cycle event loop Node.js :
  +---------------------------------------------------+
  | timers -> pending -> idle -> poll -> check -> close|
  |  ^                                    ^            |
  |  setTimeout(fn,0)              setImmediate(fn)    |
  +---------------------------------------------------+
  | process.nextTick : entre CHAQUE phase (prioritaire)|
  +---------------------------------------------------+
```

```typescript
// Yield coopératif en Node.js
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function processLargeDataset<T>(dataset: T[]): Promise<unknown[]> {
  const results = [];
  for (let i = 0; i < dataset.length; i++) {
    results.push(heavyTransform(dataset[i]));

    // Toutes les 1000 itérations, yield pour laisser
    // l'event loop traiter les I/O en attente
    if (i % 1000 === 0) {
      await yieldToEventLoop();
    }
  }
  return results;
}
```

### 11. Pattern : implémentation d'un scheduler à priorités

```typescript
type Priority = 'high' | 'normal' | 'low';

interface ScheduledTask {
  fn: () => void | Promise<void>;
  priority: Priority;
  cancelled: boolean;
  cancel(): void;
}

class PriorityScheduler {
  private queues: Record<Priority, ScheduledTask[]>;
  private running: boolean;

  constructor() {
    // 3 files de priorité
    this.queues = {
      high: [],    // user-blocking
      normal: [],  // user-visible
      low: [],     // background
    };
    this.running = false;
  }

  schedule(fn: () => void | Promise<void>, priority: Priority = 'normal'): ScheduledTask {
    const task = {
      fn,
      priority,
      cancelled: false,
      cancel() { this.cancelled = true; },
    };
    this.queues[priority].push(task);
    if (!this.running) this._run();
    return task;
  }

  _nextTask(): ScheduledTask | null {
    // Priorité stricte : high > normal > low
    for (const level of ['high', 'normal', 'low'] as Priority[]) {
      while (this.queues[level].length > 0) {
        const task = this.queues[level].shift()!;
        if (!task.cancelled) return task;
      }
    }
    return null;
  }

  async _run(): Promise<void> {
    this.running = true;
    let task: ScheduledTask | null;

    while ((task = this._nextTask()) !== null) {
      const start = performance.now();

      try {
        await task.fn();
      } catch (e) {
        console.error('Task error:', e);
      }

      const elapsed = performance.now() - start;

      // Si on a dépassé 5ms, yield pour ne pas bloquer
      if (elapsed > 5) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    this.running = false;
  }
}
```

---

## Démonstration

### Démo 1 — Worker vs main thread : calcul de Fibonacci

```typescript
// demo-worker-vs-main.mjs
// Montre la différence entre bloquer le thread principal et utiliser un Worker
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

if (isMainThread) {
  const N = 42;

  // --- Test 1 : sur le thread principal ---
  console.log('=== Fibonacci sur le thread principal ===');
  const t1 = performance.now();
  const r1 = fibonacci(N);
  const t2 = performance.now();
  console.log(`  Résultat: ${r1}, Durée: ${(t2 - t1).toFixed(0)} ms`);

  // Simuler une requête I/O concurrente
  console.log('\n=== Test de réactivité pendant le calcul ===');

  let ioCompleted = false;
  const ioStart = performance.now();

  setTimeout(() => {
    ioCompleted = true;
    const ioDelay = performance.now() - ioStart;
    console.log(`  [Main thread] I/O callback — délai: ${ioDelay.toFixed(0)} ms`);
  }, 10);

  // Calcul sur main thread : bloque le callback I/O
  console.log('  Calcul en cours sur main thread...');
  const r2 = fibonacci(N);
  const t3 = performance.now();
  console.log(`  Calcul terminé: ${(t3 - t2).toFixed(0)} ms`);

  // --- Test 2 : sur un Worker ---
  setTimeout(() => {
    console.log('\n=== Fibonacci sur un Worker ===');
    const workerStart = performance.now();

    const worker = new Worker(new URL(import.meta.url));
    worker.postMessage(N);

    // Le callback I/O sera traité normalement cette fois
    const ioStart2 = performance.now();
    setTimeout(() => {
      const ioDelay2 = performance.now() - ioStart2;
      console.log(`  [Worker test] I/O callback — délai: ${ioDelay2.toFixed(0)} ms`);
    }, 10);

    worker.on('message', (result) => {
      const workerDuration = performance.now() - workerStart;
      console.log(`  Worker résultat: ${result}, Durée: ${workerDuration.toFixed(0)} ms`);
      worker.terminate();
    });
  }, 2000);

} else {
  // Code Worker
  parentPort!.on('message', (n: number) => {
    parentPort!.postMessage(fibonacci(n));
  });
}
```

### Démo 2 — SharedArrayBuffer : compteur atomique multi-thread

```typescript
// demo-shared-counter.mjs
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';

const NUM_WORKERS = 4;
const INCREMENTS_PER_WORKER = 1_000_000;

if (isMainThread) {
  // Buffer partagé : 2 compteurs (atomique et non-atomique)
  const sharedBuffer = new SharedArrayBuffer(8); // 2 x Int32
  const counters = new Int32Array(sharedBuffer);
  // counters[0] = compteur atomique
  // counters[1] = compteur non-atomique (race condition)

  const workers = [];
  let completed = 0;

  for (let i = 0; i < NUM_WORKERS; i++) {
    const w = new Worker(new URL(import.meta.url), { workerData: { sharedBuffer } });
    w.on('message', () => {
      completed++;
      if (completed === NUM_WORKERS) {
        const expected = NUM_WORKERS * INCREMENTS_PER_WORKER;
        console.log(`Valeur attendue          : ${expected.toLocaleString()}`);
        console.log(`Compteur atomique        : ${counters[0].toLocaleString()}`);
        console.log(`Compteur non-atomique    : ${counters[1].toLocaleString()}`);
        console.log(`Erreur atomique          : ${Math.abs(expected - counters[0])}`);
        console.log(`Erreur non-atomique      : ${Math.abs(expected - counters[1]).toLocaleString()}`);
        console.log(`Race condition détectée  : ${counters[1] !== expected ? 'OUI' : 'NON'}`);
      }
    });
    workers.push(w);
  }

} else {
  const counters = new Int32Array(workerData.sharedBuffer);

  for (let i = 0; i < INCREMENTS_PER_WORKER; i++) {
    // Incrément atomique (thread-safe)
    Atomics.add(counters, 0, 1);

    // Incrément non-atomique (race condition)
    counters[1]++;  // READ-MODIFY-WRITE non atomique !
  }

  parentPort.postMessage('done');
}
```

### Démo 3 — Time slicing avec mesure d'interactivité

```typescript
// demo-time-slicing.mjs
// Simule le time slicing en Node.js et mesure la réactivité de l'event loop
import { performance } from 'node:perf_hooks';

const TOTAL_ITEMS = 1_000_000;

// Simule un traitement coûteux
function heavyWork(item: number): number {
  let x = item;
  for (let i = 0; i < 100; i++) {
    x = Math.sin(x) * Math.cos(x);
  }
  return x;
}

// --- Version bloquante ---
async function processBlocking(items: number[]): Promise<{ results: Float64Array; duration: number }> {
  const results = new Float64Array(items.length);
  const start = performance.now();
  for (let i = 0; i < items.length; i++) {
    results[i] = heavyWork(items[i]);
  }
  return { results, duration: performance.now() - start };
}

// --- Version avec time slicing ---
async function processWithTimeSlicing(items: number[], chunkSize: number = 5000): Promise<{ results: Float64Array; duration: number }> {
  const results = new Float64Array(items.length);
  const start = performance.now();
  let index = 0;

  while (index < items.length) {
    const end = Math.min(index + chunkSize, items.length);
    for (let i = index; i < end; i++) {
      results[i] = heavyWork(items[i]);
    }
    index = end;

    // Yield à l'event loop
    await new Promise((r) => setImmediate(r));
  }

  return { results, duration: performance.now() - start };
}

// Mesurer la réactivité de l'event loop
function measureEventLoopLatency(durationMs: number): Promise<number[]> {
  return new Promise((resolve) => {
    const latencies: number[] = [];
    const start = performance.now();

    function check(): void {
      const now = performance.now();
      const expected = 10; // setInterval de 10ms
      const last = latencies.length > 0
        ? start + latencies.length * expected
        : start;
      latencies.push(now - last - expected);

      if (now - start < durationMs) {
        setTimeout(check, expected);
      } else {
        resolve(latencies);
      }
    }
    setTimeout(check, 10);
  });
}

// Exécution
const items = Array.from({ length: TOTAL_ITEMS }, (_, i) => i * 0.001);

console.log('=== Test 1 : traitement bloquant ===');
const latencyPromise1 = measureEventLoopLatency(5000);
const blocking = await processBlocking(items);
const latencies1 = await latencyPromise1;
console.log(`  Durée traitement : ${blocking.duration.toFixed(0)} ms`);
console.log(`  Latence event loop max : ${Math.max(...latencies1).toFixed(0)} ms`);
console.log(`  Latence event loop moyenne : ${(latencies1.reduce((a,b)=>a+b,0)/latencies1.length).toFixed(1)} ms`);

console.log('\n=== Test 2 : traitement avec time slicing ===');
const latencyPromise2 = measureEventLoopLatency(5000);
const sliced = await processWithTimeSlicing(items, 5000);
const latencies2 = await latencyPromise2;
console.log(`  Durée traitement : ${sliced.duration.toFixed(0)} ms`);
console.log(`  Latence event loop max : ${Math.max(...latencies2).toFixed(0)} ms`);
console.log(`  Latence event loop moyenne : ${(latencies2.reduce((a,b)=>a+b,0)/latencies2.length).toFixed(1)} ms`);
```

### Démo 4 — Scheduler à priorités en action

```typescript
// demo-priority-scheduler.mjs
import { performance } from 'node:perf_hooks';

class PriorityScheduler {
  constructor() {
    this.queues = { high: [], normal: [], low: [] };
    this.running = false;
    this.log = [];
  }

  schedule(name, fn, priority = 'normal') {
    const task = { name, fn, priority, cancelled: false };
    task.cancel = () => { task.cancelled = true; };
    this.queues[priority].push(task);
    if (!this.running) this._run();
    return task;
  }

  _nextTask() {
    for (const level of ['high', 'normal', 'low']) {
      while (this.queues[level].length > 0) {
        const task = this.queues[level].shift();
        if (!task.cancelled) return task;
      }
    }
    return null;
  }

  async _run() {
    this.running = true;
    let task;
    while ((task = this._nextTask()) !== null) {
      const start = performance.now();
      try {
        await task.fn();
      } catch (e) {
        console.error(`Erreur dans ${task.name}:`, e.message);
      }
      const duration = performance.now() - start;
      this.log.push({ name: task.name, priority: task.priority, duration });
      // Yield entre les tâches
      await new Promise((r) => setTimeout(r, 0));
    }
    this.running = false;
  }
}

// Utilisation
const scheduler = new PriorityScheduler();

// Simuler des tâches de différentes priorités
scheduler.schedule('analytics', () => {
  // Simule un envoi de données analytics
  let x = 0;
  for (let i = 0; i < 1_000_000; i++) x += Math.random();
  console.log('  [low] Analytics envoyés');
}, 'low');

scheduler.schedule('render-list', () => {
  // Simule un rendu de liste
  const items = Array.from({ length: 10000 }, (_, i) => `Item ${i}`);
  console.log(`  [normal] Liste rendue: ${items.length} éléments`);
}, 'normal');

scheduler.schedule('user-input', () => {
  // Simule la réponse à un input utilisateur
  console.log('  [high] Input utilisateur traité');
}, 'high');

scheduler.schedule('prefetch', () => {
  console.log('  [low] Prefetch terminé');
}, 'low');

scheduler.schedule('update-ui', () => {
  console.log('  [normal] UI mise à jour');
}, 'normal');

scheduler.schedule('critical-click', () => {
  console.log('  [high] Click critique traité');
}, 'high');

// Annulation
const analyticsTask2 = scheduler.schedule('analytics-2', () => {
  console.log('  [low] Analytics 2 (ne devrait pas apparaître)');
}, 'low');
analyticsTask2.cancel();

// Attendre la fin
setTimeout(() => {
  console.log('\n=== Ordre d\'exécution ===');
  for (const entry of scheduler.log) {
    console.log(`  [${entry.priority.padEnd(6)}] ${entry.name} (${entry.duration.toFixed(1)}ms)`);
  }
}, 3000);
```

### Démo 5 — Transferable objects : performance postMessage

```typescript
// demo-transferable.mjs
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

if (isMainThread) {
  const SIZES = [1_024, 10_240, 102_400, 1_024_000, 10_240_000];

  const worker = new Worker(new URL(import.meta.url));

  let testIndex = 0;

  function runTest() {
    if (testIndex >= SIZES.length) {
      worker.terminate();
      return;
    }

    const size = SIZES[testIndex];
    const label = `${(size / 1024).toFixed(0)} Ko`;

    // --- Test Clone ---
    const bufClone = new ArrayBuffer(size);
    new Uint8Array(bufClone).fill(42);

    const t1 = performance.now();
    worker.postMessage({ mode: 'echo', data: bufClone }); // clone
    const clonePostTime = performance.now() - t1;

    worker.once('message', () => {
      // --- Test Transfer ---
      const bufTransfer = new ArrayBuffer(size);
      new Uint8Array(bufTransfer).fill(42);

      const t2 = performance.now();
      worker.postMessage({ mode: 'echo', data: bufTransfer }, [bufTransfer]); // transfer
      const transferPostTime = performance.now() - t2;

      console.log(`${label.padStart(10)} | clone: ${clonePostTime.toFixed(3)}ms | transfer: ${transferPostTime.toFixed(3)}ms | neutered: ${bufTransfer.byteLength === 0}`);

      worker.once('message', () => {
        testIndex++;
        runTest();
      });
    });
  }

  console.log('    Taille | Clone (postMessage) | Transfer     | Neutered');
  console.log('    -------|---------------------|--------------|--------');
  runTest();

} else {
  parentPort.on('message', (msg) => {
    parentPort.postMessage('ack');
  });
}
```

---

### V8 vs SpiderMonkey (Firefox)

Le scheduling et la concurrence en JavaScript reposent en grande partie sur des **API standardisées** (spécifiées par le W3C, WHATWG ou TC39), ce qui signifie que le comportement est le même dans tous les navigateurs. Les différences sont mineures.

**Comparaison par API :**

| API | Chrome (V8) | Firefox (SpiderMonkey) | Safari (JSC) | Node.js |
|---|---|---|---|---|
| Web Workers | Oui | Oui | Oui | Non (Worker Threads à la place) |
| Worker Threads | Non (navigateur) | Non (navigateur) | Non (navigateur) | **Oui** (spécifique Node.js) |
| SharedArrayBuffer + Atomics | Oui (avec COOP/COEP) | Oui (avec COOP/COEP) | Oui (avec COOP/COEP) | Oui (sans restriction) |
| requestAnimationFrame | Oui | Oui | Oui | Non |
| requestIdleCallback | Oui | Oui | Non (pas supporté) | Non |
| scheduler.postTask | Oui (Chrome 94+) | Non (pas encore supporté) | Non | Non |
| scheduler.yield | Oui (Chrome 129+) | Non | Non | Non |

**Points clés :**

- **Web Workers** : l'API est **identique** dans tous les navigateurs (même constructeur, même `postMessage`, même `onmessage`). Le code écrit pour Chrome fonctionne tel quel dans Firefox et Safari.
- **SharedArrayBuffer + Atomics** : la spécification est la même partout. La seule contrainte est l'obligation d'envoyer les en-têtes **COOP/COEP** (Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy) pour activer SharedArrayBuffer dans les navigateurs (suite aux attaques Spectre). En Node.js, aucune restriction.
- **requestAnimationFrame et requestIdleCallback** : ce sont des API navigateur standardisées, pas des API moteur JS. Elles fonctionnent de la même façon dans Chrome et Firefox. Attention : `requestIdleCallback` n'est **pas supporté dans Safari**.
- **scheduler.postTask** : à ce jour, cette API est **principalement supportée dans Chrome/Edge**. Il faut vérifier la compatibilité navigateur (caniuse.com) avant de l'utiliser en production.
- **Node.js Worker Threads** : c'est une API **spécifique à Node.js** qui n'existe pas dans les navigateurs. L'équivalent navigateur est Web Workers.

> **À retenir** : pour le scheduling et la concurrence, la plupart des API sont standardisées et fonctionnent de la même façon dans tous les navigateurs. Les exceptions sont `scheduler.postTask` (Chrome principalement) et `requestIdleCallback` (pas dans Safari). En Node.js, Worker Threads remplace Web Workers.

---

## Points clés

1. **JavaScript est mono-thread** mais gère la concurrence via l'event loop et l'I/O asynchrone. Toute opération CPU-intensive bloque le thread principal.
2. **Les Workers** (Web Workers / Worker Threads) offrent du vrai parallélisme avec des contextes JS isolés et leur propre heap.
3. **`SharedArrayBuffer`** permet le partage de mémoire entre threads, mais nécessite des **`Atomics`** pour éviter les race conditions.
4. **Les objets transférables** (`ArrayBuffer`, `MessagePort`, etc.) permettent un `postMessage` en O(1) au lieu d'une copie O(n).
5. **`requestAnimationFrame`** synchronise le code avec le cycle de rendu du navigateur (16.67ms @ 60Hz).
6. **`requestIdleCallback`** exécute du travail non-urgent pendant les temps morts du navigateur.
7. **`scheduler.postTask`** offre un scheduling avec 3 niveaux de priorité (`user-blocking`, `user-visible`, `background`).
8. **Le time slicing** découpe les longues tâches en chunks de < 50ms pour préserver la réactivité.
9. **Un pool de Workers** réutilise les threads créés pour amortir le coût de création et limiter la consommation mémoire.
10. **Le scheduling coopératif** repose sur le fait que chaque tâche cède volontairement le contrôle à l'event loop.

---

## Atelier complémentaire — Typologies de Workers

Objectif : consolider la théorie du module avec un mini parcours pratique qui
couvre les principales familles de workers côté navigateur et Node.js.

> Format suggéré : 6 exercices courts (30 à 60 minutes chacun), avec une
> démonstration mesurable à la fin de chaque exercice.

### Exercice 1 — Dedicated Worker (navigateur)

- Déporter un calcul CPU-intensif hors du thread principal.
- Envoyer la charge utile via `postMessage`, retourner un résultat structuré.
- Afficher un indicateur UI (spinner/compteur) pour vérifier que l'interface ne
  freeze pas.

Critères de validation :

- L'UI reste fluide pendant l'exécution.
- Le résultat est correct et reçu via `onmessage`.

### Exercice 2 — Dedicated Worker + Transferable objects

- Envoyer de gros buffers (`ArrayBuffer`) au worker.
- Comparer clone structuré vs transfert (`postMessage(data, [buffer])`).
- Mesurer latence et effet "neutered" (`byteLength === 0` après transfert).

Critères de validation :

- Un tableau comparatif simple clone vs transfer est produit.
- La conclusion explique quand préférer le transfert.

### Exercice 3 — Shared Worker (multi-onglets)

- Créer un `SharedWorker` qui centralise un état simple (ex : compteur global).
- Connecter deux onglets et synchroniser les updates via `MessagePort`.
- Diffuser les événements à tous les clients connectés.

Critères de validation :

- Une action dans un onglet est visible dans l'autre en temps réel.
- La gestion `connect`, `port.start()` et `port.onmessage` est maîtrisée.

### Exercice 4 — Service Worker (cache et offline)

- Enregistrer un service worker côté app.
- Implémenter une stratégie minimale (cache-first ou stale-while-revalidate).
- Vérifier le comportement hors-ligne sur une route statique.

Critères de validation :

- La page ciblée reste consultable sans réseau.
- Les assets versionnés sont invalidés proprement.

### Exercice 5 — Worklet (Paint ou Audio)

- Choisir un type de worklet : `PaintWorklet` (visuel) ou `AudioWorklet` (audio).
- Produire une mini démo fonctionnelle.
- Documenter les contraintes d'exécution (runtime isolé, API disponibles).

Critères de validation :

- Le rendu custom (paint/audio) fonctionne.
- Les limites de l'approche sont expliquées.

### Exercice 6 — Worker Threads + SharedArrayBuffer (Node.js)

- Créer un mini pool de `worker_threads` pour un calcul parallèle.
- Tester message passing puis mémoire partagée (`SharedArrayBuffer` + `Atomics`).
- Comparer coût de coordination vs gain CPU.

Critères de validation :

- Le pool exécute plusieurs jobs correctement.
- Une mesure montre les cas où le parallélisme est rentable (ou non).

### Ordre recommandé et livrable final

Ordre : 1 -> 2 -> 3 -> 4 -> 5 -> 6.

Livrable :

- Une note de synthèse (1 page max) avec :
  - quelle typologie utiliser selon le besoin,
  - les pièges rencontrés,
  - un arbre de décision simple (UI, offline, multi-onglets, CPU backend).

---

---

## Pour aller plus loin

- [MDN — Web Workers API](https://developer.mozilla.org/fr/docs/Web/API/Web_Workers_API)
- [MDN — SharedArrayBuffer](https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [MDN — Atomics](https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Global_Objects/Atomics)
- [MDN — requestAnimationFrame](https://developer.mozilla.org/fr/docs/Web/API/window/requestAnimationFrame)
- [MDN — requestIdleCallback](https://developer.mozilla.org/fr/docs/Web/API/Window/requestIdleCallback)
- [MDN — Scheduler API](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler)
- [Node.js — Worker Threads](https://nodejs.org/api/worker_threads.html)
- [Chrome — Optimize long tasks](https://web.dev/articles/optimize-long-tasks)
- [TC39 — Proposal: Atomics.waitAsync](https://github.com/tc39/proposal-atomics-wait-async)
- [V8 Blog — Shared memory and Atomics](https://v8.dev/features/shared-array-buffer)

---

## Défi

Considérez ce code qui implémente un "spinlock" en JavaScript avec `SharedArrayBuffer` et `Atomics` :

```typescript
const sab = new SharedArrayBuffer(4);
const lock = new Int32Array(sab);
// lock[0] : 0 = libre, 1 = verrouillé

// Worker A
function acquire(): void {
  while (Atomics.compareExchange(lock, 0, 0, 1) !== 0) {
    // Busy-wait (spinlock)
  }
}

function release(): void {
  Atomics.store(lock, 0, 0);
}

// Worker B (même code)
acquire();
// section critique
release();
```

**Questions :**

1. Ce spinlock est-il correct du point de vue de la synchronisation ? Pourquoi ?
2. Quel est le problème principal de cette implémentation en JavaScript ?
3. Comment réécrire ce lock de manière idiomatique en JS pour éviter ce problème ?

<details>
<summary>Réponse</summary>

**1. Correction du spinlock :**

Oui, le spinlock est **correct** du point de vue synchronisation.
`Atomics.compareExchange(lock, 0, 0, 1)` est une opération atomique
compare-and-swap (CAS) : elle ne met `lock[0]` à 1 que si la valeur
courante est 0, et retourne l'ancienne valeur. Seul un thread à la
fois peut réussir le CAS quand le lock est libre.

**2. Le problème : busy-waiting**

Le **busy-wait** (boucle active) est catastrophique en JavaScript :

- Il consomme 100% d'un coeur CPU en tournant dans la boucle `while`
- En Node.js, il bloque l'event loop du Worker : aucun callback I/O,
  timer ou message ne peut être traité pendant l'attente
- JavaScript ne peut pas faire de `yield` CPU au niveau du thread comme
  un vrai spinlock en C/Rust (pas d'instruction `pause`/`YIELD`)
- Si le Worker qui détient le lock est sur le même coeur CPU, le
  Worker en attente peut empêcher le premier de progresser (priority
  inversion)

**3. Réécriture idiomatique avec `Atomics.wait` / `Atomics.notify` :**

```typescript
const sab = new SharedArrayBuffer(4);
const lock = new Int32Array(sab);

function acquire(): void {
  while (true) {
    // Tenter de prendre le lock
    if (Atomics.compareExchange(lock, 0, 0, 1) === 0) {
      return; // Lock acquis
    }
    // Si le lock est pris, DORMIR jusqu'à notification
    // Le thread est suspendu par l'OS, pas de busy-wait
    Atomics.wait(lock, 0, 1); // dort tant que lock[0] === 1
  }
}

function release(): void {
  Atomics.store(lock, 0, 0);
  // Réveiller UN thread en attente
  Atomics.notify(lock, 0, 1);
}
```

`Atomics.wait` suspend le thread au niveau de l'OS (pas de CPU consommé).
`Atomics.notify` réveille un thread en attente. C'est l'équivalent JS
d'un futex Linux.

**Attention** : `Atomics.wait` ne peut PAS être appelé sur le thread
principal du navigateur (il est bloquant). Utilisez `Atomics.waitAsync`
sur le thread principal, qui retourne une Promise.

</details>

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 13 scheduling](../screencasts/screencast-13-scheduling.md)
2. **Lab** : [lab-13-scheduler-implementation](../labs/lab-13-scheduler-implementation/README)
3. **Quiz** : [quiz 13 scheduling](../quizzes/quiz-13-scheduling.html)
:::
