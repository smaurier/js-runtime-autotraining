// =============================================================================
// Lab 04 — Microtasks vs Macrotasks
// =============================================================================
// Exécuter avec : node exercise.js
// =============================================================================

console.log("=== Lab 04 : Microtasks vs Macrotasks ===\n");

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

let correct = 0;
let total = 0;

// ---------------------------------------------------------------------------
// Phase maps — pour chaque puzzle, associe chaque sortie à sa phase
// ---------------------------------------------------------------------------
const PHASE_MAPS = {
  "Puzzle 1 : Bases": { 1: "sync", 7: "sync", 3: "micro", 4: "micro", 6: "micro", 2: "macro", 5: "macro" },
  "Puzzle 2 : Microtasks imbriquées": { 6: "sync", 2: "micro", 4: "micro", 3: "micro", 5: "micro", 1: "macro" },
  "Puzzle 3 : nextTick + microtasks + macrotasks": { 8: "sync", 3: "nextTick", 7: "nextTick", 4: "nextTick", 5: "micro", 1: "macro", 2: "micro", 6: "macro" },
  "Puzzle 4 : async/await entrelacé": { 1: "sync", 3: "sync", 7: "sync", 2: "micro", 4: "micro", 6: "micro", 5: "micro" },
  "Puzzle 5 : Le cauchemar": { 12: "sync", 8: "nextTick", 5: "micro", 9: "micro", 10: "micro", 6: "nextTick", 7: "micro", 11: "micro", 1: "macro", 2: "nextTick", 3: "micro", 4: "micro" },
};

// ---------------------------------------------------------------------------
// Conseils diagnostiques selon le type de confusion
// ---------------------------------------------------------------------------
const DIAGNOSTIC_TIPS = {
  "micro/macro": "Les microtasks (Promise.then, queueMicrotask) s'exécutent TOUJOURS avant les macrotasks (setTimeout).",
  "macro/micro": "Les microtasks (Promise.then, queueMicrotask) s'exécutent TOUJOURS avant les macrotasks (setTimeout).",
  "nextTick/micro": "process.nextTick a une priorité SUPÉRIEURE aux microtasks. Il est vidé en premier.",
  "micro/nextTick": "process.nextTick a une priorité SUPÉRIEURE aux microtasks. Il est vidé en premier.",
  "sync/micro": "Le code synchrone s'exécute TOUJOURS en premier, avant toute tâche asynchrone.",
  "sync/macro": "Le code synchrone s'exécute TOUJOURS en premier, avant toute tâche asynchrone.",
  "sync/nextTick": "Le code synchrone s'exécute TOUJOURS en premier, avant toute tâche asynchrone.",
  "micro/sync": "Le code synchrone s'exécute TOUJOURS en premier, avant toute tâche asynchrone.",
  "macro/sync": "Le code synchrone s'exécute TOUJOURS en premier, avant toute tâche asynchrone.",
  "nextTick/sync": "Le code synchrone s'exécute TOUJOURS en premier, avant toute tâche asynchrone.",
  "macro/nextTick": "process.nextTick a une priorité SUPÉRIEURE aux macrotasks (setTimeout). Il est vidé avant les microtasks ET les macrotasks.",
  "nextTick/macro": "process.nextTick a une priorité SUPÉRIEURE aux macrotasks (setTimeout). Il est vidé avant les microtasks ET les macrotasks.",
};

function checkPrediction(name, prediction, actual, phaseMap) {
  total++;
  const match = JSON.stringify(prediction) === JSON.stringify(actual);
  if (match) {
    correct++;
    console.log(`  [OK] ${name}`);
    return;
  }

  // Prédiction vide — rappel
  if (!prediction || prediction.length === 0) {
    console.log(`  [ERREUR] ${name}`);
    console.log(`    ⚠️  Votre prédiction est vide. Remplissez le tableau AVANT de lancer le script.`);
    console.log(`    Réel    : ${JSON.stringify(actual)}`);
    return;
  }

  console.log(`  [ERREUR] ${name}`);
  console.log(`    Prédit  : ${JSON.stringify(prediction)}`);
  console.log(`    Réel    : ${JSON.stringify(actual)}`);

  // Trouver le premier index de divergence
  const maxLen = Math.max(prediction.length, actual.length);
  for (let i = 0; i < maxLen; i++) {
    const predicted = prediction[i];
    const expected = actual[i];
    if (predicted !== expected) {
      const predictedPhase = phaseMap && predicted != null ? phaseMap[predicted] || "?" : "?";
      const expectedPhase = phaseMap && expected != null ? phaseMap[expected] || "?" : "?";

      if (predicted == null) {
        console.log(`    ❌ Premier écart à l'index ${i} :`);
        console.log(`       Votre prédiction est trop courte. La réponse attendue est "${expected}" (${expectedPhase}).`);
      } else if (expected == null) {
        console.log(`    ❌ Premier écart à l'index ${i} :`);
        console.log(`       Votre prédiction est trop longue. Vous avez ajouté "${predicted}" (${predictedPhase}) en trop.`);
      } else {
        console.log(`    ❌ Premier écart à l'index ${i} :`);
        console.log(`       Vous avez prédit "${predicted}" (${predictedPhase}) mais la réponse est "${expected}" (${expectedPhase}).`);
      }

      // Afficher un conseil diagnostique basé sur la confusion
      if (predictedPhase !== "?" && expectedPhase !== "?" && predictedPhase !== expectedPhase) {
        const tipKey = `${predictedPhase}/${expectedPhase}`;
        const tip = DIAGNOSTIC_TIPS[tipKey];
        if (tip) {
          console.log(`       💡 Rappel : ${tip}`);
        }
      }
      break;
    }
  }
}

function runPuzzle(name, prediction, fn, phaseMap) {
  return new Promise((resolve) => {
    // setTimeout ensures the puzzle runs from a macrotask context,
    // preserving the correct nextTick > microtask priority order.
    setTimeout(() => {
      const output = [];
      const log = (msg) => output.push(msg);
      fn(log);
      setTimeout(() => {
        checkPrediction(name, prediction, output, phaseMap || PHASE_MAPS[name]);
        resolve();
      }, 300);
    }, 0);
  });
}

function separator(title) {
  console.log("=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

// =============================================================================
// PARTIE 1 — 5 puzzles d'ordonnancement de difficulté croissante
// =============================================================================
// Pour chaque puzzle, écrivez votre prédiction AVANT de lancer le script.
// Chaque puzzle a 5+ console.log avec des numéros à ordonner.
// =============================================================================

separator("PARTIE 1 — Puzzles d'ordonnancement");

// --- Puzzle 1 : Bases — microtask avant macrotask ---
// 7 instructions à ordonner
// 💡 Indice : L'ordre d'exécution est : synchrone d'abord, puis queueMicrotask
//    et Promise.then (dans l'ordre de programmation), puis setTimeout.
const puzzlePrediction1 = []; // TODO : votre prédiction

async function puzzle1() {
  return runPuzzle("Puzzle 1 : Bases", puzzlePrediction1, (log) => {
    log(1);
    setTimeout(() => log(2), 0);
    queueMicrotask(() => log(3));
    Promise.resolve().then(() => log(4));
    setTimeout(() => log(5), 0);
    queueMicrotask(() => log(6));
    log(7);
  }, PHASE_MAPS["Puzzle 1 : Bases"]);
}

// --- Puzzle 2 : Microtasks imbriquées ---
// 6 instructions à ordonner
// 💡 Indice : une microtask ajoutée DEPUIS une microtask s'exécute dans le
//    même cycle de vidange. La file microtask est vidée entièrement (y compris
//    les nouvelles entrées) avant de passer aux macrotasks (setTimeout).
const puzzlePrediction2 = []; // TODO : votre prédiction

async function puzzle2() {
  return runPuzzle("Puzzle 2 : Microtasks imbriquées", puzzlePrediction2, (log) => {
    setTimeout(() => log(1), 0);
    queueMicrotask(() => {
      log(2);
      queueMicrotask(() => log(3));
    });
    Promise.resolve().then(() => {
      log(4);
      Promise.resolve().then(() => log(5));
    });
    log(6);
  }, PHASE_MAPS["Puzzle 2 : Microtasks imbriquées"]);
}

// --- Puzzle 3 : nextTick + microtasks + macrotasks ---
// 8 instructions à ordonner
// 💡 Indice : process.nextTick vide sa file ENTIÈREMENT avant les microtasks.
//    Si un nextTick programme un AUTRE nextTick, ce dernier s'exécute aussi
//    avant que les queueMicrotask ne passent. C'est la clé de ce puzzle.
const puzzlePrediction3 = []; // TODO : votre prédiction

async function puzzle3() {
  return runPuzzle("Puzzle 3 : nextTick + microtasks + macrotasks", puzzlePrediction3, (log) => {
    setTimeout(() => {
      log(1);
      queueMicrotask(() => log(2));
    }, 0);

    process.nextTick(() => {
      log(3);
      process.nextTick(() => log(4));
    });

    queueMicrotask(() => {
      log(5);
      setTimeout(() => log(6), 0);
    });

    process.nextTick(() => log(7));
    log(8);
  }, PHASE_MAPS["Puzzle 3 : nextTick + microtasks + macrotasks"]);
}

// --- Puzzle 4 : async/await + microtasks entrelacées ---
// 7 instructions à ordonner
// 💡 Indice : dans une fonction async, le code AVANT le premier await est
//    synchrone. Le code APRÈS un await reprend comme une microtask (.then()).
//    Si deux fonctions async sont appelées, leurs reprises s'entrelacent
//    dans la file microtask, dans l'ordre où les await ont été rencontrés.
const puzzlePrediction4 = []; // TODO : votre prédiction

async function puzzle4() {
  return runPuzzle("Puzzle 4 : async/await entrelacé", puzzlePrediction4, (log) => {
    async function alpha() {
      log(1);
      await Promise.resolve();
      log(2);
    }

    async function beta() {
      log(3);
      await Promise.resolve();
      log(4);
      await Promise.resolve();
      log(5);
    }

    alpha();
    beta();
    queueMicrotask(() => log(6));
    log(7);
  }, PHASE_MAPS["Puzzle 4 : async/await entrelacé"]);
}

// --- Puzzle 5 : Le cauchemar — tout mélangé ---
// 12 instructions à ordonner
// 💡 Indice : décompose ce puzzle en étapes. Après chaque opération synchrone,
//    demande-toi : "qu'est-ce qui est dans la file nextTick ? microtask ? macrotask ?"
//    Dessine un tableau à 3 colonnes sur papier si besoin.
const puzzlePrediction5 = []; // TODO : votre prédiction

async function puzzle5() {
  return runPuzzle("Puzzle 5 : Le cauchemar", puzzlePrediction5, (log) => {
    setTimeout(() => {
      log(1);
      process.nextTick(() => log(2));
      queueMicrotask(() => {
        log(3);
        Promise.resolve().then(() => log(4));
      });
    }, 0);

    queueMicrotask(() => {
      log(5);
      process.nextTick(() => {
        log(6);
        queueMicrotask(() => log(7));
      });
    });

    process.nextTick(() => {
      log(8);
      queueMicrotask(() => log(9));
    });

    Promise.resolve()
      .then(() => log(10))
      .then(() => log(11));

    log(12);
  }, PHASE_MAPS["Puzzle 5 : Le cauchemar"]);
}

// =============================================================================
// PARTIE 2 — Alternance microtask / macrotask
// =============================================================================
// Implémentez alternateQueues(count) qui programme count tâches en alternant
// entre queueMicrotask (impair) et setTimeout (pair).
// Observez l'ordre d'exécution pour prouver la différence.
// =============================================================================

separator("PARTIE 2 — Alternance microtask / macrotask");

function alternateQueues(count) {
  return new Promise((resolve) => {
    const executionOrder = [];

    // TODO : Pour chaque i de 1 à count :
    //   - Si i est impair : queueMicrotask(() => executionOrder.push(`micro-${i}`))
    //   - Si i est pair   : setTimeout(() => executionOrder.push(`macro-${i}`), 0)
    //
    // Observation attendue : TOUTES les microtasks s'exécutent en premier
    // (micro-1, micro-3, micro-5...), puis TOUTES les macrotasks
    // (macro-2, macro-4, macro-6...), peu importe l'ordre de programmation.

    // TODO : Implémentez la boucle ici

    setTimeout(() => {
      console.log("  Ordre d'exécution :", executionOrder);
      // TODO : Vérifiez que les micro-* sont tous avant les macro-*
      console.log("  TODO : Implémentez alternateQueues()");
      resolve(executionOrder);
    }, 500);
  });
}

// =============================================================================
// PARTIE 3 — Bombe de microtasks
// =============================================================================
// Créez une boucle récursive de queueMicrotask. Mesurez combien de
// microtasks s'exécutent en ~100 ms. Pendant ce temps, un setTimeout(fn, 0)
// est bloqué — mesurez le retard réel.
// =============================================================================

separator("PARTIE 3 — Bombe de microtasks");

function microtaskBomb() {
  return new Promise((resolve) => {
    // TODO : Initialisez le chronomètre avec performance.now() et un compteur
    //        microtaskCount à 0. Fixez une durée max de 100 ms.

    // TODO : Programmez un setTimeout(fn, 0) qui mesure le retard réel entre
    //        sa programmation et son exécution.
    //        Ce timer est programmé AVANT la bombe, il devrait s'exécuter en ~1 ms.
    //        Mais la bombe de microtasks le bloquera pendant ~100 ms !
    // 💡 Indice : const delay = performance.now() - start;

    // TODO : Créez une fonction récursive `bombTick()` qui :
    //   1. Incrémente microtaskCount
    //   2. Si le temps écoulé < maxDuration (100 ms) :
    //        relance une microtask avec queueMicrotask(bombTick)
    //   3. Sinon :
    //        affiche le nombre total de microtasks exécutées
    //   Lancez la bombe avec queueMicrotask(bombTick)
    //
    // 💡 Indice : tant que la file de microtasks n'est pas vide,
    //    l'event loop ne passe PAS aux macrotasks (setTimeout).
    //    C'est pour ça que le setTimeout est bloqué.

    console.log("  TODO : Implémentez la bombe de microtasks");

    setTimeout(() => resolve(), 500);
  });
}

// =============================================================================
// PARTIE 4 — Système de priorités
// =============================================================================
// Implémentez PriorityScheduler avec 3 niveaux :
//   - "high"   -> process.nextTick (exécuté en premier)
//   - "normal" -> queueMicrotask (exécuté après nextTick)
//   - "low"    -> setTimeout(fn, 0) (exécuté en dernier)
//
// schedule(priority, name, fn) programme fn avec la bonne API.
// run() retourne une Promise qui résout avec l'ordre d'exécution.
// =============================================================================

separator("PARTIE 4 — Système de priorités");

class PriorityScheduler {
  constructor() {
    this.executionOrder = [];
    this.taskCount = 0;
  }

  schedule(priority, name, fn) {
    // TODO : Implémentez la méthode schedule en 2 étapes :
    //
    // Étape 1 : Créez une fonction `wrapper` qui :
    //   - Pousse `name` dans this.executionOrder (pour tracer l'ordre)
    //   - Appelle fn()
    //
    // Étape 2 : En fonction de la priorité, programmez le wrapper
    //   avec l'API appropriée :
    //   - "high"   → quelle API s'exécute en PREMIER dans l'event loop ?
    //   - "normal" → quelle API s'exécute juste après ?
    //   - "low"    → quelle API s'exécute en DERNIER ?
    //
    // 💡 Indice : relisez les puzzles de la Partie 1 — l'ordre de priorité
    //    dans l'event loop est : process.nextTick > queueMicrotask > setTimeout

    console.log(`  TODO : Programmer "${name}" avec priorité "${priority}"`);
  }

  run() {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this.executionOrder);
      }, 200);
    });
  }
}

async function testPriorityScheduler() {
  const scheduler = new PriorityScheduler();

  // Schedule from a macrotask context to preserve nextTick > microtask priority
  const order = await new Promise((resolve) => {
    setTimeout(() => {
      // Programmation dans un ordre volontairement mélangé
      scheduler.schedule("low", "tache-low-1", () => {});
      scheduler.schedule("high", "tache-high-1", () => {});
      scheduler.schedule("normal", "tache-normal-1", () => {});
      scheduler.schedule("low", "tache-low-2", () => {});
      scheduler.schedule("high", "tache-high-2", () => {});
      scheduler.schedule("normal", "tache-normal-2", () => {});
      scheduler.schedule("normal", "tache-normal-3", () => {});
      scheduler.schedule("high", "tache-high-3", () => {});
      scheduler.schedule("low", "tache-low-3", () => {});

      setTimeout(() => resolve(scheduler.executionOrder), 200);
    }, 0);
  });
  console.log("  Ordre d'exécution :", order);

  // TODO : Vérifiez que TOUTES les high s'exécutent avant les normal,
  //   et que TOUTES les normal s'exécutent avant les low.
  const expected = [
    "tache-high-1", "tache-high-2", "tache-high-3",
    "tache-normal-1", "tache-normal-2", "tache-normal-3",
    "tache-low-1", "tache-low-2", "tache-low-3",
  ];

  const isCorrect = JSON.stringify(order) === JSON.stringify(expected);
  console.log(`  Test : ${isCorrect ? "[OK]" : "[ERREUR]"}`);
  if (!isCorrect) {
    console.log(`    Attendu : ${JSON.stringify(expected)}`);
  }
}

// =============================================================================
// Exécution séquentielle
// =============================================================================

async function runAll() {
  console.log("\n--- Partie 1 : Puzzles ---\n");

  await puzzle1();
  await puzzle2();
  await puzzle3();
  await puzzle4();
  await puzzle5();

  console.log(`\n--- Score Partie 1 : ${correct}/${total} ---\n`);

  console.log("--- Partie 2 : Alternance ---\n");
  await alternateQueues(10);
  console.log();

  console.log("--- Partie 3 : Bombe de microtasks ---\n");
  await microtaskBomb();
  console.log();

  console.log("--- Partie 4 : Système de priorités ---\n");
  await testPriorityScheduler();

  console.log("\n=== Fin du Lab 04 ===");
}

runAll();
