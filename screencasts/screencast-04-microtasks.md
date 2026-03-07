# Screencast 04 — Microtâches vs Macrotâches

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/04-microtasks-macrotasks.md`
- **Lab associé** : `labs/lab-04-microtask-macrotask/`
- **Prérequis** : Modules 00-03 terminés, compréhension des phases de l'event loop

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Éditeur de code avec `labs/lab-04-microtask-macrotask/exercise.js`
- [ ] Fichier `labs/lab-04-microtask-macrotask/walkthrough.js` prêt
- [ ] Papier ou tableau blanc pour dessiner les queues (optionnel mais recommandé)

## Script

### [00:00-01:30] Introduction — Pourquoi distinguer micro et macro ?

> Bienvenue dans le module 04. Au module précédent, on a vu la règle d'or :
> les microtâches passent avant les macrotâches. Mais pourquoi cette distinction
> existe-t-elle, et quelles sont les conséquences pratiques ?
>
> Dans ce screencast, on va aller au fond du sujet. On va résoudre des **puzzles
> d'ordonnancement** qui mettent en difficulté même les développeurs expérimentés.
> Et surtout, on va apprendre une technique pour ne plus jamais se tromper :
> la méthode **"dessine les queues"**.

### [01:30-04:00] Concept clé — Les deux queues et la priorité de nextTick

> Commençons par bien définir les termes.
>
> **Microtâches** : callbacks planifiés via `Promise.then()`, `Promise.catch()`,
> `Promise.finally()`, `queueMicrotask()`, et `process.nextTick()`.
> Elles sont exécutées **immédiatement après** que la call stack est vide,
> avant de passer à la phase suivante de l'event loop.
>
> **Macrotâches** : callbacks planifiés via `setTimeout()`, `setInterval()`,
> `setImmediate()`, les callbacks I/O (réseau, fichiers), les événements DOM.
> Elles sont exécutées **une par une** lors des phases de l'event loop.

**Action** : Afficher un schéma avec deux colonnes : microtask queue et macrotask queue.

> Il y a une subtilité importante dans Node.js : `process.nextTick` a sa propre
> queue, qui est vidée **avant** la queue de microtâches standard.
>
> Donc l'ordre précis est :
> 1. Code synchrone (call stack)
> 2. Queue `process.nextTick`
> 3. Queue microtâches (Promises)
> 4. Une macrotâche de la phase courante
> 5. Retour à l'étape 2 (vidange des microtâches entre chaque macrotâche)

> Depuis Node.js 11, le comportement est aligné avec les navigateurs :
> les microtâches sont vidées **entre chaque macrotâche**, pas seulement entre
> chaque phase. C'est un changement subtil mais important.

### [04:00-08:00] Démonstration pratique — Les puzzles d'ordonnancement

> Ouvrons le lab et attaquons les puzzles.

**Action** : Ouvrir `labs/lab-04-microtask-macrotask/exercise.js`.

> L'exercice contient plusieurs snippets. Pour chacun, vous devez prédire
> l'ordre exact d'affichage. Commençons par le premier.

**Action** : Afficher le snippet 1 et résoudre ensemble.

```javascript
console.log("1 - sync");
setTimeout(() => console.log("2 - timeout"), 0);
Promise.resolve().then(() => console.log("3 - promise"));
process.nextTick(() => console.log("4 - nextTick"));
console.log("5 - sync");
```

> Appliquez la méthode : d'abord le synchrone, puis nextTick, puis Promises,
> puis macrotâches. Réponse attendue : 1, 5, 4, 3, 2.

**Commande** :
```bash
node -e "console.log('1');setTimeout(()=>console.log('2'),0);Promise.resolve().then(()=>console.log('3'));process.nextTick(()=>console.log('4'));console.log('5')"
```

> Parfait. Maintenant un cas plus complexe avec des microtâches imbriquées.

**Action** : Afficher le snippet 2 (microtâches qui planifient d'autres microtâches).

```javascript
Promise.resolve().then(() => {
  console.log("A");
  Promise.resolve().then(() => console.log("B"));
});
Promise.resolve().then(() => console.log("C"));
```

> Réponse : A, C, B. Pourquoi ? Parce que le `.then` de A et C sont dans la même
> "vague" de microtâches. Quand A s'exécute, il planifie B dans la queue.
> Mais C est déjà dans la queue et passe en premier. B s'exécute ensuite.

**Commande** :
```bash
node -e "Promise.resolve().then(()=>{console.log('A');Promise.resolve().then(()=>console.log('B'))});Promise.resolve().then(()=>console.log('C'))"
```

> C'est la clé : les microtâches ajoutées **pendant** le vidage de la queue
> sont traitées dans **la même vague**, mais après celles déjà en attente.

### [08:00-11:00] Walkthrough guidé — Dessiner les queues

> Ouvrons maintenant le fichier walkthrough pour une approche pas à pas.

**Action** : Ouvrir `labs/lab-04-microtask-macrotask/walkthrough.js`.

```bash
node labs/lab-04-microtask-macrotask/walkthrough.js
```

> Ce fichier exécute un scénario complexe et affiche, à chaque étape,
> l'état des queues. C'est la technique **"dessine les queues"** en action.

**Action** : Commenter la sortie étape par étape.

> Voici comment appliquer cette technique vous-même :
>
> 1. Prenez une feuille (ou un fichier texte).
> 2. Dessinez trois colonnes : **nextTick** | **Microtasks** | **Macrotasks**
> 3. Parcourez le code ligne par ligne.
> 4. Pour chaque appel asynchrone, placez le callback dans la bonne colonne.
> 5. Quand le code synchrone est fini, videz les colonnes dans l'ordre : nextTick → micro → 1 macro.
> 6. Recommencez à l'étape 4 avec le code du callback en cours.
>
> Avec de la pratique, vous n'aurez plus besoin de la feuille — le raisonnement
> deviendra automatique.

### [11:00-14:00] Récap — Le danger de la famine (starvation)

> Récapitulons et parlons d'un danger réel : la **famine de macrotâches** (starvation).

```javascript
function floodMicrotasks() {
  Promise.resolve().then(() => {
    // Du travail...
    floodMicrotasks(); // Relance une microtâche
  });
}
floodMicrotasks();
setTimeout(() => console.log("Je ne s'afficherai JAMAIS"), 0);
```

> Ce code crée une boucle infinie de microtâches. Le `setTimeout` ne s'exécutera
> **jamais** parce que l'event loop ne passera jamais à la phase Timers — il sera
> bloqué indéfiniment dans le vidage de la queue de microtâches.
>
> C'est un problème réel en production. Si une Promise chaîne indéfiniment,
> vos timers, vos callbacks I/O, et tout le reste sont bloqués.
>
> **Règle pratique** : ne laissez jamais une récursion de microtâches sans condition d'arrêt.
> Si vous avez beaucoup de travail à distribuer, utilisez `setImmediate()` pour
> le découper en macrotâches et laisser respirer l'event loop.

**Action** : Mentionner le quiz du module 04.

> Le quiz de ce module est un ensemble de puzzles d'ordonnancement.
> Appliquez la méthode "dessine les queues" pour chaque question.
> Au prochain screencast, on implémente notre propre **Promise** from scratch !

## Points d'attention pour l'enregistrement
- Exécuter chaque snippet en live pour vérifier les prédictions — l'effet "a-ha" est important
- Prendre le temps de dessiner les queues à l'écran (tableau blanc virtuel ou papier)
- Bien distinguer nextTick (propre à Node.js) de queueMicrotask (standard W3C)
- L'exemple de starvation doit être montré brièvement (ne PAS laisser tourner trop longtemps)
- Couper le processus avec Ctrl+C si l'exemple de starvation tourne trop longtemps
- S'assurer que le walkthrough.js est commenté et lisible à l'écran
