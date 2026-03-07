// =============================================================================
// Lab 04 — Microtasks vs Macrotasks — SOLUTION
// =============================================================================
// Exécuter avec : node solution.js
// =============================================================================

console.log("=== Lab 04 : Microtasks vs Macrotasks — SOLUTION ===\n");

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

let correct = 0;
let total = 0;

function checkPrediction(name, prediction, actual) {
  total++;
  const match = JSON.stringify(prediction) === JSON.stringify(actual);
  if (match) {
    correct++;
    console.log(`  [OK] ${name}`);
  } else {
    console.log(`  [ERREUR] ${name}`);
    console.log(`    Prédit  : ${JSON.stringify(prediction)}`);
    console.log(`    Réel    : ${JSON.stringify(actual)}`);
  }
}

function runPuzzle(name, prediction, fn) {
  return new Promise((resolve) => {
    // setTimeout ensures the puzzle runs from a macrotask context,
    // preserving the correct nextTick > microtask priority order.
    setTimeout(() => {
      const output = [];
      const log = (msg) => output.push(msg);
      fn(log);
      setTimeout(() => {
        checkPrediction(name, prediction, output);
        resolve();
      }, 300);
    }, 0);
  });
}

function separator(title) {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70) + "\n");
}

// =============================================================================
// PARTIE 1 — 5 puzzles d'ordonnancement — SOLUTIONS COMMENTÉES
// =============================================================================

separator("PARTIE 1 — Puzzles d'ordonnancement");

// --- Puzzle 1 : Bases ---
// Ordre : 1, 7, 3, 4, 6, 2, 5
// POURQUOI :
//   1, 7 — code synchrone
//   3 — queueMicrotask (microtask, dans l'ordre d'enregistrement)
//   4 — Promise.then (microtask, enregistrée après 3)
//   6 — queueMicrotask (microtask, enregistrée après 4)
//   2 — setTimeout (macrotask 1)
//   5 — setTimeout (macrotask 2)
// Règle : sync -> microtasks (dans l'ordre) -> macrotasks (dans l'ordre)
const puzzlePrediction1 = [1, 7, 3, 4, 6, 2, 5];

async function puzzle1() {
  return runPuzzle("Puzzle 1 : Bases", puzzlePrediction1, (log) => {
    log(1);
    setTimeout(() => log(2), 0);
    queueMicrotask(() => log(3));
    Promise.resolve().then(() => log(4));
    setTimeout(() => log(5), 0);
    queueMicrotask(() => log(6));
    log(7);
  });
}

// --- Puzzle 2 : Microtasks imbriquées ---
// Ordre : 6, 2, 4, 3, 5, 1
// POURQUOI :
//   6 — synchrone
//   Fin sync. Vidage microtasks :
//     2 — queueMicrotask. Programme queueMicrotask(3).
//     4 — Promise.then. Programme Promise.then(5).
//     3 — queueMicrotask ajoutée PENDANT le vidage (par 2).
//         Les microtasks ajoutées pendant le vidage sont traitées dans le
//         MÊME cycle de vidage (la file est vidée jusqu'à être vide).
//     5 — Promise.then ajoutée par 4, même logique.
//   Macrotask :
//     1 — setTimeout
const puzzlePrediction2 = [6, 2, 4, 3, 5, 1];

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
  });
}

// --- Puzzle 3 : nextTick + microtasks + macrotasks ---
// Ordre : 8, 3, 7, 4, 5, 1, 2, 6
// POURQUOI :
//   8 — synchrone
//   Fin sync. Vidage nextTick :
//     3 — nextTick 1. Programme nextTick(4).
//     7 — nextTick 2 (enregistré après 3).
//     4 — nextTick ajouté par 3 (vidé dans le même cycle).
//   Vidage microtasks :
//     5 — queueMicrotask. Programme setTimeout(6).
//   Macrotasks :
//     1 — setTimeout (programmé initialement). Programme queueMicrotask(2).
//     Vidage microtasks entre macrotasks : 2
//     6 — setTimeout (programmé par 5)
const puzzlePrediction3 = [8, 3, 7, 4, 5, 1, 2, 6];

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
  });
}

// --- Puzzle 4 : async/await entrelacé ---
// Ordre : 1, 3, 7, 2, 4, 6, 5
// POURQUOI :
//   alpha() s'exécute : 1 — synchrone (avant le 1er await)
//     await suspend alpha. La reprise est programmée comme microtask.
//   beta() s'exécute : 3 — synchrone (avant le 1er await)
//     await suspend beta. La reprise est programmée comme microtask.
//   6 — queueMicrotask
//   7 — synchrone
//   Fin sync. Vidage microtasks :
//     Reprise alpha : 2. Fin de alpha.
//     Reprise beta : 4. 2e await, suspend beta.
//     6 — queueMicrotask
//   Vidage microtasks (ajoutées pendant) :
//     Reprise beta : 5. Fin de beta.
const puzzlePrediction4 = [1, 3, 7, 2, 4, 6, 5];

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
  });
}

// --- Puzzle 5 : Le cauchemar ---
// Ordre : 12, 8, 5, 10, 9, 11, 6, 7, 1, 2, 3, 4
// POURQUOI (analyse complète) :
//   12 — synchrone
//
//   Fin sync. Files :
//     nextTick = [8_handler]
//     microtask = [5_handler, 10_handler]   (5 = queueMicrotask, 10 = Promise.then)
//     macrotask = [1_handler]
//
//   Vidage nextTick :
//     8 — process.nextTick. Programme queueMicrotask(9).
//     microtask = [5_handler, 10_handler, 9_handler]
//
//   Vidage microtasks (dans l'ORDRE d'enregistrement) :
//     5 — queueMicrotask (enregistré en sync). Programme nextTick(6).
//     10 — Promise.then (enregistré en sync, AVANT le 9 ajouté par 8).
//          Retourne undefined → .then(11) est immédiatement enfilé.
//     9 — queueMicrotask (ajoutée par 8, enregistrée APRÈS 10).
//     11 — .then (2e maillon de la chaîne, enfilé après que 10 a résolu).
//
//   Vidage nextTick (6 ajouté par 5, vérifié après vidage complet des microtasks) :
//     6 — nextTick. Programme queueMicrotask(7).
//
//   Vidage microtasks :
//     7 — queueMicrotask (programmée par 6).
//
//   Macrotask (setTimeout) :
//     1. Programme nextTick(2) et queueMicrotask(3 + Promise.then(4)).
//     Vidage nextTick : 2.
//     Vidage microtasks : 3. Programme Promise.then(4).
//     Vidage microtasks : 4.
const puzzlePrediction5 = [12, 8, 5, 10, 9, 11, 6, 7, 1, 2, 3, 4];

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
  });
}

// =============================================================================
// PARTIE 2 — Alternance microtask / macrotask — SOLUTION
// =============================================================================
// POURQUOI toutes les microtasks s'exécutent avant les macrotasks :
//
// Quand on programme alternativement queueMicrotask et setTimeout dans
// une boucle synchrone, TOUTES les instructions de la boucle s'exécutent
// d'abord (c'est du code synchrone). À ce stade, on a :
//   - N/2 microtasks dans la file de microtasks
//   - N/2 macrotasks dans la file des timers
//
// Ensuite, l'event loop vide d'abord TOUTES les microtasks (micro-1, micro-3,
// micro-5...) avant de traiter la première macrotask. C'est la règle
// fondamentale : les microtasks ont priorité absolue sur les macrotasks.
//
// Résultat : [micro-1, micro-3, micro-5, ..., macro-2, macro-4, macro-6, ...]
// =============================================================================

separator("PARTIE 2 — Alternance microtask / macrotask");

function alternateQueues(count) {
  return new Promise((resolve) => {
    const executionOrder = [];

    for (let i = 1; i <= count; i++) {
      if (i % 2 === 1) {
        // Impair -> microtask
        const label = `micro-${i}`;
        queueMicrotask(() => executionOrder.push(label));
      } else {
        // Pair -> macrotask
        const label = `macro-${i}`;
        setTimeout(() => executionOrder.push(label), 0);
      }
    }

    setTimeout(() => {
      console.log("  Ordre d'exécution :", executionOrder);

      // Vérification : les micro-* doivent tous précéder les macro-*
      const firstMacroIndex = executionOrder.findIndex((x) => x.startsWith("macro"));
      const lastMicroIndex = executionOrder.findLastIndex((x) => x.startsWith("micro"));

      if (lastMicroIndex < firstMacroIndex) {
        console.log("  [OK] Toutes les microtasks avant les macrotasks");
      } else {
        console.log("  [ERREUR] Une microtask a été exécutée après une macrotask");
      }

      resolve(executionOrder);
    }, 500);
  });
}

// =============================================================================
// PARTIE 3 — Bombe de microtasks — SOLUTION
// =============================================================================
// POURQUOI la bombe bloque le setTimeout :
//
// queueMicrotask programme une microtask. La file de microtasks est vidée
// ENTIÈREMENT avant que l'event loop ne passe à la phase suivante (timers).
// Si chaque microtask en programme une nouvelle, la file n'est jamais vide.
// L'event loop est piégé dans un cycle infini de vidage de microtasks.
//
// Le setTimeout(fn, 0) est dans la file des timers. Il ne sera JAMAIS
// exécuté tant que des microtasks continuent de s'ajouter.
//
// C'est identique au problème de starvation avec process.nextTick, mais
// avec queueMicrotask. La seule différence est que nextTick a priorité
// sur les microtasks (mais les deux causent de la starvation).
// =============================================================================

separator("PARTIE 3 — Bombe de microtasks");

function microtaskBomb() {
  return new Promise((resolve) => {
    const start = performance.now();
    let microtaskCount = 0;
    const maxDuration = 100; // ms

    // Ce timer DEVRAIT s'exécuter en ~0-1 ms, mais la bombe le bloque
    setTimeout(() => {
      const delay = performance.now() - start;
      console.log(`  setTimeout retardé de ${delay.toFixed(1)} ms (au lieu de ~0 ms)`);
      console.log(`  Preuve : les microtasks bloquent les macrotasks.`);
    }, 0);

    // La bombe : chaque microtask en programme une autre
    function bombTick() {
      microtaskCount++;
      if (performance.now() - start < maxDuration) {
        // Relancer une microtask -> la file n'est jamais vide
        // -> l'event loop ne peut pas avancer vers les timers
        queueMicrotask(bombTick);
      } else {
        // On s'arrête volontairement pour ne pas geler le process
        const elapsed = performance.now() - start;
        console.log(`  Microtasks en ${elapsed.toFixed(1)} ms : ${microtaskCount.toLocaleString()}`);
        console.log(`  Débit : ~${(microtaskCount / elapsed * 1000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} microtasks/seconde`);
      }
    }

    queueMicrotask(bombTick);

    setTimeout(() => resolve(), 500);
  });
}

// =============================================================================
// PARTIE 4 — Système de priorités — SOLUTION
// =============================================================================
// POURQUOI ce mapping fonctionne :
//
// Les trois files de l'event loop ont un ordre de priorité strict :
//   1. process.nextTick — vidé en premier, AVANT les microtasks
//   2. queueMicrotask — vidé après nextTick, AVANT les macrotasks
//   3. setTimeout(fn, 0) — macrotask, vidé en dernier
//
// En mappant chaque niveau de priorité sur la file correspondante,
// on obtient un scheduler dont l'ordre d'exécution est garanti par
// l'event loop lui-même. C'est un pattern réel utilisé dans certains
// frameworks (React utilise des heuristiques similaires pour prioriser
// les mises à jour du DOM).
//
// Limitations :
//   - Seulement 3 niveaux de priorité (on ne peut pas créer de file
//     intermédiaire entre nextTick et microtask)
//   - Les tâches « low » ajoutent un minimum de ~1 ms de latence
//     (délai incompressible de setTimeout)
//   - Si trop de tâches « high » sont programmées, elles peuvent
//     causer de la starvation sur les tâches « normal » et « low »
// =============================================================================

separator("PARTIE 4 — Système de priorités");

class PriorityScheduler {
  constructor() {
    this.executionOrder = [];
    this.taskCount = 0;
  }

  schedule(priority, name, fn) {
    this.taskCount++;

    // Le wrapper enregistre le nom dans l'ordre d'exécution, puis appelle fn
    const wrapper = () => {
      this.executionOrder.push(name);
      fn();
    };

    // Mapping priorité -> API de l'event loop
    switch (priority) {
      case "high":
        // nextTick : priorité maximale, vidé avant les microtasks
        process.nextTick(wrapper);
        break;
      case "normal":
        // microtask : vidée après nextTick, avant les macrotasks
        queueMicrotask(wrapper);
        break;
      case "low":
        // macrotask : vidée en dernier, après toutes les microtasks
        setTimeout(wrapper, 0);
        break;
      default:
        throw new Error(`Priorité inconnue : "${priority}". Utilisez "high", "normal" ou "low".`);
    }
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

  const expected = [
    "tache-high-1", "tache-high-2", "tache-high-3",
    "tache-normal-1", "tache-normal-2", "tache-normal-3",
    "tache-low-1", "tache-low-2", "tache-low-3",
  ];

  const isCorrect = JSON.stringify(order) === JSON.stringify(expected);
  console.log(`  Test : ${isCorrect ? "[OK]" : "[ERREUR]"}`);
  if (!isCorrect) {
    console.log(`    Attendu : ${JSON.stringify(expected)}`);
    console.log(`    Obtenu  : ${JSON.stringify(order)}`);
  }

  console.log();
  console.log("  Résumé des priorités :");
  console.log("    high   (nextTick)      -> file vidée en PREMIER");
  console.log("    normal (queueMicrotask) -> file vidée en DEUXIÈME");
  console.log("    low    (setTimeout)     -> file vidée en DERNIER");
  console.log();
  console.log("  C'est la base de tout système de scheduling dans Node.js.");
  console.log("  React Scheduler utilise un mécanisme similaire pour prioriser");
  console.log("  les mises à jour du DOM (user input > animations > data fetching).");
}

// =============================================================================
// Exécution séquentielle
// =============================================================================

async function runAll() {
  console.log("--- Partie 1 : Puzzles ---\n");

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

  console.log("\n=== Fin du Lab 04 — SOLUTION ===");
}

runAll();
