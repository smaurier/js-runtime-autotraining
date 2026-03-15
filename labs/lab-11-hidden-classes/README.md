# Lab 11 — Hidden Classes

## Objectifs

- Comprendre les Hidden Classes (Maps) de V8 et leur impact sur les performances
- Utiliser `%HaveSameMap()` pour vérifier le partage de hidden classes
- Benchmarker l'acces aux propriétés : monomorphe vs polymorphe vs megamorphe
- Identifier ce qui casse les hidden classes : ordre, delete, defineProperty
- Corriger un factory function qui créé des hidden classes incoherentes
- Comparer les performances : class vs literal vs Object.create pour 100 000 objets

## Prérequis

- Node.js v18+
- Le flag `--allow-natives-syntax` est OBLIGATOIRE pour `%HaveSameMap()`
- Lab 09 et 10 termines

## Commande d'exécution

```bash
# Le flag --allow-natives-syntax est indispensable
node --allow-natives-syntax exercise.js

# Solution
node --allow-natives-syntax solution.js
```

**ATTENTION** : `--allow-natives-syntax` donne acces a des fonctions internes de V8. Ne JAMAIS utiliser en production — outil pedagogique uniquement.

## Structure du lab

| Partie | Sujet |
|--------|-------|
| 1 | Même propriétés même ordre vs ordre différent → `%HaveSameMap()` |
| 2 | Benchmark : monomorphe vs polymorphe vs megamorphe (1000+ objets) |
| 3 | Casser les hidden classes : ordre, delete, defineProperty |
| 4 | Corriger un factory function mal écrit |
| 5 | Comparer class vs literal vs Object.create pour 100 000 objets |

## Fonctions natives V8 utilisees

| Fonction | Usage |
|----------|-------|
| `%HaveSameMap(a, b)` | Retourne `true` si a et b ont la même hidden class |
| `%DebugPrint(obj)` | Affiche les details internes (map, type, éléments kind) |

## Criteres de reussite

- Partie 1 : toutes les comparaisons `%HaveSameMap()` sont correctes et expliquees
- Partie 2 : le benchmark montre une degradation mesurable mono → poly → mega
- Partie 3 : les 3 manières de casser les hidden classes sont demontrees
- Partie 4 : le factory corrige produit des objets avec la même map
- Partie 5 : comparaison chiffree de class vs literal vs Object.create
