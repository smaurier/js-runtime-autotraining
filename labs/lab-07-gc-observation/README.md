# Lab 07 — GC Observation

## Objectifs

- Observer le **garbage collector** de V8 en action avec `global.gc()` et `process.memoryUsage()`
- Comprendre **FinalizationRegistry** pour détecter la collecte d'objets
- Construire un **cache auto-evict** avec `WeakRef` + `FinalizationRegistry`
- Comparer le comportement mémoire avec et sans `WeakRef` pour 10 000 objets
- Mesurer la **duree de pause** du GC et son impact sur les performances

## Prérequis

- Node.js 20+
- **Obligatoire** : lancer avec `--expose-gc` pour acceder a `global.gc()`

## Lancer l'exercice

```bash
node --expose-gc exercise.js
```

## Instructions

### Partie 1 — Allouer des buffers, GC, observer la mémoire

Allouez des `Buffer` de taille croissante, appelez `global.gc()`, et mesurez la mémoire avant/après avec `process.memoryUsage()` pour prouver la liberation.

### Partie 2 — FinalizationRegistry et observation du cleanup

Creez des objets enregistres dans un `FinalizationRegistry`, forcez le GC, et observez les callbacks de nettoyage. Mesurez le delai entre la suppression de la référence et l'appel du callback.

### Partie 3 — Cache auto-evict avec WeakRef + FinalizationRegistry

Implementez une classe `WeakCache` qui stocke des `WeakRef` vers les valeurs. Quand le GC collecte une valeur, le `FinalizationRegistry` nettoie l'entree du cache automatiquement. Testez sous pression mémoire.

### Partie 4 — Comparaison avec et sans WeakRef pour 10 000 objets

Creez 10 000 objets avec des références fortes (Map) et 10 000 avec des WeakRef. Supprimez les références originales, GC, et comparez la mémoire residuelle.

### Partie 5 — Mesurer la duree de pause du GC

Utilisez `performance.now()` avant et après `global.gc()` pour mesurer la duree de pause. Testez avec des charges mémoire croissantes (0, 100k, 500k, 1M objets vivants).

## Ce qu'il faut observer

1. `global.gc()` force un GC complet (mark-compact) qui bloque le thread principal
2. `WeakRef.deref()` retourne `undefined` après la collecte — le GC est non-déterministe
3. `FinalizationRegistry` n'offre aucune garantie de timing — c'est un outil de diagnostic
4. La pause GC est proportionnelle au nombre d'objets vivants a scanner
5. Un cache `WeakRef` permet au GC de liberer la mémoire sous pression

## Indices

- `Buffer.alloc(n)` alloue n octets en mémoire externe (visible dans `process.memoryUsage().external`)
- `process.memoryUsage().heapUsed` mesure le tas V8, `.rss` mesure la mémoire totale du processus
- Les callbacks `FinalizationRegistry` sont des microtasks — ils s'executent après le code synchrone
- Pour forcer l'exécution des callbacks : `global.gc()` suivi d'un `setTimeout` pour laisser passer un tick
