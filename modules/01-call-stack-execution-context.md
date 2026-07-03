---
titre: Call stack et contexte d'exécution
cours: 01-js-runtime
notions: [contexte d'exécution global et fonction, phase de création et phase d'exécution, hoisting var let const et TDZ, function declarations hoistées, call stack LIFO, stack frame, binding de this par contexte d'appel, stack overflow et récursion, lecture d'une stack trace]
outcomes: [lire une stack trace et remonter à la fonction fautive, prédire l'ordre d'empilement et de dépilement des frames, expliquer le hoisting via les deux phases du contexte d'exécution]
prerequis: [00-prerequis-et-vue-ensemble]
next: 02-scope-closures-memory
libs: []
tribuzen: lecture des stack traces de l'API TribuZen et diagnostic d'une récursion sur l'arbre des familles
last-reviewed: 2026-07
---

# Call stack et contexte d'exécution

> **Outcomes — tu sauras FAIRE :** lire une stack trace et remonter à la fonction fautive, prédire l'ordre d'empilement/dépilement des frames, expliquer le hoisting via les deux phases du contexte d'exécution.
> **Difficulté :** :star::star:

## 1. Cas concret d'abord

L'API TribuZen tombe en production. Un membre a créé une famille qui se référence indirectement elle-même (bug de saisie), et l'endpoint qui calcule l'arbre généalogique renvoie un `500`. Voici ce que Sentry remonte :

```
RangeError: Maximum call stack size exceeded
    at buildFamilyTree (family.service.ts:42:18)
    at buildFamilyTree (family.service.ts:47:22)
    at buildFamilyTree (family.service.ts:47:22)
    at buildFamilyTree (family.service.ts:47:22)
    ... (14 998 lignes identiques)
    at getFamilyGraph (family.controller.ts:19:26)
    at handleRequest (server.ts:88:12)
```

Trois questions se posent immédiatement, et sans comprendre la **call stack** tu ne peux répondre à aucune :

1. Pourquoi la même fonction apparaît-elle des milliers de fois ?
2. Comment lire cette trace — quelle ligne est la cause, laquelle est le point d'entrée ?
3. Pourquoi le moteur s'arrête-t-il avec `RangeError` plutôt que de tourner à l'infini ?

Ce module te donne le modèle mental pour répondre : ce qu'est un contexte d'exécution, comment le moteur empile les appels, et comment lire la trace qu'il te laisse quand ça casse.

---

## 2. Théorie complète, concise

### 2.1 Le contexte d'exécution

Un **contexte d'exécution** (execution context, EC) est la fiche interne que le moteur JS crée à chaque fois qu'il commence à exécuter du code. Elle répond à trois questions : *quelles variables existent ici ?*, *quelle est la valeur de `this` ?*, *quel est le scope parent ?*.

Deux types t'intéressent au quotidien :

| Type | Créé quand | Combien |
|---|---|---|
| Contexte global | le script démarre | un seul, à la base de la pile |
| Contexte de fonction | une fonction est appelée | un par appel |

Chaque contexte contient trois composants (vocabulaire de la spec ECMAScript) :

```
Execution Context
├── LexicalEnvironment    → let, const, function declarations + lien vers le scope parent
├── VariableEnvironment   → var
└── ThisBinding           → la valeur de this dans ce contexte
```

Le `LexicalEnvironment` et le `VariableEnvironment` sont presque identiques ; la spec les sépare pour gérer la différence de portée entre `var` (fonction) et `let`/`const` (bloc).

### 2.2 Les deux phases : création, puis exécution

C'est le concept central du module. Chaque contexte passe par **deux phases**.

**Phase de création** — le moteur parcourt le code *sans l'exécuter* et :

1. enregistre les `var` avec la valeur `undefined` ;
2. enregistre les `let`/`const` mais les laisse *non initialisées* (Temporal Dead Zone, cf. 2.3) ;
3. enregistre les **function declarations** avec leur corps complet immédiatement ;
4. détermine la valeur de `this`.

**Phase d'exécution** — le moteur lit le code ligne par ligne, assigne les vraies valeurs, évalue les expressions, appelle les fonctions.

```
AVANT (phase de création)        APRÈS (phase d'exécution)
  var a  → undefined      →        var a  → 42
  let b  → <TDZ>          →        let b  → "hello"
  foo    → [Function]     →        foo    → [Function]
```

### 2.3 Le hoisting, correctement expliqué

Le **hoisting** n'est pas un "déplacement des déclarations vers le haut". Rien n'est déplacé. C'est une **conséquence de la phase de création** : comme les déclarations sont enregistrées avant toute exécution, tout se passe *comme si* elles étaient remontées.

```js
console.log(a);   // undefined    → var initialisé à undefined en phase de création
console.log(b);   // ReferenceError: Cannot access 'b' before initialization (TDZ)
console.log(foo); // [Function: foo] → declaration hoistée avec son corps
console.log(bar); // undefined    → bar est un var (l'expression n'est pas encore assignée)

var a = 1;
let b = 2;
function foo() { return 'hello'; }
var bar = function () { return 'world'; };
```

La **Temporal Dead Zone** (TDZ) est l'intervalle entre l'entrée dans le scope et la ligne de déclaration d'un `let`/`const` : la variable *existe* mais y accéder lève une `ReferenceError`. C'est ce qui distingue `let`/`const` de `var` : `var` te donne `undefined`, `let` te donne une erreur explicite — un garde-fou, pas un défaut.

**Récapitulatif du hoisting par mot-clé :**

| Déclaration | En phase de création | Accès avant la ligne |
|---|---|---|
| `var x` | `undefined` | renvoie `undefined` |
| `let x` / `const x` | non initialisé (TDZ) | `ReferenceError` |
| `function f() {}` | corps complet | appelable |
| `const f = () => {}` | le `const` est en TDZ | `ReferenceError` |

### 2.4 La call stack (LIFO)

La **call stack** est une structure **LIFO** (Last In, First Out) que le moteur utilise pour suivre *où il en est*. JavaScript est **mono-threadé** : il n'y a qu'une seule pile, donc une seule chose s'exécute à la fois.

- À chaque appel de fonction, le moteur **empile** (push) un **stack frame**.
- Quand la fonction `return` (ou atteint sa fin), le moteur **dépile** (pop) ce frame et reprend dans l'appelant.

```js
function multiply(a, b) { return a * b; }
function square(n)      { return multiply(n, n); }
function printSquare(x) { console.log(square(x)); }
printSquare(4);
```

```
Pile au moment de multiply(4, 4) :

  ┌────────────────────┐  ← sommet (en cours)
  │ multiply(4, 4)     │
  ├────────────────────┤
  │ square(4)          │
  ├────────────────────┤
  │ printSquare(4)     │
  ├────────────────────┤
  │ Contexte global    │  ← base
  └────────────────────┘
```

Le dernier appelé (`multiply`) est le premier à finir et à être dépilé — d'où LIFO.

### 2.5 Le stack frame

Un **stack frame** est la case qu'occupe un appel dans la pile. Il contient tout ce dont le moteur a besoin pour exécuter la fonction *et revenir* ensuite :

```
Stack Frame
├── adresse de retour (où reprendre dans l'appelant)
├── arguments de la fonction
├── variables locales
└── contexte d'exécution associé
```

Chaque ligne d'une stack trace correspond à un frame de la pile au moment de l'erreur.

### 2.6 Le binding de `this`

La valeur de `this` est fixée **au moment de l'appel**, pas à l'écriture (sauf arrow functions). Elle dépend de *comment* la fonction est appelée :

```js
function who() { return this; }

who();                 // globalThis (ou undefined en strict mode)  → appel simple
const obj = { who };
obj.who();             // obj                                       → appel méthode
who.call({ id: 1 });   // { id: 1 }                                 → binding explicite
new who();             // le nouvel objet créé                      → binding new
```

Règles par priorité décroissante :

1. `new Foo()` → `this` = le nouvel objet ;
2. `foo.call(o)` / `foo.apply(o)` / `foo.bind(o)` → `this` = `o` ;
3. `obj.foo()` → `this` = `obj` ;
4. `foo()` → `this` = `globalThis` (ou `undefined` en strict mode).

**Exception — arrow function** : elle n'a pas son propre `this`, elle capture celui du scope où elle est *écrite* (lexical), une fois pour toutes.

### 2.7 Stack overflow et récursion

La pile a une **taille limitée** (V8 : ~10 000 à ~15 000 frames selon la taille de chaque frame). La dépasser lève :

```
RangeError: Maximum call stack size exceeded
```

Cela arrive presque toujours avec une **récursion sans cas d'arrêt** (ou dont le cas d'arrêt n'est jamais atteint) :

```js
function infinite() {
  return infinite();   // aucun cas de base → on empile jusqu'à saturation
}
infinite();            // RangeError
```

Une récursion correcte a toujours un **cas de base** qui finit par arrêter l'empilement :

```js
function countdown(n) {
  if (n <= 0) return;  // cas de base : on dépile enfin
  countdown(n - 1);
}
```

C'est exactement le bug du cas concret : l'arbre des familles se référençait lui-même, donc `buildFamilyTree` s'appelait sans jamais atteindre son cas de base.

### 2.8 Lire une stack trace

Une stack trace se lit **de haut en bas = du plus récent au plus ancien** :

```
RangeError: Maximum call stack size exceeded
    at buildFamilyTree (family.service.ts:42:18)   ← sommet : là où ça a cassé
    at buildFamilyTree (family.service.ts:47:22)   ← l'appel récursif juste au-dessus
    ...
    at getFamilyGraph (family.controller.ts:19:26)
    at handleRequest (server.ts:88:12)             ← base : point d'entrée
```

- **Ligne 1** : le type et le message d'erreur.
- **Première `at`** : la fonction où l'erreur a été levée (le sommet de la pile).
- **Dernière `at`** : le point d'entrée le plus ancien.
- Format : `at <fonction> (<fichier>:<ligne>:<colonne>)`.

En pratique tu remontes du haut jusqu'à la première ligne *de ton code* (les lignes de `node_modules` sont souvent du bruit).

---

## 3. Worked examples

### Exemple 1 — Dérouler la pile d'un appel imbriqué

Prédisons l'état de la pile à chaque étape.

```js
function multiply(a, b) {           // (1)
  return a * b;
}
function square(n) {                // (2)
  return multiply(n, n);
}
function printSquare(x) {           // (3)
  const result = square(x);
  console.log(result);
}
printSquare(4);                     // (4)
```

Déroulé, frame par frame :

```
Étape A — printSquare(4) appelée      Étape B — square(4) appelée
  [ printSquare(4) ]                    [ square(4)      ]
  [ global         ]                    [ printSquare(4) ]
                                        [ global         ]

Étape C — multiply(4,4) appelée       Étape D — multiply retourne 16
  [ multiply(4,4)  ] ← sommet           [ square(4)      ]  (multiply dépilé)
  [ square(4)      ]                     [ printSquare(4) ]
  [ printSquare(4) ]                     [ global         ]
  [ global         ]

Étape E — square retourne 16          Étape F — console.log puis fin
  [ printSquare(4) ]                     [ global ]  (pile revenue à la base)
  [ global         ]
```

**À retenir** : le dernier empilé (`multiply`) est le premier dépilé. La pile "gonfle" jusqu'à `multiply`, puis se dégonfle dans l'ordre inverse.

### Exemple 2 — Prédire une sortie via les deux phases

```js
var x = 1;

function foo() {
  console.log(x);   // (a)
  var x = 2;
  console.log(x);   // (b)
}

foo();
console.log(x);     // (c)
```

Raisonnement :

- **Phase de création de `foo`** : le moteur voit `var x` et enregistre `x = undefined` dans le contexte de `foo`. Ce `x` local **masque** (shadow) le `x` global.
- **(a)** : on est en phase d'exécution, mais la ligne `x = 2` n'est pas encore atteinte → le `x` local vaut `undefined`. Affiche `undefined`.
- **(b)** : `x = 2` a été exécuté → affiche `2`.
- **(c)** : on est dans le contexte global, jamais modifié → affiche `1`.

```
undefined
2
1
```

Le piège classique : croire que `(a)` affiche `1`. Non — le `var x` de `foo` est hoisté et masque le global *dès l'entrée* dans la fonction, avant même sa ligne de déclaration.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — "Le hoisting déplace le code vers le haut"

Faux. Aucune ligne n'est déplacée. Le moteur fait juste une **passe de création** qui enregistre les déclarations avant d'exécuter. Le mot "remontée" est une métaphore ; le fichier reste tel quel.

```js
// Ce que tu écris             // Ce que ça FAIT (pas ce que ça devient)
console.log(a); // undefined      → à la création, a existe déjà = undefined
var a = 5;                        //   l'assignation, elle, reste à sa ligne
```

### PIÈGE #2 — Confondre le `undefined` de `var` et la TDZ de `let`

```js
console.log(v); // undefined       ← var : accessible, vaut undefined
console.log(l); // ReferenceError  ← let : existe mais en TDZ
var v = 1;
let l = 2;
```

Les deux sont "hoistées" au sens où le moteur les connaît dès la création. La différence : `var` est *initialisée* à `undefined`, `let`/`const` restent *non initialisées* jusqu'à leur ligne. Accéder à une `let` en TDZ n'est pas un `undefined` silencieux, c'est une **erreur** — voulue.

### PIÈGE #3 — Lire la stack trace dans le mauvais sens

La **première** ligne `at` est l'endroit où ça a cassé (le sommet), la **dernière** est le point d'entrée. Beaucoup lisent l'inverse et cherchent le bug au mauvais endroit. Remonte toujours du haut vers ton premier fichier applicatif.

### PIÈGE #4 — Croire que `this` dépend de l'endroit où la fonction est écrite

```js
const user = {
  name: 'Léa',
  greet() { return `Hi ${this.name}`; },
};

const fn = user.greet;
fn();          // "Hi undefined" — appel simple, this = globalThis/undefined
user.greet();  // "Hi Léa"       — appel méthode, this = user
```

`this` dépend du **site d'appel**, pas de la définition. Détacher une méthode (`const fn = user.greet`) perd le `this`. Les arrow functions sont la seule exception : elles figent le `this` lexical.

### PIÈGE #5 — Confondre récursion infinie et boucle infinie

Une **boucle** (`while (true)`) gèle le thread mais n'explose pas la pile — elle n'empile pas de frames. Une **récursion sans cas de base** empile un frame par appel et finit par lever `RangeError: Maximum call stack size exceeded`. Le message d'erreur te dit lequel des deux tu as.

---

## 5. Ancrage TribuZen

Ce module est la brique de **diagnostic** de l'API TribuZen. Trois usages concrets :

**Lire les stack traces de l'API.** Chaque `500` remonté par Sentry ou les logs Node arrive avec une trace. Savoir la lire — sommet = fonction fautive, base = point d'entrée HTTP — c'est la première compétence de debug backend. Sur TribuZen, les traces partent typiquement de `server.ts` (entrée) et remontent vers un service (`family.service.ts`, `member.service.ts`).

**Comprendre la récursion sur l'arbre des familles.** TribuZen modélise des familles avec des relations parent/enfant. Le calcul de l'arbre généalogique (`buildFamilyTree`) est **récursif par nature**. Sans cas de base robuste — ou avec des données cycliques — il sature la pile. Comprendre pourquoi permet d'ajouter la bonne garde (profondeur max, détection de cycle, `Set` de nœuds visités).

**Observer les frames au débogueur.** Poser un breakpoint dans `buildFamilyTree` et regarder le panneau *Call Stack* de Chrome DevTools (ou du débogueur Node) montre l'empilement récursif en direct — le meilleur moyen d'ancrer le modèle LIFO sur du code réel.

Fichiers concernés dans `smaurier/tribuzen` :

```
tribuzen/apps/api/src/
  server.ts                       ← point d'entrée (base des traces)
  modules/family/
    family.controller.ts          ← getFamilyGraph
    family.service.ts             ← buildFamilyTree (récursion)
```

---

## 6. Points clés

1. Un **contexte d'exécution** est la fiche interne d'un morceau de code : ses variables, son `this`, son scope parent. Global (un seul) ou fonction (un par appel).
2. Chaque contexte passe par une **phase de création** (enregistrement des déclarations) puis une **phase d'exécution** (assignation des valeurs).
3. Le **hoisting** est une conséquence de la phase de création : `var` → `undefined`, `let`/`const` → TDZ, `function declaration` → corps complet immédiatement.
4. La **TDZ** rend `let`/`const` inaccessibles avant leur ligne : c'est une `ReferenceError`, pas un `undefined` silencieux.
5. La **call stack** est LIFO et unique (JS mono-threadé) : un appel empile un **stack frame**, un `return` le dépile.
6. La valeur de **`this`** dépend du site d'appel (`new`, `.call`, `obj.f()`, `f()`), pas de l'endroit d'écriture — sauf arrow functions (this lexical).
7. Le **stack overflow** (`RangeError: Maximum call stack size exceeded`) vient d'une récursion sans cas de base atteint.
8. Une **stack trace** se lit de haut (sommet, fonction fautive) en bas (base, point d'entrée) ; format `at fonction (fichier:ligne:colonne)`.

---

## 7. Seeds Anki

```
Quels sont les trois composants d'un contexte d'exécution ?|LexicalEnvironment (let, const, function declarations + scope parent), VariableEnvironment (var), et ThisBinding (valeur de this).
Que fait le moteur pendant la phase de création d'un contexte ?|Il parcourt le code sans l'exécuter : var → undefined, let/const → TDZ (non initialisées), function declarations → corps complet, et il détermine this.
Pourquoi dit-on que le hoisting n'est pas un déplacement de code ?|Aucune ligne n'est déplacée. C'est une conséquence de la phase de création : les déclarations sont enregistrées avant l'exécution, donc tout se passe comme si elles étaient remontées.
Quelle est la différence d'accès entre var et let avant leur ligne de déclaration ?|Accéder à un var avant sa ligne renvoie undefined. Accéder à un let/const avant sa ligne lève ReferenceError (Temporal Dead Zone).
Qu'est-ce que la call stack et quel est son ordre ?|Une structure LIFO (Last In First Out) et unique (JS mono-threadé) : chaque appel empile un stack frame, chaque return le dépile. Le dernier empilé est le premier dépilé.
De quoi dépend la valeur de this ?|Du site d'appel : new Foo() → nouvel objet, foo.call(o) → o, obj.foo() → obj, foo() → globalThis/undefined. Exception : arrow function capture le this lexical.
Quelle erreur signale un stack overflow et quelle en est la cause typique ?|RangeError: Maximum call stack size exceeded, causée par une récursion dont le cas de base n'est jamais atteint (empile un frame par appel jusqu'à saturation).
Dans quel sens lit-on une stack trace ?|De haut en bas = du plus récent au plus ancien. La première ligne at est la fonction fautive (sommet), la dernière est le point d'entrée (base).
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-01-call-stack-observation/README.md`. Observer la call stack en vrai : capturer des stack traces avec `new Error().stack` et `console.trace()`, provoquer et lire un `RangeError`, mesurer la profondeur maximale, et inspecter les frames au débogueur Node/DevTools.
