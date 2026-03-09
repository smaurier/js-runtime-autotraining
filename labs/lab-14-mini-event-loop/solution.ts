// =============================================================================
// Lab 14 — Mini Event Loop (simulation pedagogique) — SOLUTION
// =============================================================================
// Lancer avec : npx tsx solution.ts
//
// Implementation complete de MiniEventLoop avec tous les tests qui passent.
// =============================================================================

// ===========================================================================
// Classe MiniEventLoop — IMPLEMENTATION COMPLETE
// ===========================================================================

interface MacroTask {
  fn: (ctx: EventLoopContext) => void;
  delay: number;
  name: string;
  order: number;
}

interface MicroTask {
  fn: (ctx: EventLoopContext) => void;
  name: string;
}

interface EventLoopContext {
  log: (message: string) => void;
  setTimeout: (fn: (ctx: EventLoopContext) => void, delay?: number, name?: string) => void;
  promiseThen: (fn: (ctx: EventLoopContext) => void, name?: string) => void;
  nextTick: (fn: (ctx: EventLoopContext) => void, name?: string) => void;
  queueMicrotask: (fn: (ctx: EventLoopContext) => void, name?: string) => void;
}

interface ProgramOperation {
  type: string;
  name: string;
  body: (ctx: EventLoopContext) => void;
}

class MiniEventLoop {
  callStack: string[];
  macroTaskQueue: MacroTask[];
  microTaskQueue: MicroTask[];
  nextTickQueue: MicroTask[];
  executionLog: string[];
  outputLog: string[];
  _macroOrder: number;

  constructor() {
    // La pile d'appels (call stack) — simule la pile d'execution JS.
    this.callStack = [];

    // File FIFO des macrotaches
    this.macroTaskQueue = [];

    // File FIFO des microtaches (Promise.then, queueMicrotask).
    this.microTaskQueue = [];

    // File FIFO des process.nextTick — prioritaires sur les autres microtaches.
    this.nextTickQueue = [];

    // Log detaille de l'execution (pour le debug et la pedagogie)
    this.executionLog = [];

    // Log des messages utilisateur (ce que ctx.log() produit)
    this.outputLog = [];

    // Compteur d'ordre pour trier les macrotaches ayant le meme delay
    this._macroOrder = 0;
  }

  /**
   * Execute un programme et retourne les messages loggues.
   *
   * Le programme est un tableau d'operations. Chaque operation a :
   *   - type: 'sync' (le seul type supporte)
   *   - name: nom pour le debug
   *   - body: fonction recevant un contexte (ctx)
   *
   * @param {Array} program - Le programme a executer
   * @returns {string[]} - Les messages produits par ctx.log(), dans l'ordre
   */
  run(program: ProgramOperation[]): string[] {
    // Reinitialiser l'etat pour chaque execution
    this.callStack = [];
    this.macroTaskQueue = [];
    this.microTaskQueue = [];
    this.nextTickQueue = [];
    this.executionLog = [];
    this.outputLog = [];
    this._macroOrder = 0;

    // Creer le contexte qui sera passe a chaque body
    const ctx = this._createContext();

    // -----------------------------------------------------------------------
    // Phase 1 : Execution synchrone du programme
    // -----------------------------------------------------------------------
    // Comme dans un vrai moteur JS, tout le code "top-level" s'execute d'abord
    // de maniere synchrone. Les setTimeout et Promise.then sont simplement
    // enregistres dans leurs files respectives.
    for (const operation of program) {
      this.executionLog.push(`[STACK] Entree: ${operation.name}`);
      this.callStack.push(operation.name);

      // Executer le body — cela peut ajouter des macrotaches et microtaches
      operation.body(ctx);

      this.callStack.pop();
      this.executionLog.push(`[STACK] Sortie: ${operation.name}`);
    }

    // -----------------------------------------------------------------------
    // Phase 2 : Drainer les microtaches generees par le code synchrone
    // -----------------------------------------------------------------------
    // Apres le code synchrone, TOUTES les microtaches en attente sont drainées
    // avant de passer a la premiere macrotache.
    this._drainMicrotasks();

    // -----------------------------------------------------------------------
    // Phase 3 : Boucle des macrotaches
    // -----------------------------------------------------------------------
    // A chaque iteration :
    //   1. Prendre la prochaine macrotache (triee par delay puis par ordre d'insertion)
    //   2. L'executer (ce qui peut ajouter des micro ET des macrotaches)
    //   3. Drainer TOUTES les microtaches avant la macrotache suivante
    //
    // C'est le coeur de la boucle d'evenements : une macrotache, puis toutes
    // les microtaches, puis une macrotache, etc.
    while (this.macroTaskQueue.length > 0) {
      // Trier par delay croissant, puis par ordre d'insertion
      // Cela simule le fait que les timers avec un delay plus court
      // s'executent en premier.
      this.macroTaskQueue.sort((a, b) => {
        if (a.delay !== b.delay) return a.delay - b.delay;
        return a.order - b.order;
      });

      // Prendre la premiere macrotache (celle avec le plus petit delay/ordre)
      const task = this.macroTaskQueue.shift();
      this._executeMacroTask(task);

      // Apres CHAQUE macrotache, drainer TOUTES les microtaches
      // C'est crucial : les microtaches creees par la macrotache sont
      // drainées AVANT la macrotache suivante.
      this._drainMicrotasks();
    }

    return this.outputLog;
  }

  /**
   * Cree le contexte d'execution passe a chaque body.
   *
   * Ce contexte fournit les 4 methodes pour interagir avec la boucle :
   *   - log(msg) : afficher un message (synchrone)
   *   - setTimeout(fn, delay, name?) : planifier une macrotache
   *   - promiseThen(fn, name?) : planifier une microtache (Promise.then)
   *   - nextTick(fn, name?) : planifier une microtache prioritaire (process.nextTick)
   *   - queueMicrotask(fn, name?) : alias de promiseThen
   *
   * @returns {Object} Le contexte d'execution
   * @private
   */
  _createContext(): EventLoopContext {
    const self = this;

    return {
      /**
       * Logge un message. Equivalent de console.log() dans le vrai JS.
       * Le message est ajoute a outputLog (le resultat final du programme).
       */
      log(message: string): void {
        self.outputLog.push(message);
        self.executionLog.push(`[LOG] ${message}`);
      },

      /**
       * Planifie une macrotache. Equivalent de setTimeout() dans le vrai JS.
       * La fonction sera executee apres que toutes les microtaches et les
       * macrotaches precedentes auront ete traitees.
       *
       * @param {Function} fn - Callback a executer plus tard
       * @param {number} delay - Delai symbolique (pour le tri, pas un vrai timer)
       * @param {string} [name] - Nom pour le debug
       */
      setTimeout(fn: (ctx: EventLoopContext) => void, delay: number = 0, name: string = "setTimeout"): void {
        self.macroTaskQueue.push({
          fn,
          delay,
          name,
          order: self._macroOrder++,
        });
        self.executionLog.push(`[MACRO] Planifie: ${name} (delay=${delay})`);
      },

      /**
       * Planifie une microtache. Equivalent de Promise.resolve().then(fn).
       * S'execute APRES le code synchrone courant et AVANT la prochaine macrotache.
       * S'execute APRES process.nextTick dans le meme cycle.
       *
       * @param {Function} fn - Callback a executer en microtache
       * @param {string} [name] - Nom pour le debug
       */
      promiseThen(fn: (ctx: EventLoopContext) => void, name: string = "promise.then"): void {
        self.microTaskQueue.push({ fn, name });
        self.executionLog.push(`[MICRO] Planifie: ${name}`);
      },

      /**
       * Planifie une microtache prioritaire. Equivalent de process.nextTick(fn).
       * S'execute AVANT les Promise.then dans le meme cycle de microtaches.
       *
       * Pourquoi nextTick est prioritaire :
       * Dans Node.js, nextTick a ete cree avant les Promises et a une priorite
       * speciale. A chaque cycle, Node.js draine d'abord TOUTE la nextTick queue,
       * puis TOUTE la Promise/microtask queue.
       *
       * @param {Function} fn - Callback a executer en nextTick
       * @param {string} [name] - Nom pour le debug
       */
      nextTick(fn: (ctx: EventLoopContext) => void, name: string = "nextTick"): void {
        self.nextTickQueue.push({ fn, name });
        self.executionLog.push(`[TICK] Planifie: ${name}`);
      },

      /**
       * Alias de promiseThen. Equivalent de queueMicrotask(fn).
       */
      queueMicrotask(fn: (ctx: EventLoopContext) => void, name: string = "microtask"): void {
        self.microTaskQueue.push({ fn, name });
        self.executionLog.push(`[MICRO] Planifie: ${name}`);
      },
    };
  }

  /**
   * Draine toutes les microtaches en attente.
   *
   * Algorithme :
   * Tant que nextTickQueue OU microTaskQueue ne sont pas vides :
   *   1. Drainer TOUTE la nextTickQueue (FIFO)
   *   2. Drainer TOUTE la microTaskQueue (FIFO)
   *   3. Revenir a 1 — car les taches drainées ont pu en ajouter d'autres
   *
   * Pourquoi une boucle externe :
   * Une microtache (Promise.then) peut creer un nextTick, et inversement.
   * On doit donc boucler jusqu'a ce que TOUTES les files micro soient vides.
   *
   * @private
   */
  _drainMicrotasks(): void {
    const ctx = this._createContext();

    // Boucle externe : continue tant qu'il y a des micro ou des tick
    while (this.nextTickQueue.length > 0 || this.microTaskQueue.length > 0) {
      // 1. Drainer d'abord TOUS les nextTick en attente
      // Les nextTick ont priorite absolue sur les Promise.then
      while (this.nextTickQueue.length > 0) {
        const tick = this.nextTickQueue.shift();
        this.executionLog.push(`[TICK] Execute: ${tick.name}`);
        this.callStack.push(tick.name);
        tick.fn(ctx);
        this.callStack.pop();
      }

      // 2. Drainer TOUTES les microtaches Promise/queueMicrotask
      // On draine tout le lot actuel. Si une microtache en cree d'autres,
      // elles seront ajoutees a la fin de la file et drainées dans la
      // prochaine iteration de cette boucle while.
      while (this.microTaskQueue.length > 0) {
        const micro = this.microTaskQueue.shift();
        this.executionLog.push(`[MICRO] Execute: ${micro.name}`);
        this.callStack.push(micro.name);
        micro.fn(ctx);
        this.callStack.pop();
      }

      // 3. Revenir en haut de la boucle externe
      // Si les microtaches executees ont ajoute des nextTick ou des Promise.then,
      // on les draine maintenant (nextTick d'abord, puis micro).
    }
  }

  /**
   * Execute une macrotache.
   *
   * Une seule macrotache est executee a la fois. Apres son execution,
   * la methode run() appelle _drainMicrotasks() pour vider toutes les
   * microtaches generees par cette macrotache.
   *
   * @param {Object} task - { fn, delay, name, order }
   * @private
   */
  _executeMacroTask(task: MacroTask): void {
    const ctx = this._createContext();

    this.executionLog.push(`[MACRO] Execute: ${task.name}`);
    this.callStack.push(task.name);
    task.fn(ctx);
    this.callStack.pop();
  }
}

// ===========================================================================
// Suite de tests — 5 programmes-puzzle (identiques a l'exercice)
// ===========================================================================

let testsPassed = 0;
let testsFailed = 0;

function runTest(testName: string, program: ProgramOperation[], expected: string[]): void {
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
  }
}

console.log("=== Tests de la Mini Event Loop (SOLUTION) ===\n");

// -------------------------------------------------------------------------
// Test 1 : Basique — sync, microtask, macrotask
// -------------------------------------------------------------------------
// Code reel equivalent :
//   console.log('A');
//   setTimeout(() => console.log('B'), 0);
//   Promise.resolve().then(() => console.log('C'));
//   console.log('D');
//
// Analyse :
// 1. Execution synchrone : log('A'), setTimeout(B), promiseThen(C), log('D')
//    → outputLog = ['A', 'D']
//    → macroQueue = [B], microQueue = [C]
// 2. Drain micro : execute C → outputLog = ['A', 'D', 'C']
// 3. Macro : execute B → outputLog = ['A', 'D', 'C', 'B']
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
// Code reel equivalent :
//   console.log('start');
//   setTimeout(() => console.log('timeout'), 0);
//   Promise.resolve().then(() => console.log('promise'));
//   process.nextTick(() => console.log('nextTick'));
//   console.log('end');
//
// Analyse :
// 1. Sync : log('start'), setTimeout, promiseThen, nextTick, log('end')
//    → outputLog = ['start', 'end']
//    → macroQueue = [timeout], microQueue = [promise], nextTickQueue = [nextTick]
// 2. Drain micro : nextTick d'abord → 'nextTick', puis promise → 'promise'
//    → outputLog = ['start', 'end', 'nextTick', 'promise']
// 3. Macro : timeout → 'timeout'
//    → outputLog = ['start', 'end', 'nextTick', 'promise', 'timeout']
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
// Code reel equivalent :
//   console.log('1');
//   Promise.resolve().then(() => {
//     console.log('2');
//     Promise.resolve().then(() => console.log('3'));
//   });
//   Promise.resolve().then(() => console.log('4'));
//   console.log('5');
//
// Analyse :
// 1. Sync : log('1'), promiseThen([2+3]), promiseThen([4]), log('5')
//    → outputLog = ['1', '5']
//    → microQueue = [promise-2, promise-4]
// 2. Drain micro :
//    a. Execute promise-2 : log('2'), ajoute promise-3 dans microQueue
//       → outputLog = ['1', '5', '2']
//       → microQueue = [promise-4, promise-3]
//    b. Execute promise-4 : log('4')
//       → outputLog = ['1', '5', '2', '4']
//       → microQueue = [promise-3]
//    c. Execute promise-3 : log('3')
//       → outputLog = ['1', '5', '2', '4', '3']
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
// Code reel equivalent :
//   console.log('A');
//   setTimeout(() => {
//     console.log('B');
//     Promise.resolve().then(() => console.log('C'));
//   }, 0);
//   setTimeout(() => console.log('D'), 0);
//   Promise.resolve().then(() => console.log('E'));
//   console.log('F');
//
// Analyse :
// 1. Sync : A, setTimeout(B+C), setTimeout(D), promiseThen(E), F
//    → outputLog = ['A', 'F']
//    → macroQueue = [B+C, D], microQueue = [E]
// 2. Drain micro : E → outputLog = ['A', 'F', 'E']
// 3. Macro 1 : B+C → log('B'), ajoute promiseThen(C)
//    → outputLog = ['A', 'F', 'E', 'B']
// 4. Drain micro apres macro 1 : C
//    → outputLog = ['A', 'F', 'E', 'B', 'C']
// 5. Macro 2 : D
//    → outputLog = ['A', 'F', 'E', 'B', 'C', 'D']
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
// Test 5 : Puzzle ultime
// -------------------------------------------------------------------------
// Analyse detaillee :
//
// Phase SYNC :
//   log('1'), setTimeout(2+3+4+5), nextTick(6+7), promiseThen(8+9+10), log('11')
//   → outputLog = ['1', '11']
//   → nextTickQueue = [tick-6]
//   → microQueue = [promise-8]
//   → macroQueue = [timeout-2]
//
// Phase MICRO (drain apres sync) :
//   a. nextTick: execute tick-6 → log('6'), ajoute promiseThen(7)
//      → outputLog = ['1', '11', '6']
//      → microQueue = [promise-8, promise-7]
//   b. micro: execute promise-8 → log('8'), setTimeout(9), nextTick(10)
//      → outputLog = ['1', '11', '6', '8']
//      → microQueue = [promise-7]
//      → macroQueue = [timeout-2, timeout-9]
//      → nextTickQueue = [tick-10]
//   c. Boucle externe : nextTickQueue non vide → execute tick-10 → log('10')
//      Ou bien : continue le drain micro d'abord ?
//
//   NON : dans Node.js, l'ordre DANS un cycle de drain est :
//     - D'abord TOUS les nextTick
//     - Puis TOUS les microtask
//   Donc quand on revient au debut de la boucle while :
//     nextTickQueue = [tick-10] → on l'execute d'abord
//
//   Attendons : apres l'etape b, on a encore promise-7 dans microQueue.
//   L'algo de _drainMicrotasks est :
//     while (nextTick ou micro non vide) {
//       while (nextTick non vide) → drain nextTick
//       while (micro non vide) → drain micro
//     }
//   Etape b a termine un element de microQueue. Mais il en reste (promise-7).
//   On continue le while micro interne :
//   c. micro: execute promise-7 → log('7')
//      → outputLog = ['1', '11', '6', '8', '7']
//      → microQueue = [] (vide)
//   d. while micro vide, on sort du while micro interne
//   e. On revient au while externe : nextTickQueue = [tick-10], non vide !
//   f. nextTick: execute tick-10 → log('10')
//      → outputLog = ['1', '11', '6', '8', '7', '10']
//   g. microQueue vide, nextTickQueue vide → drain termine
//
// Phase MACRO 1 : timeout-2
//   Execute : log('2'), nextTick(3), promiseThen(4+5)
//   → outputLog = ['1', '11', '6', '8', '7', '10', '2']
//   → nextTickQueue = [tick-3], microQueue = [promise-4]
//
// Phase MICRO (drain apres macro 1) :
//   a. nextTick: tick-3 → log('3')
//   b. micro: promise-4 → log('4'), nextTick(5)
//   c. nextTick: tick-5 → log('5')
//   → outputLog = ['1', '11', '6', '8', '7', '10', '2', '3', '4', '5']
//
// Phase MACRO 2 : timeout-9
//   Execute : log('9')
//   → outputLog = ['1', '11', '6', '8', '7', '10', '2', '3', '4', '5', '9']
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
