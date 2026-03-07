# Screencast 13 — Scheduling & Concurrence

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/13-scheduling-concurrence.md`
- **Lab associé** : `labs/lab-13-scheduler-implementation/`
- **Prérequis** : Module 03 (Event Loop), Module 04 (Microtasks/Macrotasks), Module 12 (Performance Patterns), notion de Worker Threads

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Fichiers du lab-13 prêts (`exercise.js`, `walkthrough.js`)
- [ ] Node.js v20+ (Worker Threads, `SharedArrayBuffer` natif)
- [ ] Éditeur de code ouvert sur les fichiers du lab
- [ ] Navigateur ouvert pour la démo `requestIdleCallback`

## Script

### [00:00-01:30] Introduction — Concurrence vs Parallélisme

> « Bienvenue dans le module 13. On va parler de concurrence et de parallélisme — deux concepts souvent confondus mais fondamentalement différents. »

- **Concurrence** : gérer plusieurs tâches en alternant entre elles (un seul cuisinier, plusieurs plats)
- **Parallélisme** : exécuter plusieurs tâches en même temps (plusieurs cuisiniers)
- JavaScript est **concurrent** par nature (event loop, single thread)
- Mais on peut obtenir du **parallélisme** avec les Worker Threads
- Le défi : garder le main thread réactif tout en faisant du travail lourd

**Transition** : « Voyons les trois stratégies principales. »

### [01:30-04:30] Concept clé — Worker Threads, SharedArrayBuffer et Time-Slicing

#### Worker Threads
- Chaque worker a son propre V8 isolate, sa propre event loop, son propre heap
- Communication par **messages** (`postMessage` / `on('message')`)
- Cas d'usage : calcul CPU-intensif (compression, crypto, parsing de gros fichiers)
- Attention : le coût de création d'un worker est non négligeable (~30-50ms)

```javascript
// main.js
const { Worker } = require('worker_threads');
const worker = new Worker('./heavy-task.js');
worker.postMessage({ data: largeArray });
worker.on('message', (result) => console.log('Done:', result));
```

#### SharedArrayBuffer
- Mémoire partagée entre le main thread et les workers (zero-copy)
- Accès concurrent → besoin de **synchronisation**
- `Atomics.wait()` / `Atomics.notify()` pour la coordination
- Très performant mais dangereux (race conditions possibles)

#### Time-Slicing (découpage temporel)
- Diviser un gros calcul en petits morceaux exécutés entre les tâches de la queue
- Utiliser `setTimeout(0)`, `setImmediate`, ou `requestIdleCallback`
- Chaque tranche prend < 5ms → le main thread reste réactif

```javascript
function processChunk(items, index, chunkSize) {
  const end = Math.min(index + chunkSize, items.length);
  for (let i = index; i < end; i++) {
    heavyComputation(items[i]);
  }
  if (end < items.length) {
    setTimeout(() => processChunk(items, end, chunkSize), 0);
  }
}
```

**Transition** : « Passons au lab pour implémenter un scheduler de tâches. »

### [04:30-08:30] Démonstration pratique — Lab 13

#### Étape 1 : Observer le problème
```bash
node labs/lab-13-scheduler-implementation/exercise.js
```
- Montrer que le programme effectue une tâche lourde sur le main thread
- Pendant ce temps, les autres tâches (I/O, timers) sont bloquées
- Mesurer la latence : un `setTimeout(callback, 100)` qui s'exécute après 500ms+

#### Étape 2 : Implémenter le time-slicing
- Ouvrir le code du scheduler dans le lab
- Montrer l'architecture : une file de tâches avec des priorités
- Implémenter la méthode `schedule()` qui découpe le travail en tranches
- Utiliser `setImmediate` (Node.js) pour céder le contrôle entre chaque tranche
- Re-lancer et montrer que la latence du timer redescend à ~105ms

#### Étape 3 : Scheduling avec priorités
- 3 niveaux de priorité : `high`, `normal`, `low`
- Les tâches `high` passent toujours en premier dans la file
- Les tâches `low` ne s'exécutent que si aucune tâche `high` ou `normal` n'attend
- Implémenter avec une priority queue (3 files séparées ou un tableau trié)
- Démontrer l'ordonnancement en temps réel avec des logs horodatés

#### Étape 4 : Comparer avec un Worker
- Déplacer le calcul lourd dans un Worker Thread
- Montrer que le main thread reste complètement réactif
- Mesurer : latence timer ~101ms (quasi parfait)
- Comparer le code : plus de complexité vs meilleure isolation

**Transition** : « Approfondissons les subtilités de la communication inter-threads. »

### [08:30-11:30] Approfondissement — postMessage, Atomics, requestIdleCallback

#### Le coût de `postMessage`
- Les données sont **clonées** via l'algorithme de structured clone
- Coût proportionnel à la taille des données
- Pour les gros objets : utiliser les **Transferable objects** (ArrayBuffer)
  ```javascript
  const buffer = new ArrayBuffer(1024 * 1024);
  worker.postMessage(buffer, [buffer]); // transféré, pas copié
  // buffer.byteLength === 0 ici — le main thread ne le possède plus
  ```
- Alternative : `SharedArrayBuffer` pour éviter tout transfert

#### Atomics — Synchronisation bas niveau
- `Atomics.load(arr, index)` : lecture atomique
- `Atomics.store(arr, index, value)` : écriture atomique
- `Atomics.add(arr, index, value)` : addition atomique (pas de race condition)
- `Atomics.wait(arr, index, value)` : bloquer un worker jusqu'à notification
- `Atomics.notify(arr, index, count)` : réveiller les workers en attente
- Cas d'usage : mutex, sémaphore, barrière de synchronisation

#### requestIdleCallback (navigateur)
```javascript
requestIdleCallback((deadline) => {
  while (deadline.timeRemaining() > 0 && tasks.length > 0) {
    processTask(tasks.shift());
  }
  if (tasks.length > 0) {
    requestIdleCallback(processRemainingTasks);
  }
});
```
- S'exécute uniquement quand le navigateur est inactif
- `deadline.timeRemaining()` indique le temps disponible (généralement 1-50ms)
- Parfait pour les tâches non urgentes (analytics, prefetching, lazy loading)
- N'existe pas dans Node.js — utiliser `setImmediate` comme alternative

**Transition** : « Résumons les stratégies à utiliser selon le contexte. »

### [11:30-14:00] Récap — Garder le main thread réactif

#### Arbre de décision
```
Tâche lourde à exécuter ?
├── CPU-intensif (calcul pur) ?
│   ├── Oui → Worker Thread
│   └── Données partagées nécessaires ? → SharedArrayBuffer + Atomics
├── I/O-bound (réseau, fichiers) ?
│   └── Déjà asynchrone → event loop suffit
└── Mix CPU + UI réactive ?
    └── Time-slicing avec requestIdleCallback ou setImmediate
```

#### Les pièges courants
- Ne pas créer un worker par requête (pool de workers à la place)
- Ne pas oublier de terminer les workers (`worker.terminate()`)
- `SharedArrayBuffer` nécessite des headers COOP/COEP en navigateur
- `Atomics.wait()` **bloque** le thread — ne jamais l'appeler sur le main thread

#### Pool de workers
- Créer N workers au démarrage (N = nombre de CPU cores)
- Distribuer les tâches avec une round-robin ou une queue
- Librairies : `workerpool`, `piscina` (Node.js), `comlink` (navigateur)

#### Quiz rapide
- « Quelle est la différence entre concurrence et parallélisme ? » → Concurrence = alternance, parallélisme = simultanéité
- « Pourquoi ne pas utiliser `Atomics.wait()` sur le main thread ? » → Ça bloque le thread et gèle l'UI/event loop

> « Avant-dernier module technique : le Projet Final où on assemble tout. »

## Points d'attention pour l'enregistrement
- Bien illustrer la différence concurrence/parallélisme avec l'analogie des cuisiniers
- La démo du time-slicing est le moment clé — montrer la latence avant/après
- Le transfert d'ArrayBuffer est contre-intuitif — insister sur le fait que le buffer devient vide côté sender
- Atomics est avancé — rester simple, montrer juste `Atomics.add` et `Atomics.notify`
- Le pool de workers est un pattern essentiel pour la production — ne pas l'omettre
