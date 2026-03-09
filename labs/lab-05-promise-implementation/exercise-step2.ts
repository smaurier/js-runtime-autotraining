// =============================================================================
// Lab 05 — Implémenter une Promise — Étape 2 : Gestion des erreurs
// =============================================================================
// Exécuter avec : npx tsx exercise-step2.ts
// =============================================================================
//
// Dans cette étape, vous ajoutez à l'étape 1 :
//   - reject dans le constructeur
//   - .then(onFulfilled, onRejected) — version complète
//   - .catch(onRejected)
//   - MyPromise.reject(reason)
//   - Propagation d'erreur à travers .then()
//   - try/catch dans l'executor
//
// 10 tests valident votre implémentation (les 5 de l'étape 1 + 5 nouveaux).
// =============================================================================

console.log("=== Lab 05 — Étape 2 : Gestion des erreurs (10 tests) ===\n");

// Les trois états possibles d'une Promise
const PENDING = "pending" as const;
const FULFILLED = "fulfilled" as const;
const REJECTED = "rejected" as const;

type PromiseState = typeof PENDING | typeof FULFILLED | typeof REJECTED;

class MyPromise {
  _state: PromiseState;
  _value: any;
  _callbacks: Array<{ onFulfilled: ((value: any) => any) | null; onRejected: ((reason: any) => any) | null; resolve: (value: any) => void; reject: (reason: any) => void }>;

  constructor(executor: (resolve: (value: any) => void, reject: (reason: any) => void) => void) {
    // TODO : Initialisez les propriétés de la Promise
    // - this._state : l'état courant (PENDING au départ)
    // - this._value : la valeur de résolution ou la raison du rejet (undefined au départ)
    // - this._callbacks : file d'attente des callbacks .then() en attente
    //   Chaque entrée : { onFulfilled, onRejected, resolve, reject }

    this._state = PENDING;
    this._value = undefined;
    this._callbacks = [];

    // TODO : Définissez les fonctions resolve et reject locales
    //
    // resolve(value) :
    //   1. Si l'état n'est plus PENDING, ne rien faire
    //   2. Mettre à jour _state à FULFILLED et _value à value
    //   3. Traiter les callbacks en attente
    //
    // reject(reason) :
    //   1. Si l'état n'est plus PENDING, ne rien faire
    //   2. Mettre à jour _state à REJECTED et _value à reason
    //   3. Traiter les callbacks en attente
    //
    // Pour cette étape, PAS besoin de gérer les thenables dans resolve.

    const resolve = (value) => {
      // TODO : Implémentez resolve
    };

    const reject = (reason) => {
      // TODO : Implémentez reject
    };

    // TODO : Exécutez l'executor dans un try/catch
    // Si l'executor lance une exception, appelez reject avec l'erreur
    //
    // 💡 Indice :
    //   try {
    //     executor(resolve, reject);
    //   } catch (err) {
    //     reject(err);
    //   }

    try {
      executor(resolve, reject);
    } catch (err) {
      reject(err);
    }
  }

  /**
   * Méthode interne pour traiter les callbacks en attente.
   * Appelée quand la Promise change d'état (ou dans .then si déjà résolue).
   */
  _processCallbacks() {
    // TODO : Implémentez le traitement des callbacks
    // Pour chaque entrée dans this._callbacks :
    //   1. Programmez le traitement comme MICROTASK (queueMicrotask)
    //   2. Selon l'état (FULFILLED ou REJECTED), choisissez le handler approprié
    //   3. Si le handler est une fonction :
    //      - Appelez-le avec this._value dans un try/catch
    //      - Résolvez la Promise chaînée avec le résultat
    //      - Si exception, rejetez la Promise chaînée
    //   4. Si le handler n'est pas une fonction :
    //      - FULFILLED : propagez la valeur avec cb.resolve(this._value)
    //      - REJECTED : propagez l'erreur avec cb.reject(this._value)
    //
    // N'oubliez pas de vider this._callbacks !

    // 💡 Indice — pseudo-code :
    //
    //   const callbacks = this._callbacks;
    //   this._callbacks = [];
    //
    //   for (const cb of callbacks) {
    //     queueMicrotask(() => {
    //       const handler = (this._state === FULFILLED)
    //         ? cb.onFulfilled
    //         : cb.onRejected;
    //
    //       if (typeof handler !== 'function') {
    //         if (this._state === FULFILLED) cb.resolve(this._value);
    //         else cb.reject(this._value);
    //         return;
    //       }
    //
    //       try {
    //         const result = handler(this._value);
    //         cb.resolve(result);
    //       } catch (err) {
    //         cb.reject(err);
    //       }
    //     });
    //   }
  }

  /**
   * .then(onFulfilled, onRejected)
   * Retourne une NOUVELLE MyPromise pour permettre le chaînage.
   */
  then(onFulfilled, onRejected) {
    // TODO : Implémentez .then()
    // 1. Créez une nouvelle MyPromise dont l'executor capture resolve et reject
    // 2. Ajoutez { onFulfilled, onRejected, resolve, reject } à this._callbacks
    // 3. Si la Promise est déjà résolue (pas PENDING), traitez immédiatement
    // 4. Retournez la nouvelle Promise

    // 💡 Indice — squelette :
    //
    //   let resolveNext, rejectNext;
    //   const nextPromise = new MyPromise((resolve, reject) => {
    //     resolveNext = resolve;
    //     rejectNext = reject;
    //   });
    //
    //   this._callbacks.push({
    //     onFulfilled,
    //     onRejected,
    //     resolve: resolveNext,
    //     reject: rejectNext,
    //   });
    //
    //   if (this._state !== PENDING) {
    //     this._processCallbacks();
    //   }
    //
    //   return nextPromise;

    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * .catch(onRejected) — raccourci pour .then(null, onRejected)
   */
  catch(onRejected) {
    // TODO : Implémentez .catch()
    // 💡 Indice : return this.then(null, onRejected);
    return this.then(null, onRejected);
  }

  /**
   * MyPromise.resolve(value)
   * Retourne une Promise résolue avec la valeur donnée.
   * Si value est déjà une MyPromise, la retourne telle quelle.
   */
  static resolve(value) {
    // TODO : Implémentez MyPromise.resolve()
    // 1. Si value est déjà une instance de MyPromise, retournez-la directement
    // 2. Sinon, créez une nouvelle MyPromise qui résout immédiatement avec value

    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * MyPromise.reject(reason)
   * Retourne une Promise rejetée avec la raison donnée.
   */
  static reject(reason) {
    // TODO : Implémentez MyPromise.reject()
    // 💡 Indice : return new MyPromise((_, reject) => reject(reason));

    return new MyPromise(() => {}); // À remplacer
  }
}

// =============================================================================
// SUITE DE TESTS — 10 tests
// =============================================================================

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  [OK] ${message}`);
  } else {
    failed++;
    console.log(`  [ERREUR] ${message}`);
  }
}

async function runTests() {
  // -------------------------------------------------------------------------
  // Tests de l'étape 1 (1–5)
  // -------------------------------------------------------------------------
  console.log("--- Tests de l'étape 1 (les bases) ---\n");

  // Test 1 : Résolution synchrone
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(42)).then((val) => {
      assert(val === 42, "Test 1 : Résolution synchrone avec valeur 42");
      done();
    });
  });

  // Test 2 : Résolution asynchrone
  await new Promise((done) => {
    new MyPromise((resolve) => {
      setTimeout(() => resolve("async"), 10);
    }).then((val) => {
      assert(val === "async", "Test 2 : Résolution asynchrone");
      done();
    });
  });

  // Test 3 : Chaînage simple
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(1))
      .then((val) => val + 1)
      .then((val) => val * 3)
      .then((val) => {
        assert(val === 6, "Test 3 : Chaînage .then() : 1 -> 2 -> 6");
        done();
      });
  });

  // Test 4 : MyPromise.resolve(99)
  await new Promise((done) => {
    MyPromise.resolve(99).then((val) => {
      assert(val === 99, "Test 4 : MyPromise.resolve(99)");
      done();
    });
  });

  // Test 5 : Les callbacks sont asynchrones (microtask)
  await new Promise((done) => {
    let syncCheck = "avant";
    MyPromise.resolve("ok").then(() => {
      assert(
        syncCheck === "apres",
        "Test 5 : Les callbacks sont asynchrones (programmés en microtask)"
      );
      done();
    });
    syncCheck = "apres";
  });

  // -------------------------------------------------------------------------
  // Tests de l'étape 2 (6–10) — Gestion des erreurs
  // -------------------------------------------------------------------------
  console.log("\n--- Tests de l'étape 2 (gestion des erreurs) ---\n");

  // Test 6 : Rejet synchrone
  await new Promise((done) => {
    new MyPromise((_, reject) => reject("erreur")).catch((err) => {
      assert(err === "erreur", "Test 6 : Rejet synchrone");
      done();
    });
  });

  // Test 7 : Propagation d'erreur à travers .then()
  await new Promise((done) => {
    new MyPromise((_, reject) => reject("boom"))
      .then((val) => val + 1) // Ignoré car rejeté
      .then((val) => val + 2) // Ignoré aussi
      .catch((err) => {
        assert(err === "boom", "Test 7 : Propagation d'erreur à travers .then()");
        done();
      });
  });

  // Test 8 : Exception dans .then() -> rejet
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(1))
      .then(() => {
        throw new Error("oops");
      })
      .catch((err) => {
        assert(err.message === "oops", "Test 8 : Exception dans .then() -> catch");
        done();
      });
  });

  // Test 9 : Exception dans l'executor -> rejet
  await new Promise((done) => {
    new MyPromise(() => {
      throw new Error("executor crash");
    }).catch((err) => {
      assert(
        err.message === "executor crash",
        "Test 9 : Exception dans l'executor -> rejet"
      );
      done();
    });
  });

  // Test 10 : MyPromise.reject()
  await new Promise((done) => {
    MyPromise.reject("nope").catch((err) => {
      assert(err === "nope", "Test 10 : MyPromise.reject('nope')");
      done();
    });
  });

  // Résumé
  console.log(`\n--- Résultat : ${passed}/${passed + failed} tests passés ---`);
  if (failed === 0) {
    console.log("Bravo ! L'étape 2 est complète. Passez à exercise-step3.js !");
  } else {
    console.log(`${failed} test(s) échoué(s). Continuez à déboguer !`);
  }

  console.log("\n=== Fin de l'Étape 2 ===");
}

runTests();
