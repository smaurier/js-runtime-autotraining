// =============================================================================
// Lab 14 — Mini Event Loop (simulation pedagogique)
// =============================================================================
// Lancer avec : node exercise.js
//
// Implementez la classe MiniEventLoop qui simule le comportement de la
// boucle d'evenements JavaScript. Les 5 programmes-puzzle en bas du fichier
// doivent produire la sortie attendue.
// =============================================================================

// ===========================================================================
// Classe MiniEventLoop — A IMPLEMENTER
// ===========================================================================

class MiniEventLoop {
  constructor() {
    // TODO : Initialisez les structures de donnees
    //
    // Proprietes suggerees :
    //   this.callStack       — tableau simulant la pile d'appels
    //   this.macroTaskQueue  — file FIFO pour les macrotaches (setTimeout)
    //   this.microTaskQueue  — file FIFO pour les microtaches (Promise.then, queueMicrotask)
    //   this.nextTickQueue   — file FIFO pour process.nextTick (prioritaire sur les autres micro)
    //   this.executionLog    — tableau de messages de log [LOG], [STACK], etc.
    //   this.outputLog       — tableau des messages utilisateur (ctx.log)
    //
    // 💡 Indice : ce sont tous des tableaux vides au départ (this.callStack = [], etc.)
  }

  /**
   * Execute un programme (tableau d'operations) et retourne le log d'execution.
   *
   * @param {Array} program - Tableau d'operations a executer
   *   Chaque operation : { type: 'sync', name: string, body: (ctx) => void }
   * @returns {string[]} - Tableau des messages loggues par ctx.log(), dans l'ordre
   */
  run(program) {
    // TODO : Implementez la boucle d'evenements
    //
    // Algorithme :
    //
    // 1. Pour chaque operation du programme :
    //    a. Pousser le nom sur la callStack (simuler l'entree dans la fonction)
    //    b. Executer body(ctx) ou ctx fournit : log, setTimeout, promiseThen, nextTick, queueMicrotask
    //    c. Depiler le nom de la callStack (sortie de la fonction)
    //
    // 2. Apres l'execution synchrone du programme :
    //    a. Drainer TOUTES les microtaches (nextTick d'abord, puis micro)
    //       - Si une microtache ajoute d'autres microtaches, les drainer aussi
    //    b. Executer UNE macrotache
    //    c. Apres cette macrotache, drainer a nouveau TOUTES les microtaches
    //    d. Repeter b-c tant qu'il y a des macrotaches
    //
    // 3. Retourner this.outputLog
    //
    // 💡 Indice : commence par créer le ctx avec this._createContext().
    // Puis boucle sur le programme pour exécuter chaque opération synchrone.
    // Ensuite, draine les microtasks, puis boucle sur les macrotasks
    // (en drainant les microtasks après chaque macrotask).

    return [];
  }

  /**
   * Cree le contexte (ctx) passe a chaque body de programme.
   * Ce contexte fournit les methodes pour interagir avec la boucle.
   *
   * @returns {Object} ctx - Le contexte d'execution
   * @private
   */
  _createContext() {
    // TODO : Retournez un objet avec les methodes suivantes :
    //
    // ctx.log(message)
    //   → Ajoute le message a this.outputLog
    //   → Ajoute "[LOG] message" a this.executionLog
    //
    // ctx.setTimeout(fn, delay, name?)
    //   → Ajoute { fn, delay, name } a this.macroTaskQueue
    //   → Note : le delay est symbolique (pas de vrai timer), on trie par delay
    //   → Ajoute "[MACRO] Planifie: name" a this.executionLog
    //
    // ctx.promiseThen(fn, name?)
    //   → Ajoute { fn, name } a this.microTaskQueue
    //   → Ajoute "[MICRO] Planifie: name" a this.executionLog
    //
    // ctx.nextTick(fn, name?)
    //   → Ajoute { fn, name } a this.nextTickQueue
    //   → Ajoute "[TICK] Planifie: name" a this.executionLog
    //
    // ctx.queueMicrotask(fn, name?)
    //   → Identique a promiseThen (meme file)
    //
    // 💡 Indice : retournez un objet avec des méthodes fléchées qui capturent `this`.
    // Ex: log: (msg) => { this.outputLog.push(msg); this.executionLog.push(`[LOG] ${msg}`); }

    return {};
  }

  /**
   * Draine toutes les microtaches en attente.
   * Ordre : TOUTES les nextTick d'abord, puis TOUTES les Promise/microtask.
   * Si une microtache en ajoute d'autres, elles sont drainées dans le meme cycle.
   *
   * @private
   */
  _drainMicrotasks() {
    // TODO : Implementez le drainage des microtaches
    //
    // Boucle tant que nextTickQueue OU microTaskQueue ne sont pas vides :
    //   1. Drainer TOUTE la nextTickQueue d'abord
    //      - Pour chaque tache : pousser sur callStack, executer fn(ctx), depiler
    //   2. Drainer TOUTE la microTaskQueue ensuite
    //      - Pour chaque tache : pousser sur callStack, executer fn(ctx), depiler
    //   3. Revenir a 1 (car les microtaches executees ont pu en ajouter d'autres)
    //
    // 💡 Indice : while (this.nextTickQueue.length > 0 || this.microTaskQueue.length > 0)
    // À l'intérieur : while(nextTick.length) { shift et exécuter }, puis while(micro.length) { shift et exécuter }
  }

  /**
   * Execute une macrotache.
   * Apres son execution, les microtaches seront drainées par la boucle principale.
   *
   * @param {Object} task - { fn, delay, name }
   * @private
   */
  _executeMacroTask(task) {
    // TODO : Implementez l'execution d'une macrotache
    //
    // 1. Pousser task.name sur la callStack
    // 2. Executer task.fn(ctx)
    // 3. Depiler de la callStack
  }
}

// ===========================================================================
// Suite de tests — 5 programmes-puzzle
// ===========================================================================

let testsPassed = 0;
let testsFailed = 0;

function runTest(testName, program, expected) {
  const loop = new MiniEventLoop();
  const actual = loop.run(program);

  const pass =
    actual.length === expected.length &&
    actual.every((val, i) => val === expected[i]);

  if (pass) {
    console.log(`  PASS : ${testName}`);
    testsPassed++;
  } else {
    console.error(`  FAIL : ${testName}`);
    console.error(`    Attendu  : [${expected.map((s) => `"${s}"`).join(", ")}]`);
    console.error(`    Recu     : [${actual.map((s) => `"${s}"`).join(", ")}]`);
    testsFailed++;

    // Trouver le premier index de divergence
    const maxLen = Math.max(actual.length, expected.length);
    for (let i = 0; i < maxLen; i++) {
      if (actual[i] !== expected[i]) {
        const got = actual[i] != null ? `"${actual[i]}"` : "(manquant)";
        const exp = expected[i] != null ? `"${expected[i]}"` : "(manquant)";
        console.error(`    Premier écart à l'index ${i} : attendu ${exp} mais reçu ${got}`);
        break;
      }
    }

    // Conseil diagnostique général
    console.error(`    💡 Conseil : vérifiez que _drainMicrotasks() vide d'abord TOUTE la nextTickQueue,`);
    console.error(`       puis TOUTE la microTaskQueue, et recommence tant qu'il y en a.`);

    // Pour le test 5 (puzzle complexe), afficher un breakdown phase par phase
    if (testName.includes("Puzzle ultime") || testName.includes("complexe")) {
      console.error(`    📋 Décomposition phase par phase attendue :`);
      console.error(`       Phase sync    : "1", "11"`);
      console.error(`       Phase micro 1 : "6" (nextTick), "8" (promise), "7" (promise créée par tick#6), "10" (nextTick créé par promise#8)`);
      console.error(`       Phase macro 1 : "2"`);
      console.error(`       Phase micro 2 : "3" (nextTick créé par macro#2), "4" (promise créée par macro#2), "5" (nextTick créé par promise#4)`);
      console.error(`       Phase macro 2 : "9"`);
    }
  }
}

console.log("=== Tests de la Mini Event Loop ===\n");

// -------------------------------------------------------------------------
// Test 1 : Basique — sync, microtask, macrotask
// -------------------------------------------------------------------------
// Equivalent JS :
//   console.log('A');
//   setTimeout(() => console.log('B'), 0);
//   Promise.resolve().then(() => console.log('C'));
//   console.log('D');
//
// Ordre attendu : A, D (sync), C (micro), B (macro)
runTest("Test 1 : sync → micro → macro", [
  {
    type: "sync",
    name: "main",
    body: (ctx) => {
      ctx.log("A");
      ctx.setTimeout(() => ctx.log("B"), 0, "timeout-B");
      ctx.promiseThen(() => ctx.log("C"), "promise-C");
      ctx.log("D");
    },
  },
], ["A", "D", "C", "B"]);

// -------------------------------------------------------------------------
// Test 2 : nextTick avant Promise.then
// -------------------------------------------------------------------------
// Equivalent JS :
//   console.log('start');
//   setTimeout(() => console.log('timeout'), 0);
//   Promise.resolve().then(() => console.log('promise'));
//   process.nextTick(() => console.log('nextTick'));
//   console.log('end');
//
// Ordre : start, end (sync), nextTick (tick), promise (micro), timeout (macro)
runTest("Test 2 : nextTick prioritaire sur Promise.then", [
  {
    type: "sync",
    name: "main",
    body: (ctx) => {
      ctx.log("start");
      ctx.setTimeout(() => ctx.log("timeout"), 0, "timeout");
      ctx.promiseThen(() => ctx.log("promise"), "promise");
      ctx.nextTick(() => ctx.log("nextTick"), "tick");
      ctx.log("end");
    },
  },
], ["start", "end", "nextTick", "promise", "timeout"]);

// -------------------------------------------------------------------------
// Test 3 : Microtaches imbriquees
// -------------------------------------------------------------------------
// Equivalent JS :
//   console.log('1');
//   Promise.resolve().then(() => {
//     console.log('2');
//     Promise.resolve().then(() => console.log('3'));
//   });
//   Promise.resolve().then(() => console.log('4'));
//   console.log('5');
//
// Ordre : 1, 5 (sync), 2, 4 (micro batch 1), 3 (micro batch 2 — ajoutee par le premier then)
runTest("Test 3 : Microtaches imbriquees", [
  {
    type: "sync",
    name: "main",
    body: (ctx) => {
      ctx.log("1");
      ctx.promiseThen(() => {
        ctx.log("2");
        ctx.promiseThen(() => ctx.log("3"), "nested-promise");
      }, "promise-2");
      ctx.promiseThen(() => ctx.log("4"), "promise-4");
      ctx.log("5");
    },
  },
], ["1", "5", "2", "4", "3"]);

// -------------------------------------------------------------------------
// Test 4 : Macrotache creant des microtaches
// -------------------------------------------------------------------------
// Equivalent JS :
//   console.log('A');
//   setTimeout(() => {
//     console.log('B');
//     Promise.resolve().then(() => console.log('C'));
//   }, 0);
//   setTimeout(() => console.log('D'), 0);
//   Promise.resolve().then(() => console.log('E'));
//   console.log('F');
//
// Ordre : A, F (sync), E (micro), B (macro1), C (micro apres macro1), D (macro2)
runTest("Test 4 : Macrotache creant des microtaches", [
  {
    type: "sync",
    name: "main",
    body: (ctx) => {
      ctx.log("A");
      ctx.setTimeout(() => {
        ctx.log("B");
        ctx.promiseThen(() => ctx.log("C"), "promise-in-timeout");
      }, 0, "timeout-B");
      ctx.setTimeout(() => ctx.log("D"), 0, "timeout-D");
      ctx.promiseThen(() => ctx.log("E"), "promise-E");
      ctx.log("F");
    },
  },
], ["A", "F", "E", "B", "C", "D"]);

// -------------------------------------------------------------------------
// Test 5 : Scenario complexe — le puzzle ultime
// -------------------------------------------------------------------------
// Equivalent JS :
//   console.log('1');
//   setTimeout(() => {
//     console.log('2');
//     process.nextTick(() => console.log('3'));
//     Promise.resolve().then(() => {
//       console.log('4');
//       process.nextTick(() => console.log('5'));
//     });
//   }, 0);
//   process.nextTick(() => {
//     console.log('6');
//     Promise.resolve().then(() => console.log('7'));
//   });
//   Promise.resolve().then(() => {
//     console.log('8');
//     setTimeout(() => console.log('9'), 0);
//     process.nextTick(() => console.log('10'));
//   });
//   console.log('11');
//
// Phase sync    : 1, 11
// Phase micro 1 : 6 (nextTick), 8 (promise), 7 (promise cree par tick#6), 10 (nextTick cree par promise#8)
// Phase macro 1 : 2
// Phase micro 2 : 3 (nextTick cree par macro#2), 4 (promise cree par macro#2), 5 (nextTick cree par promise#4)
// Phase macro 2 : 9
runTest("Test 5 : Puzzle ultime (complexe)", [
  {
    type: "sync",
    name: "main",
    body: (ctx) => {
      ctx.log("1");
      ctx.setTimeout(() => {
        ctx.log("2");
        ctx.nextTick(() => ctx.log("3"), "tick-3");
        ctx.promiseThen(() => {
          ctx.log("4");
          ctx.nextTick(() => ctx.log("5"), "tick-5");
        }, "promise-4");
      }, 0, "timeout-2");
      ctx.nextTick(() => {
        ctx.log("6");
        ctx.promiseThen(() => ctx.log("7"), "promise-7");
      }, "tick-6");
      ctx.promiseThen(() => {
        ctx.log("8");
        ctx.setTimeout(() => ctx.log("9"), 0, "timeout-9");
        ctx.nextTick(() => ctx.log("10"), "tick-10");
      }, "promise-8");
      ctx.log("11");
    },
  },
], ["1", "11", "6", "8", "7", "10", "2", "3", "4", "5", "9"]);

// -------------------------------------------------------------------------
// Resume
// -------------------------------------------------------------------------
console.log("\n" + "=".repeat(50));
console.log(
  `Resultats : ${testsPassed} passes, ${testsFailed} echoues sur ${testsPassed + testsFailed}`
);

if (testsFailed === 0) {
  console.log("Tous les tests passent !");
} else {
  console.log(`${testsFailed} test(s) a corriger.`);
}
