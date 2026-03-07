// =============================================================================
// Lab 02 — Closures et rétention mémoire
// =============================================================================
// Exécuter avec : node --expose-gc exercise.js
// Le flag --expose-gc est REQUIS pour les parties 1, 2, et 4.
// =============================================================================

console.log("=== Lab 02 : Closures et rétention mémoire ===\n");

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + " Mo";
}

function getHeapUsed() {
  return process.memoryUsage().heapUsed;
}

function forceGC() {
  if (global.gc) {
    global.gc();
  } else {
    console.warn(
      "  ⚠ global.gc() indisponible. Lancez avec : node --expose-gc exercise.js"
    );
  }
}

function separator(title) {
  console.log("=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

// =============================================================================
// PARTIE 1 — Closures qui retiennent volontairement de gros buffers
// =============================================================================
// Objectif : créer des closures qui capturent des Buffer de 1 Mo chacun,
// mesurer la consommation mémoire avant/après avec process.memoryUsage().
// =============================================================================

separator("PARTIE 1 — Rétention volontaire de gros buffers");

function createHeavyClosures(count) {
  // TODO : Créez un tableau `closures` vide.
  // Pour chaque itération de 0 à count-1 :
  //   1. Allouez un Buffer de 1 Mo : Buffer.alloc(1024 * 1024)
  //   2. Créez une closure qui capture ce buffer et retourne buffer.length
  //   3. Poussez la closure dans le tableau
  // Retournez le tableau de closures.

  const closures = [];

  // TODO : boucle qui crée count closures retenant chacune un Buffer de 1 Mo

  return closures;
}

forceGC();
const avantP1 = getHeapUsed();

// TODO : Créez 100 closures lourdes en appelant createHeavyClosures(100)
//        et stockez le résultat dans une variable `heavyClosures`.
// 💡 Indice : const heavyClosures = createHeavyClosures(100);

forceGC();
const apresP1 = getHeapUsed();

console.log(`Mémoire avant  : ${formatMB(avantP1)}`);
console.log(`Mémoire après  : ${formatMB(apresP1)}`);
console.log(`Delta          : ${formatMB(apresP1 - avantP1)}`);
console.log(`Attendu (~100 Mo) : chaque Buffer.alloc(1 Mo) * 100 closures`);
// TODO : Vérifiez que le delta est proche de 100 Mo. Expliquez pourquoi
//        les closures empêchent la libération des buffers.
console.log();

// =============================================================================
// PARTIE 2 — Corriger les closures pour libérer le buffer
// =============================================================================
// Objectif : conserver uniquement l'information nécessaire (la taille du buffer)
// sans retenir le buffer entier.
// =============================================================================

separator("PARTIE 2 — Libération du buffer, conservation de la donnée utile");

function createLightClosures(count) {
  // TODO : Même logique que createHeavyClosures, MAIS :
  //   1. Allouez le buffer
  //   2. Extrayez UNIQUEMENT la donnée dont vous avez besoin (ex: length)
  //      dans une variable locale AVANT de créer la closure
  //   3. La closure ne doit capturer QUE cette variable locale, pas le buffer
  //   4. Le buffer n'est plus référencé par la closure -> le GC peut le libérer
  //
  // Indice : stockez buffer.length dans une variable `len` puis créez
  //          la closure qui retourne `len`.

  const closures = [];

  // TODO : boucle qui crée count closures LÉGÈRES

  return closures;
}

forceGC();
const avantP2 = getHeapUsed();

// TODO : Créez 100 closures légères en appelant createLightClosures(100)
//        et stockez le résultat dans une variable `lightClosures`.
// 💡 Indice : const lightClosures = createLightClosures(100);

forceGC();
const apresP2 = getHeapUsed();

console.log(`Mémoire avant  : ${formatMB(avantP2)}`);
console.log(`Mémoire après  : ${formatMB(apresP2)}`);
console.log(`Delta          : ${formatMB(apresP2 - avantP2)}`);
console.log(`Attendu (~0 Mo) : le buffer n'est plus retenu par la closure`);
// TODO : Comparez avec la Partie 1. Le delta devrait être quasi nul.
console.log();

// =============================================================================
// PARTIE 3 — Les closures capturent la portée entière (pas juste les variables
//            utilisées) quand le contexte est partagé
// =============================================================================
// Objectif : démontrer que si DEUX closures sont créées dans la même portée,
// et que l'une capture une grosse donnée, l'autre la retient aussi
// indirectement via le contexte de closure partagé de V8.
// =============================================================================

separator("PARTIE 3 — Capture de portée complète (contexte partagé V8)");

function scenarioA_captureDirecte(count) {
  // Scénario A : une seule closure par portée, qui utilise le buffer.
  // -> Le buffer est retenu (comportement attendu).
  const closures = [];
  for (let i = 0; i < count; i++) {
    const buf = Buffer.alloc(1024 * 1024); // 1 Mo
    // TODO : Créez une closure (fonction fléchée) qui retourne buf.length
    //        et poussez-la dans le tableau closures.
    // 💡 Indice : closures.push(() => /* retourner la taille du buffer */)
  }
  return closures;
}

function scenarioB_sansCapture(count) {
  // Scénario B : une seule closure par portée, qui N'utilise PAS le buffer.
  // -> V8 optimise : le buffer n'est PAS capturé.
  const closures = [];
  for (let i = 0; i < count; i++) {
    const buf = Buffer.alloc(1024 * 1024);
    // TODO : Créez une closure qui retourne seulement `i` (pas buf)
    //        et poussez-la dans le tableau closures.
    // 💡 Indice : la closure ne doit PAS référencer `buf` du tout
  }
  return closures;
}

function scenarioC_contextePartage(count) {
  // Scénario C — LE PIÈGE : deux closures dans la même portée.
  // closureA utilise buf. closureB n'utilise PAS buf.
  // On ne STOCKE que closureB. Est-ce que buf est retenu quand même ?
  //
  // Réponse attendue : OUI, car V8 crée UN SEUL objet de contexte
  // (« closure context ») pour toutes les closures d'une portée.
  // Si l'une capture buf, le contexte le contient, et TOUTES les closures
  // qui partagent ce contexte le retiennent.

  const closures = [];
  for (let i = 0; i < count; i++) {
    const buf = Buffer.alloc(1024 * 1024);

    // TODO : Créez closureA qui utilise buf (mais ne la stockez PAS dans le tableau)
    // 💡 Indice : const closureA = () => /* utiliser buf.length */

    // TODO : Créez closureB qui n'utilise PAS buf, seulement i
    // 💡 Indice : const closureB = () => /* retourner i */

    // TODO : Stockez UNIQUEMENT closureB dans le tableau closures
    // TODO : Utilisez `void closureA;` pour empêcher le compilateur
    //        d'optimiser closureA (sinon V8 la supprimerait)
  }
  return closures;
}

// TODO : Mesurez les 3 scénarios en écrivant le code de mesure vous-même.
//
// Pour CHAQUE scénario (A, B, C) :
//   1. Appelez forceGC() pour nettoyer la mémoire
//   2. Capturez la mémoire AVANT avec getHeapUsed()
//   3. Créez 50 closures avec la fonction du scénario
//   4. Appelez forceGC() à nouveau
//   5. Capturez la mémoire APRÈS avec getHeapUsed()
//   6. Affichez le delta avec formatMB(apres - avant)
//
// 💡 Indice : le pattern est le même pour les 3 scénarios, seule la fonction change.
//    Scénario A → scenarioA_captureDirecte(50)
//    Scénario B → scenarioB_sansCapture(50)
//    Scénario C → scenarioC_contextePartage(50)
//
// Résultat attendu :
//   A : ~50 Mo (chaque closure retient son buffer)
//   B : ~0 Mo (V8 optimise, le buffer n'est pas capturé)
//   C : ~50 Mo (le contexte de closure partagé retient buf)

// TODO : Analysez les résultats.
//   - Scénario A : ~50 Mo (normal, chaque closure retient son buffer)
//   - Scénario B : ~0 Mo (V8 optimise, le buffer n'est pas capturé)
//   - Scénario C : ~50 Mo MALGRÉ le fait que closureB n'utilise pas buf !
//     C'est la preuve du contexte de closure partagé.
//
// Question bonus : comment corriger le scénario C pour que buf soit libéré ?
// Indice : séparer les closures dans des portées différentes (fonctions helper).

console.log();

// =============================================================================
// PARTIE 4 — Expérience WeakRef : observer la désallocation d'un objet
//            capturé par une closure
// =============================================================================
// Objectif : utiliser WeakRef pour observer quand le GC libère un objet.
// On crée un gros objet, on l'enveloppe dans un WeakRef, puis on supprime
// la référence forte. Après global.gc(), le WeakRef.deref() retourne undefined.
// =============================================================================

separator("PARTIE 4 — WeakRef et observation de la désallocation");

function weakRefExperiment() {
  // TODO — Étape 1 : Créez un gros objet (ex: { data: Buffer.alloc(10 * 1024 * 1024) })
  //                   et stockez-le dans une variable `bigObject` (utilisez `let`).
  // 💡 Indice : let bigObject = { data: Buffer.alloc(10 * 1024 * 1024) }

  // TODO — Étape 2 : Créez une WeakRef pointant vers bigObject.
  // 💡 Indice : new WeakRef(objet) crée une référence faible vers cet objet.

  // TODO — Étape 3 : Créez un FinalizationRegistry qui affiche un message
  //   quand l'objet est collecté. Enregistrez bigObject dedans.
  // 💡 Indice : new FinalizationRegistry((heldValue) => { console.log(...) })
  //             puis registry.register(objet, "étiquette")

  // TODO — Étape 4 : Affichez si weakRef.deref() retourne bien l'objet.
  //   Le deref() devrait retourner l'objet tant qu'il est encore vivant.

  // TODO — Étape 5 : Créez une closure (let closure = ...) qui capture bigObject.
  //   Vérifiez que weakRef.deref() retourne toujours l'objet (la closure le retient).

  // TODO — Étape 6 : Mettez bigObject à null pour supprimer la référence forte.
  //   Attention : la closure retient toujours l'objet ! Le GC ne pourra pas le collecter.

  // TODO — Étape 7 : Appelez forceGC() et vérifiez weakRef.deref().
  //   L'objet devrait ENCORE être vivant car la closure le retient.

  // TODO — Étape 8 : Mettez la closure à null aussi, puis forceGC() et vérifiez.
  //   Cette fois, le deref() devrait retourner undefined : l'objet a été collecté.

  console.log("  TODO : Implémentez l'expérience WeakRef");
}

weakRefExperiment();

// TODO : Expérience bonus — Créez un mini-cache basé sur WeakRef :
//   - Le cache stocke des WeakRef vers les objets
//   - Si l'objet a été collecté (deref() === undefined), le cache le recrée
//   - Mesurez la mémoire avant/après pour prouver que le GC peut libérer
//     les entrées du cache quand la mémoire est sous pression

console.log();

// =============================================================================
// Garder les références pour éviter une collecte prématurée
// =============================================================================
// TODO : Une fois vos parties implémentées, gardez les références vivantes
//        pour éviter que le GC ne les collecte avant la fin du programme.
//        Utilisez `void [heavyClosures, lightClosures, closuresA, closuresB, closuresC];`
// 💡 Indice : `void` évalue l'expression sans retourner de valeur, mais empêche
//             le moteur d'optimiser les variables comme "non utilisées".

console.log("\n=== Fin du Lab 02 ===");
