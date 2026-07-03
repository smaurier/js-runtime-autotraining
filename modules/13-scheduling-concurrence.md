---
titre: Scheduling et concurrence — céder l'event loop, paralléliser pour de vrai
cours: 01-js-runtime
notions: [ceder l'event loop, chunking d'un gros travail, setTimeout setImmediate queueMicrotask, scheduler.postTask et MessageChannel, coopératif vs préemptif, concurrence vs parallélisme, Web Workers et worker_threads, SharedArrayBuffer et Atomics survol, quand offloader du CPU-bound, backpressure]
outcomes: [découper un gros traitement en chunks qui cèdent l'event loop, choisir le bon mécanisme de yield selon le runtime, distinguer concurrence et parallélisme, offloader un travail CPU-bound vers un worker et mesurer que l'API reste réactive]
prerequis: [12-performance-patterns]
next: 14-projet-final
libs: []
tribuzen: l'export CSV et l'agrégation stats de l'API TribuZen ne doivent plus geler l'event loop — découpage coopératif ou offload worker_threads, réactivité mesurée
last-reviewed: 2026-07
---

# Scheduling et concurrence — céder l'event loop, paralléliser pour de vrai

> **Outcomes — tu sauras FAIRE :** découper un gros traitement en chunks qui cèdent l'event loop, choisir le bon mécanisme de yield selon le runtime, distinguer concurrence et parallélisme, offloader un travail CPU-bound vers un worker et mesurer que l'API reste réactive.
> **Difficulté :** :star::star::star:

## 1. Cas concret d'abord

L'API TribuZen (Node.js/Express) expose une route d'export : `GET /api/export/members.csv`. Une famille avec beaucoup de membres déclenche ce handler :

```ts
// routes/export.ts — AVANT (bloque l'event loop)
app.get('/api/export/members.csv', async (req, res) => {
  const members = await db.members.findAll(); // 80 000 lignes
  let csv = 'id,name,email,role,joinedAt\n';

  // Boucle CPU-bound de 80 000 itérations, synchrone, d'un seul tenant
  for (const m of members) {
    csv += `${m.id},${escapeCsv(m.name)},${m.email},${m.role},${formatDate(m.joinedAt)}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});
```

**Le symptôme observé en prod :** pendant que ce handler tourne, **toutes les autres requêtes de l'API attendent**. Un `GET /api/health` qui répond normalement en 2 ms met soudain 900 ms. L'event loop est monopolisé par la boucle de concaténation : aucun autre callback (I/O terminé, timer, nouvelle requête) ne peut être traité tant que la boucle n'est pas finie.

**Trois problèmes immédiats :**
1. La boucle de 80 000 itérations est **une seule macrotâche** : elle ne rend jamais la main à l'event loop avant la fin.
2. `csv += ...` est un anti-pattern perf (vu au module 12) — mais même corrigé, le vrai problème reste : **le travail est monolithique**.
3. Le calcul est **CPU-bound** : `await db.members.findAll()` cède bien la main (c'est de l'I/O), mais la boucle qui suit, non. `async` ne rend pas magiquement une boucle synchrone non-bloquante.

Ce module te donne les deux leviers pour régler ça : **céder l'event loop en découpant le travail** (concurrence coopérative), et **offloader le CPU vers un autre thread** (parallélisme réel). Et surtout : savoir lequel choisir.

---

## 2. Théorie complète, concise

### 2.1 Concurrence n'est pas parallélisme

C'est la distinction fondatrice du module. Elle est source de confusion permanente.

| | Concurrence | Parallélisme |
|---|---|---|
| Définition | Plusieurs tâches **en cours** entrelacées | Plusieurs tâches qui **s'exécutent littéralement en même temps** |
| Nombre de threads | 1 (event loop) | N (workers/threads, N cœurs CPU) |
| Mécanisme JS | event loop + yield coopératif | Web Workers, `worker_threads` |
| Ce que ça règle | garder l'app **réactive** pendant du travail entrelacé | accélérer un calcul **CPU-bound** |
| Ne règle PAS | un calcul CPU pur reste aussi long au total | rien pour de l'I/O (déjà async) |

> Rob Pike : *« Concurrency is about dealing with lots of things at once. Parallelism is about doing lots of things at once. »* La concurrence est une manière de **structurer** le code ; le parallélisme est une manière de l'**exécuter**.

Conséquence pratique : découper en chunks (2.3) rend l'API **réactive** mais ne réduit **pas** le temps total du calcul — au contraire, il l'allonge un peu (coût des yields). Offloader vers un worker (2.6) libère l'event loop **et** peut réduire le temps total si on répartit sur plusieurs cœurs. Ce sont deux outils pour deux problèmes différents.

### 2.2 Coopératif vs préemptif

```
Préemptif (OS, threads) : l'ordonnanceur INTERROMPT une tâche
  |-- tâche A --|          |-- tâche A (suite) --|
                |-- B --|                         |-- B --|
  (le scheduler force le switch, la tâche ne décide rien)

Coopératif (event loop JS) : la tâche CÈDE volontairement
  |-- tâche A complète, jusqu'au bout --||-- tâche B complète --|
  (rien ne peut interrompre A ; A doit finir ou yield elle-même)
```

L'event loop JavaScript est **coopératif et non préemptif**. Une fonction synchrone qui tourne garde le thread jusqu'à ce qu'elle `return` ou qu'elle `await`/yield. **Personne ne peut l'interrompre.** C'est pourquoi une boucle CPU longue gèle tout : elle ne coopère jamais. La solution coopérative consiste à **insérer des points de yield** dans le travail.

### 2.3 Chunking : découper un gros travail

L'idée : traiter le travail par lots (chunks), et **rendre la main à l'event loop entre chaque lot** pour qu'il puisse traiter les callbacks en attente (autres requêtes, I/O).

```ts
// Yield vers l'event loop, puis reprise
async function processInChunks<T>(
  items: T[],
  handle: (item: T) => void,
  yieldFn: () => Promise<void>,
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    handle(items[i]);
    // Tous les chunkSize éléments : on cède la main
    if (i % chunkSize === 0) {
      await yieldFn(); // <-- l'event loop respire ici
    }
  }
}
```

Le point clé est `await yieldFn()` : entre deux chunks, l'event loop reprend le contrôle, vide sa file de callbacks (répond au `/health`, traite l'I/O prêt), puis revient au chunk suivant. Reste à choisir **quel** `yieldFn`.

### 2.4 Les mécanismes de yield (Node)

En Node.js, pas de `requestAnimationFrame` ni `requestIdleCallback` (ce sont des API navigateur). On dispose de :

```ts
// setImmediate : yield PROPRE, exécuté en phase "check" de l'event loop.
// C'est LE bon choix pour céder entre deux chunks de travail en Node.
const yieldImmediate = () => new Promise<void>((r) => setImmediate(r));

// setTimeout(0) : yield en phase "timers". Fonctionne, mais le timer
// impose un délai plancher (souvent ~1 ms) — léger overhead cumulé.
const yieldTimeout = () => new Promise<void>((r) => setTimeout(r, 0));

// queueMicrotask : ATTENTION — ce N'EST PAS un yield à l'event loop.
// La microtâche s'exécute avant que l'event loop reprenne les I/O.
// Une boucle qui ne fait que queueMicrotask bloque toujours tout.
queueMicrotask(() => doSomething());

// process.nextTick : encore plus prioritaire que queueMicrotask.
// NE cède PAS non plus à l'event loop. Piège classique.
process.nextTick(() => doSomething());
```

**Règle Node :** pour découper du travail CPU-bound et rester réactif, on cède avec `setImmediate`. Les microtâches (`queueMicrotask`, `process.nextTick`, `Promise.resolve().then`) **ne cèdent pas** : elles sont drainées entièrement avant que l'event loop ne traite la moindre I/O. Les utiliser pour chunker ne débloque rien.

### 2.5 Les mécanismes de yield (navigateur)

Dans le navigateur, l'enjeu est de ne pas geler l'UI (une tâche > 50 ms est une *Long Task* qui bloque clic, scroll, saisie).

```ts
// setTimeout(0) : cède, mais clampé à ~4 ms après imbrication et sans priorité.
const yieldTimeout = () => new Promise<void>((r) => setTimeout(r, 0));

// MessageChannel : yield macrotâche SANS le clamp de setTimeout —
// technique historique de React (scheduler) pour céder vite et souvent.
function yieldViaChannel(): Promise<void> {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => resolve();
    port2.postMessage(null);
  });
}

// scheduler.postTask (API Scheduler, Chrome/Edge) : yield AVEC priorité explicite.
// 'user-blocking' > 'user-visible' > 'background'.
scheduler.postTask(() => renderChunk(), { priority: 'user-visible' });

// scheduler.yield() (Chrome récent) : cède ET reprend en priorité —
// la continuation passe devant les nouvelles tâches de même priorité.
for (let i = 0; i < items.length; i++) {
  handle(items[i]);
  if (i % 500 === 0) await scheduler.yield();
}
```

Ordre de préférence navigateur moderne : `scheduler.yield()` si dispo → `scheduler.postTask` pour la priorité → `MessageChannel` en fallback universel → `setTimeout(0)` en dernier recours. `queueMicrotask` ne cède pas non plus côté navigateur (même raison qu'en Node).

### 2.6 Parallélisme réel : Web Workers / worker_threads

Le chunking garde l'app réactive mais **n'accélère pas** un calcul lourd. Pour ça, il faut un **autre thread** : chaque worker a son propre event loop, sa propre heap, son propre isolate V8.

```ts
// ─── Node — worker_threads ──────────────────────────────
// main.ts
import { Worker } from 'node:worker_threads';

function runInWorker<T>(file: URL, data: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(file, { workerData: data });
    worker.once('message', (msg) => { resolve(msg); worker.terminate(); });
    worker.once('error', reject);
  });
}

// export-worker.ts
import { parentPort, workerData } from 'node:worker_threads';
const csv = buildCsv(workerData.members); // CPU-bound, sur CE thread
parentPort!.postMessage(csv);
```

```ts
// ─── Navigateur — Web Worker ────────────────────────────
// main.ts
const worker = new Worker(new URL('./stats.worker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ rows });
worker.onmessage = (e) => renderStats(e.data);

// stats.worker.ts
self.onmessage = (e) => {
  const result = aggregate(e.data.rows); // le thread principal reste libre
  self.postMessage(result);
};
```

Points communs : **isolation mémoire** (chaque worker a sa heap), **communication par messages** (`postMessage` / `onmessage`), **structured clone** des données à la frontière (copie profonde par défaut). L'API diffère (`worker_threads` en Node, `Worker` global au navigateur) mais le modèle mental est identique.

### 2.7 Coût de la frontière et objets transférables

`postMessage` fait par défaut un **structured clone** : copie profonde O(n) des données. Pour de gros buffers, ce coût peut annuler le gain du parallélisme.

```ts
// Transfert au lieu de copie : O(1), le buffer change de propriétaire
const buf = new ArrayBuffer(50 * 1024 * 1024); // 50 Mo
worker.postMessage({ data: buf }, [buf]); // 2e arg = liste des transférables
// buf.byteLength === 0 ici : le buffer est "neutered", plus utilisable côté émetteur
```

Transférables : `ArrayBuffer`, `MessagePort`, `ReadableStream`… Règle : offloader vaut le coup quand **le calcul >> le coût de transfert des données**. Envoyer 50 Mo pour un calcul de 3 ms est une perte nette.

### 2.8 SharedArrayBuffer et Atomics (survol)

Pour partager la mémoire **sans copie ni transfert**, `SharedArrayBuffer` expose la même zone à plusieurs threads. Mais qui dit mémoire partagée dit **race conditions** : deux threads qui écrivent au même endroit sans coordination corrompent la donnée. `Atomics` fournit les opérations indivisibles (`Atomics.add`, `Atomics.load`, `Atomics.store`, `Atomics.wait`/`notify`).

```ts
const sab = new SharedArrayBuffer(4);
const counter = new Int32Array(sab);
Atomics.add(counter, 0, 1); // incrément thread-safe
```

C'est un outil **avancé et rare**. Dans 99 % des cas, le message passing (copie/transfert) suffit et est plus sûr. Contrainte navigateur : `SharedArrayBuffer` exige les en-têtes d'isolation cross-origin (`COOP`/`COEP`) depuis Spectre. À connaître, pas à dégainer par défaut.

### 2.9 Quand offloader du CPU-bound

Arbre de décision :

```
Le travail est-il de l'I/O (réseau, disque, DB) ?
  OUI -> déjà non-bloquant via async/await. Ne rien offloader.
  NON (CPU-bound) :
    Le travail bloque-t-il > ~50-100  ms ?
      NON -> laisser sur le thread principal, inutile de complexifier.
      OUI :
        A-t-on juste besoin de rester RÉACTIF (temps total ok) ?
          OUI -> chunking + yield (setImmediate / scheduler.yield). Simple.
        Faut-il aussi RÉDUIRE le temps total (data lourde, plusieurs cœurs) ?
          OUI -> offload worker (worker_threads / Web Worker), voire pool.
```

Ne pas offloader un `await fetch()` : c'est déjà libre. Ne pas monter un worker pour 5 ms de calcul : la frontière coûte plus cher que le gain.

### 2.10 Backpressure

Quand un producteur va plus vite que le consommateur (worker, flux, socket), la file d'attente enfle → mémoire qui explose. La **backpressure** est le signal « ralentis ». Les streams Node l'implémentent : `writable.write()` retourne `false` quand le buffer est plein ; on attend l'événement `'drain'` avant de reprendre.

```ts
// Respecter la backpressure d'un stream (ex: écrire le CSV en flux)
async function writeRows(res: Writable, rows: string[]) {
  for (const row of rows) {
    if (!res.write(row)) {
      // Buffer plein : attendre le drain avant de continuer
      await new Promise((r) => res.once('drain', r));
    }
  }
  res.end();
}
```

Avec un pool de workers, la backpressure = **borner la file** de jobs en attente : si tous les workers sont occupés et que la file dépasse un seuil, on refuse/temporise les nouveaux jobs plutôt que d'accumuler.

---

## 3. Worked examples

### Exemple 1 — Débloquer l'export CSV par chunking (TribuZen, Node)

Reprise du cas concret. On garde le calcul sur le thread principal mais on **cède l'event loop** entre les chunks pour que l'API reste réactive.

```ts
// routes/export.ts — APRÈS (chunking coopératif)
import type { Response } from 'express';

// Yield propre en Node : phase "check" de l'event loop
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

async function buildCsvChunked(members: Member[]): Promise<string> {
  const lines: string[] = ['id,name,email,role,joinedAt']; // pas de += : Array.join (module 12)
  const CHUNK = 2000;

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    lines.push(`${m.id},${escapeCsv(m.name)},${m.email},${m.role},${formatDate(m.joinedAt)}`);

    // Toutes les 2000 lignes : rendre la main à l'event loop.
    // Pendant ce yield, /health et les autres requêtes sont servies.
    if (i % CHUNK === 0) {
      await yieldToLoop();
    }
  }
  return lines.join('\n');
}

app.get('/api/export/members.csv', async (req, res: Response) => {
  const members = await db.members.findAll(); // I/O : déjà non-bloquant
  const csv = await buildCsvChunked(members); // CPU : découpé, cède la main
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});
```

**Ce que ça change, mesuré :**
- Avant : `/health` répond en ~900 ms pendant l'export (event loop gelé).
- Après : `/health` répond en ~3 ms même pendant l'export (l'event loop respire tous les 2000 items).
- Temps total de l'export : **légèrement plus long** (~+5 % à cause des yields) — c'est le prix de la réactivité. La concurrence n'accélère pas, elle entrelace.

**Comment vérifier la réactivité** (principe, à faire tourner en session) :

```ts
// Sonde de latence event loop : un timer 50 ms; l'écart réel mesure le blocage
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const lag = now - last - 50; // > quelques ms = event loop bloqué
  console.log(`event loop lag: ${lag.toFixed(1)} ms`);
  last = now;
}, 50);
```

Sur la version bloquante, le lag grimpe à plusieurs centaines de ms. Sur la version chunkée, il reste bas.

### Exemple 2 — Offloader l'agrégation stats vers un worker (TribuZen, Node)

Le dashboard admin calcule des stats d'engagement sur tout l'historique d'une famille : agrégation lourde, purement CPU, qu'on veut **sortir** de l'event loop de l'API (et potentiellement accélérer). Ici le chunking ne suffit pas : on veut que l'API n'en porte *rien*. On offloade.

```ts
// ─── stats.worker.ts (tourne sur SON thread) ───────────────────
import { parentPort, workerData } from 'node:worker_threads';

interface Interaction { memberId: string; type: string; weight: number; }

function aggregate(rows: Interaction[]) {
  const byMember = new Map<string, number>();
  // Boucle CPU-bound : ~2 M interactions. Bloque CE thread, pas l'API.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    byMember.set(r.memberId, (byMember.get(r.memberId) ?? 0) + r.weight);
  }
  return [...byMember.entries()].map(([memberId, score]) => ({ memberId, score }));
}

const result = aggregate(workerData.rows as Interaction[]);
parentPort!.postMessage(result); // renvoie au thread principal
```

```ts
// ─── stats-service.ts (thread principal de l'API) ──────────────
import { Worker } from 'node:worker_threads';

export function computeEngagement(rows: Interaction[]): Promise<Stat[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./stats.worker.ts', import.meta.url), {
      workerData: { rows }, // structured clone à la frontière
    });
    worker.once('message', (stats: Stat[]) => {
      resolve(stats);
      worker.terminate(); // libérer le thread
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exit ${code}`));
    });
  });
}

// Handler : l'API reste 100 % réactive, le calcul vit ailleurs
app.get('/api/families/:id/engagement', async (req, res) => {
  const rows = await db.interactions.byFamily(req.params.id); // I/O
  const stats = await computeEngagement(rows);               // offload CPU
  res.json(stats);
});
```

**Pourquoi offloader ici plutôt que chunker :**
- Le calcul est assez lourd pour qu'on veuille **zéro** impact sur l'event loop de l'API, pas seulement un impact « lissé ».
- On peut le paralléliser (un worker par cœur, via un pool) pour **réduire le temps total** — ce que le chunking ne fait jamais.
- **Contre-mesure honnête** : `workerData` fait un structured clone des `rows`. Si `rows` pèse 200 Mo, la copie coûte cher. Deux parades : passer un `ArrayBuffer` transférable, ou faire lire la DB **directement dans le worker** (lui passer l'id de famille, pas les lignes).

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que `async` rend une boucle non-bloquante

```ts
// ❌ async ne cède RIEN ici : la boucle est synchrone du début à la fin
async function process(items: Item[]) {
  for (const it of items) {
    heavyCompute(it); // CPU-bound, aucun await à l'intérieur
  }
  // L'event loop est gelé pendant TOUTE la boucle, malgré le mot-clé async.
}

// ✅ Il faut un point de yield RÉEL dans la boucle
async function process(items: Item[]) {
  for (let i = 0; i < items.length; i++) {
    heavyCompute(items[i]);
    if (i % 500 === 0) await new Promise((r) => setImmediate(r)); // cède
  }
}
```

`async`/`await` ne cède la main **que sur un `await` d'une opération réellement asynchrone**. Un `await` sur une valeur déjà résolue ne rend qu'une microtâche — insuffisant (voir piège #2).

### PIÈGE #2 — Utiliser `queueMicrotask` / `Promise.resolve()` pour « céder »

```ts
// ❌ Les microtâches sont drainées AVANT que l'event loop touche l'I/O.
//    Cette boucle bloque toujours tout : /health n'est jamais servi.
async function process(items: Item[]) {
  for (let i = 0; i < items.length; i++) {
    heavyCompute(items[i]);
    await Promise.resolve(); // microtâche : ne cède PAS à l'event loop
  }
}

// ✅ Une macrotâche cède réellement à l'event loop
await new Promise((r) => setImmediate(r)); // Node
// ou MessageChannel / setTimeout / scheduler.yield côté navigateur
```

Rappel des modules 03-04 : microtâches (`Promise.then`, `queueMicrotask`, `process.nextTick`) sont vidées **intégralement** entre deux macrotâches. Pour laisser respirer l'I/O, il faut une **macrotâche**.

### PIÈGE #3 — Offloader de l'I/O vers un worker

```ts
// ❌ Mettre un fetch/une requête DB dans un worker "pour ne pas bloquer"
// stats.worker.ts
const data = await fetch('https://api...'); // l'I/O était DÉJÀ non-bloquant !
```

Un worker sert à sortir du **CPU-bound**. L'I/O (`fetch`, lecture disque, requête DB) ne bloque déjà pas l'event loop. Offloader de l'I/O n'apporte rien et ajoute le coût d'un thread + la frontière de messages. **Offload = CPU, jamais I/O.**

### PIÈGE #4 — Confondre « réactif » et « plus rapide »

Le chunking rend l'app réactive mais **rallonge** légèrement le temps total (coût des yields). Un worker unique déplace le calcul sans forcément l'accélérer (même durée, autre thread) — le gain de vitesse vient du **parallélisme sur plusieurs cœurs** (pool). Attendre une accélération d'un simple chunking, c'est se tromper d'outil : concurrence ≠ parallélisme (2.1).

### PIÈGE #5 — Ignorer le coût de la frontière worker

```ts
// ❌ Offloader un calcul de 3 ms en envoyant 100 Mo par structured clone
worker.postMessage({ rows: hugeArray }); // la copie coûte plus que le calcul

// ✅ Soit transférer un buffer, soit faire lire la donnée dans le worker
worker.postMessage({ buffer }, [buffer]); // transfert O(1)
// ou : passer un id, le worker charge lui-même depuis la DB
```

Règle : offloader ne vaut que si `coût_calcul >> coût_transfert`. Sinon, on paie un thread et une copie pour rien.

---

## 5. Ancrage TribuZen

Le scheduling est la couche qui garde l'**API TribuZen réactive sous charge** et le **dashboard admin fluide**.

**Export CSV réactif** (`api/src/routes/export.ts`) — l'endpoint `GET /api/export/members.csv` traite les membres par chunks de 2000 avec `await setImmediate` entre chaque lot. Résultat mesuré : `/api/health` reste sous 5 ms même pendant l'export d'une grosse famille (contre ~900 ms avant). C'est le cas concret et l'Exemple 1 du module.

**Agrégation stats offloadée** (`api/src/services/stats-service.ts` + `api/src/workers/stats.worker.ts`) — le calcul d'engagement (des millions d'interactions) tourne dans un `worker_threads` dédié. L'API délègue via `workerData`, reçoit le résultat par message, et n'a jamais son event loop bloqué. C'est l'Exemple 2. Évolution prévue : un **pool** de workers (un par cœur) pour paralléliser les agrégations de plusieurs familles simultanément.

**Réactivité mesurée** (`api/src/lib/eventloop-probe.ts`) — une sonde de lag event loop tourne en dev pour valider qu'aucun handler ne gèle le thread. Tout ajout de traitement lourd passe ce contrôle : soit chunké, soit offloadé.

**Côté admin React** (`admin/src/features/import/parse.worker.ts`) — le parsing d'un gros CSV importé se fait dans un **Web Worker**, pour que la saisie et le scroll de l'interface restent fluides pendant le traitement.

Fichiers cibles dans `smaurier/tribuzen` :
```
api/src/
  routes/export.ts            # export CSV chunké (setImmediate)
  services/stats-service.ts   # orchestration de l'offload
  workers/stats.worker.ts     # agrégation CPU-bound isolée
  lib/eventloop-probe.ts      # sonde de lag event loop
admin/src/
  features/import/parse.worker.ts  # parsing CSV en Web Worker
```

---

## 6. Points clés

1. **Concurrence ≠ parallélisme** : la concurrence (event loop, 1 thread) garde l'app réactive en entrelaçant ; le parallélisme (workers, N threads) exécute vraiment en même temps et peut accélérer un calcul CPU-bound.
2. L'event loop JS est **coopératif, non préemptif** : rien n'interrompt une fonction synchrone ; elle doit finir ou céder elle-même.
3. **Chunker** un gros travail = insérer des points de yield entre les lots pour laisser l'event loop traiter les autres callbacks — l'app reste réactive mais le temps total ne diminue pas.
4. En Node, on cède avec **`setImmediate`** ; au navigateur avec **`scheduler.yield()` / `scheduler.postTask` / `MessageChannel` / `setTimeout(0)`**.
5. **Les microtâches ne cèdent pas** : `queueMicrotask`, `process.nextTick`, `Promise.then` sont drainées avant l'I/O — inutiles pour débloquer l'event loop.
6. **`async` ne rend pas une boucle non-bloquante** : sans `await` d'une vraie opération async (ou d'une macrotâche), la boucle gèle le thread.
7. **Offloader = CPU-bound uniquement**, jamais de l'I/O (déjà non-bloquant). Web Workers (navigateur) et `worker_threads` (Node) : heap isolée, communication par messages.
8. **La frontière worker coûte** : structured clone O(n) par défaut ; utiliser les **transférables** (`ArrayBuffer`) ou charger la donnée dans le worker quand elle est volumineuse.
9. **`SharedArrayBuffer` + `Atomics`** partagent la mémoire sans copie mais introduisent des race conditions — outil avancé et rare ; le message passing suffit presque toujours.
10. **Backpressure** : borner les files (streams via `'drain'`, pool via file plafonnée) pour éviter que la mémoire explose quand le producteur va plus vite que le consommateur.

---

## 7. Seeds Anki

```
Quelle est la différence entre concurrence et parallélisme en JavaScript ?|La concurrence entrelace plusieurs tâches sur un seul thread (event loop) pour rester réactif — elle n'accélère rien. Le parallélisme exécute réellement en même temps sur plusieurs threads/cœurs (workers) et peut réduire le temps total d'un calcul CPU-bound.
Pourquoi une boucle CPU-bound gèle-t-elle toute l'application Node même dans une fonction async ?|Parce que l'event loop est coopératif et non préemptif : rien ne peut interrompre une fonction synchrone. async ne cède la main que sur un await d'une opération réellement asynchrone ; une boucle synchrone sans yield garde le thread jusqu'au bout.
Comment céder l'event loop entre deux chunks de travail en Node.js ?|Avec une macrotâche : await new Promise(r => setImmediate(r)). setImmediate s'exécute en phase check et laisse l'event loop traiter les I/O et autres requêtes entre les lots.
Pourquoi queueMicrotask ou Promise.resolve() ne suffisent-ils pas à débloquer l'event loop ?|Parce que les microtâches sont drainées intégralement AVANT que l'event loop reprenne les I/O. Une boucle qui ne fait que queueMicrotask bloque toujours tout. Il faut une macrotâche (setImmediate, MessageChannel, setTimeout) pour vraiment céder.
Quels mécanismes de yield utiliser dans le navigateur, par ordre de préférence ?|scheduler.yield() (cède et reprend en priorité) puis scheduler.postTask (priorité explicite) puis MessageChannel (macrotâche sans le clamp de setTimeout) puis setTimeout(0) en dernier recours. queueMicrotask ne cède pas.
Quand faut-il offloader vers un worker plutôt que chunker ?|Quand le travail est CPU-bound ET qu'on veut zéro impact sur l'event loop (offload) ou réduire le temps total via plusieurs cœurs (pool de workers). Le chunking suffit si on veut juste rester réactif sans accélérer. Jamais pour de l'I/O, déjà non-bloquant.
Quel est le coût caché de postMessage entre threads et comment l'éviter ?|Par défaut postMessage fait un structured clone (copie profonde O(n)) des données. Pour de gros buffers on utilise les transférables (ArrayBuffer passé en 2e argument) qui changent de propriétaire en O(1), ou on fait charger la donnée directement dans le worker.
À quoi servent SharedArrayBuffer et Atomics, et pourquoi les éviter par défaut ?|SharedArrayBuffer partage une zone mémoire entre threads sans copie ; Atomics fournit les opérations indivisibles pour éviter les race conditions. C'est avancé et risqué (mémoire partagée égale races), soumis à COOP/COEP au navigateur. Le message passing par copie/transfert suffit dans 99 % des cas et est plus sûr.
Qu'est-ce que la backpressure et comment la gère-t-on sur un stream Node ?|C'est le signal envoyé quand un consommateur est plus lent que le producteur, pour éviter que la file enfle et sature la mémoire. Sur un writable Node, write() retourne false quand le buffer est plein ; on attend l'événement 'drain' avant de reprendre l'écriture.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-13-scheduler-implementation/README.md`. Implémenter de zéro un scheduler coopératif qui découpe un gros travail en chunks et cède l'event loop, mesurer que la latence reste basse, puis comparer avec une version offloadée en worker_threads.
