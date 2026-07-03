# Lab 03 — Event loop : prédire puis observer l'ordre

> **Outcome :** à la fin, tu sais prédire l'ordre d'exécution d'un code mêlant synchrone et `setTimeout`, l'expliquer avec le modèle call stack + task queue + event loop, et vérifier ta prédiction en exécutant réellement le code.
> **Vrai outil :** Node.js (`node fichier.js`) et la console d'un navigateur (DevTools). Aucun harnais simulé, aucun test-runner : tu lances le vrai runtime et tu lis la vraie sortie.
> **Feedback :** le coach valide ton raisonnement en session — la vérité, c'est la sortie réelle du runtime, pas un correcteur automatique.

---

## Énoncé

Tu vas travailler comme un ingénieur qui débogue l'API TribuZen : **prédire d'abord** (sur papier ou à voix haute), **exécuter ensuite**, puis **expliquer tout écart**. La règle du lab est stricte : tu écris ta prédiction AVANT de lancer le code. Prédire d'abord (generation effect) est ce qui ancre le modèle mental — lancer sans prédire n'apprend rien.

Tu disposes de trois extraits. Pour chacun :
1. Écris l'ordre exact des lignes affichées, **avant** d'exécuter.
2. Exécute avec `node`.
3. Compare. Si tu t'es trompé, explique POURQUOI avec le modèle (pile vide → task queue).

### Mise en place

Crée un dossier et trois fichiers :

```
lab-03/
  extrait-1.js
  extrait-2.js
  extrait-3.js
```

Aucune dépendance à installer : Node seul suffit (`node --version` ≥ 18).

### Extrait 1 — le classique

```js
// extrait-1.js
console.log('A');
setTimeout(() => console.log('B'), 0);
console.log('C');
```

### Extrait 2 — le synchrone qui bloque

```js
// extrait-2.js
console.log('début');

setTimeout(() => console.log('timer 0ms'), 0);

const fin = Date.now() + 1500;
while (Date.now() < fin) {
  // occupe le thread ~1,5 s
}

console.log('fin du bloc synchrone');
```

### Extrait 3 — plusieurs timers et un simili-handler TribuZen

```js
// extrait-3.js
// Simule un handler : répondre au client, puis différer un e-mail
function handleJoin() {
  console.log('1. début handler');
  setTimeout(() => console.log('4. e-mail de bienvenue'), 0);
  setTimeout(() => console.log('5. log analytics'), 0);
  console.log('2. réponse au client');
  console.log('3. fin handler');
}
handleJoin();
console.log('6. après handleJoin (toujours synchrone ?)');
```

---

## Étapes (en friction)

1. **Prédis l'extrait 1** — écris l'ordre des trois lettres sur papier. Justifie en une phrase : où part `B` et pourquoi.
2. **Exécute** `node extrait-1.js`. Compare.
3. **Prédis l'extrait 2** — combien de temps s'écoule avant `timer 0ms` ? Dans quel ordre sortent les trois lignes ?
4. **Exécute** `node extrait-2.js`. Observe le délai réel (le `while` bloque). Explique pourquoi le timer « 0 ms » attend ~1,5 s.
5. **Prédis l'extrait 3** — ordonne les 6 lignes. Piège : où tombe la ligne `6.` par rapport aux `setTimeout` ?
6. **Exécute** `node extrait-3.js`. Compare et explique chaque écart.
7. **Bonus navigateur** — colle l'extrait 1 dans la console DevTools (onglet Console). Vérifie que l'ordre est le même : l'event loop du navigateur suit le même principe que celui de Node.

---

## Corrigé complet commenté

```js
// ─── extrait-1.js ────────────────────────────────────────────────
console.log('A');                          // sync -> affiche A tout de suite
setTimeout(() => console.log('B'), 0);     // délégué à l'hôte : cb ira dans la task queue
console.log('C');                          // sync -> affiche C
// La pile n'est vide qu'APRÈS 'C'. L'event loop prend alors cb -> affiche B.
// SORTIE : A, C, B
```

```js
// ─── extrait-2.js ────────────────────────────────────────────────
console.log('début');                      // sync
setTimeout(() => console.log('timer 0ms'), 0); // cb prêt dans la file après ~1 ms
const fin = Date.now() + 1500;
while (Date.now() < fin) {}                 // BLOQUE le thread : la pile n'est pas vide
console.log('fin du bloc synchrone');       // sync, à la fin de la boucle
// L'event loop ne peut prendre le cb que quand la pile est vide,
// donc APRÈS la boucle. Le "0 ms" a en réalité attendu ~1,5 s.
// SORTIE : début, fin du bloc synchrone, timer 0ms
```

```js
// ─── extrait-3.js ────────────────────────────────────────────────
function handleJoin() {
  console.log('1. début handler');          // sync
  setTimeout(() => console.log('4. e-mail de bienvenue'), 0); // -> task queue
  setTimeout(() => console.log('5. log analytics'), 0);       // -> task queue (après le 4)
  console.log('2. réponse au client');       // sync
  console.log('3. fin handler');             // sync
}
handleJoin();
console.log('6. après handleJoin (toujours synchrone ?)'); // sync : la pile n'est pas encore vide

// Tout le synchrone passe d'abord : 1, 2, 3, 6.
// PUIS la pile est vide -> l'event loop vide la task queue dans l'ordre d'ajout : 4, puis 5.
// SORTIE : 1, 2, 3, 6, 4, 5
```

**Pourquoi ces corrigés sont corrects :**
- Un `setTimeout` ne fait que **déléguer** le callback à l'hôte ; il ne l'exécute jamais sur place.
- Aucun callback n'est repris tant que la **call stack n'est pas vide** — donc tout le synchrone (`handleJoin` + le `console.log` d'après) passe avant les timers.
- Les deux timers à `0` sortent **dans leur ordre d'enregistrement** (`4` avant `5`) : la task queue est une file (FIFO).
- Le délai `0` est un **minimum**, pas une garantie : l'extrait 2 le prouve, le timer attend que le `while` libère le thread.

---

## Variante J+30 (fading)

**Reproduis de mémoire, sans rouvrir ce corrigé ni le module, en 15 minutes :**

Écris un unique fichier `defi.js` qui, quand on l'exécute, affiche **exactement** dans cet ordre :

```
handler start
handler end
tache differee A
tache differee B
```

Contraintes ajoutées :
1. `handler start` et `handler end` doivent être dans une fonction `run()` appelée une seule fois.
2. `tache differee A` et `tache differee B` doivent partir de **deux `setTimeout` distincts**, et sortir dans cet ordre-là.
3. Avant d'exécuter, écris ta prédiction ET la raison pour laquelle le synchrone sort en premier.

**Critère de réussite :** la sortie réelle correspond exactement, et tu peux expliquer en une phrase pourquoi les deux `setTimeout` passent après `handler end` (pile vide) et dans le bon ordre (file FIFO).

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce raisonnement sert directement à écrire le handler « rejoindre une famille » côté API Node :

```
tribuzen/src/
  routes/
    families.ts     # handler POST /families/:id/join
```

**Ce que tu portes du lab au vrai produit :**
- Répondre au client **d'abord** (`res.json(...)`), puis différer le travail non-urgent (e-mail, analytics) — en sachant que ces callbacks partent APRÈS la fin synchrone du handler, pas pendant.
- Ne jamais mettre un **calcul lourd synchrone** dans un handler : il bloquerait l'event loop et gèlerait toutes les autres requêtes (revois l'extrait 2 — le `while` est l'analogue du calcul qui gèle l'API).
- Savoir lire l'ordre des logs sans s'affoler : « le timer était à 0 mais il sort en dernier » est le comportement normal.

**Commit cible :**
```
feat(families): handler join — réponse immédiate + e-mail différé
chore(runtime): note event loop dans le handler (ne pas bloquer le thread)
```

> Suite au module 04 : microtâches vs macrotâches — pourquoi une `Promise.then` passe AVANT un `setTimeout(0)` même enregistré avant lui.
