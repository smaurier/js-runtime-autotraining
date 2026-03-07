# Screencast 10 — JIT Compilation & Optimisation

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/10-jit-compilation-optimization.md`
- **Lab associé** : `labs/lab-10-jit-deoptimization/`
- **Prérequis** : Module 09 (Architecture V8, pipeline Ignition→TurboFan), notion de Feedback Vector

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Fichiers du lab-10 prêts (`exercise.js`, `walkthrough.js`)
- [ ] Node.js v20+ avec accès aux flags `--trace-opt`, `--trace-deopt`
- [ ] Éditeur de code ouvert sur les fichiers du lab

## Script

### [00:00-01:30] Introduction — L'optimisation spéculative

> « Bienvenue dans le module 10. On va comprendre comment V8 accélère ton code grâce à l'optimisation spéculative — et ce qui se passe quand ses suppositions sont fausses. »

- Analogie : un cuisinier qui prépare toujours le même plat finit par aller plus vite. S'il doit soudain préparer un plat différent, il ralentit.
- V8 observe les types que tu utilises, **suppose** qu'ils ne changeront pas, et génère du code machine optimisé pour ces types
- Si la supposition est fausse → **déoptimisation** : retour au bytecode Ignition
- C'est un pari intelligent : correct 99% du temps, énorme gain de performance

**Transition** : « Voyons comment ce mécanisme fonctionne en détail. »

### [01:30-04:00] Concept clé — Type Feedback, Guards et Déoptimisation

#### Type Feedback
- À chaque opération (`+`, `.prop`, `f()`), V8 enregistre les types observés
- Exemple : `function add(a, b) { return a + b; }`
  - Si appelée 100 fois avec des nombres → feedback = `Number`
  - TurboFan génère un `fadd` (addition flottante) directement

#### Guards (vérifications de type)
- Le code optimisé insère des **guards** avant chaque opération spéculative
- Un guard vérifie que le type réel correspond à la supposition
- Pseudo-code :
  ```
  // Code TurboFan pour add(a, b)
  guard: a is Number → sinon, deopt!
  guard: b is Number → sinon, deopt!
  result = fadd(a, b)  // instruction CPU directe
  ```

#### Déoptimisation
- Quand un guard échoue, V8 **abandonne** le code optimisé
- Il reconstruit l'état de la pile (frame) pour reprendre en Ignition
- Le Feedback Vector est mis à jour avec le nouveau type
- Le code peut être re-optimisé plus tard avec des hypothèses plus larges

#### Le deopt limiter
- Après ~10 déoptimisations, V8 arrête d'optimiser la fonction
- La fonction reste en Ignition/Sparkplug définitivement
- C'est pourquoi la **stabilité de types** est cruciale pour la performance

**Transition** : « Observons ça en direct dans le terminal. »

### [04:00-08:00] Démonstration pratique — Lab 10

#### Étape 1 : Observer les optimisations
```bash
node --trace-opt labs/lab-10-jit-deoptimization/exercise.js
```
- Identifier les lignes `[marking <nom_fonction> for optimization to TurboFan]`
- Montrer que seules les fonctions « hot » (appelées souvent) sont marquées
- Compter combien de fois la fonction est appelée avant l'optimisation (~1000-2000 appels)

#### Étape 2 : Provoquer une déoptimisation
```bash
node --trace-opt --trace-deopt labs/lab-10-jit-deoptimization/exercise.js
```
- Repérer `[deoptimizing ...]` dans la sortie
- Lire la **raison** de la déopt : `not a Number`, `wrong map`, `missing value`
- Montrer le code fautif : un appel avec un type différent après l'optimisation
  ```javascript
  function add(a, b) { return a + b; }
  for (let i = 0; i < 10000; i++) add(i, i); // optimisé pour Number
  add("hello", "world"); // BOOM → déopt !
  ```

#### Étape 3 : Corriger et comparer
- Version corrigée : séparer les fonctions par type ou utiliser un type cohérent
- Re-lancer avec `--trace-opt` → plus de déoptimisation
- Mesurer avec `performance.now()` : montrer le gain (souvent 5-20x)

**Transition** : « Allons plus loin dans les techniques d'optimisation de TurboFan. »

### [08:00-11:00] Approfondissement — Inlining, Escape Analysis, OSR

#### Inlining
- TurboFan **copie** le corps des petites fonctions dans l'appelant
- Élimine le coût de l'appel de fonction (setup frame, arguments)
- Exemple : `arr.map(x => x * 2)` — le callback est inliné dans la boucle de `map`
- Limite : fonctions trop grosses ou trop polymorphiques ne sont pas inlinées

#### Escape Analysis
- Détecte les objets qui ne « s'échappent » pas de la fonction
- Si un objet reste local, V8 peut le **scalar-replace** (mettre les champs dans des registres)
- Élimine l'allocation heap + la pression sur le GC
- Exemple :
  ```javascript
  function distance(x1, y1, x2, y2) {
    const diff = { dx: x2 - x1, dy: y2 - y1 }; // objet local
    return Math.sqrt(diff.dx ** 2 + diff.dy ** 2);
  }
  // TurboFan peut éliminer l'objet diff entièrement
  ```

#### OSR (On-Stack Replacement)
- Optimisation **en cours d'exécution** d'une boucle longue
- V8 n'attend pas la prochaine invocation — il remplace le code pendant que la boucle tourne
- Le point d'entrée OSR est au début de la boucle
- Particulièrement utile pour les boucles `for` de millions d'itérations

**Transition** : « Résumons les règles d'or pour écrire du code V8-friendly. »

### [11:00-14:00] Récap + Règles d'or

#### Les 5 règles pour du code optimisable
1. **Stabilité de types** : toujours passer les mêmes types à une fonction
2. **Constructeurs cohérents** : initialiser toutes les propriétés dans le constructeur, toujours dans le même ordre
3. **Éviter `delete`** : utiliser `obj.prop = undefined` plutôt que `delete obj.prop`
4. **Tableaux homogènes** : ne pas mélanger entiers, flottants et objets dans un même tableau
5. **Fonctions petites** : favoriser les fonctions courtes qui peuvent être inlinées

#### Ce qui cause des déoptimisations fréquentes
| Pattern dangereux | Alternative |
|---|---|
| `arguments` objet | Rest parameters `...args` |
| `try/catch` dans une hot loop | Extraire le try/catch hors de la boucle |
| `eval()` / `with` | Ne jamais utiliser |
| Changement de forme d'objet | Initialiser toutes les propriétés dès le départ |

#### Quiz rapide
- « Qu'est-ce qu'un guard dans le code TurboFan ? » → Une vérification de type avant une opération spéculative
- « Combien de déopts avant que V8 abandonne ? » → Environ 10

> « Module suivant : Hidden Classes et Inline Caching — comment V8 rend l'accès aux propriétés ultra-rapide. »

## Points d'attention pour l'enregistrement
- Bien expliquer l'analogie du cuisinier — c'est la clé pour comprendre la spéculation
- Montrer les traces `--trace-opt` et `--trace-deopt` ligne par ligne, pas en bloc
- Prendre le temps de lire la raison de la déoptimisation à voix haute
- L'escape analysis est subtile — utiliser le schéma objet-dans-registres vs objet-sur-heap
- Éviter de surcharger : les apprenants n'ont pas besoin de connaître tous les types de déopt
