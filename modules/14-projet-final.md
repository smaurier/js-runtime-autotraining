---
titre: "Projet final — un mini event loop + une mini-Promise"
cours: 01-js-runtime
notions: [assemblage call stack et task queue et microtask queue, ordre microtasks vidées entre chaque macrotask, MyPromise branchée sur la microtask queue du mini-loop, async/await reconstruit via générateur plus runner, comparaison de l'ordre du mini-loop avec Node réel, récapitulatif du parcours runtime]
outcomes: [construire un mini runtime JS qui reproduit l'ordre call stack puis microtasks puis macrotask suivant, brancher une MyPromise sur la microtask queue du mini-loop, reconstruire async/await avec un générateur et un runner promise-driven, comparer l'ordonnancement du mini-loop avec le vrai runtime Node]
prerequis: [13-scheduling-concurrence]
next: 15-debugging-session
libs: []
tribuzen: le mini-runtime sert de banc d'essai pour comprendre et déboguer l'ordonnancement asynchrone réel de l'API TribuZen (ordre then/await/setTimeout des appels familles+membres)
last-reviewed: 2026-07
---

# Projet final — un mini event loop + une mini-Promise

> **Outcomes — tu sauras FAIRE :** assembler à la main un mini runtime JS (call stack + task queue + microtask queue) qui respecte le bon ordre d'exécution, brancher une `MyPromise` sur la microtask queue de ce mini-loop, reconstruire `async/await` avec un générateur + un runner, et comparer l'ordonnancement du mini-loop avec le vrai Node.
> **Difficulté :** :star::star::star::star:

## 1. Cas concret d'abord

Sur l'API TribuZen, un endpoint charge une famille puis ses membres. Le code ressemble à ça :

```js
// api/loadFamily.js — extrait réel simplifié
async function loadFamily(id) {
  console.log('1 — début');
  const family = await db.family.findById(id);      // await = microtask au resolve
  console.log('3 — famille chargée');
  setTimeout(() => console.log('5 — log différé'), 0); // macrotask
  const members = await db.member.findByFamily(id);  // await = microtask
  console.log('4 — membres chargés');
  return { family, members };
}

console.log('2 — appel lancé');
loadFamily('fam_42');
```

Un collègue jure que la ligne `5 — log différé` s'affiche **avant** `4 — membres chargés` « parce que setTimeout est appelé avant ». Tu affirmes le contraire. Qui a raison ?

Répondre de tête est fragile. Le seul moyen d'en avoir le cœur net **et** de le prouver, c'est de posséder un modèle mental exécutable : un mini runtime que tu écris toi-même, où tu **vois** la call stack se remplir, la microtask queue se vider entre chaque macrotask, et les `await` se transformer en microtasks. C'est le livrable de ce projet final.

Ce module ne t'apprend pas une notion neuve : il te fait **assembler** tout le cours (modules 01 → 06) en un seul programme qui tourne en Node. Si tu sais le construire, tu as compris le runtime.

> **Ce qu'on construit :** un fichier `mini-runtime.mjs` exécutable qui contient un `MiniRuntime` (call stack + 2 files), une `MyPromise` branchée dessus, et un `runAsync` (générateur + runner) — puis on compare son ordre de sortie avec le vrai Node.

---

## 2. Théorie — la méthodo d'assemblage

Aucune API magique : quatre couches empilées, chacune reprend un module du cours. On les construit dans l'ordre des dépendances.

### 2.1 Couche 1 — la call stack (module 01)

La call stack est une pile LIFO de frames. Dans le vrai moteur elle est implicite (le moteur la gère). Ici on la rend **explicite et observable** : à chaque exécution de callback, on empile un frame nommé, on exécute, on dépile.

```js
pushFrame(name) { this.callStack.push(name); }
popFrame()      { this.callStack.pop(); }
```

L'intérêt pédagogique : `getStackDepth()` doit toujours revenir à 0 entre deux tâches. Une tâche = la pile se vide entièrement avant la suivante (« run-to-completion »).

### 2.2 Couche 2 — les deux files (modules 03 et 04)

Deux files FIFO distinctes, plus un registre de timers :

| Structure | Rôle | Alimentée par |
|---|---|---|
| `macrotasks` (FIFO) | tâches « macro » prêtes | timers expirés |
| `microtasks` (FIFO) | tâches « micro » | `queueMicrotask`, `.then` |
| `timers` (registre) | callbacks datés | `setTimeout(cb, delay)` |

**La règle d'or du runtime**, celle qui fait 90 % des bugs de timing :

> Entre chaque macrotask, on **vide TOUTE** la microtask queue — y compris les microtasks ajoutées *pendant* ce drain.

Donc un tick, c'est : (1) déplacer les timers expirés vers `macrotasks`, (2) exécuter **UN** macrotask, (3) **drainer TOUTES** les microtasks, (4) avancer l'horloge. Une boucle `while` (pas `forEach`) pour le drain, sinon on rate les microtasks ajoutées en cours de route.

### 2.3 Couche 3 — MyPromise branchée sur la microtask queue (module 05)

Une `MyPromise` conforme dans l'esprit Promises/A+ : trois états (`pending` → `fulfilled`/`rejected`, transition irréversible), une file de callbacks, un `then` qui retourne une **nouvelle** promise. Le point clé de ce projet :

> Les callbacks de `.then` ne s'exécutent pas tout de suite : ils sont **planifiés via `runtime.queueMicrotask`**. C'est ce qui fait qu'une promise résolue « immédiatement » passe quand même *après* le code synchrone, et *avant* le prochain `setTimeout`.

C'est la jonction : la Promise n'a pas sa propre magie de timing, elle emprunte la microtask queue du runtime.

### 2.4 Couche 4 — async/await = générateur + runner (module 06)

`async/await` n'est pas une primitive : c'est du sucre au-dessus des générateurs + promises. On le reconstruit avec un **runner** :

- `function*` avec `yield` joue le rôle de `async` avec `await`.
- Chaque `yield somePromise` rend la main ; le runner attache un `.then` sur la promise ; au resolve (donc **en microtask**), il rappelle `gen.next(valeur)`.
- Quand le générateur est `done`, le runner résout la promise externe avec la valeur de retour.

```js
// yield PROMISE  ≈  await PROMISE
runAsync(rt, function* () {
  const a = yield MyPromise.resolve(rt, 1);
  const b = yield MyPromise.resolve(rt, 2);
  return a + b;               // ≈ return 3, planifié en microtask
});
```

Chaque reprise après un `yield` est une microtask — exactement comme la reprise après un `await`.

### 2.5 Récapitulatif du parcours

| Module | Notion | Où elle vit dans le livrable |
|---|---|---|
| 01 Call stack | frames LIFO, run-to-completion | `pushFrame/popFrame`, `getStackDepth()` |
| 03 Event loop | tick, macrotasks, timers | `tick()`, `macrotasks`, `timers` |
| 04 Micro/macro | drain complet entre macrotasks | `_drainMicrotasks()` (while) |
| 05 Promises | états, `then` chaînable, microtask | `MyPromise` + `queueMicrotask` |
| 06 async/await | générateur + runner | `runAsync` |

Assembler ces cinq briques dans un seul fichier qui **s'exécute** et donne le bon ordre, c'est la preuve que le runtime est compris.

---

## 3. Worked examples — construction guidée

On construit le fichier couche par couche, chaque étape s'exécute.

### Étape 1 — le noyau : call stack + deux files + tick

```js
// mini-runtime.mjs — couche 1 + 2
export class MiniRuntime {
  constructor() {
    this.callStack = [];      // module 01 : pile LIFO observable
    this.macrotasks = [];     // module 03 : FIFO
    this.microtasks = [];     // module 04 : FIFO
    this.timers = [];         // registre { id, cb, deadline }
    this.time = 0;            // horloge virtuelle (ms)
    this.nextId = 1;
    this.trace = [];          // journal des frames exécutés (debug)
  }

  // --- Couche 1 : call stack ---
  pushFrame(name) { this.callStack.push(name); this.trace.push(name); }
  popFrame()      { this.callStack.pop(); }
  getStackDepth() { return this.callStack.length; }

  // --- Enfilage ---
  setTimeout(cb, delay = 0) {
    const id = this.nextId++;
    this.timers.push({ id, cb, deadline: this.time + delay });
    return id;
  }
  clearTimeout(id) { this.timers = this.timers.filter(t => t.id !== id); }
  queueMicrotask(cb) { this.microtasks.push(cb); }

  // --- Couche 2 : drain complet des microtasks (module 04) ---
  _drainMicrotasks() {
    // while, PAS forEach : capte les microtasks ajoutées pendant le drain
    while (this.microtasks.length > 0) {
      const cb = this.microtasks.shift();
      this.pushFrame('micro');
      cb();
      this.popFrame();
    }
  }

  // --- Un tick de l'event loop (module 03) ---
  tick() {
    // 1. timers expirés -> macrotask queue
    this.timers.sort((a, b) => a.deadline - b.deadline);
    while (this.timers.length > 0 && this.timers[0].deadline <= this.time) {
      this.macrotasks.push(this.timers.shift().cb);
    }
    // 2. exécuter UN SEUL macrotask
    if (this.macrotasks.length > 0) {
      const task = this.macrotasks.shift();
      this.pushFrame('macro');
      task();
      this.popFrame();
    }
    // 3. drainer TOUTES les microtasks
    this._drainMicrotasks();
    // 4. avancer l'horloge (fast-forward si rien à faire maintenant)
    if (this.macrotasks.length === 0 && this.microtasks.length === 0 && this.timers.length > 0) {
      this.time = this.timers[0].deadline;
    } else {
      this.time += 1;
    }
    return this.macrotasks.length > 0
        || this.microtasks.length > 0
        || this.timers.length > 0;
  }

  run() {
    // microtasks de top-level d'abord (avant tout macrotask)
    this._drainMicrotasks();
    let guard = 0;
    while (this.tick() && guard++ < 100_000) {}
    if (guard >= 100_000) throw new Error('Boucle infinie détectée');
  }
}
```

Test manuel (à exécuter avec `node mini-runtime-demo.mjs`) :

```js
const rt = new MiniRuntime();
const order = [];
rt.setTimeout(() => order.push('macro'), 0);
rt.queueMicrotask(() => order.push('micro'));
rt.run();
console.log(order); // ['micro', 'macro']  ✅ microtask avant macrotask
```

### Étape 2 — brancher MyPromise sur la microtask queue

```js
// mini-runtime.mjs — couche 3 (module 05)
export class MyPromise {
  constructor(runtime, executor) {
    this.rt = runtime;
    this.state = 'pending';
    this.value = undefined;
    this.callbacks = [];               // { onF, onR } en attente
    const resolve = (v) => this._settle('fulfilled', v);
    const reject  = (e) => this._settle('rejected', e);
    try { executor(resolve, reject); } catch (e) { reject(e); }
  }

  _settle(state, value) {
    if (this.state !== 'pending') return;         // transition irréversible
    // résolution d'un thenable (ex: résoudre avec une autre promise)
    if (state === 'fulfilled' && value && typeof value.then === 'function') {
      value.then(v => this._settle('fulfilled', v),
                 e => this._settle('rejected', e));
      return;
    }
    this.state = state;
    this.value = value;
    for (const cb of this.callbacks) this._scheduleCallback(cb);
    this.callbacks = [];
  }

  // LE point clé : un callback then = une MICROTASK du runtime
  _scheduleCallback(cb) {
    this.rt.queueMicrotask(() => {
      if (this.state === 'fulfilled') cb.onF(this.value);
      else                            cb.onR(this.value);
    });
  }

  then(onFulfilled, onRejected) {
    return new MyPromise(this.rt, (resolve, reject) => {
      const handler = {
        onF: (v) => {
          try { resolve(onFulfilled ? onFulfilled(v) : v); }
          catch (e) { reject(e); }
        },
        onR: (e) => {
          try {
            if (onRejected) resolve(onRejected(e));
            else reject(e);                          // propagation du rejet
          } catch (err) { reject(err); }
        },
      };
      if (this.state === 'pending') this.callbacks.push(handler);
      else this._scheduleCallback(handler);
    });
  }

  static resolve(runtime, v) {
    if (v instanceof MyPromise) return v;
    return new MyPromise(runtime, (res) => res(v));
  }
  static reject(runtime, e) {
    return new MyPromise(runtime, (_, rej) => rej(e));
  }
}
```

Test manuel — la promise résolue passe avant le setTimeout, comme dans le vrai runtime :

```js
const rt = new MiniRuntime();
const order = [];
rt.setTimeout(() => order.push('macro'), 0);
MyPromise.resolve(rt, 42).then(v => order.push('micro:' + v));
rt.run();
console.log(order); // ['micro:42', 'macro']  ✅ then = microtask
```

### Étape 3 — reconstruire async/await avec un runner

```js
// mini-runtime.mjs — couche 4 (module 06)
// runAsync(rt, genFn) : yield PROMISE  ≈  await PROMISE
export function runAsync(runtime, genFn) {
  const gen = genFn();
  return new MyPromise(runtime, (resolve, reject) => {
    function step(method, arg) {
      let res;
      try { res = gen[method](arg); }      // gen.next(v) ou gen.throw(e)
      catch (e) { reject(e); return; }
      const { value, done } = res;
      if (done) { resolve(value); return; } // return du générateur = valeur async
      // value est une (My)Promise "awaitée" : on reprend au resolve, en microtask
      MyPromise.resolve(runtime, value).then(
        v => step('next', v),               // reprise après await
        e => step('throw', e),              // await qui rejette -> throw dans le gen
      );
    }
    step('next', undefined);                // démarrage
  });
}
```

Test manuel — on reproduit **le cas concret du §1** avec le mini-runtime :

```js
const rt = new MiniRuntime();
const order = [];

runAsync(rt, function* () {
  order.push('1 — début');
  const family = yield MyPromise.resolve(rt, { id: 'fam_42' }); // await db.family
  order.push('3 — famille chargée');
  rt.setTimeout(() => order.push('5 — log différé'), 0);        // setTimeout
  const members = yield MyPromise.resolve(rt, ['m1', 'm2']);    // await db.member
  order.push('4 — membres chargés');
  return { family, members };
});

order.push('2 — appel lancé');   // code synchrone après l'appel
rt.run();

console.log(order.join('\n'));
// 1 — début
// 2 — appel lancé
// 3 — famille chargée
// 4 — membres chargés
// 5 — log différé   <-- APRÈS 4, car await = microtask, setTimeout = macrotask
```

**Verdict du §1 :** tu avais raison. `4 — membres chargés` reprend via une microtask (le resolve du 2e `await`), et les microtasks sont **toutes** vidées avant que le `setTimeout` (macrotask) ne s'exécute. Ton mini-runtime le prouve, ligne par ligne.

### Étape 4 (fading) — vérifier contre le vrai Node

Le vrai test de compréhension : ton mini-loop doit donner **le même ordre** que Node. Écris le même scénario deux fois — une fois avec le mini-runtime, une fois avec les vraies API — et compare.

```js
// compare.mjs
const real = [];
(async () => {
  real.push('1 — début');
  await Promise.resolve();
  real.push('3 — famille chargée');
  setTimeout(() => {
    real.push('5 — log différé');
    console.log('NODE RÉEL :', real.join(' | '));
  }, 0);
  await Promise.resolve();
  real.push('4 — membres chargés');
})();
real.push('2 — appel lancé');
// NODE RÉEL : 1 — début | 2 — appel lancé | 3 — famille chargée | 4 — membres chargés | 5 — log différé
```

Même ordre que le mini-runtime → ton modèle mental est **fidèle**. C'est le critère de réussite du projet.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Drainer les microtasks avec `forEach` au lieu de `while`

```js
// ❌ rate les microtasks ajoutées PENDANT le drain
_drainMicrotasks() {
  this.microtasks.forEach(cb => cb());  // snapshot figé
  this.microtasks = [];
}
// ✅ while : capte tout, y compris les microtasks récursives
_drainMicrotasks() {
  while (this.microtasks.length > 0) this.microtasks.shift()();
}
```

Une microtask qui `queueMicrotask` une autre microtask doit s'exécuter **dans le même drain**, avant le prochain macrotask. `forEach` fige la liste et rate ces ajouts — c'est le bug classique qui inverse `A, B, C, D` en `A, B, D, C`.

### PIÈGE #2 — Exécuter le callback `then` de façon synchrone

```js
// ❌ then synchrone : casse la garantie "then = après le code sync"
then(onF) { if (this.state === 'fulfilled') onF(this.value); }
// ✅ then planifié en microtask
then(onF) { this.rt.queueMicrotask(() => onF(this.value)); }
```

Si `.then` s'exécute tout de suite, `Promise.resolve().then(f)` lance `f` avant la fin du script synchrone — l'inverse de la spec. Le callback doit **toujours** passer par la microtask queue, même sur une promise déjà résolue.

### PIÈGE #3 — Oublier le drain initial des microtasks de top-level

```js
run() {
  // ❌ sans ce drain, les microtasks de top-level partent APRÈS le 1er macrotask
  this._drainMicrotasks();   // ✅ microtasks de top-level d'abord
  while (this.tick()) {}
}
```

Les microtasks enfilées au niveau du script (avant tout timer) doivent partir avant le premier macrotask. Sans drain initial, l'ordre `micro, macro` devient `macro, micro`.

### PIÈGE #4 — Confondre « appelé avant » et « exécuté avant »

C'est l'erreur du collègue du §1. `setTimeout(cb, 0)` est **appelé** avant le 2e `await`, mais son callback est une **macrotask** : il n'est **exécuté** qu'après le vidage complet des microtasks. L'ordre d'appel dans le code ≠ l'ordre d'exécution. La priorité microtask > macrotask tranche toujours.

### PIÈGE #5 — Croire qu'`await` « attend » vraiment

`await` ne bloque rien. Dans le runner, `yield` **rend la main immédiatement** ; la suite est replanifiée en microtask au resolve. Entre le `yield` et sa reprise, le reste du code synchrone (le `order.push('2')`) s'exécute. C'est pour ça que `2 — appel lancé` sort avant `3 — famille chargée`.

---

## 5. Ancrage TribuZen

Le mini-runtime n'est pas un exercice abstrait : c'est le **banc d'essai** pour déboguer l'ordonnancement asynchrone réel de l'API TribuZen.

**Le problème réel.** L'endpoint `GET /families/:id/dashboard` orchestre plusieurs sources : `await family.findById`, un `setTimeout` de télémétrie (log différé), `await member.findByFamily`, puis un `queueMicrotask` de cache-warming. Quand un log de télémétrie apparaît « au mauvais moment » dans les traces, l'équipe perd du temps à chercher un bug réseau alors que c'est juste l'ordre micro/macro.

**Comment le mini-runtime aide.** On rejoue le scénario dans `mini-runtime.mjs` en remplaçant les vrais appels DB par des `MyPromise.resolve(rt, fixture)` et la télémétrie par un `rt.setTimeout`. On lit `rt.trace` (le journal des frames) : on **voit** que le log différé sort toujours après le dernier `await`, jamais entre deux. Puis on vérifie contre le vrai Node avec `compare.mjs` (§3, étape 4) : même ordre → le modèle est fidèle, le « bug » n'en est pas un.

**Fichiers cibles dans `smaurier/tribuzen` :**
```
tribuzen/
  scripts/runtime-sandbox/
    mini-runtime.mjs        # MiniRuntime + MyPromise + runAsync
    replay-dashboard.mjs    # rejoue l'ordre de GET /dashboard
    compare-node.mjs        # même scénario en API réelle, comparaison d'ordre
```

Le livrable devient un outil d'équipe : avant de blâmer le réseau, on rejoue l'ordonnancement dans le sandbox.

---

## 6. Points clés

1. Le projet final n'ajoute aucune notion : il **assemble** les modules 01 → 06 en un `mini-runtime.mjs` exécutable en Node.
2. Un tick = déplacer les timers expirés vers les macrotasks, exécuter **UN** macrotask, **drainer TOUTES** les microtasks, avancer l'horloge.
3. Le drain des microtasks se fait avec une boucle `while` (pas `forEach`) pour capter les microtasks ajoutées pendant le drain.
4. `MyPromise` n'a pas de timing propre : ses callbacks `then` sont planifiés via `runtime.queueMicrotask` — c'est ce qui les fait passer avant le prochain `setTimeout`.
5. `async/await` se reconstruit avec un générateur + un runner : `yield promise` ≈ `await promise`, la reprise après `yield` est une microtask.
6. « Appelé avant » ≠ « exécuté avant » : un `setTimeout(cb,0)` appelé tôt s'exécute après tout le vidage des microtasks.
7. Critère de réussite : le mini-runtime donne **le même ordre de sortie** que le vrai Node sur le même scénario.

---

## 7. Seeds Anki

```
Quelles couches assemble le projet final du cours JS Runtime ?|Call stack (module 01) + task queue et microtask queue (03/04) + MyPromise branchée sur la microtask queue (05) + async/await reconstruit via générateur+runner (06). Zéro notion neuve : un assemblage exécutable en Node.
Décris l'ordre des opérations dans un tick du mini event loop.|1) déplacer les timers expirés vers la macrotask queue, 2) exécuter UN seul macrotask, 3) drainer TOUTES les microtasks (while), 4) avancer l'horloge virtuelle. Puis on recommence tant qu'il reste des tâches.
Pourquoi drainer la microtask queue avec while et non forEach ?|forEach fige un snapshot de la liste et rate les microtasks ajoutées pendant le drain. while relit la longueur à chaque tour et exécute aussi les microtasks récursives, avant le prochain macrotask.
Comment MyPromise se branche-t-elle sur le mini-loop ?|Ses callbacks then ne s'exécutent pas synchroniquement : ils sont planifiés via runtime.queueMicrotask. La Promise n'a pas de timing propre, elle emprunte la microtask queue du runtime — d'où then après le code sync et avant setTimeout.
Comment reconstruit-on async/await sans le mot-clé await ?|Avec un générateur + un runner : function* remplace async, yield promise remplace await. Le runner attache un then sur la promise yieldée et rappelle gen.next(valeur) au resolve (en microtask). Quand le générateur est done, il résout la promise externe.
Dans loadFamily, pourquoi setTimeout(cb,0) sort-il après le dernier await ?|Le callback setTimeout est une macrotask ; la reprise après await est une microtask. Toutes les microtasks sont vidées avant le prochain macrotask. « Appelé avant » ≠ « exécuté avant ».
Quel est le critère de réussite du projet final ?|Le mini-runtime doit produire exactement le même ordre de sortie que le vrai Node sur un scénario identique (await + setTimeout + queueMicrotask). Même ordre = modèle mental fidèle.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-14-mini-event-loop/README.md`. Construire de zéro le `mini-runtime.mjs` complet (MiniRuntime + MyPromise + runAsync), l'exécuter en Node, puis comparer son ordonnancement avec le vrai runtime. Corrigé de référence inline + variante J+30 + application TribuZen.
