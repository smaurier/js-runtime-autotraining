# Lab 01 — Observer la Call Stack

> **Outcome :** à la fin, tu sais capturer et lire une stack trace, provoquer et diagnostiquer un `RangeError`, et inspecter les frames au débogueur.
> **Vrai outil :** Node.js 20+ (`node`, `node inspect`) et Chrome DevTools — pas de harnais de test simulé, pas de gap-fill.
> **Feedback :** le coach valide en session (observation directe, pas de test-runner auto-correcteur).

## Énoncé

Tu vas observer la call stack **en vrai**, à la main, dans un fichier `observe.js` que tu écris toi-même. Aucun starter fourni : la page blanche fait partie du lab. Tu produis le code, tu lances `node`, tu lis la sortie, tu expliques.

Trois observations à mener :

1. **Capturer et lire une stack trace** avec `new Error().stack` et `console.trace()`.
2. **Provoquer un stack overflow** et lire le `RangeError`, puis mesurer la profondeur maximale sur ta machine.
3. **Inspecter les frames au débogueur** (`node inspect` ou DevTools) sur une récursion contrôlée.

## Étapes (en friction)

1. Crée `observe.js`. Écris trois fonctions imbriquées `a()` → `b()` → `c()`. Dans `c()`, capture `new Error().stack` et affiche-le. **Avant de lancer**, écris en commentaire l'ordre dans lequel tu crois voir les fonctions dans la trace.
2. Lance `node observe.js`. Compare la trace réelle à ta prédiction. Repère : quelle ligne est le sommet, laquelle est le point d'entrée ?
3. Ajoute un appel à `console.trace('ici')` dans `b()`. Relance. Note où s'affiche la trace (`stderr`) et sa différence avec `Error().stack`.
4. Écris une fonction récursive `deeper()` sans cas de base, protégée par un `try/catch`. Compte les appels avant le crash et affiche la profondeur atteinte + le message d'erreur.
5. Corrige la récursion en ajoutant un cas de base (`countdown(n)`), lance-la sous `node inspect observe.js`, pose un breakpoint dans la fonction et observe la pile grossir puis se vider. (Variante DevTools : `node --inspect-brk observe.js` puis ouvre `chrome://inspect`.)

> Astuce : `new Error().stack` est une chaîne multilignes → `stack.split('\n').length` donne le nombre de frames. Les arrow functions anonymes apparaissent comme `<anonymous>`.

## Corrigé complet commenté

```js
// observe.js — à lancer avec : node observe.js
'use strict';

// ─── Partie 1 : capturer et lire une stack trace ──────────────────
function c() {
  // new Error() fige la pile au moment de sa création : chaque ligne
  // "at ..." de .stack = un frame vivant à cet instant.
  const stack = new Error('trace depuis c()').stack;
  console.log('=== Error().stack ===');
  console.log(stack);
  // Sommet = premier "at c" ; base = dernier "at ... (module)".
  console.log('Frames capturés :', stack.split('\n').length);
}
function b() {
  console.trace('=== console.trace depuis b() ==='); // écrit sur stderr
  c();
}
function a() {
  b();
}
a();

// ─── Partie 2 : stack overflow + profondeur maximale ──────────────
let depth = 0;
function deeper() {
  depth++;          // on incrémente AVANT l'appel récursif
  deeper();         // aucun cas de base → la pile sature
}
try {
  deeper();
} catch (err) {
  // On n'atterrit ici QUE parce que le moteur lève une vraie erreur.
  console.log(`\nProfondeur max atteinte : ${depth}`);
  console.log(`Erreur : ${err.constructor.name} — ${err.message}`);
  // Typiquement : RangeError — Maximum call stack size exceeded
  // Valeur de depth : ~10 000 à ~15 000 en V8/Node (varie avec la taille du frame).
}

// ─── Partie 3 : récursion CORRECTE à observer au débogueur ────────
// Lance : node inspect observe.js  (ou node --inspect-brk + chrome://inspect)
// Pose un breakpoint sur la ligne "if" et regarde le panneau Call Stack
// grossir jusqu'à countdown(0) puis se vider (dépilement LIFO).
function countdown(n) {
  if (n <= 0) return;   // cas de base : STOPPE l'empilement
  countdown(n - 1);     // appel en profondeur, un frame par niveau
}
countdown(5);

// Lecture attendue :
// - Partie 1 : la trace liste c (sommet) → b → a → module (base).
// - console.trace sort sur stderr, Error().stack est une string exploitable.
// - Partie 2 : le try/catch attrape RangeError car le moteur REFUSE d'empiler plus.
// - Partie 3 : au débogueur, Call Stack montre 5 frames countdown empilés, puis pop.
```

## Variante J+30 (fading)

Reprends l'exercice **sans relire ce corrigé** et avec deux contraintes :

1. En moins de 20 minutes.
2. Sans utiliser `new Error().stack` — capture la profondeur d'appel uniquement via une variable compteur, et **prédis par écrit** la profondeur max avant de lancer, puis compare. Bonus : rends `deeper()` récursive **mutuelle** (`ping()` appelle `pong()` qui appelle `ping()`) et vérifie que le `RangeError` tombe pareil.

## Application TribuZen

Porte l'observation dans le vrai produit. Dans `smaurier/tribuzen`, la fonction `buildFamilyTree` (`src/modules/family/family.service.ts`) est récursive sur l'arbre des familles.

1. Écris un test/scénario local qui alimente `buildFamilyTree` avec des données **cycliques** (une famille qui redevient son propre ancêtre) et observe le `RangeError` remonter — lis la trace de haut (`buildFamilyTree`) en bas (`server.ts`).
2. Ajoute la garde : un `Set` de nœuds déjà visités (ou une profondeur maximale) qui coupe la récursion et lève une erreur métier lisible (`FamilyCycleError`) au lieu d'un `RangeError` opaque.
3. Pose un breakpoint dans `buildFamilyTree` sous le débogueur Node de ton IDE, observe le panneau Call Stack sur un arbre sain, puis commit :

```
fix(family): détecte les cycles dans buildFamilyTree pour éviter le stack overflow
```
