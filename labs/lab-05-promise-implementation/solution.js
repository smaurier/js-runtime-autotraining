// =============================================================================
// Lab 05 — Implémenter une Promise — SOLUTION
// =============================================================================
// Exécuter avec : node solution.js
// =============================================================================

console.log("=== Lab 05 : Implémenter une Promise — SOLUTION ===\n");

// Les trois états possibles d'une Promise
const PENDING = "pending";
const FULFILLED = "fulfilled";
const REJECTED = "rejected";

class MyPromise {
  constructor(executor) {
    // État interne de la Promise
    this._state = PENDING;     // État courant
    this._value = undefined;   // Valeur de résolution ou raison de rejet
    this._callbacks = [];      // File d'attente des handlers .then()

    // Fonction resolve : appelée pour résoudre la Promise avec une valeur.
    // Si la valeur est un thenable, on attend sa résolution avant de
    // finaliser la nôtre (c'est "l'assimilation de thenable").
    const resolve = (value) => {
      // Protection : une fois résolue ou rejetée, on ne change plus d'état.
      // C'est ce qui garantit que seul le premier appel à resolve/reject compte.
      if (this._state !== PENDING) return;

      // Assimilation de thenable : si value a une méthode .then(),
      // on la traite comme une Promise et on attend sa résolution.
      // Cela fonctionne avec MyPromise, les Promises natives, ou tout objet thenable.
      if (value !== null && (typeof value === "object" || typeof value === "function")) {
        if (typeof value.then === "function") {
          // On "délègue" notre résolution à la Promise/thenable interne.
          // Quand elle sera résolue, notre resolve sera appelé récursivement.
          // Quand elle sera rejetée, notre reject sera appelé.
          try {
            value.then(resolve, reject);
          } catch (err) {
            reject(err);
          }
          return;
        }
      }

      // Cas normal : résolution avec une valeur simple
      this._state = FULFILLED;
      this._value = value;
      this._processCallbacks();
    };

    // Fonction reject : marque la Promise comme rejetée.
    // Contrairement à resolve, on ne fait PAS d'assimilation de thenable.
    // reject(promise) stocke la Promise elle-même comme raison, sans l'attendre.
    const reject = (reason) => {
      if (this._state !== PENDING) return;

      this._state = REJECTED;
      this._value = reason;
      this._processCallbacks();
    };

    // Exécution de l'executor : c'est la fonction passée à new MyPromise((resolve, reject) => {...}).
    // Si elle lance une exception, la Promise est automatiquement rejetée.
    try {
      executor(resolve, reject);
    } catch (err) {
      reject(err);
    }
  }

  /**
   * Traite tous les callbacks en attente.
   *
   * Chaque callback est programmé comme MICROTASK via queueMicrotask().
   * C'est essentiel : les spécifications Promises/A+ exigent que les
   * callbacks soient toujours appelés de manière asynchrone, même si
   * la Promise est déjà résolue au moment de l'appel à .then().
   */
  _processCallbacks() {
    // On vide la file d'attente pour éviter de retraiter les mêmes callbacks
    const callbacks = this._callbacks;
    this._callbacks = [];

    for (const cb of callbacks) {
      // MICROTASK : le callback est programmé pour s'exécuter après le code
      // synchrone en cours, mais avant toute macrotask (setTimeout, etc.)
      queueMicrotask(() => {
        // On choisit le handler selon l'état de la Promise
        const handler =
          this._state === FULFILLED ? cb.onFulfilled : cb.onRejected;

        if (typeof handler !== "function") {
          // Si le handler n'est pas une fonction (ex: .then(null, null)),
          // on propage simplement la valeur/raison à la Promise suivante.
          // C'est ce qui permet à une erreur de "traverser" plusieurs .then()
          // jusqu'à atteindre un .catch().
          if (this._state === FULFILLED) {
            cb.resolve(this._value);
          } else {
            cb.reject(this._value);
          }
          return;
        }

        try {
          // On exécute le handler avec la valeur de la Promise
          const result = handler(this._value);
          // Le résultat est utilisé pour résoudre la Promise chaînée.
          // Si result est une Promise/thenable, resolve() s'en chargera
          // grâce à l'assimilation de thenable dans le constructeur.
          cb.resolve(result);
        } catch (err) {
          // Si le handler lance une exception, la Promise chaînée est rejetée.
          cb.reject(err);
        }
      });
    }
  }

  /**
   * .then(onFulfilled, onRejected)
   *
   * C'est la méthode CENTRALE des Promises. Elle :
   * 1. Crée une nouvelle MyPromise (pour le chaînage)
   * 2. Enregistre les handlers et les fonctions resolve/reject de la nouvelle Promise
   * 3. Si la Promise courante est déjà résolue, traite immédiatement (en microtask)
   * 4. Retourne la nouvelle Promise
   */
  then(onFulfilled, onRejected) {
    // On crée la Promise de chaînage. L'executor capture resolve et reject
    // pour les stocker dans l'entrée de callback.
    let resolveNext, rejectNext;
    const nextPromise = new MyPromise((resolve, reject) => {
      resolveNext = resolve;
      rejectNext = reject;
    });

    // On enregistre le callback dans la file d'attente
    this._callbacks.push({
      onFulfilled,
      onRejected,
      resolve: resolveNext,
      reject: rejectNext,
    });

    // Si la Promise est DÉJÀ résolue (pas en attente),
    // on traite les callbacks immédiatement (mais toujours en microtask).
    if (this._state !== PENDING) {
      this._processCallbacks();
    }

    return nextPromise;
  }

  /**
   * .catch(onRejected) — raccourci pour .then(null, onRejected)
   */
  catch(onRejected) {
    return this.then(null, onRejected);
  }

  /**
   * .finally(onFinally)
   *
   * Particularité : le callback finally ne reçoit PAS la valeur/raison.
   * Il est appelé dans tous les cas, et la valeur/raison est PROPAGÉE
   * (sauf si onFinally lance une exception ou retourne une Promise rejetée).
   */
  finally(onFinally) {
    return this.then(
      // Cas résolution : on appelle onFinally puis on repropage la valeur
      (value) => {
        return MyPromise.resolve(onFinally()).then(() => value);
      },
      // Cas rejet : on appelle onFinally puis on relance l'erreur
      (reason) => {
        return MyPromise.resolve(onFinally()).then(() => {
          throw reason;
        });
      }
    );
  }

  /**
   * MyPromise.resolve(value)
   *
   * Si value est déjà une MyPromise, on la retourne directement (pas d'encapsulation).
   * Si c'est un thenable, on l'assimile.
   * Sinon, on crée une Promise résolue avec la valeur.
   */
  static resolve(value) {
    // Si c'est déjà une MyPromise, pas besoin d'en créer une nouvelle
    if (value instanceof MyPromise) {
      return value;
    }

    // Pour tout le reste (y compris les thenables), on crée une nouvelle
    // MyPromise. L'assimilation de thenable sera gérée par resolve() dans le constructeur.
    return new MyPromise((resolve) => resolve(value));
  }

  /**
   * MyPromise.reject(reason)
   *
   * Crée toujours une nouvelle Promise rejetée (même si reason est une Promise).
   */
  static reject(reason) {
    return new MyPromise((_, reject) => reject(reason));
  }

  /**
   * MyPromise.all(promises)
   *
   * Attend que TOUTES les Promises soient résolues.
   * Le tableau de résultats respecte l'ORDRE des Promises d'entrée
   * (pas l'ordre chronologique de résolution).
   * Si une seule Promise rejette, toute la Promise all() rejette immédiatement.
   */
  static all(promises) {
    return new MyPromise((resolve, reject) => {
      const promiseArray = Array.from(promises);

      // Cas spécial : tableau vide -> résolution immédiate avec []
      if (promiseArray.length === 0) {
        resolve([]);
        return;
      }

      const results = new Array(promiseArray.length);
      let remaining = promiseArray.length;

      promiseArray.forEach((promise, index) => {
        // On utilise MyPromise.resolve() pour gérer les valeurs non-Promise
        // dans le tableau (ex: MyPromise.all([1, 2, 3]))
        MyPromise.resolve(promise).then(
          (value) => {
            // On stocke le résultat à l'INDEX correct (pas dans l'ordre d'arrivée)
            results[index] = value;
            remaining--;

            // Quand tous les résultats sont là, on résout avec le tableau complet
            if (remaining === 0) {
              resolve(results);
            }
          },
          (reason) => {
            // Premier rejet = rejet immédiat de all().
            // Les résolutions suivantes sont ignorées (resolve/reject ne font rien
            // si la Promise est déjà résolue/rejetée).
            reject(reason);
          }
        );
      });
    });
  }

  /**
   * MyPromise.race(promises)
   *
   * La première Promise à se résoudre OU rejeter détermine le résultat.
   * Les autres sont simplement ignorées.
   */
  static race(promises) {
    return new MyPromise((resolve, reject) => {
      const promiseArray = Array.from(promises);

      promiseArray.forEach((promise) => {
        // Chaque Promise tente de résoudre/rejeter la Promise race().
        // Seul le premier appel aura un effet grâce à la protection
        // dans le constructeur (if state !== PENDING return).
        MyPromise.resolve(promise).then(resolve, reject);
      });
    });
  }
}

// =============================================================================
// SUITE DE TESTS (identique à exercise.js)
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
  console.log("--- Tests de base ---\n");

  // Test 1 : Résolution synchrone
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(42)).then((val) => {
      assert(val === 42, "Test 1 : Résolution synchrone avec valeur 42");
      done();
    });
  });

  // Test 2 : Rejet synchrone
  await new Promise((done) => {
    new MyPromise((_, reject) => reject("erreur")).catch((err) => {
      assert(err === "erreur", "Test 2 : Rejet synchrone");
      done();
    });
  });

  // Test 3 : Résolution asynchrone
  await new Promise((done) => {
    new MyPromise((resolve) => {
      setTimeout(() => resolve("async"), 10);
    }).then((val) => {
      assert(val === "async", "Test 3 : Résolution asynchrone");
      done();
    });
  });

  // Test 4 : Chaînage de .then()
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(1))
      .then((val) => val + 1)
      .then((val) => val * 3)
      .then((val) => {
        assert(val === 6, "Test 4 : Chaînage .then() : 1 -> 2 -> 6");
        done();
      });
  });

  // Test 5 : Propagation d'erreur à travers les .then()
  await new Promise((done) => {
    new MyPromise((_, reject) => reject("boom"))
      .then((val) => val + 1)
      .then((val) => val + 2)
      .catch((err) => {
        assert(err === "boom", "Test 5 : Propagation d'erreur à travers .then()");
        done();
      });
  });

  // Test 6 : Exception dans .then() -> rejet
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(1))
      .then(() => {
        throw new Error("oops");
      })
      .catch((err) => {
        assert(err.message === "oops", "Test 6 : Exception dans .then() -> catch");
        done();
      });
  });

  // Test 7 : .then() retourne une Promise (assimilation)
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(1))
      .then((val) => new MyPromise((resolve) => resolve(val + 10)))
      .then((val) => {
        assert(val === 11, "Test 7 : .then() retourne une MyPromise");
        done();
      });
  });

  // Test 8 : Exception dans l'executor -> rejet
  await new Promise((done) => {
    new MyPromise(() => {
      throw new Error("executor crash");
    }).catch((err) => {
      assert(
        err.message === "executor crash",
        "Test 8 : Exception dans l'executor"
      );
      done();
    });
  });

  // Test 9 : .finally() est appelé et propage la valeur
  await new Promise((done) => {
    let finallyCalled = false;
    new MyPromise((resolve) => resolve("valeur"))
      .finally(() => {
        finallyCalled = true;
      })
      .then((val) => {
        assert(
          finallyCalled && val === "valeur",
          "Test 9 : .finally() appelé, valeur propagée"
        );
        done();
      });
  });

  // Test 10 : .finally() est appelé sur rejet
  await new Promise((done) => {
    let finallyCalled = false;
    new MyPromise((_, reject) => reject("raison"))
      .finally(() => {
        finallyCalled = true;
      })
      .catch((err) => {
        assert(
          finallyCalled && err === "raison",
          "Test 10 : .finally() appelé sur rejet"
        );
        done();
      });
  });

  console.log("\n--- Tests des méthodes statiques ---\n");

  // Test 11 : MyPromise.resolve()
  await new Promise((done) => {
    MyPromise.resolve(99).then((val) => {
      assert(val === 99, "Test 11 : MyPromise.resolve(99)");
      done();
    });
  });

  // Test 12 : MyPromise.reject()
  await new Promise((done) => {
    MyPromise.reject("nope").catch((err) => {
      assert(err === "nope", "Test 12 : MyPromise.reject('nope')");
      done();
    });
  });

  // Test 13 : MyPromise.all() — toutes résolues
  await new Promise((done) => {
    MyPromise.all([
      MyPromise.resolve(1),
      MyPromise.resolve(2),
      MyPromise.resolve(3),
    ]).then((results) => {
      assert(
        JSON.stringify(results) === "[1,2,3]",
        "Test 13 : MyPromise.all([1, 2, 3])"
      );
      done();
    });
  });

  // Test 14 : MyPromise.all() — une rejetée
  await new Promise((done) => {
    MyPromise.all([
      MyPromise.resolve(1),
      MyPromise.reject("fail"),
      MyPromise.resolve(3),
    ]).catch((err) => {
      assert(err === "fail", "Test 14 : MyPromise.all() avec un rejet");
      done();
    });
  });

  // Test 15 : MyPromise.all() — tableau vide
  await new Promise((done) => {
    MyPromise.all([]).then((results) => {
      assert(
        JSON.stringify(results) === "[]",
        "Test 15 : MyPromise.all([]) -> tableau vide"
      );
      done();
    });
  });

  // Test 16 : MyPromise.race()
  await new Promise((done) => {
    MyPromise.race([
      new MyPromise((resolve) => setTimeout(() => resolve("lent"), 50)),
      new MyPromise((resolve) => setTimeout(() => resolve("rapide"), 10)),
    ]).then((val) => {
      assert(val === "rapide", "Test 16 : MyPromise.race() — le plus rapide gagne");
      done();
    });
  });

  // Test 17 : Les callbacks sont asynchrones (microtask)
  await new Promise((done) => {
    let syncCheck = "avant";
    MyPromise.resolve("ok").then(() => {
      assert(
        syncCheck === "apres",
        "Test 17 : Les callbacks sont asynchrones"
      );
      done();
    });
    syncCheck = "apres";
  });

  // Test 18 : Assimilation de thenable
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
    console.log("Tous les tests passent ! L'implémentation est complète.");
  } else {
    console.log(`${failed} test(s) échoué(s).`);
  }

  console.log("\n=== Fin du Lab 05 — SOLUTION ===");
}

runTests();
