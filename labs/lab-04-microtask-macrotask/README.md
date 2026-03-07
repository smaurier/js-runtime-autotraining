# Lab 04 — Microtasks vs Macrotasks

## Objectifs

- Distinguer clairement **microtasks** (Promise.then, queueMicrotask) et **macrotasks** (setTimeout, setImmediate)
- Résoudre 5 puzzles d'ordonnancement de difficulté croissante
- Implémenter une fonction qui **alterne** entre microtask et macrotask pour prouver la différence
- Créer une « bombe de microtasks » et mesurer l'impact sur l'event loop
- Construire un **système de priorités** basé sur microtask vs macrotask

## Prérequis

- Node.js 20+
- Aucun module externe nécessaire

## Lancer l'exercice

```bash
node exercise.js
```

## Instructions

### Partie 1 — 5 puzzles d'ordonnancement

Chaque puzzle contient 5+ `console.log` avec des numéros. Prédisez l'ordre exact de sortie avant de lancer le script. Les puzzles augmentent en difficulté.

### Partie 2 — Alternance microtask / macrotask

Implémentez `alternateQueues(count)` : une fonction qui programme `count` tâches en alternant entre `queueMicrotask` et `setTimeout`. Observez quand chaque tâche s'exécute pour prouver que les microtasks s'intercalent avant les macrotasks.

### Partie 3 — Bombe de microtasks

Créez une boucle récursive de `queueMicrotask` qui programme une nouvelle microtask à chaque itération. Mesurez combien de microtasks peuvent s'exécuter en 100 ms avant que l'event loop ne soit notablement bloqué.

### Partie 4 — Système de priorités

Implémentez `PriorityScheduler` : une classe avec 3 niveaux de priorité (high, normal, low) mappés sur `process.nextTick`, `queueMicrotask` et `setTimeout` respectivement.

## Ce qu'il faut observer

1. Les microtasks sont **toujours vidées** avant la prochaine macrotask
2. `queueMicrotask` récursif bloque l'event loop tout comme `process.nextTick` récursif
3. La distinction microtask/macrotask est la base de tout ordonnancement asynchrone en JavaScript
4. Un système de priorités basé sur les files du runtime est un pattern avancé mais puissant

## Indices

- `performance.now()` permet de mesurer les durées avec précision
- Une microtask récursive bloque les timers indéfiniment
- Pour le scheduler, pensez à `process.nextTick` pour la priorité haute, `queueMicrotask` pour la normale, et `setTimeout(fn, 0)` pour la basse
