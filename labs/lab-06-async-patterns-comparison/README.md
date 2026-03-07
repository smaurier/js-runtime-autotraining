# Lab 06 — Async Patterns Comparison

## Objectifs

- Implémenter la **même tache** en 4 styles asynchrones : callbacks, Promises (`.then`), async/await sequentiel, async/await parallele
- Mesurer le **temps d'execution** de chaque style pour prouver leur equivalence ou leurs differences
- Construire un **limiteur de concurrence** `pLimit(concurrency)` depuis zero
- Re-implementer `Promise.allSettled` sans utiliser la version native
- Comparer la **gestion d'erreurs** entre callbacks, `.catch()`, `try/catch`, et le pattern Go-style `[err, result]`

## Prerequis

- Node.js 20+
- Aucun module externe necessaire

## Lancer l'exercice

```bash
node exercise.js
```

## Instructions

### Partie 1 — 4 styles async avec mesure du temps

Une fonction `simulateRequest(id, delay)` est fournie. Implementez le traitement de 10 requetes dans 4 styles differents. Mesurez le temps total pour chaque style.

### Partie 2 — Limiteur de concurrence (pLimit)

Implementez `pLimit(concurrency)` qui retourne une fonction `limit(fn)` garantissant qu'au maximum `concurrency` taches s'executent en parallele. Testez avec 20 taches, max 5 concurrentes.

### Partie 3 — Promise.allSettled from scratch

Implementez `myAllSettled(promises)` sans utiliser `Promise.allSettled`. Le resultat doit etre identique a la version native.

### Partie 4 — Comparaison de la gestion d'erreurs

Le meme scenario d'erreur est gere en 4 styles : callback `(err, result)`, `.catch()`, `try/catch`, et le pattern Go `[err, result]`. Comparez la lisibilite et la robustesse de chaque approche.

## Ce qu'il faut observer

1. Le style callback est le plus verbeux et le plus sujet aux erreurs (callback hell)
2. `.then()` ameliore le chainage mais les erreurs peuvent etre silencieuses
3. `async/await` est le plus lisible et le plus proche du code synchrone
4. Le pattern Go-style force le developpeur a gerer les erreurs explicitement
5. `pLimit` est un pattern essentiel pour controler la charge sur les ressources

## Indices

- `pLimit` doit maintenir une file d'attente interne et un compteur de taches actives
- Pour `myAllSettled`, pensez a `Promise.all` avec un `.then/.catch` sur chaque promesse individuelle
- Le pattern Go-style : `const [err, result] = await goStyle(promise)`
