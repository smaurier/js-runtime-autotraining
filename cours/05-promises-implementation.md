# Module 05 — Promises : Implémentation Interne

> **Objectif** : Comprendre comment le moteur V8 implémente les Promises en interne, maîtriser la procédure de résolution des thenables, et être capable d'implémenter une Promise conforme Promises/A+ depuis zéro.

> **Difficulté** : ⭐⭐⭐⭐ (Expert) — Le module le plus technique du cours.

> **Pas de panique !** Ce module est le plus technique du cours. Tu n'as PAS besoin de tout comprendre du premier coup. L'objectif est de démystifier les Promises, pas de mémoriser les structures internes de V8. Si les sections sur les structures C++ te semblent trop abstraites, saute directement aux démonstrations — elles sont bien plus concrètes.

---

## Prérequis

- Maîtrise complète de l'event loop, microtâches et macrotâches (Modules 03-04)
- Connaissance approfondie de l'API Promise (`then`, `catch`, `finally`, combinateurs)
- Familiarité avec `async/await` et leur lien avec les Promises
- Notions de C++ utiles (pour comprendre le code V8) mais pas obligatoires

---

## Théorie

> 🎯 **Analogie** : Une Promise, c'est comme un ticket de pressing. Tu déposes ton vêtement (tu lances l'opération), on te donne un ticket (la Promise). Trois états possibles : en attente (pending), prêt à récupérer (fulfilled), ou perdu/abîmé (rejected). Le ticket ne change d'état qu'une fois.

### 1. Les états d'une Promise

Une Promise possède exactement trois états possibles, et les transitions sont **irréversibles** :

```
                    ┌──────────────────┐
                    │                  │
          resolve(value)          reject(reason)
                    │                  │
                    v                  v
  ┌─────────┐  ┌─────────────┐  ┌──────────┐
  │ pending │──│  fulfilled   │  │ rejected │
  │         │  │ (value)      │  │ (reason) │
  └─────────┘  └─────────────┘  └──────────┘
       │              │                │
       │              └────────┬───────┘
       │                       │
       │                  ┌────┴────┐
       │                  │ settled │ (terme générique)
       │                  └─────────┘
       │
  En attente de résolution.
  Les handlers .then() sont
  mis en file d'attente.
```

**Règles fondamentales** :
- Une Promise ne peut changer d'état qu'une seule fois (pending -> fulfilled OU pending -> rejected)
- Appeler `resolve()` ou `reject()` après que la Promise est déjà settled n'a aucun effet
- Les handlers `.then()` sont toujours exécutés de manière asynchrone (microtâche), même si la Promise est déjà settled

> ⚙️ **Section technique avancée** — Les sections suivantes explorent comment V8 implémente les Promises en interne. Si c'est ta première lecture, concentre-toi sur les **diagrammes ASCII** et les **concepts généraux**. Tu n'as pas besoin de mémoriser les noms des structures C++. L'objectif est de comprendre le *pourquoi*, pas le *comment exact*. Tu peux revenir ici plus tard.

### 2. Comment V8 implémente les Promises en interne

V8 (le moteur JavaScript de Chrome et Node.js) implémente les Promises en C++. Voici les structures internes clés :

```
  Structure interne d'un objet JSPromise dans V8 :

  ┌──────────────────────────────────────────────┐
  │  JSPromise                                   │
  ├──────────────────────────────────────────────┤
  │  status       : kPending | kFulfilled        │
  │               | kRejected                    │
  ├──────────────────────────────────────────────┤
  │  result       : undefined (si pending)       │
  │               | value (si fulfilled)         │
  │               | reason (si rejected)         │
  ├──────────────────────────────────────────────┤
  │  reactions    : PromiseReaction (liste)       │
  │               | undefined (si settled)       │
  ├──────────────────────────────────────────────┤
  │  has_handler  : bool (pour unhandled reject) │
  │  handled_hint : bool                         │
  └──────────────────────────────────────────────┘
```

Quand on appelle `.then(onFulfilled, onRejected)`, V8 crée un objet **PromiseReaction** :

```
  PromiseReaction :

  ┌────────────────────────────────────────────────┐
  │  next            : PromiseReaction | undefined  │
  │  reject_handler  : callable | undefined         │
  │  fulfill_handler : callable | undefined         │
  │  promise_or_capability : JSPromise              │
  └────────────────────────────────────────────────┘

  Les reactions forment une liste chaînée :

  JSPromise.reactions ──> Reaction1 ──> Reaction2 ──> Reaction3 ──> undefined
```

**Quand la Promise est encore pending** : les PromiseReaction sont stockées dans la liste `reactions`.

**Quand la Promise est settled** : V8 itère la liste de reactions et crée un **PromiseReactionJob** (microtâche) pour chacune.

> 🧺 **Pour reprendre l'analogie du pressing** :
>
> - La **chaîne de PromiseReaction** = la liste des clients qui attendent leurs vêtements. Chaque `.then()` ajoute un client à la file.
> - Le **PromiseResolveThenableJob** = quand le pressing découvre que ton vêtement doit passer chez un spécialiste d'abord, ajoutant une attente supplémentaire (un tick de microtâche en plus).
> - Les états **fulfilled** / **rejected** / **pending** = les états du ticket : « prêt à récupérer » (fulfilled), « problème signalé » (rejected), « en cours de traitement » (pending). Une fois tamponné, le ticket ne change plus.

```
  Cycle de vie d'un .then() :

  promise.then(onFulfilled)
      │
      ├── Si promise est pending :
      │   └── Créer PromiseReaction, l'ajouter à promise.reactions
      │       (sera traité quand promise sera settled)
      │
      └── Si promise est déjà fulfilled :
          └── Créer immédiatement un PromiseReactionJob
              et l'ajouter à la file de microtâches
```

### 3. La procédure de résolution des Promises (Promise Resolution)

Quand on appelle `resolve(x)`, la valeur `x` subit une analyse appelée la **Promise Resolution Procedure** (spécifiée dans Promises/A+ section 2.3) :

```
  resolve(x) :
      │
      ├── Si x === promise elle-même :
      │   └── TypeError (cycle détecté)
      │
      ├── Si x est une Promise :
      │   └── Adopter l'état de x (then de x)
      │
      ├── Si x est un objet ou une fonction :
      │   ├── Récupérer x.then (UNE seule fois)
      │   ├── Si then est une fonction :
      │   │   └── x est un "thenable" !
      │   │       Appeler then.call(x, resolvePromise, rejectPromise)
      │   │       -> Ceci crée un PromiseResolveThenableJob
      │   │       -> Cela coûte un tick de microtâche supplémentaire !
      │   └── Si then n'est pas une fonction :
      │       └── fulfill(x) directement
      │
      └── Sinon (primitif) :
          └── fulfill(x) directement
```

### 4. Le thenable unwrapping et le tick supplémentaire

C'est l'un des aspects les plus subtils et les moins compris des Promises. Quand on résout une Promise avec un **thenable** (un objet qui à une méthode `.then()`), V8 crée un job spécial :

```typescript
// Cas 1 : résolution avec une valeur primitive
new Promise(resolve => resolve(42));
// -> fulfill immédiat, pas de tick supplémentaire

// Cas 2 : résolution avec un thenable (incluant une Promise)
new Promise(resolve => resolve(Promise.resolve(42)));
// -> PromiseResolveThenableJob créé
// -> 1 tick de microtâche supplémentaire !
```

Le **PromiseResolveThenableJob** fait ceci en interne :

```typescript
// Pseudocode de PromiseResolveThenableJob :
function PromiseResolveThenableJob(promiseToResolve: Promise<unknown>, thenable: PromiseLike<unknown>, then: Function): void {
  // Appeler then sur le thenable avec les résolveurs de promiseToResolve
  then.call(
    thenable,
    (value) => resolve(promiseToResolve, value),  // peut déclencher un autre unwrap !
    (reason) => reject(promiseToResolve, reason)
  );
}
```

Visualisation du coût en ticks :

```
  resolve(42)                    resolve(Promise.resolve(42))
  ============                   ============================

  Tick 0: fulfill(42)            Tick 0: détecter thenable
          handlers appelables             créer PromiseResolveThenableJob

                                 Tick 1: exécuter PromiseResolveThenableJob
                                         -> then.call(thenable, resolve, reject)
                                         -> resolve reçoit 42

                                 Tick 2: handlers appelables
                                         (car resolve(42) a été
                                          appelé depuis une microtâche)

  Total : 0 ticks extra          Total : 2 ticks extra
```

### 5. `Promise.resolve(x)` vs `new Promise(r => r(x))`

Ces deux formes semblent identiques mais ont un comportement subtilement différent :

```typescript
// Cas avec une valeur primitive : comportement identique
Promise.resolve(42);           // -> Promise fulfilled avec 42
new Promise(r => r(42));       // -> Promise fulfilled avec 42

// Cas avec une Promise : COMPORTEMENT DIFFERENT
const p = Promise.resolve(42);

Promise.resolve(p);            // -> retourne p ELLE-MEME (pas de copie !)
new Promise(r => r(p));        // -> crée une NOUVELLE Promise qui adopte p
                               //    via PromiseResolveThenableJob
                               //    (tick supplémentaire !)
```

```typescript
// Preuve de la différence
const original = Promise.resolve('hello');

const a = Promise.resolve(original);
console.log(a === original); // true ! C'est le même objet

const b = new Promise(resolve => resolve(original));
console.log(b === original); // false ! Nouvelle Promise

// Conséquence sur le timing :
original.then(() => console.log('original'));
a.then(() => console.log('Promise.resolve'));
b.then(() => console.log('new Promise'));

// Sortie : original, Promise.resolve, new Promise
// "new Promise" arrive en dernier à cause du PromiseResolveThenableJob
```

La spécification ECMA-262 (section 27.2.4.7) dit explicitement :

> If `IsPromise(x)` is true, and `x.constructor === C` (même constructeur), return `x`.

Donc `Promise.resolve(existingPromise)` est un **raccourci** qui évite le thenable unwrapping.

### 6. Le PromiseResolveThenableJob en détail

Ce mécanisme est défini dans ECMA-262 section 27.2.2.2. Voici ce que V8 fait quand `resolve(thenable)` est appelé :

```
  resolve(thenable) dans V8 :

  1. Vérifier si thenable a une méthode .then
     └── Si oui : EnqueueMicrotask(PromiseResolveThenableJob)
     └── Si non : FulfillPromise(value)

  PromiseResolveThenableJob exécuté (1 tick plus tard) :

  2. Appeler thenable.then(resolveElement, rejectElement)
     └── resolveElement est un callback interne
     └── quand thenable se résout, resolveElement(value) est appelé

  3. resolveElement(value) appelle resolve sur la Promise originale
     └── Si value est encore un thenable : recommencer à l'étape 1
     └── Sinon : FulfillPromise(value)
     └── Les handlers .then() sont planifiés comme microtâches (1 tick)
```

```typescript
// Impact pratique : combien de ticks avant d'obtenir la valeur ?

// 0 ticks extra (résolution directe)
const p1 = Promise.resolve(42);
p1.then(v => console.log('p1:', v)); // tick 1 (handler .then normal)

// 2 ticks extra (thenable unwrapping)
const p2 = new Promise(resolve => resolve(Promise.resolve(42)));
p2.then(v => console.log('p2:', v)); // tick 1 + 2 ticks = tick 3

// Preuve par entrelacement
Promise.resolve()
  .then(() => console.log('tick 1'))
  .then(() => console.log('tick 2'))
  .then(() => console.log('tick 3'))
  .then(() => console.log('tick 4'));

// Sortie (Node.js 12+ / V8 7.2+ avec l'optimisation "fast async") :
// tick 1
// p1: 42      <-- p1 arrive au tick 1
// tick 2
// tick 3
// p2: 42      <-- p2 arrive au tick 3 (2 ticks de retard)
// tick 4
//
// NOTE : le nombre exact de ticks pour le thenable unwrapping a changé
// selon les versions de V8. Avant V8 7.2 (Node.js < 12), le coût était
// de 3 ticks supplémentaires. Depuis V8 7.2+ (Node.js 12+), l'optimisation
// "fast async" réduit ce coût à 2 ticks pour les Promises natives.
// Les résultats ci-dessus sont valables pour Node.js 12+.
```

> ⚙️ **Fin de la section technique avancée** — Si tu avais sauté les sections V8 internes, tu peux reprendre ici. Ce qui suit est pratique et concret.

### 7. Implémenter une Promise Promises/A+ depuis zéro

Voici une implémentation pas à pas conforme à la spécification Promises/A+ :

```typescript
// promise-aplus.js — Implémentation Promises/A+ complète

const PENDING = 'pending' as const;
const FULFILLED = 'fulfilled' as const;
const REJECTED = 'rejected' as const;

type PromiseState = typeof PENDING | typeof FULFILLED | typeof REJECTED;

class MyPromise {
  private _state: PromiseState;
  private _value: unknown;
  private _reason: unknown;
  private _onFulfilledCallbacks: (() => void)[];
  private _onRejectedCallbacks: (() => void)[];

  constructor(executor: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => void) {
    this._state = PENDING;
    this._value = undefined;
    this._reason = undefined;
    this._onFulfilledCallbacks = [];
    this._onRejectedCallbacks = [];

    const resolve = (value: unknown): void => {
      // Si value est un thenable, on doit unwrap
      if (value instanceof MyPromise) {
        value.then(resolve, reject);
        return;
      }
      if (this._state !== PENDING) return;
      this._state = FULFILLED;
      this._value = value;
      this._onFulfilledCallbacks.forEach(fn => fn());
    };

    const reject = (reason: unknown): void => {
      if (this._state !== PENDING) return;
      this._state = REJECTED;
      this._reason = reason;
      this._onRejectedCallbacks.forEach(fn => fn());
    };

    try {
      executor(resolve, reject);
    } catch (err) {
      reject(err);
    }
  }

  then(onFulfilled?: ((value: unknown) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null): MyPromise {
    // 2.2.1 : les arguments sont optionnels
    onFulfilled = typeof onFulfilled === 'function'
      ? onFulfilled
      : (value) => value;           // identité : passe la valeur
    onRejected = typeof onRejected === 'function'
      ? onRejected
      : (reason) => { throw reason; }; // re-throw : propage l'erreur

    // 2.2.7 : then retourne une nouvelle Promise
    const promise2 = new MyPromise((resolve, reject) => {
      const fulfilledTask = () => {
        // 2.2.4 : exécution asynchrone (microtâche)
        queueMicrotask(() => {
          try {
            const x = onFulfilled(this._value);
            resolvePromise(promise2, x, resolve, reject);
          } catch (err) {
            reject(err);
          }
        });
      };

      const rejectedTask = () => {
        queueMicrotask(() => {
          try {
            const x = onRejected(this._reason);
            resolvePromise(promise2, x, resolve, reject);
          } catch (err) {
            reject(err);
          }
        });
      };

      if (this._state === FULFILLED) {
        fulfilledTask();
      } else if (this._state === REJECTED) {
        rejectedTask();
      } else {
        // pending : stocker les callbacks
        this._onFulfilledCallbacks.push(fulfilledTask);
        this._onRejectedCallbacks.push(rejectedTask);
      }
    });

    return promise2;
  }

  catch(onRejected?: ((reason: unknown) => unknown) | null): MyPromise {
    return this.then(null, onRejected);
  }

  finally(onFinally: () => unknown): MyPromise {
    return this.then(
      (value) => MyPromise.resolve(onFinally()).then(() => value),
      (reason) => MyPromise.resolve(onFinally()).then(() => { throw reason; })
    );
  }

  static resolve(value: unknown): MyPromise {
    if (value instanceof MyPromise) return value; // raccourci spec
    return new MyPromise((resolve) => resolve(value));
  }

  static reject(reason: unknown): MyPromise {
    return new MyPromise((_, reject) => reject(reason));
  }
}
```

La **Promise Resolution Procedure** (spec section 2.3) :

```typescript
// 2.3 : The Promise Resolution Procedure
function resolvePromise(promise2: MyPromise, x: unknown, resolve: (value: unknown) => void, reject: (reason: unknown) => void): void {
  // 2.3.1 : si promise2 === x, TypeError (cycle)
  if (promise2 === x) {
    return reject(new TypeError('Chaining cycle detected'));
  }

  // 2.3.2 : si x est une MyPromise
  if (x instanceof MyPromise) {
    x.then(
      (value) => resolvePromise(promise2, value, resolve, reject),
      reject
    );
    return;
  }

  // 2.3.3 : si x est un objet ou une fonction
  if (x !== null && (typeof x === 'object' || typeof x === 'function')) {
    let called = false; // 2.3.3.3.3 : ne pas appeler plus d'une fois

    try {
      const then = x.then; // 2.3.3.1 : récupérer then UNE SEULE FOIS

      if (typeof then === 'function') {
        // 2.3.3.3 : x est un thenable
        then.call(
          x,
          (y) => {
            if (called) return;
            called = true;
            // 2.3.3.3.1 : résolution récursive
            resolvePromise(promise2, y, resolve, reject);
          },
          (r) => {
            if (called) return;
            called = true;
            reject(r);
          }
        );
      } else {
        // 2.3.3.4 : then n'est pas une fonction
        resolve(x);
      }
    } catch (err) {
      // 2.3.3.2 : si récupérer then lance une erreur
      if (called) return;
      reject(err);
    }
  } else {
    // 2.3.4 : x est une primitive
    resolve(x);
  }
}
```

### 8. Les combinateurs Promise : comportement interne

```
  Promise.all([p1, p2, p3])
  =========================

  Crée une Promise résultat.
  Compteur interne : remaining = 3
  Tableau de résultats : [undefined, undefined, undefined]

  Pour chaque p[i] :
    p[i].then(
      (value) => {
        results[i] = value;    // position préservée !
        remaining--;
        if (remaining === 0) resolve(results);
      },
      (reason) => {
        reject(reason);        // premier rejet -> tout rejette
      }
    )
```

```
  Promise.race([p1, p2, p3])
  ==========================

  Crée une Promise résultat.

  Pour chaque p[i] :
    p[i].then(
      (value) => resolve(value),   // premier settled gagne
      (reason) => reject(reason)   // (resolve/reject ignorés après)
    )
```

```
  Promise.allSettled([p1, p2, p3])
  ================================

  Crée une Promise résultat.
  Compteur : remaining = 3
  Tableau : [{}, {}, {}]

  Pour chaque p[i] :
    p[i].then(
      (value) => {
        results[i] = { status: 'fulfilled', value };
        remaining--;
        if (remaining === 0) resolve(results);
      },
      (reason) => {
        results[i] = { status: 'rejected', reason };
        remaining--;
        if (remaining === 0) resolve(results);  // ne rejette JAMAIS
      }
    )
```

```
  Promise.any([p1, p2, p3])
  =========================

  Crée une Promise résultat.
  Compteur rejets : rejectedCount = 0
  Tableau d'erreurs : []

  Pour chaque p[i] :
    p[i].then(
      (value) => resolve(value),   // premier fulfilled gagne
      (reason) => {
        errors[i] = reason;
        rejectedCount++;
        if (rejectedCount === n) {
          reject(new AggregateError(errors, 'All promises were rejected'));
        }
      }
    )
```

Implémentation de `Promise.all` avec notre `MyPromise` :

```typescript
MyPromise.all = function(promises: MyPromise[]): MyPromise {
  return new MyPromise((resolve, reject) => {
    const results: unknown[] = [];
    let remaining = 0;

    if (promises.length === 0) {
      resolve(results);
      return;
    }

    promises.forEach((promise, index) => {
      remaining++;
      MyPromise.resolve(promise).then(
        (value) => {
          results[index] = value;
          remaining--;
          if (remaining === 0) {
            resolve(results);
          }
        },
        reject // premier rejet propage
      );
    });
  });
};

MyPromise.race = function(promises: MyPromise[]): MyPromise {
  return new MyPromise((resolve, reject) => {
    promises.forEach((promise) => {
      MyPromise.resolve(promise).then(resolve, reject);
    });
  });
};

MyPromise.allSettled = function(promises: MyPromise[]): MyPromise {
  return new MyPromise((resolve) => {
    const results: { status: string; value?: unknown; reason?: unknown }[] = [];
    let remaining = promises.length;

    if (remaining === 0) {
      resolve(results);
      return;
    }

    promises.forEach((promise, index) => {
      MyPromise.resolve(promise).then(
        (value) => {
          results[index] = { status: 'fulfilled', value };
          if (--remaining === 0) resolve(results);
        },
        (reason) => {
          results[index] = { status: 'rejected', reason };
          if (--remaining === 0) resolve(results);
        }
      );
    });
  });
};

MyPromise.any = function(promises: MyPromise[]): MyPromise {
  return new MyPromise((resolve, reject) => {
    const errors: unknown[] = [];
    let rejectedCount = 0;
    const total = promises.length;

    if (total === 0) {
      reject(new AggregateError([], 'All promises were rejected'));
      return;
    }

    promises.forEach((promise, index) => {
      MyPromise.resolve(promise).then(
        resolve,
        (reason) => {
          errors[index] = reason;
          rejectedCount++;
          if (rejectedCount === total) {
            reject(new AggregateError(errors, 'All promises were rejected'));
          }
        }
      );
    });
  });
};
```

### 9. Détection des rejets non gérés (HostPromiseRejectionTracker)

Quand une Promise est rejetée sans handler `.catch()`, le moteur doit le signaler. V8 utilise l'opération hôte **HostPromiseRejectionTracker** définie dans ECMA-262 :

```
  Cycle de détection du rejet non géré :

  ┌─────────────────────────────────────────────────┐
  │ 1. Promise rejetée, has_handler = false         │
  │    -> HostPromiseRejectionTracker(promise,       │
  │       "reject")                                 │
  │    -> Promise ajoutée à la liste de suivi       │
  ├─────────────────────────────────────────────────┤
  │ 2. Si .catch() est ajouté plus tard :           │
  │    -> has_handler = true                        │
  │    -> HostPromiseRejectionTracker(promise,       │
  │       "handle")                                 │
  │    -> Promise retirée de la liste               │
  ├─────────────────────────────────────────────────┤
  │ 3. À la fin du tick (microtask checkpoint) :    │
  │    -> Vérifier la liste de suivi                │
  │    -> Si promise toujours sans handler :        │
  │       -> Émettre "unhandledrejection" (browser) │
  │       -> Émettre "unhandledRejection" (Node.js) │
  └─────────────────────────────────────────────────┘
```

```typescript
// Navigateur
window.addEventListener('unhandledrejection', (event) => {
  console.log('Promise rejetée non gérée:', event.reason);
  event.preventDefault(); // empêche l'affichage dans la console
});

// Node.js
process.on('unhandledRejection', (reason, promise) => {
  console.log('Promise rejetée non gérée:', reason);
});

// Depuis Node.js 15+ : les rejets non gérés TERMINENT le processus
// (comportement identique à une exception non attrapée)
```

**Timing subtil** : un `.catch()` ajouté de manière asynchrone dans le même tick empêche le signalement :

```typescript
const p = Promise.reject(new Error('boom'));

// Ceci est une microtâche — exécutée dans le même tick
queueMicrotask(() => {
  p.catch(() => {}); // ajouté à temps, pas d'unhandledRejection
});

// MAIS ceci est trop tard :
setTimeout(() => {
  p.catch(() => {}); // trop tard ! unhandledRejection déjà émis
  // suivi de "rejectionhandled" quand le .catch est finalement ajouté
}, 0);
```

### 10. Optimisations V8 pour les Promises

V8 a considérablement optimisé les Promises au fil des versions :

**Zero-cost async stack traces** (V8 7.3+) : V8 capture les stack traces de manière paresseuse pour `await`, permettant un debugging sans coût de performance en production.

**Fast async (V8 7.2+)** : réduction du nombre de microticks pour `await`. Avant cette optimisation, `await x` créait toujours un thenable wrapping inutile. Maintenant, si `x` est une Promise native, V8 fait un raccourci.

```
  Avant V8 7.2 :              Après V8 7.2 :
  await promise                await promise
      │                            │
      ├── tick 1: wrap             ├── tick 1: résultat
      ├── tick 2: unwrap           │   (raccourci si Promise
      └── tick 3: résultat         │    native)
                                   │
  3 ticks                      1 tick
```

---

## Démonstration

### Demo 1 — Observer le thenable unwrapping

```typescript
// demo1-thenable-unwrapping.js

// Compteur de ticks
let tick: number = 0;
function nextTick(): Promise<void> {
  return Promise.resolve().then(() => {
    tick++;
    console.log(`  [tick ${tick}]`);
  });
}

console.log('--- Résolution avec valeur primitive ---');
const p1 = new Promise(resolve => resolve(42));
p1.then(v => console.log(`  p1 résolu: ${v} (tick ${tick})`));
nextTick().then(nextTick).then(nextTick);

// Attendre que tout soit fini avant le test suivant
setTimeout(() => {
  tick = 0;
  console.log('\n--- Résolution avec thenable (Promise) ---');
  const p2 = new Promise(resolve => resolve(Promise.resolve(42)));
  p2.then(v => console.log(`  p2 résolu: ${v} (tick ${tick})`));
  nextTick().then(nextTick).then(nextTick);
}, 100);

// Sortie attendue :
// --- Résolution avec valeur primitive ---
//   p1 résolu: 42 (tick 0)    <-- résolu dès le premier tick
//   [tick 1]
//   [tick 2]
//   [tick 3]
//
// --- Résolution avec thenable (Promise) ---
//   [tick 1]
//   [tick 2]
//   p2 résolu: 42 (tick 2)    <-- 2 ticks de retard !
//   [tick 3]
```

### Demo 2 — Promise.resolve(p) vs new Promise(r => r(p))

```typescript
// demo2-resolve-vs-new.js

const original = Promise.resolve('valeur');

// Test d'identité
const viaResolve = Promise.resolve(original);
const viaNew = new Promise(resolve => resolve(original));

console.log('Promise.resolve(p) === p :', viaResolve === original); // true
console.log('new Promise(r=>r(p)) === p :', viaNew === original);   // false

// Test de timing
console.log('\n--- Timing ---');

original.then(() => console.log('1. original.then'));
viaResolve.then(() => console.log('2. Promise.resolve(p).then'));
viaNew.then(() => console.log('3. new Promise(r=>r(p)).then'));

Promise.resolve()
  .then(() => console.log('   tick 1'))
  .then(() => console.log('   tick 2'))
  .then(() => console.log('   tick 3'));

// Sortie :
// 1. original.then
// 2. Promise.resolve(p).then   <-- même tick que original
//    tick 1
// 3. new Promise(r=>r(p)).then <-- retardé par PromiseResolveThenableJob
//    tick 2
//    tick 3
```

### Demo 3 — Implémentation MyPromise avec tests

```typescript
// demo3-mypromise-test.js
// Coller le code MyPromise + resolvePromise ci-dessus, puis :

// Test 1 : résolution basique
MyPromise.resolve(42).then(v => {
  console.log('Test 1 - resolve:', v === 42 ? 'PASS' : 'FAIL');
});

// Test 2 : chaînage
MyPromise.resolve(1)
  .then(v => v + 1)
  .then(v => v * 3)
  .then(v => {
    console.log('Test 2 - chaining:', v === 6 ? 'PASS' : 'FAIL');
  });

// Test 3 : rejet et catch
MyPromise.reject(new Error('boom'))
  .catch(err => {
    console.log('Test 3 - reject:', err.message === 'boom' ? 'PASS' : 'FAIL');
  });

// Test 4 : thenable unwrapping
new MyPromise(resolve => {
  resolve(new MyPromise(resolve2 => resolve2('unwrapped')));
}).then(v => {
  console.log('Test 4 - thenable:', v === 'unwrapped' ? 'PASS' : 'FAIL');
});

// Test 5 : Promise.all
MyPromise.all([
  MyPromise.resolve(1),
  MyPromise.resolve(2),
  MyPromise.resolve(3),
]).then(values => {
  const pass = values[0] === 1 && values[1] === 2 && values[2] === 3;
  console.log('Test 5 - all:', pass ? 'PASS' : 'FAIL');
});

// Test 6 : Promise.race
MyPromise.race([
  new MyPromise(resolve => setTimeout(() => resolve('slow'), 100)),
  MyPromise.resolve('fast'),
]).then(v => {
  console.log('Test 6 - race:', v === 'fast' ? 'PASS' : 'FAIL');
});

// Test 7 : détection de cycle
const cyclePromise = new MyPromise((resolve) => {
  setTimeout(() => resolve(cyclePromise), 0);
});
cyclePromise.catch(err => {
  console.log('Test 7 - cycle:', err instanceof TypeError ? 'PASS' : 'FAIL');
});

// Test 8 : finally
MyPromise.resolve('hello')
  .finally(() => {
    console.log('Test 8a - finally called: PASS');
  })
  .then(v => {
    console.log('Test 8b - finally preserves value:', v === 'hello' ? 'PASS' : 'FAIL');
  });
```

### Demo 4 — Visualiser les PromiseReaction jobs

```typescript
// demo4-reaction-jobs.js

// Simuler l'observation des microtâches créées par les Promises
console.log('--- Observation des PromiseReaction jobs ---\n');

const p = new Promise((resolve) => {
  console.log('Constructeur exécuté (synchrone)');
  // Ne pas résoudre immédiatement
  setTimeout(() => {
    console.log('\nresolve(42) appelé dans setTimeout');
    console.log('Cela crée un PromiseReactionJob pour chaque .then()');
    resolve(42);
  }, 50);
});

// Ajout de 3 handlers pendant que la Promise est pending
// -> 3 PromiseReaction stockées dans la liste interne
p.then(v => console.log(`  Handler A reçoit: ${v}`));
p.then(v => console.log(`  Handler B reçoit: ${v}`));
p.then(v => console.log(`  Handler C reçoit: ${v}`));

console.log('3 handlers enregistrés (Promise encore pending)\n');

// Quand resolve(42) est appelé :
// 1. L'état passe à fulfilled, value = 42
// 2. Pour chaque PromiseReaction dans la liste :
//    -> Créer un PromiseReactionJob (microtâche)
// 3. Les 3 jobs sont ajoutés à la file de microtâches
// 4. Ils s'exécutent dans l'ordre d'enregistrement : A, B, C
```

### Demo 5 — Impact du thenable unwrapping sur async/await

```typescript
// demo5-async-await-ticks.js

async function directReturn(): Promise<number> {
  return 42; // résolution avec valeur primitive
}

async function promiseReturn(): Promise<number> {
  return Promise.resolve(42); // résolution avec thenable !
}

async function awaitAndReturn(): Promise<number> {
  const val = await Promise.resolve(42);
  return val; // après await, val est déjà unwrappé
}

console.log('--- Comparaison des timings async ---');

directReturn().then(v => console.log(`directReturn: ${v}`));
promiseReturn().then(v => console.log(`promiseReturn: ${v}`));
awaitAndReturn().then(v => console.log(`awaitAndReturn: ${v}`));

// Ticks de référence
Promise.resolve()
  .then(() => console.log('  tick 1'))
  .then(() => console.log('  tick 2'))
  .then(() => console.log('  tick 3'))
  .then(() => console.log('  tick 4'));

// Sortie (peut varier selon la version V8) :
// directReturn: 42       <-- tick 1
//   tick 1
// awaitAndReturn: 42     <-- tick 2 (1 await = 1 tick)
//   tick 2
// promiseReturn: 42      <-- tick 3 (thenable unwrapping)
//   tick 3
//   tick 4
//
// promiseReturn est le PLUS LENT car return Promise.resolve(42)
// déclenche le PromiseResolveThenableJob.
// Recommandation : préférer return 42 à return Promise.resolve(42)
```

---

### V8 vs SpiderMonkey (Firefox)

> 📋 **Rappel** : Les Promises sont entièrement définies par la spécification ECMA-262 (section 27.2). Leur comportement observable est **identique** dans tous les moteurs conformes. Les différences ci-dessous sont purement internes.

**Le comportement des Promises est identique dans tous les moteurs** — c'est l'un des domaines les mieux spécifiés de JavaScript. Les trois états (pending, fulfilled, rejected), la procédure de résolution, le thenable unwrapping et le timing des microtâches sont définis avec précision par la spec ECMA-262.

**Structures internes : noms différents, même concept** :

| Concept | V8 (Chrome/Node.js) | SpiderMonkey (Firefox) |
|---------|---------------------|------------------------|
| Objet Promise | `JSPromise` | `PromiseObject` |
| Handlers en attente | `PromiseReaction` (liste chaînée) | `PromiseReactionRecord` (liste) |
| Job de résolution thenable | `PromiseResolveThenableJob` | `PromiseResolveThenableJob` (même nom, défini par la spec) |
| Détection rejet non géré | `HostPromiseRejectionTracker` | `HostPromiseRejectionTracker` (même API hôte) |

**Le nombre de ticks pour le thenable unwrapping** est défini par la spécification. Quand on fait `resolve(Promise.resolve(42))`, le nombre de microtâches intermédiaires (2 ticks supplémentaires) est le même dans V8 et SpiderMonkey, car c'est la spec qui impose la création d'un `PromiseResolveThenableJob`.

**Différences de performance** :

- **V8 « fast async »** (V8 7.2+) : V8 a introduit une optimisation qui réduit le nombre de ticks pour `await` sur une Promise native de 3 à 1. Cette optimisation est spécifique à V8 — SpiderMonkey peut ne pas avoir le même raccourci interne, bien que le résultat observable soit conforme à la spec dans les deux cas.
- **SpiderMonkey optimise différemment** : Firefox utilise ses propres heuristiques pour le fast-path des Promises. Les benchmarks montrent des performances comparables, mais les chemins d'optimisation internes diffèrent.
- **En pratique** : si tu observes un nombre de ticks différent entre Chrome et Firefox pour un cas précis, c'est que l'un des deux exploite une optimisation que la spec autorise (la spec définit un minimum de ticks, mais un moteur peut en avoir plus dans certains cas edge).

**Conclusion** : quand tu implémentes du code avec des Promises, ne te soucie pas du moteur. Le comportement est garanti par la spec. Les différences internes (noms de structures, optimisations de performance) sont transparentes pour le développeur.

---

## Points clés

1. **Une Promise a 3 états** : pending, fulfilled, rejected. Les transitions sont irréversibles et ne se produisent qu'une fois.

2. **V8 utilise des PromiseReaction** : objets internes qui forment une liste chaînée stockée sur la Promise tant qu'elle est pending.

3. **Le thenable unwrapping coûte des ticks** : `resolve(thenable)` crée un `PromiseResolveThenableJob` qui ajoute au moins 1 microtâche supplémentaire au cycle.

4. **`Promise.resolve(p)` est un raccourci** : si `p` est une Promise native du même constructeur, elle est retournée telle quelle (pas de copie, pas de tick supplémentaire).

5. **`new Promise(r => r(p))` est toujours plus lent** que `Promise.resolve(p)` quand `p` est une Promise, à cause du thenable unwrapping.

6. **La Promise Resolution Procedure** (Promises/A+ 2.3) est l'algorithme central : elle gère la détection de cycles, le unwrapping récursif des thenables, et la protection contre les thenables malveillants (flag `called`).

7. **Les combinateurs** (`all`, `race`, `allSettled`, `any`) créent une Promise résultat et souscrivent à chaque Promise d'entrée avec des handlers internes qui partagent un état commun (compteur, tableau de résultats).

8. **`HostPromiseRejectionTracker`** est le mécanisme de V8 pour détecter les rejets non gérés. Il fonctionne en deux temps : signalement au rejet, annulation si un handler est ajouté avant la fin du tick.

9. **`async function` retournant une Promise** déclenche le thenable unwrapping. Préférer `return value` à `return Promise.resolve(value)` dans les fonctions async.

10. **V8 7.2+ optimise `await`** : pour les Promises natives, V8 évite le thenable wrapping inutile, réduisant le nombre de ticks de 3 à 1.

---

---

## Si tu es perdu

Si ce module t'a semblé dense, retiens juste ces 5 points :

1. **Une Promise est un objet avec 3 états** — `pending` (en attente), `fulfilled` (résolue), `rejected` (échouée). Une fois résolue ou échouée, elle ne change plus jamais.
2. **`.then()` retourne une NOUVELLE Promise** — c'est ce qui permet le chaînage. Chaque `.then()` crée un maillon de la chaîne.
3. **Les callbacks `.then()` s'exécutent en microtask** — jamais de façon synchrone. C'est pour ça que `Promise.resolve(42).then(x => console.log(x))` affiche 42 APRÈS le code synchrone qui suit.
4. **`resolve(uneAutrePromise)` crée une attente supplémentaire** — la Promise externe "adopte" l'état de la Promise interne. C'est le mécanisme le plus subtil.
5. **Tu n'as pas besoin de connaître les structures C++ de V8** — elles sont là pour les curieux. Ce qui compte, c'est de comprendre les 4 points ci-dessus.

Reviens relire ce module après le lab — implémenter ta propre Promise rend tout beaucoup plus concret.

---

## Pour aller plus loin

- [Promises/A+ Specification](https://promisesaplus.com/)
- [ECMA-262 — Promise Objects](https://tc39.es/ecma262/#sec-promise-objects)
- [ECMA-262 — PromiseResolveThenableJob](https://tc39.es/ecma262/#sec-promiseresolvethenablejob)
- [V8 Blog — Fast async](https://v8.dev/blog/fast-async)
- [V8 Source — promise.tq (Torque)](https://source.chromium.org/chromium/chromium/src/+/main:v8/src/builtins/promise.tq)
- [V8 Source — promise-resolve.tq](https://source.chromium.org/chromium/chromium/src/+/main:v8/src/builtins/promise-resolve.tq)
- [MDN — Promise](https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Global_Objects/Promise)
- [MDN — Using Promises](https://developer.mozilla.org/fr/docs/Web/JavaScript/Guide/Using_promises)
- [Node.js Docs — unhandledRejection](https://nodejs.org/api/process.html#event-unhandledrejection)
- [TC39 — Promise Combinators (any, allSettled)](https://github.com/tc39/proposal-promise-allSettled)

---

## Défi

Quel est l'ordre exact de sortie du code suivant ?

```typescript
const p1 = new Promise(resolve => {
  console.log('A');
  resolve(Promise.resolve('B'));
});

const p2 = Promise.resolve('C');

p1.then(v => console.log(v));
p2.then(v => console.log(v));

Promise.resolve()
  .then(() => console.log('D'))
  .then(() => console.log('E'))
  .then(() => console.log('F'))
  .then(() => console.log('G'));

console.log('H');
```

<details>
<summary>Réponse</summary>

**Sortie : `A, H, C, D, E, B, F, G`**

Raisonnement pas à pas :

**Code synchrone** :
- `A` : le constructeur de `new Promise` est synchrone
- `H` : dernier console.log synchrone
- `resolve(Promise.resolve('B'))` est appelé, mais l'argument est un thenable. Cela crée un **PromiseResolveThenableJob** (microtâche). p1 reste pending pour l'instant.
- `p2` est immédiatement fulfilled avec `'C'`.

**File de microtâches initiale** : `[PromiseResolveThenableJob(p1), p2.then(->C), Promise.resolve().then(->D)]`

Déroulement :

1. **PromiseResolveThenableJob** s'exécute : il appelle `Promise.resolve('B').then(resolveP1)`. Cela ajoute une nouvelle microtâche `resolveP1` en file. p1 est toujours pending.

2. **`C`** : `p2.then(v => console.log(v))` s'exécute, affiche C.

3. **`D`** : premier `.then()` de la chaîne, affiche D, ajoute le `.then(->E)` en file.

4. **resolveP1** s'exécute (microtâche créée à l'étape 1) : p1 est maintenant fulfilled avec `'B'`. Les handlers de p1 sont planifiés comme microtâches. Ajoute `p1.then(->B)` en file.

5. **`E`** : deuxième `.then()` de la chaîne, affiche E, ajoute `.then(->F)`.

6. **`B`** : `p1.then(v => console.log(v))` s'exécute, affiche B.

7. **`F`** : troisième `.then()`, affiche F, ajoute `.then(->G)`.

8. **`G`** : quatrième `.then()`, affiche G.

L'observation clé est que `resolve(Promise.resolve('B'))` cause **2 ticks de retard** avant que p1 ne soit settled : un tick pour le PromiseResolveThenableJob, puis un tick pour le `.then()` interne du thenable. C'est pourquoi `B` apparaît après `D` et `E` alors qu'on pourrait naïvement s'attendre à le voir plus tôt.

</details>

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 05 promises](../screencasts/screencast-05-promises.md)
2. **Lab** : [lab-05-promise-implementation](../labs/lab-05-promise-implementation/README)
3. **Quiz** : [quiz 05 promises](../quizzes/quiz-05-promises.html)
:::
