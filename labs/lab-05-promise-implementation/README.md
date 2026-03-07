# Lab 05 — Implémenter une Promise

## Objectifs

- Comprendre le **fonctionnement interne** des Promises en les reconstruisant de zéro
- Implémenter le protocole complet : `then`, `catch`, `finally`, chaînage, propagation d'erreurs
- Implémenter les méthodes statiques : `resolve`, `reject`, `all`, `race`
- Comprendre le rôle des **microtasks** dans la résolution asynchrone des Promises
- Maîtriser l'assimilation de **thenables** (objets avec une méthode `.then`)

## Prérequis

- Node.js 20+
- Aucun module externe nécessaire

## Lancer l'exercice

```bash
node exercise.js
```

## Instructions

Le fichier `exercise.js` contient un squelette de classe `MyPromise` avec des `TODO` pour chaque méthode. Une suite de tests à la fin du fichier vérifie le bon fonctionnement de votre implémentation.

### Étapes recommandées (dans l'ordre)

1. **Constructeur** : implémentez l'exécution synchrone de l'executor avec `resolve` et `reject`
2. **`.then()`** : le coeur — doit retourner une nouvelle MyPromise et gérer les cas synchrone et asynchrone
3. **`.catch()`** et **`.finally()`** : s'appuient sur `.then()`
4. **`MyPromise.resolve()`** et **`MyPromise.reject()`** : méthodes statiques de création
5. **`MyPromise.all()`** : attend que toutes les Promises soient résolues
6. **`MyPromise.race()`** : retourne dès que la première Promise se résout ou rejette

### Règles importantes

- Les callbacks de `.then()` doivent être programmés comme **microtasks** (utilisez `queueMicrotask`)
- `.then()` doit retourner une **nouvelle** MyPromise
- Si `onFulfilled` ou `onRejected` retourne une Promise/thenable, la résolution doit être **différée** jusqu'à la résolution de cette Promise interne
- L'executor peut lancer une exception : elle doit être attrapée et causer un `reject`

## Approche progressive

Si l'exercice complet (`exercise.js`) semble intimidant, commencez par les versions progressives :

### Étape 1 — Les bases (5 tests)
```bash
node exercise-step1.js
```
Implémentez uniquement `resolve` + `.then()` + `MyPromise.resolve()`. Pas de rejet, pas d'erreurs.

### Étape 2 — Gestion des erreurs (10 tests)
```bash
node exercise-step2.js
```
Ajoutez `reject` + `.catch()` + propagation d'erreurs + `MyPromise.reject()`.

### Étape 3 — Version complète (20 tests)
```bash
node exercise-step3.js
```
Ajoutez l'assimilation de thenables + `.finally()` + `MyPromise.all()` + `MyPromise.race()`.

Chaque étape est **autonome** (pas besoin d'importer les précédentes).

## Ce qu'il faut observer

1. Les callbacks ne sont **jamais** appelés de manière synchrone, même si la Promise est déjà résolue
2. Le chaînage fonctionne grâce au fait que `.then()` retourne une nouvelle Promise
3. L'assimilation de thenables permet l'interopérabilité entre différentes implémentations de Promise
4. `MyPromise.all` doit préserver l'**ordre** des résultats (pas l'ordre de résolution)

## Indices

- Une Promise a 3 états : `PENDING`, `FULFILLED`, `REJECTED`
- Quand une Promise est résolue avec une autre Promise/thenable, elle doit attendre la résolution de celle-ci
- `queueMicrotask(fn)` programme `fn` comme microtask (comme le ferait le moteur pour les vraies Promises)
- Pour détecter un thenable : `typeof value?.then === 'function'`
- Attention aux appels multiples de resolve/reject : seul le premier doit avoir un effet
