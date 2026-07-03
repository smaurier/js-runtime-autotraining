# Module 02 — Scope, Closures & Mémoire

> **Difficulté** : ⭐⭐ (Intermédiaire)
>
> **Objectif** : Comprendre comment la résolution de portée fonctionne à travers la chaîne de scopes, ce qu'est réellement une closure au niveau mémoire, et comment les closures interagissent avec le ramasse-miettes (Garbage Collector).

---

## Prérequis

- Module 01 (Call Stack & Contextes d'exécution)
- Connaître `let`, `const`, `var` et les différences de portée
- Aucune connaissance préalable de stack/heap nécessaire (expliqué dans ce module)

> 💡 **Pas de panique** : les closures ont la réputation d'être un concept difficile, mais on va commencer avec une image simple et construire la compréhension petit à petit. Si tu as compris le module 01 (contextes d'exécution, phases de création/exécution), tu as déjà toutes les bases nécessaires.

---

## Théorie

### 1. Portée lexicale (Lexical Scoping)

> 💡 **Rappel** : la **portée** (scope) d'une variable, c'est la zone du code ou cette variable est accessible. Si tu déclares une variable à l'intérieur d'une fonction, elle n'est accessible que dans cette fonction — c'est sa portée.

JavaScript utilise la **portée lexicale** (où statique) : la portée d'une variable est déterminée par sa **position dans le code source**, pas par l'endroit où la fonction est appelée.

```typescript
const x = 'global';

function outer(): () => void {
  const x = 'outer';

  function inner(): void {
    console.log(x); // 'outer' — résolu lexicalement, pas dynamiquement
  }

  return inner;
}

const fn = outer();
fn(); // 'outer' — même appelée depuis le scope global
```

La **structure** de la chaîne de scopes est déterminée au **moment du parsing** (analyse syntaxique) : le moteur sait déjà, avant l'exécution, dans quel scope chaque identifiant sera résolu. En revanche, la **valeur** des variables est déterminée au runtime, lors de la phase d'exécution.

Dit autrement : la **structure** (quel scope contient quel autre) est fixe dès le parsing, mais les **valeurs** des variables sont remplies à l'exécution.

### 2. Chaîne de scopes (Scope Chain)

Chaque contexte d'exécution à une référence `outer` dans son LexicalEnvironment qui pointe vers l'environnement lexical parent. Cela forme une **chaîne** — comme les maillons d'une chaîne, chaque scope est relié au scope qui le contient :

```
┌──────────────────────────────────────────────────────────────┐
│                    Scope Chain                                │
│                                                              │
│  inner EC                                                    │
│  ┌─────────────────────┐                                     │
│  │ LexicalEnvironment  │                                     │
│  │  - EnvironmentRecord │                                    │
│  │    (variables locales)│                                   │
│  │  - outer ─────────────┼──┐                                │
│  └─────────────────────┘   │                                 │
│                             ▼                                │
│  outer EC                                                    │
│  ┌─────────────────────┐                                     │
│  │ LexicalEnvironment  │                                     │
│  │  - EnvironmentRecord │                                    │
│  │    { x: 'outer' }   │                                    │
│  │  - outer ─────────────┼──┐                                │
│  └─────────────────────┘   │                                 │
│                             ▼                                │
│  Global EC                                                   │
│  ┌─────────────────────┐                                     │
│  │ LexicalEnvironment  │                                     │
│  │  - EnvironmentRecord │                                    │
│  │    { x: 'global' }  │                                    │
│  │  - outer: null       │                                    │
│  └─────────────────────┘                                     │
└──────────────────────────────────────────────────────────────┘

Résolution de `x` dans inner :
  1. inner.EnvironmentRecord → pas trouvé
  2. outer.EnvironmentRecord → trouvé : 'outer' ✓
  (on ne consulte jamais le scope global)
```

Quand le moteur cherche une variable, il remonte la chaîne maillon par maillon. S'il arrive au bout (Global EC avec `outer: null`) sans l'avoir trouvée, il lance une `ReferenceError`.

### 3. Qu'est-ce qu'une closure — commençons par une image

Avant la définition technique, prenons une image.

**Une closure, c'est comme un sac à dos que la fonction emporte avec elle quand elle quitte sa maison (son scope).** Imagine une fonction `inner()` qui est "née" à l'intérieur de `outer()`. Quand `outer()` se termine, son scope est normalement détruit (le stack frame est dépilé). Mais si `inner()` est retournée vers l'extérieur, elle emporte dans un "sac à dos" les variables du scope de `outer()` dont elle a besoin. Elle peut être appelée n'importe ou et aura toujours accès à ces variables. Ce sac à dos, c'est la **closure**.

### 4. Qu'est-ce qu'une closure — définition technique

Une **closure** est la combinaison d'une fonction et d'une **référence** vers l'environnement lexical dans lequel elle a été créée. Ce n'est pas la fonction seule — c'est la fonction **plus** son scope capturé.

Quand une fonction est créée (pas appelée, **créée**), le moteur stocke dans un slot interne `[[Environment]]` une référence vers le LexicalEnvironment courant.

```typescript
function createCounter(): { increment(): void; getCount(): number } {
  let count = 0;  // variable dans le scope de createCounter

  return {
    increment() { count++; },
    getCount() { return count; }
  };
}

const counter = createCounter();
// createCounter() a terminé, son stack frame est dépilé
// MAIS le LexicalEnvironment de createCounter reste en mémoire
// car counter.increment et counter.getCount y font référence via [[Environment]]

counter.increment();
counter.increment();
console.log(counter.getCount()); // 2
```

```
         HEAP (mémoire)

         ┌────────────────────────────┐
         │  LexicalEnvironment de     │
         │  createCounter             │
         │  ┌──────────────────┐      │
         │  │ count: 2         │      │◄──────── [[Environment]]
         │  └──────────────────┘      │          de increment()
         │                            │◄──────── [[Environment]]
         └────────────────────────────┘          de getCount()

         Le stack frame de createCounter() est détruit
         mais son environnement lexical survit dans le heap
```

### 5. Ce que les closures retiennent réellement en mémoire

> **Nouveau concept : Stack vs Heap**
>
> La mémoire de ton programme est divisée en deux zones :
>
> - **La stack (pile)** — petite, rapide, automatique. C'est là que vivent les variables locales simples (nombres, booléens) et les stack frames. Quand une fonction se termine, son espace sur la stack est libéré automatiquement.
> - **Le heap (tas)** — grand, plus lent, géré par le Garbage Collector. C'est là que vivent les objets, tableaux, fonctions, et tout ce qui peut survivre après la fin d'une fonction.
>
> ```
> Stack (pile)              Heap (tas)
> ┌─────────────┐          ┌──────────────────┐
> │ main()      │          │ { name: "Alice" } │◄── référence
> │  x = 42     │          │ [1, 2, 3]         │◄── référence
> │  y = true   │          │ function() {...}   │◄── référence
> │  obj ───────┼─────────►│                    │
> └─────────────┘          └──────────────────┘
> ```
>
> **Règle simple** : les valeurs primitives (`number`, `boolean`, `string` court) vivent sur la stack. Tout le reste (objets, tableaux, fonctions) vit sur le heap, et la stack contient juste une **référence** (une adresse) vers le heap.
>
> C'est important pour les closures : quand une closure capture une variable qui référence un objet, elle garde la référence vivante, ce qui empêche le Garbage Collector de libérer l'objet du heap.

Point critique : en théorie (selon la spec), une closure retient l'**intégralité** de l'objet de scope (EnvironmentRecord) de son contexte englobant, **pas seulement** les variables qu'elle utilise.

```typescript
function createClosure(): () => number {
  const bigArray = new Array(1_000_000).fill('data');  // ~8 Mo
  const smallValue = 42;

  return function(): number {
    return smallValue; // n'utilise que smallValue
  };
}

const fn = createClosure();
// En théorie : bigArray est AUSSI retenu en mémoire
// car il fait partie du même EnvironmentRecord
```

**Optimisation de V8** : en pratique, V8 effectue une analyse statique et ne retient que les variables **réellement référencées** par la closure. C'est le mécanisme de **Context specialization** (spécialisation de contexte). Dans l'exemple ci-dessus, V8 libérera `bigArray`.

**ATTENTION** : cette optimisation a des limites :

```typescript
function createClosure(): () => unknown {
  const bigArray = new Array(1_000_000).fill('data');
  const smallValue = 42;

  return function(): unknown {
    return eval('bigArray'); // eval() empêche l'optimisation !
  };
}
// V8 ne peut pas analyser statiquement eval()
// → bigArray est forcément retenu
```

De même, si **deux closures** partagent le même scope, une seule a besoin d'une variable, mais **les deux** partagent le même objet Context :

```typescript
function outer(): () => number {
  const bigData = new Array(1_000_000).fill('x');
  const small = 1;

  function usesSmall(): number { return small; }
  function usesBig(): number { return bigData.length; }

  return usesSmall; // on ne retourne QUE usesSmall
  // usesBig n'est pas retourné, mais bigData sera-t-il GC ?
}
// Réponse : OUI, car usesBig n'est pas référencé.
// Dans V8, le Context objet ne retient que small.
// MAIS si les DEUX fonctions étaient retournées, le Context contiendrait tout.
// NOTE : ce comportement de rétention sélective est une optimisation
// spécifique à V8 (context specialization). La spécification ECMAScript
// ne le garantit pas. D'autres moteurs (SpiderMonkey, JSC) peuvent
// implémenter des stratégies différentes.
```

### 6. Inspecter `[[Scopes]]` dans les DevTools

On peut observer concrètement ce que capture une closure en utilisant les DevTools du navigateur. C'est un excellent outil pour comprendre et déboguer le comportement des closures.

#### Chrome DevTools (V8)

Dans la console Chrome, utilise `console.dir()` pour inspecter le slot interne `[[Scopes]]` d'une fonction :

```typescript
function outer(): () => number {
  const secret = 42;
  const message = 'hello';

  return function inner(): number {
    return secret;
  };
}

const myFunc = outer();
console.dir(myFunc);

// Dans la console Chrome, déploie l'objet affiché.
// Tu verras :
//
// ƒ inner()
//   length: 0
//   name: "inner"
//   ...
//   [[Scopes]]: Scopes[2]
//     0: Closure (outer)
//       secret: 42            ← capturé par la closure
//       (message n'apparaît PAS — V8 l'a éliminé !)
//     1: Global
//       ...
```

```
┌────────────────────────────────────────────────────────────────┐
│  Console Chrome — console.dir(myFunc)                          │
│                                                                │
│  ▼ ƒ inner()                                                   │
│      length: 0                                                 │
│      name: "inner"                                             │
│    ▼ [[Scopes]]: Scopes[2]                                     │
│      ▼ 0: Closure (outer)        ← l'environnement capturé    │
│          secret: 42              ← seule variable capturée     │
│      ▶ 1: Global                 ← le scope global             │
└────────────────────────────────────────────────────────────────┘
```

> 💡 **Astuce** : c'est un excellent moyen de vérifier si V8 a bien libéré les variables inutilisées. Si `message` n'apparaît pas dans `[[Scopes]]`, c'est que V8 l'a éliminé grâce au Context specialization.

#### Firefox DevTools (SpiderMonkey)

Dans Firefox, l'inspection est similaire mais avec une interface différente :

1. Ouvre les DevTools (`F12`)
2. Va dans l'onglet **Débogueur** (Debugger)
3. Place un breakpoint **à l'intérieur** de la closure
4. Quand l'exécution s'arrête, regarde le panneau **Portées** (Scopes) à droite

```
┌────────────────────────────────────────────────────────────────┐
│  Firefox DevTools — Débogueur (breakpoint dans inner())        │
│                                                                │
│  ▼ Portées                                                     │
│    ▼ Bloc                                                      │
│        (variables du bloc courant)                             │
│    ▼ outer()                     ← l'environnement de closure  │
│        secret: 42                ← variable capturée           │
│    ▶ Fenêtre (Window)            ← le scope global             │
└────────────────────────────────────────────────────────────────┘
```

Tu peux aussi utiliser `console.dir()` dans la console Firefox, mais l'affichage des `[[Scopes]]` internes est moins détaillé que dans Chrome. L'onglet Débogueur avec un breakpoint est la méthode la plus fiable dans Firefox.

### 7. Closures et fuites mémoire (Memory Leaks)

Les closures sont la cause numéro un de fuites mémoire en JavaScript :

```typescript
// Fuite classique : event listeners non nettoyés
function setupHandler(): void {
  const hugeData = new Array(10_000_000).fill('leak');

  document.getElementById('btn').addEventListener('click', function handler() {
    console.log(hugeData.length);
  });

  // hugeData reste en mémoire tant que le listener existe
  // Solution : removeEventListener quand le composant est détruit
}
```

```typescript
// Fuite classique : timers
function startPolling(): void {
  const cache: Record<string, number[]> = {};

  setInterval(() => {
    cache[Date.now()] = new Array(10000);
    // cache grandit indéfiniment
    // la closure empêche le GC de libérer cache
  }, 1000);
}
```

> 💡 **Rappel** : une **fuite mémoire** (memory leak), ce n'est pas un crash. C'est de la mémoire qui est réservée mais plus jamais utilisée, et que le ramasse-miettes ne peut pas libérer. L'application consomme de plus en plus de RAM au fil du temps, jusqu'à devenir lente ou planter.

### 8. Closures et hidden classes / inline caches (V8)

> 💡 **Rappel** : cette section est plus avancée. L'idée principale est que les closures peuvent avoir un impact sur les performances du moteur au-delà de la simple mémoire. Si ça te semble complexe, retiens juste le résumé à la fin.

V8 utilise des **hidden classes** (décrivant la "forme" d'un objet — quelles propriétés, dans quel ordre) et des **inline caches** (IC — le moteur mémorise l'emplacement mémoire d'une propriété pour y accéder plus vite la prochaine fois). Les closures stockent leurs variables capturées dans un objet **Context** qui est soumis à ces mêmes mécanismes.

```typescript
function createPair(name: string): { getName(): string; setName(n: string): void } {
  // V8 crée un objet Context : { name: ... }
  return {
    getName() { return name; },
    setName(n: string) { name = n; }
  };
}

const pair1 = createPair('Alice');
const pair2 = createPair('Bob');
// pair1 et pair2 ont des Context objects avec la même "forme"
// → ils partagent la même hidden class
// → V8 peut utiliser les inline caches efficacement
```

**Quand ça se dégrade** : si la forme des Context objects varie (par exemple à cause d'`eval()` ou de code dynamique qui ajoute des variables), les inline caches deviennent **polymorphiques** ou **mégamorphiques**, et l'accès aux variables de closure ralentit significativement.

```typescript
// Mauvais pattern : eval() casse le Context specialization
function createBroken(code: string): () => number {
  let x = 1;
  eval(code); // V8 ne peut pas optimiser le Context
  return () => x;
}
// Le Context object de chaque appel peut avoir une forme différente
// → pas de hidden class partagée → inline caches inefficaces
```

**Résumé** : les closures fonctionnent très bien en termes de performance quand les fonctions capturent les mêmes variables de manière prévisible. Évite `eval()` et le code dynamique dans les closures si la performance est critique.

### 9. L'instruction `with` et son impact sur la chaîne de scopes

> 💡 **Rappel** : `with` est une instruction JavaScript qui permet d'ajouter un objet temporairement en tête de la chaîne de scopes. Elle est **interdite** en mode strict et fortement déconseillée. On l'explique ici pour la culture et parce que tu peux la rencontrer dans du vieux code.

```typescript
const obj = { x: 10, y: 20 };

with (obj) {
  console.log(x);     // 10 — résolu via obj.x
  console.log(y);     // 20 — résolu via obj.y
  console.log(Math);  // [object Math] — pas dans obj, résolu dans le scope parent
}
```

`with` crée un **objet de scope dynamique** qui est inséré en tête de la chaîne de scopes, entre la fonction courante et son scope parent. Le problème : le moteur ne peut pas savoir à l'avance quelles propriétés l'objet contiendra, ce qui empêche la résolution statique des variables, rend les inline caches inutiles, et bloque le Context specialization. C'est pourquoi `with` est interdit en `"use strict"` et génère une `SyntaxError`.

### 10. Impact d'`eval()` sur les closures

On a vu dans le module 01 que `eval()` est problématique. Voici son impact spécifique sur les closures : `eval()` empêche le Context specialization car le moteur ne peut pas savoir statiquement quelles variables seront accédées.

```typescript
function withoutEval(): () => number {
  const a = 1, b = 2, c = new Array(1_000_000).fill('data'); // 8 Mo
  return function(): number { return a; };
}
// V8 libère b et c → Context ne contient que { a: 1 } → ~0 Mo

function withEval(): () => unknown {
  const a = 1, b = 2, c = new Array(1_000_000).fill('data'); // 8 Mo
  return function(): unknown { return eval('c.length'); }; // eval → tout est retenu
}
// V8 DOIT conserver a, b ET c → Context contient tout → ~8 Mo
```

**Règle pratique** : ne jamais utiliser `eval()` à l'intérieur d'une closure. Si tu as besoin de code dynamique, utilise des `Map`, des objets de lookup, ou des template literals.

### 11. Module Pattern et IIFE

Le **Module Pattern** exploite les closures pour créer de l'encapsulation (variables privées) :

```typescript
const module = (function() {
  // IIFE crée un scope isolé
  let _private = 0;          // inaccessible depuis l'extérieur
  const _SECRET = 'hidden';

  function _internalHelper(): number {
    return _private * 2;
  }

  // L'objet retourné est une closure qui capture tout le scope
  return {
    increment() { _private++; },
    getValue() { return _internalHelper(); },
    // _SECRET n'est pas exposé mais reste en mémoire
    // car il partage le même Context que les fonctions exposées
  };
})();

module.increment();
console.log(module.getValue()); // 2
console.log(module._private);   // undefined (encapsulation)
```

L'**IIFE** (Immediately Invoked Function Expression — expression de fonction immédiatement invoquée) crée un contexte d'exécution immédiatement, puis celui-ci est dépilé de la stack — mais son environnement lexical survit dans le heap via les closures retournées. Le stack frame disparaît, le Context (avec `_private`, `_SECRET`, `_internalHelper`) reste vivant.

### 12. Block scoping et closures

Avec `let` et `const`, chaque itération d'une boucle `for` crée un **nouveau** LexicalEnvironment :

```typescript
// Piège classique avec var
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// Affiche : 3, 3, 3 (une seule variable i partagée)

// Solution avec let
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// Affiche : 0, 1, 2 (un i distinct par itération)
```

```
Avec var :                          Avec let :
┌──────────────────┐                ┌──────────────────┐
│  Scope unique    │                │  Itération 0     │
│  i: 3 (finale)   │                │  i: 0            │
│                  │                ├──────────────────┤
│  closure 0 ──────┼─┐              │  Itération 1     │
│  closure 1 ──────┼─┤   même i     │  i: 1            │
│  closure 2 ──────┼─┘              ├──────────────────┤
└──────────────────┘                │  Itération 2     │
                                    │  i: 2            │
                                    └──────────────────┘
                                    Chaque closure capture son propre i
```

### 13. WeakRef et FinalizationRegistry

ES2021 a introduit deux outils pour travailler avec le ramasse-miettes :

#### WeakRef

Une `WeakRef` (référence faible) contient une référence vers un objet qui **n'empêche pas** le GC de le collecter. Contrairement à une référence normale (dite "forte"), la WeakRef dit au GC : "tu peux supprimer cet objet si tu en as besoin, je m'en remettrai."

```typescript
let target: { data: string } | null = { data: 'important' };
const weakRef = new WeakRef<{ data: string }>(target);

console.log(weakRef.deref()); // { data: 'important' }

target = null; // plus de référence forte

// Après un cycle de GC :
// weakRef.deref() retournera undefined (l'objet a été collecté)
```

#### FinalizationRegistry

Permet d'enregistrer un **callback** (fonction de rappel) qui sera appelé quand un objet est collecté par le GC :

```typescript
const registry = new FinalizationRegistry<string>((heldValue: string) => {
  console.log(`Objet avec tag "${heldValue}" a été collecté par le GC`);
});

let obj = { heavy: new Array(1_000_000) };
registry.register(obj, 'mon-objet-lourd');

obj = null;
// Éventuellement : "Objet avec tag "mon-objet-lourd" a été collecté par le GC"
```

**Attention** : le timing du callback n'est **pas garanti**. Le GC peut ne jamais s'exécuter (si le programme se termine avant). Ne jamais utiliser `FinalizationRegistry` pour de la logique métier critique.

### 14. Diagramme mémoire complet d'une closure

```typescript
function createAdder(x: number): (y: number) => number {
  return function adder(y: number): number {
    return x + y;
  };
}
const add5 = createAdder(5);
const add10 = createAdder(10);
```

```
          STACK                                HEAP
     ┌────────────┐
     │ Global EC  │
     │            │          ┌─────────────────────────────────┐
     │ add5 ──────┼─────────►│ Function: adder                │
     │            │          │ [[Environment]] ────┐           │
     │ add10 ─────┼────┐     └─────────────────────┼───────────┘
     └────────────┘    │                            │
                       │     ┌──────────────────────▼──────────┐
                       │     │ Context (createAdder appel #1)  │
                       │     │  x: 5                           │
                       │     └─────────────────────────────────┘
                       │
                       │     ┌─────────────────────────────────┐
                       └─────►│ Function: adder                │
                              │ [[Environment]] ────┐           │
                              └─────────────────────┼───────────┘
                                                    │
                              ┌──────────────────────▼──────────┐
                              │ Context (createAdder appel #2)  │
                              │  x: 10                          │
                              └─────────────────────────────────┘

     Deux appels à createAdder → deux Context objects distincts
     Chaque closure capture SON propre environnement
```

### 15. Comparaison : V8 vs SpiderMonkey

Les concepts fondamentaux (portée lexicale, closures, chaîne de scopes) sont définis dans la **spécification ECMAScript** et sont donc **identiques** dans tous les moteurs. Cependant, l'implémentation interne diffère.

#### Terminologie des objets d'environnement

| Concept (spec) | V8 (Chrome, Node.js) | SpiderMonkey (Firefox) |
|----------------|----------------------|------------------------|
| Environnement lexical capturé | **Context** object | **EnvironmentObject** |
| Scope chain interne | Chaîne de Context objects | Chaîne d'EnvironmentObject |
| Optimisation de closure | **Context specialization** | **Scope pruning** (élagage de scope) |
| Slot interne de la fonction | `[[Environment]]` → Context | `[[Environment]]` → EnvironmentObject |

#### Représentation de la chaîne de scopes

Dans V8, les closures capturent un objet **Context** dans le heap, et la chaîne de scopes est une chaîne de Context objects. Dans SpiderMonkey, le concept équivalent est l'**EnvironmentObject**, décliné en sous-types plus granulaires : **CallObject** (variables de fonction), **LexicalEnvironmentObject** (blocs `let`/`const`), **WithEnvironmentObject** (blocs `with`), et **VarEnvironmentObject** (bindings `var` séparés).

#### Stratégies d'optimisation des closures

Les deux moteurs partagent le même objectif : ne placer dans le heap que les variables réellement capturées par une closure.

- **V8 — Context specialization** : analyse statique pour ne créer un Context que pour les variables référencées. Les autres restent dans le stack frame et sont libérées normalement.
- **SpiderMonkey — Scope pruning** : lors de l'analyse du bytecode, SpiderMonkey identifie les variables qui "s'échappent" vers une closure et ne place que celles-ci dans un EnvironmentObject sur le heap.

#### Inspecter les closures dans Firefox DevTools

Dans Firefox : ouvre les DevTools (`F12`) → onglet **Débogueur** → place un breakpoint dans la closure → regarde le panneau **Portées** (Scopes) à droite. Tu y verras les variables locales, les variables de closure (regroupées sous le nom de la fonction parente), et les variables globales.

> 💡 **Différence pratique** : dans Chrome, `console.dir(fn)` montre un slot `[[Scopes]]` explicite. Dans Firefox, utilise plutôt le panneau Portées du Débogueur pour une vue complète.

#### Ce qui est identique (spécification)

- La portée lexicale fonctionne de la même manière
- Les closures capturent l'environnement via `[[Environment]]`
- La chaîne de scopes est résolue de la même façon (du plus local au plus global)
- `let` dans une boucle `for` crée un environnement distinct par itération
- `eval()` empêche les optimisations dans les deux moteurs

#### Ce qui diffère (implémentation)

- La terminologie interne (Context vs EnvironmentObject)
- Les sous-types d'objets d'environnement (SpiderMonkey est plus granulaire)
- Les heuristiques exactes d'optimisation des closures
- L'interface DevTools pour inspecter les scopes

---

## Démonstration

### Demo 1 : Mesurer la mémoire retenue par une closure

```typescript
// Node.js
function getMemoryMB(): string {
  const mem = process.memoryUsage();
  return (mem.heapUsed / 1024 / 1024).toFixed(2);
}

console.log(`Avant : ${getMemoryMB()} MB`);

const closures: (() => number)[] = [];

for (let i = 0; i < 100; i++) {
  const bigArray = new Array(100_000).fill(`data-${i}`);

  closures.push(function() {
    return bigArray.length; // closure capture bigArray
  });
}

console.log(`Après closures : ${getMemoryMB()} MB`);

// Libérer les closures
closures.length = 0;

// Forcer le GC (nécessite --expose-gc)
if ((globalThis as any).gc) {
  (globalThis as any).gc();
  console.log(`Après GC : ${getMemoryMB()} MB`);
}

// Exécuter avec : node --expose-gc demo.js
```

### Demo 2 : Prouver que le scope est lexical, pas dynamique

```typescript
const scope = 'global';

function printScope(): void {
  console.log(scope); // résolu au moment de la CRÉATION de printScope
}

function wrapper(): void {
  const scope = 'local';
  printScope(); // affiche 'global', pas 'local'
}

wrapper();
```

### Demo 3 : Observer le partage de Context entre closures

```typescript
function shared(): { getA(): number; getB(): number; setA(val: number): void } {
  let a = 1;
  let b = 2;

  function getA(): number { return a; }
  function getB(): number { return b; }
  function setA(val: number): void { a = val; }

  return { getA, getB, setA };
}

const obj = shared();
console.log(obj.getA()); // 1
obj.setA(999);
console.log(obj.getA()); // 999 — prouve que getA et setA partagent le même Context
console.log(obj.getB()); // 2
```

### Demo 4 : WeakRef en action

```typescript
// Node.js avec --expose-gc

let bigObject: { data: string[] } | null = { data: new Array(1_000_000).fill('x') };
const ref = new WeakRef<{ data: string[] }>(bigObject);

console.log('Avant null :', ref.deref() ? 'vivant' : 'collecté');

bigObject = null; // supprime la référence forte

(globalThis as any).gc(); // force le GC

console.log('Après GC :', ref.deref() ? 'vivant' : 'collecté');
// "Après GC : collecté"
```

### Demo 5 : Fuite mémoire classique avec closures

```typescript
// Exemple de fuite : closures qui s'accumulent
const leaked: (() => string[])[] = [];

function createLeak(): void {
  const heavy = new Array(1_000_000).fill('leak');
  leaked.push(() => heavy); // chaque closure retient 1M d'éléments
}

for (let i = 0; i < 50; i++) {
  createLeak();
  const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  console.log(`Itération ${i}: ${mem} MB`);
}
// Observe une croissance linéaire de la mémoire
```

### Demo 6 : Inspecter `[[Scopes]]` dans Chrome

```typescript
// Copie-colle dans la console Chrome (F12 → Console)
function createGreeter(greeting: string): (name: string) => string {
  const prefix = '[LOG]';
  const unusedData = 'will this be captured?';
  return function greet(name: string): string { return `${prefix} ${greeting}, ${name}!`; };
}
const hello = createGreeter('Bonjour');
console.dir(hello);
// Déploie l'objet → [[Scopes]] → Closure (createGreeter) :
//   greeting: "Bonjour", prefix: "[LOG]"
//   (unusedData n'apparaît PAS → V8 l'a éliminé)
console.log(hello('Marie')); // "[LOG] Bonjour, Marie!"
```

### Demo 7 : Impact de `with` sur la résolution de scope

```typescript
// ATTENTION : ne fonctionne PAS en mode strict — présenté à titre éducatif
const obj = { x: 'with-scope' };

function demo(): void {
  const x = 'local';
  with (obj) {
    console.log(x); // 'with-scope' — obj est en tête de la chaîne de scopes
  }
  console.log(x);   // 'local' — hors du with, retour au scope normal
}
demo();
```

---

## Points clés

1. JavaScript utilise la **portée lexicale** : le scope est déterminé par la position dans le code source, pas par le flux d'exécution.
2. Une **closure** = une fonction + une référence vers son environnement lexical de création (`[[Environment]]`) — comme un sac à dos que la fonction emporte avec elle.
3. Les closures retiennent l'**objet Context entier** (EnvironmentRecord) de leur scope parent, pas seulement les variables utilisées (bien que V8 optimise cela via **Context specialization**).
4. Les closures sont la source principale de **fuites mémoire** : elles empêchent le GC de collecter les variables capturées tant qu'elles existent.
5. `eval()` et `with` empêchent les optimisations de closure — **ne jamais les utiliser** dans du code de production.
6. `WeakRef` et `FinalizationRegistry` permettent d'interagir avec le GC mais ne doivent pas être utilisés pour de la logique critique.
7. Le **Module Pattern** (IIFE + closure) exploite les closures pour l'encapsulation.
8. `let` dans une boucle `for` crée un nouveau LexicalEnvironment par itération, résolvant le piège classique de `var`.
9. Dans **V8**, les closures stockent leur scope dans un objet **Context** ; dans **SpiderMonkey**, l'équivalent est l'**EnvironmentObject**. Les deux moteurs optimisent pour ne retenir que les variables réellement capturées.
10. On peut inspecter les closures dans **Chrome** (`console.dir(fn)` → `[[Scopes]]`) et dans **Firefox** (Débogueur → panneau Portées).

---

---

## Pour aller plus loin

- [V8 Blog — Blazingly fast parsing](https://v8.dev/blog/scanner) — contient des informations pertinentes sur la gestion des scopes dans V8
- [ECMAScript Specification — Lexical Environments](https://tc39.es/ecma262/#sec-lexical-environments)
- [MDN — Closures](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures)
- [MDN — with statement](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/with)
- [WeakRef TC39 Proposal](https://github.com/tc39/proposal-weakrefs)
- [Chrome DevTools — Memory Profiling](https://developer.chrome.com/docs/devtools/memory-problems/)
- [Firefox DevTools — Debugger Scopes](https://firefox-source-docs.mozilla.org/devtools-user/debugger/)
- [Dmitry Soshnikov — JavaScript Core: Scope Chain](http://dmitrysoshnikov.com/ecmascript/chapter-4-scope-chain/)
- [V8 Blog — Understanding V8's Bytecode](https://medium.com/nicolo-ribaudo/understanding-v8s-bytecode-317d46c94775)
- [SpiderMonkey — Architecture overview](https://firefox-source-docs.mozilla.org/js/index.html)

---

## Si tu es perdu

Voici un résumé ultra-simplifié de ce module. Si tu as compris ces points, tu as saisi l'essentiel :

1. **Le scope** = la zone du code ou une variable est accessible. C'est déterminé par **où** tu écris le code, pas par quand il s'exécute.

2. **La chaîne de scopes** = quand le moteur cherche une variable, il regarde d'abord dans le scope actuel, puis dans le scope parent, puis dans le parent du parent, etc. Comme remonter les étages d'un immeuble pour trouver quelqu'un.

3. **Une closure** = un sac à dos. Quand une fonction est créée à l'intérieur d'une autre fonction, elle emporte avec elle les variables de la fonction parente. Même si la fonction parente a fini de s'exécuter et a été retirée de la call stack, les variables dans le sac à dos survivent.

4. **Les fuites mémoire** = quand une closure retient des données dont elle n'a plus besoin. Comme un sac à dos trop lourd qu'on oublie de vider. Les causes les plus fréquentes : les event listeners oubliés et les timers qui tournent indéfiniment.

5. **V8 et SpiderMonkey** capturent les closures de la même manière (c'est dans la spec), mais utilisent des noms différents pour leurs structures internes. L'important c'est le concept, pas le nom du tiroir.

---

## Défi

Quel est l'affichage de ce code ? Pourquoi ?

```typescript
function createFunctions(): (() => void)[] {
  const result: (() => void)[] = [];

  for (var i = 0; i < 3; i++) {
    result.push(
      (function(j) {
        return function() {
          console.log(j);
        };
      })(i)
    );
  }

  return result;
}

const fns = createFunctions();
fns[0](); // ???
fns[1](); // ???
fns[2](); // ???
```

<details>
<summary>Réponse</summary>

```
0
1
2
```

**Explication** :
Bien que `var` soit utilisé (un seul `i` partagé dans le scope de `createFunctions`), chaque itération invoque immédiatement une IIFE qui capture la **valeur courante** de `i` dans le paramètre `j`. Chaque closure interne capture un `j` distinct (dans le scope de l'IIFE), pas le `i` partagé.

C'est le pattern classique pré-ES6 pour résoudre le problème de closure dans les boucles. Avec ES6+, il suffit d'utiliser `let i` à la place de `var i`.

</details>

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 02 scope closures](../screencasts/screencast-02-scope-closures.md)
2. **Lab** : [lab-02-closure-memory](../labs/lab-02-closure-memory/README)
3. **Quiz** : [quiz 02 scope closures](../quizzes/quiz-02-scope-closures.html)
:::
