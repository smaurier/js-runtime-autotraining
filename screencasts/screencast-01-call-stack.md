# Screencast 01 — Call Stack & Contextes d'exécution

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/01-call-stack-execution-context.md`
- **Lab associé** : `labs/lab-01-call-stack-observation/`
- **Prérequis** : Module 00 terminé, Node.js >= 20, Chrome DevTools

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Navigateur ouvert sur `visualizations/call-stack.html`
- [ ] Éditeur de code avec `labs/lab-01-call-stack-observation/exercise.js`
- [ ] Chrome DevTools prêts (onglet Sources pour les breakpoints)

## Script

### [00:00-01:30] Introduction — Qu'est-ce que la Call Stack ?

> Bienvenue dans le module 01. Aujourd'hui on parle de la **Call Stack** —
> la pile d'appels — qui est probablement la structure de données la plus
> fondamentale pour comprendre comment JavaScript exécute votre code.
>
> Vous avez certainement déjà vu une stack trace dans une erreur.
> Ce que vous voyez à ce moment-là, c'est littéralement un instantané de la call stack.
> Aujourd'hui, on va comprendre exactement **comment cette pile fonctionne**.

**Action** : Montrer un exemple rapide d'erreur avec stack trace dans le terminal.

```bash
node -e "function a() { b(); } function b() { c(); } function c() { throw new Error('boom'); } a();"
```

> Vous voyez ? `c` appelée par `b`, appelée par `a`. C'est la call stack, lue de haut en bas.

### [01:30-04:00] Concept clé — LIFO et Contexte d'exécution

> La call stack fonctionne en mode **LIFO** — Last In, First Out.
> Quand une fonction est appelée, un **contexte d'exécution** est empilé.
> Quand elle retourne, ce contexte est dépilé.
>
> Chaque contexte d'exécution contient trois composants :
>
> 1. **LexicalEnvironment** — les liaisons `let`, `const`, les déclarations de fonctions.
> 2. **VariableEnvironment** — les liaisons `var` (historiquement séparé du LexicalEnvironment).
> 3. **ThisBinding** — la valeur de `this` dans ce contexte.
>
> Le premier contexte empilé est toujours le **Global Execution Context**.
> Il est créé avant même que votre première ligne ne s'exécute.

**Action** : Schéma de la pile avec Global EC en bas, puis des frames empilées.

> Quand V8 rencontre un appel de fonction, il :
> 1. Crée un nouveau contexte d'exécution
> 2. L'empile sur la call stack
> 3. Exécute le corps de la fonction
> 4. Dépile le contexte quand la fonction retourne
>
> Si la pile devient trop profonde, on obtient un **stack overflow** — une erreur
> que vous avez sûrement déjà rencontrée avec une récursion infinie.

### [04:00-08:00] Démonstration pratique — Le lab call stack

> Ouvrons le lab du module 01.

**Action** : Ouvrir `labs/lab-01-call-stack-observation/exercise.js` dans l'éditeur.

> Ce fichier contient plusieurs fonctions qui s'appellent mutuellement.
> L'exercice vous demande de **prédire l'état de la call stack** à différents
> moments de l'exécution, puis de vérifier avec `console.trace()`.

**Commandes à exécuter** :
```bash
node labs/lab-01-call-stack-observation/exercise.js
```

> Regardez la sortie. Chaque `console.trace()` nous donne un instantané de la pile.
> Comparons avec nos prédictions...

**Action** : Commenter les résultats ligne par ligne.

> Maintenant, ajoutons un breakpoint dans Chrome DevTools pour voir la pile
> en temps réel.

**Action** : Ouvrir Chrome, `chrome://inspect`, lancer :
```bash
node --inspect-brk labs/lab-01-call-stack-observation/exercise.js
```

> Dans le panneau Sources de DevTools, on voit la call stack à droite.
> En cliquant sur step-over (F10), on peut avancer instruction par instruction
> et observer les contextes s'empiler et se dépiler.

### [08:00-11:00] Visualisation interactive — call-stack.html

> Pour mieux comprendre, ouvrons la visualisation interactive.

**Action** : Ouvrir `visualizations/call-stack.html` dans le navigateur.

> Cette page simule l'exécution d'un appel récursif — le calcul de **factorielle**.
> À chaque clic sur "Step", un nouveau frame est empilé.
>
> Observez :
> - Le **Global EC** reste toujours en bas de la pile.
> - Chaque appel `factorial(n)` crée un nouveau frame avec sa propre valeur de `n`.
> - Quand `n === 0`, la récursion s'arrête et les frames commencent à se dépiler.
> - La valeur de retour est propagée frame par frame.

**Action** : Cliquer step par step, commenter chaque frame.

> Essayons avec `factorial(5)` : on voit 6 frames empilées (de `factorial(5)` à `factorial(0)`).
> C'est pour ça qu'une récursion infinie explose — la pile a une taille maximale
> (environ 10 000-15 000 frames dans V8, selon la complexité de chaque frame).

### [11:00-14:00] Récap — Hoisting, TDZ et Stack Overflow

> Récapitulons et abordons trois conséquences importantes de ce qu'on a vu :
>
> **1. Le Hoisting** — Lors de la phase de création du contexte d'exécution,
> les déclarations `var` sont initialisées à `undefined` et les déclarations
> de fonctions sont entièrement disponibles. C'est le "hoisting".
>
> **2. La Temporal Dead Zone (TDZ)** — Les variables `let` et `const` sont
> hoistées aussi, mais ne sont pas initialisées. Accéder à une variable dans
> sa TDZ lance une `ReferenceError`.

```javascript
console.log(x); // undefined (var est hoistée + initialisée)
console.log(y); // ReferenceError (let est dans la TDZ)
var x = 1;
let y = 2;
```

> **3. Le Stack Overflow** — Quand la pile dépasse sa taille maximale.
> La solution classique : transformer la récursion en itération,
> ou utiliser la technique du trampoline.

**Action** : Mentionner le quiz du module 01.

> Avant de passer au module 02, faites le quiz et essayez de compléter
> l'exercice bonus du lab : prédire la stack trace exacte d'un appel
> à 4 niveaux de profondeur. On se retrouve au prochain screencast
> pour parler de **scope et closures** !

## Points d'attention pour l'enregistrement
- Lancer `node --inspect-brk` avant de démarrer l'enregistrement pour éviter les temps de chargement
- S'assurer que la visualisation call-stack.html fonctionne sans erreurs
- Zoomer sur le panneau Call Stack de DevTools pour qu'il soit bien lisible
- Bien distinguer "phase de création" et "phase d'exécution" du contexte
- Préparer un exemple de stack overflow (récursion infinie) à montrer rapidement
