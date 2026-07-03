# Lab 05 — Implémenter une Promise (Promises/A+)

> **Outcome :** à la fin, tu sais construire une `MyPromise` de zéro (3 états, file de callbacks, `then` chaînable exécuté en microtask, résolution des thenables, `Promise.all`) et prédire le timing microtask de chaque callback.
> **Vrai outil :** Node.js (>= 18) exécuté en direct — `node myPromise.mjs`. Aucun harnais de test auto-correcteur : tu compares la sortie console à l'ordre attendu, à la main.
> **Feedback :** le coach valide en session (lecture de code + ordre de sortie observé).

---

## Énoncé

Tu reconstruis le moteur d'une Promise pour comprendre la couche « appels API » de TribuZen. Cahier des charges **exact** de `MyPromise` :

1. **3 états** — `pending`, `fulfilled`, `rejected`. Transition unique et irréversible (tout `resolve`/`reject` après settlement est un no-op).
2. **`constructor(executor)`** — appelle `executor(resolve, reject)` **synchronement** ; un `throw` dans l'executor rejette la Promise.
3. **File de callbacks** — sur une Promise pending, `then` **stocke** ses callbacks ; ils sont vidés au `resolve`/`reject`.
4. **`then(onFulfilled, onRejected)`** — retourne une **nouvelle** `MyPromise`, callbacks exécutés en **microtask** (`queueMicrotask`), jamais synchrone.
5. **Chaining** — retourner une valeur fulfill le maillon suivant ; retourner une `MyPromise` la fait **adopter** ; `throw` la rejette.
6. **Résolution des thenables** — `resolvePromise` absorbe récursivement tout objet avec `.then`, protège le cycle (`TypeError`) et l'appel multiple (flag `called`).
7. **Propagation du rejet** — un `then` sans `onRejected` propage le rejet ; `catch(fn)` = `then(null, fn)`.
8. **`MyPromise.all`** — résout un tableau ordonné quand toutes fulfilled, rejette au premier rejet (fail-fast).

**Contraintes :**
- **Pas de gap-fill** — tu écris chaque méthode depuis le starter vide.
- **Interdit** d'utiliser la `Promise` native à l'intérieur de `MyPromise` (sauf `queueMicrotask`, qui est l'ordonnanceur, pas une Promise).
- Tu vérifies le comportement en **lisant la sortie console**, pas avec un runner qui affiche PASS/FAIL.

### Starter minimal

Crée `myPromise.mjs` :

```js
// myPromise.mjs — à compléter
const PENDING = 'pending';
const FULFILLED = 'fulfilled';
const REJECTED = 'rejected';

class MyPromise {
  constructor(executor) {
    // TODO: state, value, reason, files de callbacks
    // TODO: resolve / reject internes (avec absorption thenable + no-op si settled)
    // TODO: try { executor(resolve, reject) } catch { reject }
  }

  then(onFulfilled, onRejected) {
    // TODO: defaults propageant, promise2, queueMicrotask, resolvePromise
  }

  catch(onRejected) {
    // TODO
  }

  static resolve(value) { /* TODO */ }
  static reject(reason) { /* TODO */ }
}

function resolvePromise(promise2, x, resolve, reject) {
  // TODO: cycle, thenable récursif + flag called, sinon resolve(x)
}

MyPromise.all = function (promises) {
  // TODO
};

export { MyPromise };
```

Et un scénario d'observation `run.mjs` :

```js
import { MyPromise } from './myPromise.mjs';

console.log('1 — sync début');

MyPromise.resolve('cache').then((v) => console.log('4 — then', v));

MyPromise.resolve(1)
  .then((v) => v + 1)
  .then((v) => new MyPromise((r) => r(v * 10))) // thenable adopté
  .then((v) => console.log('5 — chaîne', v));

MyPromise.reject(new Error('boom'))
  .then((v) => console.log('jamais', v)) // sauté
  .catch((e) => console.log('6 — catch', e.message));

MyPromise.all([MyPromise.resolve('fam'), MyPromise.resolve('membres')])
  .then(([a, b]) => console.log('7 — all', a, b));

console.log('2 — sync milieu');
console.log('3 — sync fin');
```

Lance `node run.mjs` et compare à l'ordre attendu (voir Étapes).

---

## Étapes (en friction)

1. **États + resolve/reject.** Écris le `constructor` : initialise `state`, `value`, `reason`, `onFulfilledCbs`, `onRejectedCbs`. Écris `resolve`/`reject` internes avec la garde `if (this.state !== PENDING) return`. Vérifie qu'un double `resolve` ne change rien.
2. **File de callbacks.** Dans `then`, si `state === PENDING`, **push** les tâches dans les files ; sinon planifie-les. Teste avec une Promise résolue par `setTimeout` : plusieurs `.then` doivent tous recevoir la valeur.
3. **Microtask.** Enveloppe chaque exécution de callback dans `queueMicrotask`. Vérifie que la sortie de `run.mjs` commence par `1, 2, 3` (sync) **avant** tout `then`.
4. **Chaining + `resolvePromise`.** `then` retourne `promise2` ; le résultat du callback passe dans `resolvePromise`. Écris `resolvePromise` : cycle → `TypeError`, thenable → absorption récursive avec flag `called`, sinon `resolve(x)`.
5. **Adoption d'un thenable.** Vérifie que le maillon `new MyPromise((r) => r(v * 10))` donne bien `5 — chaîne 20` (et pas un objet Promise).
6. **Propagation du rejet.** Vérifie que `MyPromise.reject(...).then(...).catch(...)` **saute** le `then` et logge `6 — catch boom`.
7. **`MyPromise.all`.** Implémente le combinateur (compteur `remaining`, résultats indexés, fail-fast). Vérifie `7 — all fam membres`.
8. **Ordre final.** La sortie complète attendue de `run.mjs` est : `1, 2, 3, 4, 6, 7, 5` (ou `4, 6, 7` avant `5` — voir corrigé pour le raisonnement de ticks). Explique à voix haute pourquoi `5` arrive après `4/6/7`.

---

## Corrigé complet commenté

```js
// myPromise.mjs — corrigé Promises/A+ (dans l'esprit)
const PENDING = 'pending';
const FULFILLED = 'fulfilled';
const REJECTED = 'rejected';

class MyPromise {
  constructor(executor) {
    this.state = PENDING;
    this.value = undefined;   // valeur si fulfilled
    this.reason = undefined;  // raison si rejected
    this.onFulfilledCbs = []; // callbacks stockés tant que pending
    this.onRejectedCbs = [];

    const resolve = (value) => {
      // transition unique : si déjà settled, no-op
      if (this.state !== PENDING) return;
      // si value est un thenable, on l'absorbe AVANT de settler
      if (value && (typeof value === 'object' || typeof value === 'function')) {
        const then = value.then;
        if (typeof then === 'function') {
          then.call(value, resolve, reject); // adoption (récursion)
          return;
        }
      }
      this.state = FULFILLED;
      this.value = value;
      this.onFulfilledCbs.forEach((cb) => cb()); // vider la file
    };

    const reject = (reason) => {
      if (this.state !== PENDING) return;
      this.state = REJECTED;
      this.reason = reason;
      this.onRejectedCbs.forEach((cb) => cb());
    };

    try {
      executor(resolve, reject); // exécuté SYNCHRONEMENT
    } catch (err) {
      reject(err); // throw dans l'executor => rejet
    }
  }

  then(onFulfilled, onRejected) {
    // defaults qui PROPAGENT (identité + re-throw)
    const onF = typeof onFulfilled === 'function' ? onFulfilled : (v) => v;
    const onR = typeof onRejected === 'function'
      ? onRejected
      : (r) => { throw r; };

    // then retourne TOUJOURS une nouvelle Promise
    const promise2 = new MyPromise((resolve, reject) => {
      const runFulfilled = () => {
        queueMicrotask(() => { // asynchrone garanti
          try {
            const x = onF(this.value);
            resolvePromise(promise2, x, resolve, reject);
          } catch (err) {
            reject(err);
          }
        });
      };
      const runRejected = () => {
        queueMicrotask(() => {
          try {
            const x = onR(this.reason);
            resolvePromise(promise2, x, resolve, reject);
          } catch (err) {
            reject(err);
          }
        });
      };

      if (this.state === FULFILLED) {
        runFulfilled();
      } else if (this.state === REJECTED) {
        runRejected();
      } else {
        // pending : on stocke, exécuté au resolve/reject
        this.onFulfilledCbs.push(runFulfilled);
        this.onRejectedCbs.push(runRejected);
      }
    });

    return promise2;
  }

  catch(onRejected) {
    return this.then(null, onRejected); // sucre syntaxique
  }

  static resolve(value) {
    if (value instanceof MyPromise) return value; // raccourci spec
    return new MyPromise((resolve) => resolve(value));
  }

  static reject(reason) {
    return new MyPromise((_, reject) => reject(reason));
  }
}

// Procédure de résolution (Promises/A+ 2.3)
function resolvePromise(promise2, x, resolve, reject) {
  // cycle : promise2 se résoudrait avec elle-même => attente infinie
  if (promise2 === x) {
    return reject(new TypeError('Chaining cycle detected'));
  }

  if (x && (typeof x === 'object' || typeof x === 'function')) {
    let called = false; // n'accepte QUE le premier appel (thenable malveillant)
    try {
      const then = x.then; // lu une seule fois
      if (typeof then === 'function') {
        then.call(
          x,
          (y) => {
            if (called) return;
            called = true;
            resolvePromise(promise2, y, resolve, reject); // récursion
          },
          (r) => {
            if (called) return;
            called = true;
            reject(r);
          }
        );
      } else {
        resolve(x); // objet sans .then => valeur normale
      }
    } catch (err) {
      if (called) return;
      reject(err); // lire/appeler x.then a throw
    }
  } else {
    resolve(x); // primitive => fulfill direct
  }
}

MyPromise.all = function (promises) {
  return new MyPromise((resolve, reject) => {
    const results = [];
    let remaining = promises.length;

    if (remaining === 0) {
      resolve(results); // tableau vide => résolution immédiate
      return;
    }

    promises.forEach((p, index) => {
      MyPromise.resolve(p).then(
        (value) => {
          results[index] = value; // position préservée
          remaining -= 1;
          if (remaining === 0) resolve(results);
        },
        reject // premier rejet => rejette tout (fail-fast)
      );
    });
  });
};

export { MyPromise };
```

**Pourquoi ce corrigé est correct :**
- La garde `if (this.state !== PENDING) return` dans `resolve`/`reject` implémente l'irréversibilité : un double `resolve('A'); resolve('B')` fige `'A'`.
- `queueMicrotask` garantit que les callbacks passent **après** le code synchrone : la sortie commence toujours par `1, 2, 3`.
- `then` construit `promise2` et branche le résultat du callback via `resolvePromise` : c'est ce qui rend le chaînage possible et permet l'adoption d'un thenable.
- `resolvePromise` gère les trois cas (cycle / thenable / valeur) et protège l'appel unique via `called`, conforme Promises/A+ 2.3.
- Un `then` sans `onRejected` utilise le default `(r) => { throw r; }` : le rejet **traverse** le maillon et atterrit au `catch`.

**Ordre de sortie de `run.mjs` et raisonnement de ticks :**
```
1 — sync début
2 — sync milieu
3 — sync fin
4 — then cache        (microtask, 1 tick)
6 — catch boom        (microtask, 1 tick)
7 — all fam membres   (all résout après 1 tick sur des valeurs déjà résolues)
5 — chaîne 20         (chaîne de 3 then + adoption d'un thenable = plusieurs ticks)
```
`5` arrive en dernier parce que sa chaîne accumule plusieurs microtasks : `+1`, puis l'adoption du thenable `new MyPromise(...)` (tick supplémentaire), puis le `console.log`. `4`, `6`, `7` ne coûtent qu'un tick chacun. L'exact interleaving peut légèrement varier, mais `5` est **toujours** après `4/6/7` — c'est le point pédagogique : plus la chaîne est longue (et plus elle adopte des thenables), plus le résultat est différé.

---

## Variante J+30 (fading)

**Même `MyPromise`, reproduite de mémoire en 30 minutes, sans rouvrir ce corrigé ni le module — plus deux contraintes :**

1. Ajoute `MyPromise.allSettled(promises)` : résout **toujours** (jamais de rejet) avec un tableau de `{ status: 'fulfilled', value }` ou `{ status: 'rejected', reason }`, ordre préservé.
2. Ajoute une **méthode d'instance** `withTimeout(ms)` qui retourne une nouvelle `MyPromise` : elle adopte l'état de `this`, mais si `ms` s'écoule avant settlement, elle rejette avec `new Error('timeout')` (indice : `race` interne entre `this` et un `setTimeout` qui rejette).

**Critère de réussite :** `run.mjs` continue d'afficher `1, 2, 3` avant tout callback ; `allSettled` sur `[resolve('ok'), reject('ko')]` donne `[{status:'fulfilled',value:'ok'},{status:'rejected',reason:'ko'}]` ; `MyPromise.resolve('x').withTimeout(50)` résout `'x'`, et une Promise qui met 100 ms rejette bien `timeout`.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, tu ne remplaces évidemment pas la `Promise` native — mais ce lab débloque la couche « appels API ».

**Fichiers concernés :**
```
tribuzen/src/
  api/
    client.ts     // wrapper fetch -> Promises typées, un seul .catch en bout de chaîne
    family.ts     // fetchFamily().then(f => fetchMembers(f.id)) : chaînage réel
  pages/
    DashboardPage.tsx  // Promise.all([fetchFamily(id), fetchMembers(id)])
```

**Ce que tu portes du lab :**
- Le chaînage `fetchFamily → fetchMembers → render` avec **un seul** `.catch` en fin de chaîne (la propagation de rejet du lab garantit qu'il capte tout).
- Le passage des `await` séquentiels du dashboard à un `Promise.all` parallèle (familles + membres) — même logique que `MyPromise.all` implémenté ici.
- Le réflexe timing : un `setState` dans un `.then` est différé en microtask — ne jamais supposer qu'il s'exécute avant le rendu synchrone courant.

**Commit cible :**
```
refactor(api): chaînage fetchFamily -> fetchMembers avec catch unique
perf(dashboard): Promise.all familles + membres en parallèle
```
