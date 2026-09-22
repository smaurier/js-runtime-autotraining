# Lab 01 — Profil de perf : mesurer, trouver, corriger, prouver au chiffre

> **Outcome :** à la fin, tu as construit un micro-benchmark qui ne ment pas (warm-up JIT
> inclus) et tu l'as utilisé pour PROUVER qu'une implémentation "correcte" d'un rapport
> texte était en réalité quadratique — un piège invisible à petite échelle, réel en
> production. Tu ne "sais" pas que la version O(n) est plus rapide : tu l'as mesuré.
> **Vrai outil :** `performance.now()` (Node), aucune dépendance. La preuve n'est pas "ça a
> l'air plus rapide" — c'est un ratio de temps mesuré à deux échelles, comparé à ce que O(n)
> et O(n²) prédisent.
> **Feedback :** `npm run lab:01` — RED tant que `src/report.ts` ne satisfait pas l'oracle,
> performance comprise. `npm run solution:01` prouve l'oracle.

## Prérequis technique

`npm install` depuis `01-js-runtime/labs`. Le test de performance manipule jusqu'à 800 000
éléments — quelques centaines de millisecondes, rien de plus.

## Lire avant (une lecture bornée)

- Module [`12-performance-patterns.md`](../../modules/12-performance-patterns.md) — profiler
  avant d'optimiser, un benchmark qui ne ment pas (warm-up, `performance.now`), le coût réel
  de la construction de chaînes en boucle.

## Énoncé

Lis les commentaires en tête de `src/report.ts`. Construis `measure()` (l'outil) ET
`buildReport()` (la fonction à mesurer). `buildReport` doit être fonctionnellement correcte
ET rester O(n) — le dernier bloc de tests le mesure en vrai, à deux échelles.

**Le piège — vécu, pas juste raconté.** `texte += item` en boucle est un classique "à
éviter" des entretiens techniques, mais sur quelques dizaines de milliers d'éléments, V8 le
masque presque complètement (une optimisation interne — `ConsString` — retarde la vraie
copie). Un premier jet "corrigé à l'œil" sur un petit jeu de test peut sembler très bien
alors qu'il explose en production sur un vrai volume. C'est tout le sens de "mesurer
d'abord" : ce lab te fait mesurer à l'échelle où le problème redevient visible (entre
200 000 et 800 000 lignes), pas à une échelle qui le cache par accident.

## Étapes (en friction)

1. `npm run lab:01` : RED partout.
2. Écris `measure()` en premier (warm-up puis mesure d'un seul appel) — teste-le sur une
   fonction triviale avant de l'utiliser pour de vrai.
3. Écris `buildReport()` avec un tableau + `.join("\n")`, jamais une concaténation en boucle.
4. Relance : le test de performance compare `buildReport` à 200 000 puis 800 000 lignes — le
   ratio doit rester sous 9 (linéaire mesuré : ~5 ; quadratique mesuré : ~17-24).

## Vérifier

```bash
cd 01-js-runtime/labs
npm install
npm run lab:01
npm run solution:01
```

**Ce que l'oracle vérifie**

`buildReport` produit le bon texte (en-tête + lignes jointes), gère la liste vide.
`measure()` retourne résultat et durée, exécute le warm-up (3 appels par défaut, configurable)
AVANT l'appel mesuré. `buildReport`, mesuré à 200 000 puis 800 000 éléments (×4 de données),
a un ratio de temps sous 9 — une implémentation en `+=` répété, vérifiée en construisant ce
lab, produit un ratio de 17 à 24 à cette échelle et échoue ce test précis, alors qu'elle
passe tous les autres.

## Variante J+30 (fading)

Le produit veut streamer le rapport (l'envoyer ligne par ligne au fur et à mesure, pas tout
d'un coup en mémoire). `buildReport` telle quelle s'y prête-t-elle ? Qu'est-ce qui change
dans le contrat ?

## Application TribuZen

Même geste sur un endpoint chaud de `tribuzen-api` (cours 09) : profiler avant de toucher au
code, mesurer à l'échelle réelle de production, pas sur le jeu de données de dev. Commit :
`perf(report): O(n) au lieu de O(n²), mesuré ×17-24 sur 800k lignes`.
