# Lab 03 — Intervention : un `async` qui bloque quand même la boucle d'événements

> **Outcome :** à la fin, tu sais que `async`/`await` ne rend PAS automatiquement un
> traitement non-bloquant — une fonction `async` dont le corps est 100% synchrone bloque la
> boucle d'événements exactement comme une fonction normale, pour la même durée totale. Tu
> sais découper un traitement CPU-intensif en morceaux qui rendent la main.
> **Vrai outil :** `setImmediate` comme point de reprise, un VRAI timer qui tourne pendant
> le calcul pour mesurer si la boucle d'événements a pu s'exécuter entre-temps — pas une
> supposition sur ce que `async` fait "sous le capot".
> **Feedback :** `npm run lab:03` — fonctionnel vert, écart de boucle d'événements rouge
> (152 ms mesurés, très loin du seuil de 30 ms). `npm run solution:03` prouve l'oracle.
> `AUDIT.md` se remplit AVANT tout code.

## Prérequis technique

`npm install` depuis `01-js-runtime/labs`.

## Lire avant (une lecture bornée)

- Module [`03-event-loop.md`](../../modules/03-event-loop.md) — pourquoi Node est
  mono-thread, ce que "bloquer la boucle d'événements" veut dire concrètement.
- Module [`06-async-await-under-the-hood.md`](../../modules/06-async-await-under-the-hood.md)
  — `async`/`await` est du sucre syntaxique sur des promesses ; ça ne rend PAS un calcul
  synchrone non-bloquant tout seul.

## Énoncé

`recomputeChecksums` (`src/recomputeChecksums.ts`) est **en production**. Ticket : *« pendant
le recalcul des empreintes des pièces jointes, l'API ne répond plus à AUCUNE autre requête
pendant plusieurs centaines de millisecondes — pas d'erreur, juste un blocage total. »*

Lis les commentaires en tête du fichier. Découpe le traitement en morceaux, avec un point de
reprise (`setImmediate`) entre chaque morceau, pour laisser la boucle d'événements respirer.

**Le piège à éviter — et le cœur du lab.** La fonction est DÉJÀ `async`. Le réflexe "c'est
async, donc ça ne bloque pas" est faux ici : `async` transforme la fonction pour qu'elle
renvoie une Promise, mais tant qu'aucun `await` ne cède la main À L'INTÉRIEUR du corps, tout
le code s'exécute d'un bloc, de façon parfaitement synchrone du point de vue de la boucle
d'événements. `Promise.resolve().then(...)` ou un simple retour de valeur dans une fonction
`async` NE cède PAS la main — il faut un VRAI point de suspension (`await` sur quelque chose
qui retourne réellement au tour de boucle suivant, comme `setImmediate`).

## Étapes (en friction)

1. Remplis `AUDIT.md`.
2. `npm run lab:03` : fonctionnel vert, le test de boucle d'événements est rouge (écart
   mesuré > 100 ms).
3. Découpe `payloads` en morceaux (ex. 10 par morceau), traite un morceau, puis
   `await new Promise((resolve) => setImmediate(resolve))` avant le morceau suivant.
4. Relance : les 3 tests doivent passer, écart mesuré sous 30 ms.

## Vérifier

```bash
cd 01-js-runtime/labs
npm install
npm run lab:03
npm run solution:03
```

**Ce que l'oracle vérifie**

Fonctionnel : un hash par payload, des payloads différents donnent des hash différents.
Boucle d'événements : un timer qui tourne PENDANT `recomputeChecksums` garde un écart
maximal entre ses ticks sous 30 ms — mesuré en construisant ce lab : ~130-150 ms pour la
version bloquante, ~10-15 ms pour la version découpée. L'écart est assez large pour ne
jamais laisser passer un vrai blocage.

## Variante J+30 (fading)

Le produit veut aussi pouvoir ANNULER un recalcul en cours (l'utilisateur quitte la page).
Le découpage en morceaux avec point de reprise rend-il ça plus facile ? Où ajouterais-tu la
vérification d'annulation ?

## Application TribuZen

Même correction sur un vrai traitement CPU-intensif de `tribuzen-api` — au-delà d'un certain
volume, la vraie solution n'est plus le découpage mais un `worker_thread` dédié (module 13,
scheduling et concurrence), pour libérer complètement le thread principal. Commit :
`fix(checksums): traitement découpé, boucle d'événements libre pendant le calcul (mesuré <15ms)`.
