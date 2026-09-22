# JavaScript Runtime — Comprendre le moteur sous le capot

![VitePress](https://img.shields.io/badge/-VitePress-646CFF?style=flat-square&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
[![fullstack-autotraining](https://img.shields.io/badge/curriculum-fullstack--autotraining-4C1?style=flat-square)](https://github.com/smaurier/fullstack-autotraining)

Formation avancée sur le fonctionnement interne du runtime JavaScript (V8, event loop, mémoire, JIT).

**Ce cours n'est PAS un cours de syntaxe.** Tu maîtrises déjà JavaScript. Ici on ouvre le capot pour comprendre **comment** et **pourquoi** les choses fonctionnent.

<!-- labs-gestes:start -->
## Labs — refonte du 22/09/2026 : un lab = un geste métier complet

> Règle qualité 5 du parcours : chaque lab est **un geste métier complet**, sous deux formes — **Zéro** (construire de zéro un artefact réel et entier) ou **Intervention** (modifier de l'existant avec consommateurs, findings avant code, non-régression). Un lab n'entre en file qu'avec un **oracle exécutable** (`src/` starter · `test/` · `solution/` séparée). Les labs historiques de ce cours (un concept par lab, sans oracle) restent dans `labs/` jusqu'à remplacement et **ne sont plus la file**. Cible détaillée : [`docs/gestes-complets.md`](../docs/gestes-complets.md). État : **1/3 avec oracle**.

| # | Lab | Forme | Geste | Oracle |
|---|-----|-------|-------|--------|
| 01 | [`lab-01-profil-de-perf`](labs/lab-01-profil-de-perf/README.md) | Zéro | mesurer, trouver, corriger, prouver au chiffre | ✅ vérifié |
| 02 | `lab-02-fuite-memoire` | Intervention | dans un composant existant | · à écrire |
| 03 | `lab-03-event-loop-bloque` | Intervention | en prod, diagnostic et correction | · à écrire |

<!-- labs-gestes:end -->

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


## Lancer le cours

```bash
npm install          # une seule fois
npm run docs:dev     # ouvre http://localhost:5173
```

Le site s'ouvre avec une sidebar navigable. Commence par le premier module (00).
