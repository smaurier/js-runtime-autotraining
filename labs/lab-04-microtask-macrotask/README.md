# Lab 04 — Microtasks vs Macrotasks : prédire l'ordre exact

> **Outcome :** à la fin, tu sais prédire à la main l'ordre exact d'un code mêlant `setTimeout`, `Promise`, `process.nextTick`, `setImmediate` et `async/await`, puis le **vérifier** en l'exécutant sous Node.
> **Vrai outil :** Node.js 20+ (`node`), en exécution réelle — aucun harnais simulé, aucun test auto-correcteur.
> **Feedback :** le coach valide ta prédiction en session. La vérité de référence, c'est la sortie réelle de Node.

## Énoncé

On te donne un fichier de puzzle. **Avant de l'exécuter**, tu écris ta prédiction de l'ordre de sortie complet. Ensuite tu lances Node et tu confrontes. L'objectif n'est pas d'avoir juste du premier coup, mais de construire un raisonnement file par file que tu peux dérouler à froid.

Crée `puzzle.js` avec exactement ce contenu :

```js
// puzzle.js — Node.js 20+
async function one() {
  console.log('1');
  await two();
  console.log('2'); // reprise après await → microtask
}

async function two() {
  console.log('3');
}

console.log('A');

setTimeout(() => {
  console.log('B');
  process.nextTick(() => console.log('C'));
  Promise.resolve().then(() => console.log('D'));
}, 0);

one();

process.nextTick(() => {
  console.log('E');
  queueMicrotask(() => console.log('F'));
});

new Promise((resolve) => {
  console.log('G'); // exécuteur SYNCHRONE
  resolve();
})
  .then(() => console.log('H'))
  .then(() => console.log('I'));

console.log('J');
```

## Étapes (en friction)

1. **Sans exécuter**, écris ta prédiction : la suite ordonnée des 13 lettres/chiffres (`A`, `B`, `C`, `D`, `E`, `F`, `G`, `H`, `I`, `J`, `1`, `2`, `3`).
2. Pour t'aider, dessine sur papier **trois colonnes** : `sync`, `nextTick queue`, `microtask queue`, plus une ligne `macrotask`. Remplis-les au fur et à mesure de la lecture du code.
3. Rappelle-toi l'ordre : synchrone → `nextTick` → microtasks Promise → macrotask ; et qu'après le callback du `setTimeout`, on re-vide nextTick puis microtasks.
4. Exécute : `node puzzle.js`. Compare ligne à ligne avec ta prédiction.
5. Pour chaque écart, identifie **quelle file** tu as mal ordonnée. Note la règle qui t'a manqué.
6. Sans regarder le corrigé, réécris à côté la justification d'une ligne qui t'a piégé (souvent `G` synchrone, ou `E` avant `2`).

## Corrigé complet commenté

Exécution réelle sous Node 20+ :

```text
A
1
3
G
J
E
2
H
F
I
B
C
D
```

Déroulé file par file :

```text
── Phase synchrone (call stack) ───────────────────────────────
A                     console.log direct
1                     dans one(), AVANT le await
3                     two() est appelée et log 3 avant que one() ne suspende
G                     l'exécuteur de new Promise est SYNCHRONE
J                     dernier log synchrone
   → planifiés pendant le sync :
     macrotask : [ setTimeout(B) ]
     nextTick  : [ E ]
     microtask : [ reprise-one(=2), H ]   (reprise du await d'abord, puis le .then(H))

── Vidage nextTick (avant les microtasks Promise) ─────────────
E                     log E ; planifie queueMicrotask(F)
   → microtask : [ reprise-one(=2), H, F ]

── Vidage microtask queue (entièrement, while) ────────────────
2                     reprise de one() après `await two()`
H                     1er .then de la chaîne Promise ; planifie .then(I)
F                     la microtask créée par E
I                     2e .then (entré en file quand H s'est résolu)

── Macrotask : phase timers → callback du setTimeout ──────────
B                     log B ; planifie nextTick(C) et Promise.then(D)
   → juste après ce callback, Node re-vide nextTick puis microtasks :
C                     nextTick (prioritaire)
D                     microtask Promise
```

Points de contrôle qui font rater le puzzle :
- `G` sort **avant** `J` et `E` : l'exécuteur `new Promise(fn)` est synchrone.
- `E` (nextTick) passe **avant** `2` et `H` (microtasks Promise) : la nextTick queue est prioritaire.
- `I` sort **après** `F` : `I` n'entre en file qu'à la résolution de `H`, alors que `F` y était déjà.
- `C` (nextTick) sort **avant** `D` (Promise), tous deux planifiés dans le callback de `setTimeout` : même priorité nextTick > microtask, ré-appliquée entre macrotasks.

## Variante J+30 (fading)

Reprends le puzzle **sans relire le corrigé**, en 15 minutes montre en main, avec deux contraintes ajoutées :

1. Ajoute, juste après le `setTimeout`, un `setImmediate(() => console.log('K'));`.
2. Prédis l'ordre, **et** réponds à la question : où tombe `K` par rapport à `B` — et cet ordre est-il déterministe ?

Attendu : `K` (phase check) et `B` (phase timers) sont dans des phases différentes ; au **top-level**, l'ordre `B` vs `K` n'est **pas garanti** (dépend du démarrage). Pour le rendre déterministe, il faudrait placer les deux `setTimeout`/`setImmediate` dans un callback I/O (`fs.readFile`), où `setImmediate` passe toujours avant `setTimeout`. Vérifie en lançant plusieurs fois `node puzzle.js` : l'ordre relatif de `K` et `B` peut changer.

## Application TribuZen

Porte la leçon dans le vrai backend. Dans `tribuzen/src/api/postMessage.ts`, un audit log était envoyé en `Promise.resolve().then(...)` puis la réponse partait via `res.json()` synchrone — donc **avant** le log (bug d'ordre du module).

1. Reproduis le bug : ajoute un `console.log` dans le `.then` d'audit et un juste après `res.json`, observe que la réponse « part » avant le log.
2. Corrige : `await auditLog.record(...)` avant `res.json(...)` pour les événements dont l'audit doit précéder la réponse.
3. Pour la purge de cache, remplace une éventuelle boucle de microtasks par un `setImmediate` par lot, afin de **céder l'event loop** et ne pas affamer les I/O des autres requêtes.
4. Commit sur `smaurier/tribuzen` : `fix(api): await audit log before response, batch cache invalidation via setImmediate`.
