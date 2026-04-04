// =============================================================================
// Lab 06 — Async Patterns Comparison — SOLUTION
// =============================================================================
// Exécuter avec : npx tsx solution.ts
// =============================================================================

console.log("=== Lab 06 : Async Patterns Comparison — SOLUTION ===\n");

// ---------------------------------------------------------------------------
// Simulateur de requêtes (fourni)
// ---------------------------------------------------------------------------

function simulateRequest(id, delay = 50) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ id, data: `Résultat-${id}`, duration: delay });
    }, delay);
  });
}

function simulateRequestCb(id, delay, callback) {
  setTimeout(() => {
    callback(null, { id, data: `Résultat-${id}`, duration: delay });
  }, delay);
}

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
  console.log("\n" + "=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70) + "\n");
}

// =============================================================================
// PARTIE 0 — Rappel JS : callbacks error-first et pont vers Promise
// =============================================================================

separator("PARTIE 0 — Callbacks Node.js");

function callbackSeries(ids, delay, done) {
  const results = [];

  function next(index) {
    if (index >= ids.length) {
      done(null, results);
      return;
    }

    simulateRequestCb(ids[index], delay, (err, result) => {
      if (err) {
        done(err);
        return;
      }

      results.push(result);
      next(index + 1);
    });
  }

  next(0);
}

function promisifyRequest(id, delay) {
  return new Promise((resolve, reject) => {
    simulateRequestCb(id, delay, (err, result) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result);
    });
  });
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

separator("PARTIE 0 BIS — this / call / apply / bind");

function formatWithContext(this: { prefix: string }, value) {
  return `${this.prefix}:${value}`;
}

async function withFinally(promise, onFinally) {
  return promise.finally(onFinally);
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

separator("PARTIE 1 — 4 styles asynchrones");

const REQUEST_COUNT = 10;
const REQUEST_DELAY = 30;

// --- Style 1 : Callbacks ---
// POURQUOI c'est parallèle « par accident » :
// On lance N appels à simulateRequestCb dans une boucle synchrone.
// Chaque appel programme un setTimeout. Tous les timeouts démarrent
// quasi-simultanément. Les callbacks arrivent donc en parallèle.
// Le temps total est ~REQUEST_DELAY ms (pas N * REQUEST_DELAY).
//
// C'est historiquement le premier pattern async de Node.js.
// Problème principal : « callback hell » quand les opérations sont imbriquées.

function style1_callbacks() {
  return new Promise((resolve) => {
    const start = performance.now();
    const results = [];
    let completed = 0;

    for (let i = 1; i <= REQUEST_COUNT; i++) {
      simulateRequestCb(i, REQUEST_DELAY, (err, result) => {
        if (err) return; // Gestion d'erreur minimale ici
        results.push(result);
        completed++;

        // Quand toutes les requêtes sont terminées
        if (completed === REQUEST_COUNT) {
          resolve({ time: performance.now() - start, count: results.length });
        }
      });
    }
  });
}

// --- Style 2 : Promises avec .then() (chaînage séquentiel) ---
// POURQUOI c'est séquentiel :
// Chaque .then() crée un maillon dans une chaîne. Le maillon suivant
// ne démarre que quand le précédent est résolu. C'est le mécanisme
// fondamental du chaînage de Promises.
//
// Temps total : N * REQUEST_DELAY ms (chaque requête attend la précédente).
// C'est plus propre que les callbacks imbriqués, mais tout aussi lent
// que la version séquentielle avec await.

function style2_promisesThen() {
  const start = performance.now();
  let chain = Promise.resolve();
  const results = [];

  for (let i = 1; i <= REQUEST_COUNT; i++) {
    // Chaque itération AJOUTE un maillon à la chaîne.
    // Le .then(() => simulateRequest(...)) ne s'exécute que quand
    // le maillon précédent est résolu.
    chain = chain
      .then(() => simulateRequest(i, REQUEST_DELAY))
      .then((result) => results.push(result));
  }

  return chain.then(() => ({
    time: performance.now() - start,
    count: results.length,
  }));
}

// --- Style 3 : async/await séquentiel ---
// POURQUOI c'est le plus lisible :
// Le code ressemble à du code synchrone. Chaque `await` suspend la
// fonction jusqu'à la résolution de la promesse, puis reprend.
// Le flux de contrôle est linéaire et facile à suivre.
//
// En coulisses, c'est exactement le même mécanisme que le chaînage
// .then() de style 2. Le compilateur transforme le await en .then().
// Temps total : identique à style 2 (N * REQUEST_DELAY).

async function style3_asyncAwaitSequential() {
  const start = performance.now();
  const results = [];

  for (let i = 1; i <= REQUEST_COUNT; i++) {
    // `await` suspend cette fonction à chaque itération.
    // La boucle avance d'un pas seulement quand la requête est terminée.
    const result = await simulateRequest(i, REQUEST_DELAY);
    results.push(result);
  }

  return { time: performance.now() - start, count: results.length };
}

// --- Style 4 : async/await parallèle ---
// POURQUOI c'est le plus rapide :
// On crée d'abord TOUTES les Promises (sans await), ce qui lance
// toutes les requêtes simultanément. Puis on attend TOUTES les
// résolutions avec Promise.all.
//
// La clé : NE PAS mettre await dans la boucle de création.
// Le await est seulement sur Promise.all, qui attend le groupe entier.
// Temps total : ~REQUEST_DELAY ms (temps de la requête la plus lente).

async function style4_asyncAwaitParallel() {
  const start = performance.now();

  // Pas de await ici ! On crée les Promises en synchrone.
  const promises = [];
  for (let i = 1; i <= REQUEST_COUNT; i++) {
    promises.push(simulateRequest(i, REQUEST_DELAY));
  }

  // Un seul await pour tout le groupe
  const results = await Promise.all(promises);

  return { time: performance.now() - start, count: results.length };
}

// =============================================================================
// PARTIE 2 — Limiteur de concurrence (pLimit)
// =============================================================================
// POURQUOI on a besoin d'un limiteur :
// Promise.all lance TOUT en parallèle. Avec 10 000 requêtes, cela signifie
// 10 000 connexions réseau simultanées, ce qui peut :
//   - Saturer le serveur distant (rate limiting, 429 Too Many Requests)
//   - Épuiser les file descriptors du système (EMFILE)
//   - Consommer trop de mémoire (buffers de réponse)
//
// pLimit résout ce problème en maintenant une file d'attente interne.
// Au maximum `concurrency` tâches s'exécutent en parallèle.
// Quand une tâche se termine, la suivante est lancée automatiquement.
//
// C'est le pattern utilisé par le package npm `p-limit` (> 100M dl/semaine).
// =============================================================================

separator("PARTIE 2 — Limiteur de concurrence (pLimit)");

function pLimit(concurrency) {
  let activeCount = 0; // Tâches en cours d'exécution
  const queue = []; // File d'attente des tâches en attente

  // La fonction retournée par pLimit
  function limit(fn) {
    return new Promise((resolve, reject) => {
      // Wrapper qui exécute fn() et gère la concurrence
      const run = async () => {
        activeCount++;
        try {
          // Exécuter la tâche et résoudre la Promise externe
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          // Toujours décrémenter, même en cas d'erreur
          activeCount--;

          // S'il y a des tâches en attente, lancer la prochaine
          // C'est le cœur du mécanisme : le FIFO garantit l'équité
          if (queue.length > 0) {
            const next = queue.shift();
            next();
          }
        }
      };

      // Si on n'a pas atteint la limite, exécuter immédiatement
      if (activeCount < concurrency) {
        run();
      } else {
        // Sinon, mettre en file d'attente
        queue.push(run);
      }
    });
  }

  // Méthodes utilitaires pour le diagnostic
  limit.activeCount = () => activeCount;
  limit.pendingCount = () => queue.length;

  return limit;
}

async function testPLimit() {
  const limit = pLimit(5);
  const taskCount = 20;
  const concurrencyLog = [];
  let maxConcurrency = 0;

  const start = performance.now();

  const promises = [];
  for (let i = 1; i <= taskCount; i++) {
    promises.push(
      limit(async () => {
        // Tracer la concurrence réelle
        const current = limit.activeCount();
        if (current > maxConcurrency) maxConcurrency = current;
        concurrencyLog.push({ task: i, concurrent: current });

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
  console.log(
    `  Test concurrence <= 5 : ${maxConcurrency <= 5 ? "[OK]" : "[ERREUR]"}`,
  );
  console.log(
    `  Temps attendu : ~${Math.ceil(taskCount / 5) * 50} ms (${taskCount} tâches / 5 slots * 50 ms)`,
  );
}

// =============================================================================
// PARTIE 3 — Promise.allSettled from scratch
// =============================================================================
// POURQUOI on ne peut pas simplement utiliser Promise.all :
// Promise.all rejette AU PREMIER ÉCHEC et PERD tous les résultats.
// Promise.allSettled attend TOUTES les promesses et retourne le résultat
// de chacune, qu'elle ait réussi ou échoué.
//
// L'astuce d'implémentation : transformer chaque promesse pour qu'elle
// ne rejette JAMAIS. On wrappe chaque promesse dans un .then/.catch qui
// retourne toujours un objet { status, value/reason }. Puis on utilise
// Promise.all sur les promesses wrappées (qui ne rejettent jamais).
//
// C'est exactement comme ça que le polyfill officiel fonctionne.
// =============================================================================

separator("PARTIE 3 — Promise.allSettled from scratch");

function myAllSettled(promises) {
  // Convertir l'itérable en tableau (pour supporter Set, Map, etc.)
  const promiseArray = Array.from(promises);

  // Wrapper chaque promesse pour qu'elle ne rejette jamais
  const wrapped = promiseArray.map((p) =>
    // Promise.resolve(p) gère le cas où p n'est pas une Promise (ex: une valeur)
    Promise.resolve(p).then(
      // Cas succès : emballer dans { status: "fulfilled", value }
      (value) => ({ status: "fulfilled", value }),
      // Cas échec : emballer dans { status: "rejected", reason }
      // Le .catch transforme le rejet en résolution -> Promise.all ne rejette jamais
      (reason) => ({ status: "rejected", reason }),
    ),
  );

  // Promise.all attend toutes les promesses wrappées.
  // Comme aucune ne peut rejeter, Promise.all résout toujours.
  return Promise.all(wrapped);
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

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;
  console.log(`  Succès : ${fulfilled}, Échecs : ${rejected}`);
  console.log(
    `  Test : ${fulfilled === 3 && rejected === 2 ? "[OK]" : "[ERREUR]"}`,
  );

  // Vérification de la conformité avec la version native
  const nativePromises = [
    simulateRequest(1, 10),
    simulateRequestFailable(2, 10, 1.0),
    simulateRequest(3, 10),
    simulateRequestFailable(4, 10, 1.0),
    simulateRequest(5, 10),
  ];
  const nativeResults = await Promise.allSettled(nativePromises);
  const nativeFulfilled = nativeResults.filter(
    (r) => r.status === "fulfilled",
  ).length;
  const nativeRejected = nativeResults.filter(
    (r) => r.status === "rejected",
  ).length;
  console.log(`  Natif  : ${nativeFulfilled} succès, ${nativeRejected} échecs`);
  console.log(
    `  Structure identique : ${fulfilled === nativeFulfilled && rejected === nativeRejected ? "[OK]" : "[ERREUR]"}`,
  );
}

// =============================================================================
// PARTIE 4 — Comparaison de la gestion d'erreurs
// =============================================================================
// POURQUOI comparer les styles d'erreur :
// La gestion d'erreurs asynchrone est la source #1 de bugs en JavaScript.
// Chaque style a ses pièges :
//   - Callback : l'erreur peut être ignorée si on oublie de vérifier `err`
//   - .catch()  : l'erreur est silencieuse si on oublie le .catch()
//   - try/catch : le try doit englober TOUT le code qui peut échouer
//   - Go-style  : force le développeur à vérifier, mais verbose
// =============================================================================

separator("PARTIE 4 — Comparaison de la gestion d'erreurs");

function failingRequest(id) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Erreur critique sur #${id}`)), 10);
  });
}

function failingRequestCb(id, callback) {
  setTimeout(() => callback(new Error(`Erreur critique sur #${id}`), null), 10);
}

// --- Style A : Callback (err, result) ---
// Le pattern historique de Node.js. Le premier argument est toujours l'erreur.
// Problème : rien ne FORCE le développeur à vérifier err.
// Si on oublie if (err), l'erreur est silencieusement ignorée.

function errorStyle_callback() {
  return new Promise((resolve) => {
    failingRequestCb(42, (err, result) => {
      if (err) {
        resolve({ style: "callback", error: err.message });
        return;
      }
      resolve({ style: "callback", data: result });
    });
  });
}

// --- Style B : Promise .catch() ---
// Plus propre que les callbacks, mais les erreurs sont silencieuses
// si on oublie le .catch() à la fin de la chaîne.
// Node.js émet un warning « UnhandledPromiseRejection » dans ce cas.

function errorStyle_catch() {
  return failingRequest(42)
    .then((result) => ({ style: ".catch()", data: result }))
    .catch((err) => ({ style: ".catch()", error: err.message }));
}

// --- Style C : try/catch avec async/await ---
// Le plus lisible et le plus familier pour les développeurs.
// Le try doit englober tout le code qui peut lancer une exception,
// y compris les await. C'est le style recommandé en 2024+.

async function errorStyle_tryCatch() {
  try {
    const result = await failingRequest(42);
    return { style: "try/catch", data: result };
  } catch (err) {
    return { style: "try/catch", error: err.message };
  }
}

// --- Style D : Go-style [err, result] ---
// Inspiré du langage Go où chaque fonction retourne (result, err).
// La fonction helper `goStyle` transforme une Promise en tuple [err, result].
// Avantage : le développeur est FORCÉ de déstructurer et de vérifier err.
// Inconvénient : plus verbeux, pas idiomatique en JavaScript.

function goStyle(promise) {
  return promise.then((result) => [null, result]).catch((err) => [err, null]);
}

async function errorStyle_goPattern() {
  const [err, result] = await goStyle(failingRequest(42));
  if (err) {
    return { style: "go-style", error: err.message };
  }
  return { style: "go-style", data: result };
}

async function testErrorStyles() {
  const results = await Promise.all([
    errorStyle_callback(),
    errorStyle_catch(),
    errorStyle_tryCatch(),
    errorStyle_goPattern(),
  ]);

  console.log("  Résultats de la gestion d'erreurs :");
  for (const r of results) {
    console.log(`    ${r.style.padEnd(12)} : erreur = "${r.error}"`);
  }

  // Vérification : tous doivent capturer la même erreur
  const allCaptured = results.every(
    (r) => r.error === "Erreur critique sur #42",
  );
  console.log(
    `\n  Toutes les erreurs capturées : ${allCaptured ? "[OK]" : "[ERREUR]"}`,
  );

  console.log("\n  Comparaison des styles :");
  console.log("  +-------------+-----------+--------------+--------------+");
  console.log("  | Style       | Lisible   | Force check  | Risque oubli |");
  console.log("  +-------------+-----------+--------------+--------------+");
  console.log("  | callback    | --        | Non          | Élevé        |");
  console.log("  | .catch()    | +         | Non          | Moyen        |");
  console.log("  | try/catch   | ++        | Non          | Faible       |");
  console.log("  | go-style    | +         | Oui          | Très faible  |");
  console.log("  +-------------+-----------+--------------+--------------+");
  console.log();
  console.log("  Recommandation :");
  console.log("  - Utilisez try/catch + async/await pour le code courant");
  console.log("  - Utilisez go-style pour les fonctions critiques où l'erreur");
  console.log("    ne doit JAMAIS être ignorée (ex: transactions, migrations)");
  console.log("  - Évitez les callbacks sauf pour la compatibilité legacy");
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

  console.log("--- Partie 1 : 4 styles asynchrones ---\n");

  // Note : style2 et style3 sont séquentiels, ils prennent plus longtemps.
  // On les exécute séquentiellement pour ne pas fausser les mesures.
  const r1 = await style1_callbacks();
  const r2 = await style2_promisesThen();
  const r3 = await style3_asyncAwaitSequential();
  const r4 = await style4_asyncAwaitParallel();

  console.log("\n  Récapitulatif des temps :");
  console.log(
    `    Callbacks          : ${formatTime(r1.time).padStart(10)} (${r1.count} résultats) — parallèle`,
  );
  console.log(
    `    Promises .then()   : ${formatTime(r2.time).padStart(10)} (${r2.count} résultats) — séquentiel`,
  );
  console.log(
    `    async/await séq.   : ${formatTime(r3.time).padStart(10)} (${r3.count} résultats) — séquentiel`,
  );
  console.log(
    `    async/await par.   : ${formatTime(r4.time).padStart(10)} (${r4.count} résultats) — parallèle`,
  );
  console.log();
  console.log("  Analyse :");
  console.log(
    `    - Callbacks et async/await parallèle : ~${REQUEST_DELAY} ms`,
  );
  console.log(
    `    - Promises .then() et async/await séquentiel : ~${REQUEST_COUNT * REQUEST_DELAY} ms`,
  );
  console.log(
    "    - Le style n'affecte pas la vitesse, c'est la STRATÉGIE (séq vs par) qui compte.",
  );

  console.log("\n--- Partie 2 : pLimit ---\n");
  await testPLimit();

  console.log("\n--- Partie 3 : myAllSettled ---\n");
  await testMyAllSettled();

  console.log("\n--- Partie 4 : Gestion d'erreurs ---\n");
  await testErrorStyles();

  console.log("\n=== Fin du Lab 06 — SOLUTION ===");
}

main();
