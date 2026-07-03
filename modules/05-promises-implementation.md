---
titre: "Implémenter une Promise (Promises/A+)"
cours: 01-js-runtime
notions: [trois états pending fulfilled rejected, transitions irréversibles, file de callbacks, exécution asynchrone via queueMicrotask, then retourne une nouvelle promise, chaining, thenable et résolution récursive, propagation de rejet, Promise.all race allSettled any]
outcomes: [expliquer les 3 états d'une Promise et pourquoi les transitions sont irréversibles, implémenter une MyPromise conforme Promises/A+ avec then chaînable, prédire le timing microtask d'un then, choisir le bon combinateur all/race/allSettled/any]
prerequis: [04-microtasks-macrotasks]
next: 06-async-await-under-the-hood
libs: []
tribuzen: reconstruire le comportement d'une Promise pour comprendre le chaînage des appels API TribuZen et le chargement parallèle familles+membres
last-reviewed: 2026-07
---

# Implémenter une Promise (Promises/A+)

> **Outcomes — tu sauras FAIRE :** expliquer les 3 états d'une Promise et pourquoi une transition est irréversible, implémenter une `MyPromise` conforme Promises/A+ avec un `then` chaînable exécuté en microtask, prédire le timing d'un callback `then`, et choisir le bon combinateur (`all` / `race` / `allSettled` / `any`).
> **Difficulté :** :star::star::star:

## 1. Cas concret d'abord

Tu débogues le chargement du dashboard TribuZen. Le code enchaîne trois appels API pour afficher une famille avec ses membres :

```js
// familyDashboard.js — chaînage d'appels API TribuZen
function loadFamilyDashboard(familyId) {
  let family;

  fetchFamily(familyId)
    .then((f) => {
      family = f;
      console.log('famille reçue', family.name); // (2)
      return fetchMembers(f.id); // renvoie une Promise
    })
    .then((members) => {
      console.log('membres reçus', members.length); // (3)
      render(family, members);
    })
    .catch((err) => {
      console.error('échec dashboard', err); // (X)
    });

  console.log('requête lancée'); // (1)
}
```

Un collègue jure que « (2) s'affiche avant (1) parce que `fetchFamily` résout instantanément en cache ». Il a tort, et il ne sait pas dire pourquoi. Trois questions restent floues pour toute l'équipe :

1. Pourquoi `(1)` s'affiche **toujours** avant `(2)`, même si `fetchFamily` a la donnée en cache et résout « immédiatement » ?
2. Pourquoi le deuxième `.then` attend-il la fin de `fetchMembers` alors qu'on a juste **retourné** une Promise depuis le premier `.then` ?
3. Pourquoi une erreur dans `fetchMembers` saute-t-elle directement au `.catch` tout en bas, en sautant le deuxième `.then` ?

Répondre proprement à ces trois questions, c'est comprendre la mécanique interne d'une Promise. La façon la plus solide de la comprendre : la reconstruire. Ce module te fait écrire ta propre `MyPromise`, et chaque question ci-dessus tombera d'elle-même.

---

## 2. Théorie complète, concise

### 2.1 Les trois états et l'irréversibilité

Une Promise est une machine à états à **trois** états, dont **deux** sont finaux :

```
   pending  ──resolve(value)──▶  fulfilled (value)   ┐
      │                                              ├─ settled (final, figé)
      └──────reject(reason)──▶  rejected (reason)    ┘
```

Règles non négociables :

- Une Promise démarre en `pending`.
- Elle transite **au plus une fois** : `pending → fulfilled` **ou** `pending → rejected`.
- Une fois `settled` (fulfilled ou rejected), son état et sa valeur sont **figés à vie**. Tout `resolve`/`reject` ultérieur est un **no-op** silencieux.

C'est l'irréversibilité qui rend une Promise fiable comme valeur : un `.then` attaché après coup lira toujours la même valeur.

```js
const p = new Promise((resolve, reject) => {
  resolve('A');
  resolve('B'); // ignoré : déjà settled
  reject('C');  // ignoré : déjà settled
});
p.then((v) => console.log(v)); // "A", et rien d'autre
```

### 2.2 La file de callbacks (pending → settled)

Quand tu appelles `.then(cb)` sur une Promise **encore pending**, le callback ne peut pas s'exécuter : la valeur n'existe pas. La Promise **stocke** donc `cb` dans une file interne. Plusieurs `.then` sur la même Promise pending s'empilent dans cette file.

Au moment où `resolve(value)` est appelé, la Promise :
1. passe en `fulfilled`, mémorise `value` ;
2. **vide sa file** en planifiant chaque callback stocké.

Si au contraire la Promise est **déjà** settled quand tu appelles `.then`, il n'y a rien à stocker : le callback est planifié directement.

### 2.3 Exécution asynchrone via `queueMicrotask`

Point capital, celui qui explique le `(1)` avant `(2)` du cas concret : **un callback `then` ne s'exécute jamais de façon synchrone**. Même sur une Promise déjà résolue, il est planifié dans la **file de microtasks** (revoir module 04).

```js
console.log('avant');
Promise.resolve('x').then((v) => console.log('then', v));
console.log('après');
// Ordre : avant, après, then x
```

L'outil bas niveau pour reproduire ça soi-même est `queueMicrotask(fn)` : il pousse `fn` dans la file de microtasks, exécutée après la fin du script synchrone courant, avant tout timer/macrotask. C'est exactement ce qu'utilise une Promise pour ses callbacks. Garantie Promises/A+ 2.2.4 : « `onFulfilled`/`onRejected` ne doivent pas être appelés avant que la pile d'exécution ne contienne plus que du code de plateforme ».

### 2.4 `then` retourne une NOUVELLE Promise (chaining)

`promise.then(cb)` ne retourne pas `promise`. Il retourne une **nouvelle** Promise (`promise2`) dont l'état dépend de ce que fait `cb` :

- `cb` retourne une valeur `v` → `promise2` est fulfilled avec `v`.
- `cb` throw une erreur `e` → `promise2` est rejected avec `e`.
- `cb` retourne une **autre Promise** `p3` → `promise2` **adopte** l'état de `p3` (attend qu'elle se règle).

Ce troisième cas répond à la question 2 du cas concret : retourner `fetchMembers(...)` depuis le premier `.then` fait que la Promise du `.then` **attend** cette sous-Promise avant de passer au maillon suivant.

```js
Promise.resolve(1)
  .then((v) => v + 1)             // fulfilled(2)
  .then((v) => Promise.resolve(v * 10)) // adopte -> fulfilled(20)
  .then((v) => console.log(v));   // 20
```

### 2.5 Le thenable et la résolution récursive

Un **thenable** est n'importe quel objet (ou fonction) possédant une méthode `.then`. Les Promises natives en sont, mais une lib tierce peut fournir la sienne. La spec impose qu'une Promise sache **absorber** n'importe quel thenable, pas seulement ses propres instances.

Quand on résout avec un thenable `x`, la procédure de résolution (Promises/A+ 2.3) :
1. récupère `x.then` **une seule fois** ;
2. si `then` est une fonction, appelle `then.call(x, resolveInterne, rejectInterne)` ;
3. la valeur passée à `resolveInterne` peut **elle-même** être un thenable → on recommence (**récursion**) jusqu'à obtenir une valeur non-thenable.

Deux protections obligatoires :
- **cycle** : si `x` est la Promise elle-même, `TypeError` (sinon attente infinie) ;
- **appel unique** : un thenable malveillant pourrait appeler `resolve` ET `reject`, ou plusieurs fois. Un flag `called` neutralise tout sauf le premier appel.

### 2.6 Propagation du rejet

Réponse à la question 3 du cas concret. Dans `then(onFulfilled, onRejected)` :

- si `onRejected` **manque**, le rejet est **propagé** tel quel à `promise2` (comme un `throw reason`) ;
- si `onFulfilled` manque, la valeur est propagée telle quelle.

Concrètement, un `.then` sans deuxième argument **laisse passer** le rejet vers le maillon suivant. Le rejet « glisse » le long de la chaîne jusqu'au premier `.then(_, onRejected)` ou `.catch` (qui est un `then(null, onRejected)`).

```js
fetchFamily(id)
  .then((f) => fetchMembers(f.id)) // si fetchMembers rejette...
  .then((m) => render(m))          // ...ce maillon est SAUTÉ
  .catch((e) => showError(e));     // ...et le rejet atterrit ici
```

### 2.7 Les combinateurs `all` / `race` / `allSettled` / `any`

Quatre façons d'agréger plusieurs Promises. À connaître par cœur car le choix est un piège d'entretien :

| Combinateur | Résout quand | Rejette quand | Valeur résolue |
|---|---|---|---|
| `Promise.all` | **toutes** fulfilled | **une** rejette (fail-fast) | tableau des valeurs (ordre préservé) |
| `Promise.race` | la **première** settled (fulfill *ou* reject) | si la première settled rejette | valeur/raison de la première |
| `Promise.allSettled` | **toutes** settled | **jamais** | tableau de `{status, value}` / `{status, reason}` |
| `Promise.any` | la **première** fulfilled | **toutes** rejettent | valeur du premier fulfill (sinon `AggregateError`) |

- `all` : « j'ai besoin de tout, et j'échoue vite si un morceau manque ». Idéal pour charger familles **et** membres en parallèle.
- `allSettled` : « je veux le bilan complet, succès comme échecs ». Idéal pour un batch tolérant aux erreurs partielles.
- `race` : « le premier qui parle gagne » — souvent utilisé pour un **timeout** (course contre un `setTimeout` qui rejette).
- `any` : « le premier qui **réussit** gagne » — fallback entre plusieurs sources.

Détails de valeur : `all` préserve l'ordre du tableau d'entrée (pas l'ordre d'arrivée). Sur tableau vide : `all` et `allSettled` résolvent immédiatement `[]`, `any` rejette immédiatement (`AggregateError`), `race` reste pending pour toujours.

---

## 3. Worked examples

### Exemple 1 — Construire `MyPromise` (états + file + microtask + chaining)

On implémente pas à pas, conforme Promises/A+ dans l'esprit. Chaque bloc est commenté sur le point clé.

```js
// myPromise.js
const PENDING = 'pending';
const FULFILLED = 'fulfilled';
const REJECTED = 'rejected';

class MyPromise {
  constructor(executor) {
    this.state = PENDING;
    this.value = undefined;   // valeur si fulfilled
    this.reason = undefined;  // raison si rejected
    this.onFulfilledCbs = []; // file de callbacks (Promise encore pending)
    this.onRejectedCbs = [];

    const resolve = (value) => {
      // 2.1 : transition unique. Si déjà settled, no-op.
      if (this.state !== PENDING) return;
      // 2.5 : si on résout avec un thenable, on l'absorbe d'abord
      if (value && (typeof value === 'object' || typeof value === 'function')) {
        const then = value.then;
        if (typeof then === 'function') {
          // adopte l'état du thenable (récursion via resolve/reject)
          then.call(value, resolve, reject);
          return;
        }
      }
      this.state = FULFILLED;
      this.value = value;
      // 2.2 : vider la file — chaque cb a été stocké pending
      this.onFulfilledCbs.forEach((cb) => cb());
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
      reject(err); // un throw dans l'executor rejette la Promise
    }
  }

  then(onFulfilled, onRejected) {
    // 2.6 : arguments optionnels -> valeurs par défaut qui propagent
    const onF = typeof onFulfilled === 'function' ? onFulfilled : (v) => v;
    const onR = typeof onRejected === 'function'
      ? onRejected
      : (r) => { throw r; }; // re-throw => propage le rejet

    // 2.4 : then retourne une NOUVELLE Promise
    const promise2 = new MyPromise((resolve, reject) => {
      const runFulfilled = () => {
        // 2.3 : toujours asynchrone, jamais synchrone
        queueMicrotask(() => {
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
        // pending : on STOCKE dans la file, exécuté au resolve/reject
        this.onFulfilledCbs.push(runFulfilled);
        this.onRejectedCbs.push(runRejected);
      }
    });

    return promise2;
  }

  catch(onRejected) {
    return this.then(null, onRejected); // sucre : then sans onFulfilled
  }

  static resolve(value) {
    if (value instanceof MyPromise) return value; // raccourci spec
    return new MyPromise((resolve) => resolve(value));
  }

  static reject(reason) {
    return new MyPromise((_, reject) => reject(reason));
  }
}
```

La procédure de résolution (Promises/A+ 2.3), extraite pour clarté — c'est elle qui gère le chaining d'une Promise vers une autre + les thenables + les cycles :

```js
// resolvePromise : décide ce que devient promise2 selon x (valeur renvoyée par le cb)
function resolvePromise(promise2, x, resolve, reject) {
  // 2.3.1 : cycle -> TypeError (sinon attente infinie)
  if (promise2 === x) {
    return reject(new TypeError('Chaining cycle detected'));
  }

  if (x && (typeof x === 'object' || typeof x === 'function')) {
    let called = false; // protège contre un thenable qui appelle plusieurs fois
    try {
      const then = x.then; // 2.3.3.1 : lu UNE seule fois
      if (typeof then === 'function') {
        // x est un thenable -> on l'absorbe récursivement
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
        resolve(x); // objet sans .then -> valeur normale
      }
    } catch (err) {
      if (called) return;
      reject(err); // lire/appeler x.then a throw
    }
  } else {
    resolve(x); // primitive -> fulfill direct
  }
}
```

Vérification manuelle du chaining (à exécuter mentalement, pas un test simulé) :

```js
MyPromise.resolve(1)
  .then((v) => v + 1)                    // -> 2
  .then((v) => new MyPromise((r) => r(v * 10))) // adopte -> 20
  .then((v) => console.log('résultat', v));     // affiche "résultat 20"
```

Déroulé : `resolve(1)` fulfill immédiatement → premier `then` planifie une microtask qui calcule `2` et résout `promise2` → deuxième `then` reçoit `2`, retourne une `MyPromise`, `resolvePromise` détecte le thenable et **adopte** son état (`20`) → troisième `then` logge `20`. Aucun `.then` n'a tourné de façon synchrone.

### Exemple 2 — `Promise.all` pour charger familles + membres en parallèle

Implémentation du combinateur le plus utile pour TribuZen, puis usage réel.

```js
MyPromise.all = function (promises) {
  return new MyPromise((resolve, reject) => {
    const results = [];
    let remaining = promises.length;

    if (remaining === 0) {
      resolve(results); // tableau vide -> résolution immédiate
      return;
    }

    promises.forEach((p, index) => {
      // MyPromise.resolve normalise : accepte valeurs brutes ET thenables
      MyPromise.resolve(p).then(
        (value) => {
          results[index] = value; // position PRÉSERVÉE (pas l'ordre d'arrivée)
          remaining -= 1;
          if (remaining === 0) resolve(results); // tous fulfilled -> on résout
        },
        reject // premier rejet -> rejette tout (fail-fast)
      );
    });
  });
};
```

Usage TribuZen — charger en parallèle plutôt qu'en série :

```js
// ❌ En série : 2 allers-retours réseau séquentiels (lent)
const family = await fetchFamily(id);
const events = await fetchEvents(id); // n'attend rien de family, pourtant il patiente

// ✅ En parallèle : les deux requêtes partent en même temps
const [family2, events2] = await Promise.all([
  fetchFamily(id),
  fetchEvents(id),
]);
// résout quand les DEUX sont là ; rejette dès que l'UNE échoue
```

Si l'une des deux requêtes échoue, `all` rejette immédiatement (fail-fast) : le `await` throw, ton `try/catch` autour capte l'erreur. Si tu voulais afficher la partie disponible même en cas d'échec partiel, tu utiliserais `allSettled` à la place.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire qu'un `then` sur une Promise résolue s'exécute tout de suite

```js
const p = Promise.resolve('cache');
p.then((v) => console.log('then', v));
console.log('sync');
// ❌ attendu par beaucoup : then cache, sync
// ✅ réel : sync, then cache
```

**Pourquoi c'est faux :** même déjà settled, le callback part en **microtask** (2.2.4). Le code synchrone qui suit finit toujours d'abord. C'est exactement le `(1)` avant `(2)` du cas concret — l'argument « c'est en cache donc synchrone » est faux, le cache ne change **rien** au timing.

### PIÈGE #2 — Confondre « retourner une valeur » et « retourner une Promise » dans un `then`

```js
// Retourne une valeur : promise2 fulfilled immédiatement avec cette valeur
.then((f) => f.name)          // maillon suivant reçoit une string

// Retourne une Promise : promise2 ATTEND cette Promise (adoption)
.then((f) => fetchMembers(f.id)) // maillon suivant attend fetchMembers
```

**Misconception :** « le `.then` suivant reçoit la Promise `fetchMembers` ». Non — il reçoit la **valeur résolue** de cette Promise, car la chaîne l'a déjà unwrappée. Oublier ça mène à `members.length` sur un objet Promise → `undefined`.

### PIÈGE #3 — Oublier que `then` retourne une **nouvelle** Promise (chaînes branchées)

```js
const base = fetchFamily(id);
base.then((f) => enrich(f)); // branche A
base.then((f) => log(f));    // branche B : repart de base, PAS de A
```

**Erreur classique :** croire que B voit le résultat de `enrich`. Chaque `.then` sur `base` crée une branche **indépendante** partant de `base`. Pour enchaîner, il faut chaîner sur la Promise **retournée**, pas re-`.then` la source.

### PIÈGE #4 — Utiliser `Promise.all` là où il faut `allSettled`

```js
// ❌ Un membre injoignable fait tout échouer -> dashboard vide
const all = await Promise.all(memberIds.map(fetchMember));

// ✅ On veut le bilan, succès comme échecs
const settled = await Promise.allSettled(memberIds.map(fetchMember));
const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
```

**Règle :** `all` = « tout ou rien » (fail-fast). `allSettled` = « donne-moi le rapport complet ». Choisir `all` pour un batch tolérant aux erreurs partielles casse l'affichage dès qu'un seul élément échoue.

### PIÈGE #5 — Absorber un thenable sans protéger l'appel unique

```js
// thenable malveillant : appelle resolve DEUX fois
const evil = { then: (res) => { res('a'); res('b'); } };
```

Sans le flag `called` dans `resolvePromise`, `promise2` pourrait tenter deux transitions. La garde `if (this.state !== PENDING) return` dans `resolve`/`reject` protège l'état interne, mais Promises/A+ 2.3.3.3.3 exige explicitement d'ignorer les appels surnuméraires **au niveau de la procédure de résolution** — d'où le double verrou.

---

## 5. Ancrage TribuZen

La couche « appels API » de TribuZen repose entièrement sur ce modèle Promise. Reconstruire `MyPromise` sert directement à raisonner sur trois situations réelles du produit.

**Chaînage des appels API** (`src/api/family.ts`). Le flux « famille → membres → rendu » du cas concret est le pattern de toutes les pages de détail TribuZen. Comprendre que `then` retourne une nouvelle Promise, et que retourner `fetchMembers(...)` fait attendre la chaîne, c'est ce qui permet d'écrire ces séquences sans les casser (et de placer un seul `.catch` en fin de chaîne qui capte tous les rejets intermédiaires).

**Un `then` qui ne s'exécute pas quand on croit** (bug de timing). Sur le dashboard, un `setState` placé dans un `.then` s'exécute en microtask, après le rendu synchrone courant. Savoir que le callback est **toujours** différé (même sur cache résolu) évite des heures de debug sur des « états qui arrivent trop tard ». C'est le PIÈGE #1 appliqué au vrai produit.

**`Promise.all` pour charger familles + membres en parallèle** (`src/pages/DashboardPage.tsx`). Au lieu de deux `await` séquentiels, TribuZen lance `Promise.all([fetchFamily(id), fetchMembers(id)])` : les deux requêtes partent simultanément, le temps de chargement chute au max des deux au lieu de leur somme. Le fail-fast d'`all` est acceptable ici (sans famille **ni** membres, la page n'a rien à afficher). Pour la liste des invitations (tolérante aux échecs partiels), TribuZen passe à `allSettled`.

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/src/
  api/
    family.ts     // fetchFamily / fetchMembers : chaînage + catch unique
    client.ts     // wrapper fetch retournant des Promises typées
  pages/
    DashboardPage.tsx  // Promise.all familles + membres
```

---

## 6. Points clés

1. Une Promise a 3 états (`pending`, `fulfilled`, `rejected`) ; la transition est unique et **irréversible** — tout `resolve`/`reject` après settlement est un no-op.
2. Sur une Promise pending, `then` **stocke** le callback dans une file interne ; au `resolve`/`reject`, la file est vidée.
3. Un callback `then` s'exécute **toujours** en microtask (`queueMicrotask`), jamais synchrone — même sur une Promise déjà résolue.
4. `then` retourne une **nouvelle** Promise ; c'est ce qui rend le chaînage possible.
5. Retourner une valeur depuis `then` la fulfill ; retourner une Promise la fait **adopter** (attendre) ; throw la rejette.
6. Un **thenable** (objet avec `.then`) est absorbé récursivement ; il faut protéger contre les cycles (`TypeError`) et les appels multiples (flag `called`).
7. Un rejet **propage** le long de la chaîne en sautant les `then` sans `onRejected`, jusqu'au premier `catch`.
8. `all` (tout ou rien, fail-fast), `race` (premier settled), `allSettled` (bilan complet, ne rejette jamais), `any` (premier fulfilled) — le choix dépend de la tolérance aux échecs.

---

## 7. Seeds Anki

```
Pourquoi une transition d'état de Promise est-elle irréversible ?|Une Promise passe de pending à fulfilled OU rejected une seule fois. Après settlement, état et valeur sont figés ; tout resolve/reject ultérieur est un no-op silencieux. C'est ce qui la rend fiable comme valeur : un then attaché plus tard lira toujours la même chose.
Que fait then quand la Promise est encore pending ?|Il ne peut pas exécuter le callback (pas de valeur) : il le STOCKE dans une file interne (onFulfilledCbs/onRejectedCbs). Au moment du resolve/reject, la Promise vide sa file en planifiant chaque callback stocké.
Un then sur une Promise DÉJÀ résolue s'exécute-t-il de façon synchrone ?|Non. Le callback part toujours en microtask (queueMicrotask), garantie Promises/A+ 2.2.4. Le code synchrone qui suit s'exécute d'abord. Le fait que la valeur soit en cache ne change rien au timing.
Que retourne promise.then(cb) et pourquoi est-ce crucial ?|Une NOUVELLE Promise (promise2), pas la même. C'est ce qui permet le chaînage : chaque then crée un maillon. promise2 est fulfilled avec la valeur retournée par cb, rejected si cb throw, ou adopte l'état de la Promise que cb retourne.
Que se passe-t-il si un callback then retourne une autre Promise ?|La Promise du then (promise2) ADOPTE l'état de cette Promise : elle attend qu'elle se règle, puis prend sa valeur/raison. C'est la résolution récursive des thenables (Promises/A+ 2.3).
Qu'est-ce qu'un thenable et quelles protections exige sa résolution ?|Tout objet/fonction ayant une méthode .then. La procédure de résolution l'absorbe récursivement. Protections obligatoires : détecter le cycle (promise2 === x -> TypeError) et ignorer les appels multiples via un flag called (thenable qui appelle resolve/reject plusieurs fois).
Comment un rejet se propage-t-il dans une chaîne de then ?|Un then sans onRejected propage le rejet tel quel (comme throw reason) au maillon suivant. Le rejet glisse le long de la chaîne en sautant ces then jusqu'au premier .then(_, onRejected) ou .catch (qui est then(null, onRejected)).
Quelle différence entre Promise.all et Promise.allSettled ?|all : résout quand toutes fulfilled, rejette dès qu'une rejette (fail-fast), valeur = tableau ordonné des valeurs. allSettled : résout quand toutes sont settled, ne rejette JAMAIS, valeur = tableau de {status, value} ou {status, reason}. all = tout ou rien ; allSettled = bilan complet.
Quand choisir Promise.any plutôt que Promise.race ?|any : résout au premier FULFILLED (ignore les rejets), rejette seulement si toutes rejettent (AggregateError) — pour un fallback entre sources. race : résout/rejette à la première settled quelle qu'elle soit — pour un timeout (course contre un setTimeout qui rejette).
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-05-promise-implementation/README.md`. Construire une `MyPromise` conforme Promises/A+ de zéro (états, file de callbacks, `then` chaînable en microtask, résolution des thenables, `Promise.all`), puis vérifier le timing microtask à la main.
