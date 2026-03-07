# Lab 08 — Detection de fuites memoire

## Objectifs

- Comprendre les 5 types principaux de fuites memoire en Node.js
- Apprendre a identifier les fuites avec `process.memoryUsage()`
- Savoir corriger chaque type de fuite
- Verifier que la memoire se stabilise apres correction

## Prerequis

- Node.js 20+
- Comprehension du ramasse-miettes (garbage collector) V8

## Lancement

```bash
# Limiter le tas a 100 Mo pour rendre les fuites visibles plus rapidement
node --max-old-space-size=100 exercise.js

# Pour la solution corrigee
node --max-old-space-size=100 solution.js
```

## Description

Le fichier `exercise.js` contient un programme simulant un serveur avec **5 fuites memoire intentionnelles** :

1. **Map croissante** — Cache de sessions sans TTL (Time To Live), jamais nettoye
2. **Ecouteurs d'evenements** — Listeners ajoutes dans une boucle sans suppression
3. **Closure retenant un buffer** — Fermeture capturant un gros buffer inutilement
4. **Timer capturant un tableau** — `setInterval` qui referenceun tableau grandissant
5. **Reference circulaire avec ressource externe** — Objets se referencant mutuellement avec une ressource non liberee

## Travail demande

Pour **chaque** fuite, vous devez :

1. **Identifier** ou se situe la fuite dans le code (cherchez les commentaires `// FUITE X`)
2. **Expliquer** dans un commentaire POURQUOI ca fuit (quel mecanisme empeche le GC de liberer la memoire)
3. **Corriger** la fuite
4. **Verifier** que la memoire se stabilise en observant la sortie de `monitorMemory()`

## Indices

- Une `Map` qui grandit indefiniment sans `.delete()` ni `.clear()` est une fuite classique
- `EventEmitter` accumule les listeners si on ne les retire pas avec `.removeListener()` ou `.off()`
- Une closure qui capture une variable garde TOUTE la portee lexicale vivante
- `setInterval` maintient en vie tout ce que sa callback reference
- Les references circulaires ne sont pas un probleme pour le GC Mark-and-Sweep de V8, SAUF si un des objets detient une ressource externe (handle, timer, etc.)

## Criteres de reussite

- Les 5 fuites sont identifiees et corrigees
- La memoire heap (RSS et heapUsed) se stabilise au bout de 10-15 secondes
- Le programme peut tourner indefiniment sans crash `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed`
