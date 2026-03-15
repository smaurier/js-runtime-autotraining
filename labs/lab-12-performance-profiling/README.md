# Lab 12 — Performance Profiling

## Objectifs

- Maîtriser le profiler V8 intégré (`--prof` et `--prof-process`)
- Savoir lire un rapport de tick processor et identifier les goulots d'etranglement
- Corriger 4 problèmes de performance dans un programme deliberement lent
- Utiliser `performance.mark()` / `performance.measure()` pour instrumenter le code
- Rediger un rapport de synthese comparant avant/après

## Prérequis

- Node.js v18+
- Labs 09-11 termines (comprehension du bytecode, des deopts, des hidden classes)

## Commande d'exécution

```bash
# Etape 1 : Profiler le programme (genere un fichier isolate-*.log)
node --prof exercise.js

# Etape 2 : Analyser le rapport
node --prof-process isolate-0x*.log > profile-report.txt

# Etape 3 : Lire le rapport
cat profile-report.txt

# Solution optimisee
node --prof solution.js
```

## Structure du lab

| Partie | Sujet |
|--------|-------|
| 1 | Profiler le programme lent, identifier les 4 goulots d'etranglement |
| 2 | Corriger : fibonacci, string concat, JSON hot path, I/O sync |
| 3 | Instrumenter avec performance.mark/measure, comparer avant/après |
| 4 | Rediger un rapport de synthese des optimisations |

## Les 4 goulots d'etranglement

1. **Fibonacci récursif** sans memoisation — complexite exponentielle O(2^n)
2. **Concatenation de chaines** avec `+=` en boucle — allocation O(n^2)
3. **JSON.parse/stringify** dans un chemin chaud — parsing inutile à chaque iteration
4. **Lecture de fichier synchrone** dans une boucle — I/O bloquant repete

## Comment lire le rapport --prof-process

```
[Summary]:
  ticks  total  nonlib   name
  1234   50.0%  55.0%    JavaScript
  500    20.0%  22.0%    C++
  300    12.0%  13.0%    GC

[JavaScript]:
  ticks  total  nonlib   name
  800    32.0%  35.0%    LazyCompile: slowFibonacci ...
  200     8.0%   9.0%    LazyCompile: buildReport ...
```

- **ticks** : echantillons CPU ou la fonction etait sur la pile
- **total** : pourcentage du temps total d'exécution
- Les fonctions en haut = goulots d'etranglement

## Criteres de reussite

- Les 4 goulots sont identifies et nommes
- Chaque correction est implementee et expliquee
- Le programme optimise est au moins 10x plus rapide
- Un avant/après avec performance.mark/measure est présenté
- Le rapport de synthese est complete
