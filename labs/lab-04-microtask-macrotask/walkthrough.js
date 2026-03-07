// =============================================================================
// Lab 04 — Walkthrough du Puzzle 1 : microtask avant macrotask
// =============================================================================
// Exécuter avec : node walkthrough.js
// =============================================================================
//
// Ce script explique pas à pas l'ordre d'exécution du puzzle suivant :
//
//   log(1);
//   setTimeout(() => log(2), 0);
//   queueMicrotask(() => log(3));
//   Promise.resolve().then(() => log(4));
//   setTimeout(() => log(5), 0);
//   queueMicrotask(() => log(6));
//   log(7);
//
// Résultat attendu : 1, 7, 3, 4, 6, 2, 5

console.log("=== Walkthrough du Puzzle 1 : microtask avant macrotask ===\n");

// ---------------------------------------------------------------------------
// Explication pas à pas (affichage pédagogique)
// ---------------------------------------------------------------------------

console.log(`\u{1f4cb} État initial :
   Call Stack : [main]
   nextTick   : []
   Microtasks : []
   Macrotasks : []
   Sortie     : []
`);

console.log(`--- Étape 1 : log(1) ---
   \u{27a1}\u{fe0f}  Code synchrone, exécuté immédiatement.
   Call Stack : [main]
   Microtasks : []
   Macrotasks : []
   Sortie     : [1]
`);

console.log(`--- Étape 2 : setTimeout(() => log(2), 0) ---
   \u{27a1}\u{fe0f}  setTimeout programme un callback dans la file des macrotasks.
      Même avec un délai de 0 ms, le callback ne s'exécute pas maintenant.
      Il sera traité après le code synchrone ET après les microtasks.
   Call Stack : [main]
   Microtasks : []
   Macrotasks : [callback-2]
   Sortie     : [1]
`);

console.log(`--- Étape 3 : queueMicrotask(() => log(3)) ---
   \u{27a1}\u{fe0f}  queueMicrotask programme le callback dans la file des microtasks.
      Les microtasks sont vidées AVANT les macrotasks.
   Call Stack : [main]
   Microtasks : [callback-3]
   Macrotasks : [callback-2]
   Sortie     : [1]
`);

console.log(`--- Étape 4 : Promise.resolve().then(() => log(4)) ---
   \u{27a1}\u{fe0f}  Promise.resolve() crée une Promise déjà résolue.
      .then() programme le callback comme microtask.
      queueMicrotask et Promise.then utilisent la MÊME file de microtasks.
      L'ordre est FIFO : callback-3 puis callback-4.
   Call Stack : [main]
   Microtasks : [callback-3, callback-4]
   Macrotasks : [callback-2]
   Sortie     : [1]
`);

console.log(`--- Étape 5 : setTimeout(() => log(5), 0) ---
   \u{27a1}\u{fe0f}  Deuxième setTimeout : un nouveau callback est ajouté aux macrotasks.
      Les macrotasks s'accumulent dans l'ordre de programmation.
   Call Stack : [main]
   Microtasks : [callback-3, callback-4]
   Macrotasks : [callback-2, callback-5]
   Sortie     : [1]
`);

console.log(`--- Étape 6 : queueMicrotask(() => log(6)) ---
   \u{27a1}\u{fe0f}  Deuxième queueMicrotask : ajouté à la fin de la file des microtasks.
   Call Stack : [main]
   Microtasks : [callback-3, callback-4, callback-6]
   Macrotasks : [callback-2, callback-5]
   Sortie     : [1]
`);

console.log(`--- Étape 7 : log(7) ---
   \u{27a1}\u{fe0f}  Code synchrone, exécuté immédiatement.
   Call Stack : [main]
   Microtasks : [callback-3, callback-4, callback-6]
   Macrotasks : [callback-2, callback-5]
   Sortie     : [1, 7]
`);

console.log(`--- Fin du code synchrone ---
   \u{27a1}\u{fe0f}  Le code synchrone est terminé. Le call stack se vide.
      L'event loop commence par vider TOUTES les microtasks.
   Call Stack : [] (vide)
   Microtasks : [callback-3, callback-4, callback-6]
   Macrotasks : [callback-2, callback-5]
   Sortie     : [1, 7]
`);

console.log(`--- Étape 8 : Vidage des microtasks (1/3) ---
   \u{27a1}\u{fe0f}  Première microtask : callback-3 s'exécute -> log(3)
   Call Stack : [callback-3]  ->  [] (terminé)
   Microtasks : [callback-4, callback-6]
   Macrotasks : [callback-2, callback-5]
   Sortie     : [1, 7, 3]
`);

console.log(`--- Étape 9 : Vidage des microtasks (2/3) ---
   \u{27a1}\u{fe0f}  Deuxième microtask : callback-4 s'exécute -> log(4)
      (Promise.then et queueMicrotask partagent la même file FIFO)
   Call Stack : [callback-4]  ->  [] (terminé)
   Microtasks : [callback-6]
   Macrotasks : [callback-2, callback-5]
   Sortie     : [1, 7, 3, 4]
`);

console.log(`--- Étape 10 : Vidage des microtasks (3/3) ---
   \u{27a1}\u{fe0f}  Troisième microtask : callback-6 s'exécute -> log(6)
      La file des microtasks est maintenant vide.
   Call Stack : [callback-6]  ->  [] (terminé)
   Microtasks : [] (vide)
   Macrotasks : [callback-2, callback-5]
   Sortie     : [1, 7, 3, 4, 6]
`);

console.log(`--- Étape 11 : Exécution de la macrotask 1 ---
   \u{27a1}\u{fe0f}  Les microtasks sont toutes vidées. On passe aux macrotasks.
      Première macrotask : callback-2 s'exécute -> log(2)
      (Après chaque macrotask, l'event loop vérifie s'il y a de nouvelles
       microtasks à vider. Ici il n'y en a pas.)
   Call Stack : [callback-2]  ->  [] (terminé)
   Microtasks : [] (vide)
   Macrotasks : [callback-5]
   Sortie     : [1, 7, 3, 4, 6, 2]
`);

console.log(`--- Étape 12 : Exécution de la macrotask 2 ---
   \u{27a1}\u{fe0f}  Deuxième macrotask : callback-5 s'exécute -> log(5)
      Toutes les files sont vides. L'exécution est terminée.
   Call Stack : [callback-5]  ->  [] (terminé)
   Microtasks : [] (vide)
   Macrotasks : [] (vide)
   Sortie     : [1, 7, 3, 4, 6, 2, 5]
`);

console.log(`=== Résultat final : [1, 7, 3, 4, 6, 2, 5] ===\n`);

console.log(`\u{1f4a1} Règles clés illustrées :
   1. Le code synchrone s'exécute en premier (1, 7)
   2. queueMicrotask et Promise.then partagent la MÊME file de microtasks
      \u{2192} ils s'exécutent dans l'ordre de programmation (3, 4, 6)
   3. TOUTES les microtasks sont vidées avant la première macrotask
   4. Les macrotasks (setTimeout) s'exécutent en dernier (2, 5)
   5. Ordre global : sync \u{2192} microtasks \u{2192} macrotasks
`);

// ---------------------------------------------------------------------------
// Vérification : exécutons le puzzle pour de vrai
// ---------------------------------------------------------------------------

console.log("=".repeat(60));
console.log("  Vérification : exécution réelle du puzzle");
console.log("=".repeat(60) + "\n");

const output = [];
const log = (msg) => output.push(msg);

// --- Le puzzle original ---
log(1);
setTimeout(() => log(2), 0);
queueMicrotask(() => log(3));
Promise.resolve().then(() => log(4));
setTimeout(() => log(5), 0);
queueMicrotask(() => log(6));
log(7);

// --- Vérification après que tout s'est exécuté ---
setTimeout(() => {
  const expected = [1, 7, 3, 4, 6, 2, 5];

  console.log(`  Sortie réelle   : ${JSON.stringify(output)}`);
  console.log(`  Sortie attendue : ${JSON.stringify(expected)}`);

  const match = JSON.stringify(output) === JSON.stringify(expected);
  if (match) {
    console.log("  [OK] L'ordre correspond à la prédiction !\n");
  } else {
    console.log("  [ERREUR] L'ordre ne correspond pas.\n");
  }

  console.log("=== Fin du walkthrough ===");
}, 200);
