# Module 03 — La Boucle d'Événements (Event Loop)

> **Objectif** : Comprendre en profondeur le fonctionnement de l'event loop, ses phases d'exécution dans Node.js et le navigateur, et savoir prédire l'ordre d'exécution de tout code asynchrone JavaScript.

> **Difficulté** : ⭐⭐⭐ (Avancé) — Prends ton temps, ce module est dense.

> **Pas de panique !** Ce module est dense, mais tu n'as pas besoin de tout retenir du premier coup. L'objectif est de construire un modèle mental, pas de mémoriser des règles. Relis ce module après avoir fait le lab — beaucoup de choses s'éclaireront à la pratique.

---

## Prérequis

- Maîtrise de la pile d'appels (call stack) et du modèle d'exécution synchrone (Module 01)
- Connaissance de la gestion mémoire et du garbage collector (Module 02)
- Familiarité avec les callbacks, Promises et `async/await`
- Notions de base sur les threads et la programmation concurrente

---

## Théorie

> 🎯 **Analogie** : L'event loop, c'est comme un serveur dans un restaurant. Il ne cuisine pas lui-même (single-threaded), mais il prend les commandes, les transmet en cuisine (Web APIs/libuv), et sert les plats quand ils sont prêts. Il ne peut servir qu'un plat à la fois, mais il gère des dizaines de tables en parallèle grâce à cette organisation.
>
> Pour filer la métaphore : le **serveur**, c'est l'**event loop** — il coordonne tout mais ne fait qu'une chose à la fois. La **cuisine**, ce sont les **Web APIs** (navigateur) ou **libuv** (Node.js) — c'est là que le vrai travail de fond se passe, en parallèle. Le **comptoir** ou les plats prêts attendent, c'est la **task queue** (file de macrotâches). Et les **clients prioritaires** qui passent toujours devant les autres au comptoir, ce sont les **microtâches** (Promises, `queueMicrotask`).

### 1. Pourquoi JavaScript est mono-thread mais non-bloquant

JavaScript s'exécute sur un **unique thread principal**. Il n'y a qu'une seule pile d'appels (call stack), donc une seule instruction s'exécute à la fois. Pourtant, JS gère des milliers d'opérations I/O concurrentes. Comment ?

La réponse tient en un mot : **délégation**. Les opérations longues (réseau, fichiers, timers) ne sont pas exécutées par le moteur JS lui-même mais par l'environnement hôte (libuv pour Node.js, les Web APIs pour le navigateur). Le moteur JS ne fait que :

1. Enregistrer un callback
2. Déléguer l'opération à l'environnement
3. Continuer l'exécution synchrone
4. Récupérer le résultat via le callback quand l'opération est terminée

```
  Thread principal JS          Environnement hôte (libuv / Web APIs)
  =====================        =======================================
  |                   |        |                                     |
  | fs.readFile(cb)   | -----> | Thread pool: lecture disque          |
  |                   |        |                                     |
  | http.get(cb)      | -----> | OS async I/O: requête réseau        |
  |                   |        |                                     |
  | setTimeout(cb, 5) | -----> | Timer system: compte 5ms             |
  |                   |        |                                     |
  | Exécution sync... |        | ... travail en parallèle ...        |
  |                   |        |                                     |
  | <- cb()           | <----- | Opération terminée, callback prêt   |
  =====================        =======================================
```

Le thread principal n'est **jamais bloqué** par une opération I/O. Il est bloqué uniquement par du code synchrone lourd (boucle `while` infinie, calcul CPU intensif, etc.).

### 2. Le cycle complet de l'event loop

#### Modèle simplifié d'abord

Avant de plonger dans le diagramme complet, retiens ce modèle ultra-simple en 2 étapes. C'est la base de tout :

1. **Exécuter tout le code synchrone** — JavaScript parcourt ton fichier de haut en bas et exécute tout ce qui n'est pas dans un callback. Les callbacks sont *enregistrés* mais pas encore exécutés.
2. **Quand la pile d'appels est vide, piocher le prochain callback dans la file** — une fois que tout le code synchrone est terminé, l'event loop va chercher le prochain callback prêt et l'exécute. Puis il recommence.

```
  Code synchrone (pile d'appels)
        │
        │  tout exécuté ?
        v
  Pile vide ? ──non──> continuer l'exécution synchrone
        │
       oui
        │
        v
  Prendre le prochain callback prêt dans la file
        │
        v
  L'exécuter (retour en haut)
```

C'est tout. Si tu retiens juste ça, tu as déjà le coeur du mécanisme. Maintenant qu'on a le modèle simple, voici le modèle complet avec les détails qui font la différence (microtâches, macrotâches, rendering) :

L'event loop est l'algorithme central qui orchestre l'exécution du code asynchrone. Voici le cycle simplifié applicable au navigateur :

```
  +---------------------------------------------------------+
  |                    EVENT LOOP CYCLE                      |
  |                                                         |
  |  +------------------+                                   |
  |  |   Call Stack     |  <-- Exécution synchrone          |
  |  |   (pile vide ?)  |                                   |
  |  +--------+---------+                                   |
  |           |                                             |
  |           | oui, la pile est vide                        |
  |           v                                             |
  |  +------------------+                                   |
  |  | Microtask Queue  |  <-- Promise.then, queueMicrotask |
  |  | (vider TOUT)     |      MutationObserver              |
  |  +--------+---------+                                   |
  |           |                                             |
  |           | file de microtâches vide                     |
  |           v                                             |
  |  +------------------+                                   |
  |  | Macrotask Queue  |  <-- setTimeout, setInterval,     |
  |  | (UNE seule)      |      I/O callbacks, events DOM    |
  |  +--------+---------+                                   |
  |           |                                             |
  |           | après chaque macrotâche                      |
  |           v                                             |
  |  +------------------+                                   |
  |  |  Rendering       |  <-- requestAnimationFrame,       |
  |  |  (si nécessaire) |      Style, Layout, Paint          |
  |  +--------+---------+                                   |
  |           |                                             |
  |           +-----------> retour au début du cycle         |
  +---------------------------------------------------------+
```

**Règle fondamentale** : entre chaque macrotâche, TOUTES les microtâches sont vidées. Le rendering n'intervient que si le navigateur juge nécessaire un rafraîchissement (~16ms pour 60fps).

### 3. Les phases de l'event loop Node.js

> 📋 **Rappel** : **libuv** est une bibliothèque écrite en C qui fournit à Node.js son event loop et ses capacités d'I/O asynchrone. C'est le « moteur sous le capot » qui permet à Node.js de gérer des milliers de connexions sans bloquer — tu n'interagis jamais directement avec libuv, mais c'est elle qui fait tourner la mécanique.

Node.js utilise **libuv** comme moteur d'event loop. Le cycle est plus granulaire que celui du navigateur et comporte **6 phases distinctes** :

```
   ┌───────────────────────────┐
┌─>│        timers              │ setTimeout, setInterval
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     pending callbacks      │ callbacks I/O différés (erreurs TCP, etc.)
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │       idle, prepare        │ usage interne libuv uniquement
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │           poll             │ récupère les événements I/O,
│  │                           │ exécute les callbacks I/O
│  │                           │ (peut bloquer ici si rien à faire)
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │          check             │ setImmediate callbacks
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     close callbacks        │ socket.on('close', ...)
│  └─────────────┬─────────────┘
│                │
│  ┌─────────────┴─────────────┐
│  │  process.nextTick queue    │ <── vidée ENTRE chaque phase
│  │  microtask queue           │ <── vidée ENTRE chaque phase
│  └─────────────┬─────────────┘
│                │
└────────────────┘
```

**Détail de chaque phase :**

| Phase | Description | APIs concernées |
|-------|-------------|-----------------|
| **timers** | Exécute les callbacks dont le délai est expiré | `setTimeout`, `setInterval` |
| **pending callbacks** | Exécute les callbacks I/O reportés au cycle précédent | Erreurs système (ECONNREFUSED, etc.) |
| **idle, prepare** | Usage interne de libuv | Aucune API JS exposée |
| **poll** | Récupère les nouveaux événements I/O, exécute les callbacks I/O | `fs.readFile`, `net.Socket`, etc. |
| **check** | Exécute les callbacks `setImmediate` | `setImmediate` |
| **close callbacks** | Exécute les callbacks de fermeture | `socket.on('close', ...)` |

**Point critique** : entre CHAQUE phase (pas entre chaque callback), Node.js vide :
1. La file `process.nextTick` (priorité maximale)
2. La file des microtâches (Promises)

**Changement important depuis Node.js 11** : avant la version 11, Node.js vidait toutes les macrotâches d'une même phase avant de traiter les microtâches. Depuis Node 11+, le comportement est aligné sur le navigateur : les microtâches sont vidées après **chaque** callback, pas seulement entre les phases.

### 4. Navigateur vs Node.js : différences clés

```
  Aspect                  Navigateur                 Node.js
  ======================= ========================== ==========================
  Moteur event loop       Intégré au navigateur      libuv (C)
  Phases                  Simplifié (macro/micro)    6 phases distinctes
  Rendering               Oui (rAF, paint)           Non (pas de DOM)
  setImmediate            Non standard (IE only)     Oui (phase check)
  process.nextTick        Non disponible             Oui (priorité max)
  requestAnimationFrame   Oui                        Non disponible
  Web Workers             Oui                        worker_threads
  Microtâches entre       Chaque macrotâche          Chaque callback (Node 11+)
  queueMicrotask          Oui                        Oui (depuis Node 11+)
```

### 5. `setTimeout(fn, 0)` n'est PAS "exécuter immédiatement"

C'est l'une des confusions les plus répandues. `setTimeout(fn, 0)` ne signifie pas "exécuter fn maintenant". Cela signifie :

1. Enregistrer `fn` dans la file des timers
2. Le délai minimum est **clampé** à ~1ms (voire 4ms dans certains cas, cf. HTML spec)
3. `fn` sera exécutée au **prochain passage** dans la phase timers, une fois la pile vide
4. Si du code synchrone prend 500ms, le timer de 0ms attendra 500ms

```typescript
console.log('A');

setTimeout(() => {
  console.log('B'); // macrotâche — phase timers
}, 0);

Promise.resolve().then(() => {
  console.log('C'); // microtâche — prioritaire sur le timer
});

console.log('D');

// Sortie garantie : A, D, C, B
// Le timer de 0ms passe APRÈS la microtâche Promise
```

**Le clamping du délai** selon la spécification HTML :
- Pour les timers imbriqués à plus de 5 niveaux, le délai minimum est clampé à **4ms**
- Les navigateurs peuvent augmenter ce minimum pour les onglets en arrière-plan (~1000ms)
- Node.js clampe à **1ms** (un `setTimeout(fn, 0)` devient `setTimeout(fn, 1)`)

### 6. `setImmediate` vs `setTimeout(fn, 0)` vs `process.nextTick`

Ces trois mécanismes planifient du code asynchrone, mais à des moments **très différents** du cycle :

```
  Priorité d'exécution (du plus prioritaire au moins prioritaire) :

  ┌─────────────────────────────────┐
  │ 1. process.nextTick             │ <-- entre chaque opération interne
  │    (pas une microtâche !)       │    vidé AVANT les microtâches
  ├─────────────────────────────────┤
  │ 2. Microtâches                  │ <-- Promise.then, queueMicrotask
  │    (vidées intégralement)       │
  ├─────────────────────────────────┤
  │ 3. Macrotâches                  │
  │    ├── timers (setTimeout)      │ <-- phase timers
  │    ├── I/O callbacks            │ <-- phase poll
  │    └── setImmediate             │ <-- phase check
  └─────────────────────────────────┘
```

**Cas piège** : l'ordre entre `setTimeout(fn, 0)` et `setImmediate` n'est **pas déterministe** lorsqu'ils sont appelés depuis le contexte principal :

```typescript
// Depuis le contexte principal : ordre NON garanti
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
// Peut afficher "timeout, immediate" OU "immediate, timeout"
// Cela dépend de la performance du système au moment du lancement

// Depuis un callback I/O : setImmediate TOUJOURS en premier
const fs = require('fs');
fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
});
// Toujours : "immediate, timeout"
// Car après I/O (phase poll), la prochaine phase est check (setImmediate)
```

**Explication** : dans un callback I/O (phase poll), la phase suivante est **check** (setImmediate), puis le cycle recommence par **timers** (setTimeout). Donc `setImmediate` passe toujours en premier dans ce contexte.

### 7. `requestAnimationFrame` dans la boucle

`requestAnimationFrame` (rAF) n'est ni une microtâche ni une macrotâche classique. Il s'inscrit dans l'étape de **rendering** du navigateur :

```
  ┌─────────────────────────────────────────┐
  │           Cycle navigateur              │
  │                                         │
  │  1. Macrotâche (une seule)              │
  │  2. Vider TOUTES les microtâches        │
  │  3. Si ~16ms écoulés (60fps) :          │
  │     a. Exécuter TOUS les callbacks rAF  │
  │     b. Style recalculation              │
  │     c. Layout                           │
  │     d. Paint                            │
  │  4. Retour à 1.                         │
  └─────────────────────────────────────────┘
```

```typescript
// rAF s'exécute AVANT le prochain paint
requestAnimationFrame(() => {
  console.log('rAF'); // avant le paint, après les microtâches
});

setTimeout(() => {
  console.log('timeout'); // macrotâche classique
}, 0);

Promise.resolve().then(() => {
  console.log('promise'); // microtâche
});

// Ordre typique : promise, rAF, timeout
// MAIS rAF et timeout peuvent s'inverser selon le timing du frame
```

**Attention** : rAF n'est **pas garanti** de s'exécuter avant le prochain `setTimeout(fn, 0)`. Son exécution dépend du cycle de rendu du navigateur. Si le navigateur décide qu'un rendu n'est pas nécessaire, rAF est retardé.

### 8. Famine (Starvation) : quand les microtâches ne finissent jamais

> 📋 **Rappel (analogie du restaurant)** : Souviens-toi des « clients prioritaires » (microtâches) qui passent TOUS avant le prochain client normal (macrotâche). Maintenant imagine que chaque client prioritaire invite un autre client prioritaire juste avant de partir. Le serveur ne peut JAMAIS servir les clients normaux — c'est exactement ça, la famine.

Les microtâches sont vidées **intégralement** avant de passer à la macrotâche suivante. Si une microtâche en crée une autre, et ainsi de suite, l'event loop est **bloqué** :

```typescript
// DANGER : ceci bloque l'event loop indéfiniment
function recursiveMicrotask(): void {
  Promise.resolve().then(() => {
    console.log('microtask');
    recursiveMicrotask(); // crée une nouvelle microtâche à chaque fois
  });
}
recursiveMicrotask();

setTimeout(() => {
  console.log('Ce message ne s\'affichera JAMAIS');
}, 0);
```

```
  Cycle de l'event loop bloqué :

  Macrotâche courante terminée
         │
         v
  Vider les microtâches ──> microtask 1 ──> crée microtask 2
                            microtask 2 ──> crée microtask 3
                            microtask 3 ──> crée microtask 4
                            ...                  (infini)

  ╔══════════════════════════════════════════╗
  ║  La file de macrotâches n'est JAMAIS     ║
  ║  atteinte. setTimeout est affamé.        ║
  ║  Le rendering est bloqué.                ║
  ║  L'UI est gelée.                         ║
  ╚══════════════════════════════════════════╝
```

Avec `process.nextTick`, c'est encore pire car il à une priorité **supérieure** aux microtâches :

```typescript
// Encore plus dangereux : bloque même les Promises
function recursiveNextTick(): void {
  process.nextTick(() => {
    recursiveNextTick();
  });
}
recursiveNextTick();

Promise.resolve().then(() => {
  console.log('Promise jamais résolue non plus');
});
```

### 9. L'event loop interne de libuv (pour les curieux)

Au coeur de Node.js, libuv implémente l'event loop en C. Voici une version simplifiée du pseudo-code de `uv_run()` :

```
  uv_run(loop, mode):
      while (loop est actif):
          // 1. Mettre à jour le temps interne
          uv__update_time(loop)

          // 2. Phase timers
          uv__run_timers(loop)

          // --- process.nextTick + microtasks ---

          // 3. Phase pending callbacks
          uv__run_pending(loop)

          // --- process.nextTick + microtasks ---

          // 4. Phase idle
          uv__run_idle(loop)

          // 5. Phase prepare
          uv__run_prepare(loop)

          // 6. Phase poll (peut bloquer)
          timeout = uv_backend_timeout(loop)
          uv__io_poll(loop, timeout)

          // --- process.nextTick + microtasks ---

          // 7. Phase check (setImmediate)
          uv__run_check(loop)

          // --- process.nextTick + microtasks ---

          // 8. Phase close callbacks
          uv__run_closing_handles(loop)

          // --- process.nextTick + microtasks ---

          // Vérifier s'il reste du travail
          si (mode == UV_RUN_ONCE || plus rien à faire):
              break
```

### 10. Comment l'I/O est réellement asynchrone

JavaScript est mono-threadé, mais l'I/O est asynchrone grâce à deux mécanismes complémentaires :

```
  a) Thread pool de libuv (4 threads par défaut, max 1024 via UV_THREADPOOL_SIZE)
  ===============================================================================

    Thread principal JS          Thread Pool (libuv)
    ┌──────────────┐            ┌──────────────┐
    │ fs.readFile() │──demande──>│  Thread 1    │
    │ (non bloquant)│            │  (lit le     │
    │               │            │   fichier)   │
    │ continue...   │            ├──────────────┤
    │               │            │  Thread 2    │
    │               │<─callback──│  (disponible)│
    │ exécute cb    │            ├──────────────┤
    └──────────────┘            │  Thread 3    │
                                ├──────────────┤
                                │  Thread 4    │
                                └──────────────┘

  b) APIs asynchrones de l'OS (pas de thread supplémentaire)
  ==========================================================
    - epoll (Linux)
    - kqueue (macOS/BSD)
    - IOCP (Windows)
    - Utilisé pour : sockets réseau, DNS (sur certains OS), signaux
```

---

## Démonstration

### Demo 1 — Prouver l'ordre des phases

```typescript
// demo1-phases-order.js
// Exécuter avec : node demo1-phases-order.js

const fs = require('fs');

// Phase timers
setTimeout(() => {
  console.log('1. setTimeout (phase timers)');
}, 0);

// Phase check
setImmediate(() => {
  console.log('2. setImmediate (phase check)');
});

// Microtâche
Promise.resolve().then(() => {
  console.log('3. Promise.then (microtask)');
});

// process.nextTick — priorité maximale
process.nextTick(() => {
  console.log('4. process.nextTick');
});

// Code synchrone — s'exécute en premier
console.log('5. Synchrone');

// Sortie garantie :
// 5. Synchrone
// 4. process.nextTick
// 3. Promise.then (microtask)
// 1. setTimeout (phase timers)    -- ou 2 en premier (non déterministe)
// 2. setImmediate (phase check)   -- ou 1 en premier (non déterministe)
```

### Demo 2 — setImmediate toujours avant setTimeout dans un callback I/O

```typescript
// demo2-io-context.js
const fs = require('fs');

console.log('--- Contexte principal (ordre non déterministe) ---');
setTimeout(() => console.log('  main: setTimeout'), 0);
setImmediate(() => console.log('  main: setImmediate'));

console.log('--- Contexte I/O (ordre déterministe) ---');
fs.readFile(__filename, () => {
  // Nous sommes dans la phase poll
  // Prochaine phase : check (setImmediate)
  // Puis le cycle recommence : timers (setTimeout)

  setTimeout(() => console.log('  I/O: setTimeout'), 0);
  setImmediate(() => console.log('  I/O: setImmediate'));

  process.nextTick(() => console.log('  I/O: nextTick'));
  Promise.resolve().then(() => console.log('  I/O: Promise'));
});

// Dans le contexte I/O, la sortie est TOUJOURS :
//   I/O: nextTick
//   I/O: Promise
//   I/O: setImmediate
//   I/O: setTimeout
```

### Demo 3 — Visualiser la famine par microtâches

```typescript
// demo3-starvation.js
// Ce script illustre la famine de manière contrôlée

let count: number = 0;
const MAX = 1_000_000;

// Ce timer ne s'exécutera qu'après MAX microtâches
const start = Date.now();
setTimeout(() => {
  console.log(`setTimeout exécuté après ${Date.now() - start}ms`);
  console.log(`${count} microtâches ont été traitées avant`);
}, 0);

function floodMicrotasks(): void {
  if (count >= MAX) return;
  count++;
  Promise.resolve().then(floodMicrotasks);
}
floodMicrotasks();

// Sur une machine typique, le setTimeout sera retardé de plusieurs
// centaines de millisecondes car 1 million de microtâches passent avant.
```

### Demo 4 — Mesurer le temps réel d'un setTimeout(fn, 0)

```typescript
// demo4-timer-accuracy.js

const iterations = 20;
const results: number[] = [];

function measureTimer(i: number): void {
  if (i >= iterations) {
    console.log('Délais réels de setTimeout(fn, 0) :');
    results.forEach((ms, idx) => {
      const bar = '='.repeat(Math.round(ms));
      console.log(`  Itération ${String(idx).padStart(2)}: ${ms.toFixed(2)}ms ${bar}`);
    });
    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    console.log(`  Moyenne : ${avg.toFixed(2)}ms`);
    console.log('  (rappel : le délai demandé était 0ms)');
    return;
  }

  const start = performance.now();
  setTimeout(() => {
    results.push(performance.now() - start);
    measureTimer(i + 1);
  }, 0);
}

measureTimer(0);

// Résultat typique : les délais réels sont entre 1ms et 4ms,
// jamais exactement 0ms.
```

### Demo 5 — Ordre complet avec toutes les primitives

```typescript
// demo5-complete-order.js

console.log('=== Début synchrone ===');

setTimeout(() => {
  console.log('T1: setTimeout 0ms');

  process.nextTick(() => {
    console.log('T1-NT: nextTick dans setTimeout');
  });

  Promise.resolve().then(() => {
    console.log('T1-P: Promise dans setTimeout');
  });
}, 0);

setTimeout(() => {
  console.log('T2: setTimeout 0ms (second)');
}, 0);

setImmediate(() => {
  console.log('I1: setImmediate');

  setImmediate(() => {
    console.log('I2: setImmediate imbriqué');
  });

  process.nextTick(() => {
    console.log('I1-NT: nextTick dans setImmediate');
  });

  Promise.resolve().then(() => {
    console.log('I1-P: Promise dans setImmediate');
  });
});

process.nextTick(() => {
  console.log('NT1: nextTick 1');
  process.nextTick(() => {
    console.log('NT2: nextTick imbriqué');
  });
});

Promise.resolve()
  .then(() => {
    console.log('P1: Promise 1');
    return Promise.resolve();
  })
  .then(() => {
    console.log('P2: Promise 2 (chaîné)');
  });

queueMicrotask(() => {
  console.log('QM: queueMicrotask');
});

console.log('=== Fin synchrone ===');

// Sortie :
// === Début synchrone ===
// === Fin synchrone ===
// NT1: nextTick 1
// NT2: nextTick imbriqué
// P1: Promise 1
// QM: queueMicrotask
// P2: Promise 2 (chaîné)
// T1: setTimeout 0ms          -- ou I1 d'abord (non déterministe hors I/O)
// T1-NT: nextTick dans setTimeout
// T1-P: Promise dans setTimeout
// T2: setTimeout 0ms (second)
// I1: setImmediate
// I1-NT: nextTick dans setImmediate
// I1-P: Promise dans setImmediate
// I2: setImmediate imbriqué
```

---

### V8 vs SpiderMonkey (Firefox)

> 📋 **Rappel** : Cette section compare les implémentations internes. En tant que développeur, le comportement observable est le même dans tous les navigateurs modernes — seuls les détails « sous le capot » diffèrent.

**L'event loop navigateur est défini par la spécification HTML** — Chrome (V8) et Firefox (SpiderMonkey) implémentent le **même algorithme**. L'ordre d'exécution des microtâches et des macrotâches est identique dans tous les navigateurs conformes à la spec. Si tu observes un comportement différent entre Chrome et Firefox, c'est un bug de l'un des deux, pas une différence de design.

**Ce qui diffère, c'est l'implémentation côté runtime** :

| Aspect | Chrome / Node.js (V8) | Firefox (SpiderMonkey) | Deno |
|--------|----------------------|------------------------|------|
| Event loop navigateur | Basé sur la spec HTML, implémenté en C++ dans Blink | Basé sur la spec HTML, implémenté en C++ dans Gecko | N/A (pas un navigateur) |
| Event loop runtime | **libuv** (C) pour Node.js | N/A (pas de runtime serveur officiel) | **tokio** (Rust) |
| Thread pool I/O | libuv thread pool (4 par défaut) | N/A | tokio runtime (async Rust) |
| Scheduling interne | Task queues Blink | Task queues Gecko (nsIRunnable) | tokio tasks |

**Points importants** :

- **La spécification HTML définit l'algorithme de l'event loop** (section 8.1.7). Chrome et Firefox l'implémentent tous les deux fidèlement. Les différences visibles sont extrêmement rares et considérées comme des bugs.
- **Node.js utilise libuv**, une bibliothèque C qui fournit un event loop cross-platform avec ses 6 phases spécifiques (timers, poll, check, etc.). Ce modèle à phases est propre à libuv, pas à la spec ECMAScript.
- **Deno utilise tokio**, un runtime asynchrone écrit en Rust. Le modèle est conceptuellement similaire (event loop + callbacks), mais l'implémentation est complètement différente de libuv.
- **Firefox n'a pas d'équivalent à Node.js** en tant que runtime serveur. Cependant, SpiderMonkey est embarqué dans d'autres projets (comme le runtime serveur expérimental de Mozilla) avec leurs propres mécanismes d'I/O.

**Conclusion** : l'event loop est un concept partagé. Que tu écrives du code pour Chrome, Firefox, Node.js ou Deno, les **règles d'ordonnancement** (microtâches avant macrotâches, vidage complet des microtâches, etc.) sont les mêmes. Seuls les détails d'implémentation internes changent.

---

## Points clés

1. **JavaScript est mono-thread** : une seule pile d'appels, mais l'environnement hôte (libuv, Web APIs) fournit le parallélisme pour les opérations I/O.

2. **L'event loop est un algorithme**, pas un thread séparé. Il orchestre l'exécution des callbacks en vérifiant les files d'attente quand la pile est vide. **Nuance pour Node.js** : bien que la logique de l'event loop s'exécute sur le thread principal, libuv gère le polling I/O via des mécanismes du système d'exploitation (epoll sur Linux, kqueue sur macOS/BSD, IOCP sur Windows) qui fonctionnent au niveau du noyau, en dehors du thread JS.

3. **Node.js a 6 phases** : timers, pending callbacks, idle/prepare, poll, check, close callbacks. Entre chaque phase, `process.nextTick` puis les microtâches sont vidés.

4. **Les microtâches sont toujours prioritaires** sur les macrotâches. Elles sont vidées intégralement après chaque callback (depuis Node 11+).

5. **`setTimeout(fn, 0)` n'est pas immédiat** : le délai est clampé à 1ms minimum (Node.js) ou potentiellement 4ms (navigateur, timers imbriqués).

6. **`setImmediate` vs `setTimeout(fn, 0)`** : l'ordre est non-déterministe dans le contexte principal, mais `setImmediate` passe toujours en premier dans un callback I/O.

7. **`process.nextTick` est le plus prioritaire** : il s'exécute avant les microtâches Promise, entre chaque phase de l'event loop.

8. **La famine (starvation)** est un danger réel : des microtâches récursives empêchent toute macrotâche de s'exécuter et gèlent l'application.

9. **`requestAnimationFrame`** s'exécute dans l'étape de rendering du navigateur, avant chaque paint, mais son timing exact dépend du cycle de rendu (~60fps).

10. **Depuis Node.js 11**, le comportement des microtâches est aligné sur celui des navigateurs : elles sont vidées après chaque callback individuel, pas après chaque phase entière.

---

---

## Si tu es perdu

Si ce module te semble trop dense, retiens juste ces 5 points :

1. **JavaScript est mono-thread** — il ne fait qu'une chose à la fois, comme un serveur unique dans un restaurant.
2. **Les opérations longues sont déléguées** — le serveur (JS) passe la commande en cuisine (Web APIs / libuv) et continue de servir d'autres clients.
3. **Les résultats reviennent dans une file** — quand la cuisine a fini, le plat est posé sur le comptoir (la task queue). Le serveur le sert quand il est libre.
4. **La pile doit être vide** — le serveur ne va chercher un plat au comptoir que quand il a fini de servir le client en cours (la call stack est vide).
5. **Les microtasks passent avant les macrotasks** — c'est comme des clients prioritaires : ils passent TOUS avant le prochain client normal.

Relis le module après le lab — ça sera beaucoup plus clair avec la pratique.

---

## Pour aller plus loin

- [Node.js — The Node.js Event Loop, Timers, and process.nextTick()](https://nodejs.org/en/guides/event-loop-timers-and-nexttick)
- [HTML Living Standard — Event loops](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops)
- [MDN — Event loop (Concurrency model)](https://developer.mozilla.org/fr/docs/Web/JavaScript/EventLoop)
- [libuv documentation — Design overview](https://docs.libuv.org/en/v1.x/design.html)
- [Jake Archibald — In The Loop (JSConf.Asia 2018)](https://www.youtube.com/watch?v=cCOL7MC4Pl0)
- [V8 Blog — Fast async](https://v8.dev/blog/fast-async)
- [MDN — requestAnimationFrame](https://developer.mozilla.org/fr/docs/Web/API/window/requestAnimationFrame)
- [MDN — queueMicrotask](https://developer.mozilla.org/fr/docs/Web/API/queueMicrotask)

---

## Défi

Quel est l'ordre exact de sortie du code suivant dans Node.js (v18+) ?

```typescript
const fs = require('fs');

fs.readFile(__filename, () => {
  setTimeout(() => console.log('A'), 0);
  setImmediate(() => {
    console.log('B');
    process.nextTick(() => console.log('C'));
    Promise.resolve().then(() => {
      console.log('D');
      queueMicrotask(() => console.log('E'));
    });
  });
  process.nextTick(() => console.log('F'));
  Promise.resolve().then(() => console.log('G'));
});
```

<details>
<summary>Réponse</summary>

**Sortie : `F, G, B, C, D, E, A`**

Raisonnement pas à pas :

1. Le callback de `fs.readFile` s'exécute dans la **phase poll**. Le code synchrone à l'intérieur enregistre les différents callbacks.

2. Avant de quitter le callback et passer à la phase suivante, Node.js vide `process.nextTick` puis les microtâches :
   - **`F`** (`process.nextTick` -- priorité maximale)
   - **`G`** (`Promise.then` -- microtâche)

3. La phase suivante après poll est **check** (`setImmediate`) :
   - **`B`** (le callback `setImmediate` s'exécute)
   - À l'intérieur de `setImmediate`, on enregistre un `nextTick` et une `Promise`
   - Avant de continuer : vidage de `nextTick` puis microtâches :
     - **`C`** (`process.nextTick`)
     - **`D`** (`Promise.then`)
     - **`E`** (`queueMicrotask` créé par la Promise -- c'est une microtâche, vidée dans le même cycle)

4. La phase suivante est **close callbacks** (rien ici), puis le cycle recommence par **timers** :
   - **`A`** (`setTimeout` de 0ms, maintenant expiré)

</details>

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 03 event loop](../screencasts/screencast-03-event-loop.md)
2. **Lab** : [lab-03-event-loop-order](../labs/lab-03-event-loop-order/README)
3. **Visualisation** : [Event Loop](../visualizations/event-loop.html)
4. **Quiz** : [quiz 03 event loop](../quizzes/quiz-03-event-loop.html)
:::
