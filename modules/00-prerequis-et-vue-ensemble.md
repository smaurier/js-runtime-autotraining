# Module 00 — Prérequis et vue d'ensemble

> **Objectif** : Poser les fondations. Comprendre ce qu'est un moteur JavaScript, avoir les bons réflexes, et savoir où tu vas dans ce cours.

> **Difficulté** : ⭐ (Débutant) — Si tu sais écrire du JavaScript, tu peux lire ce module.

---

## 1. Ce que ce cours va t'apprendre (et ce qu'il ne t'apprendra pas)

### Ce qu'on fait ici

Tu sais écrire du JavaScript. Tu sais déclarer des variables, appeler des fonctions, utiliser des Promises. **Ce cours ne t'apprend pas à coder en JS.** Ce cours t'apprend **comment le moteur JavaScript exécute ton code** — ce qui se passe quand tu appuies sur "Run".

On va **ouvrir le capot**.

> **Analogie** : Tu sais conduire une voiture. Tu connais le volant, les pédales, le clignotant. Ce cours t'apprend comment fonctionne le moteur sous le capot — la combustion, la transmission, le refroidissement. Tu n'as pas besoin de savoir ça pour conduire. Mais si tu veux comprendre pourquoi ta voiture cale, pourquoi elle consomme trop, ou comment la rendre plus rapide… tu dois comprendre le moteur.

### Ce que tu sauras faire après ce cours

- **Diagnostiquer** des problèmes de performance dans une application JavaScript
- **Comprendre** l'asynchrone en profondeur (event loop, microtasks, scheduling)
- **Lire** une trace V8, un heap snapshot, un profil de performance
- **Expliquer** pourquoi un code est lent et comment le corriger
- **Raisonner** sur la mémoire (fuites, garbage collection, rétention)
- **Naviguer** la spécification ECMAScript (ECMA-262)

### Ce que ce cours n'est PAS

| Ce cours n'est PAS… | Pourquoi |
|----------------------|----------|
| Un cours de syntaxe JavaScript | On suppose que tu connais déjà ES2020+ |
| Un cours de framework (React, Vue, Angular) | On parle du moteur, pas des outils construits dessus |
| Un cours d'algorithmique | On ne parle pas de tri, de graphes ou de complexité O(n) |
| Un cours de Node.js | On utilise Node.js comme outil, mais le sujet c'est le moteur |

---

## 2. Les moteurs JavaScript — qui fait quoi

### Qu'est-ce qu'un moteur JavaScript ?

Un **moteur JavaScript** est un programme (écrit en C++ généralement) dont le travail est de **lire ton code JavaScript** et de **l'exécuter**. C'est lui qui transforme tes lignes de texte en instructions que ton processeur peut comprendre.

Quand tu ouvres une page web, le navigateur donne ton code JS à son moteur. Quand tu lances `node script.js`, Node.js donne ton code à V8. Le principe est le même : le moteur reçoit du texte, et il l'exécute.

### Les trois grands moteurs

| Moteur | Créé par | Utilisé dans | Note |
|--------|----------|-------------|------|
| **V8** | Google | Chrome, Node.js, Deno, Edge, Opera | Le plus utilisé aujourd'hui. **Focus principal de ce cours.** |
| **SpiderMonkey** | Mozilla | Firefox | Le plus ancien moteur JS — créé par Brendan Eich en 1995 avec le langage lui-même. |
| **JavaScriptCore (JSC)** | Apple | Safari, Bun | Aussi appelé "Nitro". Le moteur d'Apple. |

### Pourquoi ce cours couvre principalement V8 (et un peu SpiderMonkey)

- **V8** propulse Chrome (~65% du marché des navigateurs) ET Node.js/Deno (côté serveur). C'est le moteur que tu rencontres le plus souvent.
- **SpiderMonkey** est intéressant parce qu'il fait les choses différemment — comparer les deux t'aide à comprendre que les choix d'implémentation ne sont pas universels.
- **JSC** est couvert ponctuellement quand ses choix de conception sont instructifs.

### Le point commun : ECMAScript

Malgré des implémentations très différentes, tous ces moteurs respectent la même spécification : **ECMAScript** (ECMA-262). C'est le document officiel qui définit ce que le langage JavaScript **doit** faire. Les moteurs sont libres de choisir **comment** ils le font — mais le résultat observable doit être le même.

> **Analogie** : ECMAScript, c'est le code de la route. Tous les constructeurs automobiles (V8, SpiderMonkey, JSC) doivent le respecter. Mais chacun construit son moteur à sa façon.

---

## 3. Glossaire des termes clés

Ce glossaire contient les termes que tu vas rencontrer tout au long du cours. Tu n'as pas besoin de tout mémoriser maintenant — **reviens ici** chaque fois qu'un terme te semble flou.

Chaque terme est accompagné d'une analogie pour te donner une intuition.

### Exécution

| Terme | Définition | Analogie |
|-------|------------|----------|
| **Runtime** | L'environnement complet d'exécution : le moteur + les APIs disponibles (DOM, setTimeout, fetch…). | Le moteur de la voiture + tout l'habitacle. |
| **Call Stack** | La pile d'appels. Quand une fonction est appelée, elle est empilée. Quand elle retourne, elle est dépilée. LIFO (Last In, First Out). | Une pile d'assiettes : tu poses dessus, tu retires par le dessus. |
| **Stack Frame** | Un cadre dans la pile d'appels. Contient les infos d'une fonction en cours d'exécution. | Une assiette dans la pile, avec une étiquette dessus. |
| **Execution Context** | L'environnement créé par le moteur pour chaque fonction en cours : ses variables, son `this`, sa portée. | La fiche d'identité d'une fonction en train de s'exécuter. |
| **Thread** | Un fil d'exécution. JavaScript n'en a qu'un seul principal (mono-threadé). | Un seul cuisinier en cuisine : il ne peut faire qu'une chose à la fois. |
| **Web Workers** | Des threads supplémentaires que tu peux créer pour exécuter du code en parallèle, sans bloquer le thread principal. | Des commis qui travaillent à côté du cuisinier principal. |

### Portée et variables

| Terme | Définition | Analogie |
|-------|------------|----------|
| **Scope** | La portée d'une variable : depuis quel endroit du code elle est accessible. | Les murs d'une pièce — tu ne vois que ce qui est dans ta pièce (et dans les pièces autour). |
| **Closure** | Une fonction qui "se souvient" des variables de son scope parent, même après que celui-ci a terminé. | Une fonction avec un sac à dos rempli de variables qu'elle emporte partout. |
| **Reference** | Un lien (un pointeur) vers un objet en mémoire. La variable ne contient pas l'objet, elle contient l'adresse. | Un post-it avec l'adresse d'une maison, pas la maison elle-même. |

### Asynchrone

| Terme | Définition | Analogie |
|-------|------------|----------|
| **Event Loop** | Le mécanisme qui surveille la call stack et les files d'attente, et qui décide quoi exécuter ensuite. | Le serveur dans un restaurant : il regarde si le cuisinier est libre, puis lui passe la prochaine commande. |
| **Callback** | Une fonction passée en argument à une autre fonction, pour être appelée plus tard (souvent quand une opération async est terminée). | "Rappelle-moi quand c'est prêt." |
| **Promise** | Un objet qui représente une valeur future. Trois états : pending (en attente), fulfilled (résolue), rejected (rejetée). | Un ticket de pressing : tu le déposes, tu repars, et tu reviens le chercher quand c'est prêt. |
| **Microtask** | Une tâche de haute priorité dans l'event loop (Promises, queueMicrotask). Traitée avant les macrotasks. | La file prioritaire à l'aéroport. |
| **Macrotask** | Une tâche de priorité normale dans l'event loop (setTimeout, setInterval, I/O). | La file normale à l'aéroport. |

### Mémoire

| Terme | Définition | Analogie |
|-------|------------|----------|
| **Heap** | La zone mémoire où sont stockés les objets et les données dynamiques. Non ordonnée. | Un grand parking : les voitures sont garées un peu partout, chacune à une place numérotée. |
| **Garbage Collector (GC)** | Le mécanisme automatique qui libère la mémoire des objets qui ne sont plus utilisés. | Le service de nettoyage qui débarrasse les tables abandonnées au restaurant. |
| **Memory Leak** | Une fuite mémoire : de la mémoire qui devrait être libérée mais qui ne l'est pas, parce qu'une référence traîne. | Un robinet qui goutte. Tu ne t'en rends pas compte tout de suite, mais la facture d'eau explose. |
| **Heap Snapshot** | Une photo de la mémoire à un instant T. Utilisée pour diagnostiquer les fuites. | Une photo aérienne du parking pour voir quelles voitures sont encore là. |

### Moteur et compilation

| Terme | Définition | Analogie |
|-------|------------|----------|
| **Parser** | Le composant qui lit ton code source et le transforme en arbre syntaxique (AST). | Le correcteur qui lit ta rédaction et en fait un plan structuré. |
| **AST (Abstract Syntax Tree)** | La représentation en arbre de la structure de ton code, produite par le parser. | Le plan structuré de ta rédaction : introduction, paragraphes, conclusion. |
| **Bytecode** | Le code intermédiaire entre ton code JS et le langage machine. Plus rapide à exécuter que le JS brut, mais pas encore du code natif. | Une partition musicale simplifiée : pas la musique finale, mais assez pour jouer le morceau. |
| **JIT (Just-In-Time)** | Compilation à la volée : le moteur compile le code pendant l'exécution, pas avant. | Un traducteur simultané : il traduit en temps réel pendant que tu parles. |
| **Interpréteur** | Exécute le bytecode ligne par ligne, sans compiler en code natif. Plus lent mais démarre vite. | Lire une recette pas à pas en cuisinant. |
| **Compilateur optimisant** | Compile le code "chaud" (exécuté souvent) en code machine natif ultra-rapide. | Un chef qui a fait la recette 100 fois et n'a plus besoin de la lire. |
| **Deoptimization** | Quand le moteur annule une optimisation parce qu'une hypothèse s'est révélée fausse. | Le chef découvre que l'ingrédient a changé — il doit relire la recette. |

### Optimisation interne

| Terme | Définition | Analogie |
|-------|------------|----------|
| **Hidden Class / Map / Shape** | La structure interne que le moteur crée pour décrire la forme d'un objet (quelles propriétés, dans quel ordre). | Le plan d'architecte d'une maison : toutes les maisons identiques partagent le même plan. |
| **Inline Cache (IC)** | Un cache qui retient où trouver une propriété d'un objet, pour ne pas chercher à chaque fois. | Un marque-page dans un dictionnaire : tu sais déjà à quelle page chercher. |
| **Profiling** | Mesurer les performances d'un programme : temps d'exécution, mémoire utilisée, fréquence d'appel. | Chronométrer un coureur pour savoir où il perd du temps. |

### Spécification

| Terme | Définition | Analogie |
|-------|------------|----------|
| **ECMAScript (ECMA-262)** | Le document officiel qui définit le langage JavaScript. Maintenu par le TC39. | Le code de la route pour JavaScript. |
| **TC39** | Le comité technique qui fait évoluer la spécification ECMAScript. | Le parlement qui vote les nouvelles lois du langage. |
| **Proposal** | Une proposition de nouvelle fonctionnalité pour le langage, en cours de discussion au TC39. | Un projet de loi avant le vote. |

---

## 4. Le modèle mental — comment un moteur JS fonctionne (vue d'ensemble)

Voici le schéma que tu vas avoir en tête pendant tout le cours. C'est ta **carte**. Chaque module va zoomer sur une partie de cette carte.

```
  Ton code JS (.js)
      │
      ▼
  ┌─────────────────────────────────────────────┐
  │           MOTEUR JavaScript (V8)            │
  │                                             │
  │  ┌──────────┐    ┌───────────────────────┐  │
  │  │  Parser  │───►│  Bytecode             │  │
  │  │          │    │  (Ignition /           │  │
  │  │ Analyse  │    │   Baseline Compiler)   │  │
  │  │ le texte │    │                       │  │
  │  └──────────┘    └───────────┬───────────┘  │
  │                              │              │
  │                    Ce code est "chaud" ?     │
  │                    (exécuté souvent)         │
  │                              │ oui          │
  │                  ┌───────────▼───────────┐  │
  │                  │  Code optimisé        │  │
  │                  │  (TurboFan /          │  │
  │                  │   Maglev /            │  │
  │                  │   Warp)               │  │
  │                  │                       │  │
  │                  │  Code machine natif   │  │
  │                  │  ultra-rapide         │  │
  │                  └───────────────────────┘  │
  │                                             │
  │  ┌──────────────┐  ┌────────────────────┐   │
  │  │  Call Stack   │  │  Heap (mémoire)    │   │
  │  │              │  │                    │   │
  │  │  Pile des    │  │  Tous les objets,  │   │
  │  │  fonctions   │  │  tableaux, strings │   │
  │  │  en cours    │  │  vivent ici        │   │
  │  └──────────────┘  └────────┬───────────┘   │
  │                             │               │
  │                  ┌──────────▼───────────┐   │
  │                  │  Garbage Collector   │   │
  │                  │                      │   │
  │                  │  Nettoie la mémoire  │   │
  │                  │  inutilisée          │   │
  │                  └──────────────────────┘   │
  └──────────────────────┬──────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
  ┌──────────────┐ ┌──────────┐ ┌──────────────────┐
  │  Event Loop  │ │  APIs    │ │  Files d'attente  │
  │              │ │          │ │                    │
  │  Orchestre   │ │ setTimeout│ │  Microtask queue  │
  │  tout le     │ │ fetch    │ │  Macrotask queue  │
  │  système     │ │ DOM      │ │                    │
  │  async       │ │ I/O      │ │  (callbacks en     │
  │              │ │          │ │   attente)         │
  └──────────────┘ └──────────┘ └──────────────────┘
```

### Explication de chaque bloc

**Parser** — Le moteur commence par **lire** ton code JavaScript (qui est du texte brut). Le parser analyse ce texte et le transforme en une structure compréhensible (un arbre syntaxique, ou AST). C'est comme lire une phrase et en identifier le sujet, le verbe et le complément.
→ *Module 09 : Architecture V8*

**Bytecode (Ignition / Baseline)** — L'AST est ensuite transformé en **bytecode** : un code intermédiaire que le moteur peut exécuter rapidement. Ce n'est pas encore du code machine natif, mais c'est bien plus rapide que de réinterpréter le texte JS à chaque fois.
→ *Module 09 : Architecture V8*

**Code optimisé (TurboFan / Maglev / Warp)** — Quand le moteur détecte qu'un morceau de code est exécuté très souvent ("hot code"), il le compile en **code machine natif** — du code ultra-rapide, spécialisé pour ton cas d'utilisation. Si les hypothèses du compilateur s'avèrent fausses, il fait une **deoptimization** et revient au bytecode.
→ *Module 10 : JIT Compilation & Optimisation*

**Call Stack** — La pile d'appels. Chaque fois que tu appelles une fonction, elle est **empilée**. Quand elle retourne, elle est **dépilée**. Le moteur exécute toujours la fonction au sommet de la pile.
→ *Module 01 : Call Stack & Contextes d'exécution*

**Heap** — La zone de mémoire dynamique. Tous les objets, tableaux, strings et closures que ton programme crée sont stockés ici. Contrairement à la call stack (ordonnée), le heap est un grand espace non structuré.
→ *Module 02 : Scope, Closures & Mémoire* | *Module 07 : Garbage Collector*

**Garbage Collector** — Le mécanisme automatique qui parcourt le heap et **libère la mémoire** des objets qui ne sont plus accessibles. Tu n'as pas à gérer la mémoire manuellement en JS, mais comprendre le GC t'aide à éviter les fuites.
→ *Module 07 : Garbage Collector* | *Module 08 : Memory Leaks*

**Event Loop** — Le chef d'orchestre de l'asynchrone. Il surveille la call stack et les files d'attente. Quand la stack est vide, il prend la prochaine tâche dans la file et la pousse sur la stack.
→ *Module 03 : Event Loop*

**APIs** — Les fonctions fournies par l'environnement (navigateur ou Node.js), pas par le moteur lui-même. `setTimeout`, `fetch`, `DOM`, `fs`… Ces APIs délèguent le travail hors du thread principal et placent un callback dans une file d'attente quand c'est terminé.
→ *Module 03 : Event Loop* | *Module 04 : Microtasks vs Macrotasks*

**Files d'attente (Microtask / Macrotask)** — Les callbacks en attente sont rangés dans des files. Les **microtasks** (Promises) sont toujours traitées avant les **macrotasks** (setTimeout). C'est pour ça que l'ordre d'exécution async peut surprendre.
→ *Module 04 : Microtasks vs Macrotasks*

---

## 5. Les outils que tu vas utiliser

Tu n'as pas besoin de tout installer maintenant. Chaque module te dira exactement quels outils utiliser. Mais voici la liste complète pour que tu saches à quoi t'attendre.

### Node.js 20+

On utilise Node.js pour exécuter les labs en ligne de commande. Vérifie ta version :

```bash
node --version
# Doit afficher v20.x.x ou supérieur
```

Si tu n'as pas Node.js : [https://nodejs.org](https://nodejs.org) (télécharge la version LTS).

### Chrome DevTools

Les DevTools de Chrome sont ton outil principal pour l'analyse de performance et de mémoire.

| Onglet | À quoi il sert | Module(s) concerné(s) |
|--------|----------------|-----------------------|
| **Sources** | Debugger, breakpoints, step-through | 01, 02, 03 |
| **Performance** | Profiling, flame chart, timeline | 12, 15 |
| **Memory** | Heap snapshots, allocation timeline | 07, 08 |
| **Console** | Exécution de code, logs | Tous |

**Comment ouvrir les DevTools :**

| Raccourci | Action |
|-----------|--------|
| `F12` | Ouvrir/fermer les DevTools |
| `Ctrl + Shift + I` (Windows/Linux) | Ouvrir/fermer les DevTools |
| `Cmd + Option + I` (Mac) | Ouvrir/fermer les DevTools |
| `Ctrl + Shift + J` | Ouvrir directement la Console |

### Firefox DevTools

Firefox (SpiderMonkey) offre des outils complémentaires, parfois plus détaillés pour certaines analyses.

| Onglet | Équivalent Chrome |
|--------|--------------------|
| **Debugger** | Sources |
| **Performance** | Performance |
| **Memory** | Memory |

### Les flags Node.js spéciaux

Certains modules utilisent des flags spéciaux pour accéder aux internals de V8 :

```bash
# Exposer le garbage collector pour l'appeler manuellement
node --expose-gc script.js

# Voir les optimisations JIT en temps réel
node --trace-opt script.js

# Voir les deoptimizations
node --trace-deopt script.js

# Afficher le bytecode généré par Ignition
node --print-bytecode script.js

# Utiliser les fonctions internes V8 (%OptimizeFunctionOnNextCall, etc.)
node --allow-natives-syntax script.js

# Combiner plusieurs flags
node --trace-opt --trace-deopt --allow-natives-syntax script.js
```

> **Tu n'as pas besoin de retenir tout ça maintenant.** Chaque module te donnera la commande exacte à utiliser. Reviens ici si tu as besoin d'un rappel.

---

## 6. Parcours recommandé

### Vue d'ensemble

| # | Module | Thème | Difficulté | Temps estimé |
|---|--------|-------|------------|-------------|
| 00 | Prérequis et vue d'ensemble | Introduction | ⭐ | ~1h |
| 01 | Call Stack & Contextes d'exécution | Exécution | ⭐⭐ | ~3h |
| 02 | Scope, Closures & Mémoire | Mémoire | ⭐⭐ | ~3h |
| 03 | Event Loop | Asynchrone | ⭐⭐ | ~3h |
| 04 | Microtasks vs Macrotasks | Asynchrone | ⭐⭐⭐ | ~3h |
| 05 | Promises — Implémentation interne | Asynchrone | ⭐⭐⭐ | ~3h |
| 06 | Async/Await sous le capot | Asynchrone | ⭐⭐⭐ | ~3h |
| 07 | Garbage Collector | Mémoire | ⭐⭐⭐ | ~3h |
| 08 | Memory Leaks | Mémoire | ⭐⭐⭐ | ~3h |
| 09 | Architecture V8 | Moteur | ⭐⭐⭐⭐ | ~3h |
| 10 | JIT Compilation & Optimisation | Moteur | ⭐⭐⭐⭐ | ~3h |
| 11 | Hidden Classes & Inline Caching | Moteur | ⭐⭐⭐⭐ | ~3h |
| 12 | Performance Patterns | Performance | ⭐⭐⭐ | ~3h |
| 13 | Scheduling & Concurrence | Concurrence | ⭐⭐⭐⭐ | ~3h |
| 14 | Projet Final | Synthèse | ⭐⭐⭐⭐⭐ | ~4h |
| 15 | Session de debugging réelle | Diagnostic | ⭐⭐⭐⭐⭐ | ~4h |

### Conseil de progression

**Si tu es débutant, fais les modules dans l'ordre. Ne saute pas.**

La progression est pensée pour construire ta compréhension brique par brique :

1. **Modules 01-06 — Les fondamentaux** : commence par là. Tu apprendras comment le code s'exécute (call stack), comment les variables vivent (scope, closures), et comment l'asynchrone fonctionne réellement (event loop, promises, async/await).

2. **Modules 07-08 — La mémoire** : tu comprendras comment le garbage collector fonctionne et comment diagnostiquer des fuites mémoire.

3. **Modules 09-11 — Le moteur V8** : c'est le coeur technique. Tu verras comment V8 compile et optimise ton code (JIT, hidden classes, inline caching).

4. **Modules 12-15 — Performance et pratique** : tu appliqueras tout ce que tu as appris sur des cas réels.

> **Prends ton temps.** Mieux vaut bien comprendre un module que d'en survoler trois. Si un concept te semble flou, relis-le, teste-le dans la console, et passe au suivant seulement quand tu es à l'aise.

---

## 7. Rappels JavaScript essentiels

Cette section n'est **pas** un cours de JavaScript. Ce sont des rappels rapides des concepts JS que tu dois maîtriser pour suivre ce cours. Si quelque chose ici ne te parle pas, prends le temps de réviser les bases avant de continuer.

### Fonctions : trois façons de les écrire

```js
// Déclaration de fonction (hoisted)
function addition(a, b) {
  return a + b;
}

// Expression de fonction (pas hoisted)
const soustraction = function(a, b) {
  return a - b;
};

// Arrow function (pas de `this` propre, pas hoisted)
const multiplication = (a, b) => a * b;
```

Les trois font la même chose, mais elles se comportent différemment vis-à-vis du **hoisting** et du **`this`**. On verra ça en détail dans le Module 01.

### Callbacks : passer une fonction en argument

```js
function faireApres(callback) {
  console.log("Avant");
  callback();
  console.log("Après");
}

faireApres(() => {
  console.log("Pendant !");
});
// Affiche : Avant → Pendant ! → Après
```

Un **callback** est simplement une fonction qu'on passe en paramètre à une autre fonction. C'est le mécanisme de base de l'asynchrone en JavaScript.

### Promises : représenter une valeur future

```js
const promesse = new Promise((resolve, reject) => {
  setTimeout(() => {
    resolve("Données reçues !");
  }, 1000);
});

promesse
  .then((resultat) => console.log(resultat))  // "Données reçues !" (après 1s)
  .catch((erreur) => console.error(erreur));
```

Une **Promise** est un objet qui dit "je n'ai pas encore la valeur, mais je te la donnerai quand elle sera prête — ou je te dirai si ça a échoué." On décortiquera son fonctionnement interne dans le Module 05.

### async/await : du sucre syntaxique sur les Promises

```js
async function chargerDonnees() {
  const resultat = await fetch("https://api.example.com/data");
  const data = await resultat.json();
  return data;
}
```

`async/await` rend le code asynchrone lisible comme du code synchrone. Mais sous le capot, ce sont toujours des Promises. Le Module 06 t'expliquera exactement ce que le moteur fait avec ce sucre syntaxique.

### Closures : une fonction qui "se souvient"

```js
function creerCompteur() {
  let count = 0;              // Variable locale
  return function incrementer() {
    count++;                  // Accès à la variable du scope parent
    console.log(count);
  };
}

const compteur = creerCompteur();
compteur(); // 1
compteur(); // 2
compteur(); // 3
```

La fonction `incrementer` a accès à `count` même après que `creerCompteur` a fini de s'exécuter. C'est une **closure** : la fonction "emporte" les variables de son scope parent dans son sac à dos. Le Module 02 expliquera comment ça fonctionne en mémoire.

### Ce qui est attendu

Si ces cinq rappels te semblent clairs, tu es prêt pour le Module 01. Si l'un d'eux te pose problème, prends le temps de revoir les bases JavaScript avant de continuer. Ce cours suppose que tu maîtrises la syntaxe — on se concentre sur le **comment** et le **pourquoi** du moteur, pas sur le **quoi** du langage.

---

## Prêt ?

Tu as le glossaire, le modèle mental, les outils. Place au Module 01 — on commence par la base : la pile d'appels.

→ [Module 01 — Call Stack & Contextes d'exécution](./01-call-stack-execution-context.md)
