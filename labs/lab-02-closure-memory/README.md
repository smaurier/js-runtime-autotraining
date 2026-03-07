# Lab 02 — Closures et Mémoire

## Objectifs

- Mesurer l'**impact mémoire** des closures en JavaScript
- Comprendre comment V8 **optimise** les closures qui ne capturent pas de variables
- Identifier et corriger une **fuite mémoire** causée par une closure qui retient plus que nécessaire
- Maîtriser `process.memoryUsage()` pour diagnostiquer les problèmes de mémoire

## Prérequis

- Node.js 20+
- Aucun module externe nécessaire

## Lancer l'exercice

```bash
node exercise.js
```

## Instructions

### Partie 1 — Mesurer l'empreinte mémoire des closures

Créez une fonction `createHeavyClosures(count)` qui génère `count` closures, chacune retenant une référence à un grand tableau (1 Mo). Mesurez la mémoire **avant** et **après** la création avec `process.memoryUsage().heapUsed`.

### Partie 2 — Optimisation V8 des closures

Comparez trois types de closures :
1. Une closure qui **utilise** une variable de sa portée englobante
2. Une closure qui **ne référence aucune** variable de sa portée
3. Une closure dont la portée contient une grosse donnée mais qui ne l'utilise **pas directement**

Mesurez la mémoire pour chaque cas. V8 optimise-t-il le cas 2 ? Et le cas 3 ?

### Partie 3 — Trouver et corriger la fuite mémoire

La fonction `createLeakyFactory()` crée des gestionnaires d'événements. Elle a un bug subtil : elle retient accidentellement des données volumineuses via sa closure. Identifiez le problème et corrigez-le dans `createFixedFactory()`.

## Ce qu'il faut observer

1. Chaque closure qui **capture** une référence empêche le GC de libérer cette donnée.
2. V8 effectue une analyse statique : si une closure ne référence **aucune** variable de sa portée, il ne les capture pas.
3. **Attention** : si une **seule** closure dans une portée référence une variable, **toutes** les closures de cette portée la retiennent (c'est le contexte de closure partagé).
4. Les fuites mémoire par closure sont parmi les plus subtiles à détecter.

## Indices

- `process.memoryUsage().heapUsed` retourne l'utilisation du tas en octets.
- Pour forcer un GC avant de mesurer, lancez avec `node --expose-gc exercise.js` et appelez `global.gc()`.
- 1 Mo = 1024 * 1024 octets.
- Le "contexte de closure partagé" est une notion clé : deux closures créées dans la même portée partagent le même objet de contexte V8.
