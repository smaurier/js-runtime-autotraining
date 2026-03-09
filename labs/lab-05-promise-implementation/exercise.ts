// =============================================================================
// Lab 05 — Implémenter une Promise
// =============================================================================
// Exécuter avec : npx tsx exercise.ts
// =============================================================================

console.log("=== Lab 05 : Implémenter une Promise ===\n");

// Les trois états possibles d'une Promise
const PENDING = "pending" as const;
const FULFILLED = "fulfilled" as const;
const REJECTED = "rejected" as const;

type PromiseState = typeof PENDING | typeof FULFILLED | typeof REJECTED;

interface MyPromiseCallback {
  onFulfilled: ((value: any) => any) | null;
  onRejected: ((reason: any) => any) | null;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

type Executor = (resolve: (value: any) => void, reject: (reason: any) => void) => void;

class MyPromise {
  _state: PromiseState;
  _value: any;
  _callbacks: MyPromiseCallback[];

  constructor(executor: Executor) {
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
    // - resolve(value) : si l'état est PENDING, passe à FULFILLED et déclenche les callbacks
    // - reject(reason) : si l'état est PENDING, passe à REJECTED et déclenche les callbacks
    // Attention : si resolve() reçoit une Promise/thenable, il faut attendre sa résolution

    const resolve = (value: any): void => {
      // TODO : Implémentez resolve
      // 1. Si l'état n'est plus PENDING, ne rien faire (protection contre les appels multiples)
      // 2. Si value est un thenable (typeof value?.then === 'function'),
      //    appeler value.then(resolve, reject) pour attendre la résolution
      // 3. Sinon, mettre à jour _state et _value, puis traiter les callbacks en attente
    };

    const reject = (reason: any): void => {
      // TODO : Implémentez reject
      // 1. Si l'état n'est plus PENDING, ne rien faire
      // 2. Mettre à jour _state à REJECTED et _value à reason
      // 3. Traiter les callbacks en attente
    };

    // TODO : Exécutez l'executor dans un try/catch
    // Si l'executor lance une exception, appelez reject avec l'erreur
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
  _processCallbacks(): void {
    // TODO : Implémentez le traitement des callbacks
    // Pour chaque entrée dans this._callbacks :
    //   1. Programmez le traitement comme MICROTASK (queueMicrotask)
    //   2. Selon l'état (FULFILLED ou REJECTED), appelez onFulfilled ou onRejected
    //   3. Si le handler retourne une valeur, résolvez la Promise chaînée avec cette valeur
    //   4. Si le handler lance une exception, rejetez la Promise chaînée
    //   5. Si le handler n'est pas une fonction, propagez la valeur/raison directement

    // 💡 Indice — pseudo-code de _processCallbacks :
    //
    //   pour chaque callback dans this._callbacks :
    //     queueMicrotask(() => {
    //       const handler = (this._state === FULFILLED) ? cb.onFulfilled : cb.onRejected;
    //       if (typeof handler !== 'function') {
    //         // Pas de handler → propager la valeur/raison au prochain maillon
    //         if (this._state === FULFILLED) cb.resolve(this._value);
    //         else cb.reject(this._value);
    //         return;
    //       }
    //       try {
    //         const result = handler(this._value);
    //         cb.resolve(result);
    //       } catch (err) {
    //         cb.reject(err);
    //       }
    //     });
    //   vider this._callbacks
  }

  /**
   * .then(onFulfilled, onRejected)
   * Retourne une NOUVELLE MyPromise.
   */
  then(onFulfilled: ((value: any) => any) | null, onRejected?: ((reason: any) => any) | null): MyPromise {
    // TODO : Implémentez .then()
    // 1. Créez une nouvelle MyPromise (avec un executor qui capture resolve et reject)
    // 2. Ajoutez { onFulfilled, onRejected, resolve, reject } à this._callbacks
    // 3. Si la Promise est déjà résolue (pas PENDING), traitez immédiatement
    // 4. Retournez la nouvelle Promise

    // 💡 Indice — squelette de .then() :
    //
    //   return new MyPromise((resolve, reject) => {
    //     this._callbacks.push({ onFulfilled, onRejected, resolve, reject });
    //     if (this._state !== PENDING) {
    //       this._processCallbacks();
    //     }
    //   });
    //
    //   L'idée : on crée une NOUVELLE Promise dont le resolve/reject sont
    //   stockés dans la callback queue. Quand la Promise courante se résout,
    //   _processCallbacks appellera le handler et résoudra la nouvelle Promise.

    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * .catch(onRejected) — raccourci pour .then(null, onRejected)
   */
  catch(onRejected: ((reason: any) => any) | null): MyPromise {
    // TODO : Implémentez .catch()
    return this.then(null, onRejected);
  }

  /**
   * .finally(onFinally)
   * Le callback est appelé que la Promise soit résolue ou rejetée.
   * La valeur/raison est propagée (pas remplacée par le retour de onFinally).
   */
  finally(onFinally: () => any): MyPromise {
    // TODO : Implémentez .finally()
    // Indice : utilisez .then() avec deux callbacks qui :
    //   1. Appellent onFinally()
    //   2. Propagent la valeur originale (resolve) ou relancent l'erreur (reject)

    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * MyPromise.resolve(value)
   * Retourne une Promise résolue avec la valeur donnée.
   * Si value est déjà une MyPromise, la retourne telle quelle.
   */
  static resolve(value: any): MyPromise {
    // TODO : Implémentez MyPromise.resolve()
    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * MyPromise.reject(reason)
   * Retourne une Promise rejetée avec la raison donnée.
   */
  static reject(reason: any): MyPromise {
    // TODO : Implémentez MyPromise.reject()
    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * MyPromise.all(promises)
   * Attend que toutes les Promises soient résolues.
   * Retourne un tableau de résultats dans l'ORDRE des Promises (pas l'ordre de résolution).
   * Si une Promise rejette, la Promise retournée rejette immédiatement.
   */
  static all(promises: Iterable<MyPromise>): MyPromise {
    // TODO : Implémentez MyPromise.all()
    // 1. Créez une nouvelle MyPromise
    // 2. Initialisez un compteur et un tableau de résultats
    // 3. Pour chaque Promise, attachez .then() pour stocker le résultat à l'index correct
    // 4. Quand le compteur atteint promises.length, résolvez avec le tableau
    // 5. Gérez les cas : tableau vide, valeurs non-Promise dans le tableau

    return new MyPromise(() => {}); // À remplacer
  }

  /**
   * MyPromise.race(promises)
   * Retourne dès que la première Promise se résout ou rejette.
   */
  static race(promises: Iterable<MyPromise>): MyPromise {
    // TODO : Implémentez MyPromise.race()
    // 1. Créez une nouvelle MyPromise
    // 2. Pour chaque Promise, attachez .then(resolve, reject)
    // 3. La première à se résoudre/rejeter gagne (les suivantes sont ignorées)

    return new MyPromise(() => {}); // À remplacer
  }
}

// =============================================================================
// SUITE DE TESTS
// =============================================================================
// Ces tests vérifient le bon fonctionnement de MyPromise.
// Ils doivent TOUS passer quand l'implémentation est complète.
// =============================================================================

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string, hint?: string): void {
  if (condition) {
    passed++;
    console.log(`  [OK] ${message}`);
  } else {
    failed++;
    console.log(`  [ERREUR] ${message}`);
    if (hint) {
      console.log(`    💡 Conseil : ${hint}`);
    }
  }
}

async function runTests() {
  console.log("--- Tests de base ---\n");

  // Test 1 : Résolution synchrone
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(42)).then((val) => {
      assert(val === 42, "Test 1 : Résolution synchrone avec valeur 42", "Vérifiez que resolve() met à jour _state à FULFILLED et _value à la valeur passée.");
      done();
    });
  });

  // Test 2 : Rejet synchrone
  await new Promise((done) => {
    new MyPromise((_, reject) => reject("erreur")).catch((err) => {
      assert(err === "erreur", "Test 2 : Rejet synchrone", "Vérifiez que reject() met à jour _state à REJECTED et _value à la raison.");
      done();
    });
  });

  // Test 3 : Résolution asynchrone
  await new Promise((done) => {
    new MyPromise((resolve) => {
      setTimeout(() => resolve("async"), 10);
    }).then((val) => {
      assert(val === "async", "Test 3 : Résolution asynchrone", "Quand resolve est appelé après un setTimeout, les callbacks .then() en attente doivent être traités.");
      done();
    });
  });

  // Test 4 : Chaînage de .then()
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(1))
      .then((val) => val + 1)
      .then((val) => val * 3)
      .then((val) => {
        assert(val === 6, "Test 4 : Chaînage .then() : 1 -> 2 -> 6", "Chaque .then() doit retourner une NOUVELLE MyPromise. Le resolve de cette Promise doit recevoir la valeur retournée par le handler.");
        done();
      });
  });

  // Test 5 : Propagation d'erreur à travers les .then()
  await new Promise((done) => {
    new MyPromise((_, reject) => reject("boom"))
      .then((val) => val + 1) // Ignoré car rejeté
      .then((val) => val + 2) // Ignoré aussi
      .catch((err) => {
        assert(err === "boom", "Test 5 : Propagation d'erreur à travers .then()", "Si aucun onRejected n'est fourni dans .then(), l'erreur doit se PROPAGER au .then() suivant.");
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
        assert(err.message === "oops", "Test 6 : Exception dans .then() -> catch", "Dans _processCallbacks, entourez l'appel au handler d'un try/catch. Si ça throw, appelez cb.reject(err).");
        done();
      });
  });

  // Test 7 : .then() retourne une Promise (assimilation)
  await new Promise((done) => {
    new MyPromise((resolve) => resolve(1))
      .then((val) => new MyPromise((resolve) => resolve(val + 10)))
      .then((val) => {
        assert(val === 11, "Test 7 : .then() retourne une MyPromise", "Si le handler retourne un thenable, resolve() doit détecter .then et attendre la résolution.");
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
        "Test 8 : Exception dans l'executor",
        "Le try/catch autour de executor(resolve, reject) doit appeler reject(err) en cas d'exception."
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
          "Test 9 : .finally() appelé, valeur propagée",
          "finally() doit appeler onFinally() puis propager la valeur originale avec .then(() => value)."
        );
        done();
      });
  });

  // Test 10 : .finally() est appelé sur rejet et propage l'erreur
  await new Promise((done) => {
    let finallyCalled = false;
    new MyPromise((_, reject) => reject("raison"))
      .finally(() => {
        finallyCalled = true;
      })
      .catch((err) => {
        assert(
          finallyCalled && err === "raison",
          "Test 10 : .finally() appelé sur rejet",
          "finally() sur un rejet doit appeler onFinally() puis relancer l'erreur avec throw reason."
        );
        done();
      });
  });

  console.log("\n--- Tests des méthodes statiques ---\n");

  // Test 11 : MyPromise.resolve()
  await new Promise((done) => {
    MyPromise.resolve(99).then((val) => {
      assert(val === 99, "Test 11 : MyPromise.resolve(99)", "MyPromise.resolve(value) doit retourner new MyPromise(resolve => resolve(value)).");
      done();
    });
  });

  // Test 12 : MyPromise.reject()
  await new Promise((done) => {
    MyPromise.reject("nope").catch((err) => {
      assert(err === "nope", "Test 12 : MyPromise.reject('nope')", "MyPromise.reject(reason) doit retourner new MyPromise((_, reject) => reject(reason)).");
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
        "Test 13 : MyPromise.all([1, 2, 3])",
        "MyPromise.all() doit stocker chaque résultat à l'INDEX correct, pas dans l'ordre d'arrivée."
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
      assert(err === "fail", "Test 14 : MyPromise.all() avec un rejet", "MyPromise.all() doit rejeter dès la première Promise rejetée.");
      done();
    });
  });

  // Test 15 : MyPromise.all() — tableau vide
  await new Promise((done) => {
    MyPromise.all([]).then((results) => {
      assert(
        JSON.stringify(results) === "[]",
        "Test 15 : MyPromise.all([]) -> tableau vide",
        "MyPromise.all([]) avec un tableau vide doit résoudre immédiatement avec []."
      );
      done();
    });
  });

  // Test 16 : MyPromise.race() — la première gagne
  await new Promise((done) => {
    MyPromise.race([
      new MyPromise((resolve) => setTimeout(() => resolve("lent"), 50)),
      new MyPromise((resolve) => setTimeout(() => resolve("rapide"), 10)),
    ]).then((val) => {
      assert(val === "rapide", "Test 16 : MyPromise.race() — le plus rapide gagne", "MyPromise.race() doit attacher .then(resolve, reject) à chaque Promise.");
      done();
    });
  });

  // Test 17 : Les callbacks sont asynchrones (microtask)
  await new Promise((done) => {
    let syncCheck = "avant";
    MyPromise.resolve("ok").then(() => {
      assert(
        syncCheck === "apres",
        "Test 17 : Les callbacks sont asynchrones (programmés en microtask)",
        "Les callbacks doivent être programmés avec queueMicrotask() dans _processCallbacks, jamais appelés synchronement."
      );
      done();
    });
    syncCheck = "apres"; // Si le callback était synchrone, ce serait encore "avant"
  });

  // Test 18 : Résolution avec un thenable (pas une MyPromise)
  await new Promise((done) => {
    const thenable = {
      then(onFulfilled) {
        onFulfilled(777);
      },
    };
    MyPromise.resolve(thenable).then((val) => {
      assert(val === 777, "Test 18 : Assimilation de thenable", "Dans resolve(), détectez les thenables avec typeof value?.then === 'function' et appelez value.then(resolve, reject).");
      done();
    });
  });

  // Test 19 : resolve(resolve(resolve(42))) — résolution imbriquée
  await new Promise((done) => {
    new MyPromise((resolve) =>
      resolve(new MyPromise((r) => r(new MyPromise((r2) => r2(42)))))
    ).then((val) => {
      assert(val === 42, "Test 19 : Résolution imbriquée triple", "resolve() est récursif : si value est une Promise qui se résout avec une autre Promise, continuez à déballer.");
      done();
    });
  });

  // Test 20 : Appels multiples de resolve — seul le premier compte
  await new Promise((done) => {
    new MyPromise((resolve, reject) => {
      resolve("premier");
      resolve("deuxieme");
      reject("troisieme");
    }).then((val) => {
      assert(val === "premier", "Test 20 : Seul le premier resolve/reject compte", "La garde if (this._state !== PENDING) return dans resolve/reject empêche les appels multiples.");
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

  console.log("\n=== Fin du Lab 05 ===");
}

runTests();
