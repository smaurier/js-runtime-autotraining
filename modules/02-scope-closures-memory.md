---
titre: Scope, closures et mémoire
cours: 01-js-runtime
notions: [portée lexicale, chaîne de scopes, closure et capture de l'environnement lexical, variable environment vs closure scope, piège var dans une boucle vs let, closures et rétention mémoire, IIFE et module pattern]
outcomes: [expliquer comment le moteur résout une variable via la chaîne de scopes, décrire ce qu'une closure capture réellement en mémoire, diagnostiquer une fuite mémoire causée par une closure et l'encapsuler avec le module pattern]
prerequis: [01-call-stack-execution-context]
next: 03-event-loop
libs: []
tribuzen: closure d'un handler admin qui retient la liste des familles (fuite) et module pattern pour encapsuler un cache
last-reviewed: 2026-07
---

# Scope, closures et mémoire

> **Outcomes — tu sauras FAIRE :** expliquer comment le moteur résout une variable via la chaîne de scopes, décrire ce qu'une closure capture réellement en mémoire, diagnostiquer une fuite mémoire causée par une closure et l'encapsuler proprement avec le module pattern.
> **Difficulté :** :star::star:

## 1. Cas concret d'abord

Tu reprends l'admin TribuZen. Un collègue a écrit ce composant qui affiche la liste des familles et rafraîchit un compteur. Depuis quelques jours, l'onglet admin devient de plus en plus lent quand on y reste longtemps.

```tsx
// FamilyDashboard.tsx — AVANT (fuite mémoire)
function FamilyDashboard() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // families : ~50 000 familles chargées une fois, ~40 Mo en mémoire
    const families = loadAllFamilies();

    const id = setInterval(() => {
      // le handler ne lit QUE families.length, mais capture tout `families`
      console.log(`Familles suivies : ${families.length}`);
      setTick(t => t + 1);
    }, 1000);

    // ❌ pas de return () => clearInterval(id)
  }, []);

  return <div>Ticks : {tick}</div>;
}
```

**Ce qui cloche, sans que ce soit visible à l'œil nu :**

1. Le callback de `setInterval` est une **closure** : il garde une référence vivante vers `families` (40 Mo).
2. Tant que l'`interval` tourne, le Garbage Collector **ne peut pas** libérer `families` — même après que le composant a été démonté.
3. Chaque remontage du composant crée un nouvel `interval` + un nouveau `families` → la mémoire grimpe en escalier.

Pour comprendre *pourquoi* cette closure retient 40 Mo, et comment corriger, il faut d'abord savoir ce qu'une closure capture réellement. C'est tout ce module. Le diagnostic complet des fuites est approfondi au **module 08 — Memory leaks** ; ici on établit la mécanique qui les rend possibles.

---

## 2. Théorie complète, concise

### 2.1 Portée lexicale (lexical scope)

La **portée** d'une variable, c'est la zone du code où elle est accessible. JavaScript utilise la **portée lexicale** (dite *statique*) : la portée d'une variable est déterminée par sa **position dans le code source**, pas par l'endroit d'où la fonction est appelée.

```typescript
const x = 'global';

function outer(): () => void {
  const x = 'outer';

  function inner(): void {
    console.log(x); // 'outer' — résolu là où inner est ÉCRIT, pas appelé
  }

  return inner;
}

const fn = outer();
fn(); // 'outer', même appelée depuis le scope global
```

Point de discrimination essentiel : la **structure** de la chaîne de scopes (quel scope est imbriqué dans quel autre) est figée dès le **parsing**, avant toute exécution. Seules les **valeurs** des variables sont remplies au runtime. Le moteur sait donc *où* chercher `x` avant même de connaître sa valeur.

### 2.2 Chaîne de scopes (scope chain)

Rappel du module 01 : chaque contexte d'exécution possède un `LexicalEnvironment` avec une référence `outer` vers l'environnement lexical parent. Ces références forment une **chaîne**.

Quand le moteur rencontre un identifiant, il le résout en **remontant** la chaîne, maillon par maillon, du plus local au plus global :

```
Résolution de `x` depuis inner :
  1. inner   -> EnvironmentRecord : pas trouvé
  2. outer   -> EnvironmentRecord : { x: 'outer' } -> TROUVÉ (on s'arrête)
  3. global  -> jamais consulté

Si on arrive au global sans trouver -> ReferenceError.
```

La recherche s'arrête au **premier** maillon qui déclare l'identifiant. C'est le mécanisme du **shadowing** (masquage) : le `x` de `outer` masque le `x` global pour tout ce qui est à l'intérieur de `outer`.

### 2.3 Ce qu'est une closure — l'image

**Une closure, c'est un sac à dos que la fonction emporte quand elle quitte sa maison (son scope).** Une fonction `inner()` née dans `outer()` : quand `outer()` se termine, son stack frame est dépilé et devrait disparaître. Mais si `inner()` a été retournée vers l'extérieur, elle emporte dans son sac à dos les variables de `outer()` dont elle a besoin, et peut y accéder n'importe où, plus tard.

### 2.4 Ce qu'est une closure — la définition technique

Une **closure** est la combinaison d'une fonction **et** d'une référence vers l'environnement lexical dans lequel elle a été **créée** (pas appelée — créée). Ce n'est pas la fonction seule.

À la création d'une fonction, le moteur stocke dans un slot interne `[[Environment]]` une référence vers le `LexicalEnvironment` courant. Cette référence est ce qui maintient l'environnement vivant.

```typescript
function createCounter(): { increment(): void; get(): number } {
  let count = 0; // vit dans le scope de createCounter

  return {
    increment() { count++; },
    get() { return count; },
  };
}

const counter = createCounter();
// createCounter() a fini, son stack frame est dépilé...
// ...mais son environnement lexical { count } SURVIT dans le heap,
// car increment et get y référent via [[Environment]].

counter.increment();
counter.increment();
console.log(counter.get()); // 2
```

```
          STACK                       HEAP
   ┌──────────────┐
   │ Global EC    │        ┌────────────────────────────────┐
   │ counter ─────┼───────►│ { increment, get }             │
   └──────────────┘        │   [[Environment]] ─────┐       │
   (stack frame de         └────────────────────────┼───────┘
    createCounter                                   ▼
    déjà détruit)          ┌────────────────────────────────┐
                           │ Environnement de createCounter │
                           │   count: 2                     │  ← survit
                           └────────────────────────────────┘
```

### 2.5 Variable environment vs closure scope

Deux notions à ne pas confondre :

- Le **VariableEnvironment / EnvironmentRecord** est la structure *interne* d'un contexte d'exécution (vue au module 01) : c'est là que vivent les bindings `var`, `let`, `const`, `function` **pendant** que le contexte est actif sur la stack.
- Le **closure scope** est ce même environnement lexical *une fois qu'une closure le maintient vivant* après la fin du contexte. La donnée n'a pas bougé : c'est la **durée de vie** qui change. Sans closure, l'environnement meurt avec le stack frame ; avec closure, il migre logiquement dans le heap et survit tant qu'une fonction le référence.

Autrement dit : le closure scope, c'est un environnement lexical qui a « survécu » à son contexte d'exécution parce qu'une fonction le tient par `[[Environment]]`.

### 2.6 Ce qu'une closure retient RÉELLEMENT

Point critique, souvent mal compris. Selon la spécification, une closure retient l'**intégralité** de l'environnement de son scope englobant — **pas seulement** les variables qu'elle lit.

```typescript
function make(): () => number {
  const bigArray = new Array(1_000_000).fill('data'); // ~8 Mo
  const smallValue = 42;

  return function (): number {
    return smallValue; // ne lit QUE smallValue...
  };
}

const fn = make();
// ...mais en théorie, bigArray est AUSSI retenu :
// il fait partie du même environnement lexical.
```

**Optimisation V8 (context specialization)** : en pratique, V8 analyse statiquement la closure et ne conserve dans son objet `Context` que les variables **réellement référencées**. Ici, V8 libère `bigArray`. On peut le vérifier dans les DevTools (`console.dir(fn)` → `[[Scopes]]`).

**Les limites de l'optimisation** — deux cas où le gros objet est quand même retenu :

```typescript
// (1) eval() empêche l'analyse statique -> tout est retenu
function withEval(): () => unknown {
  const bigArray = new Array(1_000_000).fill('data');
  return () => eval('bigArray.length'); // V8 ne peut rien élaguer
}

// (2) deux closures partageant le même scope partagent le même Context
function two() {
  const bigData = new Array(1_000_000).fill('x');
  const small = 1;
  const usesSmall = () => small;
  const usesBig = () => bigData.length;
  return { usesSmall, usesBig }; // les DEUX retournées -> bigData retenu
}
```

À retenir : cette rétention sélective est une **optimisation V8**, pas une garantie de la spec. Ne construis jamais ton code en pariant dessus — encapsule proprement (section 2.8).

### 2.7 Closures et rétention mémoire → fuites (pont module 08)

Une closure **empêche le GC de collecter** les variables qu'elle capture, tant que la closure elle-même est joignable. C'est utile (le compteur ci-dessus), mais c'est aussi la **cause n°1 de fuites mémoire** en JavaScript.

Une **fuite mémoire** n'est pas un crash : c'est de la mémoire réservée mais **plus jamais utilisée**, que le GC ne peut pas récupérer parce qu'une référence vivante subsiste. L'appli enfle jusqu'à ralentir ou planter.

Les deux vecteurs classiques, tous deux basés sur une closure retenue :

```typescript
// (a) event listener jamais retiré
function setup(): void {
  const hugeData = new Array(10_000_000).fill('leak');
  document.getElementById('btn')!.addEventListener('click', function handler() {
    console.log(hugeData.length); // handler retient hugeData...
  });
  // ...tant que le listener n'est pas removeEventListener -> fuite
}

// (b) timer jamais nettoyé (= exactement le cas concret du §1)
function poll(): void {
  const cache: number[] = [];
  setInterval(() => {
    cache.push(Date.now()); // cache grandit indéfiniment
    // la closure du callback maintient cache vivant pour toujours
  }, 1000);
}
```

Le fil conducteur : **une closure vivante = son scope entier reste vivant.** Si ce scope contient un gros objet, l'objet fuit. Le **module 08** systématise le diagnostic (heap snapshots, comparaison, retainers) ; ici tu dois savoir *reconnaître* le motif : une closure à longue durée de vie (listener, timer, callback stocké dans une structure globale) qui capture un gros objet.

### 2.8 IIFE et module pattern — encapsuler proprement

L'**IIFE** (*Immediately Invoked Function Expression* — fonction déclarée et appelée sur-le-champ) crée un scope isolé qui est immédiatement exécuté puis dépilé de la stack — mais dont l'environnement lexical peut survivre via les closures retournées.

Le **module pattern** exploite ça pour créer des **variables privées** : ce qui n'est pas exposé dans l'objet retourné reste inaccessible de l'extérieur, tout en restant vivant pour les fonctions internes.

```typescript
const cache = (function () {
  // scope privé — inaccessible depuis l'extérieur
  const store = new Map<string, unknown>();
  let hits = 0;

  return {
    get(key: string): unknown {
      if (store.has(key)) hits++;
      return store.get(key);
    },
    set(key: string, value: unknown): void {
      store.set(key, value);
    },
    stats(): { size: number; hits: number } {
      return { size: store.size, hits };
    },
  };
})();

cache.set('fam-1', { name: 'Dupont' });
cache.get('fam-1');
console.log(cache.stats()); // { size: 1, hits: 1 }
// cache.store -> undefined : store est privé (encapsulation par closure)
```

Intérêt pour la mémoire : le module pattern **circonscrit** ce qui est retenu. On sait exactement quel scope est maintenu vivant (celui de l'IIFE) et ce qu'il contient. On peut exposer une méthode `clear()` pour vider `store` à la demande — chose impossible avec une closure anonyme perdue dans un `setInterval`.

### 2.9 Le piège classique : `var` dans une boucle

Avec `var`, une boucle `for` **ne crée pas** de nouvel environnement par itération : il y a **un seul** binding `i`, partagé par toutes les closures créées dans la boucle.

```typescript
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// Affiche 3, 3, 3 — les 3 closures partagent le MÊME i,
// qui vaut 3 au moment où les callbacks s'exécutent.
```

Avec `let`, chaque itération crée un **nouveau** `LexicalEnvironment` : chaque closure capture *son* `i`.

```typescript
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// Affiche 0, 1, 2 — un i distinct par itération.
```

```
Avec var (1 seul binding)        Avec let (1 binding / itération)
┌────────────────────┐           ┌──────────┐┌──────────┐┌──────────┐
│ i: 3 (final)       │           │ i: 0     ││ i: 1     ││ i: 2     │
│  ▲   ▲   ▲         │           │  ▲       ││  ▲       ││  ▲       │
│ cb0 cb1 cb2        │           │ cb0      ││ cb1      ││ cb2      │
└────────────────────┘           └──────────┘└──────────┘└──────────┘
```

Le correctif pré-ES6 (avant `let`) était une IIFE par itération pour figer la valeur — voir Worked example 2.

---

## 3. Worked examples

### Exemple 1 — Corriger la fuite du cas concret (TribuZen)

Reprise du `FamilyDashboard` du §1. Objectif : ne plus retenir 40 Mo après démontage.

```tsx
// FamilyDashboard.tsx — APRÈS
function FamilyDashboard() {
  const [tick, setTick] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const families = loadAllFamilies();

    // (1) On extrait CE dont le handler a besoin (un number),
    //     au lieu de laisser la closure capturer tout `families`.
    const total = families.length;
    setCount(total);

    const id = setInterval(() => {
      // la closure ne capture plus que des primitives, pas les 40 Mo
      setTick(t => t + 1);
    }, 1000);

    // (2) cleanup : on arrête l'interval au démontage.
    //     Plus aucune closure vivante ne référence `families`
    //     -> le GC peut le collecter.
    return () => clearInterval(id);
  }, []);

  return <div>Familles : {count} — ticks : {tick}</div>;
}
```

**Ce qui a changé, et pourquoi ça règle la fuite :**
1. Le callback de l'interval ne lit plus `families` : il ne le capture donc plus (V8 l'élaguerait de toute façon, mais on ne parie pas dessus — on rend l'intention explicite).
2. Le `return () => clearInterval(id)` supprime la seule closure à longue durée de vie qui aurait pu retenir le scope. Après démontage, `families` n'est plus joignable → collecté au prochain GC.

C'est le motif à retenir : **une closure longue durée + gros objet capturé = fuite**. On casse l'un des deux (ne pas capturer le gros objet, et/ou tuer la closure au bon moment).

### Exemple 2 — Le piège `var`, résolu pas à pas

On veut un tableau de fonctions qui logguent `0`, `1`, `2`.

```typescript
// ❌ Tentative naïve avec var
function makeBad(): (() => void)[] {
  const out: (() => void)[] = [];
  for (var i = 0; i < 3; i++) {
    out.push(() => console.log(i)); // toutes capturent le même i
  }
  return out;
}
makeBad().forEach(f => f()); // 3, 3, 3

// ✅ Solution moderne : let (un binding par itération)
function makeLet(): (() => void)[] {
  const out: (() => void)[] = [];
  for (let i = 0; i < 3; i++) {
    out.push(() => console.log(i));
  }
  return out;
}
makeLet().forEach(f => f()); // 0, 1, 2

// ✅ Solution historique (avant let) : IIFE pour figer la valeur
function makeIIFE(): (() => void)[] {
  const out: (() => void)[] = [];
  for (var i = 0; i < 3; i++) {
    out.push(
      (function (j: number) {
        // j est un NOUVEAU binding, propre à cet appel d'IIFE,
        // qui capture la valeur courante de i
        return () => console.log(j);
      })(i),
    );
  }
  return out;
}
makeIIFE().forEach(f => f()); // 0, 1, 2
```

Trace de `makeIIFE` : à chaque tour, l'IIFE est appelée avec `i` courant. Son paramètre `j` reçoit la **valeur** (0, puis 1, puis 2) dans un scope neuf. La closure interne capture *ce* `j`, distinct à chaque itération — d'où `0, 1, 2`. C'est exactement ce que `let` fait aujourd'hui automatiquement.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « La closure capture une copie de la valeur »

```typescript
function counter() {
  let n = 0;
  const inc = () => { n++; };
  const read = () => n;
  return { inc, read };
}
const c = counter();
c.inc();
console.log(c.read()); // 1, PAS 0
```

**Faux :** une closure ne capture pas une *copie* de la valeur au moment de la création. Elle capture une **référence vivante au binding**. `inc` et `read` partagent le même `n` — modifier via l'un est visible via l'autre. (Le piège `var`/boucle est l'autre face de la même vérité : un binding partagé.)

### PIÈGE #2 — « V8 optimise, donc je n'ai pas à me soucier de la mémoire »

```typescript
// On PENSE que bigData sera élagué...
function risky() {
  const bigData = new Array(1_000_000).fill('x');
  const meta = { size: bigData.length };
  return () => JSON.stringify(meta); // n'utilise que meta ?
}
```

**Faux en général.** L'élagage V8 (*context specialization*) est une optimisation **non garantie** par la spec, désactivée par `eval`, le partage de scope entre plusieurs closures, ou du code dynamique. Le comportement correct = **ne pas capturer** le gros objet (extraire ce dont on a besoin) plutôt que d'espérer que le moteur nettoie.

### PIÈGE #3 — Confondre « scope détruit » et « stack frame dépilé »

**Faux :** croire que parce que `outer()` a retourné (frame dépilé de la stack), ses variables ont disparu. Si une closure référence son environnement, celui-ci **survit dans le heap**. Le frame de stack et l'environnement lexical ont des durées de vie **découplées** : le premier meurt à `return`, le second vit tant qu'une closure le tient.

### PIÈGE #4 — Croire que `let` corrige les fuites mémoire

**Faux de croire que passer de `var` à `let` règle les problèmes mémoire.** `let` règle le partage de binding (valeurs `0,1,2`). Il ne règle **pas** une fuite : si chaque itération capture un gros objet dans une closure stockée durablement (listener, tableau global), tu as *N* copies retenues. Le nombre de bindings et la rétention mémoire sont deux problèmes distincts.

---

## 5. Ancrage TribuZen

Le cas concret et les corrigés de ce module vivent dans l'admin TribuZen :

**`FamilyDashboard`** (`src/features/admin/FamilyDashboard.tsx`) — le composant du §1. Son `setInterval` non nettoyé + capture de `families` est la fuite type de l'admin. Corrigé en Worked example 1 : cleanup de l'`useEffect` + extraction de la donnée capturée. C'est le pont direct vers le **module 08** (détection au heap snapshot).

**`familyCache`** (`src/lib/familyCache.ts`) — un cache mémoire des familles chargées, écrit en **module pattern** (IIFE + closure, §2.8). `store` est privé (impossible de le corrompre depuis un composant), et il expose `get` / `set` / `clear` / `stats`. Le `clear()` permet de **relâcher** la rétention à la déconnexion admin — exactement ce qu'une closure anonyme perdue dans un `setInterval` ne permet pas.

**Handlers de la liste admin** — chaque bouton d'action (« archiver famille », « exporter ») crée une closure. La règle appliquée partout : un handler ne capture **que** l'`id` de la ligne, jamais l'objet famille complet ni la liste entière.

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/src/
  features/admin/
    FamilyDashboard.tsx     # cas concret + corrigé
  lib/
    familyCache.ts          # module pattern (IIFE + closure)
```

---

## 6. Points clés

1. JavaScript utilise la **portée lexicale** : le scope d'une variable dépend de *où elle est écrite*, pas d'où la fonction est appelée. La structure est figée dès le parsing.
2. La **chaîne de scopes** résout un identifiant du plus local au plus global, en s'arrêtant au premier binding trouvé (shadowing).
3. Une **closure** = une fonction + une référence (`[[Environment]]`) vers l'environnement lexical de sa **création**. Elle capture le binding, pas une copie de la valeur.
4. Le **closure scope**, c'est un environnement lexical qui survit à son stack frame parce qu'une closure le maintient vivant — durée de vie découplée de la stack.
5. En théorie une closure retient **tout** son environnement ; V8 élague les variables non lues (*context specialization*), mais ce n'est **pas garanti** — ne pas s'appuyer dessus.
6. Une closure vivante empêche le GC de collecter son scope → **cause n°1 de fuites** (listeners et timers non nettoyés). Le diagnostic est approfondi au **module 08**.
7. Le piège **`var` dans une boucle** vient d'un binding unique partagé ; `let` crée un binding par itération (correctif moderne), l'IIFE était le correctif pré-ES6.
8. L'**IIFE + module pattern** encapsulent (variables privées) et **circonscrivent** ce qui est retenu en mémoire — on sait quoi vider et quand.

---

## 7. Seeds Anki

```
Qu'est-ce que la portée lexicale en JavaScript ?|La portée d'une variable est déterminée par sa position dans le code source (où la fonction est écrite), pas par l'endroit d'où elle est appelée. La structure de la chaîne de scopes est figée dès le parsing ; seules les valeurs sont remplies au runtime.
Comment le moteur résout-il un identifiant via la chaîne de scopes ?|Il remonte les environnements lexicaux du plus local au plus global via les références outer, et s'arrête au premier scope qui déclare l'identifiant (shadowing). S'il atteint le global sans trouver : ReferenceError.
Qu'est-ce qu'une closure, techniquement ?|La combinaison d'une fonction et d'une référence (slot interne [[Environment]]) vers l'environnement lexical dans lequel elle a été créée. Elle capture le binding vivant, pas une copie de la valeur.
Une closure capture-t-elle une copie ou une référence des variables ?|Une référence vivante au binding. Deux closures du même scope partagent le même binding : une modification via l'une est visible via l'autre. C'est aussi ce qui explique le piège var/boucle.
Que retient réellement une closure en mémoire ?|Selon la spec, tout l'environnement lexical englobant, pas seulement les variables lues. V8 élague les variables non référencées (context specialization), mais ce n'est pas garanti (cassé par eval, scope partagé, code dynamique).
Pourquoi une closure peut-elle causer une fuite mémoire ?|Tant que la closure est joignable, le GC ne peut pas collecter les variables qu'elle capture. Une closure à longue durée de vie (event listener ou timer non nettoyé) qui capture un gros objet le maintient vivant indéfiniment.
Pourquoi for (var i...) avec setTimeout affiche-t-il la valeur finale, et let la bonne ?|var crée un seul binding i partagé par toutes les closures (elles lisent la valeur finale). let crée un nouveau LexicalEnvironment par itération, donc chaque closure capture son propre i.
Comment le module pattern crée-t-il des variables privées ?|Une IIFE crée un scope isolé ; l'objet retourné est une closure qui garde ce scope vivant. Ce qui n'est pas exposé dans l'objet reste inaccessible de l'extérieur mais vivant pour les méthodes internes — et on peut exposer un clear() pour relâcher la mémoire.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-02-closure-memory/README.md`. Observer au **heap snapshot** (DevTools) ce qu'une closure retient, reproduire la fuite du `FamilyDashboard`, puis la corriger et encapsuler un cache en module pattern.
