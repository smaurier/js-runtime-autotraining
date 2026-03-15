# Lab 10 — JIT Deoptimization

## Objectifs

- Comprendre le cycle optimisation / deoptimisation de TurboFan
- Savoir provoquer et observer des deoptimisations avec `--trace-opt` et `--trace-deopt`
- Identifier les causes principales de deoptimisation : changement de type, hidden class, ajout de propriétés
- Corriger chaque fonction deoptimisee pour qu'elle reste stable
- Mesurer l'impact concret sur les performances avec `performance.now()`

## Prérequis

- Node.js v18+
- Lab 09 termine (comprehension du bytecode et du feedback de type)

## Commande d'exécution

```bash
# Observer les optimisations et deoptimisations
node --trace-opt --trace-deopt exercise.js

# Pour plus de details sur les raisons
node --trace-opt --trace-deopt --trace-deopt-verbose exercise.js
```

## Structure du lab

| Partie | Sujet |
|--------|-------|
| 1 | Écrire une fonction optimisee, vérifier "optimized" dans la trace |
| 2 | Provoquer une deoptimisation par changement de type |
| 3 | Trois scenarios de deopt : (a) type, (b) hidden class, (c) ajout de propriétés |
| 4 | Corriger chaque fonction pour la rendre optimization-stable |
| 5 | Benchmark : optimise vs deoptimise avec `performance.now()` |

## Messages a chercher dans la sortie

```
[marking ... for optimization]     → V8 a decide d'optimiser la fonction
[compiling method ... using TurboFan] → TurboFan compile le code machine
[deoptimizing ...]                 → V8 a abandonne le code optimise
```

## Causes de deoptimisation

| Cause | Exemple | Message typique |
|-------|---------|-----------------|
| Changement de type | `f(1)` puis `f("a")` | "Insufficient type feedback" |
| Hidden class | Objet de forme différente | "wrong map" |
| Ajout de propriétés | `obj.newProp = x` après optimisation | "map changed" |

## Criteres de reussite

- Partie 1 : l'optimisation est visible dans `--trace-opt`
- Partie 2 : la deoptimisation est visible dans `--trace-deopt`
- Partie 3 : les 3 scenarios sont implementes et chacun provoque une deopt
- Partie 4 : les fonctions corrigees restent optimisees
- Partie 5 : le benchmark montre une différence mesurable (au moins 2x)
