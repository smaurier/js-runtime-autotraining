---
titre: Async/await sous le capot
cours: 01-js-runtime
notions: [async retourne toujours une Promise, await comme sucre syntaxique sur then, suspension de coroutine et state machine, lien avec les générateurs, await cède le contrôle à l'event loop en microtask, séquentiel vs Promise.all parallèle, await dans une boucle, try/catch async et rejets non attrapés]
outcomes: [expliquer la state machine générée derrière une fonction async, situer le point de suspension et de reprise d'un await, refactorer un await séquentiel en Promise.all parallèle et mesurer le gain, sécuriser les erreurs async avec try/catch et return await]
prerequis: [05-promises-implementation]
next: 07-garbage-collector
libs: []
tribuzen: chargement du dashboard famille TribuZen — refactor séquentiel vers Promise.all et mesure du gain
last-reviewed: 2026-07
---

# Async/await sous le capot

> **Outcomes — tu sauras FAIRE :** expliquer la state machine générée derrière une fonction async, situer le point de cession d'un `await` à l'event loop, refactorer un `await` séquentiel en `Promise.all` parallèle en mesurant le gain, sécuriser les erreurs async avec `try/catch` + `return await`.
> **Difficulté :** :star::star::star:

## 1. Cas concret d'abord

Tu ouvres le dashboard d'une famille dans l'admin TribuZen. Le backend charge trois choses : la famille, ses membres, puis les derniers posts. Un collègue a écrit ça :

```js
// api/loadFamilyDashboard.js — AVANT
async function loadFamilyDashboard(familyId) {
  const family  = await fetchFamily(familyId);       // ~120 ms
  const members = await fetchMembers(familyId);      // ~150 ms
  const posts   = await fetchLatestPosts(familyId);  // ~180 ms
  return { family, members, posts };
}
```

En prod, ce handler met **~450 ms** à répondre. Le dashboard rame. Pourtant les trois requêtes sont indépendantes : `fetchMembers` n'a pas besoin du résultat de `fetchFamily`.

**Ce qui se passe réellement :** chaque `await` **suspend** la fonction et rend la main à l'event loop *avant* de lancer la ligne suivante. Les trois `fetch` s'exécutent donc en file indienne — 120 + 150 + 180 ≈ 450 ms — alors qu'ils pourraient tourner en parallèle et finir en ~180 ms (le plus lent des trois).

Pour corriger ça sans casser la gestion d'erreurs, il faut comprendre ce qu'`async`/`await` fait *sous le capot* : ce que retourne une fonction `async`, ce qu'`await` suspend exactement, et à quel moment le contrôle repart vers l'event loop. C'est l'objet de ce module.

---

## 2. Théorie complète, concise

### 2.1 Une fonction `async` retourne toujours une Promise

Déclarer `async` sur une fonction change son type de retour : **elle renvoie systématiquement une Promise**, quel que soit ce que tu écris dans `return`.

```js
async function f() { return 42; }
f() instanceof Promise; // true — 42 a été enveloppé dans une Promise

async function g() { throw new Error('boom'); }
g() instanceof Promise; // true — la Promise est rejetée, pas d'exception synchrone
```

Trois conséquences directes :
1. `return valeur` ⇒ Promise **résolue** avec `valeur`.
2. `throw err` ⇒ Promise **rejetée** avec `err` (jamais d'exception synchrone qui remonte la call stack).
3. `return unePromise` ⇒ la Promise externe **adopte** l'état de la Promise interne (elle attend qu'elle se règle). C'est du thenable unwrapping — vu au module 05, ça coûte un tick de plus.

```js
// Preuve que c'est une NOUVELLE Promise, pas celle qu'on retourne :
const interne = Promise.resolve(1);
const externe = (async () => interne)();
externe === interne; // false
```

> À retenir : une fonction `async`, vue de l'extérieur, **c'est une fabrique de Promise**. Le mot-clé `await`, lui, n'existe qu'à *l'intérieur*.

### 2.2 `await` n'est pas `.then()` — c'est un point de suspension

On lit souvent « `await x` équivaut à `x.then(...)` ». C'est faux au sens strict. `.then()` **enregistre un callback et continue** l'exécution ligne suivante. `await` fait l'inverse : il **suspend la fonction entière** et ne reprend qu'à la résolution.

Desugaring conceptuel :

```js
// Code source
async function example() {
  console.log('A');                 // synchrone
  const val = await fetchData();     // ← point de suspension
  console.log('B', val);            // reprise (dans une microtask)
  return val + 1;
}

// Ce que le moteur produit (approximation)
function example() {
  return new Promise((resolve, reject) => {
    console.log('A');               // exécuté SYNCHRONEMENT à l'appel
    fetchData().then(
      (val) => {                    // reprise = callback de résolution
        console.log('B', val);
        resolve(val + 1);
      },
      (err) => reject(err)          // un await sur un rejet ⇒ throw au point d'await
    );
  });
}
```

**Règle fondamentale :** tout le code **avant le premier `await`** s'exécute de façon synchrone, sur la call stack, au moment de l'appel. À partir du premier `await`, la fonction est démontée de la stack et le reste devient asynchrone.

### 2.3 La state machine : comment le moteur suspend et reprend

Une fonction avec plusieurs `await` ne peut pas être un simple `.then()` linéaire : il faut pouvoir s'arrêter à *n'importe quel* `await`, sauvegarder l'état, puis reprendre pile au bon endroit. Le moteur transforme donc la fonction en **machine à états** (state machine).

Imagine cette fonction :

```js
async function example() {
  const a = await stepA();  // état 0 → 1
  const b = await stepB(a); // état 1 → 2
  return a + b;             // état 2 → fin
}
```

Le moteur la réécrit (conceptuellement) en un automate piloté par un numéro d'état, où chaque `await` est une **transition** :

```js
function example() {
  let state = 0;
  let a, b;
  const promise = /* Promise retournée à l'appelant */;

  function resume(input) {           // rappelée à chaque reprise
    switch (state) {
      case 0:
        state = 1;
        return stepA().then(resume); // suspend : rend la main à l'event loop
      case 1:
        a = input;                   // input = valeur résolue de stepA
        state = 2;
        return stepB(a).then(resume);
      case 2:
        b = input;                   // input = valeur résolue de stepB
        resolvePromise(a + b);       // fin : on résout la Promise retournée
    }
  }
  resume();                          // démarre l'état 0 (synchrone)
  return promise;
}
```

Ce que le moteur sauvegarde à chaque suspension :
- **le numéro d'état** (`bytecode_offset` dans V8) — où reprendre ;
- **les variables locales** (`a`, `b`, registres) — pour qu'elles survivent au `await` ;
- **la scope chain** — pour retrouver les variables des closures parentes.

C'est pour ça que tes variables locales sont intactes après un `await` : elles ne vivent pas sur la call stack (qui a été dépilée), mais dans l'objet d'état de la coroutine (V8 : `JSAsyncFunctionObject`).

### 2.4 Lien avec les générateurs : `async/await ≈ générateur + runner`

Cette state machine, JavaScript savait déjà la faire **avant** `async/await` : ce sont les **générateurs**. Un générateur `function*` peut se suspendre à chaque `yield` et reprendre à `gen.next()`, en conservant ses variables locales — exactement le mécanisme décrit ci-dessus.

```js
function* compteur() {
  const a = yield 1;   // suspend, rend 1 ; reprend avec la valeur passée à next()
  const b = yield 2;
  return a + b;
}
const g = compteur();
g.next();     // { value: 1, done: false }  — jusqu'au 1er yield
g.next(10);   // { value: 2, done: false }  — a = 10, jusqu'au 2e yield
g.next(20);   // { value: 30, done: true }  — b = 20, return
```

`await` est un `yield` déguisé, et il manque juste une pièce : le **runner**, une petite boucle qui, à chaque `yield`, attend que la Promise se règle puis rappelle `next()` avec la valeur résolue.

```js
// Un runner qui transforme un générateur en fonction "async"
function runAsync(genFn) {
  return function (...args) {
    const gen = genFn(...args);
    return new Promise((resolve, reject) => {
      function step(method, input) {
        let result;
        try { result = gen[method](input); }  // next() ou throw()
        catch (err) { return reject(err); }
        const { value, done } = result;
        if (done) return resolve(value);
        // value est la Promise "yieldée" : on attend, puis on reprend
        Promise.resolve(value).then(
          (v) => step('next', v),             // reprise normale
          (e) => step('throw', e),            // await sur un rejet ⇒ throw dans le gen
        );
      }
      step('next');
    });
  };
}

// Ce générateur + runner se comporte EXACTEMENT comme une fonction async
const load = runAsync(function* (id) {
  const family = yield fetchFamily(id);   // ≈ await fetchFamily(id)
  const posts  = yield fetchPosts(id);    // ≈ await fetchPosts(id)
  return { family, posts };
});
```

Historiquement, les transpileurs (Babel `regenerator`) implémentaient littéralement `async/await` de cette façon. Depuis V8 7.2, le moteur a une implémentation native (pas de vrai objet générateur intermédiaire), mais **le modèle mental reste exact** : `async function` = un générateur dont chaque `await` est un `yield`, piloté par un runner intégré au moteur.

### 2.5 Chaque `await` cède le contrôle à l'event loop (microtask)

Point crucial pour le timing : quand la fonction se suspend sur un `await`, la reprise n'est **pas** synchrone même si la Promise est déjà résolue. La reprise est planifiée comme une **microtask** — elle passe par la file de microtâches vue aux modules 03-04.

```js
console.log('1');
(async () => {
  console.log('2');                 // synchrone (avant 1er await)
  await Promise.resolve();          // cède le contrôle ICI
  console.log('4');                 // microtask — après le code synchrone
})();
console.log('3');
// Ordre : 1, 2, 3, 4
```

`3` s'affiche avant `4` **bien que la Promise soit déjà résolue** : l'`await` a rendu la main à l'event loop, qui finit d'abord le code synchrone (`3`), puis vide la file de microtâches (`4`). Autrement dit, `await` est un **point de cession** garanti : au minimum un tick, même sur une valeur immédiate.

> Depuis V8 7.2, `await` sur une **Promise native** coûte 1 tick (avant : 3 ticks, à cause d'un wrapping thenable inutile). Sur un thenable non natif (`{ then() {} }`, une Promise Bluebird…), on reste à 2-3 ticks. Rien à faire pour en profiter : c'est automatique sur Node 12+ / navigateurs récents.

### 2.6 Séquentiel vs parallèle : le piège de performance

Comme chaque `await` suspend jusqu'à la résolution *avant* d'exécuter la ligne suivante, enchaîner des `await` sur des tâches **indépendantes** les sérialise inutilement.

```js
// SÉQUENTIEL — temps ≈ SOMME des durées
const a = await taskA();  // on attend A en entier...
const b = await taskB();  // ...avant même de LANCER B
const c = await taskC();

// PARALLÈLE — temps ≈ MAX des durées
const [a, b, c] = await Promise.all([taskA(), taskB(), taskC()]);
// Les 3 fetch sont LANCÉS immédiatement (appel synchrone),
// on await UNE fois sur l'agrégat.
```

Le point clé : `taskA()` **démarre** dès qu'on l'appelle (l'appel synchrone lance la requête). Dans `Promise.all`, on appelle les trois *puis* on `await` l'ensemble — les trois horloges tournent en même temps. Dans la version séquentielle, on n'appelle `taskB` qu'après la résolution complète de `taskA`.

Règle de décision :
- Tâches **indépendantes** ⇒ `Promise.all` (ou `allSettled` si on tolère des échecs partiels).
- Tâche **dépendante** du résultat de la précédente ⇒ `await` séquentiel (obligatoire, pas le choix).

### 2.7 `await` dans une boucle : quand c'est un bug de perf

Le cas le plus fréquent en revue de code : un `await` dans un `for`/`for...of` sur des éléments indépendants.

```js
// LENT — N requêtes en série, temps ≈ N × durée_unitaire
async function loadAll(ids) {
  const results = [];
  for (const id of ids) {
    results.push(await fetchOne(id)); // await bloque chaque tour de boucle
  }
  return results;
}

// RAPIDE — N requêtes en parallèle, temps ≈ durée_unitaire
async function loadAll(ids) {
  return Promise.all(ids.map((id) => fetchOne(id)));
}
```

`ids.map(id => fetchOne(id))` lance les N requêtes **d'un coup** (map est synchrone), produit un tableau de N Promises, et `Promise.all` attend qu'elles finissent toutes. Pour 50 membres à 100 ms, on passe de ~5 s à ~100 ms.

**Nuance — quand `await` dans une boucle est légitime :**
- séquençage **voulu** (chaque itération dépend de la précédente) ;
- **backpressure** : ne pas ouvrir 10 000 connexions d'un coup (là on veut un parallélisme *borné*, ex. par lots de 10 avec un pool).

### 2.8 `try/catch` async et le piège `return await`

Comme un `await` sur une Promise rejetée **relance l'erreur au point d'`await`**, `try/catch` fonctionne naturellement sur le code async :

```js
async function safe() {
  try {
    const data = await risky();   // si risky() rejette, throw ICI
    return transform(data);
  } catch (err) {
    return fallback();            // attrapé, comme une erreur synchrone
  }
}
```

**Le piège classique — `return` sans `await` dans un `try` :**

```js
// BUG : le catch ne verra JAMAIS le rejet de risky()
async function withoutAwait() {
  try {
    return risky();       // on retourne la Promise SANS l'attendre
  } catch (err) {
    return fallback();    // jamais atteint : le try est déjà terminé au rejet
  }
}

// CORRECT
async function withAwait() {
  try {
    return await risky(); // on attend : un rejet devient un throw dans le try
  } catch (err) {
    return fallback();    // atteint
  }
}
```

Sans `await`, la fonction retourne la Promise et **sort du `try`** immédiatement ; la pile est déjà dépilée quand le rejet survient — le `catch` ne peut plus l'intercepter. Règle : **`return await` obligatoire à l'intérieur d'un `try/catch`** ; en dehors d'un `try`, `return await` est redondant (règle ESLint `no-return-await`, assouplie récemment mais le principe tient).

### 2.9 Erreurs non attrapées : ça devient un rejet de Promise

Le moteur enveloppe le corps entier d'une `async function` dans un `try` implicite : toute erreur (synchrone avant le 1er `await`, ou rejet d'un `await`) devient un **rejet de la Promise retournée**. Si personne ne l'attrape ⇒ `unhandledRejection`.

```js
async function boom() {
  throw new Error('x');   // ne remonte PAS la call stack : rejette la Promise
}
boom();                   // Promise rejetée sans .catch ⇒ unhandledRejection

// Node 15+ : un unhandledRejection non géré TERMINE le process (comme uncaughtException)
process.on('unhandledRejection', (reason) => {
  console.error('rejet non géré :', reason);
});
```

Exception importante : un `throw` dans un callback planifié par `setTimeout` **échappe** à l'enveloppe async (il s'exécute dans un autre tour d'event loop) et devient un `uncaughtException`, pas un `unhandledRejection`.

---

## 3. Worked examples

### Exemple 1 — Refactorer le dashboard TribuZen (séquentiel → parallèle)

Reprise du cas concret. On veut passer de ~450 ms à ~180 ms **sans** perdre la gestion d'erreurs.

```js
// ─── AVANT : ~450 ms (somme des 3 durées) ───────────────────────
async function loadFamilyDashboard(familyId) {
  const family  = await fetchFamily(familyId);      // ~120 ms
  const members = await fetchMembers(familyId);     // ~150 ms — attend family pour rien
  const posts   = await fetchLatestPosts(familyId); // ~180 ms — attend members pour rien
  return { family, members, posts };
}

// ─── APRÈS : ~180 ms (max des 3 durées) ─────────────────────────
async function loadFamilyDashboard(familyId) {
  // Les 3 appels sont LANCÉS ici, synchroniquement, l'un après l'autre
  // (mais sans await entre eux) → leurs horloges tournent en parallèle.
  const [family, members, posts] = await Promise.all([
    fetchFamily(familyId),
    fetchMembers(familyId),
    fetchLatestPosts(familyId),
  ]);
  return { family, members, posts };
}
```

**Pourquoi c'est correct :**
- Les trois `fetch...` sont **indépendants** (aucun n'a besoin du résultat d'un autre) ⇒ `Promise.all` est légitime.
- On n'`await` qu'**une seule fois**, sur l'agrégat : un seul point de suspension au lieu de trois.
- Le temps total tombe au max (~180 ms) au lieu de la somme (~450 ms).

**Attention au comportement d'échec :** `Promise.all` **rejette dès le premier échec** (fail-fast). Si un widget peut manquer sans casser la page (ex. les posts), utilise `Promise.allSettled` :

```js
async function loadFamilyDashboard(familyId) {
  const [family, members, posts] = await Promise.allSettled([
    fetchFamily(familyId),
    fetchMembers(familyId),
    fetchLatestPosts(familyId),
  ]);
  return {
    family:  family.status  === 'fulfilled' ? family.value  : null,
    members: members.status === 'fulfilled' ? members.value : [],
    posts:   posts.status   === 'fulfilled' ? posts.value   : [], // dégrade au lieu de casser
  };
}
```

### Exemple 2 — Un `await` dans une boucle qui tue la perf, et sa correction

Endpoint TribuZen : pour chaque membre d'une famille, on récupère son dernier post.

```js
// ─── LENT : await dans la boucle ⇒ requêtes en série ────────────
async function membersWithLastPost(familyId) {
  const members = await fetchMembers(familyId); // 50 membres
  const enriched = [];
  for (const m of members) {
    // Chaque tour SUSPEND jusqu'à la résolution avant de lancer le suivant.
    // 50 × ~100 ms ≈ 5 000 ms.
    const lastPost = await fetchLastPost(m.id);
    enriched.push({ ...m, lastPost });
  }
  return enriched;
}

// ─── RAPIDE : map synchrone + Promise.all ⇒ requêtes parallèles ─
async function membersWithLastPost(familyId) {
  const members = await fetchMembers(familyId);
  // map est SYNCHRONE : les 50 fetchLastPost partent d'un coup.
  const enriched = await Promise.all(
    members.map(async (m) => {
      const lastPost = await fetchLastPost(m.id);
      return { ...m, lastPost };
    }),
  );
  return enriched;      // ~100 ms au lieu de ~5 000 ms
}
```

**Le mécanisme, étape par étape :**
1. `members.map(async m => ...)` **appelle** la callback async pour chaque membre. Chaque appel lance `fetchLastPost(m.id)` *immédiatement* et renvoie une Promise. `map` ne fait que collecter ces 50 Promises — il ne les attend pas.
2. À la fin du `map`, les 50 requêtes sont déjà en vol.
3. `await Promise.all([...])` suspend une seule fois jusqu'à ce que les 50 soient résolues.

**Variante bornée** (si 50 connexions simultanées surchargent la base) — traiter par lots de 10 :

```js
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(fn)))); // 10 en //, puis lot suivant
  }
  return out;
}
```

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « `await x` équivaut à `x.then()` »

```js
// FAUX modèle mental
console.log('1');
await Promise.resolve();
console.log('2'); // "comme un then, ça continue tout de suite" → NON
```

`.then()` **enregistre un callback et poursuit** la ligne suivante synchroniquement. `await` **suspend la fonction** et planifie la reprise en microtask. Le code après `await` ne s'exécute jamais dans le même tick — il y a toujours au moins un point de cession à l'event loop. Bon modèle : `await` = « je pose un marque-page, je rends la main, on me réveille au prochain tick ».

### PIÈGE #2 — `await` séquentiel sur des tâches indépendantes

```js
// ❌ Sérialise sans raison — temps = somme
const user  = await getUser(id);
const stats = await getStats(id);   // n'a pas besoin de user !

// ✅ Parallèle — temps = max
const [user, stats] = await Promise.all([getUser(id), getStats(id)]);
```

**Discrimination :** garde le `await` séquentiel **uniquement** si la ligne 2 utilise le résultat de la ligne 1 (`getStats(user.teamId)`). Sinon, `Promise.all`.

### PIÈGE #3 — `await` dans une boucle sur des éléments indépendants

```js
// ❌ N requêtes en série
for (const id of ids) results.push(await fetchOne(id));

// ✅ N requêtes en parallèle
const results = await Promise.all(ids.map((id) => fetchOne(id)));
```

Le `for...of` + `await` est correct *syntaxiquement* mais désastreux en perf quand les itérations sont indépendantes. Réserve-le au séquençage voulu ou au parallélisme borné.

### PIÈGE #4 — `return risky()` au lieu de `return await risky()` dans un `try`

```js
// ❌ le catch ne verra pas le rejet
try { return risky(); }
catch (e) { return fallback(); }   // jamais atteint

// ✅
try { return await risky(); }
catch (e) { return fallback(); }
```

Sans `await`, la fonction rend la Promise et quitte le `try` avant que le rejet ne survienne : la pile est dépilée, le `catch` est hors jeu. **Dans un `try/catch`, toujours `return await`.**

### PIÈGE #5 — croire qu'un `throw` async devient une exception synchrone

```js
async function f() { throw new Error('x'); }

// ❌ ne marche PAS : f() ne "throw" pas, elle retourne une Promise rejetée
try { f(); } catch (e) { /* jamais atteint */ }

// ✅ il faut await (ou .catch)
try { await f(); } catch (e) { /* attrapé */ }
```

Une `async function` ne lance **jamais** d'exception synchrone : elle rejette sa Promise. Sans `await`/`.catch`, c'est un `unhandledRejection` (et sous Node 15+, un crash du process).

### PIÈGE #6 — `forEach` avec une callback async

```js
// ❌ forEach IGNORE les Promises retournées : rien n'est attendu
ids.forEach(async (id) => { await save(id); });
console.log('fini'); // ment : les save() ne sont pas terminés

// ✅ for...of (séquentiel) ou map + Promise.all (parallèle)
await Promise.all(ids.map((id) => save(id)));
console.log('fini'); // vrai
```

`Array.prototype.forEach` n'attend pas les Promises que sa callback renvoie — il les jette. C'est un cas particulier du piège « async dans une boucle », mais silencieux.

---

## 5. Ancrage TribuZen

Le chargement des vues agrégées de TribuZen est l'endroit où ces patterns comptent le plus.

**`api/loadFamilyDashboard` (`src/server/api/family.ts`)** — c'est le cas concret du module. Le dashboard famille agrège famille + membres + posts. En version naïve (trois `await` en série), le handler répond en ~450 ms ; refactoré en `Promise.all`, en ~180 ms. C'est un gain visible en TTFB sur la page la plus consultée de l'admin.

**`api/membersWithLastPost` (`src/server/api/members.ts`)** — l'enrichissement « dernier post par membre » est le piège `await`-dans-la-boucle typique : 50 membres × 100 ms = 5 s en série, ~100 ms avec `map` + `Promise.all`. Sur une grande famille, c'est la différence entre un timeout et une réponse instantanée.

**Dégradation gracieuse** — sur le dashboard, les posts sont un widget « nice-to-have ». On passe `Promise.all` → `Promise.allSettled` pour que l'échec du service de posts n'empêche pas d'afficher la famille et ses membres.

**Backpressure** — l'import massif de membres (CSV famille) ne doit pas ouvrir 5 000 requêtes d'un coup vers la base. On borne le parallélisme par lots de 10 (`inBatches`), sinon on sature le pool de connexions Postgres.

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/src/server/
  api/
    family.ts      ← loadFamilyDashboard : Promise.all / allSettled
    members.ts     ← membersWithLastPost : map + Promise.all
  lib/
    concurrency.ts ← inBatches : parallélisme borné
```

**Commit cible :**
```
perf(api): loadFamilyDashboard en Promise.all — 450ms vers 180ms
perf(api): membersWithLastPost en parallèle borné (batch 10)
```

---

## 6. Points clés

1. Une fonction `async` retourne **toujours** une Promise : `return v` la résout, `throw e` la rejette (jamais d'exception synchrone).
2. `await` n'est pas `.then()` : il **suspend** la fonction et la retire de la call stack ; le code avant le 1er `await` est synchrone, le reste asynchrone.
3. Le moteur transforme la fonction en **state machine** : à chaque `await`, il sauvegarde le numéro d'état, les variables locales et la scope chain, puis reprend pile au bon endroit.
4. `async/await` ≈ **générateur + runner** : `await` est un `yield` déguisé, et le moteur intègre le runner qui rappelle `next()` à la résolution de chaque Promise.
5. Chaque `await` **cède le contrôle à l'event loop** : la reprise passe par une microtask (≥ 1 tick), même si la Promise est déjà résolue.
6. `await` séquentiel sur des tâches **indépendantes** = temps somme ; `Promise.all` = temps max. Ne sérialiser que ce qui est vraiment dépendant.
7. Un `await` dans une boucle sérialise les itérations : préférer `map` + `Promise.all` (ou un parallélisme borné pour la backpressure).
8. Dans un `try/catch`, **`return await`** est obligatoire ; sinon le `catch` ne voit pas le rejet. `forEach` async ignore les Promises — ne jamais l'utiliser pour de l'async.

---

## 7. Seeds Anki

```
Que retourne toujours une fonction async, quoi qu'on y écrive ?|Une Promise. return v => Promise résolue avec v ; throw e => Promise rejetée avec e. Jamais d'exception synchrone.
Pourquoi await n'est-il pas équivalent à .then() ?|.then() enregistre un callback et continue la ligne suivante ; await SUSPEND la fonction entière (la retire de la call stack) et planifie la reprise en microtask. Le code après await ne s'exécute jamais dans le même tick.
Qu'est-ce que la state machine générée derrière une fonction async ?|Une réécriture de la fonction en automate piloté par un numéro d'état, où chaque await est une transition. À chaque suspension le moteur sauvegarde : numéro d'état (où reprendre), variables locales, scope chain — d'où la survie des locales après un await.
En quoi async/await se ramène-t-il aux générateurs ?|async function ≈ générateur (function*) où chaque await est un yield, plus un runner intégré au moteur qui attend la résolution de la Promise yieldée puis rappelle next() avec la valeur (ou throw() sur rejet).
Que se passe-t-il pour l'event loop à chaque await ?|await cède le contrôle : la reprise est planifiée comme une microtask (au minimum 1 tick), même si la Promise est déjà résolue. C'est un point de cession garanti à l'event loop.
Différence de temps entre 3 await séquentiels et Promise.all sur 3 tâches indépendantes ?|Séquentiel = SOMME des durées (chaque await attend la fin avant de lancer le suivant). Promise.all = MAX des durées (les 3 sont lancées d'un coup, on await une seule fois l'agrégat).
Pourquoi un await dans une boucle for...of peut-il tuer la perf ?|Chaque tour suspend jusqu'à la résolution avant de lancer le suivant => N requêtes en série (N × durée). Correction : items.map(fn) (appels synchrones parallèles) + Promise.all => ~1 × durée.
Pourquoi return await est-il obligatoire dans un try/catch ?|Sans await, la fonction retourne la Promise et sort du try avant le rejet : la pile est dépilée, le catch ne peut plus l'intercepter. return await transforme le rejet en throw au point d'await, dans le try.
Que devient un throw dans une async function, et un throw dans un setTimeout à l'intérieur ?|Le throw dans le corps async => rejet de la Promise retournée (unhandledRejection si non géré ; crash sous Node 15+). Le throw dans un callback setTimeout échappe à l'enveloppe async => uncaughtException.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-06-async-patterns-comparison/README.md`. Mesurer avec `performance.now()` l'écart réel entre chargement séquentiel et `Promise.all`, reproduire le piège `await`-dans-la-boucle, puis borner le parallélisme.
