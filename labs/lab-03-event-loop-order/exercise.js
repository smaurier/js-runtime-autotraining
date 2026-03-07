// =============================================================================
// Lab 03 — Event Loop Order
// =============================================================================
// Exécuter avec : node exercise.js
// =============================================================================

import { readFile } from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

console.log("=== Lab 03 : Event Loop Order ===\n");

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

let correct = 0;
let total = 0;

// ---------------------------------------------------------------------------
// Phase maps — pour chaque snippet, associe chaque sortie à sa phase
// ---------------------------------------------------------------------------
const PHASE_MAPS = {
  "Snippet 1 : sync + setTimeout + Promise": { A: "sync", D: "sync", C: "micro", B: "macro" },
  "Snippet 2 : nextTick vs microtasks": { D: "sync", C: "nextTick", A: "micro", B: "micro" },
  "Snippet 3 : setTimeout dans Promise.then": { D: "sync", B: "micro", A: "macro", C: "macro" },
  "Snippet 4 : Chaînes de Promises": { F: "sync", A: "micro", D: "micro", B: "micro", E: "micro", C: "micro" },
  "Snippet 5 : async/await": { D: "sync", A: "sync", E: "sync", B: "micro", C: "micro" },
  "Snippet 6 : nextTick en cascade": { E: "sync", A: "nextTick", C: "nextTick", B: "nextTick", D: "micro" },
  "Snippet 7 : Timers + microtasks": { F: "sync", E: "micro", A: "macro", B: "macro", C: "micro", D: "macro" },
  "Snippet 8 : setImmediate vs setTimeout (I/O)": { E: "sync", D: "sync", C: "nextTick", B: "macro", A: "macro" },
  "Snippet 9 : Mélange complexe": { H: "sync", D: "nextTick", F: "micro", E: "micro", G: "nextTick", A: "macro", B: "nextTick", C: "micro" },
  "Snippet 10 : Boss final": { A: "sync", J: "sync", E: "nextTick", B: "micro", G: "micro", I: "micro", F: "micro", H: "micro", C: "macro", D: "micro" },
  "Puzzle avancé": { M: "sync", F: "nextTick", K: "micro", I: "micro", H: "micro", L: "nextTick", J: "micro", A: "macro", B: "micro", C: "nextTick", D: "macro", E: "micro", G: "macro" },
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

function checkPrediction(snippetName, prediction, actual, phaseMap) {
  total++;
  const match = JSON.stringify(prediction) === JSON.stringify(actual);
  if (match) {
    correct++;
    console.log(`  [OK] ${snippetName}`);
    return;
  }

  // Prédiction vide — rappel
  if (!prediction || prediction.length === 0) {
    console.log(`  [ERREUR] ${snippetName}`);
    console.log(`    ⚠️  Votre prédiction est vide. Remplissez le tableau AVANT de lancer le script.`);
    console.log(`    Réel    : ${JSON.stringify(actual)}`);
    return;
  }

  console.log(`  [ERREUR] ${snippetName}`);
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

function runSnippet(name, prediction, fn, phaseMap) {
  return new Promise((resolve) => {
    // setTimeout ensures the snippet runs from a macrotask context,
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
// PARTIE 1 — Prédire l'ordre de 10+ opérations asynchrones mélangées
// =============================================================================
// Pour chaque snippet, remplacez le tableau vide par votre prédiction
// AVANT de lancer le script. Ex: ["A", "D", "C", "B"]
// =============================================================================

separator("PARTIE 1 — Snippets de prédiction d'ordre");

// --- Snippet 1 : Les bases — sync + setTimeout + Promise ---
// 💡 Indice : le code synchrone s'exécute en premier, puis les microtasks
//    (Promise.then), puis les macrotasks (setTimeout).
const prediction1 = []; // TODO : votre prédiction

async function snippet1() {
  return runSnippet("Snippet 1 : sync + setTimeout + Promise", prediction1, (log) => {
    log("A");
    setTimeout(() => log("B"), 0);
    Promise.resolve().then(() => log("C"));
    log("D");
  }, PHASE_MAPS["Snippet 1 : sync + setTimeout + Promise"]);
}

// --- Snippet 2 : nextTick vs queueMicrotask vs Promise.then ---
// 💡 Indice : dans Node.js, l'ordre de priorité est :
//    1. Code synchrone (immédiat)
//    2. process.nextTick (file nextTick, vidée avant les microtasks)
//    3. queueMicrotask / Promise.then (file microtask)
//    4. setTimeout/setImmediate (macrotask)
//    Applique cet ordre pour prédire le résultat.
const prediction2 = []; // TODO : votre prédiction

async function snippet2() {
  return runSnippet("Snippet 2 : nextTick vs microtasks", prediction2, (log) => {
    Promise.resolve().then(() => log("A"));
    queueMicrotask(() => log("B"));
    process.nextTick(() => log("C"));
    log("D");
  }, PHASE_MAPS["Snippet 2 : nextTick vs microtasks"]);
}

// --- Snippet 3 : setTimeout imbriqué dans Promise.then ---
// 💡 Indice : un setTimeout programmé à l'INTÉRIEUR d'un .then() ne sera
//    exécuté qu'au prochain passage dans la phase timers de l'event loop.
//    Le code synchrone passe d'abord, puis les microtasks (Promise.then),
//    puis les macrotasks (setTimeout) — y compris ceux ajoutés par les microtasks.
const prediction3 = []; // TODO : votre prédiction

async function snippet3() {
  return runSnippet("Snippet 3 : setTimeout dans Promise.then", prediction3, (log) => {
    setTimeout(() => log("A"), 0);
    Promise.resolve().then(() => {
      log("B");
      setTimeout(() => log("C"), 0);
    });
    log("D");
  }, PHASE_MAPS["Snippet 3 : setTimeout dans Promise.then"]);
}

// --- Snippet 4 : Chaînes de Promises entrelacées ---
// 💡 Indice : quand deux chaînes Promise sont créées, le moteur alterne :
//    il exécute le premier .then() de chaque chaîne (dans l'ordre de création),
//    puis le deuxième .then() de chaque chaîne, etc.
//    C'est parce que chaque .then() ajoute UN callback à la file microtask.
const prediction4 = []; // TODO : votre prédiction

async function snippet4() {
  return runSnippet("Snippet 4 : Chaînes de Promises", prediction4, (log) => {
    Promise.resolve()
      .then(() => log("A"))
      .then(() => log("B"))
      .then(() => log("C"));

    Promise.resolve()
      .then(() => log("D"))
      .then(() => log("E"));

    log("F");
  }, PHASE_MAPS["Snippet 4 : Chaînes de Promises"]);
}

// --- Snippet 5 : async/await décomposé ---
// 💡 Indice : await est du sucre syntaxique pour Promise.then().
//    Tout le code APRÈS un await est exécuté dans une microtask.
//    Le code AVANT le premier await est synchrone.
const prediction5 = []; // TODO : votre prédiction

async function snippet5() {
  return runSnippet("Snippet 5 : async/await", prediction5, (log) => {
    async function foo() {
      log("A");
      await Promise.resolve();
      log("B");
      await Promise.resolve();
      log("C");
    }

    log("D");
    foo();
    log("E");
  }, PHASE_MAPS["Snippet 5 : async/await"]);
}

// --- Snippet 6 : nextTick en cascade ---
// 💡 Indice : process.nextTick vide sa file ENTIÈREMENT avant les microtasks.
//    Si un nextTick programme un AUTRE nextTick, ce dernier s'exécute aussi
//    avant que les queueMicrotask/Promise.then ne passent.
const prediction6 = []; // TODO : votre prédiction

async function snippet6() {
  return runSnippet("Snippet 6 : nextTick en cascade", prediction6, (log) => {
    process.nextTick(() => {
      log("A");
      process.nextTick(() => log("B"));
    });
    process.nextTick(() => log("C"));
    queueMicrotask(() => log("D"));
    log("E");
  }, PHASE_MAPS["Snippet 6 : nextTick en cascade"]);
}

// --- Snippet 7 : Timers + microtasks intercalés ---
// 💡 Indice : entre chaque macrotask (setTimeout), l'event loop vide
//    TOUTES les microtasks en attente. Donc une Promise.then() ajoutée
//    dans un setTimeout s'exécute avant le setTimeout suivant.
const prediction7 = []; // TODO : votre prédiction

async function snippet7() {
  return runSnippet("Snippet 7 : Timers + microtasks", prediction7, (log) => {
    setTimeout(() => log("A"), 0);
    setTimeout(() => {
      log("B");
      Promise.resolve().then(() => log("C"));
    }, 0);
    setTimeout(() => log("D"), 0);
    Promise.resolve().then(() => log("E"));
    log("F");
  }, PHASE_MAPS["Snippet 7 : Timers + microtasks"]);
}

// --- Snippet 8 : setImmediate vs setTimeout dans un callback I/O ---
// 💡 Indice : à l'INTÉRIEUR d'un callback I/O, setImmediate s'exécute toujours
//    AVANT setTimeout(fn, 0). C'est parce que la phase « check » (setImmediate)
//    vient juste après la phase « poll » (I/O) dans la boucle événementielle Node.js.
//    Et n'oubliez pas : nextTick passe avant tout le reste.
const prediction8 = []; // TODO : votre prédiction

async function snippet8() {
  return runSnippet("Snippet 8 : setImmediate vs setTimeout (I/O)", prediction8, (log) => {
    readFile(__filename, () => {
      setTimeout(() => log("A"), 0);
      setImmediate(() => log("B"));
      process.nextTick(() => log("C"));
      log("D");
    });
    log("E");
  }, PHASE_MAPS["Snippet 8 : setImmediate vs setTimeout (I/O)"]);
}

// --- Snippet 9 : Mélange complexe ---
// 💡 Indice : décompose étape par étape. Après le code synchrone, vide d'abord
//    la file nextTick, puis la file microtask, puis passe aux macrotasks.
//    Attention : un nextTick ajouté depuis une microtask s'exécute AVANT les
//    microtasks restantes (la file nextTick est toujours drainée en priorité).
const prediction9 = []; // TODO : votre prédiction

async function snippet9() {
  return runSnippet("Snippet 9 : Mélange complexe", prediction9, (log) => {
    setTimeout(() => {
      log("A");
      process.nextTick(() => log("B"));
      Promise.resolve().then(() => log("C"));
    }, 0);

    process.nextTick(() => {
      log("D");
      queueMicrotask(() => log("E"));
    });

    queueMicrotask(() => {
      log("F");
      process.nextTick(() => log("G"));
    });

    log("H");
  }, PHASE_MAPS["Snippet 9 : Mélange complexe"]);
}

// --- Snippet 10 : Le boss final ---
// 💡 Indice : combine TOUT ce que tu as appris. Rappelle-toi :
//    1. Code synchrone (y compris le code avant le premier await dans une async fn)
//    2. process.nextTick (vidé entièrement, y compris les enfants)
//    3. Microtasks (queueMicrotask, Promise.then, code après await) — en FIFO
//    4. Macrotasks (setTimeout) — un par un, avec vidange des micro entre chaque
const prediction10 = []; // TODO : votre prédiction

async function snippet10() {
  return runSnippet("Snippet 10 : Boss final", prediction10, (log) => {
    async function alpha() {
      log("A");
      await Promise.resolve();
      log("B");
    }

    setTimeout(() => {
      log("C");
      queueMicrotask(() => log("D"));
    }, 0);

    process.nextTick(() => {
      log("E");
      Promise.resolve().then(() => log("F"));
    });

    alpha();

    Promise.resolve()
      .then(() => log("G"))
      .then(() => log("H"));

    queueMicrotask(() => log("I"));

    log("J");
  }, PHASE_MAPS["Snippet 10 : Boss final"]);
}

// =============================================================================
// PARTIE 2 — Prouver quelle phase de l'event loop s'exécute en premier
// =============================================================================
// Implémentez provePhaseOrder() qui programme UNE tâche dans chaque « file »
// de l'event loop et enregistre l'ordre réel d'exécution.
// =============================================================================

separator("PARTIE 2 — Prouver l'ordre des phases");

function provePhaseOrder() {
  return new Promise((resolve) => {
    const order = [];

    // TODO : Programmez UNE tâche dans chacune de ces 6 files :
    //   - process.nextTick    → ajoutez "nextTick" à order
    //   - queueMicrotask      → ajoutez "microtask" à order
    //   - Promise.resolve()   → ajoutez "promise" à order
    //   - setTimeout (0 ms)   → ajoutez "setTimeout" à order
    //   - setImmediate        → ajoutez "setImmediate" à order
    //   - readFile (I/O)      → ajoutez "I/O callback" à order
    //
    // 💡 Indice : pour chaque API, le pattern est le même :
    //    nomDeLApi(() => order.push("nomDeLApi"))
    //    Pour readFile, utilisez : readFile(__filename, () => order.push("I/O callback"))

    // TODO : Après un délai suffisant (500 ms), affichez l'ordre enregistré
    //        dans `order` et résolvez la promesse.
    // 💡 Indice : setTimeout(() => { console.log(order); resolve(); }, 500)

    console.log("  TODO : Implémentez provePhaseOrder()");
    resolve();
  });
}

// =============================================================================
// PARTIE 3 — Starvation par process.nextTick récursif
// =============================================================================
// Démontrez qu'un process.nextTick récursif empêche les setTimeout de s'exécuter.
// Puis implémentez une version « safe » qui cède le contrôle périodiquement.
// =============================================================================

separator("PARTIE 3 — Starvation par nextTick récursif");

function demonstrateStarvation() {
  return new Promise((resolve) => {
    // TODO : Programmez un setTimeout(fn, 0) qui affiche le temps écoulé
    //        entre sa programmation et son exécution réelle.
    // 💡 Indice : capturez performance.now() avant le setTimeout,
    //    puis dans le callback calculez le delta.

    // TODO : Créez une boucle récursive de process.nextTick qui s'exécute
    //        1000 fois, puis s'arrête.
    //   Étapes :
    //   1. Créez une variable `tickCount` initialisée à 0
    //   2. Créez une fonction `recursiveTick` qui :
    //      - incrémente tickCount
    //      - si tickCount < 1000, appelle process.nextTick(recursiveTick)
    //   3. Lancez le premier appel avec process.nextTick(recursiveTick)
    //
    // 💡 Indice : le setTimeout ne s'exécutera PAS tant que les 1000 nextTick
    //    ne seront pas terminés. C'est ça la "starvation" !

    // TODO : Implémentez une version « safe » qui cède le contrôle
    //        toutes les 100 itérations en utilisant setImmediate au lieu de nextTick.
    //   Étapes :
    //   1. Créez une fonction `safeRecursive` avec un compteur
    //   2. Si le compteur est un multiple de 100 → utilisez setImmediate(safeRecursive)
    //   3. Sinon → utilisez process.nextTick(safeRecursive)
    //
    // 💡 Indice : setImmediate cède le contrôle à l'event loop (phase check),
    //    ce qui permet aux setTimeout en attente de s'exécuter.

    console.log("  TODO : Implémentez la démonstration de starvation");

    setTimeout(() => resolve(), 500);
  });
}

// =============================================================================
// PARTIE 4 — Puzzle avec timeouts et promises imbriqués
// =============================================================================
// Puzzle très difficile avec des setTimeout imbriqués dans des .then(),
// des nextTick intercalés, et des queueMicrotask dans des callbacks timer.
// =============================================================================

separator("PARTIE 4 — Puzzle d'ordonnancement avancé");

// 💡 Indice : ce puzzle est le plus difficile. Procède phase par phase :
//    1. Exécute tout le code synchrone (identifie les log() synchrones)
//    2. Vide la file nextTick → ceux-ci peuvent ajouter des microtasks et macrotasks
//    3. Vide la file microtask → attention aux .then() chaînés avec return Promise
//    4. Passe aux macrotasks (setTimeout) UN PAR UN, en vidant micro/nextTick entre chaque
//    Astuce : dessine un tableau avec les colonnes nextTick | microtask | macrotask
const predictionPuzzle = []; // TODO : votre prédiction

async function advancedPuzzle() {
  return runSnippet("Puzzle avancé", predictionPuzzle, (log) => {
    // Ce puzzle combine toutes les notions des snippets précédents.

    setTimeout(() => {
      log("A");
      Promise.resolve().then(() => {
        log("B");
        process.nextTick(() => log("C"));
      });
    }, 0);

    setTimeout(() => {
      log("D");
      queueMicrotask(() => log("E"));
    }, 0);

    process.nextTick(() => {
      log("F");
      setTimeout(() => log("G"), 0);
      queueMicrotask(() => log("H"));
    });

    Promise.resolve()
      .then(() => {
        log("I");
        return Promise.resolve();
      })
      .then(() => log("J"));

    queueMicrotask(() => {
      log("K");
      process.nextTick(() => log("L"));
    });

    log("M");
  }, PHASE_MAPS["Puzzle avancé"]);
}

// =============================================================================
// Exécution séquentielle de toutes les parties
// =============================================================================

async function runAll() {
  console.log("\n--- Partie 1 : Résultats ---\n");

  await snippet1();
  await snippet2();
  await snippet3();
  await snippet4();
  await snippet5();
  await snippet6();
  await snippet7();
  await snippet8();
  await snippet9();
  await snippet10();

  console.log(`\n--- Score Partie 1 : ${correct}/${total} ---\n`);

  console.log("--- Partie 2 : Preuve de l'ordre des phases ---\n");
  await provePhaseOrder();
  console.log();

  console.log("--- Partie 3 : Démonstration de la starvation ---\n");
  await demonstrateStarvation();
  console.log();

  console.log("--- Partie 4 : Puzzle avancé ---\n");
  await advancedPuzzle();

  console.log("\n=== Fin du Lab 03 ===");
}

runAll();
