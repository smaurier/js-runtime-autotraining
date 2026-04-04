// =============================================================================
// Lab 06 — Async Patterns Comparison
// =============================================================================
// Exécuter avec : npx tsx exercise.ts
// =============================================================================

console.log("=== Lab 06 : Async Patterns Comparison ===\n");

// ---------------------------------------------------------------------------
// Simulateur de requêtes (fourni — ne pas modifier)
// ---------------------------------------------------------------------------

function simulateRequest(id, delay = 50) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve({ id, data: `Résultat-${id}`, duration: delay });
    }, delay);
  });
}

// Version callback du simulateur
function simulateRequestCb(id, delay, callback) {
  setTimeout(() => {
    callback(null, { id, data: `Résultat-${id}`, duration: delay });
  }, delay);
}

// Version qui peut échouer
function simulateRequestFailable(id, delay = 50, failRate = 0.5) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() < failRate) {
        reject(new Error(`Requête #${id} a échoué`));
      } else {
        resolve({ id, data: `Résultat-${id}` });
      }
    }, delay);
  });
}

function formatTime(ms) {
  return `${ms.toFixed(1)} ms`;
}

function separator(title: string): void {
  console.log("=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

// =============================================================================
// PARTIE 0 — Rappel JS : callbacks error-first et pont vers Promise
// =============================================================================

separator("PARTIE 0 — Callbacks Node.js");

function callbackSeries(ids, delay, done) {
  // TODO : Executez les requetes UNE PAR UNE en style callback.
  // Signature attendue : done(err, results)
  // Indice : utilisez une fonction interne next(index) ou de la recursion.
  // A chaque etape : appelez simulateRequestCb(ids[index], delay, callback)
  // Si erreur -> done(err)
  // Si fini -> done(null, results)

  done(null, []);
}

function promisifyRequest(id, delay) {
  // TODO : Transformez simulateRequestCb en Promise.
  // En cas d'erreur callback -> reject(err)
  // Sinon -> resolve(result)
  return Promise.resolve({ id, data: `TODO-${id}`, duration: delay });
}

async function testCallbackHelpers() {
  await new Promise((resolve, reject) => {
    callbackSeries([1, 2, 3], 10, (err, results) => {
      if (err) {
        reject(err);
        return;
      }

      console.log(
        `  callbackSeries -> ${results.length} resultats (attendu: 3)`,
      );
      resolve(undefined);
    });
  });

  const result = await promisifyRequest(99, 10);
  console.log(`  promisifyRequest -> id=${result.id} (attendu: 99)`);
}

// =============================================================================
// PARTIE 0 BIS — Rappel JS : this, call/apply/bind et finally
// =============================================================================

// JS-REPETITION: call_apply_bind,promise_finally,callback_error_first

separator("PARTIE 0 BIS — this / call / apply / bind");

function formatWithContext(this: { prefix: string }, value) {
  // TODO : retourner "<prefix>:<value>"
  // Exemple avec this={prefix:"ID"} et value=42 -> "ID:42"
  return "TODO";
}

async function withFinally(promise, onFinally) {
  // TODO : executer onFinally() dans tous les cas (succes ou erreur)
  // en utilisant Promise.finally
  return promise;
}

async function testThisAndFinally() {
  const ctx = { prefix: "ID" };
  const viaCall = formatWithContext.call(ctx, 42);
  const viaApply = formatWithContext.apply(ctx, [43]);
  const bound = formatWithContext.bind(ctx);
  const viaBind = bound(44);

  console.log(`  call  -> ${viaCall} (attendu: ID:42)`);
  console.log(`  apply -> ${viaApply} (attendu: ID:43)`);
  console.log(`  bind  -> ${viaBind} (attendu: ID:44)`);

  let finallyCount = 0;
  await withFinally(Promise.resolve("ok"), () => {
    finallyCount++;
  });
  await withFinally(
    Promise.reject(new Error("boom")).catch(() => "ignored"),
    () => {
      finallyCount++;
    },
  );
  console.log(`  finally executé ${finallyCount}x (attendu: 2)`);
}

// =============================================================================
// PARTIE 1 — Implémenter la même tâche en 4 styles asynchrones
// =============================================================================
// Traitez 10 requêtes (id 1 à 10, delay 30ms chacune).
// Mesurez le temps d'exécution pour chaque style.
// =============================================================================

separator("PARTIE 1 — 4 styles asynchrones");

const REQUEST_COUNT = 10;
const REQUEST_DELAY = 30;

// --- Style 1 : Callbacks (le plus ancien) ---

function style1_callbacks() {
  return new Promise((resolve) => {
    const start = performance.now();
    const results = [];
    let completed = 0;

    // TODO : Pour chaque requête de 1 à REQUEST_COUNT :
    //   Appelez simulateRequestCb(id, REQUEST_DELAY, (err, result) => { ... })
    //   Dans le callback :
    //     1. Stockez le résultat dans results
    //     2. Incrémentez completed
    //     3. Si completed === REQUEST_COUNT, calculez le temps total et résolvez
    //
    // Note : les callbacks s'exécutent en parallèle (tous les setTimeout
    // sont lancés immédiatement). C'est du parallèle "par accident".

    // TODO : Implémentez ici

    console.log("  [Callbacks] TODO : Implémentez style1_callbacks()");
    resolve({ time: 0, count: 0 });
  });
}

// --- Style 2 : Promises avec .then() (chaînage) ---

function style2_promisesThen() {
  const start = performance.now();

  // TODO : Créez une chaîne de .then() qui exécute les requêtes SÉQUENTIELLEMENT.
  //   Étapes :
  //   1. Créez une variable `chain` initialisée à Promise.resolve()
  //   2. Créez un tableau `results` vide
  //   3. Dans une boucle for (1 à REQUEST_COUNT), chaînez sur `chain` :
  //      chain = chain.then(() => simulateRequest(i, REQUEST_DELAY))
  //                    .then((result) => results.push(result))
  //   4. Retournez chain.then(() => ({ time: ..., count: results.length }))
  //
  // Note : c'est SÉQUENTIEL car chaque .then attend le précédent.
  // 💡 Indice : le chaînage `.then().then()` crée une file d'attente de promesses.
  //    Chaque requête attend que la précédente se termine.

  console.log("  [Promises .then] TODO : Implémentez style2_promisesThen()");
  return Promise.resolve({ time: 0, count: 0 });
}

// --- Style 3 : async/await séquentiel ---

async function style3_asyncAwaitSequential() {
  const start = performance.now();
  const results = [];

  // TODO : Boucle for de 1 à REQUEST_COUNT avec `await` à chaque itération.
  //   Pour chaque i :
  //   1. Attendez le résultat de simulateRequest(i, REQUEST_DELAY) avec await
  //   2. Poussez le résultat dans results
  //
  // C'est le style le plus lisible mais le plus LENT (séquentiel).
  // Temps attendu : REQUEST_COUNT * REQUEST_DELAY ms
  // 💡 Indice : `const result = await simulateRequest(i, REQUEST_DELAY)`
  //    bloque l'exécution jusqu'à ce que la promesse se résolve.

  console.log("  [async/await séq.] TODO : Implémentez style3");
  return { time: performance.now() - start, count: results.length };
}

// --- Style 4 : async/await parallèle ---

async function style4_asyncAwaitParallel() {
  const start = performance.now();

  // TODO : Lancez toutes les requêtes en parallèle avec Promise.all.
  //   Étapes :
  //   1. Créez un tableau `promises` vide
  //   2. Dans une boucle, poussez simulateRequest(i, REQUEST_DELAY) dans promises
  //      (SANS await — c'est la clé pour le parallélisme !)
  //   3. Attendez TOUS les résultats avec `await Promise.all(promises)`
  //
  // Temps attendu : ~REQUEST_DELAY ms (toutes en parallèle).
  // 💡 Indice : la différence avec le style 3 est que vous NE mettez PAS
  //    `await` dans la boucle. Toutes les promesses sont lancées d'abord,
  //    puis on attend qu'elles se terminent toutes avec Promise.all.

  console.log("  [async/await par.] TODO : Implémentez style4");
  return { time: performance.now() - start, count: 0 };
}

// =============================================================================
// PARTIE 2 — Limiteur de concurrence (pLimit)
// =============================================================================
// Implémentez pLimit(concurrency) qui limite le nombre de tâches
// asynchrones exécutées en parallèle.
//
// Usage :
//   const limit = pLimit(5); // max 5 tâches en parallèle
//   const results = await Promise.all(
//     tasks.map((task) => limit(() => task()))
//   );
// =============================================================================

separator("PARTIE 2 — Limiteur de concurrence (pLimit)");

function pLimit(concurrency) {
  // TODO : Implémentez le limiteur de concurrence.
  //
  // Variables internes nécessaires :
  //   - un compteur `activeCount` (initialement 0) pour suivre les tâches en cours
  //   - un tableau `queue` pour stocker les tâches en attente
  //
  // La fonction retournée `limit(fn)` doit :
  //   1. Retourner une Promise qui résoudra avec le résultat de fn()
  //   2. Si activeCount < concurrency : exécuter fn() immédiatement
  //   3. Sinon : mettre la tâche en file d'attente
  //   4. Quand une tâche se termine (dans le finally) :
  //      - décrémenter activeCount
  //      - lancer la prochaine tâche de la file si elle existe
  //
  // N'oubliez pas d'exposer :
  //   limit.activeCount = () => activeCount;
  //   limit.pendingCount = () => queue.length;
  //
  // 💡 Indice : créez une fonction interne `run` (async) qui :
  //    - incrémente activeCount
  //    - exécute fn() dans un try/catch
  //    - dans le finally : décrémente et dépile la queue
  //    Puis décidez si vous appelez run() tout de suite ou si vous
  //    le mettez dans la queue.

  return (fn) => {
    console.log("  [pLimit] TODO : Implémentez pLimit()");
    return fn();
  };
}

async function testPLimit() {
  const limit = pLimit(5); // Maximum 5 tâches en parallèle
  const taskCount = 20;
  const concurrencyLog = [];
  let maxConcurrency = 0;

  const start = performance.now();

  // Lancement de 20 tâches avec le limiteur
  const promises = [];
  for (let i = 1; i <= taskCount; i++) {
    promises.push(
      limit(async () => {
        // TODO : Tracez la concurrence réelle en utilisant limit.activeCount()
        //   1. Lisez le nombre de tâches en cours avec limit.activeCount()
        //   2. Mettez à jour maxConcurrency si nécessaire
        //   3. Ajoutez un log dans concurrencyLog
        // 💡 Indice : maxConcurrency = Math.max(maxConcurrency, limit.activeCount())

        return simulateRequest(i, 50);
      }),
    );
  }

  const results = await Promise.all(promises);
  const elapsed = performance.now() - start;

  console.log(
    `  ${results.length} tâches complétées en ${formatTime(elapsed)}`,
  );
  console.log(`  Concurrence maximale observée : ${maxConcurrency}`);
  // TODO : Vérifiez que maxConcurrency ne dépasse jamais 5.
  // Temps attendu : ~200 ms (20 tâches / 5 en parallèle * 50 ms)
}

// =============================================================================
// PARTIE 3 — Promise.allSettled from scratch
// =============================================================================
// Implémentez myAllSettled(promises) sans utiliser Promise.allSettled.
// Le résultat doit être un tableau de :
//   { status: "fulfilled", value: ... }
//   { status: "rejected", reason: ... }
// =============================================================================

separator("PARTIE 3 — Promise.allSettled from scratch");

function myAllSettled(promises) {
  // TODO : Implémentez sans utiliser Promise.allSettled.
  //
  // Stratégie : transformer chaque promesse pour qu'elle ne rejette JAMAIS.
  //   - En cas de succès : retourner { status: "fulfilled", value }
  //   - En cas d'échec  : retourner { status: "rejected", reason }
  // Puis utiliser Promise.all() sur les promesses transformées.
  //
  // Étapes :
  //   1. Convertissez le tableau en Array si nécessaire avec Array.from(promises)
  //   2. Mappez chaque promesse `p` vers une promesse qui ne rejette jamais :
  //      - Utilisez .then(successHandler, errorHandler) avec DEUX callbacks
  //   3. Retournez Promise.all() sur les promesses enveloppées
  //
  // 💡 Indice : .then() accepte un 2e argument pour gérer les rejections.
  //    En attrapant l'erreur dans le .then(), la promesse résulte toujours
  //    en succès (avec un objet { status, reason }).

  console.log("  [myAllSettled] TODO : Implémentez myAllSettled()");
  return Promise.resolve([]);
}

async function testMyAllSettled() {
  const promises = [
    simulateRequest(1, 10),
    simulateRequestFailable(2, 10, 1.0), // 100% d'échec
    simulateRequest(3, 10),
    simulateRequestFailable(4, 10, 1.0), // 100% d'échec
    simulateRequest(5, 10),
  ];

  const results = await myAllSettled(promises);

  console.log("  Résultats de myAllSettled :");
  for (const r of results) {
    if (r.status === "fulfilled") {
      console.log(`    [fulfilled] id=${r.value.id}`);
    } else {
      console.log(`    [rejected]  ${r.reason.message}`);
    }
  }

  // TODO : Vérifiez que les résultats sont identiques à la version native
  // const nativeResults = await Promise.allSettled(promises.map(p => ...));
  // Comparez les deux.

  // Vérification du nombre attendu
  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;
  console.log(`  Succès : ${fulfilled}, Échecs : ${rejected}`);
  console.log(
    `  Test : ${fulfilled === 3 && rejected === 2 ? "[OK]" : "[ERREUR]"}`,
  );
}

// =============================================================================
// PARTIE 4 — Comparaison de la gestion d'erreurs
// =============================================================================
// Le même scénario d'erreur est géré en 4 styles. Comparez la lisibilité.
// =============================================================================

separator("PARTIE 4 — Comparaison de la gestion d'erreurs");

// Fonction qui échoue systématiquement (pour le test)
function failingRequest(id) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Erreur critique sur #${id}`)), 10);
  });
}

function failingRequestCb(id, callback) {
  setTimeout(() => callback(new Error(`Erreur critique sur #${id}`), null), 10);
}

// --- Style A : Callback (err, result) ---

function errorStyle_callback() {
  return new Promise((resolve) => {
    // TODO : Appelez failingRequestCb(42, (err, result) => { ... })
    // Dans le callback :
    //   - Si err : loguez l'erreur et résolvez avec { style: "callback", error: err.message }
    //   - Sinon : résolvez avec { style: "callback", data: result }
    //
    // C'est le pattern Node.js classique "error-first callback".

    console.log("  [Callback] TODO : Implémentez la gestion d'erreur");
    resolve({ style: "callback", error: "TODO" });
  });
}

// --- Style B : Promise .catch() ---

function errorStyle_catch() {
  // TODO : Appelez failingRequest(42) et chaînez :
  //   - .then() pour transformer le succès en { style: ".catch()", data: result }
  //   - .catch() pour transformer l'erreur en { style: ".catch()", error: err.message }
  // 💡 Indice : .catch(err => ...) attrape les rejections de la promesse

  console.log("  [.catch()] TODO : Implémentez la gestion d'erreur");
  return Promise.resolve({ style: ".catch()", error: "TODO" });
}

// --- Style C : try/catch avec async/await ---

async function errorStyle_tryCatch() {
  // TODO : Utilisez try/catch avec await pour gérer l'erreur.
  //   - Dans le try : attendez failingRequest(42) et retournez le résultat
  //   - Dans le catch : retournez l'erreur avec err.message
  // 💡 Indice : `await` dans un `try` permet d'attraper les rejections
  //    de promesse comme des exceptions synchrones.

  console.log("  [try/catch] TODO : Implémentez la gestion d'erreur");
  return { style: "try/catch", error: "TODO" };
}

// --- Style D : Go-style [err, result] ---

// TODO : Implémentez la fonction helper goStyle(promise)
// qui retourne toujours un tuple [err, result] :
//   - Si la promesse réussit : [null, result]
//   - Si la promesse échoue  : [err, null]
//
// 💡 Indice : utilisez .then() et .catch() pour transformer la promesse
//    en un tableau de 2 éléments. Le pattern Go force le développeur
//    à TOUJOURS vérifier l'erreur avant d'utiliser le résultat.

async function errorStyle_goPattern() {
  // TODO : Utilisez la fonction goStyle() (que vous venez de créer ci-dessus)
  //   pour obtenir un tuple [err, result].
  //   Déstructurez-le : const [err, result] = await goStyle(...)
  //   Si err existe, retournez l'erreur. Sinon, retournez les données.
  // 💡 Indice : la déstructuration `const [a, b] = tableau` extrait
  //    les 2 premiers éléments du tableau.

  console.log("  [Go-style] TODO : Implémentez la gestion d'erreur");
  return { style: "go-style", error: "TODO" };
}

async function testErrorStyles() {
  const results = await Promise.all([
    errorStyle_callback(),
    errorStyle_catch(),
    errorStyle_tryCatch(),
    errorStyle_goPattern(),
  ]);

  console.log("\n  Résultats de la gestion d'erreurs :");
  for (const r of results) {
    console.log(`    ${r.style.padEnd(12)} : erreur = "${r.error}"`);
  }

  // TODO : Ajoutez un tableau comparatif des avantages/inconvénients de chaque style.
  //   Affichez un résumé avec console.log pour chacun des 4 styles.
  //   Quels sont les forces et faiblesses de chaque approche ?
  // 💡 Indice : pensez à la lisibilité, au risque d'oublier la gestion d'erreur,
  //    et à la compatibilité avec le chaînage de promesses.
}

// =============================================================================
// Exécution
// =============================================================================

async function main() {
  console.log("--- Partie 0 : callbacks Node.js ---\n");
  await testCallbackHelpers();
  console.log();

  console.log("--- Partie 0 bis : this/call/apply/bind/finally ---\n");
  await testThisAndFinally();
  console.log();

  console.log("\n--- Partie 1 : 4 styles asynchrones ---\n");

  const [r1, r2, r3, r4] = await Promise.all([
    style1_callbacks(),
    style2_promisesThen(),
    style3_asyncAwaitSequential(),
    style4_asyncAwaitParallel(),
  ]);

  console.log("\n  Récapitulatif des temps :");
  console.log(
    `    Callbacks          : ${formatTime(r1.time)} (${r1.count} résultats)`,
  );
  console.log(
    `    Promises .then()   : ${formatTime(r2.time)} (${r2.count} résultats)`,
  );
  console.log(
    `    async/await séq.   : ${formatTime(r3.time)} (${r3.count} résultats)`,
  );
  console.log(
    `    async/await par.   : ${formatTime(r4.time)} (${r4.count} résultats)`,
  );
  console.log();

  console.log("--- Partie 2 : pLimit ---\n");
  await testPLimit();
  console.log();

  console.log("--- Partie 3 : myAllSettled ---\n");
  await testMyAllSettled();
  console.log();

  console.log("--- Partie 4 : Gestion d'erreurs ---\n");
  await testErrorStyles();

  console.log("\n=== Fin du Lab 06 ===");
}

main();
