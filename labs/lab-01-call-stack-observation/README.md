# Lab 01 — Observer la Call Stack

## Objectifs

- Comprendre comment la **pile d'appels** (call stack) fonctionne dans le moteur V8
- Savoir capturer et lire une **stack trace** avec `Error().stack` et `console.trace()`
- Observer le comportement du moteur lors d'un **dépassement de pile** (stack overflow)
- Déterminer la profondeur maximale de la pile sur votre machine

## Prérequis

- Node.js 20+
- Aucun module externe nécessaire

## Lancer l'exercice

```bash
node exercise.js
```

## Instructions

### Partie 1 — Prédiction de la pile d'appels

Vous trouverez dans `exercise.js` une série de fonctions imbriquées (`alpha`, `beta`, `gamma`, `delta`). À chaque point marqué `// TODO`, vous devez **prédire** l'état de la pile d'appels avant de lancer le code.

Écrivez vos prédictions dans les chaînes de caractères prévues, puis lancez le script pour vérifier.

### Partie 2 — Capture de stack traces

Implémentez la fonction `captureStackAtEachLevel` qui effectue des appels récursifs et **capture la trace de la pile** à chaque niveau de profondeur (de 0 à `depth - 1`). Retournez un tableau contenant chaque trace.

### Partie 3 — Trouver la profondeur maximale

Implémentez `findMaxStackDepth()` pour déterminer la **profondeur maximale** de la pile d'appels sur votre machine. Vous devez utiliser un mécanisme de récursion avec un `try/catch` pour intercepter l'erreur `RangeError: Maximum call stack size exceeded`.

## Ce qu'il faut observer

1. Les traces de pile se lisent **de bas en haut** : la première ligne est la fonction la plus récente, la dernière est le point d'entrée.
2. La profondeur maximale varie selon l'environnement (~10 000 à ~15 000 dans V8/Node.js).
3. Chaque appel de fonction **ajoute un frame** à la pile ; chaque `return` en **retire un**.
4. `console.trace()` affiche la pile sur `stderr`, tandis que `new Error().stack` renvoie une chaîne exploitable.

## Indices

- `new Error().stack` retourne une chaîne multilignes. Chaque ligne correspond à un frame.
- Pour compter les frames, vous pouvez faire `stack.split('\n').length`.
- La taille de la pile dépend de la taille de chaque frame (nombre de variables locales, etc.).
- Attention : les fonctions fléchées anonymes apparaissent comme `<anonymous>` dans la trace.
