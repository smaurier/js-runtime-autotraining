# Lab 14 — Mini Event Loop (simulation pedagogique)

## Objectifs

- Comprendre en profondeur le fonctionnement de la boucle d'evenements Node.js
- Implementer un simulateur qui reproduit l'ordre d'execution correct
- Maitriser la priorite : call stack > microtasks > macrotasks
- Comprendre que TOUTES les microtaches sont drainées avant la prochaine macrotache
- Verifier la comprehension avec 5 programmes-puzzle

## Prerequis

- Node.js 20+
- Modules 03-04 (Event Loop en detail)

## Lancement

```bash
# Exercice
node exercise.js

# Solution
node solution.js
```

## Description

Vous devez implementer une classe `MiniEventLoop` qui simule le comportement de la boucle d'evenements JavaScript.

### Architecture interne

```
┌─────────────────────────────┐
│       Call Stack             │  ← Pile d'appels (LIFO)
│  (execution synchrone)      │
└──────────┬──────────────────┘
           │ Quand la pile est vide
           ▼
┌─────────────────────────────┐
│     Micro-task Queue        │  ← Promise.then, queueMicrotask, process.nextTick
│  (TOUTES drainées avant     │
│   la prochaine macrotache)  │
└──────────┬──────────────────┘
           │ Quand la micro-queue est vide
           ▼
┌─────────────────────────────┐
│     Macro-task Queue        │  ← setTimeout, setInterval, I/O callbacks
│  (UNE macrotache a la fois) │
└─────────────────────────────┘
```

### API de MiniEventLoop

```js
const loop = new MiniEventLoop();

loop.run([
  { type: 'sync', name: 'main', body: (ctx) => {
    ctx.log('Hello');
    ctx.setTimeout(() => ctx.log('timeout'), 0);
    ctx.promiseThen(() => ctx.log('microtask'));
  }}
]);

// Resultat attendu : ['Hello', 'microtask', 'timeout']
```

### Regles de la boucle d'evenements

1. **Synchrone d'abord** : tout le code du body s'execute d'abord (push sur la call stack)
2. **process.nextTick** est une microtache prioritaire (avant les Promise.then)
3. **Promise.then / queueMicrotask** : microtaches standard
4. **setTimeout** : macrotache
5. Apres chaque macrotache, TOUTES les microtaches accumulees sont drainées
6. Les microtaches peuvent en creer d'autres (qui seront drainées dans le meme cycle)

## Travail demande

1. Implementer la classe `MiniEventLoop` (~100-150 lignes)
2. Faire passer les 5 programmes-puzzle (tests en bas du fichier)

## Criteres de reussite

- Les 5 programmes produisent la sortie attendue
- L'ordre microtask > macrotask est respecte
- process.nextTick s'execute avant Promise.then
- Les microtaches imbriquees sont drainées dans le bon ordre
