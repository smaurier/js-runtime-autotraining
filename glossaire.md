# Glossaire

Termes clés utilisés tout au long de la formation, classés par ordre alphabétique.

---

## A

### AST (Abstract Syntax Tree) {#ast}
Représentation arborescente du code source après parsing. Le parser transforme le code en AST, qui est ensuite utilisé par Ignition pour générer du bytecode.

### Async/Await {#async-await}
Sucre syntaxique pour les Promises. `async` fait retourner une Promise, `await` suspend l'exécution et programme la reprise comme microtask.

## B

### Bytecode {#bytecode}
Code intermédiaire généré par Ignition (l'interpréteur V8). Plus compact que le code source, mais pas encore du code machine.

## C

### Call Stack {#call-stack}
Pile LIFO (Last In, First Out) qui enregistre les frames d'exécution des fonctions. Chaque appel de fonction empile un frame, chaque retour le dépile.

### Closure {#closure}
Fonction qui capture les variables de son scope lexical englobant. La closure maintient une référence vers le `LexicalEnvironment` parent, ce qui peut empêcher le garbage collector de libérer ces variables.

### Context (Exécution Context) {#exécution-context}
Structure créée par V8 à chaque appel de fonction, contenant le `LexicalEnvironment`, le `VariableEnvironment`, le `this` binding et la référence au scope externe.

## D

### Deoptimization {#deoptimization}
Processus par lequel TurboFan abandonne le code machine optimisé et revient au bytecode Ignition, typiquement quand une hypothèse spéculative (type, forme d'objet) est invalidée à l'exécution.

## E

### Éléments Kinds {#éléments-kinds}
Classification interne de V8 pour les tableaux selon le type de leurs éléments (`PACKED_SMI_ELEMENTS`, `PACKED_DOUBLE_ELEMENTS`, `PACKED_ELEMENTS`, `HOLEY_*`). Les transitions vont du plus spécifique au plus générique et sont irréversibles.

### Escape Analysis {#escape-analysis}
Optimisation de TurboFan qui détermine si un objet peut être alloué sur la pile (stack) plutôt que sur le heap, évitant ainsi l'allocation heap et la pression sur le GC.

### Event Loop {#event-loop}
Boucle principale du runtime JavaScript qui orchestre l'exécution du code synchrone, des microtasks et des macrotasks. Elle vérifie la call stack, vide la file de microtasks, puis traite la prochaine macrotask.

### Exécution Context {#context}
Voir [Context (Exécution Context)](#execution-context).

## F

### Feedback Vector {#feedback-vector}
Structure de données attachée à chaque fonction dans V8 qui collecte des informations de type à l'exécution (profiling). Ces données guident les optimisations spéculatives de TurboFan.

### FinalizationRegistry {#finalizationregistry}
API ES2021 permettant d'enregistrer un callback qui sera appelé quand un objet est collecté par le garbage collector. Utile pour le nettoyage de ressources externes.

## G

### Garbage Collector {#garbage-collector}
Mécanisme automatique de libération de la mémoire. V8 utilise un GC générationnel avec Scavenger (Young Génération) et Mark-Compact (Old Génération), orchestré par Orinoco.

### Generational GC {#generational-gc}
Stratégie de garbage collection basée sur l'hypothèse générationnelle : la plupart des objets meurent jeunes. V8 sépare le heap en Young Génération (collecte fréquente, rapide) et Old Génération (collecte rare, plus coûteuse).

## H

### Heap {#heap}
Zone de mémoire dynamique ou sont alloués les objets JavaScript. Divisé en Young Génération (nursery + intermediate) et Old Génération dans V8.

### Hidden Class (Map) {#hidden-class}
Structure interne de V8 (appelée « Map ») qui décrit la forme d'un objet : quelles propriétés il possède, à quels offsets elles se trouvent, et quel est leur type. Les objets de même forme partagent la même Map.

### Hoisting {#hoisting}
Comportement par lequel les déclarations `var` et `function` sont « remontées » au début de leur scope lors de la phase de création du contexte d'exécution. `let` et `const` sont hissés mais restent dans la TDZ.

## I

### Ignition {#ignition}
Interpréteur bytecode de V8. Il compile l'AST en bytecode compact et l'exécute, tout en collectant le feedback de type via le Feedback Vector.

### Inline Cache (IC) {#inline-cache}
Mécanisme de cache au niveau des sites d'appel qui mémorise la Map (hidden class) des objets accédés. Passe par les états : uninitialized, monomorphic, polymorphic, megamorphic.

### Inlining {#inlining}
Optimisation du compilateur JIT qui remplace un appel de fonction par le corps de la fonction appelée, éliminant le coût de l'appel et permettant d'autres optimisations.

## J

### JIT Compilation {#jit}
Compilation Just-In-Time : compilation du bytecode en code machine natif pendant l'exécution. V8 utilise un pipeline à plusieurs niveaux (Sparkplug, Maglev, TurboFan), chaque niveau produisant du code plus optimisé.

## L

### LexicalEnvironment {#lexical-environment}
Composant de l'Exécution Context qui contient les liaisons (bindings) `let`, `const` et des fonctions déclarées. Forme une chaîne avec les environnements parents pour la résolution des variables.

## M

### Macrotask {#macrotask}
Tâche planifiée via `setTimeout`, `setInterval`, `setImmediate` ou les callbacks I/O. Une seule macrotask est traitée par itération de l'event loop, suivie du vidage complet de la file de microtasks.

### Maglev {#maglev}
Compilateur JIT de niveau intermédiaire dans V8, situé entre Sparkplug et TurboFan. Il produit du code plus optimisé que Sparkplug mais compile plus vite que TurboFan.

### Mark-and-Sweep {#mark-and-sweep}
Algorithme de garbage collection en deux phases : (1) marquer tous les objets atteignables depuis les racines (GC roots), (2) libérer la mémoire des objets non marqués.

### Microtask {#microtask}
Tâche de haute priorité planifiée via `Promise.then()`, `queueMicrotask()` ou `process.nextTick()` (Node.js). La file de microtasks est entièrement vidée après chaque tâche synchrone et entre chaque macrotask.

## N

### Node.js {#nodejs}
Runtime JavaScript côté serveur basé sur V8. Ajoute des APIs système (fichiers, réseau, processus) et utilise libuv pour l'event loop et le thread pool.

## O

### Orinoco {#orinoco}
Nom du projet de garbage collector de V8 qui regroupe les techniques de collecte concurrente, incrémentale et parallèle pour minimiser les pauses.

## P

### process.nextTick {#process-nexttick}
API Node.js qui planifie un callback avant toutes les autres microtasks, dans une file dédiée vidée en priorité. Peut causer du starvation si utilisé de manière récursive.

### Promise {#promise}
Objet représentant le résultat éventuel d'une opération asynchrone. Passe par trois états : `pending`, `fulfilled`, `rejected`. Les callbacks `.then()` sont planifiés comme microtasks.

## Q

### queueMicrotask {#queuemicrotask}
API standard (navigateur et Node.js) pour planifier une microtask. Équivalent à `Promise.resolve().then(callback)` mais plus explicite et légèrement plus performant.

## R

### Realm {#realm}
Environnement d'exécution JavaScript isolé avec ses propres globaux (`Object`, `Array`, etc.). Chaque iframe dans un navigateur ou chaque `vm.Context` dans Node.js crée un nouveau Realm.

## S

### Scavenger {#scavenger}
Algorithme de garbage collection utilisé pour la Young Génération dans V8. Utilise un espace semi-space (from-space / to-space) et copie les objets survivants, ce qui est très rapide pour les collectes fréquentes.

### Scope Chain {#scope-chain}
Chaîne de LexicalEnvironments reliant un scope à ses scopes englobants. Utilisée pour la résolution des variables : V8 remonte la chaîne jusqu'à trouver la liaison ou atteindre le scope global.

### setImmediate {#setimmediate}
API Node.js qui planifie un callback dans la phase `check` de l'event loop libuv, après la phase I/O poll. Plus prévisible que `setTimeout(fn, 0)` pour l'exécution après I/O.

### setTimeout {#settimeout}
API qui planifie un callback comme macrotask après un délai minimum (pas exact). Le callback est placé dans la file `timers` de l'event loop.

### SharedArrayBuffer {#sharedarraybuffer}
Buffer de mémoire partagée entre le thread principal et les Worker Threads. Nécessite `Atomics` pour la synchronisation et éviter les data races.

### Sparkplug {#sparkplug}
Compilateur non-optimisant de V8, situé entre Ignition et Maglev. Compile le bytecode en code machine de manière rapide sans optimisations spéculatives, servant de baseline compiler.

### Stack Overflow {#stack-overflow}
Erreur survenant quand la call stack dépasse sa taille maximale, typiquement à cause d'une récursion infinie. V8 lance une `RangeError: Maximum call stack size exceeded`.

### Starvation {#starvation}
Situation où une file de tâches (macrotasks, rendu) n'est jamais traitée car la file de microtasks est continuellement alimentée de manière récursive, monopolisant l'event loop.

## T

### TDZ (Temporal Dead Zone) {#tdz}
Zone temporelle entre le début du scope et l'initialisation d'une variable `let` ou `const`. Tout accès à la variable dans cette zone provoque une `ReferenceError`.

### Thenable {#thenable}
Objet possédant une méthode `.then()`. Les Promises peuvent « absorber » un thenable via le mécanisme de résolution, permettant l'interopérabilité entre différentes implémentations de Promises.

### Thread Pool {#thread-pool}
Pool de threads (4 par défaut dans libuv/Node.js) utilisé pour les opérations bloquantes (I/O fichier, DNS, crypto, zlib). Les résultats sont renvoyés vers l'event loop via des callbacks.

### Tri-color Marking {#tri-color}
Technique de marquage utilisée par le GC ou les objets sont colorés en blanc (non visité), gris (visité mais enfants non traités) et noir (visité et enfants traités). Permet un marquage incrémental et concurrent.

### TurboFan {#turbofan}
Compilateur JIT optimisant de V8. Utilise le feedback de type collecté par Ignition pour générer du code machine hautement optimisé avec des optimisations spéculatives (inlining, escape analysis, etc.).

## V

### V8 {#v8}
Moteur JavaScript open-source développé par Google, utilisé dans Chrome et Node.js. Comprend un parser, un interpréteur (Ignition), plusieurs compilateurs JIT (Sparkplug, Maglev, TurboFan) et un garbage collector (Orinoco).

## W

### WeakMap {#weakmap}
Collection clé-valeur ou les clés sont des objets tenus faiblement : elles n'empêchent pas le garbage collector de collecter l'objet clé. Utile pour associer des métadonnées à des objets sans créer de fuite mémoire.

### WeakRef {#weakref}
Référence faible vers un objet qui n'empêche pas sa collecte par le GC. Permet de mettre en cache des objets coûteux tout en laissant le GC les libérer si la mémoire est insuffisante.

### Worker Threads {#worker-threads}
API Node.js (`worker_threads`) permettant d'exécuter du JavaScript dans des threads séparés avec leur propre V8 isolate. Communiquent via `MessagePort` ou `SharedArrayBuffer`.
