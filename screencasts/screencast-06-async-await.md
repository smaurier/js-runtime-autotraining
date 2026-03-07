# Screencast 06 — Async/Await sous le capot

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/06-async-await-under-the-hood.md`
- **Lab associé** : `labs/lab-06-async-patterns-comparison/`
- **Prérequis** : Modules 00-05 terminés, implémentation de Promise maîtrisée

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Éditeur de code avec `labs/lab-06-async-patterns-comparison/exercise.js`
- [ ] Fichier de démo `return-vs-return-await.js` prêt pour le live coding
- [ ] Chrome DevTools (onglet Sources) pour le debugging async

## Script

### [00:00-01:30] Introduction — Le sucre syntaxique le plus trompeur

> Bienvenue dans le module 06. `async/await` est probablement la fonctionnalité
> la plus appréciée de JavaScript moderne. Elle rend le code asynchrone lisible
> comme du code synchrone. Mais cette simplicité apparente cache une mécanique
> complexe.
>
> Aujourd'hui, on va comprendre ce que **le moteur fait réellement** quand il
> rencontre `async` et `await`. Et on va voir que cette compréhension change
> la façon dont vous écrivez et débuguez votre code asynchrone.

### [01:30-04:00] Concept clé — Ce que le moteur voit

> Quand vous écrivez une fonction `async`, V8 crée en interne un objet
> **JSAsyncFunctionObject**. Ce n'est pas une simple fonction — c'est une
> machine à états qui peut **suspendre et reprendre** son exécution.
>
> Concrètement, le moteur transforme votre code. Voici l'équivalence :

```javascript
// Ce que vous écrivez :
async function fetchData() {
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

// Ce que le moteur "voit" (simplifié) :
function fetchData() {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then(response => response.json())
      .then(data => resolve(data))
      .catch(err => reject(err));
  });
}
```

> À chaque `await`, la fonction est **suspendue**. Son état (variables locales,
> position dans le code) est sauvegardé. Quand la Promise attendue se résout,
> la fonction **reprend** exactement où elle s'était arrêtée.
>
> C'est exactement le même mécanisme que les **générateurs** (`function*` / `yield`),
> mais spécialisé pour les Promises. D'ailleurs, avant que `async/await` n'existe
> nativement, des librairies comme `co` utilisaient des générateurs pour simuler
> ce comportement.

**Action** : Montrer le parallèle avec un générateur.

> Point important : chaque `await` coûte **au minimum 1 tick** de microtâche.
> Depuis V8 7.2 (Node.js 12+), ce coût a été réduit à exactement 1 tick
> (avant, c'était 3 ticks). Ça a des implications sur l'ordonnancement.

### [04:00-08:00] Démonstration pratique — Surprises d'ordonnancement

> Ouvrons le lab et voyons des cas qui surprennent.

**Action** : Ouvrir `labs/lab-06-async-patterns-comparison/exercise.js`.

> Ce lab mélange des appels `async/await` avec des Promises classiques et
> des `process.nextTick`. L'exercice demande de prédire l'ordre d'exécution.

```javascript
async function foo() {
  console.log("foo-start");
  await bar();
  console.log("foo-end");
}

async function bar() {
  console.log("bar-start");
  await Promise.resolve();
  console.log("bar-end");
}

console.log("script-start");
foo();
console.log("script-end");
```

> Réfléchissons ensemble. `console.log("script-start")` s'affiche en premier.
> On entre dans `foo()`, qui affiche `"foo-start"`.
> On entre dans `bar()`, qui affiche `"bar-start"`.
> `await Promise.resolve()` suspend `bar()` — la suite est une microtâche.
> `await bar()` suspend `foo()` — la suite attend que `bar()` finisse.
> On revient au code synchrone : `"script-end"` s'affiche.
> Les microtâches s'exécutent : `"bar-end"`, puis `"foo-end"`.

**Commande** :
```bash
node labs/lab-06-async-patterns-comparison/exercise.js
```

> Vérifions... Exactement comme prévu. La clé, c'est que **tout ce qui suit
> un `await` est planifié comme une microtâche**, exactement comme un `.then()`.

**Action** : Montrer un deuxième puzzle du lab avec des résultats plus surprenants.

### [08:00-11:00] Approfondissement — return vs return await en try/catch

> Il y a un piège classique que beaucoup de développeurs rencontrent en production.
> Quelle est la différence entre `return promise` et `return await promise` ?

**Action** : Créer un fichier de démo en live.

```javascript
async function withoutAwait() {
  try {
    return rejectingPromise();
  } catch (e) {
    console.log("Attrapé dans withoutAwait :", e.message);
    return "recovered";
  }
}

async function withAwait() {
  try {
    return await rejectingPromise();
  } catch (e) {
    console.log("Attrapé dans withAwait :", e.message);
    return "recovered";
  }
}

function rejectingPromise() {
  return Promise.reject(new Error("Erreur !"));
}

// Testons
withoutAwait().then(console.log).catch(e => console.log("Non attrapé :", e.message));
withAwait().then(console.log).catch(e => console.log("Non attrapé :", e.message));
```

**Commande** : Exécuter ce fichier.

> Résultat :
> - `withoutAwait` : le `catch` n'attrape PAS l'erreur. La Promise rejetée est
>   retournée directement, elle bypass le try/catch.
> - `withAwait` : le `catch` attrape l'erreur. Le `await` force la suspension,
>   et si la Promise est rejetée, le contrôle passe au `catch`.
>
> **Règle** : utilisez toujours `return await` dans un `try/catch`.
> La règle ESLint `no-return-await` a d'ailleurs été dépréciée pour cette raison.

**Action** : Montrer la stack trace dans DevTools pour les deux cas.

> Autre avantage de `return await` : les **stack traces asynchrones** sont plus
> complètes. Avec `return` seul, le frame de la fonction manque dans la trace.

### [11:00-14:00] Récap — Le vrai coût d'await

> Récapitulons :
>
> 1. `async` crée un **JSAsyncFunctionObject** — une machine à états suspensible.
> 2. `await` suspend la fonction et planifie la reprise comme **microtâche**.
> 3. Depuis V8 7.2, chaque `await` coûte exactement **1 tick** de microtâche.
> 4. `return await` dans un `try/catch` n'est pas redondant — c'est **nécessaire**
>    pour que le `catch` puisse intercepter les rejets.
> 5. Les stack traces async sont meilleures avec `return await`.
>
> **Conseil pratique** : n'utilisez pas `await` quand vous n'avez pas besoin
> du résultat immédiatement. Préférez `Promise.all()` pour la parallélisation :

```javascript
// Séquentiel (lent) :
const a = await fetchA();
const b = await fetchB();

// Parallèle (rapide) :
const [a, b] = await Promise.all([fetchA(), fetchB()]);
```

**Action** : Mentionner le quiz du module 06.

> Faites le quiz et essayez de débugger une fonction async complexe avec
> Chrome DevTools (breakpoints async). Au prochain screencast, on change
> complètement de registre : **le Garbage Collector** !

## Points d'attention pour l'enregistrement
- L'exemple `return` vs `return await` est le moment le plus important — bien le préparer
- Montrer le parallèle générateur/async-await rapidement, sans s'y attarder
- Les puzzles d'ordonnancement doivent être résolus à voix haute, pas juste montrés
- S'assurer que le fichier de démo est prêt et testé avant l'enregistrement
- Ne pas oublier de mentionner `Promise.all` pour la parallélisation
- Montrer les async stack traces dans DevTools si le temps le permet
