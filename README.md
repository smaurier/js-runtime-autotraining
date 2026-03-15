# JavaScript Runtime — Comprendre le moteur sous le capot

Formation avancée sur le fonctionnement interne du runtime JavaScript (V8, event loop, mémoire, JIT).

**Ce cours n'est PAS un cours de syntaxe.** Tu maîtrises déjà JavaScript. Ici on ouvre le capot pour comprendre **comment** et **pourquoi** les choses fonctionnent.

## Prérequis

- JavaScript courant (ES2020+, async/await, Promises, closures)
- Avoir complété les formations Vue/Angular/React (où équivalent)
- Node.js 20+ installé
- Chrome DevTools (onglets Performance et Memory)

## Structure

```
modules/     → 16 cours théoriques (Markdown)
labs/        → 15 labs pratiques exécutables (Node.js / navigateur)
```

## Programme

| # | Module | Lab | Thème |
|---|--------|-----|-------|
| 00 | Prérequis et vue d'ensemble | — | Introduction |
| 01 | Call Stack & Contextes d'exécution | Observer la call stack | Exécution |
| 02 | Scope, Closures & Mémoire | Closures et rétention mémoire | Mémoire |
| 03 | Event Loop | Reconstruire l'ordre d'exécution | Asynchrone |
| 04 | Microtasks vs Macrotasks | Prédire l'ordre exact | Asynchrone |
| 05 | Promises — Implémentation interne | Implémenter une Promise | Asynchrone |
| 06 | Async/Await sous le capot | Comparer les patterns async | Asynchrone |
| 07 | Garbage Collector | Observer le GC en action | Mémoire |
| 08 | Memory Leaks | Provoquer et diagnostiquer des fuites | Mémoire |
| 09 | Architecture V8 | Explorer le bytecode Ignition | Moteur |
| 10 | JIT Compilation & Optimisation | Identifier une (dé)optimisation | Moteur |
| 11 | Hidden Classes & Inline Caching | Casser puis réparer les hidden classes | Moteur |
| 12 | Performance Patterns | Profiling et optimisation | Performance |
| 13 | Scheduling & Concurrence | Web Workers, Atomics, rAF | Concurrence |
| 14 | Projet Final | Mini event loop + scheduler | Synthèse |
| 15 | Session de debugging réelle | Diagnostic de performance end-to-end | Diagnostic |

## Exécution des labs

```bash
# Exécuter un lab
node labs/lab-03-event-loop-order/exercise.js

# Comparer avec la solution
node labs/lab-03-event-loop-order/solution.js

# Labs avec profiling V8
node --trace-opt --trace-deopt labs/lab-10-jit-deoptimization/exercise.js

# Labs mémoire (avec heap snapshot)
node --expose-gc labs/lab-07-gc-observation/exercise.js
```

## Durée estimée

~46h (16 modules : 1 module d'introduction + 15 modules × ~3h : lecture + lab + défi)

## Objectifs de sortie

À la fin de ce cursus, tu es capable de :
- Expliquer précisément comment fonctionne l'event loop (navigateur ET Node.js)
- Diagnostiquer un problème de performance JavaScript en conditions réelles
- Comprendre les comportements async complexes (ordre d'exécution, race conditions)
- Identifier et corriger des memory leaks avec les DevTools et les heap snapshots
- Comprendre comment V8 optimise (et dé-optimise) ton code (Hidden Classes, ICs, TurboFan)
- Lire et naviguer la spécification ECMAScript (ECMA-262)
- Mener une session de debugging complète : profiling → diagnostic → fix → vérification
- Raisonner sur les performances runtime et faire des choix éclairés

## Niveau

**Avancé / Ingénieur.** Ce cours explique le *pourquoi* des mécanismes internes, pas seulement leur utilisation.
