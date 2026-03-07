# Module 04 — Microtâches vs Macrotâches

> **Objectif** : Maîtriser la distinction précise entre microtâches et macrotâches, comprendre leur ordonnancement interne, et être capable de résoudre n'importe quel puzzle d'ordre d'exécution asynchrone.

> **Difficulté** : ⭐⭐⭐ (Avancé) — Les puzzles sont volontairement difficiles.

> **Pas de panique !** Les puzzles de ce module sont difficiles par design. Si tu n'arrives pas à prédire l'ordre d'exécution du premier coup, c'est **normal** — même les développeurs seniors se trompent. L'objectif n'est pas d'avoir tout juste, mais de construire un raisonnement systématique. Chaque erreur t'apprend quelque chose.

---

## Prérequis

- Compréhension complète de l'event loop et de ses phases (Module 03)
- Connaissance de la pile d'appels et du modèle d'exécution (Module 01)
- Maîtrise des Promises, `async/await` et des callbacks
- Notions sur `process.nextTick` et `setImmediate` (Module 03)

---

## Théorie

> 🎯 **Analogie** : Imagine deux files d'attente à la poste : une file prioritaire (microtasks) et une file normale (macrotasks). Règle : on sert TOUTE la file prioritaire avant de servir UN SEUL client de la file normale. Si des clients prioritaires arrivent pendant qu'on sert la file prioritaire, ils passent aussi avant la file normale.

### 1. Définition précise

La spécification HTML et ECMA-262 distinguent deux catégories de tâches asynchrones. Les termes "microtâche" et "macrotâche" ne sont pas exactement ceux de la spec (qui parle de "task" et "microtask"), mais l'usage courant s'est imposé.

**Macrotâche (task)** : une unité de travail discrète planifiée dans la file de tâches principale. Après chaque macrotâche, l'event loop vérifie s'il faut effectuer un rendu, puis passe à la macrotâche suivante.

**Microtâche (microtask)** : une unité de travail légère qui s'exécute **immédiatement après** la tâche courante (ou la microtâche courante), avant que le contrôle ne soit rendu à l'event loop. Toutes les microtâches en attente sont vidées d'un coup.

```
  Modèle d'exécution :

  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │  Macrotâche 1                                        │
  │  └──> Vider TOUTES les microtâches                   │
  │       ├── microtask A                                │
  │       ├── microtask B (créée par A)                  │
  │       └── microtask C (créée par B)                  │
  │                                                      │
  │  [Rendering si nécessaire]                           │
  │                                                      │
  │  Macrotâche 2                                        │
  │  └──> Vider TOUTES les microtâches                   │
  │       └── microtask D                                │
  │                                                      │
  │  [Rendering si nécessaire]                           │
  │                                                      │
  │  Macrotâche 3                                        │
  │  └──> (pas de microtâches)                           │
  │                                                      │
  │  ...                                                 │
  └──────────────────────────────────────────────────────┘
```

### 2. Quelles APIs créent des microtâches

| API | Type | Contexte |
|-----|------|----------|
| `Promise.then()` / `catch()` / `finally()` | Microtâche | Navigateur + Node.js |
| `queueMicrotask(fn)` | Microtâche | Navigateur + Node.js |
| `MutationObserver` | Microtâche | Navigateur uniquement |
| `await` (reprise après) | Microtâche | Navigateur + Node.js |

Quand une Promise est résolue, son handler `.then()` ne s'exécute pas immédiatement. Il est placé dans la **file de microtâches** et sera exécuté quand la pile d'appels sera vide (mais avant toute macrotâche).

```javascript
// await est du sucre syntaxique pour Promise.then
// Donc la reprise après un await est une microtâche

async function example() {
  console.log('A');        // synchrone
  await Promise.resolve(); // place la reprise en microtâche
  console.log('B');        // microtâche (reprise après await)
}

example();
console.log('C');

// Sortie : A, C, B
```

### 3. Quelles APIs créent des macrotâches

| API | Type | Contexte |
|-----|------|----------|
| `setTimeout(fn, delay)` | Macrotâche | Navigateur + Node.js |
| `setInterval(fn, delay)` | Macrotâche | Navigateur + Node.js |
| `setImmediate(fn)` | Macrotâche | Node.js uniquement |
| Callbacks I/O (`fs`, `net`, etc.) | Macrotâche | Node.js |
| `MessageChannel.port.onmessage` | Macrotâche | Navigateur + Node.js |
| Événements DOM (click, input, etc.) | Macrotâche | Navigateur |
| `requestAnimationFrame` | Macrotâche* | Navigateur |

*Note : `requestAnimationFrame` est techniquement dans sa propre catégorie (rendering task), pas dans la file de macrotâches standard.

```javascript
// MessageChannel crée une macrotâche — utile pour céder le contrôle
const channel = new MessageChannel();
channel.port1.onmessage = () => {
  console.log('MessageChannel: macrotâche');
};
channel.port2.postMessage(undefined);

Promise.resolve().then(() => {
  console.log('Promise: microtâche');
});

// Sortie : Promise: microtâche, MessageChannel: macrotâche
```

### 4. L'algorithme de vidage : microtâches entre chaque macrotâche

Voici l'algorithme précis tel que défini par la spécification HTML :

```
  perform_a_microtask_checkpoint():
      tant que (la file de microtâches n'est PAS vide):
          microtask = file_microtaches.dequeue()
          executer(microtask)
          // Si microtask a créé d'autres microtâches,
          // elles sont dans la file et seront traitées
          // dans cette MÊME boucle while
```

```
  event_loop():
      boucle infinie:
          // 1. Prendre UNE macrotâche
          task = task_queue.dequeue()
          executer(task)

          // 2. Vider TOUTES les microtâches
          perform_a_microtask_checkpoint()

          // 3. Rendering (si nécessaire)
          si (besoin_de_rendu):
              executer_rAF_callbacks()
              render()
```

**Point crucial** : l'étape 2 est un `while`, pas un `if`. Cela signifie que si une microtâche en crée une autre, cette nouvelle microtâche sera traitée dans le **même cycle** de vidage, avant toute nouvelle macrotâche.

### 5. `process.nextTick` n'est PAS une microtâche

C'est une confusion très courante. `process.nextTick` a sa propre file d'attente, distincte de la file des microtâches. Et elle est **prioritaire** :

```
  Ordre de traitement entre deux phases Node.js :

  ┌─────────────────────────────────────┐
  │  Phase N terminée                   │
  │                                     │
  │  1. Vider process.nextTick queue    │ <-- TOUT vider
  │     (si nextTick crée un nextTick,  │
  │      il est traité ici aussi)       │
  │                                     │
  │  2. Vider microtask queue           │ <-- TOUT vider
  │     (Promise.then, queueMicrotask)  │
  │                                     │
  │  3. Passer à Phase N+1             │
  └─────────────────────────────────────┘
```

```javascript
// Preuve que nextTick passe avant les microtâches

process.nextTick(() => {
  console.log('nextTick 1');
});

Promise.resolve().then(() => {
  console.log('promise 1');
});

process.nextTick(() => {
  console.log('nextTick 2');
});

Promise.resolve().then(() => {
  console.log('promise 2');
});

// Sortie :
// nextTick 1
// nextTick 2
// promise 1
// promise 2
//
// Tous les nextTick AVANT toutes les Promises
```

**Pourquoi cette distinction ?** Historiquement, `process.nextTick` existait avant les Promises en JavaScript. Il a été conservé avec sa priorité supérieure pour des raisons de rétrocompatibilité. La documentation Node.js recommande d'utiliser `queueMicrotask()` plutôt que `process.nextTick()` pour le nouveau code.

### 6. L'ordre complet dans Node.js

```
  ╔═══════════════════════════════════════════════════╗
  ║        Priorité d'exécution dans Node.js          ║
  ╠═══════════════════════════════════════════════════╣
  ║                                                   ║
  ║  1. Code synchrone (call stack)                   ║
  ║     │                                             ║
  ║     v                                             ║
  ║  2. process.nextTick (file dédiée)                ║
  ║     │  - vidée intégralement                      ║
  ║     │  - nextTick imbriqués traités ici aussi     ║
  ║     v                                             ║
  ║  3. Microtâches (Promise.then, queueMicrotask)    ║
  ║     │  - vidées intégralement                     ║
  ║     │  - microtâches imbriquées traitées ici      ║
  ║     v                                             ║
  ║  4. Macrotâches (selon la phase courante)         ║
  ║     ├── timers (setTimeout, setInterval)          ║
  ║     ├── pending callbacks                         ║
  ║     ├── poll (I/O)                                ║
  ║     ├── check (setImmediate)                      ║
  ║     └── close callbacks                           ║
  ║                                                   ║
  ║  Entre chaque callback de macrotâche :            ║
  ║     -> retour à 2 (nextTick) puis 3 (micro)      ║
  ╚═══════════════════════════════════════════════════╝
```

### 7. Le problème de famine (starvation) en détail

La famine survient lorsqu'une catégorie de tâches accapare l'event loop et empêche les autres de s'exécuter.

**Scénario 1 : Famine par microtâches récursives**

```javascript
// Les microtâches affament les macrotâches
function eternalMicrotask() {
  queueMicrotask(eternalMicrotask);
}
eternalMicrotask();
// setTimeout, setInterval, I/O, setImmediate : tous bloqués
```

**Scénario 2 : Famine par process.nextTick récursif**

```javascript
// nextTick affame TOUT (même les Promises)
function eternalNextTick() {
  process.nextTick(eternalNextTick);
}
eternalNextTick();
// Promises, setTimeout, I/O : tous bloqués
```

**Scénario 3 : Famine par code synchrone**

```javascript
// Un calcul synchrone bloque tout
while (true) {
  // Même les microtâches ne s'exécutent pas
  // car la pile d'appels n'est jamais vide
}
```

```
  Impact de la famine selon le niveau :

  Code synchrone bloquant :
  X process.nextTick
  X Microtâches
  X Macrotâches
  X Rendering

  process.nextTick récursif :
  + Autres process.nextTick (même file)
  X Microtâches
  X Macrotâches
  X Rendering

  Microtâches récursives :
  + process.nextTick
  + Autres microtâches (même file)
  X Macrotâches
  X Rendering
```

### 8. `queueMicrotask()` vs `Promise.resolve().then()`

Ces deux approches créent des microtâches, mais avec des différences subtiles :

```javascript
// Approche 1 : queueMicrotask (recommandé)
queueMicrotask(() => {
  console.log('queueMicrotask');
});

// Approche 2 : Promise.resolve().then()
Promise.resolve().then(() => {
  console.log('Promise.resolve().then()');
});
```

**Différences** :

| Aspect | `queueMicrotask()` | `Promise.resolve().then()` |
|--------|--------------------|-----------------------------|
| Objet créé | Aucun | Crée 2 objets Promise |
| Performance | Plus rapide | Légèrement plus lent |
| Gestion d'erreurs | L'erreur remonte comme uncaught | L'erreur devient un rejet non géré |
| Sémantique | Explicite : "planifier une microtâche" | Détourne l'API Promise |
| Ordre | Identique (même file) | Identique (même file) |

```javascript
// Différence de gestion d'erreurs
queueMicrotask(() => {
  throw new Error('boom');
  // -> uncaughtException (peut être attrapé par le gestionnaire global)
});

Promise.resolve().then(() => {
  throw new Error('boom');
  // -> unhandledRejection (événement différent !)
});
```

### 9. Cas spéciaux et pièges courants

**Piège 1 : `async/await` et les ticks supplémentaires**

```javascript
async function foo() {
  return 'foo'; // équivalent à return Promise.resolve('foo')
}

async function bar() {
  return Promise.resolve('bar'); // unwrap du thenable = tick supplémentaire !
}

foo().then(console.log);
bar().then(console.log);

// Sortie : foo, bar
// bar a un tick de retard à cause du thenable unwrapping
// (voir Module 05 pour les détails)
```

**Piège 2 : Les Promises déjà résolues ne sont pas synchrones**

```javascript
const p = Promise.resolve(42);

p.then(v => console.log('then:', v));
console.log('sync');

// Sortie : sync, then: 42
// Même si p est déjà résolue, .then() est TOUJOURS une microtâche
// Il n'y a JAMAIS d'exécution synchrone d'un .then()
```

**Piège 3 : `.then()` chaîné crée des microtâches séquentielles**

```javascript
Promise.resolve()
  .then(() => console.log('then 1'))
  .then(() => console.log('then 2'))
  .then(() => console.log('then 3'));

Promise.resolve()
  .then(() => console.log('then A'))
  .then(() => console.log('then B'))
  .then(() => console.log('then C'));

// Sortie : then 1, then A, then 2, then B, then 3, then C
// Les .then() chaînés NE créent PAS leurs microtâches d'un coup.
// Seul le premier .then() de chaque chaîne est en file.
// Le .then() suivant est ajouté quand le précédent se résout.
```

Visualisation de l'entrelacement :

```
  File de microtâches au fil du temps :

  Étape 0 (après code sync) : [then1, thenA]

  Exécuter then1 -> affiche "then 1"
    -> résolution -> ajoute then2 en file
  File : [thenA, then2]

  Exécuter thenA -> affiche "then A"
    -> résolution -> ajoute thenB en file
  File : [then2, thenB]

  Exécuter then2 -> affiche "then 2"
    -> résolution -> ajoute then3 en file
  File : [thenB, then3]

  Exécuter thenB -> affiche "then B"
    -> résolution -> ajoute thenC en file
  File : [then3, thenC]

  Exécuter then3 -> affiche "then 3"
  File : [thenC]

  Exécuter thenC -> affiche "then C"
  File : []
```

### 10. MutationObserver : microtâche spéciale du navigateur

`MutationObserver` observe les modifications du DOM et ses callbacks sont des **microtâches** :

```javascript
const observer = new MutationObserver((mutations) => {
  console.log('DOM muté - microtâche');
});

observer.observe(document.body, { childList: true });

console.log('avant');
document.body.appendChild(document.createElement('div'));
console.log('après');

// avant
// après
// DOM muté - microtâche
```

Cela garantit que le callback du MutationObserver s'exécute **avant** le prochain rendu, permettant de réagir aux mutations DOM avant que l'utilisateur ne voie le changement.

---

## Démonstration

### Demo 1 — Puzzle basique : micro vs macro

```javascript
// demo1-basic-puzzle.js

console.log('1');

setTimeout(() => {
  console.log('2');
}, 0);

Promise.resolve().then(() => {
  console.log('3');
});

console.log('4');

// Réponse : 1, 4, 3, 2
// Explication :
//   "1" et "4" : synchrone (pile d'appels)
//   "3" : microtâche (Promise.then) -- prioritaire
//   "2" : macrotâche (setTimeout) -- après les microtâches
```

### Demo 2 — Entrelacement de chaînes Promise

```javascript
// demo2-interleaving.js

Promise.resolve()
  .then(() => console.log('P1-A'))
  .then(() => console.log('P1-B'))
  .then(() => console.log('P1-C'));

Promise.resolve()
  .then(() => console.log('P2-A'))
  .then(() => console.log('P2-B'))
  .then(() => console.log('P2-C'));

queueMicrotask(() => console.log('QM-1'));
queueMicrotask(() => console.log('QM-2'));

// Réponse : P1-A, P2-A, QM-1, QM-2, P1-B, P2-B, P1-C, P2-C
//
// État initial de la file : [P1-A, P2-A, QM-1, QM-2]
// P1-A s'exécute -> ajoute P1-B
// P2-A s'exécute -> ajoute P2-B
// QM-1 s'exécute
// QM-2 s'exécute
// File : [P1-B, P2-B]
// P1-B s'exécute -> ajoute P1-C
// P2-B s'exécute -> ajoute P2-C
// File : [P1-C, P2-C]
// P1-C s'exécute
// P2-C s'exécute
```

### Demo 3 — nextTick vs microtask vs macrotask (Node.js)

```javascript
// demo3-full-priority.js
// Exécuter avec : node demo3-full-priority.js

setTimeout(() => {
  console.log('macro: setTimeout');
}, 0);

setImmediate(() => {
  console.log('macro: setImmediate');
});

process.nextTick(() => {
  console.log('nextTick: 1');

  process.nextTick(() => {
    console.log('nextTick: 2 (imbriqué)');
  });

  Promise.resolve().then(() => {
    console.log('micro: Promise dans nextTick');
  });
});

queueMicrotask(() => {
  console.log('micro: queueMicrotask');
});

Promise.resolve().then(() => {
  console.log('micro: Promise.then');

  process.nextTick(() => {
    console.log('nextTick: 3 (dans Promise)');
  });
});

console.log('sync');

// Sortie :
// sync
// nextTick: 1
// nextTick: 2 (imbriqué)
// micro: queueMicrotask
// micro: Promise.then
// micro: Promise dans nextTick
// nextTick: 3 (dans Promise)
// macro: setTimeout      (ou setImmediate, non déterministe)
// macro: setImmediate    (ou setTimeout, non déterministe)
//
// Explication :
// 1. "sync" : code synchrone
// 2. nextTick 1 et 2 : TOUS les nextTick avant les microtâches
// 3. Microtâches dans l'ordre : queueMicrotask, Promise.then
// 4. "Promise dans nextTick" : microtâche créée par nextTick 1
// 5. "nextTick 3" : nextTick créé par la Promise — depuis Node 11+,
//    quand un nextTick est planifié depuis une microtâche, il s'exécute
//    après que le callback courant de la microtâche termine, mais AVANT
//    la prochaine microtâche dans la file (car la file nextTick est
//    toujours drainée en priorité par rapport aux microtâches Promise)
// 6. Macrotâches : setTimeout et setImmediate
```

### Demo 4 — Puzzle avancé : async/await et microtâches

```javascript
// demo4-async-await.js

async function alpha() {
  console.log('alpha-1');
  await beta();
  console.log('alpha-2'); // microtâche (reprise après await)
}

async function beta() {
  console.log('beta-1');
  await gamma();
  console.log('beta-2'); // microtâche
}

async function gamma() {
  console.log('gamma');
}

console.log('start');

alpha();

Promise.resolve()
  .then(() => console.log('P1'))
  .then(() => console.log('P2'))
  .then(() => console.log('P3'));

console.log('end');

// Sortie :
// start
// alpha-1
// beta-1
// gamma
// end
// beta-2
// P1
// alpha-2
// P2
// P3
//
// Explication :
// - start : synchrone
// - alpha-1 : synchrone (avant le await)
// - beta-1 : synchrone (alpha appelle beta avant de suspendre)
// - gamma : synchrone (beta appelle gamma avant de suspendre)
// - end : synchrone
// - Microtâches : [reprise-gamma(=beta-2), P1]
//   beta-2 s'exécute -> ajoute reprise-beta(=alpha-2)
//   P1 s'exécute -> ajoute P2
//   alpha-2 s'exécute
//   P2 s'exécute -> ajoute P3
//   P3 s'exécute
```

### Demo 5 — Famine : setTimeout bloqué par microtâches

```javascript
// demo5-starvation-proof.js

const start = Date.now();
let timerRan = false;
let microCount = 0;

// Planifier un timer à 0ms
setTimeout(() => {
  timerRan = true;
  console.log(`setTimeout exécuté après ${Date.now() - start}ms`);
  console.log(`Nombre de microtâches traitées avant : ${microCount}`);
}, 0);

// Créer 100 000 microtâches en chaîne
function chainMicrotasks(n) {
  if (n <= 0) return Promise.resolve();
  return Promise.resolve().then(() => {
    microCount++;
    return chainMicrotasks(n - 1);
  });
}

chainMicrotasks(100_000).then(() => {
  console.log(`Chaîne de ${microCount} microtâches terminée`);
  console.log(`Timer déjà exécuté ? ${timerRan}`);
  console.log(`Temps écoulé : ${Date.now() - start}ms`);
});

// Résultat typique :
// Chaîne de 100000 microtâches terminée
// Timer déjà exécuté ? false        <-- le timer attend !
// Temps écoulé : ~150ms
// setTimeout exécuté après ~150ms
// Nombre de microtâches traitées avant : 100000
```

### Demo 6 — Puzzle expert : mélange complet

```javascript
// demo6-expert-puzzle.js

console.log('A');

setTimeout(() => {
  console.log('B');
  Promise.resolve().then(() => console.log('C'));
}, 0);

new Promise((resolve) => {
  console.log('D'); // le constructeur Promise est SYNCHRONE
  resolve();
}).then(() => {
  console.log('E');
  setTimeout(() => console.log('F'), 0);
  return Promise.resolve();
}).then(() => {
  console.log('G');
});

setTimeout(() => {
  console.log('H');
}, 0);

queueMicrotask(() => {
  console.log('I');
  queueMicrotask(() => console.log('J'));
});

console.log('K');

// Réponse : A, D, K, E, I, G, J, B, C, H, F
//
// Détail pas à pas :
// Sync : A, D (constructeur Promise), K
// Microtâches file initiale : [E, I]
//   E s'exécute -> planifie F (macro), retourne Promise.resolve()
//     (PromiseResolveThenableJob pour le return -> ajoute un job interne)
//   I s'exécute -> ajoute J (micro)
//   File : [job-interne-de-E, J]
//   job-interne s'exécute -> ajoute G en file
//   J s'exécute
//   File : [G]
//   G s'exécute
// Macrotâches dans l'ordre : B, H, F
//   B s'exécute -> ajoute C (micro)
//     C s'exécute (microtâche entre macrotâches)
//   H s'exécute
//   F s'exécute
//
// Note : G apparaît après I car return Promise.resolve() dans E
// crée un PromiseResolveThenableJob (tick supplémentaire).
// Voir Module 05 pour les détails.
```

### Demo 7 — Puzzle Node.js : mélange complet avec phases

```javascript
// demo7-nodejs-full.js (Node.js uniquement)

setTimeout(() => {
  console.log('T1');
  process.nextTick(() => console.log('NT1'));
  Promise.resolve().then(() => console.log('P1'));
}, 0);

setTimeout(() => {
  console.log('T2');
  process.nextTick(() => console.log('NT2'));
  Promise.resolve().then(() => console.log('P2'));
}, 0);

setImmediate(() => {
  console.log('I1');
  process.nextTick(() => console.log('NI1'));
  Promise.resolve().then(() => console.log('PI1'));
});

setImmediate(() => {
  console.log('I2');
  process.nextTick(() => console.log('NI2'));
});

process.nextTick(() => console.log('NT-global'));
Promise.resolve().then(() => console.log('P-global'));

console.log('SYNC');

// Sortie :
// SYNC
// NT-global
// P-global
// T1
// NT1
// P1
// T2
// NT2
// P2
// I1
// NI1
// PI1
// I2
// NI2
//
// Depuis Node.js 11+ : les microtâches sont vidées
// entre chaque callback de la même phase.
```

---

### V8 vs SpiderMonkey (Firefox)

> 📋 **Rappel** : La distinction microtâche/macrotâche est définie par les spécifications (HTML et ECMA-262), pas par un moteur en particulier. Le comportement est donc identique dans tous les navigateurs modernes.

**La distinction microtâche/macrotâche est définie par la spec** — elle est identique dans Chrome (V8), Firefox (SpiderMonkey), Safari (JavaScriptCore) et tous les navigateurs conformes.

**Implémentation interne de la file de microtâches** :

| Aspect | V8 (Chrome/Node.js) | SpiderMonkey (Firefox) |
|--------|---------------------|------------------------|
| File de microtâches | `MicrotaskQueue` (C++) | **Job Queue** (concept ECMA-262, section 9.5) |
| Planification | `EnqueueMicrotask()` | `EnqueueJob()` interne |
| API exposée | `queueMicrotask()` | `queueMicrotask()` (identique) |
| Vidage | `PerformMicrotaskCheckpoint()` | Vidage automatique après chaque « task » |

**Ce que les frameworks font avec les microtâches** — et pourquoi c'est cross-engine :

- **React** utilise `MessageChannel` (une macrotâche) pour planifier les mises à jour de rendu via son scheduler. Cela fonctionne de manière identique dans Chrome et Firefox car `MessageChannel` est standardisé.
- **Vue.js** utilise `queueMicrotask()` (ou `Promise.resolve().then()` en fallback) pour batching les mises à jour réactives. Même comportement dans tous les moteurs.
- **Angular** (Zone.js) intercepte les APIs asynchrones pour détecter les changements. Le mécanisme repose sur les APIs standard, donc cross-engine.

**`process.nextTick` est exclusif à Node.js** — il n'existe dans aucun navigateur (ni Chrome, ni Firefox, ni Safari). C'est une API propre au runtime Node.js, pas au moteur V8. Si tu portes du code Node.js vers Deno ou le navigateur, remplace `process.nextTick(fn)` par `queueMicrotask(fn)` (comportement presque identique, sauf la priorité par rapport aux Promises).

**Conclusion** : quand tu résous un puzzle d'ordonnancement microtâche/macrotâche, la réponse est la même quel que soit le moteur JS. Les seules différences concernent des APIs non standard comme `process.nextTick` (Node.js only) ou `setImmediate` (Node.js + IE historique).

---

## Points clés

1. **Macrotâche = task** dans la spécification. Créées par `setTimeout`, `setInterval`, `setImmediate`, I/O, `MessageChannel`, événements DOM.

2. **Microtâche = microtask**. Créées par `Promise.then/catch/finally`, `queueMicrotask`, `MutationObserver`, reprise après `await`.

3. **Règle d'or** : TOUTES les microtâches en attente sont vidées entre chaque macrotâche. C'est un `while`, pas un `if`.

4. **`process.nextTick` n'est pas une microtâche**. C'est une file séparée avec une priorité encore supérieure. Ordre : nextTick > microtasks > macrotasks.

5. **Les chaînes `.then()` s'entrelacent** : seul le premier `.then()` est dans la file. Les suivants sont ajoutés quand le précédent se résout, permettant l'entrelacement avec d'autres chaînes.

6. **Le constructeur `new Promise(fn)` est synchrone**. Seul le callback `.then()` est asynchrone (microtâche).

7. **`queueMicrotask` est préférable** à `Promise.resolve().then()` pour planifier une microtâche : plus performant, sémantique plus claire, gestion d'erreurs différente.

8. **La famine est un danger réel** : des microtâches récursives empêchent toute macrotâche de s'exécuter. `process.nextTick` récursif affame même les microtâches.

9. **`async/await`** : tout le code avant le premier `await` est synchrone. La reprise après `await` est une microtâche. Attention aux ticks supplémentaires avec les thenables.

10. **Pour debugger l'ordre** : dessinez la file de microtâches à chaque étape et simulez le vidage manuellement. C'est la seule méthode fiable.

---

## Lab associé

**Lab 04 — Résolution de 10 puzzles d'ordonnancement**

Résoudre 10 puzzles d'ordre d'exécution de difficulté croissante, en documentant chaque étape du raisonnement (état de la file de microtâches et de la file de macrotâches). Implémenter un outil de visualisation qui affiche l'état des files à chaque étape.

---

## Si tu es perdu

Si les puzzles te semblent impossibles, retiens juste ces 5 règles :

1. **Le code synchrone s'exécute toujours en premier** — tout ce qui n'est pas dans un callback s'exécute immédiatement.
2. **`process.nextTick` passe avant tout le reste** — c'est le super-VIP de la file d'attente.
3. **Les microtasks passent ensuite** — `Promise.then()`, `queueMicrotask()`, et les `.then()` ajoutés par `await`.
4. **Les macrotasks passent en dernier** — `setTimeout`, `setInterval`, `setImmediate`.
5. **Les microtasks sont drainées ENTIEREMENT** — si une microtask en ajoute une autre, elle s'exécute aussi avant la prochaine macrotask.

L'ordre est : **synchrone -> nextTick -> microtasks -> macrotasks**. Si tu retiens ça, tu peux résoudre 80% des puzzles.

---

## Pour aller plus loin

- [HTML Standard — Microtask queuing](https://html.spec.whatwg.org/multipage/webappapis.html#microtask-queuing)
- [ECMA-262 — Jobs and Host Operations to Enqueue Jobs](https://tc39.es/ecma262/#sec-jobs)
- [MDN — queueMicrotask()](https://developer.mozilla.org/fr/docs/Web/API/queueMicrotask)
- [MDN — Using microtasks in JavaScript](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide)
- [V8 Blog — Fast async](https://v8.dev/blog/fast-async)
- [Node.js Docs — process.nextTick()](https://nodejs.org/api/process.html#processnexttickcallback-args)
- [Jake Archibald — Tasks, microtasks, queues and schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/)
- [TC39 — Promise Objects](https://tc39.es/ecma262/#sec-promise-objects)

---

## Défi

Prédisez l'ordre exact de sortie du code suivant (Node.js v18+) :

```javascript
async function one() {
  console.log('1');
  await two();
  console.log('2');
}

async function two() {
  console.log('3');
}

console.log('A');

setTimeout(() => {
  console.log('B');
  process.nextTick(() => console.log('C'));
  Promise.resolve().then(() => console.log('D'));
}, 0);

one();

process.nextTick(() => {
  console.log('E');
  queueMicrotask(() => console.log('F'));
});

new Promise((resolve) => {
  console.log('G');
  resolve();
}).then(() => {
  console.log('H');
}).then(() => {
  console.log('I');
});

console.log('J');
```

<details>
<summary>Réponse</summary>

**Sortie : `A, 1, 3, G, J, E, 2, H, F, I, B, C, D`**

Raisonnement pas à pas :

**Code synchrone** (pile d'appels) :
- `A` : console.log direct
- `1` : dans `one()`, avant le `await`
- `3` : dans `two()`, appelé par `one()` avant la suspension
- `G` : le constructeur `new Promise(fn)` est synchrone
- `J` : dernier console.log synchrone

**Files après le code synchrone** :
- nextTick queue : `[E]`
- microtask queue : `[reprise-two->one(=2), H]`
- macrotask queue : `[setTimeout(B)]`

**Vidage nextTick** :
- `E` : exécution du nextTick
  - crée `queueMicrotask(F)` -> ajouté à la file micro

**Vidage microtâches** :
- File : `[reprise(=2), H, F]`
- `2` : reprise après `await two()` dans `one()`
- `H` : premier `.then()` de la Promise G -> ajoute `I` en file
- `F` : `queueMicrotask` créé par E
- File : `[I]`
- `I` : deuxième `.then()` chaîné

**Macrotâches** :
- `B` : exécution du `setTimeout`
  - crée `nextTick(C)` et `Promise.then(D)`
  - Vidage nextTick : `C`
  - Vidage microtâches : `D`

</details>
