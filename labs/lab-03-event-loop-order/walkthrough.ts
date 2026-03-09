// =============================================================================
// Lab 03 — Walkthrough du Snippet 1 : sync + setTimeout + Promise
// =============================================================================
// Exécuter avec : npx tsx walkthrough.ts
// =============================================================================
//
// Ce script explique pas à pas l'ordre d'exécution du snippet suivant :
//
//   log("A");
//   setTimeout(() => log("B"), 0);
//   Promise.resolve().then(() => log("C"));
//   log("D");
//
// Résultat attendu : A, D, C, B

console.log("=== Walkthrough du Snippet 1 : sync + setTimeout + Promise ===\n");

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

console.log(`--- Étape 1 : log("A") ---
   \u{27a1}\u{fe0f}  "A" est du code synchrone, exécuté immédiatement.
   Call Stack : [main]
   Sortie     : ["A"]
`);

console.log(`--- Étape 2 : setTimeout(() => log("B"), 0) ---
   \u{27a1}\u{fe0f}  setTimeout programme un callback dans la file des macrotasks.
      Le callback ne s'exécutera PAS maintenant, même avec un délai de 0 ms.
      La Web API / libuv enregistre le timer et le callback sera placé
      dans la file des macrotasks quand le délai sera écoulé.
   Call Stack : [main]
   Macrotasks : [callback-B]
   Sortie     : ["A"]
`);

console.log(`--- Étape 3 : Promise.resolve().then(() => log("C")) ---
   \u{27a1}\u{fe0f}  Promise.resolve() crée une Promise déjà résolue.
      .then() programme le callback comme microtask.
      Les microtasks ont une priorité PLUS HAUTE que les macrotasks.
   Call Stack : [main]
   Microtasks : [callback-C]
   Macrotasks : [callback-B]
   Sortie     : ["A"]
`);

console.log(`--- Étape 4 : log("D") ---
   \u{27a1}\u{fe0f}  "D" est du code synchrone, exécuté immédiatement.
   Call Stack : [main]
   Microtasks : [callback-C]
   Macrotasks : [callback-B]
   Sortie     : ["A", "D"]
`);

console.log(`--- Fin du code synchrone ---
   \u{27a1}\u{fe0f}  Le code synchrone est terminé. Le call stack se vide (main se termine).
      L'event loop commence le processus de vidage des files.
      Règle : on vide TOUJOURS les microtasks avant les macrotasks.
   Call Stack : [] (vide)
   Microtasks : [callback-C]
   Macrotasks : [callback-B]
   Sortie     : ["A", "D"]
`);

console.log(`--- Étape 5 : Vidage des microtasks ---
   \u{27a1}\u{fe0f}  Les microtasks sont TOUJOURS vidées avant les macrotasks.
      callback-C s'exécute : log("C")
   Call Stack : [callback-C]  ->  [] (terminé)
   Microtasks : [] (vide)
   Macrotasks : [callback-B]
   Sortie     : ["A", "D", "C"]
`);

console.log(`--- Étape 6 : Exécution de la macrotask ---
   \u{27a1}\u{fe0f}  Plus de microtasks. On passe à la première macrotask.
      callback-B s'exécute : log("B")
   Call Stack : [callback-B]  ->  [] (terminé)
   Microtasks : [] (vide)
   Macrotasks : [] (vide)
   Sortie     : ["A", "D", "C", "B"]
`);

console.log(`=== Résultat final : ["A", "D", "C", "B"] ===\n`);

console.log(`\u{1f4a1} Règle clé : sync \u{2192} microtasks \u{2192} macrotasks
   1. Le code synchrone s'exécute en premier (A, D)
   2. Les microtasks (Promise.then) sont vidées ensuite (C)
   3. Les macrotasks (setTimeout) s'exécutent en dernier (B)
`);

// ---------------------------------------------------------------------------
// Vérification : exécutons le snippet pour de vrai
// ---------------------------------------------------------------------------

console.log("=".repeat(60));
console.log("  Vérification : exécution réelle du snippet");
console.log("=".repeat(60) + "\n");

const output = [];
const log = (msg: any): number => output.push(msg);

// --- Le snippet original ---
log("A");
setTimeout(() => log("B"), 0);
Promise.resolve().then(() => log("C"));
log("D");

// --- Vérification après que tout s'est exécuté ---
setTimeout(() => {
  console.log(`  Sortie réelle   : ${JSON.stringify(output)}`);
  console.log(`  Sortie attendue : ${JSON.stringify(["A", "D", "C", "B"])}`);

  const match = JSON.stringify(output) === JSON.stringify(["A", "D", "C", "B"]);
  if (match) {
    console.log("  [OK] L'ordre correspond à la prédiction !\n");
  } else {
    console.log("  [ERREUR] L'ordre ne correspond pas.\n");
  }

  console.log("=== Fin du walkthrough ===");
}, 200);
