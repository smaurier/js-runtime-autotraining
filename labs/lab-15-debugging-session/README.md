# Lab 15 — Diagnostic de performance

## Objectifs

- Maitriser la methodologie de diagnostic en 5 etapes (Observer, Mesurer, Hypothese, Corriger, Verifier)
- Utiliser les flags V8 (`--trace-gc`, `--trace-deopt`, `--trace-ic`, `--cpu-prof`) pour identifier des problemes reels
- Diagnostiquer et corriger 6 problemes de performance dans un programme deliberement defaillant
- Instrumenter le code avec `performance.mark()` / `performance.measure()` pour valider les corrections
- Rediger un diagnostic structure pour chaque probleme (outil, cause racine, fix)

## Prerequis

- Node.js v20+
- Modules 07-14 termines (GC, memory leaks, V8 architecture, hidden classes, performance patterns)
- Connaissance des flags V8 de diagnostic

## Commandes d'execution

```bash
# Etape 1 : Lancer le programme et observer les symptomes
node exercise.js

# Etape 2 : Tracer le garbage collector
node --trace-gc exercise.js 2>&1 | head -50

# Etape 3 : Tracer les deoptimisations
node --trace-deopt exercise.js 2>&1 | head -40

# Etape 4 : Tracer les inline caches
node --trace-ic exercise.js 2>&1 | grep -i mega | head -20

# Etape 5 : Profiling CPU
node --cpu-prof exercise.js
# Ouvrir le .cpuprofile dans Chrome DevTools > Performance

# Etape 6 : Forcer le GC pour observer le comportement memoire
node --expose-gc exercise.js

# Solution corrigee
node solution.js
```

## Structure du lab

| Partie | Sujet |
|--------|-------|
| 1 | Lancer avec les flags de diagnostic, observer les symptomes |
| 2 | Identifier les 6 problemes de performance |
| 3 | Rediger un diagnostic pour chaque probleme (outil + cause racine) |
| 4 | Corriger chaque probleme dans le code |
| 5 | Instrumenter avec performance.mark/measure, verifier les ameliorations |

## Les 6 problemes a trouver

1. **Fuite memoire** — un cache qui grandit sans limite
2. **Deoptimisation** — une fonction qui recoit des objets avec des shapes differentes
3. **Pression GC** — des allocations massives de chaines dans une boucle chaude
4. **IC megamorphique** — des objets heterogenes traites par une meme fonction
5. **Operation bloquante** — un JSON.parse synchrone d'une enorme chaine dans le chemin critique
6. **Fuite de listeners** — des handlers d'evenements ajoutes a chaque requete, jamais retires

## Indices

- Probleme 1 : cherchez les structures de donnees qui grandissent sans jamais shrink
- Probleme 2 : lancez avec `--trace-deopt` et cherchez "wrong map"
- Probleme 3 : lancez avec `--trace-gc` et observez la frequence des Scavenge
- Probleme 4 : lancez avec `--trace-ic` et cherchez "MEGAMORPHIC"
- Probleme 5 : lancez avec `--cpu-prof` et cherchez le hotspot dans le flame chart
- Probleme 6 : observez le nombre de listeners sur l'EventEmitter

## Criteres de reussite

- Les 6 problemes sont identifies et nommes correctement
- Chaque diagnostic indique l'outil utilise et la cause racine
- Chaque correction est implementee et fonctionnelle
- Les mesures avant/apres montrent une amelioration significative
- Le programme corrige ne presente plus de fuite memoire
