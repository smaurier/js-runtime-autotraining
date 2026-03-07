# Lab 03 — Event Loop Order

## Objectifs

- Prédire l'**ordre d'exécution exact** de code mêlant `setTimeout`, `Promise.then`, `process.nextTick`, `queueMicrotask`, `setImmediate` et des callbacks I/O
- Écrire une fonction qui **prouve** quelle phase de l'event loop s'exécute en premier
- Observer la **famine** (starvation) causée par `process.nextTick` récursif
- Résoudre un puzzle d'ordonnancement complexe avec des timeouts et promises imbriqués

## Prérequis

- Node.js 20+
- Aucun module externe nécessaire

## Lancer l'exercice

```bash
node exercise.js
```

## Instructions

### Partie 1 — Prédire l'ordre de 10+ opérations asynchrones mélangées

Le fichier contient 10 snippets de difficulté croissante. Pour chaque snippet, écrivez votre prédiction dans le tableau `prediction` **avant** de lancer le script, puis vérifiez.

### Partie 2 — Prouver quelle phase s'exécute en premier

Implémentez `provePhaseOrder()` : une fonction qui programme UNE tâche dans chaque file (nextTick, microtask, timer, check/immediate, I/O) et enregistre l'ordre réel d'exécution.

### Partie 3 — Starvation par process.nextTick récursif

Démontrez qu'un `process.nextTick` récursif bloque indéfiniment les `setTimeout`. Mesurez combien de temps le timeout est retardé.

### Partie 4 — Puzzle avec timeouts et promises imbriqués

Un puzzle très difficile avec des `setTimeout` imbriqués dans des `.then()`, des `await` dans des callbacks de timers, et des `nextTick` intercalés.

## Règles de l'Event Loop (rappel)

1. Le code **synchrone** s'exécute en premier
2. `process.nextTick` — vidé après chaque phase, AVANT les microtasks
3. `queueMicrotask` / `Promise.then` — microtasks, vidées avant la prochaine macrotask
4. `setTimeout(fn, 0)` — macrotask dans la file des timers
5. `setImmediate` — macrotask dans la phase « check » (après I/O)
6. Entre chaque macrotask, TOUTES les microtasks sont vidées

## Indices

- Dans un callback I/O, `setImmediate` s'exécute **toujours** avant `setTimeout`
- `process.nextTick` récursif vide sa file **avant** de passer aux microtasks
- `await` = `promise.then` implicite : le code après `await` est une microtask
- Dessinez un schéma de la file d'attente à chaque étape si nécessaire
