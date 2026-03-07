# Module 01 — Call Stack & Contextes d'exécution

> **Difficulté** : ⭐⭐ (Intermédiaire)
>
> **Objectif** : Comprendre en profondeur ce qu'est la pile d'appels (call stack), comment les contextes d'exécution sont créés, structurés et détruits, et pourquoi le hoisting n'est pas un "déplacement de déclarations" mais une conséquence directe de la phase de création.

---

## Prérequis

- Savoir écrire et exécuter du JavaScript (Node.js ou navigateur)
- Connaître la syntaxe des fonctions (déclarations, expressions, arrow functions)
- Avoir une notion de ce qu'est une "pile" (stack) en structure de données

> 💡 **Pas de panique** : si tu n'es pas encore à l'aise avec tout ça, ce module est justement là pour construire ces bases. On va commencer doucement avec une image concrète, et monter en complexité progressivement. Chaque concept nouveau est expliqué au moment où il apparaît.

---

## Théorie

### 1. La pile d'appels : commençons par une image

Avant d'entrer dans la technique, prenons une image du monde réel.

**La call stack, c'est comme une pile d'assiettes dans un restaurant.** Le plongeur empile les assiettes propres les unes sur les autres. Quand un serveur a besoin d'une assiette, il prend toujours celle du **dessus** — jamais celle du milieu ou du fond. Et quand le plongeur ajoute une assiette propre, il la pose toujours **au sommet**.

C'est exactement le principe **LIFO** (Last In, First Out — "dernier entré, premier sorti") :

```
  Empiler           Dépiler
  (push)            (pop)

  ┌────────┐
  │ Assiette 3 │  ← la dernière posée est la première retirée
  ├────────┤
  │ Assiette 2 │
  ├────────┤
  │ Assiette 1 │  ← la première posée sera la dernière retirée
  └────────┘
```

En JavaScript, les "assiettes" sont des **appels de fonction**. Chaque fois que le moteur appelle une fonction, il "empile" cette fonction. Quand la fonction a fini son travail (elle retourne une valeur), le moteur "dépile" cette fonction et reprend là où il en était dans la fonction précédente.

### 2. La pile d'appels : définition technique

Maintenant qu'on a l'image en tête, voici la définition précise.

La **call stack** (pile d'appels) est une structure de données de type **LIFO** utilisée par le moteur JavaScript pour suivre l'exécution du programme. Chaque fois qu'une fonction est invoquée, un **stack frame** (cadre de pile — chaque appel de fonction crée le sien) est empilé. Quand la fonction retourne, le cadre est dépilé.

Le moteur JavaScript est **mono-threadé** (il ne fait qu'une seule chose à la fois) : il n'y a qu'**une seule call stack**. Cela signifie qu'à tout instant, une seule instruction est en cours d'exécution.

```
┌─────────────────────────────────────────────┐
│           CALL STACK (LIFO)                 │
│                                             │
│  ┌───────────────────────┐  ← sommet        │
│  │  multiply(a, b)       │  (en exécution)  │
│  ├───────────────────────┤                  │
│  │  square(n)            │                  │
│  ├───────────────────────┤                  │
│  │  printSquare(4)       │                  │
│  ├───────────────────────┤                  │
│  │  Global Execution Ctx │  ← base          │
│  └───────────────────────┘                  │
└─────────────────────────────────────────────┘
```

> 💡 **Rappel** : quand on dit "mono-threadé", ça veut dire que JavaScript ne peut traiter qu'**un seul morceau de code à la fois**. Il n'y a pas de parallélisme. C'est pour ça qu'une boucle infinie "gèle" la page web : la stack est occupée en permanence et rien d'autre ne peut s'exécuter.

### 3. Qu'est-ce qu'un contexte d'exécution ?

Un **Execution Context** (EC, ou contexte d'exécution) est une structure interne créée par le moteur JS à chaque invocation de code. Pense-le comme une "fiche descriptive" que le moteur crée pour savoir : quelles variables existent ici ? Quelle est la valeur de `this` ? Quel est le scope parent ?

Il existe trois types :

| Type | Créé quand... |
|------|---------------|
| **Global Execution Context** | Le script commence à s'exécuter |
| **Function Execution Context** | Une fonction est appelée |
| **Eval Execution Context** | `eval()` est invoqué (voir section dédiée plus bas) |

Chaque contexte d'exécution contient trois composants internes (définis dans la spécification ECMAScript) :

```
┌─────────────────────────────────────────────────┐
│          Execution Context                       │
│                                                  │
│  ┌────────────────────────────────────────┐      │
│  │  LexicalEnvironment                    │      │
│  │  - EnvironmentRecord (let, const, fn)  │      │
│  │  - outer: référence au scope parent    │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌────────────────────────────────────────┐      │
│  │  VariableEnvironment                   │      │
│  │  - EnvironmentRecord (var)             │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌────────────────────────────────────────┐      │
│  │  ThisBinding                           │      │
│  │  - valeur de `this` dans ce contexte   │      │
│  └────────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
```

> 💡 **Détail technique** : le **LexicalEnvironment** gère les déclarations `let`, `const` et les `function declarations`. Le **VariableEnvironment** gère les déclarations `var`. En pratique, ces deux concepts sont presque identiques, mais la spec les distingue pour gérer les subtilités de portée de `var` vs `let`/`const`.

### 4. Phase de création vs phase d'exécution

Chaque contexte d'exécution passe par **deux phases distinctes**. C'est l'un des concepts les plus importants de ce module.

#### Phase de création (Creation Phase)

Le moteur parcourt le code **sans l'exécuter** et :

1. **Crée le LexicalEnvironment** :
   - Les déclarations `let` et `const` sont enregistrées mais restent dans la **Temporal Dead Zone** (TDZ — zone morte temporelle, c'est-à-dire que la variable existe mais toute tentative d'y accéder avant sa déclaration provoque une erreur) — elles existent mais ne sont pas accessibles.
   - Les déclarations de fonctions (`function declarations`) sont enregistrées **avec leur valeur** (la fonction entière).

2. **Crée le VariableEnvironment** :
   - Les déclarations `var` sont enregistrées avec la valeur `undefined`.

3. **Détermine la valeur de `this`** :
   - En mode global non-strict : `this` = objet global (`window` ou `globalThis`)
   - En mode strict : `this` = `undefined` (dans les fonctions)
   - Dans une méthode : `this` = l'objet appelant

#### Phase d'exécution (Execution Phase)

Le moteur exécute le code ligne par ligne. Les variables reçoivent leurs valeurs réelles, les expressions sont évaluées, les fonctions sont appelées.

```
Résumé visuel — avant / après :

AVANT (phase de création)          APRÈS (phase d'exécution)
┌────────────────────────┐         ┌────────────────────────┐
│ var a → undefined      │         │ var a → 42             │
│ let b → <TDZ>          │    →    │ let b → "hello"        │
│ foo → [Function: foo]  │         │ foo → [Function: foo]  │
└────────────────────────┘         └────────────────────────┘
   Le moteur "connaît" les             Les variables reçoivent
   déclarations, pas encore            leurs vraies valeurs.
   les valeurs.
```

### 5. Le hoisting expliqué correctement

Le "hoisting" (hissage) n'est **PAS** un mécanisme qui "déplace les déclarations en haut du scope". C'est une **conséquence de la phase de création** : puisque le moteur enregistre les déclarations avant d'exécuter quoi que ce soit, tout se passe *comme si* les déclarations étaient "remontées" — mais en réalité, le code n'est jamais modifié.

```javascript
console.log(a);   // undefined (var → initialisé à undefined en phase de création)
console.log(b);   // ReferenceError: Cannot access 'b' before initialization (TDZ)
console.log(c);   // ReferenceError: Cannot access 'c' before initialization (TDZ)
console.log(foo); // [Function: foo] (déclaration de fonction → valeur complète en phase de création)
console.log(bar); // undefined (var bar = function... → bar est un var, pas une fn declaration)

var a = 1;
let b = 2;
const c = 3;
function foo() { return 'hello'; }
var bar = function() { return 'world'; };
```

Ce qui se passe en phase de création :

```
VariableEnvironment:
  a → undefined
  bar → undefined

LexicalEnvironment:
  b → <uninitialized>  (TDZ)
  c → <uninitialized>  (TDZ)
  foo → function foo() { return 'hello'; }
```

### 6. Structure d'un stack frame

> 💡 **Rappel** : un **stack frame** est la "fiche" qu'occupe chaque appel de fonction dans la pile. Il contient tout ce dont le moteur a besoin pour exécuter cette fonction et revenir à la fonction précédente une fois terminé.

Chaque stack frame stocke :

```
┌──────────────────────────────────────┐
│          Stack Frame                 │
│                                      │
│  - Pointeur de retour (return addr)  │
│  - Arguments de la fonction          │
│  - Variables locales                 │
│  - Contexte d'exécution associé      │
│  - Saved registers (interne moteur)  │
└──────────────────────────────────────┘
```

En V8 (le moteur de Chrome/Node.js), la pile est une zone mémoire contiguë. Chaque frame contient un **frame pointer** (fp) qui pointe vers le frame précédent, formant une liste chaînée implicite.

### 7. Stack Overflow

La call stack a une **taille limitée** (dépend du moteur et de l'OS, typiquement ~10 000 à ~25 000 frames dans V8). Un dépassement provoque une erreur `RangeError: Maximum call stack size exceeded`.

```javascript
// Stack overflow classique : récursion infinie
function infinite() {
  return infinite();
}
infinite(); // RangeError: Maximum call stack size exceeded
```

Pour reprendre notre analogie : c'est comme si on empilait tellement d'assiettes que la pile touche le plafond et s'écroule. Le moteur refuse d'empiler plus et lance une erreur.

#### Tail Call Optimization (TCO)

La spécification ES2015 (ES6) définit la **Proper Tail Calls** (PTC) : si l'appel récursif est en **position terminale** (tail position — c'est-à-dire que l'appel récursif est la toute dernière opération de la fonction, sans rien après), le moteur **réutilise** le stack frame courant au lieu d'en empiler un nouveau.

```javascript
// Appel en position terminale :
function factorial(n, acc = 1) {
  if (n <= 1) return acc;
  return factorial(n - 1, n * acc); // tail call : rien après l'appel
}

// PAS en position terminale :
function factorialBad(n) {
  if (n <= 1) return 1;
  return n * factorialBad(n - 1); // multiplication APRES l'appel récursif
}
```

**En pratique** : seul **Safari/JavaScriptCore** implémente la TCO. V8 (Chrome, Node.js) et SpiderMonkey (Firefox) ne l'implémentent **pas**, pour des raisons de débogage (les stack traces deviennent incompréhensibles avec la TCO). V8 avait un flag `--harmony-tailcalls` qui a été retiré.

```
                    SANS TCO                          AVEC TCO (Safari)
              ┌──────────────┐
              │ fact(1, 120) │
              ├──────────────┤               ┌──────────────┐
              │ fact(2, 60)  │               │ fact(5, 1)   │ ← réutilisé
              ├──────────────┤               │   → fact(4,5)│   à chaque
              │ fact(3, 20)  │               │   → fact(3,20)   appel
              ├──────────────┤               │   → fact(2,60)
              │ fact(4, 5)   │               │   → fact(1,120)
              ├──────────────┤               ├──────────────┤
              │ fact(5, 1)   │               │ Global EC    │
              ├──────────────┤               └──────────────┘
              │ Global EC    │
              └──────────────┘
```

### 8. Diagramme complet : cycle de vie de la stack

```javascript
function multiply(a, b) {
  return a * b;
}
function square(n) {
  return multiply(n, n);
}
function printSquare(x) {
  const result = square(x);
  console.log(result);
}
printSquare(4);
```

```
Étape 1: Démarrage        Étape 2: printSquare()    Étape 3: square(4)
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│                 │       │                 │       │  square(4)      │
│                 │       │  printSquare(4) │       │  printSquare(4) │
│  Global EC      │       │  Global EC      │       │  Global EC      │
└─────────────────┘       └─────────────────┘       └─────────────────┘

Étape 4: multiply(4,4)   Étape 5: retour 16        Étape 6: console.log
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  multiply(4,4)  │       │                 │       │  console.log(16)│
│  square(4)      │       │  printSquare(4) │       │  printSquare(4) │
│  printSquare(4) │       │  Global EC      │       │  Global EC      │
│  Global EC      │       └─────────────────┘       └─────────────────┘
└─────────────────┘

Étape 7: retour           Étape 8: fin
┌─────────────────┐       ┌─────────────────┐
│                 │       │                 │
│  Global EC      │       │  (pile vide)    │
└─────────────────┘       └─────────────────┘
```

---

> ⚙️ **Sections avancées** — Les sections qui suivent (Realm, eval, TurboFan, comparaison moteurs) sont des approfondissements. Tu peux les **sauter en première lecture** et y revenir plus tard. Les concepts essentiels sont couverts dans les sections 1 à 8 ci-dessus.

### 9. Le binding de `this`

> 💡 **Rappel** : `this` est un mot-clé spécial en JavaScript qui fait référence à un objet. La particularité, c'est que sa valeur change selon **comment** la fonction est appelée, pas selon **où** elle est écrite (sauf pour les arrow functions).

La valeur de `this` est déterminée **au moment de l'appel**, pas de la déclaration (sauf pour les arrow functions).

```
Règles de détermination de this (par ordre de priorité) :

1. new Foo()           → this = nouvel objet créé
2. foo.call(obj) /     → this = obj (explicit binding)
   foo.apply(obj) /
   foo.bind(obj)
3. obj.foo()           → this = obj (implicit binding)
4. foo()               → this = globalThis (ou undefined en strict mode)

Exception : Arrow function → this = this du scope lexical englobant (capturé à la création)
```

### 10. Le concept de Realm

> 💡 **Rappel** : cette section est un peu plus avancée. Si tu débutes, retiens simplement qu'un **Realm**, c'est un "monde isolé" pour JavaScript. Chaque onglet, chaque iframe a le sien.

La spécification ECMAScript définit le concept de **Realm** (domaine). Un Realm représente un environnement d'exécution isolé qui contient :

- Son **propre objet global** (`window`, `globalThis`)
- Ses **propres prototypes built-in** (`Object.prototype`, `Array.prototype`, etc.)
- Son **propre ensemble de constructeurs** (`Object`, `Array`, `Map`, etc.)

En pratique, chaque **contexte de navigation** (browsing context) dans un navigateur — chaque onglet, chaque iframe — possède son propre Realm.

```javascript
// Dans la page principale
const arr = [1, 2, 3];
console.log(arr instanceof Array); // true

// Si on reçoit un tableau d'une iframe :
const iframe = document.createElement('iframe');
document.body.appendChild(iframe);
const iframeArray = iframe.contentWindow.Array;

const arrFromIframe = new iframeArray(1, 2, 3);
console.log(arrFromIframe instanceof Array);           // false !!
console.log(arrFromIframe instanceof iframeArray);     // true

// Pourquoi ? Parce que Array de l'iframe !== Array de la page principale
// Ce sont deux Realms différents, avec deux prototypes Array.prototype distincts.
// C'est pour ça qu'on utilise Array.isArray() au lieu de instanceof :
console.log(Array.isArray(arrFromIframe)); // true ✓
```

Chaque Realm a son propre **Global Execution Context**, son propre `window`, et ses propres prototypes. Deux Realms = deux ensembles de built-ins distincts.

### 11. Direct eval vs indirect eval

> 💡 **Rappel** : `eval()` est une fonction qui exécute du code JavaScript passé sous forme de chaîne de caractères. C'est presque toujours une mauvaise idée de l'utiliser (problèmes de sécurité et de performance), mais il est utile de comprendre son fonctionnement interne pour le moteur.

La spécification distingue deux formes d'`eval`, qui créent des contextes d'exécution très différents :

#### Direct eval

Un appel à `eval` est **direct** quand il apparaît littéralement comme `eval(...)` :

```javascript
function test() {
  const x = 10;
  eval('console.log(x)'); // 10 — direct eval : accès au scope local de test()
}
test();
```

Le **direct eval** crée un contexte d'exécution qui hérite du **LexicalEnvironment** et du **VariableEnvironment** de la fonction appelante. Il voit les variables locales.

#### Indirect eval

Toute autre manière d'invoquer `eval` est **indirecte** :

```javascript
function test() {
  const x = 10;
  const myEval = eval;
  myEval('console.log(x)'); // ReferenceError: x is not defined — scope GLOBAL
}
// Autres formes indirectes : (0, eval)('...'), window.eval('...')
```

L'**indirect eval** crée un contexte d'exécution dont l'environnement est le **Global Environment** du Realm courant. Il ne voit pas les variables locales.

La différence clé : le direct eval hérite du scope local (`outer → test() EC`), tandis que l'indirect eval s'exécute dans le scope global (`outer → Global EC`). Le direct eval empêche V8 et SpiderMonkey d'optimiser la fonction englobante, car le moteur ne peut pas savoir quelles variables `eval` va lire ou modifier. C'est l'une des raisons pour lesquelles `eval` est fortement déconseillé.

### 12. L'inlining et l'optimisation des contextes par V8 (TurboFan)

> 💡 **Rappel** : cette section explique que ce que décrit la spécification (les contextes d'exécution) ne correspond pas toujours à ce que fait le moteur en interne. Les moteurs modernes sont libres d'optimiser tant que le comportement observable reste le même.

V8 possède un compilateur optimisant appelé **TurboFan**. Quand une fonction est appelée de nombreuses fois (on dit qu'elle est "chaude" — hot), TurboFan peut décider de l'**inliner** : au lieu de créer un nouveau stack frame et un nouveau contexte d'exécution pour chaque appel, il insère directement le code de la fonction appelée dans la fonction appelante.

```javascript
function add(a, b) {
  return a + b;
}

function compute(x) {
  // Après optimisation par TurboFan, cet appel peut être "inliné" :
  // au lieu de créer un stack frame pour add(), V8 remplace
  // l'appel par le corps de la fonction directement.
  return add(x, 1);
}

// Après inlining, compute() ressemble en interne à :
// function compute(x) { return x + 1; }
// → Pas de stack frame supplémentaire pour add()
// → Pas de contexte d'exécution séparé pour add()
```

Après inlining, au lieu de 2 frames (compute + add), il n'y en a plus qu'un seul (compute, avec le code de add fusionné dedans). Conséquence : quand tu débogues du code optimisé, la stack trace peut être différente de ce que tu attends.

Le concept clé à retenir : **la spécification décrit le comportement logique** (chaque appel crée un contexte), mais **les moteurs sont libres d'optimiser** tant que le résultat observable est le même. Un contexte d'exécution au sens de la spec ne correspond pas forcément à un "vrai" stack frame en mémoire.

### 13. Inspecter la call stack dans les DevTools

Savoir inspecter la call stack dans les DevTools est une compétence essentielle pour déboguer du JavaScript. Voici comment faire dans Chrome et Firefox.

#### Chrome DevTools (V8)

1. **Ouvrir les DevTools** : `F12` ou `Ctrl+Shift+I` (Windows/Linux) / `Cmd+Option+I` (Mac)
2. **Aller dans l'onglet Sources** (Sources tab)
3. **Placer un breakpoint** en cliquant sur le numéro de ligne dans le fichier source
4. **Exécuter le code** — l'exécution s'arrête au breakpoint
5. **Observer le panneau "Call Stack"** à droite : il montre la pile d'appels actuelle, du frame le plus récent (en haut) au Global (en bas)
6. **Cliquer sur un frame** pour naviguer dans le code source de cet appel
7. **Utiliser les boutons de pas-à-pas** :
   - **Step Over** (`F10`) : exécute la ligne courante sans entrer dans les fonctions
   - **Step Into** (`F11`) : entre dans la fonction appelée
   - **Step Out** (`Shift+F11`) : sort de la fonction courante

```
┌──────────────────────────────────────────────────────┐
│  Chrome DevTools — Sources tab                        │
│                                                       │
│  ┌─────────────────────────┬─────────────────────┐    │
│  │                         │ ▶ Call Stack         │    │
│  │   Code source           │   multiply (file:2) │    │
│  │                         │   square (file:5)   │    │
│  │   function multiply() { │   printSquare (f:8) │    │
│  │ ● → return a * b;      │   (anonymous) (f:11)│    │
│  │   }                     │                     │    │
│  │                         │ ▶ Scope             │    │
│  │                         │   Local             │    │
│  │                         │     a: 4            │    │
│  │                         │     b: 4            │    │
│  └─────────────────────────┴─────────────────────┘    │
│                                                       │
│  ● = breakpoint    → = ligne courante                 │
└──────────────────────────────────────────────────────┘
```

> 💡 **Astuce** : dans le panneau **Scope**, tu peux voir les valeurs de toutes les variables accessibles dans le frame courant — variables locales, variables de closure, et variables globales.

#### Firefox DevTools (SpiderMonkey)

L'expérience est très similaire dans Firefox :

1. **Ouvrir les DevTools** : `F12` ou `Ctrl+Shift+I`
2. **Aller dans l'onglet Débogueur** (Debugger tab — pas "Sources" comme Chrome)
3. **Placer un breakpoint** de la même façon
4. **Le panneau "Pile d'appels"** (Call Stack) apparaît à droite quand l'exécution est en pause
5. **Le panneau "Portées"** (Scopes) montre les variables accessibles

Les raccourcis de pas-à-pas sont les mêmes (`F10`, `F11`, `Shift+F11`).

### 14. Comparaison : V8 vs SpiderMonkey

Les concepts de la spécification ECMAScript (call stack, contextes d'exécution, phases de création/exécution) sont les **mêmes** quel que soit le moteur. Cependant, l'**implémentation interne** diffère. Voici les principales différences.

#### Architecture de la pile

| Aspect | V8 (Chrome, Node.js) | SpiderMonkey (Firefox) |
|--------|----------------------|------------------------|
| **Stack frames interprétés** | `InterpreterEntryStackFrame` (Ignition) | `InterpreterFrame` (Baseline Interpreter) |
| **Stack frames optimisés** | `OptimizedFrame` (TurboFan) | `JitFrames` (IonMonkey / Warp) |
| **Stack frames de base** | `BaselineFrame` (Sparkplug) | `BaselineFrame` (Baseline JIT) |

#### Pipeline de compilation

Les deux moteurs suivent un pipeline similaire mais avec des noms différents :

```
V8 (Chrome/Node.js) :
  Code source → Parser → Bytecode (Ignition) → Sparkplug (baseline) → TurboFan (optimisé)

SpiderMonkey (Firefox) :
  Code source → Parser → Bytecode → Baseline Interpreter → Baseline JIT → Warp/IonMonkey (optimisé)
```

En résumé : les deux moteurs passent du bytecode interprété (Ignition / Baseline Interpreter) à un code machine baseline rapide (Sparkplug / Baseline JIT), puis au code hautement optimisé (TurboFan / Warp) pour les fonctions "chaudes" (fréquemment exécutées).

#### Identique (spec) vs différent (implémentation)

**Identique** : call stack LIFO, structure des contextes d'exécution (LexicalEnvironment, VariableEnvironment, ThisBinding), hoisting, résolution de `this`, phases de création/exécution.

**Différent** : représentation interne des stack frames, stratégies d'optimisation (inlining, spécialisation), taille maximale de la stack, messages d'erreur.

> 💡 **À retenir** : tu écris du code conforme à la **spécification**. Les différences entre moteurs sont des détails d'implémentation. Comprendre ces détails est utile pour la performance et le débogage, mais ton code ne devrait jamais dépendre d'un comportement spécifique à un moteur.

---

## Démonstration

### Demo 1 : Inspecter la call stack avec `Error().stack`

```javascript
function c() {
  // Créer une Error capture la stack trace actuelle
  const stack = new Error().stack;
  console.log('=== Stack Trace ===');
  console.log(stack);
}

function b() {
  c();
}

function a() {
  b();
}

a();

// Sortie attendue :
// === Stack Trace ===
// Error
//     at c (file.js:3:17)
//     at b (file.js:9:3)
//     at a (file.js:13:3)
//     at Object.<anonymous> (file.js:16:1)
```

### Demo 2 : `console.trace()`

```javascript
function deepFunction() {
  console.trace('Où suis-je ?');
}

function middleFunction() {
  deepFunction();
}

function topFunction() {
  middleFunction();
}

topFunction();
// Affiche la stack trace complète dans la console
```

### Demo 3 : Mesurer la profondeur maximale de la stack

```javascript
let depth = 0;

function measureStackDepth() {
  depth++;
  measureStackDepth();
}

try {
  measureStackDepth();
} catch (e) {
  console.log(`Profondeur maximale atteinte : ${depth}`);
  console.log(`Erreur : ${e.message}`);
}
// Résultat typique avec V8 : ~12 000 - 15 000
// Résultat typique avec SpiderMonkey : ~20 000 - 40 000 (varie selon la version)
// Varie selon la taille du frame (nombre de variables locales)
```

### Demo 4 : Observer la phase de création

```javascript
// Ce code démontre que la phase de création est réelle
console.log(typeof undeclaredVar);  // "undefined" — pas d'erreur !
// ATTENTION : cela n'a rien à voir avec le hoisting ou la phase de création.
// La variable `undeclaredVar` n'existe nulle part. C'est l'opérateur `typeof`
// qui a une sémantique spéciale (ECMA-262 §13.5.1) : lorsqu'il est appliqué
// à une référence non résolvable, il retourne "undefined" au lieu de lancer
// une ReferenceError. C'est un mécanisme de sécurité de l'opérateur lui-même.
// console.log(undeclaredVar);      // ReferenceError si on essaie d'y accéder directement

console.log(typeof myFunc);        // "function"
console.log(typeof myVar);         // "undefined"
// console.log(typeof myLet);      // ReferenceError (TDZ)

var myVar = 42;
let myLet = 100;
function myFunc() {}
```

### Demo 5 : Performance.mark et stack depth

```javascript
// En Node.js
const { performance } = require('perf_hooks');

function recursiveWork(n) {
  if (n <= 0) return;
  performance.mark(`depth-${n}-start`);
  recursiveWork(n - 1);
  performance.mark(`depth-${n}-end`);
  performance.measure(`depth-${n}`, `depth-${n}-start`, `depth-${n}-end`);
}

recursiveWork(5);

const measures = performance.getEntriesByType('measure');
measures.forEach(m => {
  console.log(`${m.name}: ${m.duration.toFixed(4)}ms`);
});
```

### Demo 6 : Observer les Realms avec une iframe

```html
<!-- Ouvrir dans un navigateur -->
<script>
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const iframeWindow = iframe.contentWindow;

  console.log(iframeWindow.Array === Array);             // false — deux Realms !
  const arr = new iframeWindow.Array(1, 2, 3);
  console.log(arr instanceof Array);                     // false
  console.log(Array.isArray(arr));                       // true ← la bonne méthode
</script>
```

---

## Points clés

1. La **call stack** est une structure LIFO unique (comme une pile d'assiettes) — JavaScript est mono-threadé.
2. Un **contexte d'exécution** contient : LexicalEnvironment, VariableEnvironment, ThisBinding.
3. Chaque contexte passe par une **phase de création** (enregistrement des déclarations) puis une **phase d'exécution** (assignation des valeurs).
4. Le **hoisting** est une conséquence de la phase de création : `var` reçoit `undefined`, `let`/`const` entrent en TDZ, les `function declarations` reçoivent leur valeur complète.
5. Le **stack overflow** survient quand la pile dépasse sa capacité. La **TCO** est dans la spec ES6 mais n'est implémentée que par Safari.
6. La valeur de `this` dépend du **mode d'appel**, pas du lieu de déclaration (sauf arrow functions).
7. Chaque **Realm** (onglet, iframe) possède ses propres built-ins et son propre Global EC — c'est pourquoi `instanceof` ne fonctionne pas entre Realms.
8. Le **direct eval** hérite du scope local, l'**indirect eval** s'exécute dans le scope global.
9. V8 (TurboFan) peut **inliner** les fonctions, ce qui signifie qu'un contexte d'exécution au sens de la spec ne correspond pas toujours à un stack frame réel.
10. V8 et SpiderMonkey implémentent les **mêmes concepts** (définis dans la spec) mais avec des **structures internes différentes** (Ignition/Sparkplug/TurboFan vs Baseline Interpreter/Baseline JIT/Warp).

---

## Lab associé

Voir `labs/01-call-stack-lab.js` — Exercice de traçage manuel de la call stack avec vérification par `Error().stack`.

---

## Pour aller plus loin

- [ECMAScript Specification — Execution Contexts](https://tc39.es/ecma262/#sec-execution-contexts)
- [ECMAScript Specification — Realms](https://tc39.es/ecma262/#sec-code-realms)
- [V8 Blog — Blazingly fast parsing](https://v8.dev/blog/scanner) — contexte sur l'exécution interne V8
- [V8 Blog — TurboFan JIT](https://v8.dev/docs/turbofan)
- [MDN — Call Stack](https://developer.mozilla.org/en-US/docs/Glossary/Call_stack)
- [MDN — eval()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval) — direct vs indirect eval
- [Tail call optimization in ECMAScript 6](https://2ality.com/2015/06/tail-call-optimization.html) — Dr. Axel Rauschmayer
- [V8 Source — frames.h](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/execution/frames.h)
- [SpiderMonkey — Architecture overview](https://firefox-source-docs.mozilla.org/js/index.html)
- [Chrome DevTools — Debug JavaScript](https://developer.chrome.com/docs/devtools/javascript/)
- [Firefox DevTools — Debugger](https://firefox-source-docs.mozilla.org/devtools-user/debugger/)

---

## Si tu es perdu

Voici un résumé ultra-simplifié de ce module. Si tu as compris ces points, tu as saisi l'essentiel :

1. **La call stack** = une pile d'assiettes. Chaque appel de fonction pose une assiette. Quand la fonction se termine, on retire l'assiette du dessus.

2. **Un contexte d'exécution** = une fiche que le moteur crée pour chaque morceau de code. Elle dit : "Voici les variables disponibles ici, et voici la valeur de `this`."

3. **Le hoisting** = le moteur lit le code en deux passes. D'abord il note toutes les déclarations (sans les exécuter), puis il exécute le code ligne par ligne. C'est pour ça qu'on peut appeler une `function` avant sa déclaration dans le code, mais pas une `let`.

4. **Le stack overflow** = trop d'assiettes empilées, la pile s'écroule. Ça arrive avec la récursion infinie.

5. **V8 et SpiderMonkey** font la même chose (ils suivent la spec), mais organisent leur mémoire différemment. Comme deux restaurants qui utilisent tous les deux des piles d'assiettes, mais avec des assiettes de taille et de forme différentes.

---

## Défi

Quel est l'affichage de ce code ? Expliquez en termes de phases de création et d'exécution.

```javascript
var x = 1;

function foo() {
  console.log(x);       // ???
  var x = 2;
  console.log(x);       // ???
}

foo();
console.log(x);         // ???
```

<details>
<summary>Réponse</summary>

```
undefined
2
1
```

**Explication** :
- Lors de la création du contexte de `foo()`, la déclaration `var x` est enregistrée dans le VariableEnvironment de `foo` avec la valeur `undefined`. Cette variable **masque** (shadow) la variable `x` globale.
- Premier `console.log(x)` : on est en phase d'exécution mais l'assignation `x = 2` n'a pas encore été atteinte. La variable locale `x` vaut `undefined`.
- Deuxième `console.log(x)` : `x` vaut maintenant `2` (dans le scope de `foo`).
- Troisième `console.log(x)` : on est dans le contexte global, `x` vaut toujours `1` (jamais modifié).

</details>
