# Lab 16. Itérateurs et ressources

> **Outcome :** à la fin, tu sais chaîner des transformations sans matérialiser de tableau
> intermédiaire, et libérer une ressource de façon garantie sans écrire un seul `try/finally`.
>
> **Vrai outil :** Vitest. L'oracle ne vérifie pas que ton résultat est juste, ou pas seulement :
> il **compte** les appels à la normalisation et les libérations de connexion. C'est ce qui lui
> permet de distinguer un code qui marche d'un code qui marche bien.
>
> **Feedback :** `npm run lab:16` depuis `01-js-runtime/labs`. RED tant que `src/` ne satisfait
> pas l'oracle. `npm run solution:16` prouve que l'oracle est juste, et ne s'ouvre qu'après ton
> GREEN.

## Lire avant

Module [`16-features-du-langage-livrees`](../../modules/16-features-du-langage-livrees.md),
**une fois** : § 2.1 les helpers d'itérateurs, § 2.8 la gestion explicite des ressources, et le
§ 4 pièges 1, 2, 4 et 5.

⛔ Ne lis pas le § 3 « Worked examples » avant ton GREEN : l'exemple 1 est ce lab, résolu.

## Énoncé

`src/lectureMembres.ts` lit les membres actifs d'une famille et rend les `limite` premiers.
**Ce code marche.** Il rend exactement le bon résultat, et il libère sa connexion. C'est
précisément pour cela que ses deux défauts survivent des années en production.

1. Il appelle la normalisation sur **12 000 lignes** pour en rendre 20.
2. La connexion **fuit** dès qu'une exception traverse : `release()` n'est jamais atteint.

**Tu réécris `src/lectureMembres.ts`.** Tu ne modifies pas `fixtures/infra.ts`, qui est
l'infrastructure simulée et le compteur de l'oracle.

Trois contraintes :

- **aucun `finally`** dans ton code. Le lab porte sur `using` : l'objet sait se fermer, et le
  langage garantit l'appel ;
- **aucun `.slice()`** : `.take(limite)` s'arrête dès qu'il a son compte, `slice` suppose un
  tableau déjà construit ;
- la **source** doit être lue paresseusement, pas seulement la chaîne. Regarde ce que
  `fixtures/infra.ts` expose à côté de `query()`.

## Vérifier

| Ce qui est vérifié | Seuil |
|---|---|
| le résultat : 20 membres, tous actifs, ids 1, 5, … 77 | exact |
| appels à la normalisation pour rendre 20 membres | **moins de 200**, au lieu de 12 000 |
| lignes lues à la source | **moins de 200** |
| connexion ouverte puis fermée | exactement 1 et 1 |
| connexion fermée **alors qu'une exception traverse** | 1 |
| aucun `finally`, et un `using` présent | forme du source |
| `.take(` présent, `.slice(` absent | forme du source |
| demander 5 coûte moins que demander 40 | strictement |

Le tableau se lit en entier : un `try/finally` satisfait la ligne « exception » mais échoue sur
la forme ; une chaîne paresseuse posée sur `query()` satisfait les normalisations mais échoue sur
les lignes lues. Les deux ensemble demandent `using` **et** le curseur.

## Sonde de rougissement

Après ton GREEN, remplace `await using connexion = …` par `const connexion = …` et ajoute
`connexion.brute.release()` à la fin, en chemin heureux :

```bash
npm run lab:16
```

**Attendu :** le test « la connexion est fermée MÊME si la normalisation jette » échoue, et celui
sur la forme aussi. Les six autres passent toujours, ce qui est le point : **ton code marche, et
il fuit.** Remets `await using` ensuite.

## Ce que ce lab apprend, au-delà de la syntaxe

Un oracle qui ne vérifie que le résultat valide du code qui fuit et du code qui gaspille. Pour
distinguer un code juste d'un code bien fait, il faut **mesurer un comportement** : ici, un
compteur d'appels et un compteur de libérations.

C'est transposable à ton propre code : quand une optimisation est annoncée, le test qui la
protège ne doit pas vérifier le résultat, il doit vérifier ce qui a été économisé.
