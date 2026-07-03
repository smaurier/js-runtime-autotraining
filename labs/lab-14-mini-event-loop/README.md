# Lab 14 — Mini event loop + mini-Promise

> **Outcome :** à la fin, tu sais construire de zéro un `mini-runtime.mjs` (call stack + task queue + microtask queue + `MyPromise` + `runAsync`) qui **s'exécute en Node** et reproduit le bon ordre micro/macro, puis le comparer au vrai runtime.
> **Vrai outil :** Node.js (exécution directe `node mini-runtime.mjs`) + le vrai event loop de Node pour la comparaison. Aucun harnais auto-correcteur — le livrable est du code réel qu'on lance et dont on lit la sortie `console.log`.
> **Feedback :** le coach valide en session, en lisant l'ordre de sortie produit par ton code et en le confrontant à celui de Node.

## Énoncé

Tu construis le **projet final** du cours : un mini runtime JavaScript qui mobilise toutes les briques des modules 01 → 06. Un seul fichier, `mini-runtime.mjs`, qui expose :

- un `MiniRuntime` : call stack observable (module 01) + `macrotasks`/`microtasks`/`timers` (modules 03/04), avec un `tick()` qui exécute **UN** macrotask puis **draine TOUTES** les microtasks ;
- une `MyPromise` (module 05) dont les callbacks `then` sont planifiés sur la **microtask queue du runtime** ;
- un `runAsync(rt, genFn)` (module 06) qui reconstruit `async/await` avec un générateur + un runner (`yield promise` ≈ `await promise`).

Le fichier doit **tourner** (`node mini-runtime.mjs`) et afficher, pour le scénario `loadFamily` du module, l'ordre :
`1 — début`, `2 — appel lancé`, `3 — famille chargée`, `4 — membres chargés`, `5 — log différé`.

Starter minimal (à compléter, pas de gap-fill guidé) :

```js
// mini-runtime.mjs
export class MiniRuntime {
  constructor() {
    this.callStack = [];
    this.macrotasks = [];
    this.microtasks = [];
    this.timers = [];
    this.time = 0;
    this.nextId = 1;
    this.trace = [];
  }
  // À toi : pushFrame/popFrame, setTimeout, queueMicrotask,
  //         _drainMicrotasks (while !), tick, run
}

export class MyPromise { /* trois états + then planifié en microtask */ }
export function runAsync(runtime, genFn) { /* générateur + runner */ }
```

## Étapes (en friction)

1. **Noyau.** Écris `pushFrame/popFrame/getStackDepth`, `setTimeout`, `clearTimeout`, `queueMicrotask`. Vérifie que `getStackDepth()` revient à 0 entre deux tâches.
2. **Drain.** Écris `_drainMicrotasks()` avec une boucle `while` (pas `forEach`). Teste avec une microtask qui en enfile une autre : les deux doivent partir dans le même drain.
3. **Tick.** Implémente `tick()` dans l'ordre : timers expirés → macrotask queue, exécuter UN macrotask, drainer TOUTES les microtasks, avancer l'horloge (fast-forward si vide). Puis `run()` avec un **drain initial** des microtasks de top-level.
4. **MyPromise.** Trois états, transition irréversible, `then` chaînable qui retourne une **nouvelle** promise, callbacks planifiés via `rt.queueMicrotask`. Vérifie : `MyPromise.resolve(rt,42).then(...)` passe **avant** un `setTimeout(...,0)`.
5. **runAsync.** Runner qui, à chaque `yield`, attache un `.then` sur la promise yieldée et rappelle `gen.next(valeur)` au resolve ; résout la promise externe au `done`.
6. **Scénario + comparaison.** Rejoue `loadFamily` avec le mini-runtime, note l'ordre. Écris le **même** scénario avec les vraies API (`Promise.resolve`, `setTimeout`) et confronte : les deux ordres doivent être identiques.

## Corrigé complet commenté

```js
// mini-runtime.mjs — corrigé de référence (exécutable : node mini-runtime.mjs)

// ─────────────────────────────────────────────────────────────
// Couche 1 (call stack, module 01) + couche 2 (files, modules 03/04)
// ─────────────────────────────────────────────────────────────
export class MiniRuntime {
  constructor() {
    this.callStack = [];   // pile LIFO observable
    this.macrotasks = [];  // FIFO
    this.microtasks = [];  // FIFO
    this.timers = [];      // { id, cb, deadline }
    this.time = 0;         // horloge virtuelle (ms)
    this.nextId = 1;
    this.trace = [];       // journal des frames (debug/observabilité)
  }

  pushFrame(name) { this.callStack.push(name); this.trace.push(name); }
  popFrame()      { this.callStack.pop(); }
  getStackDepth() { return this.callStack.length; }

  setTimeout(cb, delay = 0) {
    const id = this.nextId++;
    this.timers.push({ id, cb, deadline: this.time + delay });
    return id;
  }
  clearTimeout(id) { this.timers = this.timers.filter(t => t.id !== id); }
  queueMicrotask(cb) { this.microtasks.push(cb); }

  // while, PAS forEach : capte les microtasks ajoutées pendant le drain
  _drainMicrotasks() {
    while (this.microtasks.length > 0) {
      const cb = this.microtasks.shift();
      this.pushFrame('micro');
      cb();
      this.popFrame();          // run-to-completion : la pile se vide
    }
  }

  tick() {
    // 1. timers expirés -> macrotask queue
    this.timers.sort((a, b) => a.deadline - b.deadline);
    while (this.timers.length > 0 && this.timers[0].deadline <= this.time) {
      this.macrotasks.push(this.timers.shift().cb);
    }
    // 2. UN SEUL macrotask
    if (this.macrotasks.length > 0) {
      const task = this.macrotasks.shift();
      this.pushFrame('macro');
      task();
      this.popFrame();
    }
    // 3. drainer TOUTES les microtasks (règle d'or du runtime)
    this._drainMicrotasks();
    // 4. avancer l'horloge (fast-forward si plus rien d'immédiat)
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
    this._drainMicrotasks();     // microtasks de top-level AVANT tout macrotask
    let guard = 0;
    while (this.tick() && guard++ < 100_000) {}
    if (guard >= 100_000) throw new Error('Boucle infinie détectée');
  }
}

// ─────────────────────────────────────────────────────────────
// Couche 3 (MyPromise branchée sur la microtask queue, module 05)
// ─────────────────────────────────────────────────────────────
export class MyPromise {
  constructor(runtime, executor) {
    this.rt = runtime;
    this.state = 'pending';
    this.value = undefined;
    this.callbacks = [];                 // { onF, onR }
    const resolve = (v) => this._settle('fulfilled', v);
    const reject  = (e) => this._settle('rejected', e);
    try { executor(resolve, reject); } catch (e) { reject(e); }
  }

  _settle(state, value) {
    if (this.state !== 'pending') return;   // transition irréversible
    // résoudre avec un thenable : on adopte son état
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

  // LE point clé du projet : then = microtask du runtime
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
            else reject(e);                  // propagation du rejet non traité
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

// ─────────────────────────────────────────────────────────────
// Couche 4 (async/await = générateur + runner, module 06)
// ─────────────────────────────────────────────────────────────
export function runAsync(runtime, genFn) {
  const gen = genFn();
  return new MyPromise(runtime, (resolve, reject) => {
    function step(method, arg) {
      let res;
      try { res = gen[method](arg); }        // gen.next(v) | gen.throw(e)
      catch (e) { reject(e); return; }
      const { value, done } = res;
      if (done) { resolve(value); return; }  // return du gen = valeur async
      // value = promise "awaitée" : reprise au resolve, en microtask
      MyPromise.resolve(runtime, value).then(
        v => step('next', v),
        e => step('throw', e),
      );
    }
    step('next', undefined);
  });
}

// ─────────────────────────────────────────────────────────────
// Scénario de démonstration (le cas concret du module)
// ─────────────────────────────────────────────────────────────
const rt = new MiniRuntime();
const order = [];

runAsync(rt, function* () {
  order.push('1 — début');
  const family = yield MyPromise.resolve(rt, { id: 'fam_42' });
  order.push('3 — famille chargée');
  rt.setTimeout(() => order.push('5 — log différé'), 0);
  const members = yield MyPromise.resolve(rt, ['m1', 'm2']);
  order.push('4 — membres chargés');
  return { family, members };
});

order.push('2 — appel lancé');
rt.run();

console.log('MINI-RUNTIME :');
console.log(order.join('\n'));
// 1 — début
// 2 — appel lancé
// 3 — famille chargée
// 4 — membres chargés
// 5 — log différé
```

Lance-le : `node mini-runtime.mjs`. La sortie confirme que le `setTimeout` (macrotask) passe **après** tous les `await` (microtasks) — « appelé avant » ≠ « exécuté avant ».

### Comparaison avec le vrai Node

```js
// compare.mjs — même scénario, vraies API
const real = [];
(async () => {
  real.push('1 — début');
  await Promise.resolve();
  real.push('3 — famille chargée');
  setTimeout(() => {
    real.push('5 — log différé');
    console.log('NODE RÉEL   :\n' + real.join('\n'));
  }, 0);
  await Promise.resolve();
  real.push('4 — membres chargés');
})();
real.push('2 — appel lancé');
```

`node compare.mjs` doit afficher **exactement le même ordre**. Si les deux coïncident, ton mini-runtime est un modèle fidèle du vrai — c'est le critère de réussite.

## Variante J+30 (fading)

Reprends le projet **de mémoire, en 25 min, sans relire le corrigé**, avec une contrainte ajoutée : implémente `MyPromise.all(runtime, [p1, p2, p3])` qui résout un tableau de valeurs quand **toutes** les promises sont fulfilled, et rejette au **premier** rejet — le tout en restant branché sur la microtask queue du mini-runtime (aucun `setTimeout`). Vérifie avec un scénario où `all` doit se résoudre **avant** un `setTimeout(...,0)` concurrent, puis compare à `Promise.all` de Node.

## Application TribuZen

Porte le livrable dans `smaurier/tribuzen` sous `scripts/runtime-sandbox/` :

- `mini-runtime.mjs` — le `MiniRuntime` + `MyPromise` + `runAsync` ci-dessus.
- `replay-dashboard.mjs` — rejoue l'ordonnancement de `GET /families/:id/dashboard` (2 `await` DB via `MyPromise.resolve` sur fixtures, 1 `setTimeout` de télémétrie, 1 `queueMicrotask` de cache-warming). Lis `rt.trace` pour prouver que le log de télémétrie sort toujours après le dernier `await`.
- `compare-node.mjs` — le même scénario avec les vraies API + `console.log` de l'ordre, pour confirmer que le sandbox est fidèle au runtime réel.

Commit dans `smaurier/tribuzen` : `feat(runtime-sandbox): mini event loop pour déboguer l'ordre async du dashboard`. L'outil sert d'argument d'équipe : avant de blâmer le réseau sur un log « mal placé », on rejoue l'ordonnancement dans le sandbox.
