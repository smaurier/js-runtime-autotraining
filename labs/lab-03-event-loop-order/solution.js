// =============================================================================
// Lab 03 — Event Loop Order — SOLUTION
// =============================================================================
// Exécuter avec : node solution.js
// =============================================================================

import { readFile } from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

console.log("=== Lab 03 : Event Loop Order — SOLUTION ===\n");

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

let correct = 0;
let total = 0;

function checkPrediction(snippetName, prediction, actual) {
  total++;
  const match = JSON.stringify(prediction) === JSON.stringify(actual);
  if (match) {
    correct++;
    console.log(`  [OK] ${snippetName}`);
  } else {
    console.log(`  [ERREUR] ${snippetName}`);
    console.log(`    Prédit  : ${JSON.stringify(prediction)}`);
    console.log(`    Réel    : ${JSON.stringify(actual)}`);
  }
}

function runSnippet(name, prediction, fn) {
  return new Promise((resolve) => {
    // setTimeout ensures the snippet runs from a macrotask context,
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
// PARTIE 1 — Prédire l'ordre de 10+ opérations asynchrones mélangées
// =============================================================================

separator("PARTIE 1 — Snippets de prédiction d'ordre");

// --- Snippet 1 ---
// Ordre : A, D, C, B
// POURQUOI :
//   1. "A" — synchrone, exécuté immédiatement
//   2. setTimeout(B) — programmé dans la file des timers (macrotask)
//   3. Promise.then(C) — programmé comme microtask
//   4. "D" — synchrone, exécuté immédiatement
//   Fin du code synchrone. Vidage des microtasks : "C".
//   Prochaine macrotask (timer) : "B".
const prediction1 = ["A", "D", "C", "B"];

async function snippet1() {
  return runSnippet("Snippet 1 : sync + setTimeout + Promise", prediction1, (log) => {
    log("A");
    setTimeout(() => log("B"), 0);
    Promise.resolve().then(() => log("C"));
    log("D");
  });
}

// --- Snippet 2 ---
// Ordre : D, C, A, B
// POURQUOI :
//   1. Promise.then(A) — microtask enregistrée
//   2. queueMicrotask(B) — microtask enregistrée
//   3. process.nextTick(C) — nextTick enregistré (priorité > microtask)
//   4. "D" — synchrone
//   Fin sync. D'abord les nextTick : "C".
//   Puis les microtasks dans l'ordre : "A" (Promise), "B" (queueMicrotask).
//   Note : Promise.then et queueMicrotask sont dans la même file de microtasks,
//   exécutés dans l'ordre d'enregistrement.
const prediction2 = ["D", "C", "A", "B"];

async function snippet2() {
  return runSnippet("Snippet 2 : nextTick vs microtasks", prediction2, (log) => {
    Promise.resolve().then(() => log("A"));
    queueMicrotask(() => log("B"));
    process.nextTick(() => log("C"));
    log("D");
  });
}

// --- Snippet 3 ---
// Ordre : D, B, A, C
// POURQUOI :
//   1. setTimeout(A) — macrotask 1 programmée
//   2. Promise.then — microtask qui fera log("B") + setTimeout(C)
//   3. "D" — synchrone
//   Fin sync. Microtask : "B", programme macrotask setTimeout(C).
//   Macrotask 1 (setTimeout A) : "A"
//   Macrotask 2 (setTimeout C, programmée après A) : "C"
const prediction3 = ["D", "B", "A", "C"];

async function snippet3() {
  return runSnippet("Snippet 3 : setTimeout dans Promise.then", prediction3, (log) => {
    setTimeout(() => log("A"), 0);
    Promise.resolve().then(() => {
      log("B");
      setTimeout(() => log("C"), 0);
    });
    log("D");
  });
}

// --- Snippet 4 ---
// Ordre : F, A, D, B, E, C
// POURQUOI :
//   Chaque .then() programme la microtask SUIVANTE de la chaîne APRÈS que
//   le handler courant s'exécute. Les deux chaînes s'entrelacent :
//   - Tour 1 de microtasks : .then(A) et .then(D) sont prêtes
//   - Tour 2 : A crée .then(B), D crée .then(E) -> B, E sont prêtes
//   - Tour 3 : B crée .then(C) -> C est prête
const prediction4 = ["F", "A", "D", "B", "E", "C"];

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
  });
}

// --- Snippet 5 ---
// Ordre : D, A, E, B, C
// POURQUOI :
//   1. "D" — synchrone
//   2. foo() est appelé. Le code AVANT le premier await est synchrone : "A"
//   3. await Promise.resolve() suspend foo(). Le code après await est une microtask.
//   4. "E" — synchrone (après l'appel de foo(), on continue)
//   Fin sync. Microtask (reprise de foo) : "B". Nouveau await, suspend.
//   Microtask (reprise) : "C".
const prediction5 = ["D", "A", "E", "B", "C"];

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
  });
}

// --- Snippet 6 ---
// Ordre : E, A, C, B, D
// POURQUOI :
//   1. "E" — synchrone
//   Fin sync. Vidage des nextTick :
//   2. nextTick 1 : "A", programme nextTick(B)
//   3. nextTick 2 : "C"
//   Les nextTick ajoutés PENDANT le vidage sont traités dans le MÊME cycle :
//   4. nextTick 3 (ajouté par A) : "B"
//   Puis les microtasks : "D" (queueMicrotask)
const prediction6 = ["E", "A", "C", "B", "D"];

async function snippet6() {
  return runSnippet("Snippet 6 : nextTick en cascade", prediction6, (log) => {
    process.nextTick(() => {
      log("A");
      process.nextTick(() => log("B"));
    });
    process.nextTick(() => log("C"));
    queueMicrotask(() => log("D"));
    log("E");
  });
}

// --- Snippet 7 ---
// Ordre : F, E, A, B, C, D
// POURQUOI :
//   1. "F" — synchrone
//   Fin sync. Microtasks : "E" (Promise.then)
//   Macrotask (timer 1) : "A". Vidage microtasks (aucune).
//   Macrotask (timer 2) : "B", programme Promise.then(C). Vidage microtasks : "C".
//   Macrotask (timer 3) : "D".
const prediction7 = ["F", "E", "A", "B", "C", "D"];

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
  });
}

// --- Snippet 8 ---
// Ordre : E, D, C, B, A
// POURQUOI :
//   1. "E" — synchrone
//   Quand le callback I/O (readFile) s'exécute :
//   2. "D" — synchrone dans le callback
//   3. "C" — nextTick (priorité maximale après le sync)
//   4. "B" — setImmediate. Dans un callback I/O, la phase « check »
//            (setImmediate) vient JUSTE APRÈS la phase I/O, donc
//            setImmediate s'exécute TOUJOURS avant setTimeout.
//   5. "A" — setTimeout (phase « timers » au tour suivant)
const prediction8 = ["E", "D", "C", "B", "A"];

async function snippet8() {
  return runSnippet("Snippet 8 : setImmediate vs setTimeout (I/O)", prediction8, (log) => {
    readFile(__filename, () => {
      setTimeout(() => log("A"), 0);
      setImmediate(() => log("B"));
      process.nextTick(() => log("C"));
      log("D");
    });
    log("E");
  });
}

// --- Snippet 9 ---
// Ordre : H, D, F, E, G, A, B, C
// POURQUOI :
//   1. "H" — synchrone
//   Fin sync. Vidage nextTick :
//   2. "D" (nextTick), programme queueMicrotask(E)
//   Vidage microtasks :
//   3. "F" (queueMicrotask), programme nextTick(G)
//   4. "E" (queueMicrotask, programmée par D)
//   Vidage nextTick (ajouté par F) :
//   5. "G"
//   Macrotask (setTimeout) :
//   6. "A", programme nextTick(B) + Promise.then(C)
//   Vidage nextTick : "B". Vidage microtasks : "C".
const prediction9 = ["H", "D", "F", "E", "G", "A", "B", "C"];

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
  });
}

// --- Snippet 10 : Boss final ---
// Ordre : A, J, E, B, G, I, F, H, C, D
// POURQUOI (pas à pas) :
//   Code synchrone :
//     - alpha() : "A" (sync avant await), puis suspend (await = microtask)
//     - setTimeout(C+D) programmé
//     - nextTick(E+F) programmé
//     - alpha() retourne une promesse (pas encore résolue)
//     - Promise.then(G).then(H) — G programmé comme microtask
//     - queueMicrotask(I) — programmé
//     - "J" — synchrone
//   Fin sync. Vidage nextTick :
//     - "E", programme Promise.then(F)
//   Vidage microtasks (dans l'ordre d'enregistrement) :
//     - "B" (reprise de alpha après await)
//     - "G" (premier .then de la chaîne)
//     - "I" (queueMicrotask)
//     - "F" (Promise.then programmé par E)
//   Microtasks ajoutées pendant ce tour :
//     - "H" (deuxième .then, programmé après G)
//   Macrotask (setTimeout) :
//     - "C", programme queueMicrotask(D)
//     - Vidage microtasks : "D"
const prediction10 = ["A", "J", "E", "B", "G", "I", "F", "H", "C", "D"];

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
  });
}

// =============================================================================
// PARTIE 2 — Prouver quelle phase de l'event loop s'exécute en premier
// =============================================================================
// POURQUOI cet ordre :
// L'event loop de Node.js traite les files dans cet ordre strict :
//   1. nextTick — file spéciale, vidée après CHAQUE opération synchrone
//   2. microtasks (Promise.then, queueMicrotask) — vidées après nextTick
//   3. timers (setTimeout, setInterval) — première phase « officielle »
//   4. I/O poll — attend et exécute les callbacks I/O
//   5. check (setImmediate) — juste après I/O
//   6. close (socket.on('close')) — dernière phase
//
// L'ordre mesuré sera : nextTick > microtask > promise > (setTimeout ou
// setImmediate, non déterministe en dehors d'un callback I/O) > I/O callback
// =============================================================================

separator("PARTIE 2 — Prouver l'ordre des phases");

function provePhaseOrder() {
  return new Promise((resolve) => {
    // Run from a macrotask context to get correct nextTick > microtask ordering
    setTimeout(() => {
      const order = [];

      // Programmer une tâche dans chaque file
      process.nextTick(() => order.push("nextTick"));
      queueMicrotask(() => order.push("queueMicrotask"));
      Promise.resolve().then(() => order.push("Promise.then"));
      setTimeout(() => order.push("setTimeout"), 0);
      setImmediate(() => order.push("setImmediate"));

      // I/O callback (readFile est asynchrone, son callback passera par la phase I/O poll)
      readFile(__filename, () => order.push("I/O callback"));

      // Laisser le temps à toutes les tâches de s'exécuter
      setTimeout(() => {
      console.log("  Ordre mesuré des phases :");
      order.forEach((phase, i) => {
        console.log(`    ${i + 1}. ${phase}`);
      });
      console.log();
      console.log("  Analyse :");
      console.log("    - nextTick est TOUJOURS premier (file prioritaire)");
      console.log("    - queueMicrotask et Promise.then suivent (microtasks)");
      console.log("    - setTimeout et setImmediate sont des macrotasks");
      console.log("    - I/O callback dépend de la vitesse du disque");
        resolve();
      }, 500);
    }, 0);
  });
}

// =============================================================================
// PARTIE 3 — Starvation par process.nextTick récursif
// =============================================================================
// POURQUOI il y a starvation :
// process.nextTick insère le callback dans la file « nextTick ».
// Cette file est vidée ENTIÈREMENT après chaque phase de l'event loop,
// AVANT de passer à la phase suivante. Si un callback nextTick programme
// un autre nextTick, il est ajouté à la file en cours de vidage et sera
// exécuté dans le MÊME cycle. L'event loop ne peut jamais avancer vers
// la phase des timers (où setTimeout attend) tant que la file nextTick
// n'est pas vide.
//
// Avec 10 000 nextTick récursifs, le setTimeout(fn, 0) qui devrait
// s'exécuter en ~1 ms sera retardé de plusieurs millisecondes, voire
// dizaines de millisecondes.
//
// La solution : alterner avec setImmediate toutes les N itérations.
// setImmediate programme le callback dans la phase « check » qui vient
// APRÈS les timers. Cela permet à l'event loop de traiter les timers
// entre deux lots de travail.
// =============================================================================

separator("PARTIE 3 — Starvation par nextTick récursif");

function demonstrateStarvation() {
  return new Promise((resolve) => {
    const start = performance.now();
    let timeoutExecuted = false;

    // Ce setTimeout devrait s'exécuter en ~0-1 ms
    setTimeout(() => {
      const delay = performance.now() - start;
      timeoutExecuted = true;
      console.log(`  [STARVATION] setTimeout exécuté après ${delay.toFixed(1)} ms (devrait être ~1 ms)`);
    }, 0);

    // Boucle récursive de nextTick : bloque l'event loop
    let tickCount = 0;
    const maxTicks = 100_000;

    function recursiveTick() {
      tickCount++;
      if (tickCount < maxTicks) {
        process.nextTick(recursiveTick);
      }
    }

    process.nextTick(recursiveTick);

    // Vérification après un délai suffisant
    setTimeout(() => {
      console.log(`  Nombre de nextTick exécutés : ${tickCount}`);
      console.log(`  Le setTimeout a été retardé car les nextTick monopolisent l'event loop.`);
      console.log();

      // --- Version sûre : yield périodique avec setImmediate ---
      console.log("  --- Version safe avec yield périodique ---\n");

      const start2 = performance.now();
      let safeCount = 0;
      const maxSafe = 100_000;
      const yieldEvery = 1000; // Céder le contrôle toutes les 1000 itérations

      setTimeout(() => {
        const delay2 = performance.now() - start2;
        console.log(`  [SAFE] setTimeout exécuté après ${delay2.toFixed(1)} ms`);
        console.log(`  Le yield périodique permet aux timers de s'exécuter.`);
      }, 0);

      function safeRecursive() {
        safeCount++;
        if (safeCount >= maxSafe) {
          return;
        }
        // Toutes les `yieldEvery` itérations, on utilise setImmediate
        // au lieu de nextTick. Cela permet à l'event loop de progresser
        // vers la phase « timers » et d'exécuter le setTimeout en attente.
        if (safeCount % yieldEvery === 0) {
          setImmediate(safeRecursive);
        } else {
          process.nextTick(safeRecursive);
        }
      }

      process.nextTick(safeRecursive);

      setTimeout(() => {
        console.log(`  Itérations safe complétées : ${safeCount}`);
        resolve();
      }, 1000);
    }, 500);
  });
}

// =============================================================================
// PARTIE 4 — Puzzle avec timeouts et promises imbriqués
// =============================================================================
// Ordre : M, F, K, I, H, L, J, A, B, C, D, E, G
// POURQUOI (analyse pas à pas) :
//
// Code synchrone :
//   - setTimeout(A + Promise.then(B) + nextTick(C)) -> macrotask 1
//   - setTimeout(D + queueMicrotask(E)) -> macrotask 2
//   - nextTick(F + setTimeout(G) + queueMicrotask(H))
//   - Promise.then(I).then(J) — I est une microtask
//   - queueMicrotask(K + nextTick(L))
//   - "M" — synchrone
//
// Fin sync. Vidage nextTick :
//   - "F", programme setTimeout(G) et queueMicrotask(H)
//
// Vidage microtasks :
//   - "K" (queueMicrotask), programme nextTick(L)
//   - "I" (Promise.then), retourne Promise.resolve() -> J programmé
//   - "H" (queueMicrotask programmée par F)
//
// Vidage nextTick (ajouté par K) :
//   - "L"
//
// Vidage microtasks (ajoutées pendant le tour précédent) :
//   - "J" (deuxième .then, programmé après I)
//
// Macrotask 1 (setTimeout A) :
//   - "A", programme Promise.then(B) et nextTick(C)
//   Vidage nextTick : (aucun, nextTick(C) est déjà vidé... non, il est ajouté PENDANT la macrotask)
//   Correction : nextTick(C) est programmé pendant la macrotask A.
//   Vidage nextTick après A : aucun initialement... Attendons.
//
//   En fait, dans le callback du timer A :
//     - "A" exécuté
//     - Promise.then(B) programmé
//     - nextTick(C) programmé
//   Fin du callback. Vidage nextTick : rien n'est dans la file à ce stade car
//   on est DANS le callback du timer. Après la fin du callback :
//   Vidage nextTick : non, les nextTick sont vidés entre les phases.
//
//   Reprenons : après le callback de la macrotask A :
//   Vidage nextTick : aucun (les timers de cette phase sont tous traités d'abord)
//
//   En réalité, Node.js vide les nextTick et microtasks APRÈS CHAQUE callback
//   de chaque phase (pas seulement entre les phases). Donc :
//   - Timer callback A : "A", programme Promise.then(B) + nextTick(C)
//   - Vidage nextTick : aucun... non. En fait dans les versions récentes de Node,
//     les nextTick et microtasks sont vidés après chaque macrotask.
//   - Vidage nextTick après A : aucun... Hmm, si : nextTick(C) a été programmé
//     DANS le callback A.
//
//   Ordre après macrotask 1 :
//     "A" -> vidage nextTick : aucun enregistré dans cette phase encore -> en fait si, C.
//
//   Soyons précis :
//   Le callback du premier setTimeout s'exécute :
//     1. log("A")
//     2. Promise.resolve().then(() => log("B")) -> microtask programmée
//     3. process.nextTick(() => log("C")) -> nextTick programmé
//   Fin du callback. Entre les macrotasks, on vide nextTick puis microtasks :
//     4. "C" (nextTick programmé par A) -- NON, corrigeons.
//
//   Ah wait, A et D sont dans le même setTimeout(0). Node les traite-t-il
//   comme un seul lot de timers ou comme des callbacks séparés ?
//   Réponse : dans la phase timers, Node exécute TOUS les timers expirés,
//   MAIS il vide les nextTick et microtasks ENTRE CHAQUE callback de timer
//   (depuis Node 11+).
//
//   Donc :
//   Phase timers — callback 1 (A) :
//     "A", programme nextTick(C) et Promise.then(B)
//     Vidage nextTick : aucun... si ! C a été programmé.
//     Non attendez. "process.nextTick(() => log("C"))" est dans :
//       Promise.resolve().then(() => { log("B"); process.nextTick(() => log("C")); });
//     Donc C est programmé DANS le .then(B), pas dans le callback timer directement.
//
//   Relisons le code puzzle :
//     setTimeout(() => {
//       log("A");
//       Promise.resolve().then(() => {
//         log("B");
//         process.nextTick(() => log("C"));
//       });
//     }, 0);
//
//   Callback timer 1 : "A", programme microtask qui fait B + nextTick(C).
//   Vidage microtasks : "B", programme nextTick(C).
//   Vidage nextTick : "C".
//
//   Callback timer 2 : "D", programme queueMicrotask(E).
//   Vidage microtasks : "E".
//
//   Puis macrotask setTimeout(G) (programmée par F) :
//   Callback timer 3 : "G".
//
// Résultat final : M, F, I, K, H, J, L, A, B, C, D, E, G
//
// Correction de l'analyse :
//   Fin sync. Vidage nextTick : "F" (programme setTimeout(G) + queueMicrotask(H)).
//   Vidage microtasks (dans l'ordre d'enregistrement) :
//     "I" (Promise.then — enregistré AVANT K). return Promise.resolve() → 2 ticks avant J.
//     "K" (queueMicrotask — enregistré après I). Programme nextTick(L).
//     "H" (queueMicrotask — ajoutée par F).
//     [PromiseResolveThenableJob pour J] → enqueue resolve_intermediate
//     [resolve_intermediate] → enqueue J_handler
//     "J" (2e .then de la chaîne — résolu via le thenable)
//   Vidage nextTick (L ajouté par K, vérifié après que la file microtask est vide) :
//     "L"
//   Macrotask 1 : "A", programme Promise.then(B).
//     Vidage microtasks : "B", programme nextTick(C).
//     Vidage nextTick : "C".
//   Macrotask 2 : "D", programme queueMicrotask(E).
//     Vidage microtasks : "E".
//   Macrotask 3 : "G".
// =============================================================================

separator("PARTIE 4 — Puzzle d'ordonnancement avancé");

const predictionPuzzle = ["M", "F", "I", "K", "H", "J", "L", "A", "B", "C", "D", "E", "G"];

async function advancedPuzzle() {
  return runSnippet("Puzzle avancé", predictionPuzzle, (log) => {
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
  });
}

// =============================================================================
// Exécution séquentielle
// =============================================================================

async function runAll() {
  console.log("--- Partie 1 : Résultats ---\n");

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

  console.log("\n=== Fin du Lab 03 — SOLUTION ===");
}

runAll();
