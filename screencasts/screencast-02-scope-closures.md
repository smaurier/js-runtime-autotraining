# Screencast 02 — Scope, Closures & Mémoire

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/02-scope-closures-memory.md`
- **Lab associé** : `labs/lab-02-closure-memory/`
- **Prérequis** : Modules 00-01 terminés, Chrome DevTools (onglet Memory)

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Chrome DevTools prêts (onglets Console et Memory)
- [ ] Éditeur de code avec `labs/lab-02-closure-memory/exercise.js`
- [ ] Fichier de démonstration `var` vs `let` prêt

## Script

### [00:00-01:30] Introduction — Pourquoi les closures ?

> Bienvenue dans le module 02. Aujourd'hui on s'attaque à un sujet que beaucoup
> de développeurs JavaScript utilisent sans le comprendre pleinement : **les closures**.
>
> Une closure, ce n'est pas de la magie — c'est une conséquence directe de la façon
> dont JavaScript gère le **scope** (la portée des variables). Et une fois que vous
> comprenez le scope, les closures deviennent évidentes.
>
> Ce qui est moins évident, c'est l'impact des closures sur la **mémoire**.
> C'est là que ça devient intéressant — et c'est ce qu'on va voir dans le lab.

### [01:30-04:00] Concept clé — Lexical Scoping et chaîne de scope

> JavaScript utilise le **lexical scoping** (portée lexicale). Ça signifie que
> la portée d'une variable est déterminée par **où elle est déclarée dans le code source**,
> pas par où elle est appelée au runtime.

```javascript
function outer() {
  const message = "Hello";
  function inner() {
    console.log(message); // inner "voit" message grâce au lexical scoping
  }
  return inner;
}
const fn = outer();
fn(); // "Hello" — même si outer() a fini son exécution !
```

> Quand `outer()` retourne, son contexte d'exécution est dépilé de la call stack.
> Mais `inner` garde une **référence** vers l'environnement lexical de `outer`.
> C'est ça, une closure : **une fonction + son environnement lexical capturé**.
>
> En interne, V8 stocke cette référence dans un champ appelé `[[Environment]]`
> sur l'objet fonction. La **chaîne de scope** est la suite de ces environnements
> imbriqués, jusqu'à l'environnement global.

**Action** : Dessiner la chaîne de scope : `inner → outer environment → global environment`.

### [04:00-08:00] Démonstration pratique — Le piège var/let dans les boucles

> Passons au lab. Mais d'abord, un classique qu'il faut absolument maîtriser.

**Action** : Taper en live dans l'éditeur.

```javascript
// Piège classique avec var
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log("var:", i), 100);
}
// Affiche : var: 3, var: 3, var: 3

// Solution avec let
for (let j = 0; j < 3; j++) {
  setTimeout(() => console.log("let:", j), 100);
}
// Affiche : let: 0, let: 1, let: 2
```

**Commande** :
```bash
node -e "for(var i=0;i<3;i++){setTimeout(()=>console.log('var:',i),100)} for(let j=0;j<3;j++){setTimeout(()=>console.log('let:',j),100)}"
```

> Pourquoi cette différence ? Avec `var`, il n'y a **qu'une seule variable `i`**
> dans le scope de la fonction englobante. Les trois closures capturent la même variable,
> et quand les setTimeout s'exécutent, `i` vaut déjà 3.
>
> Avec `let`, une **nouvelle variable `j`** est créée à chaque itération de la boucle.
> Chaque closure capture sa propre copie. C'est le block scoping en action.

**Action** : Ouvrir le lab-02.

```bash
node labs/lab-02-closure-memory/exercise.js
```

> L'exercice vous demandé d'identifier pourquoi un tableau grandit en mémoire
> à cause d'une closure qui retient des références inutiles.

### [08:00-11:00] Approfondissement — Inspecter [[Scopes]] dans DevTools

> On peut **voir** les closures dans Chrome DevTools. Ouvrons la console.

**Action** : Dans Chrome DevTools, taper :

```javascript
function createCounter() {
  let count = 0;
  return function increment() {
    return ++count;
  };
}
const counter = createCounter();
console.dir(counter);
```

> Développez l'objet affiché. Vous voyez la propriété `[[Scopes]]`.
> À l'intérieur, il y à un objet **Closure** qui contient `count: 0`.
> C'est la preuve concrète que la variable est capturée.
>
> Maintenant, appelons `counter()` trois fois et refaisons `console.dir(counter)`.
> `count` est passé à 3 dans le scope capturé.

**Action** : Exécuter `counter(); counter(); counter(); console.dir(counter);`

> C'est un outil puissant pour débugger. Si vous soupçonnez une fuite mémoire
> liée à une closure, `console.dir` sur la fonction suspecte vous montrera
> exactement ce qu'elle retient.

**Action** : Ouvrir l'onglet Memory de DevTools, prendre un heap snapshot.

> Dans le heap snapshot, on peut filtrer par "Closure" pour voir toutes les closures
> en mémoire et la taille de ce qu'elles retiennent. C'est essentiel pour le débogage
> de fuites mémoire en production.

### [11:00-14:00] Récap — Quand les closures causent des problèmes

> Récapitulons :
>
> 1. Le **lexical scoping** détermine la portée à l'écriture du code, pas à l'exécution.
> 2. Une **closure** = une fonction + son `[[Environment]]` capturé.
> 3. La **chaîne de scope** remonte d'environnement en environnement jusqu'au global.
> 4. `var` crée une variable par scope de fonction, `let`/`const` par bloc.
>
> **Quand les closures posent problème** :
> - Quand une closure retient un **gros objet** alors qu'elle n'en a besoin que d'une
>   petite partie. V8 est intelligent et ne capture que les variables réellement
>   utilisées, mais avec `eval()` dans le scope, il est forcé de tout capturer.
> - Quand des **event listeners** ne sont jamais supprimés et gardent leurs closures.
> - Quand on accumule des closures dans un **tableau** ou une **Map** sans jamais les nettoyer.

**Action** : Mentionner le quiz et la transition vers le module 03.

> Faites le quiz du module 02, et terminez l'exercice du lab sur la fuite mémoire.
> Au prochain screencast, on passe à un sujet majeur : **la boucle d'événements** !

## Points d'attention pour l'enregistrement
- Le piège var/let est un classique : bien prendre le temps de l'expliquer pas à pas
- Zoomer sur le panneau [[Scopes]] dans DevTools pour que ce soit bien lisible
- S'assurer que le heap snapshot est pré-chargé ou rapide à générer
- Ne pas confondre "scope" et "contexte d'exécution" — les distinguer clairement
- Préparer l'exemple `console.dir` à l'avance pour éviter les typos en live
