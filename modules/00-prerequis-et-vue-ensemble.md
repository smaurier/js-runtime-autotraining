---
titre: Prérequis et vue d'ensemble du moteur JavaScript
cours: 01-js-runtime
notions: [moteur JavaScript, V8 SpiderMonkey JavaScriptCore, moteur vs runtime, Node navigateur Deno Bun, ECMAScript et TC39, pipeline parse-AST-bytecode-JIT, pourquoi comprendre le runtime, carte du cours]
outcomes: [distinguer moteur et runtime, situer V8 dans Node et le navigateur, décrire le pipeline parse vers AST vers bytecode vers JIT, relier chaque symptôme runtime au module qui l'explique]
prerequis: []
next: 01-call-stack-execution-context
libs: []
tribuzen: comprendre pourquoi l'API Node et l'admin React de TribuZen rament, fuient ou ordonnent mal leurs async — le runtime comme terrain d'observation
last-reviewed: 2026-07
---

# Prérequis et vue d'ensemble du moteur JavaScript

> **Outcomes — tu sauras FAIRE :** distinguer un moteur JS de son runtime, situer V8 dans Node et le navigateur, décrire le pipeline parse → AST → bytecode → JIT, et relier un symptôme (lenteur, bug async, fuite mémoire) au module qui l'explique.
> **Difficulté :** :star:

## 1. Cas concret d'abord

L'admin React de TribuZen affiche la liste des familles. En dev tout va bien. En prod, trois plaintes tombent la même semaine :

```
1. « La page Familles gèle une demi-seconde quand on scrolle une grosse liste. »
2. « Le badge "en ligne" s'affiche AVANT l'avatar alors que je les charge dans l'ordre. »
3. « L'onglet TribuZen bouffe 900 Mo de RAM après une heure ouverte. »
```

Côté serveur, l'API Node a ses propres symptômes :

```
4. « L'endpoint /families répond en 40 ms la 1re fois, 3 ms ensuite. Pourquoi ? »
5. « Un setTimeout(fn, 0) s'exécute APRÈS un await, jamais avant. »
```

Aucun de ces cinq points n'est un bug de logique métier. Ton code est correct. Ce qui te manque, c'est **le modèle mental de ce qui se passe quand tu appuies sur "Run"** : qui exécute ton code, dans quel ordre, avec quelle mémoire, et avec quelles optimisations dans ton dos.

Ce module ne résout aucun de ces cas — il te donne la **carte** pour savoir dans quel module chaque symptôme est démonté :

| Symptôme observé | Cause runtime | Module qui l'explique |
|---|---|---|
| Page qui gèle au scroll | thread unique bloqué, tâche trop longue | 03 Event Loop, 12 Perf |
| Badge avant l'avatar | microtask (Promise) avant macrotask (setTimeout) | 04 Microtasks vs Macrotasks |
| RAM qui grimpe sans redescendre | référence retenue, GC ne peut pas libérer | 07 GC, 08 Memory Leaks |
| 1er appel lent, suivants rapides | JIT compile le code "chaud" en natif | 10 JIT, 11 Hidden Classes |
| `setTimeout(fn,0)` après `await` | files de priorités différentes | 04 Microtasks vs Macrotasks |

On va **ouvrir le capot**.

> **Analogie.** Tu sais conduire : volant, pédales, clignotant. Tu n'as pas besoin de connaître la combustion pour rouler. Mais pour comprendre pourquoi la voiture cale, consomme trop, ou comment la rendre plus rapide — il faut regarder le moteur. Ce cours regarde le moteur JS.

---

## 2. Théorie complète, concise

### 2.1 Qu'est-ce qu'un moteur JavaScript

Un **moteur JavaScript** est un programme (écrit en C++ le plus souvent) dont l'unique travail est de **lire ton code JS** (du texte brut) et de **l'exécuter**, c'est-à-dire de le transformer en instructions que le processeur comprend.

Le moteur ne connaît **que le langage** : variables, fonctions, objets, closures, Promises. Il ne sait rien de `fetch`, du DOM, de `setTimeout`, ni du système de fichiers. Ces choses-là viennent d'ailleurs (§2.3).

### 2.2 Les trois grands moteurs

| Moteur | Créé par | Tourne dans | Note |
|---|---|---|---|
| **V8** | Google | Chrome, Edge, Opera, **Node.js**, Deno | Le plus répandu. **Focus principal du cours.** |
| **SpiderMonkey** | Mozilla | Firefox | Le plus ancien — écrit par Brendan Eich en 1995 avec le langage. |
| **JavaScriptCore (JSC)** | Apple | Safari, **Bun** | Alias "Nitro". Cité quand ses choix éclairent V8 par contraste. |

Tous respectent la même spécification : **ECMAScript** (norme ECMA-262), maintenue par le comité **TC39**. La spec dit ce que le langage **doit** faire (résultat observable) ; chaque moteur choisit **comment** il le fait (implémentation). D'où : même comportement visible, internals très différents.

> **Analogie.** ECMAScript = le code de la route. V8, SpiderMonkey et JSC = trois constructeurs. Tous respectent le code de la route, chacun bâtit son moteur à sa façon.

### 2.3 Moteur vs runtime — la distinction qui débloque tout

Le **moteur** exécute le langage. Le **runtime** = le moteur **+ les APIs fournies par l'environnement**. C'est le runtime que tu utilises réellement, jamais le moteur nu.

```
   RUNTIME (ce que tu utilises)
   ┌────────────────────────────────────────────┐
   │  APIs de l'environnement                    │
   │  navigateur : DOM, fetch, setTimeout, ...   │
   │  Node.js    : fs, http, setTimeout, Buffer  │
   │                                             │
   │   ┌──────────────────────────────────┐      │
   │   │  MOTEUR (V8) — le langage seul   │      │
   │   │  parse, exécute, call stack,     │      │
   │   │  heap, garbage collector         │      │
   │   └──────────────────────────────────┘      │
   │                                             │
   │  Event loop (fourni par le runtime,         │
   │  PAS par le moteur)                          │
   └────────────────────────────────────────────┘
```

Points cruciaux :

- **`setTimeout`, `fetch`, le DOM, `fs` ne sont PAS du JavaScript.** Ce sont des APIs de l'environnement. Le moteur ne les connaît pas.
- **L'event loop est fourni par le runtime, pas par le moteur.** V8 seul n'a pas de boucle d'événements ; c'est Node (via libuv) ou le navigateur qui l'apporte.
- **Même moteur, runtimes différents.** V8 propulse à la fois Chrome et Node. Le langage est identique ; les APIs autour changent (pas de DOM dans Node, pas de `fs` dans le navigateur).

| Runtime | Moteur | APIs typiques | Où ça tourne |
|---|---|---|---|
| Navigateur (Chrome) | V8 | DOM, `fetch`, `localStorage` | client |
| **Node.js** | V8 | `fs`, `http`, `process`, `Buffer` | serveur |
| Deno | V8 | web-standard + permissions | serveur |
| Bun | JSC | Node-compat + web-standard | serveur |

Pour TribuZen : l'**admin React tourne sur le runtime navigateur** (V8 + DOM), l'**API tourne sur Node** (V8 + libuv). Même langage, deux runtimes — c'est pour ça qu'un `console.log` de timing se comporte différemment des deux côtés.

### 2.4 Le pipeline d'exécution : parse → AST → bytecode → JIT

Quand le moteur reçoit ton fichier `.js`, il ne l'exécute pas ligne par ligne comme du texte. Il le fait passer par un pipeline :

```
  code.js (texte)
     │
     ▼  ── PARSER ──────────► lit le texte, vérifie la syntaxe
     │
     ▼  AST (Abstract Syntax Tree) : arbre décrivant la structure
     │
     ▼  ── INTERPRÉTEUR (Ignition) ──► produit du BYTECODE
     │                                 (intermédiaire, portable, rapide à lancer)
     │
     ▼  exécution du bytecode
     │
     │   ce bout de code est-il "chaud" (exécuté souvent) ?
     │        │ oui
     ▼        ▼  ── COMPILATEUR JIT (Maglev / TurboFan) ──►
              code machine natif ULTRA-rapide, spécialisé
                     │
                     │  une hypothèse s'avère fausse ?
                     ▼  DÉOPTIMISATION → retour au bytecode
```

Étape par étape :

1. **Parser** — lit le texte, valide la syntaxe, construit l'**AST** (l'arbre : sujet/verbe/complément de ton code).
2. **Interpréteur (Ignition dans V8)** — transforme l'AST en **bytecode**, un code intermédiaire bien plus rapide à exécuter que de re-lire le texte, et le lance tout de suite. Démarrage rapide.
3. **JIT (Just-In-Time)** — le moteur observe l'exécution. Un code exécuté des milliers de fois est **"chaud"** ; le compilateur optimisant (Maglev, puis TurboFan) le recompile en **code machine natif**, spécialisé pour les types réellement observés.
4. **Déoptimisation** — le JIT parie sur des hypothèses (« cette fonction reçoit toujours des nombres »). Si l'hypothèse casse (un jour on passe une string), il **jette** le code optimisé et revient au bytecode.

C'est **exactement** le mystère du cas concret n°4 : le 1er appel à `/families` tourne en bytecode (lent), les suivants en code natif JIT (rapide). Détaillé aux modules 09-11.

> Le terme "JIT" oppose la compilation **à la volée** (pendant l'exécution) à la compilation **AOT** (Ahead-Of-Time, avant, comme en C). JS fait du JIT : il compile pendant qu'il tourne.

### 2.5 Le modèle mental complet — ta carte

Garde ce schéma en tête tout le cours. Chaque module zoome sur une case.

```
  Ton code JS
     │
     ▼
  ┌───────────────── MOTEUR (V8) ─────────────────┐
  │  Parser → AST → Bytecode → (JIT si chaud)     │  ← modules 09, 10, 11
  │                                               │
  │  ┌─────────────┐        ┌──────────────────┐  │
  │  │ Call Stack  │        │ Heap (mémoire)   │  │  ← 01 (stack) / 02, 07 (heap)
  │  │ pile des    │        │ objets, tableaux │  │
  │  │ fonctions   │        │ strings, closures│  │
  │  └─────────────┘        └────────┬─────────┘  │
  │                          Garbage Collector    │  ← 07, 08
  └───────────────────────────┬───────────────────┘
                              │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                     ▼
   ┌───────────┐      ┌────────────┐      ┌──────────────────┐
   │ Event Loop│      │ APIs runtime│     │ Files d'attente  │
   │ orchestre │      │ setTimeout  │     │ microtasks (Promise)│
   │ l'async   │      │ fetch, DOM  │     │ macrotasks (timer) │
   └───────────┘      │ fs (Node)   │     └──────────────────┘
      ↑ 03            └────────────┘         ↑ 04
```

### 2.6 Pourquoi comprendre le runtime (le ROI)

Tu sais déjà écrire du JS. Comprendre le runtime paie sur trois fronts que le code seul ne t'apprend pas :

- **Performance.** Savoir pourquoi un code est lent (thread bloqué, déopt JIT, allocation excessive) et le corriger — pas au pif.
- **Bugs asynchrones.** L'ordre d'exécution async (microtask avant macrotask) ne s'improvise pas ; il se déduit du modèle event loop.
- **Fuites mémoire.** Une RAM qui monte sans redescendre = une référence qui traîne et bloque le GC. Invisible sans comprendre le heap.

Ce que tu sauras faire à la fin du cours : **diagnostiquer** une lenteur, **lire** une trace V8 / un heap snapshot / un profil de perf, **expliquer** pourquoi un code rame, **raisonner** sur la mémoire, **naviguer** la spec ECMAScript.

### 2.7 Ce que le cours n'est PAS

| N'est PAS… | Parce que… |
|---|---|
| Un cours de syntaxe JS | on suppose ES2020+ acquis |
| Un cours de framework (React, Vue) | on parle du moteur *sous* les frameworks |
| Un cours d'algorithmique | pas de tri, graphes, complexité O(n) |
| Un cours de Node.js | Node est un **outil d'observation**, pas le sujet |

---

## 3. Worked examples

### Exemple 1 — Prouver « moteur vs runtime » en 4 lignes

Objectif : montrer que le moteur ne connaît pas `setTimeout`, mais que les deux runtimes (navigateur et Node) le fournissent.

```js
// Ce code tourne à l'identique dans la console Chrome ET dans `node fichier.js`
console.log("A");                       // fourni par le runtime (console)
setTimeout(() => console.log("B"), 0);  // setTimeout = API du runtime, PAS du moteur
Promise.resolve().then(() => console.log("C")); // Promise = langage (moteur)
console.log("D");
```

Raisonnement pas à pas :

1. `console.log("A")` s'exécute immédiatement sur la call stack → **A**.
2. `setTimeout(..., 0)` : le runtime enregistre le callback et le range en **macrotask**. Rien ne s'affiche encore.
3. `Promise.resolve().then(...)` : le `.then` est rangé en **microtask**.
4. `console.log("D")` s'exécute immédiatement → **D**.
5. La call stack est vide. L'event loop vide **d'abord les microtasks** → **C**.
6. Puis la macrotask → **B**.

Sortie : `A  D  C  B`. Deux enseignements : `setTimeout` vient du **runtime** (le moteur seul ne l'aurait pas), et une Promise (microtask) passe **avant** un timer (macrotask). C'est la mécanique exacte des cas concrets n°2 et n°5. Démonté au module 04.

### Exemple 2 — Observer le JIT chauffer (cas concret n°4)

Objectif : reproduire « 1er appel lent, suivants rapides » de façon isolée.

```js
// somme d'un tableau, appelée en boucle : V8 va la compiler en natif
function somme(arr) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) total += arr[i];
  return total;
}

const data = Array.from({ length: 10_000 }, (_, i) => i);

console.time("froid");        // 1re exécution : bytecode (Ignition)
somme(data);
console.timeEnd("froid");

for (let i = 0; i < 100_000; i++) somme(data); // on "chauffe" : V8 déclenche le JIT

console.time("chaud");        // maintenant : code machine natif (TurboFan)
somme(data);
console.timeEnd("chaud");
```

Ce qu'on observe : `chaud` est nettement plus rapide que `froid`, sans avoir changé une ligne de `somme`. Le moteur a détecté que la fonction était **chaude** et l'a recompilée en natif — dans ton dos. C'est le mécanisme derrière l'endpoint `/families` de TribuZen. Tu apprendras à *voir* ça avec `node --trace-opt` au module 10.

> Note : les vrais chiffres varient selon la machine et la version de Node. Ce qui compte n'est pas le nombre, c'est l'**écart** froid/chaud et sa cause.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que `setTimeout` / `fetch` font partie du langage

**Faux.** Ce sont des APIs du **runtime**, pas du moteur. Preuve : un moteur nu (V8 embarqué sans environnement) n'a ni `setTimeout` ni `fetch`. Conséquence pratique : le comportement de `setTimeout` peut différer entre navigateur et Node (clamp à 4 ms, phases de timers libuv) car ce sont **deux implémentations distinctes** de la même API.

### PIÈGE #2 — Confondre moteur et runtime

**Faux raccourci :** « Node.js est un moteur. » Non : **Node est un runtime** qui *embarque* le moteur V8 et y ajoute libuv (event loop + I/O), les modules `fs`/`http`, etc. De même, « le navigateur est un moteur » est faux : le navigateur *contient* un moteur (V8 pour Chrome). Le bon vocabulaire : moteur = V8 ; runtime = Node ou navigateur.

### PIÈGE #3 — Penser que JS est « interprété » (point final)

**Incomplet.** JS moderne n'est pas *seulement* interprété. Le pipeline est **hybride** : interprété en bytecode au départ (démarrage rapide), puis **compilé en natif** (JIT) pour le code chaud. Dire « JS est lent car interprété » ignore que le code chaud tourne en code machine. Et dire « JS est compilé comme le C » ignore le démarrage en bytecode et les déopts.

### PIÈGE #4 — Croire que l'ordre async suit l'ordre du code

**Faux.** Dans l'exemple 1, `B` est écrit avant `D` dans le source mais s'affiche en dernier. L'ordre d'exécution suit les **files de l'event loop** (microtask > macrotask), pas l'ordre des lignes. Raisonner « ligne par ligne du haut vers le bas » sur du code async mène droit au bug du cas concret n°2.

### PIÈGE #5 — Croire que « le GC gère tout, je n'ai rien à faire »

**Dangereux.** Le GC libère ce qui n'est **plus référencé**. Si une référence traîne (un listener non retiré, une closure qui capture un gros objet, une Map qui grossit sans borne), l'objet reste « vivant » aux yeux du GC et n'est **jamais** libéré → fuite. Automatique ≠ magique. Cas concret n°3, module 08.

---

## 5. Ancrage TribuZen

TribuZen est le fil rouge de tout le cours. Il fournit **deux runtimes réels** à observer, correspondant aux deux moitiés de la carte du §2.5 :

- **L'admin React** (`tribuzen/apps/admin`) tourne sur le **runtime navigateur** (V8 + DOM). C'est là qu'on observe : le gel de l'UI quand une tâche bloque le thread unique (module 03), l'ordre d'affichage surprenant des composants async (module 04), et la RAM qui grimpe quand un composant fuit ses listeners (module 08). Outil : Chrome DevTools (onglets Performance et Memory).

- **L'API Node** (`tribuzen/apps/api`) tourne sur le **runtime Node** (V8 + libuv). C'est là qu'on observe : le JIT qui chauffe un endpoint appelé en boucle (modules 10-11), les phases de l'event loop côté serveur (module 03), et le profiling des handlers lents (module 12). Outil : flags `node --trace-opt`, `--prof`, `--inspect`.

Le cours n'invente aucun symptôme : chaque plainte du cas concret (§1) correspond à un fichier ou un endpoint réel de TribuZen, revisité dans le module qui l'explique. Ce module 00 est la **table des matières diagnostique** — tu y reviendras pour savoir « ce bug-là, c'est quel module ? ».

**Carte du cours (où va chaque brique) :**

| # | Module | Thème | Brique de la carte |
|---|---|---|---|
| 01 | Call Stack & contextes d'exécution | exécution | Call Stack |
| 02 | Scope, Closures & mémoire | mémoire | Heap |
| 03 | Event Loop | async | Event Loop |
| 04 | Microtasks vs Macrotasks | async | Files d'attente |
| 05 | Promises — implémentation | async | Files d'attente |
| 06 | Async/Await sous le capot | async | Files d'attente |
| 07 | Garbage Collector | mémoire | GC |
| 08 | Memory Leaks | mémoire | GC / Heap |
| 09 | Architecture V8 | moteur | Parser → Bytecode |
| 10 | JIT & optimisation | moteur | JIT |
| 11 | Hidden Classes & Inline Caching | moteur | JIT |
| 12 | Performance Patterns | perf | tout |
| 13 | Scheduling & concurrence | concurrence | Event Loop |
| 14-15 | Projet final + debug réel | synthèse | tout |

---

## 6. Points clés

1. Un **moteur JS** (V8, SpiderMonkey, JSC) lit et exécute le **langage** ; il ne connaît ni `setTimeout`, ni `fetch`, ni le DOM.
2. Le **runtime** = moteur **+ APIs de l'environnement** (Node, navigateur, Deno, Bun) ; c'est lui que tu utilises, jamais le moteur nu.
3. **L'event loop est fourni par le runtime**, pas par le moteur — V8 seul n'a pas de boucle d'événements.
4. Un même moteur sert plusieurs runtimes : **V8 propulse Chrome ET Node**, avec des APIs différentes autour.
5. Tous les moteurs respectent **ECMAScript (ECMA-262)**, normé par **TC39** : même comportement observable, implémentations libres.
6. Le pipeline est **parse → AST → bytecode (interpréteur) → JIT natif si code chaud**, avec **déoptimisation** si une hypothèse casse.
7. Comprendre le runtime paie sur trois axes que le code seul n'apprend pas : **performance, bugs async, fuites mémoire**.
8. Ce module 00 est la **carte diagnostique** : chaque symptôme (lenteur, ordre async, RAM) pointe vers le module qui le démonte.

---

## 7. Seeds Anki

```
Quelle est la différence entre un moteur JS et un runtime ?|Le moteur (V8, SpiderMonkey, JSC) exécute le langage seul. Le runtime = moteur + APIs de l'environnement (setTimeout, fetch, DOM, fs). On utilise toujours un runtime, jamais le moteur nu.
setTimeout et fetch font-ils partie du langage JavaScript ?|Non. Ce sont des APIs fournies par le runtime (navigateur ou Node), pas par le moteur. Un moteur nu ne les connaît pas.
Quel moteur propulse Node.js et Chrome ?|Les deux utilisent V8 (Google). Même moteur, runtimes différents : Node ajoute libuv/fs/http, le navigateur ajoute le DOM/fetch.
Qui fournit l'event loop : le moteur ou le runtime ?|Le runtime. V8 seul n'a pas de boucle d'événements ; c'est Node (via libuv) ou le navigateur qui l'apporte.
Cite les étapes du pipeline d'exécution de V8.|parse → AST → bytecode (interpréteur Ignition) → compilation JIT en code natif (Maglev/TurboFan) si le code est "chaud", avec déoptimisation si une hypothèse s'avère fausse.
Qu'est-ce que le code "chaud" et que lui fait le moteur ?|Du code exécuté très souvent. Le compilateur JIT le recompile de bytecode en code machine natif spécialisé, ce qui explique qu'un 1er appel soit lent et les suivants rapides.
Qu'est-ce qu'ECMAScript et TC39 ?|ECMAScript (ECMA-262) est la spec officielle qui définit ce que le langage doit faire. TC39 est le comité qui la fait évoluer. Les moteurs choisissent librement le "comment".
Pourquoi une RAM qui monte sans redescendre n'est pas forcément corrigée par le GC ?|Le GC ne libère que ce qui n'est plus référencé. Une référence qui traîne (listener non retiré, closure, Map non bornée) garde l'objet vivant → fuite mémoire. Automatique ≠ magique.
```
