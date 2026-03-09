// =============================================================================
// Lab 05 — Implémenter une Promise — Étape 3 : Version complète
// =============================================================================
// Exécuter avec : npx tsx exercise-step3.ts
// =============================================================================
//
// Dans cette étape finale, vous ajoutez à l'étape 2 :
//   - Assimilation de thenables dans resolve()
//   - .finally()
//   - MyPromise.all()
//   - MyPromise.race()
//
// 20 tests valident votre implémentation complète
// (les 10 de l'étape 2 + 10 nouveaux).
// =============================================================================

console.log("=== Lab 05 — Étape 3 : Version complète (20 tests) ===\n");

// Les trois états possibles d'une Promise
const PENDING = "pending";
const FULFILLED = "fulfilled";
const REJECTED = "rejected";

class MyPromise {
  constructor(executor) {
    // TODO : Initialisez les propriétés de la Promise
    // - this._state : l'état courant (PENDING au départ)
    // - this._value : la valeur de résolution ou la raison du rejet (undefined au départ)
    // - this._callbacks : file d'attente des callbacks .then() en attente
    //   Chaque entrée : { onFulfilled, onRejected, resolve, reject }
    //   (resolve et reject sont ceux de la Promise retournée par .then())

    this._state = PENDING;
    this._value = undefined;
    this._callbacks = [];

    // TODO : Définissez les fonctions resolve et reject locales
    //
    // resolve(value) :
    //   1. Si l'état n'est plus PENDING, ne rien faire
    //   2. ⚠️ NOUVEAU : Si value est un thenable (objet/fonction avec .then),
    //      appeler value.then(resolve, reject) pour attendre sa résolution
    //   3. Sinon, mettre à jour _state à FULFILLED et _value à value
    //   4. Traiter les callbacks en attente
    //
    // reject(reason) :
    //   1. Si l'état n'est plus PENDING, ne rien faire
    //   2. Mettre à jour _state à REJECTED et _value à reason
    //   3. Traiter les callbacks en attente

    const resolve = (value) => {
      // TODO : Implémentez resolve avec assimilation de thenable
      //
      // 💡 Indice pour l'assimilation de thenable :
      //   if (value !== null && (typeof value === "object" || typeof value === "function")) {
      //     if (typeof value.then === "function") {
      //       try {
      //         value.then(resolve, reject);
      //       } catch (err) {
      //         reject(err);
      //       }
      //       return;
      //     }
      //   }
    };

    const reject = (reason) => {
      // TODO : Implémentez reject
    };

    // Exécution de l'executor dans un try/catch
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
    // (identique à l'étape 2)
    //
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
    // (identique à l'étape 2)
    //
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
    return this.then(null, onRejected);
  }

  /**
   * .finally(onFinally)
   * Le callback est appelé que la Promise soit résolue ou rejetée.
   * La valeur/raison est propagée (pas remplacée par le retour de onFinally).
   */
  finally(onFinally) {
    // TODO : Implémentez .finally()
    //
    // Particularité de finally :
    //   - Le callback ne reçoit PAS la valeur/raison en argument
    //   - La valeur/raison est PROPAGÉE au prochain .then/.catch
    //   - Si onFinally lance une exception, la Promise chaînée est rejetée
    //
    // 💡 Indice :
    //   return this.then(
    //     (value) => MyPromise.resolve(onFinally()).then(() => value),
    //     (reason) => MyPromise.resolve(onFinally()).then(() => { throw reason; })
    //   );

    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * MyPromise.resolve(value)
   * Retourne une Promise résolue avec la valeur donnée.
   * Si value est déjà une MyPromise, la retourne telle quelle.
   */
  static resolve(value) {
    // TODO : Implémentez MyPromise.resolve()
    // 1. Si value est déjà une instance de MyPromise, retournez-la directement
    // 2. Sinon, créez une nouvelle MyPromise qui résout avec value
    //    (l'assimilation de thenable sera gérée par resolve() dans le constructeur)

    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * MyPromise.reject(reason)
   * Retourne une Promise rejetée avec la raison donnée.
   */
  static reject(reason) {
    // TODO : Implémentez MyPromise.reject()
    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * MyPromise.all(promises)
   * Attend que TOUTES les Promises soient résolues.
   * Le tableau de résultats respecte l'ORDRE des Promises d'entrée
   * (pas l'ordre chronologique de résolution).
   * Si une seule Promise rejette, toute la Promise all() rejette immédiatement.
   */
  static all(promises) {
    // TODO : Implémentez MyPromise.all()
    //
    // 1. Créez une nouvelle MyPromise
    // 2. Convertissez promises en tableau avec Array.from()
    // 3. Cas spécial : si le tableau est vide, résolvez immédiatement avec []
    // 4. Initialisez un tableau de résultats et un compteur 'remaining'
    // 5. Pour chaque Promise (utilisez MyPromise.resolve() pour gérer les non-Promises) :
    //    - En cas de résolution : stockez le résultat à l'index correct,
    //      décrémentez remaining, si remaining === 0 résolvez avec le tableau
    //    - En cas de rejet : rejetez immédiatement
    //
    // 💡 Indice — squelette :
    //
    //   return new MyPromise((resolve, reject) => {
    //     const arr = Array.from(promises);
    //     if (arr.length === 0) { resolve([]); return; }
    //
    //     const results = new Array(arr.length);
    //     let remaining = arr.length;
    //
    //     arr.forEach((promise, index) => {
    //       MyPromise.resolve(promise).then(
    //         (value) => {
    //           results[index] = value;
    //           remaining--;
    //           if (remaining === 0) resolve(results);
    //         },
    //         (reason) => reject(reason)
    //       );
    //     });
    //   });

    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * MyPromise.race(promises)
   * La première Promise à se résoudre OU rejeter détermine le résultat.
   * Les autres sont simplement ignorées.
   */
  static race(promises) {
    // TODO : Implémentez MyPromise.race()
    //
    // 1. Créez une nouvelle MyPromise
    // 2. Pour chaque Promise, attachez .then(resolve, reject)
    // 3. Seul le premier resolve/reject aura un effet
    //
    // 💡 Indice :
    //   return new MyPromise((resolve, reject) => {
    //     Array.from(promises).forEach((promise) => {
    //       MyPromise.resolve(promise).then(resolve, reject);
    //     });
    //   });

    return new MyPromise(() => {}); // À remplacer
  }
}

// =============================================================================
// SUITE DE TESTS — 20 tests
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
  // =========================================================================
  // Tests de l'étape 1 (1–5) — Les bases
  // =========================================================================
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

  // =========================================================================
  // Tests de l'étape 2 (6–10) — Gestion des erreurs
  // =========================================================================
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
      .then((val) => val + 1)
      .then((val) => val + 2)
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

  // =========================================================================
  // Tests de l'étape 3 (11–20) — Version complète
  // =========================================================================
  console.log("\n--- Tests de l'étape 3 (version complète) ---\n");

  // Test 11 : .then() retourne une Promise (assimilation)
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(1))
      .then((val) => new MyPromise((resolve) => resolve(val + 10)))
      .then((val) => {
        assert(val === 11, "Test 11 : .then() retourne une MyPromise");
        done();
      });
  });

  // Test 12 : .finally() est appelé et propage la valeur
  await new Promise((done) => {
    let finallyCalled = false;
    new MyPromise((resolve) => resolve("valeur"))
      .finally(() => {
        finallyCalled = true;
      })
      .then((val) => {
        assert(
          finallyCalled && val === "valeur",
          "Test 12 : .finally() appelé, valeur propagée"
        );
        done();
      });
  });

  // Test 13 : .finally() est appelé sur rejet
  await new Promise((done) => {
    let finallyCalled = false;
    new MyPromise((_, reject) => reject("raison"))
      .finally(() => {
        finallyCalled = true;
      })
      .catch((err) => {
        assert(
          finallyCalled && err === "raison",
          "Test 13 : .finally() appelé sur rejet"
        );
        done();
      });
  });

  // Test 14 : MyPromise.all() — toutes résolues
  await new Promise((done) => {
    MyPromise.all([
      MyPromise.resolve(1),
      MyPromise.resolve(2),
      MyPromise.resolve(3),
    ]).then((results) => {
      assert(
        JSON.stringify(results) === "[1,2,3]",
        "Test 14 : MyPromise.all([1, 2, 3])"
      );
      done();
    });
  });

  // Test 15 : MyPromise.all() — une rejetée
  await new Promise((done) => {
    MyPromise.all([
      MyPromise.resolve(1),
      MyPromise.reject("fail"),
      MyPromise.resolve(3),
    ]).catch((err) => {
      assert(err === "fail", "Test 15 : MyPromise.all() avec un rejet");
      done();
    });
  });

  // Test 16 : MyPromise.all() — tableau vide
  await new Promise((done) => {
    MyPromise.all([]).then((results) => {
      assert(
        JSON.stringify(results) === "[]",
        "Test 16 : MyPromise.all([]) -> tableau vide"
      );
      done();
    });
  });

  // Test 17 : MyPromise.race() — le plus rapide gagne
  await new Promise((done) => {
    MyPromise.race([
      new MyPromise((resolve) => setTimeout(() => resolve("lent"), 50)),
      new MyPromise((resolve) => setTimeout(() => resolve("rapide"), 10)),
    ]).then((val) => {
      assert(val === "rapide", "Test 17 : MyPromise.race() — le plus rapide gagne");
      done();
    });
  });

  // Test 18 : Assimilation de thenable (objet avec .then)
  await new Promise((done) => {
    const thenable = {
      then(onFulfilled) {
        onFulfilled(777);
      },
    };
    MyPromise.resolve(thenable).then((val) => {
      assert(val === 777, "Test 18 : Assimilation de thenable");
      done();
    });
  });

  // Test 19 : Résolution imbriquée triple
  await new Promise((done) => {
    new MyPromise((resolve) =>
      resolve(new MyPromise((r) => r(new MyPromise((r2) => r2(42)))))
    ).then((val) => {
      assert(val === 42, "Test 19 : Résolution imbriquée triple");
      done();
    });
  });

  // Test 20 : Seul le premier resolve/reject compte
  await new Promise((done) => {
    new MyPromise((resolve, reject) => {
      resolve("premier");
      resolve("deuxieme");
      reject("troisieme");
    }).then((val) => {
      assert(val === "premier", "Test 20 : Seul le premier resolve/reject compte");
      done();
    });
  });

  // Résumé
  console.log(`\n--- Résultat : ${passed}/${passed + failed} tests passés ---`);
  if (failed === 0) {
    console.log("Bravo ! Votre implémentation de MyPromise est fonctionnelle !");
  } else {
    console.log(`${failed} test(s) échoué(s). Continuez à déboguer !`);
  }

  console.log("\n=== Fin de l'Étape 3 ===");
}

runTests();
