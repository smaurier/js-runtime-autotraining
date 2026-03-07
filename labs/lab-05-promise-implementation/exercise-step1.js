// =============================================================================
// Lab 05 — Implémenter une Promise — Étape 1 : Les bases
// =============================================================================
// Exécuter avec : node exercise-step1.js
// =============================================================================
//
// Dans cette première étape, vous implémentez uniquement :
//   - Le constructeur avec resolve (pas de reject)
//   - .then(onFulfilled) — sans onRejected
//   - MyPromise.resolve(value)
//
// 5 tests valident votre implémentation.
// =============================================================================

console.log("=== Lab 05 — Étape 1 : Les bases (5 tests) ===\n");

// Seuls deux états sont nécessaires pour cette étape
const PENDING = "pending";
const FULFILLED = "fulfilled";

class MyPromise {
  constructor(executor) {
    // TODO : Initialisez les propriétés de la Promise
    // - this._state : l'état courant (PENDING au départ)
    // - this._value : la valeur de résolution (undefined au départ)
    // - this._callbacks : file d'attente des callbacks .then() en attente
    //   Chaque entrée : { onFulfilled, resolve }

    this._state = PENDING;
    this._value = undefined;
    this._callbacks = [];

    // TODO : Définissez la fonction resolve locale
    // - resolve(value) : si l'état est PENDING, passe à FULFILLED et déclenche les callbacks
    //
    // Pour cette étape, PAS besoin de gérer les thenables ni le reject.

    const resolve = (value) => {
      // TODO : Implémentez resolve
      // 1. Si l'état n'est plus PENDING, ne rien faire (protection contre les appels multiples)
      // 2. Mettre à jour this._state à FULFILLED
      // 3. Mettre à jour this._value à value
      // 4. Traiter les callbacks en attente avec this._processCallbacks()
    };

    // Exécution de l'executor
    // Pour cette étape, on ne gère pas les exceptions dans l'executor
    executor(resolve);
  }

  /**
   * Méthode interne pour traiter les callbacks en attente.
   * Appelée quand la Promise est résolue (ou dans .then si déjà résolue).
   */
  _processCallbacks() {
    // TODO : Implémentez le traitement des callbacks
    // Pour chaque entrée dans this._callbacks :
    //   1. Programmez le traitement comme MICROTASK (queueMicrotask)
    //   2. Si onFulfilled est une fonction, appelez-la avec this._value
    //      et résolvez la Promise chaînée avec le résultat
    //   3. Si onFulfilled n'est pas une fonction, propagez this._value directement
    //
    // N'oubliez pas de vider this._callbacks !

    // 💡 Indice — pseudo-code :
    //
    //   const callbacks = this._callbacks;
    //   this._callbacks = [];
    //
    //   for (const cb of callbacks) {
    //     queueMicrotask(() => {
    //       if (typeof cb.onFulfilled === 'function') {
    //         const result = cb.onFulfilled(this._value);
    //         cb.resolve(result);
    //       } else {
    //         cb.resolve(this._value);
    //       }
    //     });
    //   }
  }

  /**
   * .then(onFulfilled)
   * Retourne une NOUVELLE MyPromise pour permettre le chaînage.
   *
   * Pour cette étape, on ne gère pas onRejected.
   */
  then(onFulfilled) {
    // TODO : Implémentez .then()
    // 1. Créez une nouvelle MyPromise dont l'executor capture resolve
    // 2. Ajoutez { onFulfilled, resolve } à this._callbacks
    // 3. Si la Promise est déjà résolue (pas PENDING), traitez immédiatement
    // 4. Retournez la nouvelle Promise

    // 💡 Indice — squelette :
    //
    //   let resolveNext;
    //   const nextPromise = new MyPromise((resolve) => {
    //     resolveNext = resolve;
    //   });
    //
    //   this._callbacks.push({
    //     onFulfilled,
    //     resolve: resolveNext,
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
   * MyPromise.resolve(value)
   * Retourne une Promise résolue avec la valeur donnée.
   * Si value est déjà une MyPromise, la retourne telle quelle.
   */
  static resolve(value) {
    // TODO : Implémentez MyPromise.resolve()
    // 1. Si value est déjà une instance de MyPromise, retournez-la directement
    // 2. Sinon, créez une nouvelle MyPromise qui résout immédiatement avec value
    //
    // 💡 Indice :
    //   if (value instanceof MyPromise) return value;
    //   return new MyPromise((resolve) => resolve(value));

    return new MyPromise(() => {}); // À remplacer
  }
}

// =============================================================================
// SUITE DE TESTS — 5 tests
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
  console.log("--- Tests Étape 1 ---\n");

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
    syncCheck = "apres"; // Si le callback était synchrone, ce serait encore "avant"
  });

  // Résumé
  console.log(`\n--- Résultat : ${passed}/${passed + failed} tests passés ---`);
  if (failed === 0) {
    console.log("Bravo ! L'étape 1 est complète. Passez à exercise-step2.js !");
  } else {
    console.log(`${failed} test(s) échoué(s). Continuez à déboguer !`);
  }

  console.log("\n=== Fin de l'Étape 1 ===");
}

runTests();
