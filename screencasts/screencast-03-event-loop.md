# Screencast 03 — La Boucle d'Événements

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/03-event-loop.md`
- **Lab associé** : `labs/lab-03-event-loop-order/`
- **Prérequis** : Modules 00-02 terminés, compréhension de la call stack

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Navigateur ouvert sur `visualizations/event-loop.html`
- [ ] Éditeur de code avec `labs/lab-03-event-loop-order/exercise.js`
- [ ] Schéma des 6 phases de l'event loop prêt à afficher

## Script

### [00:00-01:30] Introduction — Single-threaded mais non-bloquant

> Bienvenue dans le module 03, probablement le plus important de tout ce cours.
> On entend souvent que JavaScript est **single-threaded mais non-bloquant**.
> C'est une phrase qu'on répète comme un mantra, mais qu'est-ce que ça signifie
> concrètement ?
>
> JavaScript n'a **qu'un seul thread** pour exécuter votre code. Il n'y a qu'une
> seule call stack, qu'une seule instruction exécutée à la fois. Pourtant,
> Node.js peut gérer des milliers de connexions simultanées. Comment ?
>
> La réponse tient en trois mots : **la boucle d'événements** (event loop).
> C'est le mécanisme qui orchestre tout — et c'est ce qu'on va décortiquer aujourd'hui.

### [01:30-04:00] Concept clé — Les 6 phases de l'event loop Node.js

> L'event loop de Node.js (basée sur **libuv**) est divisée en **6 phases**.
> Chaque phase a sa propre file d'attente de callbacks.

**Action** : Afficher le schéma des 6 phases.

> Voici les phases, dans l'ordre :
>
> 1. **Timers** — Exécute les callbacks de `setTimeout()` et `setInterval()`
>    dont le délai est écoulé.
> 2. **Pending callbacks** — Exécute les callbacks d'opérations système reportées
>    (certaines erreurs TCP, par exemple).
> 3. **Idle, prepare** — Phases internes à Node.js, vous n'interagissez pas directement avec.
> 4. **Poll** — Récupère les nouveaux événements I/O. C'est ici que Node.js
>    passe le plus de temps. Si la queue est vide, il attend de nouveaux événements.
> 5. **Check** — Exécute les callbacks de `setImmediate()`.
> 6. **Close callbacks** — Exécute les callbacks de fermeture (`socket.on('close', ...)`).
>
> Entre chaque phase, Node.js vide la queue de **microtâches** (`Promise.then`,
> `process.nextTick`). C'est un point crucial qu'on approfondira au module 04.

**Action** : Souligner la flèche circulaire entre les phases.

> L'event loop **tourne en boucle** à travers ces phases tant qu'il y a du travail
> à faire. Quand toutes les queues sont vides et qu'il n'y a plus d'opérations I/O
> en attente, le processus se termine.

### [04:00-08:00] Démonstration pratique — Le lab event loop

> Ouvrons le lab et voyons l'event loop en action.

**Action** : Ouvrir `labs/lab-03-event-loop-order/exercise.js`.

> Ce fichier contient un mélange de `setTimeout`, `setImmediate`, `Promise.resolve().then`,
> `process.nextTick`, et du code synchrone. L'exercice vous demande de **prédire
> l'ordre d'affichage** avant de lancer le script.

**Action** : Laisser un moment pour que le spectateur réfléchisse.

> Faisons-le ensemble. Le code synchrone s'exécute d'abord, toujours.
> Ensuite, `process.nextTick` passe avant les Promises.
> Les Promises (microtâches) passent avant les macrotâches.
> `setTimeout(..., 0)` et `setImmediate` ont un ordre qui dépend du contexte...

**Commande** :
```bash
node labs/lab-03-event-loop-order/exercise.js
```

> Vérifions nos prédictions. [Commenter les résultats ligne par ligne.]
>
> L'ordre surprend souvent les développeurs. La clé, c'est de toujours penser
> en termes de **phases** et de **queues de priorité**.

**Action** : Relancer le script 2-3 fois pour montrer que l'ordre est déterministe
(sauf pour le cas `setTimeout(0)` vs `setImmediate` hors callback I/O).

```bash
node labs/lab-03-event-loop-order/exercise.js
node labs/lab-03-event-loop-order/exercise.js
```

> Notez : quand `setTimeout(fn, 0)` et `setImmediate(fn)` sont appelés dans le
> contexte principal (hors callback I/O), l'ordre peut varier. Mais à l'intérieur
> d'un callback I/O, `setImmediate` passe **toujours** avant `setTimeout`.

### [08:00-11:00] Visualisation interactive — event-loop.html

> Pour bien ancrer ces concepts, ouvrons la visualisation interactive.

**Action** : Ouvrir `visualizations/event-loop.html` dans le navigateur.

> Cette page vous permet de **sélectionner un scénario** et de voir, pas à pas,
> comment l'event loop traite chaque callback.
>
> Prenons le scénario "Mixed async" :

**Action** : Sélectionner le scénario et cliquer step par step.

> À chaque étape, observez :
> - **Quelle phase** de l'event loop est active (surlignée en couleur)
> - **Quelle queue** est en train d'être vidée
> - **Quel callback** est exécuté
> - **L'état de la call stack** à ce moment
>
> Ce qui est important, c'est de voir que les microtâches sont vidées
> **entre chaque phase**, pas à l'intérieur d'une phase. C'est un mécanisme
> de "flush" systématique.

**Action** : Montrer un deuxième scénario si le temps le permet.

> Essayons le scénario "I/O callback ordering" pour voir la différence
> entre `setImmediate` et `setTimeout` à l'intérieur d'un `fs.readFile`.

### [11:00-14:00] Récap — La règle d'or

> Récapitulons avec **la règle d'or** de l'ordonnancement :
>
> ```
> Synchrone → process.nextTick → Microtâches (Promises) → Macrotâches (timers, I/O, etc.)
> ```
>
> Ou en version longue :
> 1. Tout le code synchrone s'exécute en premier.
> 2. `process.nextTick` callbacks sont vidés.
> 3. La queue de microtâches (Promise.then, queueMicrotask) est vidée.
> 4. L'event loop passe à la phase suivante et exécute les macrotâches correspondantes.
> 5. Entre chaque macrotâche (depuis Node.js 11+), on revide les microtâches.
>
> Cette règle est votre boussole. Si vous la connaissez, vous pouvez prédire
> l'ordre d'exécution de n'importe quel code asynchrone.

**Action** : Mentionner le quiz du module 03.

> Le quiz de ce module est particulièrement important : il vous demandera
> de prédire l'ordre d'exécution de snippets. Prenez le temps de bien le faire.
>
> Au prochain screencast, on zoome sur les **microtâches vs macrotâches**
> avec des puzzles encore plus tordus. À tout de suite !

## Points d'attention pour l'enregistrement
- C'est LE module le plus important — prendre le temps de bien expliquer chaque phase
- Montrer le schéma des 6 phases pendant au moins 2 minutes
- Relancer le script plusieurs fois pour montrer le comportement de `setTimeout(0)` vs `setImmediate`
- S'assurer que la visualisation event-loop.html est fluide et sans bugs
- Bien insister sur le fait que les microtâches sont vidées ENTRE les phases
- La règle d'or doit rester affichée à l'écran pendant tout le récap
