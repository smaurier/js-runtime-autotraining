// =============================================================================
// Lab 07 — GC Observation — SOLUTION
// =============================================================================
// Exécuter avec : node --expose-gc solution.js
//
// Ce fichier contient les implémentations complètes avec des commentaires
// expliquant POURQUOI chaque comportement GC se produit.
// =============================================================================

import { performance, PerformanceObserver } from 'node:perf_hooks';

console.log('=== Lab 07 : GC Observation — SOLUTION ===\n');

// ---------------------------------------------------------------------------
// Vérification que --expose-gc est actif
// ---------------------------------------------------------------------------
if (typeof (globalThis as any).gc !== 'function') {
  console.error('ERREUR : (globalThis as any).gc() n\'est pas disponible.');
  console.error('Relancez avec : node --expose-gc solution.js');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Utilitaire fourni — formatage mémoire
// ---------------------------------------------------------------------------
function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + ' Mo';
}

function separator(title: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70) + '\n');
}

// =============================================================================
// PARTIE 1 — Implémenter measureGCImpact(allocFn, count)
// =============================================================================
// POURQUOI cette fonction est utile :
// Elle permet de quantifier précisément combien de mémoire est allouée par
// une série d'objets ET combien le GC parvient à libérer. C'est la base de
// tout diagnostic de fuite mémoire : si freed << allocated, il y a une fuite.
//
// Le pattern « mesure avant → action → mesure après → GC → mesure finale »
// est le standard pour profiler la mémoire en Node.js.
// =============================================================================

separator('PARTIE 1 — measureGCImpact');

function measureGCImpact(allocFn: () => object, count: number): { allocated: number; afterGC: number; freed: number } {
  // Étape 1 : GC initial pour partir d'une base propre.
  // Sans ce GC, les objets temporaires des opérations précédentes
  // pollueraient la mesure « avant ».
  (globalThis as any).gc();
  const heapBefore = process.memoryUsage().heapUsed;

  // Étape 2 : Allouer les objets et les stocker dans un tableau.
  // Le tableau crée des références fortes — le GC ne peut pas collecter.
  const objects = [];
  for (let i = 0; i < count; i++) {
    objects.push(allocFn());
  }
  const heapAfterAlloc = process.memoryUsage().heapUsed;

  // Étape 3 : Supprimer TOUTES les références.
  // Mettre .length = 0 vide le tableau, donc les seules références vers
  // les objets disparaissent. Ils deviennent éligibles au GC.
  objects.length = 0;

  // Étape 4 : Forcer le GC.
  // (globalThis as any).gc() déclenche un cycle mark-compact complet (stop-the-world).
  // Tous les objets sans référence forte sont collectés.
  (globalThis as any).gc();
  const heapAfterGC = process.memoryUsage().heapUsed;

  return {
    allocated: heapAfterAlloc - heapBefore,  // Mémoire consommée par les objets
    afterGC: heapAfterGC - heapBefore,       // Mémoire résiduelle après GC (devrait être ~0)
    freed: heapAfterAlloc - heapAfterGC,     // Mémoire effectivement libérée
  };
}

// --- Tests de la partie 1 ---
const result1k = measureGCImpact(() => ({ data: new Array(100).fill(0) }), 1_000);
const result10k = measureGCImpact(() => ({ data: new Array(100).fill(0) }), 10_000);
const result100k = measureGCImpact(() => ({ data: new Array(100).fill(0) }), 100_000);

console.log('  1 000 objets  :', JSON.stringify(result1k, (k, v) => typeof v === 'number' ? formatMB(v) : v));
console.log('  10 000 objets :', JSON.stringify(result10k, (k, v) => typeof v === 'number' ? formatMB(v) : v));
console.log('  100 000 objets:', JSON.stringify(result100k, (k, v) => typeof v === 'number' ? formatMB(v) : v));

// Sortie attendue (les valeurs exactes varient selon la machine) :
//   1 000 objets  : {"allocated":"1.05 Mo","afterGC":"-0.02 Mo","freed":"1.07 Mo"}
//   10 000 objets : {"allocated":"10.43 Mo","afterGC":"-0.05 Mo","freed":"10.48 Mo"}
//   100 000 objets: {"allocated":"104.26 Mo","afterGC":"-0.10 Mo","freed":"104.36 Mo"}
//
// Points clés :
//   - allocated augmente linéairement avec count (~1 Ko par objet avec Array(100))
//   - afterGC est proche de 0 (voire légèrement négatif grâce à la compaction)
//   - freed ≈ allocated, prouvant que le GC a tout récupéré

console.assert(result1k.allocated > 0, 'allocated doit être > 0');
console.assert(result1k.freed > result1k.allocated * 0.8, 'freed doit être >= 80% de allocated');
console.assert(result100k.allocated > result10k.allocated, 'plus d\'objets = plus de mémoire');
console.log('  [OK] Assertions partie 1 passées');

// =============================================================================
// PARTIE 2 — Implémenter la classe WeakCache
// =============================================================================
// POURQUOI un WeakCache :
// Un cache classique (Map<string, object>) empêche le GC de collecter
// les valeurs mises en cache, même si aucun autre code ne les utilise.
// Résultat : la mémoire ne cesse de croître → fuite mémoire.
//
// Le WeakCache résout ce problème :
//   - Les valeurs sont stockées via WeakRef, donc le GC PEUT les collecter
//   - Le FinalizationRegistry nettoie automatiquement les entrées mortes
//   - Si une valeur est encore utilisée ailleurs, elle reste en cache (hit)
//   - Si elle n'est plus utilisée, le GC la collecte (auto-éviction)
//
// Limites :
//   - Le nettoyage par FinalizationRegistry est ASYNCHRONE et non garanti
//   - Le GC est non-déterministe : on ne contrôle pas ce qui reste
//   - WeakRef.deref() a un coût (léger) par rapport à un accès direct
// =============================================================================

separator('PARTIE 2 — WeakCache');

class WeakCache {
  // Map interne : clé (string) → WeakRef(valeur)
  #entries = new Map();

  // FinalizationRegistry : quand un objet est collecté, le callback
  // reçoit la heldValue (ici, la clé) et nettoie l'entrée du cache.
  // On vérifie que la WeakRef est bien morte avant de supprimer,
  // car une nouvelle valeur pourrait avoir été stockée entre-temps.
  #registry = new FinalizationRegistry((key) => {
    const ref = this.#entries.get(key);
    if (ref && ref.deref() === undefined) {
      this.#entries.delete(key);
    }
  });

  set(key, value) {
    // Envelopper la valeur dans une WeakRef.
    // Le GC pourra collecter value si plus aucune référence forte n'existe.
    this.#entries.set(key, new WeakRef(value));

    // Enregistrer pour nettoyage automatique.
    // Quand value sera collecté, le callback recevra key.
    this.#registry.register(value, key);
  }

  get(key) {
    const ref = this.#entries.get(key);
    if (!ref) return undefined;

    // deref() retourne l'objet s'il est encore vivant, undefined sinon.
    // C'est le mécanisme central de WeakRef : on ne sait jamais à l'avance
    // si l'objet sera encore là.
    return ref.deref();
  }

  has(key) {
    const ref = this.#entries.get(key);
    if (!ref) return false;
    // L'entrée existe dans la Map, mais la valeur a peut-être été collectée.
    return ref.deref() !== undefined;
  }

  get size() {
    // Nombre total d'entrées, y compris celles dont la valeur est morte
    // mais pas encore nettoyées par le FinalizationRegistry.
    return this.#entries.size;
  }

  get alive() {
    // Compter seulement les entrées dont la valeur est encore vivante.
    let count = 0;
    for (const ref of this.#entries.values()) {
      if (ref.deref() !== undefined) count++;
    }
    return count;
  }
}

// --- 8 assertions de test ---

const cache = new WeakCache();

// Test 1 : set + get basique
let val1 = { id: 1, payload: 'premier' };
cache.set('a', val1);
console.assert(cache.get('a') === val1, 'Test 1 échoué : get doit retourner la valeur exacte');
console.log('  Test 1 passé : set/get basique');

// Test 2 : has retourne true pour une entrée vivante
console.assert(cache.has('a') === true, 'Test 2 échoué : has doit retourner true');
console.log('  Test 2 passé : has retourne true');

// Test 3 : get retourne undefined pour une clé inexistante
console.assert(cache.get('inexistant') === undefined, 'Test 3 échoué : get sur clé absente doit retourner undefined');
console.log('  Test 3 passé : get sur clé absente');

// Test 4 : has retourne false pour une clé inexistante
console.assert(cache.has('inexistant') === false, 'Test 4 échoué : has sur clé absente doit retourner false');
console.log('  Test 4 passé : has sur clé absente');

// Test 5 : size compte les entrées
let val2 = { id: 2, payload: 'deuxième' };
let val3 = { id: 3, payload: 'troisième' };
cache.set('b', val2);
cache.set('c', val3);
console.assert(cache.size === 3, `Test 5 échoué : size devrait être 3, reçu ${cache.size}`);
console.log('  Test 5 passé : size = 3');

// Test 6 : alive compte les entrées vivantes
console.assert(cache.alive === 3, `Test 6 échoué : alive devrait être 3, reçu ${cache.alive}`);
console.log('  Test 6 passé : alive = 3');

// Test 7 : après suppression de la référence forte + GC, get retourne undefined
val3 = null;
(globalThis as any).gc();
const val3afterGC = cache.get('c');
if (val3afterGC === undefined) {
  console.log('  Test 7 passé : valeur collectée par le GC, get retourne undefined');
} else {
  console.log('  Test 7 info : le GC n\'a pas encore collecté (comportement non-déterministe)');
}

// Test 8 : alive doit être <= size
console.assert(cache.alive <= cache.size, 'Test 8 échoué : alive doit être <= size');
console.log(`  Test 8 passé : alive (${cache.alive}) <= size (${cache.size})`);

void [val1, val2];

// Sortie attendue :
//   Test 1 passé : set/get basique
//   Test 2 passé : has retourne true
//   Test 3 passé : get sur clé absente
//   Test 4 passé : has sur clé absente
//   Test 5 passé : size = 3
//   Test 6 passé : alive = 3
//   Test 7 passé : valeur collectée par le GC, get retourne undefined
//   Test 8 passé : alive (2) <= size (3)

// =============================================================================
// PARTIE 3 — Prédictions de rétention mémoire
// =============================================================================
// POURQUOI comprendre la rétention :
// Les fuites mémoire en JavaScript sont TOUJOURS causées par des références
// fortes involontaires. Comprendre QUELS types de références empêchent le GC
// est la compétence #1 pour diagnostiquer les fuites.
//
// Règle d'or : un objet survit au GC si ET SEULEMENT SI il existe au moins
// une chaîne de références fortes depuis une « racine GC » (variables globales,
// pile d'exécution, timers, closures accessibles, etc.) jusqu'à cet objet.
// =============================================================================

separator('PARTIE 3 — Prédictions de rétention');

// Scénario A — Closure
// La closure () => obj.label capture la variable `obj`.
// Elle est stockée dans le tableau `closures` qui est toujours référencé.
// Même après obj = null, la closure conserve sa propre référence vers l'objet.
// RÉPONSE : true — l'objet survit
{
  const closures = [];
  let obj = { label: 'closure-test', data: new Array(10000) };
  const ref = new WeakRef(obj);
  closures.push(() => obj.label);
  obj = null;
  (globalThis as any).gc();
  console.log('  Scénario A (closure)  — survit :', ref.deref() !== undefined);
  // Résultat : true
  // EXPLICATION : la closure capture la variable `obj` de sa portée lexicale.
  // Mettre obj = null dans la portée extérieure ne touche PAS la binding
  // capturée par la closure. L'objet reste vivant via closures[0].
  void closures;
}

// Scénario B — Timer (setInterval)
// Le callback du timer référence `obj`.
// Tant que le timer est actif, Node.js maintient une référence vers le callback,
// qui maintient une référence vers obj via sa closure.
// RÉPONSE : true — l'objet survit
{
  let obj = { label: 'timer-test', data: new Array(10000) };
  const ref = new WeakRef(obj);
  const timer = setInterval(() => {
    void obj.label;
  }, 60_000);
  obj = null;
  (globalThis as any).gc();
  console.log('  Scénario B (timer)    — survit :', ref.deref() !== undefined);
  // Résultat : true
  // EXPLICATION : un timer actif est une racine GC. Son callback est une closure
  // qui capture obj. L'objet reste vivant tant que le timer n'est pas clearInterval().
  // C'est une source TRÈS fréquente de fuites mémoire en production.
  clearInterval(timer);
}

// Scénario C — Map (référence forte)
// La Map garde une référence forte vers l'objet en tant que valeur.
// La Map elle-même est référencée par la variable `map`.
// RÉPONSE : true — l'objet survit
{
  const map = new Map();
  let obj = { label: 'map-test', data: new Array(10000) };
  const ref = new WeakRef(obj);
  map.set('key', obj);
  obj = null;
  (globalThis as any).gc();
  console.log('  Scénario C (Map)      — survit :', ref.deref() !== undefined);
  // Résultat : true
  // EXPLICATION : Map stocke des références fortes vers ses clés ET ses valeurs.
  // Même si on supprime la variable obj, la Map retient l'objet.
  // Pour libérer : map.delete('key') ou map.clear().
  void map;
}

// Scénario D — WeakMap
// La WeakMap stocke l'objet, mais la CLÉ (key) n'est plus référencée.
// Une WeakMap ne retient ses entrées QUE si la clé est encore vivante.
// Quand key = null, l'entrée entière (clé + valeur) est éligible au GC.
// RÉPONSE : false — l'objet est collecté
{
  const wm = new WeakMap();
  let key = {};
  let obj = { label: 'weakmap-test', data: new Array(10000) };
  const ref = new WeakRef(obj);
  wm.set(key, obj);
  obj = null;
  key = null;
  (globalThis as any).gc();
  console.log('  Scénario D (WeakMap)  — survit :', ref.deref() !== undefined);
  // Résultat : false (probable — le GC est non-déterministe, mais en pratique c'est collecté)
  // EXPLICATION : une WeakMap utilise des références FAIBLES pour ses clés.
  // Quand la clé n'a plus de référence forte, l'entrée (clé + valeur) est éligible.
  // C'est pour cela que WeakMap est utilisée pour les données « attachées » à un objet
  // sans empêcher sa collecte (métadonnées, caches privés, etc.).
  void wm;
}

console.log();
console.log('  Résumé :');
console.log('    A (closure)  : true  — la closure dans le tableau retient obj');
console.log('    B (timer)    : true  — le callback du timer retient obj');
console.log('    C (Map)      : true  — la Map garde une référence forte');
console.log('    D (WeakMap)  : false — ni la clé ni l\'objet n\'ont de ref forte');

// =============================================================================
// PARTIE 4 — Implémenter measureGCPause(liveObjectCount)
// =============================================================================
// POURQUOI mesurer les pauses GC :
// (globalThis as any).gc() déclenche un GC « stop-the-world » de type mark-compact.
// Pendant cette pause, le thread principal est BLOQUÉ : aucun code JS
// ne s'exécute, aucune requête HTTP n'est traitée.
//
// La durée de la pause dépend principalement du nombre d'objets VIVANTS
// que le GC doit scanner (phase « mark »). Plus il y a d'objets vivants,
// plus le marquage prend de temps.
//
// En production, les pauses GC longues causent :
//   - Des latences p99/p999 anormalement élevées
//   - Des timeouts dans les systèmes distribués
//   - Des « jank » dans les interfaces utilisateur
// =============================================================================

separator('PARTIE 4 — Pause GC et objets vivants');

function measureGCPause(liveObjectCount: number): number {
  // Créer les objets vivants. Ils sont stockés dans un tableau local,
  // ce qui constitue une référence forte. Le GC doit scanner chacun d'eux
  // pendant la phase de marquage.
  const liveObjects = [];
  for (let i = 0; i < liveObjectCount; i++) {
    liveObjects.push({ id: i, value: Math.random() });
  }

  // Mesurer la durée exacte du GC avec performance.now().
  // performance.now() a une résolution de ~1 microseconde en Node.js,
  // largement suffisante pour mesurer des pauses GC (millisecondes).
  const start = performance.now();
  (globalThis as any).gc();
  const duration = performance.now() - start;

  // IMPORTANT : il faut garder la référence vers liveObjects APRÈS le GC.
  // Si V8 détecte que le tableau n'est plus utilisé, il pourrait l'optimiser
  // et ne pas scanner les objets. Le `void` empêche cette optimisation.
  void liveObjects;

  return duration;
}

// Nettoyage préalable
(globalThis as any).gc();

const pause0    = measureGCPause(0);
const pause100k = measureGCPause(100_000);
const pause500k = measureGCPause(500_000);
const pause1M   = measureGCPause(1_000_000);

console.log(`  0 objets      : ${pause0.toFixed(3)} ms`);
console.log(`  100k objets   : ${pause100k.toFixed(3)} ms`);
console.log(`  500k objets   : ${pause500k.toFixed(3)} ms`);
console.log(`  1M objets     : ${pause1M.toFixed(3)} ms`);

// Sortie attendue (les valeurs varient selon la machine) :
//   0 objets      : 0.350 ms
//   100k objets   : 3.200 ms
//   500k objets   : 14.500 ms
//   1M objets     : 28.800 ms

console.assert(typeof pause0 === 'number' && pause0 >= 0, 'pause doit être un nombre >= 0');
console.assert(typeof pause1M === 'number' && pause1M >= 0, 'pause doit être un nombre >= 0');

console.log();
console.log('  Ratios :');
if (pause100k > 0) {
  console.log(`    500k / 100k : ${(pause500k / pause100k).toFixed(2)}x`);
  console.log(`    1M / 100k   : ${(pause1M / pause100k).toFixed(2)}x`);
}

console.log();
console.log('  Explication :');
console.log('  La durée du GC est approximativement proportionnelle au nombre');
console.log('  d\'objets VIVANTS. Le GC mark-compact doit SCANNER chaque objet');
console.log('  vivant pour déterminer s\'il est atteignable (phase mark), puis');
console.log('  compacter la mémoire. Plus d\'objets vivants = plus de travail.');
console.log();
console.log('  Solutions pour réduire les pauses en production :');
console.log('    - Réduire le nombre d\'objets vivants (object pooling)');
console.log('    - Utiliser des TypedArray au lieu de tableaux d\'objets');
console.log('    - Activer le GC incrémental (par défaut dans V8 récent)');
console.log('    - Monitorer avec --trace-gc ou PerformanceObserver');

// =============================================================================
// PARTIE 5 (Bonus) — Moniteur GC avec PerformanceObserver
// =============================================================================
// POURQUOI PerformanceObserver :
// En production, on ne peut pas utiliser --expose-gc ou --trace-gc.
// PerformanceObserver est l'API OFFICIELLE pour observer les événements GC
// sans flag spécial. Elle permet de :
//   - Enregistrer chaque événement GC (Scavenge, Major, Minor)
//   - Mesurer la durée de chaque pause
//   - Déclencher des alertes si les pauses dépassent un seuil
//   - Envoyer des métriques à un système de monitoring (Prometheus, etc.)
//
// Types de GC (detail.kind) :
//   1 = Scavenge — GC rapide de la young generation (~1-2 ms)
//   2 = Minor Mark-Compact — compaction de la young gen
//   4 = Major Mark-Compact — GC complet stop-the-world (~10-100 ms)
//   8 = Incremental marking — marquage incrémental en arrière-plan
//  15 = Combination/All
// =============================================================================

separator('PARTIE 5 (Bonus) — PerformanceObserver GC');

// Tableau pour stocker les événements GC observés
const gcEvents = [];

// Types de GC lisibles
const GC_KINDS = {
  1: 'Scavenge',
  2: 'Minor Mark-Compact',
  4: 'Major Mark-Compact',
  8: 'Incremental Marking',
  15: 'All',
};

// Créer l'observateur
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    gcEvents.push({
      kind: entry.detail?.kind ?? 0,
      kindName: GC_KINDS[entry.detail?.kind] ?? 'Inconnu',
      duration: entry.duration,
    });
  }
});

// Démarrer l'observation. buffered: true capture aussi les événements
// qui se sont produits AVANT l'appel à observe().
observer.observe({ type: 'gc', buffered: true });

// Provoquer plusieurs GC avec des allocations intermédiaires
// pour observer différents types d'événements.

// GC 1 : heap quasi-vide
(globalThis as any).gc();

// Allouer beaucoup de petits objets (provoque des Scavenge)
for (let i = 0; i < 50_000; i++) {
  void { data: Math.random() };
}

// GC 2 : après allocations
(globalThis as any).gc();

// Allouer des objets plus gros
const tempLarge = [];
for (let i = 0; i < 10_000; i++) {
  tempLarge.push(new Array(100).fill(i));
}
tempLarge.length = 0;

// GC 3 : nettoyage d'objets morts
(globalThis as any).gc();

// Laisser un tick pour que l'observateur reçoive les événements
setTimeout(() => {
  console.log(`  Événements GC observés : ${gcEvents.length}`);
  console.log();

  // Résumé par type
  const byKind = {};
  let totalDuration = 0;

  for (const event of gcEvents) {
    if (!byKind[event.kindName]) {
      byKind[event.kindName] = { count: 0, totalMs: 0 };
    }
    byKind[event.kindName].count++;
    byKind[event.kindName].totalMs += event.duration;
    totalDuration += event.duration;
  }

  for (const [kind, stats] of Object.entries(byKind)) {
    console.log(`  ${kind.padEnd(25)} : ${stats.count} événement(s), ${stats.totalMs.toFixed(3)} ms total`);
  }

  console.log(`\n  Durée totale de pauses GC : ${totalDuration.toFixed(3)} ms`);

  // Sortie attendue (valeurs approximatives) :
  //   Événements GC observés : 5-10
  //
  //   Scavenge                  : 2-4 événement(s), 0.500 ms total
  //   Major Mark-Compact        : 3 événement(s), 2.100 ms total
  //
  //   Durée totale de pauses GC : 2.600 ms

  // Arrêter l'observateur
  observer.disconnect();

  console.log('\n=== Fin du Lab 07 — SOLUTION ===');
}, 100);
