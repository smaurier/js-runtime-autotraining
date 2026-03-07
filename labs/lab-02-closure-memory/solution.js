// =============================================================================
// Lab 02 — Closures et rétention mémoire — SOLUTION
// =============================================================================
// Exécuter avec : node --expose-gc solution.js
// Le flag --expose-gc est OBLIGATOIRE pour que global.gc() fonctionne.
// =============================================================================

console.log("=== Lab 02 : Closures et rétention mémoire — SOLUTION ===\n");

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
      "  ⚠ global.gc() indisponible. Lancez avec : node --expose-gc solution.js"
    );
  }
}

function separator(title) {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70) + "\n");
}

// =============================================================================
// PARTIE 1 — Closures qui retiennent volontairement de gros buffers
// =============================================================================
// POURQUOI ça consomme autant de mémoire :
// Chaque closure forme un lien invisible vers sa portée lexicale englobante.
// Quand cette portée contient une variable `buf` qui pointe vers un Buffer
// de 1 Mo, le GC ne peut PAS libérer ce buffer tant que la closure existe.
// C'est le mécanisme fondamental des closures en JavaScript : elles « ferment »
// sur leur environnement lexical, d'où le nom « closure ».
//
// Avec 100 closures retenant chacune 1 Mo, on s'attend à ~100 Mo de
// consommation supplémentaire. Le delta mesuré sera légèrement supérieur
// à cause des métadonnées (objets closure, contextes V8, etc.).
// =============================================================================

separator("PARTIE 1 — Rétention volontaire de gros buffers");

function createHeavyClosures(count) {
  const closures = [];
  for (let i = 0; i < count; i++) {
    // Buffer.alloc(1 Mo) crée un bloc de mémoire de 1 048 576 octets.
    // Contrairement à `new Array(n).fill(x)`, un Buffer est alloué
    // hors du tas V8 (mémoire « externe »), mais la référence Buffer
    // elle-même vit dans le tas et empêche la libération de la zone externe.
    const buf = Buffer.alloc(1024 * 1024);

    // La closure capture `buf` car elle y fait référence.
    // Tant que cette closure est accessible, buf ne sera pas collecté.
    const closure = () => buf.length;

    closures.push(closure);
  }
  return closures;
}

forceGC();
const avantP1 = getHeapUsed();

const heavyClosures = createHeavyClosures(100);

forceGC();
const apresP1 = getHeapUsed();

console.log(`Mémoire avant  : ${formatMB(avantP1)}`);
console.log(`Mémoire après  : ${formatMB(apresP1)}`);
console.log(`Delta          : ${formatMB(apresP1 - avantP1)}`);
console.log(`Attendu        : ~100 Mo (100 buffers de 1 Mo retenus par les closures)`);

// Vérification fonctionnelle
console.log(`Vérification   : heavyClosures[0]() = ${heavyClosures[0]()}`);
console.log();

// Note : Le delta réel dépend de l'implémentation de Buffer dans Node.js.
// Buffer.alloc utilise de la mémoire « externe » (hors tas V8), ce qui peut
// faire apparaître un delta heapUsed faible. Pour une mesure plus complète,
// on peut regarder process.memoryUsage().rss ou .external.
const mem = process.memoryUsage();
console.log(`  Détail mémoire complète :`);
console.log(`    heapUsed  : ${formatMB(mem.heapUsed)}`);
console.log(`    external  : ${formatMB(mem.external)}`);
console.log(`    rss       : ${formatMB(mem.rss)}`);

// =============================================================================
// PARTIE 2 — Corriger les closures pour libérer le buffer
// =============================================================================
// POURQUOI ça fonctionne :
// En extrayant la donnée utile (buffer.length) dans une variable primitive
// AVANT de créer la closure, on casse le lien entre la closure et le buffer.
// La closure ne capture que `len` (un nombre, 8 octets), pas le buffer
// entier (1 Mo). Le buffer n'est plus référencé par aucune closure,
// il devient éligible au garbage collection dès que la portée locale
// de la boucle se termine.
//
// C'est la technique standard pour éviter les fuites mémoire par closure :
// « extraire, ne pas capturer ».
// =============================================================================

separator("PARTIE 2 — Libération du buffer, conservation de la donnée utile");

function createLightClosures(count) {
  const closures = [];
  for (let i = 0; i < count; i++) {
    const buf = Buffer.alloc(1024 * 1024);

    // On extrait UNIQUEMENT la donnée nécessaire dans une variable primitive.
    // `len` est un nombre (8 octets en mémoire), pas une référence vers buf.
    const len = buf.length;

    // La closure capture `len`, PAS `buf`.
    // À la fin de cette itération, `buf` n'est plus référencé par personne,
    // le GC peut le libérer.
    const closure = () => len;

    closures.push(closure);
  }
  return closures;
}

forceGC();
const avantP2 = getHeapUsed();

const lightClosures = createLightClosures(100);

forceGC();
const apresP2 = getHeapUsed();

console.log(`Mémoire avant  : ${formatMB(avantP2)}`);
console.log(`Mémoire après  : ${formatMB(apresP2)}`);
console.log(`Delta          : ${formatMB(apresP2 - avantP2)}`);
console.log(`Attendu        : ~0 Mo (les buffers ont été libérés par le GC)`);
console.log(`Vérification   : lightClosures[0]() = ${lightClosures[0]()}`);
console.log();
console.log(`  Comparaison avec Partie 1 :`);
console.log(`    Heavy closures : ${formatMB(apresP1 - avantP1)}`);
console.log(`    Light closures : ${formatMB(apresP2 - avantP2)}`);
console.log(`    La différence prouve que la technique "extraire, ne pas capturer" fonctionne.`);

// =============================================================================
// PARTIE 3 — Les closures capturent la portée entière (contexte partagé V8)
// =============================================================================
// POURQUOI le scénario C retient le buffer alors que closureB ne l'utilise pas :
//
// V8 utilise un mécanisme de « closure context » (contexte de closure).
// Quand plusieurs closures sont créées dans la MÊME portée lexicale,
// V8 crée UN SEUL objet de contexte contenant TOUTES les variables
// capturées par AU MOINS UNE des closures de cette portée.
//
// Si closureA capture `buf` et closureB ne capture que `i`, V8 crée
// un contexte contenant { buf, i }. Les DEUX closures reçoivent une
// référence vers ce contexte partagé. Résultat : même si on ne garde
// que closureB, elle retient le contexte qui contient buf.
//
// C'est un compromis d'implémentation de V8 : créer un contexte séparé
// par closure serait plus coûteux en termes de performance de création.
// =============================================================================

separator("PARTIE 3 — Capture de portée complète (contexte partagé V8)");

function scenarioA_captureDirecte(count) {
  // Cas simple : la closure utilise directement buf.
  // buf est retenu -> consommation élevée.
  const closures = [];
  for (let i = 0; i < count; i++) {
    const buf = Buffer.alloc(1024 * 1024);
    closures.push(() => buf.length);
  }
  return closures;
}

function scenarioB_sansCapture(count) {
  // Cas optimisé : la closure n'utilise PAS buf.
  // V8 détecte que buf n'est référencé par aucune closure -> il ne le met
  // pas dans le contexte de closure -> buf est collecté.
  const closures = [];
  for (let i = 0; i < count; i++) {
    const buf = Buffer.alloc(1024 * 1024);
    // Seul `i` est capturé. buf n'apparaît dans aucune closure de cette portée.
    closures.push(() => i);
  }
  return closures;
}

function scenarioC_contextePartage(count) {
  // LE PIÈGE : deux closures dans la même portée.
  // closureA capture buf, closureB ne capture que i.
  // On ne garde QUE closureB... mais buf est retenu quand même !
  const closures = [];
  for (let i = 0; i < count; i++) {
    const buf = Buffer.alloc(1024 * 1024);

    // closureA référence buf -> buf est ajouté au contexte partagé
    const closureA = () => buf.length;

    // closureB ne référence PAS buf, seulement i
    // MAIS elle partage le même contexte que closureA
    const closureB = () => i;

    // On ne stocke que closureB, closureA sera collectée...
    // MAIS le contexte partagé survit car closureB le référence.
    closures.push(closureB);

    // Empêcher V8 d'optimiser closureA comme « dead code »
    void closureA;
  }
  return closures;
}

// BONUS — Scénario D : correction du piège avec des fonctions helper
function scenarioD_corrige(count) {
  // On sépare les closures dans des portées différentes en utilisant
  // des fonctions helper. Chaque helper crée sa propre portée,
  // donc ses closures ont leur propre contexte.
  const closures = [];

  // Helper dans une portée SÉPARÉE : ne voit pas buf
  function createSafeClosure(index) {
    return () => index;
  }

  for (let i = 0; i < count; i++) {
    const buf = Buffer.alloc(1024 * 1024);

    // closureA est dans la portée du for, elle capture buf
    const closureA = () => buf.length;

    // closureB est créée dans la portée de createSafeClosure,
    // elle n'a AUCUN accès à buf -> buf n'est pas retenu
    const closureB = createSafeClosure(i);

    closures.push(closureB);
    void closureA;
  }
  return closures;
}

forceGC();
const avantA = getHeapUsed();
const closuresA = scenarioA_captureDirecte(50);
forceGC();
const apresA = getHeapUsed();
console.log(`Scénario A (capture directe)   : ${formatMB(apresA - avantA)}`);

forceGC();
const avantB = getHeapUsed();
const closuresB = scenarioB_sansCapture(50);
forceGC();
const apresB = getHeapUsed();
console.log(`Scénario B (sans capture)      : ${formatMB(apresB - avantB)}`);

forceGC();
const avantC = getHeapUsed();
const closuresC = scenarioC_contextePartage(50);
forceGC();
const apresC = getHeapUsed();
console.log(`Scénario C (contexte partagé)  : ${formatMB(apresC - avantC)}`);

forceGC();
const avantD = getHeapUsed();
const closuresD = scenarioD_corrige(50);
forceGC();
const apresD = getHeapUsed();
console.log(`Scénario D (corrigé — helper)  : ${formatMB(apresD - avantD)}`);

console.log();
console.log("  Analyse :");
console.log("  - A (~50 Mo)  : normal, chaque closure retient son buffer.");
console.log("  - B (~0 Mo)   : V8 optimise, buf n'est capturé par personne.");
console.log("  - C (~50 Mo)  : PIÈGE ! closureB retient buf via le contexte partagé.");
console.log("  - D (~0 Mo)   : CORRIGÉ ! closureB est dans une portée séparée.");
console.log();
console.log("  Leçon clé : ne JAMAIS créer dans la même portée une closure qui");
console.log("  capture une grosse donnée et une closure longue durée qui n'en a");
console.log("  pas besoin. Utilisez des fonctions helper pour séparer les contextes.");

// Garder les références vivantes
void [closuresA, closuresB, closuresC, closuresD];

// =============================================================================
// PARTIE 4 — WeakRef : observer la désallocation par le GC
// =============================================================================
// POURQUOI WeakRef est utile ici :
// Une WeakRef permet de pointer vers un objet SANS empêcher le GC de le
// collecter. Si l'objet n'a plus de référence « forte » (variable, propriété,
// closure...), le GC peut le libérer, et weakRef.deref() retourne undefined.
//
// Combiné avec FinalizationRegistry, on peut être NOTIFIÉ quand le GC
// libère un objet. C'est un outil puissant pour observer le comportement
// du garbage collector en temps réel.
//
// Attention : FinalizationRegistry n'offre AUCUNE garantie de timing.
// Le callback peut être appelé immédiatement après le GC, ou beaucoup
// plus tard, ou jamais (si le programme se termine avant). C'est un
// outil de diagnostic, pas de logique métier.
// =============================================================================

separator("PARTIE 4 — WeakRef et observation de la désallocation");

function weakRefExperiment() {
  // Étape 1 : Créer un gros objet (10 Mo)
  let bigObject = { data: Buffer.alloc(10 * 1024 * 1024), label: "BigObject" };

  // Étape 2 : Créer une WeakRef vers l'objet
  // La WeakRef ne constitue PAS une référence forte : elle n'empêche pas
  // le GC de collecter bigObject si toutes les références fortes disparaissent.
  const weakRef = new WeakRef(bigObject);

  // Étape 3 : FinalizationRegistry pour être notifié de la collection
  // Le callback reçoit la valeur « held » (ici, la chaîne "bigObject").
  // Il sera appelé APRÈS que le GC a libéré l'objet.
  const registry = new FinalizationRegistry((heldValue) => {
    console.log(`  [FinalizationRegistry] L'objet "${heldValue}" a été collecté par le GC !`);
  });
  registry.register(bigObject, "bigObject");

  // Étape 4 : Vérifier que deref() fonctionne
  console.log(`  Avant toute suppression :`);
  console.log(`    weakRef.deref() existe ? ${weakRef.deref() !== undefined}`); // true

  // Étape 5 : Créer une closure qui capture bigObject
  let closure = () => bigObject.data.length;
  console.log(`  Closure créée, elle retient bigObject.`);
  console.log(`    closure() = ${closure()}`); // 10485760

  // Étape 6 : Supprimer la référence forte, mais PAS la closure
  bigObject = null;
  forceGC();
  console.log(`\n  Après bigObject = null + GC (closure encore vivante) :`);
  console.log(`    weakRef.deref() existe ? ${weakRef.deref() !== undefined}`);
  // true ! La closure retient bigObject via sa portée lexicale.
  // Même si la variable `bigObject` vaut null, la closure a capturé
  // l'OBJET (pas la variable), et il reste accessible via la closure.

  // Étape 7 : Supprimer la closure aussi
  closure = null;
  forceGC();
  console.log(`\n  Après closure = null + GC (plus aucune référence forte) :`);
  console.log(`    weakRef.deref() existe ? ${weakRef.deref() !== undefined}`);
  // false (ou true si le GC n'a pas encore collecté — c'est non déterministe)

  // Étape 8 : Mesurer la mémoire pour confirmer la libération
  const memApres = process.memoryUsage();
  console.log(`\n  Mémoire après libération :`);
  console.log(`    heapUsed : ${formatMB(memApres.heapUsed)}`);
  console.log(`    external : ${formatMB(memApres.external)}`);

  // Note : le FinalizationRegistry callback sera appelé de manière asynchrone,
  // possiblement après la fin de cette fonction.
}

weakRefExperiment();

// Attendre un peu pour laisser le FinalizationRegistry s'exécuter
setTimeout(() => {
  // Un GC supplémentaire pour déclencher les callbacks de finalization
  forceGC();

  separator("BONUS — Mini-cache avec WeakRef");

  // Démonstration d'un cache qui utilise WeakRef pour permettre au GC
  // de libérer les entrées quand la mémoire est sous pression.
  class WeakCache {
    constructor(factory) {
      this.factory = factory;   // Fonction qui crée une nouvelle valeur
      this.cache = new Map();   // clé -> WeakRef
      this.hits = 0;
      this.misses = 0;

      // FinalizationRegistry pour nettoyer les entrées du cache
      // quand l'objet associé est collecté.
      this.registry = new FinalizationRegistry((key) => {
        // Vérifier que la WeakRef est bien morte avant de supprimer
        const ref = this.cache.get(key);
        if (ref && ref.deref() === undefined) {
          this.cache.delete(key);
        }
      });
    }

    get(key) {
      const ref = this.cache.get(key);
      if (ref) {
        const value = ref.deref();
        if (value !== undefined) {
          this.hits++;
          return value;
        }
        // L'objet a été collecté, on le recrée
      }
      this.misses++;
      const value = this.factory(key);
      this.cache.set(key, new WeakRef(value));
      this.registry.register(value, key);
      return value;
    }

    stats() {
      return { hits: this.hits, misses: this.misses, size: this.cache.size };
    }
  }

  // Factory qui crée des buffers de 1 Mo
  const cache = new WeakCache((key) => {
    return { id: key, data: Buffer.alloc(1024 * 1024) };
  });

  // Remplir le cache
  console.log("  Remplissage du cache avec 20 entrées de 1 Mo :");
  const refs = [];
  for (let i = 0; i < 20; i++) {
    const obj = cache.get(`item-${i}`);
    refs.push(obj); // Garder une référence forte
  }
  console.log(`  Stats : ${JSON.stringify(cache.stats())}`);

  forceGC();
  const memAvantRelease = process.memoryUsage();
  console.log(`  Mémoire (refs vivantes) : ${formatMB(memAvantRelease.rss)}`);

  // Supprimer les références fortes -> le GC peut libérer
  refs.length = 0;
  forceGC();
  const memApresRelease = process.memoryUsage();
  console.log(`  Mémoire (refs libérées) : ${formatMB(memApresRelease.rss)}`);
  console.log(`  Delta RSS : ${formatMB(memApresRelease.rss - memAvantRelease.rss)}`);

  // Re-accéder à quelques entrées (devrait provoquer des misses si GC a collecté)
  for (let i = 0; i < 5; i++) {
    cache.get(`item-${i}`);
  }
  console.log(`  Stats après re-accès : ${JSON.stringify(cache.stats())}`);
  console.log();
  console.log("  Le WeakCache permet au GC de libérer les entrées inutilisées.");
  console.log("  Quand on ré-accède à une entrée collectée, le cache la recrée.");

  // Garder les variables pour éviter la collecte prématurée
  void [heavyClosures, lightClosures];

  console.log("\n=== Fin du Lab 02 — SOLUTION ===");
}, 100);
