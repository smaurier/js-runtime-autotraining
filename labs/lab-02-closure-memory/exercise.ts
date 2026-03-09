// =============================================================================
// Lab 02 — Closures et rétention mémoire
// =============================================================================
// Exécuter avec : node --import tsx/esm --expose-gc exercise.ts
// Le flag --expose-gc est REQUIS pour les parties 1, 2, et 4.
// =============================================================================

declare const gc: (() => void) | undefined;

console.log("=== Lab 02 : Closures et rétention mémoire ===\n");

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + " Mo";
}

function getHeapUsed(): number {
  return process.memoryUsage().heapUsed;
}

function forceGC(): void {
  if ((globalThis as any).gc) {
    (globalThis as any).gc();
  } else {
    console.warn(
      "  global.gc() indisponible. Lancez avec : node --import tsx/esm --expose-gc exercise.ts"
    );
  }
}

function separator(title: string): void {
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

function createHeavyClosures(count: number): (() => number)[] {
  // TODO : Créez un tableau `closures` vide.
  // Pour chaque itération de 0 à count-1 :
  //   1. Allouez un Buffer de 1 Mo : Buffer.alloc(1024 * 1024)
  //   2. Créez une closure qui capture ce buffer et retourne buffer.length
  //   3. Poussez la closure dans le tableau
  // Retournez le tableau de closures.

  const closures: (() => number)[] = [];

  // TODO : boucle qui crée count closures retenant chacune un Buffer de 1 Mo

  return closures;
}

forceGC();
const avantP1: number = getHeapUsed();

// TODO : Créez 100 closures lourdes en appelant createHeavyClosures(100)
//        et stockez le résultat dans une variable `heavyClosures`.

forceGC();
const apresP1: number = getHeapUsed();

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

function createLightClosures(count: number): (() => number)[] {
  // TODO : Même logique que createHeavyClosures, MAIS :
  //   1. Allouez le buffer
  //   2. Extrayez UNIQUEMENT la donnée dont vous avez besoin (ex: length)
  //      dans une variable locale AVANT de créer la closure
  //   3. La closure ne doit capturer QUE cette variable locale, pas le buffer
  //   4. Le buffer n'est plus référencé par la closure -> le GC peut le libérer

  const closures: (() => number)[] = [];

  // TODO : boucle qui crée count closures LÉGÈRES

  return closures;
}

forceGC();
const avantP2: number = getHeapUsed();

// TODO : Créez 100 closures légères en appelant createLightClosures(100)
//        et stockez le résultat dans une variable `lightClosures`.

forceGC();
const apresP2: number = getHeapUsed();

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

separator("PARTIE 3 — Capture de portée complète (contexte partagé V8)");

function scenarioA_captureDirecte(count: number): (() => number)[] {
  const closures: (() => number)[] = [];
  for (let i = 0; i < count; i++) {
    const buf: Buffer = Buffer.alloc(1024 * 1024); // 1 Mo
    // TODO : Créez une closure (fonction fléchée) qui retourne buf.length
    //        et poussez-la dans le tableau closures.
  }
  return closures;
}

function scenarioB_sansCapture(count: number): (() => number)[] {
  const closures: (() => number)[] = [];
  for (let i = 0; i < count; i++) {
    const buf: Buffer = Buffer.alloc(1024 * 1024);
    // TODO : Créez une closure qui retourne seulement `i` (pas buf)
    //        et poussez-la dans le tableau closures.
  }
  return closures;
}

function scenarioC_contextePartage(count: number): (() => number)[] {
  const closures: (() => number)[] = [];
  for (let i = 0; i < count; i++) {
    const buf: Buffer = Buffer.alloc(1024 * 1024);

    // TODO : Créez closureA qui utilise buf (mais ne la stockez PAS dans le tableau)

    // TODO : Créez closureB qui n'utilise PAS buf, seulement i

    // TODO : Stockez UNIQUEMENT closureB dans le tableau closures
    // TODO : Utilisez `void closureA;` pour empêcher le compilateur
    //        d'optimiser closureA (sinon V8 la supprimerait)
  }
  return closures;
}

// TODO : Mesurez les 3 scénarios en écrivant le code de mesure vous-même.

console.log();

// =============================================================================
// PARTIE 4 — Expérience WeakRef : observer la désallocation d'un objet
//            capturé par une closure
// =============================================================================

separator("PARTIE 4 — WeakRef et observation de la désallocation");

function weakRefExperiment(): void {
  // TODO — Étape 1 : Créez un gros objet (ex: { data: Buffer.alloc(10 * 1024 * 1024) })

  // TODO — Étape 2 : Créez une WeakRef pointant vers bigObject.

  // TODO — Étape 3 : Créez un FinalizationRegistry qui affiche un message
  //   quand l'objet est collecté. Enregistrez bigObject dedans.

  // TODO — Étape 4 : Affichez si weakRef.deref() retourne bien l'objet.

  // TODO — Étape 5 : Créez une closure (let closure = ...) qui capture bigObject.

  // TODO — Étape 6 : Mettez bigObject à null pour supprimer la référence forte.

  // TODO — Étape 7 : Appelez forceGC() et vérifiez weakRef.deref().

  // TODO — Étape 8 : Mettez la closure à null aussi, puis forceGC() et vérifiez.

  console.log("  TODO : Implémentez l'expérience WeakRef");
}

weakRefExperiment();

console.log();

// =============================================================================
// Garder les références pour éviter une collecte prématurée
// =============================================================================

console.log("\n=== Fin du Lab 02 ===");
