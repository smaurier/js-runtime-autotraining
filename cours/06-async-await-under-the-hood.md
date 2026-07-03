# Module 06 — Async/Await sous le capot

> **Objectif** : Comprendre comment V8 implémente réellement `async`/`await` au niveau du bytecode, maîtriser les mécanismes de suspension et de reprise, exploiter les async iterators et generators, appliquer les patterns de cancellation avec `AbortController`, et diagnostiquer les pièges subtils (`return await`, rejets non gérés, optimisations de ticks).

> **Difficulté** : ⭐⭐⭐ (Avancé)

> **Pas de panique !** Ce module explore les mécanismes internes d'`async`/`await`, mais tu utilises probablement déjà ces mots-clés tous les jours. L'objectif ici n'est pas de tout mémoriser, mais de comprendre *pourquoi* `await` se comporte comme il le fait. Les sections sur les structures internes V8 sont là pour les curieux — si elles te semblent abstraites, saute aux démonstrations et reviens plus tard.

---

## Prérequis

- Module 04 — Microtâches vs Macrotâches (ordre d'exécution, vidage des files)
- Module 05 — Promises : Implémentation Interne (PromiseReaction, thenable unwrapping, PromiseResolveThenableJob)
- Connaissance de base des générateurs (`function*`, `yield`)
- Familiarité avec l'Event Loop et ses phases (Modules 01-03)

---

## Théorie

> 🎯 **Analogie** : async/await, c'est comme mettre un marque-page dans un livre. Quand tu arrives à un passage qui demandé d'attendre (await), tu poses ton marque-page (suspension), tu fais autre chose, et quand le résultat arrive, tu reprends ta lecture exactement ou tu l'avais laissée.

### 1. Une fonction `async` retourne toujours une Promise

Toute fonction déclarée `async` encapsule sa valeur de retour dans une Promise. Si elle lance une exception, la Promise est rejetée. Si la valeur retournée est déjà une Promise, `async` crée une **nouvelle** Promise (contrairement à `Promise.resolve(p)` qui retourne `p` directement).

```js
async function getValueAsync() { return 42; }
function getValuePromise() { return Promise.resolve(42); }

console.log(getValueAsync() instanceof Promise);  // true
console.log(getValuePromise() instanceof Promise); // true

const original = Promise.resolve(1);
const result = (async () => original)();
console.log(result === original); // false — nouvelle Promise
```

### 2. `await` : le sucre syntaxique déconstruit

`await` n'est **pas** un alias pour `.then()`. C'est un point de suspension de l'exécution. Voici le desugaring conceptuel :

```
┌───────────────────────────────────────────────────┐
│  async function example() {                       │
│    console.log('A');                              │
│    const val = await fetchData();                 │
│    console.log('B', val);                         │
│    return val + 1;                                │
│  }                                                │
└───────────────────────────────────────────────────┘
                     ▼ V8 transforme en :
┌───────────────────────────────────────────────────┐
│  function example() {                             │
│    return new Promise((resolve, reject) => {      │
│      console.log('A');    // SYNCHRONE            │
│      fetchData().then(                            │
│        (val) => {         // reprise async        │
│          console.log('B', val);                   │
│          resolve(val + 1);                        │
│        },                                         │
│        (err) => reject(err)                       │
│      );                                           │
│    });                                            │
│  }                                                │
└───────────────────────────────────────────────────┘
```

**Règle fondamentale** : tout le code **avant** le premier `await` est synchrone. La suspension commence au moment du `await`.

> **Pourquoi cette section ?** Comprendre la mécanique interne n'est pas nécessaire pour écrire du bon code async. Mais ça t'aide à comprendre *pourquoi* `await` coûte un tick, pourquoi les variables locales survivent au `await`, et pourquoi les stack traces fonctionnent. Si c'est trop abstrait pour l'instant, **saute à la section 5** — elle est beaucoup plus pratique.

### 3. Comment V8 suspend et reprend une fonction async au niveau bytecode

C'est le coeur du sujet « sous le capot ». Quand V8 rencontre une fonction `async`, il crée un objet interne `JSAsyncFunctionObject` :

```
┌────────────────────────────────────────────────────────┐
│  JSAsyncFunctionObject                                 │
├────────────────────────────────────────────────────────┤
│  promise              : JSPromise (retournée à l'app.) │
│  register_file        : FixedArray (registres sauvés)  │
│  bytecode_offset      : int (où reprendre)             │
│  context              : Context (scope chain)          │
│  parameters_and_registers : FixedArray (variables loc.)│
└────────────────────────────────────────────────────────┘
```

Le cycle suspension / reprise au moment d'un `await` :

```
  Phase 1 — SUSPENSION (au moment du await)
  ==========================================
  1. V8 exécute le bytecode normalement jusqu'au await
  2. Sauvegarde de l'état dans JSAsyncFunctionObject :
     - register_file : toutes les variables locales
     - bytecode_offset : instruction APRÈS le await
     - context : chaîne de scopes active
  3. Appel du builtin %AsyncFunctionAwait :
     - Si l'opérande est une Promise NATIVE :
       → PerformPromiseThen directement (1 tick)
     - Sinon (thenable non natif) :
       → PromiseResolveThenableJob (2-3 ticks)
  4. La fonction est retirée de la call stack

  Phase 2 — REPRISE (quand la Promise se résout)
  ================================================
  1. La PromiseReaction interne est déclenchée (microtâche)
  2. Restauration depuis JSAsyncFunctionObject :
     - register_file → variables locales disponibles
     - bytecode_offset → reprend après le await
     - context → scopes restaurés
  3. L'accumulator reçoit la valeur résolue
  4. L'exécution du bytecode reprend normalement
```

Avant V8 7.2, `async`/`await` passait par des générateurs internes (`async function` → `function*`), ce qui coûtait un objet `GeneratorObject` + wrapper, 3 microticks par `await` et des stack traces incomplètes. L'implémentation native élimine ces surcoûts.

### 4. L'optimisation `await` de V8 7.2+ : de 3 ticks à 1 tick

> **En résumé** : les versions récentes de V8 (depuis 2019) rendent `await` beaucoup plus rapide. Avant, chaque `await` coûtait 3 micro-pauses. Maintenant, c'est 1 seule. Tu n'as rien à faire pour en profiter — c'est automatique.

Avant V8 7.2, chaque `await` créait un `PromiseResolveThenableJob` même pour une Promise native. L'optimisation détecte ce cas et court-circuite le mécanisme :

```
  AVANT V8 7.2 :                  APRÈS V8 7.2 :
  await nativePromise              await nativePromise
      │                                │
      ├── tick 1: créer Promise        ├── tick 1: PromiseReaction
      │   wrapping                     │   directement attachée
      ├── tick 2: PromiseResolve-      │   sur nativePromise
      │   ThenableJob                  │
      └── tick 3: résultat             └── résultat, reprise

  Total : 3 ticks                  Total : 1 tick
```

**Condition** : l'optimisation ne s'applique qu'aux Promises natives V8. Un thenable custom (`{ then: cb => cb(42) }`) ou une Promise Bluebird retombe sur le chemin complet.

### 5. `return await` vs `return` dans `try/catch`

C'est l'un des gotchas les plus célèbres. Dans un bloc `try/catch`, `return` et `return await` se comportent différemment :

```js
// BUG : le catch ne capture PAS le rejet
async function withoutAwait() {
  try {
    return riskyOperation(); // retourne la Promise directement
  } catch (err) {
    return fallback(); // JAMAIS ATTEINT si riskyOperation rejette
  }
}

// CORRECT : le catch capture le rejet
async function withAwait() {
  try {
    return await riskyOperation(); // attend la résolution
  } catch (err) {
    return fallback(); // atteint si riskyOperation rejette
  }
}
```

```
  return riskyOperation() :              return await riskyOperation() :
  1. riskyOperation() → Promise          1. riskyOperation() → Promise
  2. return propage la Promise            2. await SUSPEND la fonction
  3. try/catch est terminé               3. Si rejet → erreur LEVÉE
  4. Si rejet plus tard → non capturé       dans le try → catch la capture
```

**Règle** : dans un `try/catch`, utilisez toujours `return await`. En dehors, `return await` est redondant (ESLint `no-return-await`).

### 6. Rejets non gérés : `async` vs callbacks classiques

```
  ┌──────────────────────────────────┬────────────────────┐
  │  Contexte de l'erreur            │ Événement émis     │
  ├──────────────────────────────────┼────────────────────┤
  │  throw dans async function       │ unhandledRejection │
  │  await d'une Promise rejetée     │ unhandledRejection │
  │  TypeError avant le 1er await    │ unhandledRejection │
  │  throw dans .then() callback     │ unhandledRejection │
  │  throw dans setTimeout callback  │ uncaughtException  │
  │  throw dans EventEmitter handler │ uncaughtException  │
  └──────────────────────────────────┴────────────────────┘
```

V8 enveloppe le corps entier d'une `async function` dans un `try` implicite. Toute erreur synchrone ou asynchrone est convertie en rejet de Promise. Mais un `throw` dans un callback planifié par `setTimeout` échappe à cette enveloppe car il s'exécute dans un tour d'event loop différent.

```js
async function dangerous() {
  setTimeout(() => {
    throw new Error('Hors du contrôle de async');
    // → uncaughtException (PAS unhandledRejection)
  }, 0);
}
dangerous(); // la Promise se résout normalement (undefined)
```

### 7. `for await...of` et les itérateurs asynchrones

Un async iterable implémente `[Symbol.asyncIterator]()` retournant un objet avec `next()` qui renvoie une Promise de `{ value, done }`.

```js
const asyncIterable = {
  [Symbol.asyncIterator]() {
    let i = 0;
    return {
      next() {
        if (i >= 3) return Promise.resolve({ done: true });
        return new Promise(resolve =>
          setTimeout(() => resolve({ value: i++, done: false }), 100)
        );
      }
    };
  }
};

async function consume() {
  for await (const value of asyncIterable) {
    console.log(value); // 0, 1, 2 (chaque 100ms)
  }
}
```

Comment l'event loop traite chaque itération :

```
  for await (const value of iterable) { body }
  ═══════════════════════════════════════════

  Desugaring :
  const iter = iterable[Symbol.asyncIterator]();
  while (true) {
    const { value, done } = await iter.next(); // SUSPEND
    if (done) break;
    body;  // exécute le corps, puis boucle → nouveau await
  }

  Entre chaque await, le thread est libre pour d'autres tâches.
```

Usage courant : lecture de streams Node.js (`fs.createReadStream`, `http.IncomingMessage`).

### Rappel rapide : les générateurs

Si tu n'as jamais utilisé les générateurs, voici l'essentiel en 30 secondes :

```js
function* compteur() {
  yield 1;     // pause ici, retourne 1
  yield 2;     // pause ici, retourne 2
  return 3;    // termine, retourne 3
}

const gen = compteur();
console.log(gen.next()); // { value: 1, done: false }
console.log(gen.next()); // { value: 2, done: false }
console.log(gen.next()); // { value: 3, done: true }
```

Un générateur est une fonction qui peut **se mettre en pause** (`yield`) et **reprendre** là où elle s'était arrêtée (`gen.next()`). C'est exactement le même mécanisme qu'`async/await` : `await` est un `yield` déguisé, et le moteur reprend la fonction quand la Promise est résolue.

> **Rappel** : tu n'as pas besoin de maîtriser les générateurs pour comprendre async/await. Retiens juste l'idée de pause/reprise.

### 8. Async generators : combiner `yield` et `await`

Un async generator produit des valeurs de manière asynchrone. Il a **deux** raisons de se suspendre :

```
  async function* gen() {
    const data = await fetchSomething();  // suspension AWAIT
    yield data.processed;                 // suspension YIELD
  }

  ┌─────────────────────┬─────────────────────────────┐
  │  await (interne)     │ Attend une donnée async.    │
  │                      │ Reprise automatique quand   │
  │                      │ la Promise se résout.       │
  ├─────────────────────┼─────────────────────────────┤
  │  yield (externe)     │ Produit une valeur.         │
  │                      │ Reprise quand le            │
  │                      │ consommateur appelle next() │
  └─────────────────────┴─────────────────────────────┘
```

V8 utilise un `JSAsyncGeneratorObject` (héritant de `JSAsyncFunctionObject`) avec une file de requêtes `.next()` en attente.

```js
async function* fetchPages(baseUrl, maxPages) {
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${baseUrl}?page=${page}`);
    const data = await res.json();
    if (data.items.length === 0) return;
    yield data.items; // suspendu jusqu'au prochain .next()
  }
}

// Consommation
async function getAllItems() {
  const all = [];
  for await (const items of fetchPages('/api/data', 10)) {
    all.push(...items);
  }
  return all;
}
```

### 9. Cancellation avec `AbortController` et `AbortSignal`

`AbortController` est le mécanisme standard pour annuler des opérations asynchrones.

```js
// Pattern de base : timeout
async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout ${ms}ms`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Raccourci moderne (Node.js 18+)
await fetch(url, { signal: AbortSignal.timeout(5000) });
```

Rendre une fonction async annulable :

```js
async function processItems(items, signal) {
  const results = [];
  for (const item of items) {
    signal?.throwIfAborted(); // lève DOMException si aborted
    results.push(await processOne(item));
  }
  return results;
}

// Annuler via un seul abort()
const controller = new AbortController();
setTimeout(() => controller.abort(), 1000);
try {
  await processItems(largeList, controller.signal);
} catch (err) {
  if (err.name === 'AbortError') console.log('Annulé proprement');
}
```

### 10. Stack traces asynchrones zero-cost (V8 7.3+)

La pile est vide entre chaque `await` (la fonction a été dépilée). V8 résout ce problème en stockant la stack trace dans le `JSAsyncFunctionObject` à chaque suspension. La reconstruction ne se fait que si une erreur est effectivement levée (coût zéro en production).

```js
async function inner()  { throw new Error('Boom'); }
async function middle() { await inner(); }
async function outer()  { await middle(); }

outer().catch(console.error);
// Error: Boom
//     at inner (file.js:1:37)
//     at async middle (file.js:2:27)  ← "async" = reconstruction
//     at async outer (file.js:3:27)
```

### 11. `await` dans une boucle : séquentiel vs parallèle

```js
// SÉQUENTIEL — Temps ≈ somme des temps
async function fetchSeq(urls) {
  const results = [];
  for (const url of urls) {
    results.push(await fetch(url).then(r => r.json()));
  }
  return results;
}

// PARALLÈLE — Temps ≈ max des temps
async function fetchPar(urls) {
  return Promise.all(urls.map(u => fetch(u).then(r => r.json())));
}
```

```
Séquentiel (3 x 200ms) :   Parallèle (3 x 200ms) :
├── req1 ──────┤            ├── req1 ──────┤
               ├── req2 ──────┤   ├── req2 ──────┤
                              ├── req3 ──────┤   ├── req3 ──────┤
Total: ~600ms                Total: ~200ms
```

### 12. Top-Level Await (ESM uniquement)

Depuis ES2022, `await` est utilisable au niveau module (`.mjs` ou `"type": "module"`). Le module courant est bloqué jusqu'à résolution, mais les modules frères ne sont pas affectés.

```js
// config.mjs
export const config = await fetch('/api/config').then(r => r.json());

// app.mjs — attend que config.mjs soit prêt
import { config } from './config.mjs';
```

### 13. Gestion d'erreurs : trois approches

```js
// 1. try/catch (recommandé)
async function approach1() {
  try {
    const data = await riskyOp();
    return await anotherOp(data);
  } catch (err) { console.error(err); }
}

// 2. .catch() granulaire
async function approach2() {
  const data = await riskyOp().catch(() => defaultValue);
  return await anotherOp(data);
}

// 3. Pattern Go-style
async function to(p) {
  try { return [null, await p]; }
  catch (e) { return [e, null]; }
}
const [err, data] = await to(riskyOp());
```

---

## Démonstration

### Demo 1 : La partie synchrone d'une fonction async

```js
// demo-01-sync-part.mjs
console.log('1 - Avant appel');
async function asyncFunc() {
  console.log('2 - Début (SYNCHRONE)');
  const x = await Promise.resolve('résolu');
  console.log('4 - Après await :', x);
  return x;
}
const p = asyncFunc();
console.log('3 - Après appel (asyncFunc suspendue)');
p.then(v => console.log('5 - Résolue :', v));

// Sortie : 1, 2, 3, 4, 5
```

### Demo 2 : `return await` vs `return` dans try/catch

```js
// demo-02-return-await.mjs
async function failing() {
  return Promise.reject(new Error('Échec réseau'));
}

async function withoutAwait() {
  try { return failing(); }
  catch (err) { console.log('[sans await] Capturé :', err.message); return 'fb1'; }
}

async function withAwait() {
  try { return await failing(); }
  catch (err) { console.log('[avec await] Capturé :', err.message); return 'fb2'; }
}

(async () => {
  try { await withoutAwait(); }
  catch (e) { console.log('Non capturé en interne :', e.message); }

  const r = await withAwait();
  console.log('Résultat :', r);
})();

// Sortie :
// Non capturé en interne : Échec réseau
// [avec await] Capturé : Échec réseau
// Résultat : fb2
```

### Demo 3 : Async generator avec for await...of

```js
// demo-03-async-generator.mjs
async function* countdown(n, delayMs) {
  for (let i = n; i > 0; i--) {
    await new Promise(r => setTimeout(r, delayMs));
    yield i;
  }
}

(async () => {
  const parts = [];
  for await (const n of countdown(5, 150)) {
    parts.push(n);
  }
  console.log('Countdown :', parts); // [5, 4, 3, 2, 1]

  // Preuve que le thread est libre entre les yields
  let ticks = 0;
  const interval = setInterval(() => ticks++, 50);
  for await (const n of countdown(3, 200)) { /* consume */ }
  clearInterval(interval);
  console.log('Ticks pendant le for-await :', ticks); // ~12
})();
```

### Demo 4 : AbortController pour annuler des opérations

```js
// demo-04-abort-controller.mjs
function delay(ms, value, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(value), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Annulé', 'AbortError'));
    }, { once: true });
  });
}

async function longTask(signal) {
  const results = [];
  for (let i = 1; i <= 10; i++) {
    signal?.throwIfAborted();
    console.log(`  Étape ${i}/10...`);
    results.push(await delay(200, `r-${i}`, signal));
  }
  return results;
}

(async () => {
  console.log('--- Avec annulation après 500ms ---');
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 500);
  try { await longTask(ctrl.signal); }
  catch (e) { console.log('  Résultat :', e.message); }
})();

// Sortie : Étape 1..2..3.. puis "Annulé"
```

### Demo 5 : Optimisation V8 — comptage de ticks

```js
// demo-05-tick-counting.mjs
async function awaitNativePromise() {
  return await Promise.resolve(42);
}

async function awaitThenable() {
  return await { then: cb => cb(42) };
}

async function awaitNestedPromise() {
  return await new Promise(r => r(Promise.resolve(42)));
}

(async () => {
  console.log('--- Comptage de ticks par type ---\n');

  // Chaîne de référence
  const ticks = [];
  const ref = Promise.resolve()
    .then(() => ticks.push('t1'))
    .then(() => ticks.push('t2'))
    .then(() => ticks.push('t3'))
    .then(() => ticks.push('t4'));

  awaitNativePromise().then(() => ticks.push('native'));
  awaitThenable().then(() => ticks.push('thenable'));
  awaitNestedPromise().then(() => ticks.push('nested'));

  await ref;
  await new Promise(r => setTimeout(r, 50)); // laisser tout se résoudre

  console.log('Ordre observé :', ticks.join(', '));
  // Typique V8 moderne : t1, native, t2, t3, thenable, nested, t4
  // → native résolu après 1 tick, thenable/nested après 2-3 ticks
})();
```

---

### V8 vs SpiderMonkey (Firefox)

> 📋 **Rappel** : `async`/`await` est défini par la spécification ECMA-262 (section 27.7). Le comportement observable est identique dans tous les moteurs conformes. Les différences ci-dessous concernent l'implémentation interne.

**`async`/`await` est entièrement spécifié** — le mécanisme de suspension, de reprise et de résolution est identique dans V8, SpiderMonkey et JavaScriptCore. Le même code `async`/`await` produit le même résultat dans Chrome, Firefox et Safari.

**Représentation interne de la suspension** :

| Aspect | V8 (Chrome/Node.js) | SpiderMonkey (Firefox) |
|--------|---------------------|------------------------|
| Objet interne | `JSAsyncFunctionObject` | Représentation interne basée sur les générateurs (similaire conceptuellement) |
| Sauvegarde d'état | `register_file`, `bytecode_offset`, `context` | Frame sauvegardée avec les variables locales et le point de reprise |
| Optimisation native | Depuis V8 7.2 : implémentation native (plus de wrapper générateur) | SpiderMonkey utilise sa propre implémentation native optimisée |

**Stack traces asynchrones** :

- **V8** (depuis V8 7.3, Chrome 73+) : « zero-cost async stack traces ». La stack trace est reconstruite uniquement quand une erreur est levée, en remontant la chaîne de `JSAsyncFunctionObject`. Aucun coût en production tant qu'il n'y a pas d'erreur.
- **SpiderMonkey** (Firefox) : implémente également des async stack traces, mais avec une approche différente. Firefox affiche les frames `async` dans les DevTools avec un indicateur visuel distinct. L'implémentation interne diffère mais le résultat pour le développeur est similaire.
- Les deux moteurs affichent les mots `async` dans la stack trace pour distinguer les frames reconstruites des frames réelles.

**Top-Level Await** :

Le top-level `await` (ES2022) fonctionne de manière identique dans tous les moteurs qui supportent les ESM (ECMAScript Modules). Le module contenant le `await` est bloqué jusqu'à résolution, mais les modules frères dans le graphe de dépendances ne sont pas affectés. Ce comportement est identique dans Chrome, Firefox, Safari, Node.js et Deno.

**Optimisation du nombre de ticks** :

- **V8 7.2+** : `await` sur une Promise native ne coûte qu'un tick (raccourci `PerformPromiseThen`).
- **SpiderMonkey** : peut avoir un nombre de ticks différent pour certains cas edge, mais le résultat final est toujours conforme à la spec. En pratique, les cas où le nombre de ticks diffère entre moteurs sont extrêmement rares et ne concernent que des micro-benchmarks, pas du code applicatif.

**Conclusion** : écris ton code `async`/`await` sans te soucier du moteur. La syntaxe, la sémantique et le comportement d'erreur sont standardisés. Les seules différences portent sur les performances internes (nombre exact de ticks dans les cas limites) et la présentation des stack traces dans les DevTools.

---

## Points clés

1. **Une fonction `async` s'exécute de manière synchrone jusqu'au premier `await`** — tout le code avant le premier `await` est sur la call stack comme du code normal.

2. **V8 sauvegarde l'état complet dans un `JSAsyncFunctionObject`** (registres, offset bytecode, variables locales, scope chain) au moment du `await`, puis libère la call stack.

3. **Depuis V8 7.2, `await` sur une Promise native ne coûte qu'un tick** — V8 attache directement une `PromiseReaction` interne, sans `PromiseResolveThenableJob`. Pour les thenables non natifs, le coût reste de 2-3 ticks.

4. **`return await` est obligatoire dans un `try/catch`** — sans `await`, le `catch` ne peut pas intercepter le rejet car la pile est déjà dépilée.

5. **Les erreurs dans une `async function` produisent `unhandledRejection`**, jamais `uncaughtException` — sauf dans un callback planifié par `setTimeout` ou un `EventEmitter`.

6. **`for await...of` suspend la fonction à chaque itération** — le thread est libre entre les éléments, idéal pour les streams et données paginées.

7. **Un async generator combine `await` (attente interne) et `yield` (production externe)** — V8 maintient une file de requêtes `.next()` via `JSAsyncGeneratorObject`.

8. **`AbortController`/`AbortSignal` est le pattern standard de cancellation** — un seul `abort()` annule toutes les opérations partageant le même signal.

9. **Les async stack traces V8 sont « zero-cost »** — reconstituées uniquement en cas d'erreur en remontant la chaîne de `JSAsyncFunctionObject`.

10. **Le Top-Level Await bloque le module courant** mais pas ses modules frères dans le graphe de dépendances.

---

---

## Si tu es perdu

Si ce module t'a semblé dense, retiens l'analogie du **marque-page** et ces 5 points essentiels :

1. **`async` transforme ta fonction en « fonction à marque-page »** — elle retourne toujours une Promise, et elle peut se mettre en pause. Quand tu appelles une fonction `async`, tout le code avant le premier `await` s'exécute immédiatement (de façon synchrone).
2. **`await` = poser le marque-page** — la fonction est suspendue, le moteur sauvegarde toutes les variables locales (comme si tu notais le numéro de page), et le thread est libre pour faire autre chose. Quand la Promise se résout, le moteur reprend exactement là où il s'était arrêté.
3. **`return await` est obligatoire dans un `try/catch`** — sans le `await`, le `catch` ne peut pas intercepter une erreur asynchrone. C'est le piège le plus fréquent.
4. **`await` dans une boucle = séquentiel** — si tu veux du parallèle, utilise `Promise.all()`. C'est la différence entre lire 10 livres un par un et les distribuer à 10 personnes.
5. **Tu n'as pas besoin de connaître `JSAsyncFunctionObject`** — les structures internes V8 sont là pour expliquer le *pourquoi*. Ce qui compte au quotidien, c'est de savoir que `await` suspend, reprend, et coûte au minimum 1 micro-pause (tick).

Reviens relire les sections techniques après avoir fait le lab — manipuler le code rend les concepts beaucoup plus concrets.

---

## Pour aller plus loin

- [V8 Blog — Faster async functions and promises](https://v8.dev/blog/fast-async) — l'article de référence de Maya Lekova et Benedikt Meurer
- [V8 Blog — V8 release v7.2](https://v8.dev/blog/v8-release-72) — async stack traces et optimisation de `await`
- [ECMA-262 — Async Function Definitions](https://tc39.es/ecma262/#sec-async-function-definitions)
- [ECMA-262 — AsyncGeneratorFunction Objects](https://tc39.es/ecma262/#sec-asyncgeneratorfunction-objects)
- [ECMA-262 — for-in/for-of (await variant)](https://tc39.es/ecma262/#sec-for-in-and-for-of-statements)
- [MDN — AbortController](https://developer.mozilla.org/fr/docs/Web/API/AbortController)
- [MDN — for await...of](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of)
- [V8 Source — js-generator.h (JSAsyncFunctionObject)](https://source.chromium.org/chromium/chromium/src/+/main:v8/src/objects/js-generator.h)
- [Jake Archibald — "In The Loop" (JSConf.Asia)](https://www.youtube.com/watch?v=cCOL7MC4Pl0)

---

## Défi

### Défi 06 — Le timing fantôme

Prédisez l'ordre exact de sortie (Node.js v18+, V8 optimisé) :

```js
async function alpha() {
  console.log('A');
  const val = await beta();
  console.log('B', val);
}

async function beta() {
  console.log('C');
  return await gamma();
}

async function gamma() {
  console.log('D');
  return 42;
}

console.log('E');
alpha();

const p = new Promise(resolve => {
  console.log('F');
  resolve(Promise.resolve('G'));
});

p.then(v => console.log(v));

Promise.resolve()
  .then(() => console.log('H'))
  .then(() => console.log('I'))
  .then(() => console.log('J'))
  .then(() => console.log('K'));

console.log('L');
```

**Questions** :
1. Quel est l'ordre exact des 12 lignes de sortie ?
2. Pourquoi `G` n'apparaît-il pas au même tick que `H`, malgré le `resolve()` synchrone dans le constructeur ?
3. Combien de ticks séparent `D` et `B` ? Pourquoi ?
4. Si on remplace `return await gamma()` par `return gamma()` dans `beta`, est-ce que l'ordre change ?

<details>
<summary>Réponse</summary>

**Sortie : `E, A, C, D, F, L, H, B 42, I, G, J, K`**

**Raisonnement pas à pas :**

**Code synchrone** (call stack) :
- `E` : premier console.log
- `A` : dans `alpha()`, avant le `await beta()`
- `C` : dans `beta()`, appelé par `alpha` avant suspension
- `D` : dans `gamma()`, appelé par `beta` avant suspension
- `F` : constructeur `new Promise(fn)` est synchrone
- `L` : dernier console.log synchrone

**État des files après le code synchrone :**
- `gamma()` a retourné une Promise fulfilled(42). `beta` fait `await` dessus : crée une PromiseReaction pour reprendre `beta`.
- `resolve(Promise.resolve('G'))` passe un thenable : crée un **PromiseResolveThenableJob**. La Promise `p` reste pending.
- `Promise.resolve().then(->H)` : premier handler prêt.

File de microtâches : `[reprise-gamma->beta, PromiseResolveThenableJob(p), H]`

**Déroulement :**

1. **reprise-gamma->beta** : `beta` reçoit 42 via `await`. `return await` a déjà unwrappé la valeur, donc `beta` se résout avec 42 (valeur primitive, pas de thenable unwrapping). Ajoute `reprise-beta->alpha` en file.

2. **PromiseResolveThenableJob** : exécute `Promise.resolve('G').then(resolveP)`. Ajoute `resolveP('G')` en file.

3. **H** : affiche `H`. Ajoute `I` en file.

4. **reprise-beta->alpha** : `alpha` reçoit val=42. Affiche **`B 42`**.

5. **resolveP('G')** : `p` est fulfilled('G'). Ajoute `afficher-G` en file.

6. **I** : affiche `I`. Ajoute `J`.

7. **G** : affiche `G`.

8. **J** : affiche `J`. Ajoute `K`.

9. **K** : affiche `K`.

**Réponses aux questions :**

1. `E, A, C, D, F, L, H, B 42, I, G, J, K`

2. `resolve(Promise.resolve('G'))` passe un thenable au resolve. Cela crée un `PromiseResolveThenableJob` (1 tick) qui appelle `.then(resolveP)` sur le thenable interne (1 tick supplémentaire). Deux ticks de retard total, c'est pourquoi `G` apparaît après `I`.

3. **2 ticks** séparent `D` et `B 42`. Tick 1 : reprise de `beta` après `await gamma()` — `beta` obtient 42 et se résout. Tick 2 : reprise d'`alpha` après `await beta()`. Le `return await` dans `beta` ajoute exactement un niveau de suspension-reprise.

4. **Oui, l'ordre change.** Sans `await`, `beta` retourne directement la Promise de `gamma`. La Promise de `beta` est alors résolue avec un thenable (la Promise de gamma), ce qui déclenche un `PromiseResolveThenableJob` supplémentaire. Le nombre de ticks entre `D` et `B` augmente. Paradoxalement, `return await` est **plus rapide** ici car il unwrappe la valeur (42, primitif) avant de la retourner, évitant le coût du thenable unwrapping.

</details>

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 06 async await](../screencasts/screencast-06-async-await.md)
2. **Lab** : [lab-06-async-patterns-comparison](../labs/lab-06-async-patterns-comparison/README)
3. **Quiz** : [quiz 06 async await](../quizzes/quiz-06-async-await.html)
:::
