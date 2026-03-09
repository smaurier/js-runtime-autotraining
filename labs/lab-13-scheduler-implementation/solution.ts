// =============================================================================
// Lab 13 — Implementation d'un ordonnanceur cooperatif (SOLUTION)
// =============================================================================
// Lancer avec : npx tsx solution.ts
//
// Implementation complete du Scheduler avec tous les tests qui passent.
// =============================================================================

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/** Pause asynchrone (simule un travail I/O) */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ceder le controle a la boucle d'evenements */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ===========================================================================
// Classe Scheduler — IMPLEMENTATION COMPLETE
// ===========================================================================

type Priority = "high" | "normal" | "low";

interface SchedulerTask {
  fn: () => any;
  priority: Priority;
  signal?: AbortSignal;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  _cleanupAbort?: () => void;
}

class Scheduler {
  concurrency: number;
  running: number;
  queues: Record<Priority, SchedulerTask[]>;
  _scheduling: boolean;

  /**
   * Cree un nouveau Scheduler cooperatif.
   */
  constructor({ concurrency = 3 }: { concurrency?: number } = {}) {
    // Limite de concurrence : combien de taches peuvent tourner en parallele
    this.concurrency = concurrency;

    // Compteur de taches en cours d'execution
    this.running = 0;

    // Trois files d'attente, une par niveau de priorite.
    // Les taches high sont depilees en premier, puis normal, puis low.
    this.queues = {
      high: [],
      normal: [],
      low: [],
    };

    // Indicateur pour eviter les appels recursifs infinis a _schedule
    this._scheduling = false;
  }

  /**
   * Soumet une tache au scheduler.
   *
   * La tache sera placee dans la file correspondant a sa priorite et executee
   * quand un slot de concurrence sera disponible. Les taches high passent
   * avant normal, et normal avant low.
   *
   * @param {Function} fn - Fonction (async ou sync) a executer
   * @param {Object} options
   * @param {'high'|'normal'|'low'} options.priority - Priorite (defaut: 'normal')
   * @param {AbortSignal} [options.signal] - Signal d'annulation optionnel
   * @returns {Promise<*>} - Promise resolue avec le resultat de fn()
   */
  postTask(fn: () => any, { priority = "normal", signal }: { priority?: string; signal?: AbortSignal } = {}): Promise<any> {
    // Valider la priorite
    const validPriorities = ["high", "normal", "low"];
    if (!validPriorities.includes(priority)) {
      return Promise.reject(
        new Error(`Priorite invalide : "${priority}". Valeurs acceptees : ${validPriorities.join(", ")}`)
      );
    }

    // Si le signal est deja abort, rejeter immediatement
    // On evite d'ajouter la tache dans la file inutilement
    if (signal?.aborted) {
      const error = new DOMException("Tache annulee", "AbortError");
      return Promise.reject(error);
    }

    // Creer une Promise avec resolve/reject accessibles de l'exterieur.
    // C'est le pattern "deferred" : on extrait les callbacks de la Promise
    // pour pouvoir la resoudre/rejeter depuis _executeTask.
    let resolve!: (value: any) => void;
    let reject!: (reason: any) => void;
    const promise = new Promise<any>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    // Creer l'objet tache qui contient tout le necessaire pour l'execution
    const task: SchedulerTask = { fn, priority: priority as Priority, signal, resolve, reject };

    // Ajouter la tache dans la file correspondante a sa priorite
    this.queues[priority].push(task);

    // Declencher le scheduling.
    // On n'attend pas (pas de await) car on veut que postTask retourne
    // immediatement la Promise au code appelant.
    this._schedule();

    return promise;
  }

  /**
   * Planifie l'execution des taches en attente.
   *
   * Cette methode est appelee :
   * - Quand une nouvelle tache est ajoutee (postTask)
   * - Quand une tache se termine (_executeTask)
   *
   * Elle depile les taches par priorite et les lance tant que la limite
   * de concurrence n'est pas atteinte.
   *
   * @private
   */
  async _schedule(): Promise<void> {
    // Eviter la reentrance : si _schedule est deja en cours d'execution,
    // on ne relance pas une deuxieme boucle.
    if (this._scheduling) return;
    this._scheduling = true;

    try {
      // Tant qu'il y a des taches en attente ET de la place pour les executer
      while (this.running < this.concurrency) {
        const task = this._dequeue();
        if (!task) break; // Plus rien dans les files

        // Incrementer le compteur AVANT de lancer l'execution.
        // Sinon, un second appel a _schedule pourrait lancer trop de taches.
        this.running++;

        // Lancer la tache SANS await — on veut la concurrence.
        // _executeTask est async et gere son propre lifecycle.
        this._executeTask(task);

        // Ceder le controle a la boucle d'evenements.
        // C'est le coeur du scheduling COOPERATIF : on permet aux callbacks
        // I/O, timers, et autres taches de la boucle d'evenements de s'executer
        // entre chaque tache lancee.
        await yieldToEventLoop();
      }
    } finally {
      this._scheduling = false;
    }
  }

  /**
   * Execute une tache individuelle.
   *
   * Gere l'annulation (avant et pendant), l'execution, la propagation
   * du resultat ou de l'erreur, et le re-scheduling apres completion.
   *
   * @param {Object} task - Objet tache { fn, priority, signal, resolve, reject }
   * @private
   */
  async _executeTask(task: SchedulerTask): Promise<void> {
    const { fn, signal, resolve, reject } = task;

    // Verifier si le signal a ete abort entre le moment ou la tache a ete
    // ajoutee et le moment ou elle est lancee (elle etait dans la file)
    if (signal?.aborted) {
      reject(new DOMException("Tache annulee", "AbortError"));
      this.running--;
      this._schedule(); // Relancer pour les taches en attente
      return;
    }

    // Ecouter l'evenement 'abort' pendant l'execution de la tache.
    // On cree un AbortController local pour pouvoir "faire la course"
    // entre l'execution de fn() et l'annulation.
    let abortHandler: (() => void) | null = null;
    let aborted = false;

    if (signal) {
      // Creer une Promise qui sera rejetee si le signal abort
      abortHandler = () => {
        aborted = true;
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      // Lancer l'execution de la tache.
      // Si fn est async, await attend la resolution.
      // Si fn est sync, le resultat est retourne immediatement.

      if (signal) {
        // Faire la course entre fn() et l'annulation
        const result = await Promise.race([
          // La tache elle-meme
          Promise.resolve().then(() => fn()),
          // Surveillance de l'annulation
          new Promise((_, rejectAbort) => {
            if (signal.aborted) {
              rejectAbort(new DOMException("Tache annulee", "AbortError"));
              return;
            }
            const onAbort = () => {
              rejectAbort(new DOMException("Tache annulee", "AbortError"));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            // Stocker pour cleanup
            task._cleanupAbort = () =>
              signal.removeEventListener("abort", onAbort);
          }),
        ]);

        resolve(result);
      } else {
        // Pas de signal d'annulation — execution simple
        const result = await fn();
        resolve(result);
      }
    } catch (err) {
      // Propager l'erreur (y compris AbortError)
      reject(err);
    } finally {
      // Nettoyage
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
      if (task._cleanupAbort) {
        task._cleanupAbort();
      }

      // Decrementer le compteur de taches en cours
      this.running--;

      // Relancer le scheduling pour depiler les taches en attente.
      // Maintenant qu'un slot est libere, une tache en attente peut demarrer.
      this._schedule();
    }
  }

  /**
   * Depile la prochaine tache de la file la plus prioritaire non vide.
   *
   * Ordre de priorite : high > normal > low.
   * Utilise shift() pour un comportement FIFO au sein de chaque priorite.
   *
   * @returns {Object|null} - La prochaine tache, ou null si tout est vide
   * @private
   */
  _dequeue(): SchedulerTask | null {
    // Verifier les files dans l'ordre de priorite decroissante
    if (this.queues.high.length > 0) {
      return this.queues.high.shift();
    }
    if (this.queues.normal.length > 0) {
      return this.queues.normal.shift();
    }
    if (this.queues.low.length > 0) {
      return this.queues.low.shift();
    }
    return null;
  }

  /**
   * Nombre total de taches en attente dans les files.
   */
  get pendingCount() {
    return (
      this.queues.high.length +
      this.queues.normal.length +
      this.queues.low.length
    );
  }

  /**
   * Nombre de taches en cours d'execution.
   */
  get runningCount() {
    return this.running;
  }
}

// ===========================================================================
// Suite de tests (identique a l'exercice)
// ===========================================================================

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS : ${message}`);
    passed++;
  } else {
    console.error(`  FAIL : ${message}`);
    failed++;
  }
}

async function assertRejects(promise: Promise<any>, errorCheck: (err: any) => boolean, message: string): Promise<void> {
  try {
    await promise;
    console.error(`  FAIL : ${message} (pas d'erreur levee)`);
    failed++;
  } catch (err) {
    if (errorCheck(err)) {
      console.log(`  PASS : ${message}`);
      passed++;
    } else {
      console.error(`  FAIL : ${message} (mauvaise erreur: ${err.message})`);
      failed++;
    }
  }
}

async function runTests() {
  console.log("=== Tests du Scheduler (SOLUTION) ===\n");

  // Test 1 : Execution basique
  console.log("Test 1 : Execution basique");
  {
    const scheduler = new Scheduler();
    const result = await scheduler.postTask(() => 42);
    assert(result === 42, "Une tache simple retourne 42");
  }

  // Test 2 : Tache async
  console.log("\nTest 2 : Tache async");
  {
    const scheduler = new Scheduler();
    const result = await scheduler.postTask(async () => {
      await sleep(10);
      return "async-result";
    });
    assert(result === "async-result", "Une tache async retourne son resultat");
  }

  // Test 3 : Ordre des priorites
  console.log("\nTest 3 : Ordre des priorites");
  {
    const scheduler = new Scheduler({ concurrency: 1 });
    const order = [];

    const blocker = scheduler.postTask(async () => {
      await sleep(50);
      return "blocker";
    }, { priority: "high" });

    const p1 = scheduler.postTask(() => {
      order.push("low");
    }, { priority: "low" });

    const p2 = scheduler.postTask(() => {
      order.push("normal");
    }, { priority: "normal" });

    const p3 = scheduler.postTask(() => {
      order.push("high");
    }, { priority: "high" });

    await Promise.all([blocker, p1, p2, p3]);

    assert(
      order[0] === "high" && order[1] === "normal" && order[2] === "low",
      `Ordre correct: high → normal → low (recu: ${order.join(" → ")})`
    );
  }

  // Test 4 : Limite de concurrence
  console.log("\nTest 4 : Limite de concurrence");
  {
    const scheduler = new Scheduler({ concurrency: 2 });
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const tasks = Array.from({ length: 6 }, (_, i) =>
      scheduler.postTask(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await sleep(30);
        currentConcurrent--;
        return i;
      })
    );

    const results = await Promise.all(tasks);
    assert(maxConcurrent <= 2, `Concurrence max = ${maxConcurrent} (limite: 2)`);
    assert(results.length === 6, `Toutes les taches terminees (${results.length}/6)`);
  }

  // Test 5 : Annulation avant execution
  console.log("\nTest 5 : Annulation avant execution");
  {
    const scheduler = new Scheduler({ concurrency: 1 });
    const ac = new AbortController();

    const blocker = scheduler.postTask(() => sleep(100));

    const cancelable = scheduler.postTask(
      () => "should-not-run",
      { priority: "normal", signal: ac.signal }
    );

    ac.abort();

    await assertRejects(
      cancelable,
      (err) => err.name === "AbortError",
      "Tache annulee avant execution → AbortError"
    );

    await blocker;
  }

  // Test 6 : Annulation pendant execution
  console.log("\nTest 6 : Annulation pendant execution");
  {
    const scheduler = new Scheduler({ concurrency: 3 });
    const ac = new AbortController();

    const cancelable = scheduler.postTask(
      async () => {
        await sleep(200);
        return "should-not-complete";
      },
      { signal: ac.signal }
    );

    setTimeout(() => ac.abort(), 30);

    await assertRejects(
      cancelable,
      (err) => err.name === "AbortError",
      "Tache annulee pendant execution → AbortError"
    );
  }

  // Test 7 : Signal deja abort
  console.log("\nTest 7 : Signal deja abort");
  {
    const scheduler = new Scheduler();
    const ac = new AbortController();
    ac.abort();

    await assertRejects(
      scheduler.postTask(() => "never", { signal: ac.signal }),
      (err) => err.name === "AbortError",
      "Signal deja abort → rejet immediat"
    );
  }

  // Test 8 : Erreur dans une tache
  console.log("\nTest 8 : Erreur dans une tache");
  {
    const scheduler = new Scheduler();

    await assertRejects(
      scheduler.postTask(() => {
        throw new Error("BOOM");
      }),
      (err) => err.message === "BOOM",
      "L'erreur d'une tache est propagee"
    );
  }

  // Test 9 : pendingCount et runningCount
  console.log("\nTest 9 : pendingCount et runningCount");
  {
    const scheduler = new Scheduler({ concurrency: 1 });

    assert(scheduler.pendingCount === 0, "pendingCount initial = 0");
    assert(scheduler.runningCount === 0, "runningCount initial = 0");

    let resolveBlocker;
    const blocker = scheduler.postTask(
      () => new Promise((r) => { resolveBlocker = r; })
    );

    await yieldToEventLoop();
    await yieldToEventLoop();

    const p1 = scheduler.postTask(() => 1);
    const p2 = scheduler.postTask(() => 2);
    const p3 = scheduler.postTask(() => 3);

    assert(scheduler.pendingCount === 3, `pendingCount = ${scheduler.pendingCount} (attendu: 3)`);
    assert(scheduler.runningCount === 1, `runningCount = ${scheduler.runningCount} (attendu: 1)`);

    resolveBlocker();
    await Promise.all([blocker, p1, p2, p3]);

    assert(scheduler.pendingCount === 0, `pendingCount final = ${scheduler.pendingCount} (attendu: 0)`);
    assert(scheduler.runningCount === 0, `runningCount final = ${scheduler.runningCount} (attendu: 0)`);
  }

  // Test 10 : Haute charge
  console.log("\nTest 10 : Haute charge (100 taches)");
  {
    const scheduler = new Scheduler({ concurrency: 5 });

    const tasks = [];
    for (let i = 0; i < 100; i++) {
      const priority = i % 3 === 0 ? "high" : i % 3 === 1 ? "normal" : "low";
      tasks.push(
        scheduler.postTask(
          async () => {
            await sleep(Math.random() * 5);
            return i;
          },
          { priority }
        )
      );
    }

    const allResults = await Promise.all(tasks);
    assert(allResults.length === 100, `100 taches completees (recu: ${allResults.length})`);
    assert(
      scheduler.pendingCount === 0 && scheduler.runningCount === 0,
      "Scheduler vide apres completion de toutes les taches"
    );
  }

  // Test 11 : Priorite invalide
  console.log("\nTest 11 : Priorite invalide");
  {
    const scheduler = new Scheduler();

    await assertRejects(
      scheduler.postTask(() => 1, { priority: "urgent" }),
      (err) => err.message.includes("Priorite invalide") || err.message.includes("priority"),
      "Priorite invalide → erreur"
    );
  }

  // Resume
  console.log("\n" + "=".repeat(50));
  console.log(`Resultats : ${passed} passes, ${failed} echoues sur ${passed + failed}`);

  if (failed === 0) {
    console.log("Tous les tests passent !");
  } else {
    console.log(`${failed} test(s) a corriger.`);
  }
}

runTests().catch(console.error);
