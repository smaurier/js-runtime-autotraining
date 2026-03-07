# Screencast 15 — Session de Debugging

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/15-debugging-session.md`
- **Lab associé** : `labs/lab-15-debugging-session/`
- **Prérequis** : Tous les modules précédents (01-14), en particulier Modules 07-08 (GC, Memory Leaks), 09-11 (V8, JIT, Hidden Classes), 12 (Performance)

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Fichiers du lab-15 prêts (`exercise.js`, fichiers buggés à diagnostiquer)
- [ ] Node.js v20+ avec les flags `--expose-gc`, `--trace-gc`, `--trace-opt`, `--trace-deopt`
- [ ] Chrome DevTools prêt (onglets Performance et Memory)
- [ ] Éditeur de code ouvert sur les fichiers du lab

## Script

### [00:00-01:30] Introduction — La méthodologie scientifique du debugging

> « Bienvenue dans le dernier module. On va appliquer la méthode scientifique au debugging. Pas de console.log aléatoire — une approche structurée qui fonctionne à tous les coups. »

- Le debugging, ce n'est **pas** deviner. C'est un processus méthodique :
  1. **Symptôme** : qu'est-ce qui ne va pas ? (lent, crash, fuite mémoire)
  2. **Hypothèse** : quelle pourrait être la cause ?
  3. **Diagnostic** : quel outil utiliser pour valider l'hypothèse ?
  4. **Root cause** : quelle est la vraie source du problème ?
  5. **Fix** : quelle modification corriger le problème ?
  6. **Vérification** : le fix résout-il le symptôme sans régression ?

- Analogie médicale : un médecin ne prescrit pas au hasard. Il observe les symptômes, formule une hypothèse, prescrit des examens, identifie la cause, traite, et vérifie la guérison.

**Transition** : « Voyons comment mapper les symptômes aux outils de diagnostic. »

### [01:30-04:00] Concept clé — Mapper symptômes, outils et internals

#### Table de correspondance

| Symptôme | Hypothèse | Outil de diagnostic | Internal concerné |
|----------|-----------|--------------------|--------------------|
| Mémoire qui augmente | Fuite mémoire | Heap snapshots, `--trace-gc` | GC, rétention |
| Temps de réponse élevé | Hot loop non optimisée | CPU profiler, `--trace-opt` | JIT, TurboFan |
| Déoptimisations fréquentes | Types instables | `--trace-deopt` | IC, Hidden Classes |
| Latence des timers | Main thread bloqué | Event loop lag, `--prof` | Event loop, scheduling |
| OOM crash | Allocation excessive | `--max-old-space-size`, heap timeline | V8 heap, old space |
| Startup lent | Parsing/compilation coûteux | `--trace-parse`, bundle size | Scanner, Parser |

#### La carte mentale du diagnostic
```
Symptôme observé
├── Lié à la MÉMOIRE ?
│   ├── Heap snapshots (3-snapshot method)
│   ├── process.memoryUsage()
│   └── --trace-gc, --expose-gc
├── Lié au CPU ?
│   ├── --prof + --prof-process
│   ├── Chrome DevTools Performance
│   └── --trace-opt / --trace-deopt
└── Lié à la LATENCE ?
    ├── Event loop delay monitoring
    ├── setTimeout accuracy check
    └── Worker thread isolation
```

**Transition** : « Passons à la pratique. Le lab-15 contient un programme avec plusieurs bugs de performance. »

### [04:00-08:30] Démonstration pratique — Diagnostic du lab-15

#### Étape 1 : Observer les symptômes
```bash
node --expose-gc --trace-gc labs/lab-15-debugging-session/exercise.js
```
- Observer la sortie : messages `[GC]` fréquents, mémoire qui monte
- Mesurer le temps d'exécution global → anormalement lent
- Lister les symptômes identifiés :
  - Symptôme 1 : la mémoire augmente continuellement (visible dans `--trace-gc`)
  - Symptôme 2 : certaines fonctions sont très lentes
  - Symptôme 3 : des messages de déoptimisation apparaissent

#### Étape 2 : Diagnostiquer la fuite mémoire
- Hypothèse : un cache non borné retient les objets
- Outil : ajouter `global.gc()` et observer si la mémoire redescend
  ```bash
  node --expose-gc labs/lab-15-debugging-session/exercise.js
  ```
- Si la mémoire ne redescend pas après un GC forcé → fuite confirmée
- Utiliser `process.memoryUsage().heapUsed` avant et après chaque opération
- Identifier la structure qui grossit (Map, tableau, closures)
- Root cause : par exemple un `eventEmitter.on()` sans `off()` dans une boucle
- Fix : ajouter le nettoyage des listeners

#### Étape 3 : Diagnostiquer les déoptimisations
```bash
node --trace-deopt labs/lab-15-debugging-session/exercise.js
```
- Lire les raisons : `wrong map`, `not a Smi`, `insufficient type feedback`
- Remonter au code source : une fonction polymorphique qui reçoit des formes d'objets différentes
- Root cause : objets construits avec des propriétés dans un ordre variable
- Fix : normaliser la construction des objets

#### Étape 4 : Diagnostiquer la lenteur CPU
```bash
node --prof labs/lab-15-debugging-session/exercise.js
node --prof-process isolate-*.log > profile.txt
```
- Ouvrir le profil et identifier la fonction la plus coûteuse
- Root cause : par exemple une concaténation de strings en O(n^2)
- Fix : utiliser `Array.join()` ou un buffer

**Transition** : « Voyons comment combiner tous ces outils pour un diagnostic complet. »

### [08:30-11:30] Approfondissement — Combiner les outils

#### Session de debugging intégrale
Montrer un workflow complet de debugging sur un problème complexe :

1. **Observation initiale** : programme lent + mémoire qui monte
2. **CPU Profiler** (`--prof`) → identifie la fonction `processData` comme hotspot (60% du temps)
3. **Trace deopt** (`--trace-deopt`) → `processData` se fait déoptimiser 8 fois
4. **Heap snapshot** → un `Map` contient 50 000 entrées qui ne sont jamais nettoyées
5. **Diagnostic combiné** :
   - La fuite mémoire augmente la pression GC → le GC prend du temps CPU
   - Les déopts empêchent TurboFan d'optimiser → la fonction reste en Ignition
   - Les deux problèmes se renforcent mutuellement

#### Les outils en synergie
```
--trace-gc          →  Le GC tourne trop souvent (40% du temps)
                         ↓ Pourquoi ?
Heap snapshot       →  Un Map grossit sans limite
                         ↓ En parallèle...
--trace-deopt       →  processData se déoptimise (wrong map)
                         ↓ Pourquoi ?
%DebugPrint()       →  Les objets ont des Maps différentes
                         ↓ Root cause
Code review         →  Les objets sont construits conditionnellement
```

#### Corriger dans le bon ordre
1. **D'abord** la fuite mémoire (plus grand impact)
2. **Ensuite** la stabilité de types (permet l'optimisation JIT)
3. **Enfin** vérifier que les optimisations se déclenchent bien

- Re-lancer avec `--trace-opt` → confirmer que `processData` est maintenant optimisé par TurboFan
- Re-mesurer : temps d'exécution divisé par 10, mémoire stable

**Transition** : « Récapitulons le workflow complet. »

### [11:30-14:00] Récap — Le workflow de debugging complet

#### Checklist de diagnostic
```
1. □ Observer le symptôme (lent ? crash ? fuite ?)
2. □ Formuler une hypothèse (CPU ? mémoire ? event loop ?)
3. □ Choisir l'outil adapté (voir table de correspondance)
4. □ Collecter les données (profils, traces, snapshots)
5. □ Identifier la root cause (pas le symptôme !)
6. □ Appliquer le fix (une modification à la fois)
7. □ Vérifier avec les mêmes outils (le symptôme a disparu ?)
8. □ Vérifier l'absence de régression (les tests passent ?)
```

#### Mapper les symptômes aux internals V8
| Ce que tu vois | Ce qui se passe dans V8 |
|---|---|
| Mémoire qui monte | Old Space qui grossit, GC qui n'arrive pas à libérer |
| Fonction lente malgré beaucoup d'appels | IC megamorphic ou déopt récurrente |
| GC qui prend > 10% du temps | Trop d'allocations ou objets trop gros dans Old Space |
| Startup lent | Parsing/compilation de gros bundles, pas de code caching |
| Latence imprévisible | Event loop bloqué par une tâche synchrone |

#### Les 3 réflexes du debugger expert
1. **Toujours mesurer** : pas de « je pense que c'est lent », mais « ça prend 450ms au lieu de 50ms »
2. **Un changement à la fois** : modifier deux choses en même temps empêche de savoir laquelle a fonctionné
3. **Documenter** : noter le symptôme, l'hypothèse, le diagnostic et le fix pour les futurs debuggers

#### Quiz final
- « Quel est l'ordre de diagnostic recommandé ? » → Symptôme → Hypothèse → Diagnostic → Root cause → Fix → Vérification
- « Pourquoi corriger la fuite mémoire avant les déopts ? » → La fuite augmente la pression GC, ce qui amplifie les autres problèmes

> « Bravo, vous avez terminé le cours ! Vous comprenez maintenant le JavaScript runtime de l'intérieur. Continuez à profiler, mesurer et explorer. »

## Points d'attention pour l'enregistrement
- Ce screencast est le final — montrer une progression claire du symptôme au fix
- Bien montrer que les outils se complètent (pas juste un outil isolé)
- Le workflow intégral est le moment fort — prendre le temps de relier chaque étape
- Insister sur la méthode scientifique : hypothèse → expérience → conclusion
- Finir sur une note positive et motivante — les apprenants ont accompli un parcours complet
- S'assurer que tous les flags V8 utilisés sont expliqués (--expose-gc, --trace-gc, etc.)
