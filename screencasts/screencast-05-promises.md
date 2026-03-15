# Screencast 05 — Promises : Implémentation Interne

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/05-promises-implementation.md`
- **Lab associé** : `labs/lab-05-promise-implementation/`
- **Prérequis** : Modules 00-04 terminés, bonne compréhension des microtâches

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Éditeur de code avec les fichiers du lab :
  - `labs/lab-05-promise-implementation/exercise-step1.js`
  - `labs/lab-05-promise-implementation/exercise-step2.js`
  - `labs/lab-05-promise-implementation/exercise-step3.js`
- [ ] Fichier de tests prêt à être lancé
- [ ] Schéma des 3 états d'une Promise prêt à afficher

## Script

### [00:00-01:30] Introduction — Pourquoi implémenter Promise soi-même ?

> Bienvenue dans le module 05. Aujourd'hui, on va faire quelque chose de spécial :
> on va **implémenter notre propre classe Promise** depuis zéro.
>
> Pourquoi ? Parce que la meilleure façon de comprendre un mécanisme, c'est de
> le construire. Après ce module, quand vous écrirez `new Promise(...)` ou
> `.then(...)`, vous saurez exactement ce qui se passe sous le capot.
>
> On va procéder en trois étapes progressives. À chaque étape, on ajoute une
> fonctionnalité et on vérifie avec des tests.

### [01:30-04:00] Concept clé — Les 3 états et le mécanisme interne

> Une Promise est un objet qui représente une **valeur future**. Elle a exactement
> **3 états possibles** :
>
> 1. **Pending** (en attente) — état initial, ni résolue ni rejetée.
> 2. **Fulfilled** (tenue) — l'opération a réussi, une valeur est disponible.
> 3. **Rejected** (rejetée) — l'opération a échoué, une raison est disponible.
>
> La transition est **irréversible** : une fois fulfilled ou rejected, l'état
> ne change plus jamais. C'est ce qu'on appelle la propriété d'**immutabilité d'état**.

**Action** : Afficher le diagramme d'états : `pending → fulfilled` ou `pending → rejected`.

> En interne (dans V8), une Promise a :
> - Un champ `[[PromiseState]]` — l'état courant.
> - Un champ `[[PromiseResult]]` — la valeur ou la raison.
> - Une liste de `[[PromiseReactions]]` — les callbacks enregistrés via `.then()`.
>
> Le concept de **PromiseReaction** est central. Chaque appel à `.then(onFulfilled, onRejected)`
> crée un objet PromiseReaction qui contient :
> - Le callback à exécuter
> - La Promise retournée par `.then()` (car `.then()` retourne TOUJOURS une nouvelle Promise)
>
> C'est ce mécanisme de chaînage qui rend les Promises si puissantes.

### [04:00-08:00] Démonstration progressive — Étape par étape

> Ouvrons le premier fichier du lab.

**Action** : Ouvrir `labs/lab-05-promise-implementation/exercise-step1.js`.

> **Étape 1 : resolve + then (cas fulfilled uniquement)**
>
> On commence par le minimum : une classe `MyPromise` avec `resolve` et `.then`.

**Action** : Coder en live ou commenter le squelette fourni.

```javascript
class MyPromise {
  constructor(executor) {
    this._state = "pending";
    this._value = undefined;
    this._reactions = [];

    const resolve = (value) => {
      if (this._state !== "pending") return; // Immutabilité d'état
      this._state = "fulfilled";
      this._value = value;
      this._reactions.forEach(({ onFulfilled, resolve: res }) => {
        queueMicrotask(() => res(onFulfilled(this._value)));
      });
    };

    executor(resolve);
  }

  then(onFulfilled) {
    return new MyPromise((resolve) => {
      if (this._state === "fulfilled") {
        queueMicrotask(() => resolve(onFulfilled(this._value)));
      } else {
        this._reactions.push({ onFulfilled, resolve });
      }
    });
  }
}
```

> Le point crucial ici : on utilise `queueMicrotask` pour que les callbacks
> soient toujours **asynchrones**, même si la Promise est déjà résolue.

**Commande** :
```bash
node labs/lab-05-promise-implementation/exercise-step1.js
```

> Les tests de l'étape 1 passent. Passons à l'étape 2.

**Action** : Ouvrir `exercise-step2.js`.

> **Étape 2 : ajout du rejet (reject + catch)**
>
> On ajoute le callback `reject` dans le constructeur, le paramètre `onRejected`
> dans `.then()`, et la méthode `.catch()` qui est simplement `.then(undefined, onRejected)`.

**Action** : Montrer les modifications nécessaires et lancer les tests.

```bash
node labs/lab-05-promise-implementation/exercise-step2.js
```

> Parfait, les tests de rejet passent aussi.

### [08:00-11:00] Approfondissement — Le thenable unwrapping et le chaînage complet

> **Étape 3 : le chaînage complet et le thenable unwrapping**

**Action** : Ouvrir `exercise-step3.js`.

> C'est ici que ça se complique. Si `onFulfilled` retourne une Promise (où un
> thenable — un objet avec une méthode `.then`), on ne doit pas résoudre avec
> cet objet directement. On doit **l'unwrapper** : attendre que cette Promise
> interne se résolve, puis résoudre la Promise externe avec le résultat.

```javascript
const resolvePromise = (promise, value, resolve, reject) => {
  if (value === promise) {
    reject(new TypeError("Chaining cycle detected"));
  } else if (value && typeof value.then === "function") {
    value.then(resolve, reject); // Unwrap the thenable
  } else {
    resolve(value);
  }
};
```

> C'est ce mécanisme qui permet d'écrire :
> ```javascript
> fetch(url).then(res => res.json()).then(data => ...)
> ```
> `res.json()` retourne une Promise, et `.then` l'unwrap automatiquement.

**Commande** :
```bash
node labs/lab-05-promise-implementation/exercise-step3.js
```

> Tous les tests passent. On à une implémentation fonctionnelle de Promise !
> Elle n'est pas complète (il manquerait `Promise.all`, `Promise.race`,
> `finally`, etc.), mais le coeur est là.

### [11:00-14:00] Récap — L'insight fondamental

> Récapitulons les points essentiels :
>
> 1. Une Promise a **3 états** : pending, fulfilled, rejected. La transition est irréversible.
> 2. `.then()` retourne **toujours** une nouvelle Promise — c'est ce qui permet le chaînage.
> 3. Les callbacks sont toujours exécutés **de manière asynchrone** (via microtask queue).
> 4. Le **thenable unwrapping** permet de chaîner des opérations asynchrones séquentielles.
> 5. Les **PromiseReactions** sont le mécanisme interne qui lie les callbacks aux Promises.
>
> **L'insight fondamental** : `.then()` ne "modifie" pas la Promise existante.
> Il crée une nouvelle Promise dont la résolution dépend du retour du callback.
> C'est un pipeline de transformations, ou chaque maillon est une nouvelle Promise.

**Action** : Mentionner le quiz et le module suivant.

> Faites le quiz du module 05. L'exercice bonus du lab vous demandé d'implémenter
> `Promise.all()` — essayez, c'est un excellent exercice !
>
> Au prochain screencast, on verra comment `async/await` est implémenté en interne
> par-dessus ce mécanisme de Promises. À bientôt !

## Points d'attention pour l'enregistrement
- Le live coding doit être préparé : avoir les solutions prêtes en cas de problème
- Taper lentement et commenter chaque ligne quand on code le constructeur
- Bien insister sur `queueMicrotask` — c'est ce qui fait qu'une Promise est asynchrone
- L'étape 3 (thenable unwrapping) est la plus difficile — prendre le temps d'expliquer
- Montrer que `.then()` retourne une nouvelle Promise en faisant un `console.log` du retour
- Si le temps manque, l'étape 3 peut être commentée plutôt que codée en live
