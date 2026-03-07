// =============================================================================
// Lab 07 — GC Observation
// =============================================================================
// Exécuter avec : node --expose-gc exercise.js
//
// Ce lab vous demande d'IMPLÉMENTER des fonctions qui interagissent avec le
// ramasse-miettes (Garbage Collector) de V8. Aucun code n'est pré-écrit :
// vous devez tout écrire à partir des contrats et des assertions fournis.
// =============================================================================

import { performance, PerformanceObserver } from 'node:perf_hooks';

console.log('=== Lab 07 : GC Observation ===\n');

// ---------------------------------------------------------------------------
// Vérification que --expose-gc est actif
// ---------------------------------------------------------------------------
if (typeof global.gc !== 'function') {
  console.error('ERREUR : global.gc() n\'est pas disponible.');
  console.error('Relancez avec : node --expose-gc exercise.js');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Utilitaire fourni — formatage mémoire
// ---------------------------------------------------------------------------
function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' Mo';
}

function separator(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70) + '\n');
}

// =============================================================================
// PARTIE 1 — Implémenter measureGCImpact(allocFn, count)
// =============================================================================
// Contrat :
//   - allocFn : () => object — fonction qui crée un objet
//   - count   : number — nombre d'objets à allouer
//
// La fonction doit :
//   1. Forcer un GC initial, puis mesurer heapUsed AVANT allocation
//   2. Allouer `count` objets via allocFn() et les stocker dans un tableau
//   3. Mesurer heapUsed APRÈS allocation (sans GC)
//   4. Supprimer toutes les références (vider le tableau)
//   5. Forcer un GC
//   6. Mesurer heapUsed APRÈS le GC
//   7. Retourner un objet :
//        {
//          allocated: <heapUsed après alloc - heapUsed avant>,
//          afterGC:   <heapUsed après GC - heapUsed avant>,
//          freed:     <heapUsed après alloc - heapUsed après GC>
//        }
//
// Indices :
//   - process.memoryUsage().heapUsed donne l'utilisation du tas V8
//   - global.gc() force un cycle de ramasse-miettes complet
//   - Mettre .length = 0 sur un tableau supprime toutes les références
// =============================================================================

separator('PARTIE 1 — measureGCImpact');

// TODO : Implémentez la fonction measureGCImpact ci-dessous

function measureGCImpact(allocFn, count) {
  // 💡 Indice — code de démarrage :
  //
  //   global.gc();
  //   const heapBefore = process.memoryUsage().heapUsed;
  //
  //   // Étape 2 : allouer
  //   const items = [];
  //   for (let i = 0; i < count; i++) {
  //     items.push(allocFn());
  //   }
  //
  //   const heapAfterAlloc = process.memoryUsage().heapUsed;
  //   const allocated = heapAfterAlloc - heapBefore;
  //
  //   // TODO : Étapes 3-6 (nettoyer items, forcer GC, mesurer à nouveau)
  //   // items.length = 0;  ← vide le tableau (supprime les références)
  //   // global.gc();
  //   // const heapAfterGC = process.memoryUsage().heapUsed;
  //   // ...
  //
  //   // Retourner : { allocated, afterGC: heapAfterGC - heapBefore, freed: heapAfterAlloc - heapAfterGC }
}

// --- Tests de la partie 1 ---
const result1k = measureGCImpact(() => ({ data: new Array(100).fill(0) }), 1_000);
const result10k = measureGCImpact(() => ({ data: new Array(100).fill(0) }), 10_000);
const result100k = measureGCImpact(() => ({ data: new Array(100).fill(0) }), 100_000);

console.log('  1 000 objets  :', JSON.stringify(result1k, (k, v) => typeof v === 'number' ? formatMB(v) : v));
console.log('  10 000 objets :', JSON.stringify(result10k, (k, v) => typeof v === 'number' ? formatMB(v) : v));
console.log('  100 000 objets:', JSON.stringify(result100k, (k, v) => typeof v === 'number' ? formatMB(v) : v));

// Assertions : la mémoire allouée doit être positive, et freed >= 80% de allocated
console.assert(result1k.allocated > 0, 'allocated doit être > 0');
console.assert(result1k.freed > result1k.allocated * 0.8, 'freed doit être >= 80% de allocated');
console.assert(result100k.allocated > result10k.allocated, 'plus d\'objets = plus de mémoire');
console.log('  [OK] Assertions partie 1 passées');

// =============================================================================
// PARTIE 2 — Implémenter la classe WeakCache
// =============================================================================
// Contrat de l'API :
//
//   const cache = new WeakCache();
//
//   cache.set(key, value)
//     — Stocke `value` associée à `key`.
//     — La valeur est enveloppée dans une WeakRef.
//     — L'objet est enregistré dans un FinalizationRegistry pour nettoyage.
//     — `key` est une chaîne, `value` est un objet.
//
//   cache.get(key) → object | undefined
//     — Retourne la valeur si elle existe ET n'a pas été collectée par le GC.
//     — Retourne undefined si la clé n'existe pas ou si le GC a collecté la valeur.
//
//   cache.has(key) → boolean
//     — true si l'entrée existe ET la valeur est encore vivante.
//
//   cache.size → number
//     — Nombre total d'entrées dans le cache (y compris celles dont la valeur
//       a été collectée mais pas encore nettoyée par le FinalizationRegistry).
//
//   cache.alive → number
//     — Nombre d'entrées dont la valeur est encore vivante (deref() !== undefined).
//
// Indices :
//   - Utilisez une Map interne pour stocker les paires key → WeakRef(value)
//   - new WeakRef(obj) crée une référence faible vers obj
//   - weakRef.deref() retourne l'objet ou undefined s'il a été collecté
//   - new FinalizationRegistry(callback) crée un registre de nettoyage
//   - registry.register(obj, heldValue) enregistre obj pour notification
//   - Le callback reçoit heldValue quand obj est collecté
// =============================================================================

separator('PARTIE 2 — WeakCache');

// TODO : Implémentez la classe WeakCache ci-dessous

class WeakCache {
  constructor() {
    // 💡 Indice — structure interne :
    //   this._map = new Map();  // clé → WeakRef(valeur)
    //   this._registry = new FinalizationRegistry((key) => {
    //     // Quand le GC collecte une valeur, on nettoie la Map
    //     this._map.delete(key);
    //   });
  }

  set(key, value) {
    // TODO : créer un WeakRef pour la valeur, l'enregistrer dans la Map et le Registry
    // 💡 Indice : this._map.set(key, new WeakRef(value));
    //            this._registry.register(value, key);
  }

  get(key) {
    // TODO : récupérer le WeakRef, appeler .deref(), retourner la valeur ou undefined
    // 💡 Indice : const ref = this._map.get(key);
    //            return ref ? ref.deref() : undefined;
  }

  has(key) {
    // TODO : vérifier que la clé existe ET que le WeakRef n'est pas mort
  }

  get size() {
    // TODO : retourner this._map.size
  }

  get alive() {
    // TODO : compter combien de WeakRef sont encore vivants (.deref() !== undefined)
  }
}

// --- 8 assertions de test ---
// Ces tests vérifient votre implémentation. Ils doivent TOUS passer.

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
val3 = null; // Supprimer la référence forte vers l'objet { id: 3 }
global.gc();
// Note : le GC peut ou non collecter immédiatement.
// Si get retourne undefined, c'est que le GC a bien collecté l'objet.
const val3afterGC = cache.get('c');
if (val3afterGC === undefined) {
  console.log('  Test 7 passé : valeur collectée par le GC, get retourne undefined');
} else {
  console.log('  Test 7 info : le GC n\'a pas encore collecté (comportement non-déterministe)');
}

// Test 8 : alive doit être <= size
console.assert(cache.alive <= cache.size, 'Test 8 échoué : alive doit être <= size');
console.log(`  Test 8 passé : alive (${cache.alive}) <= size (${cache.size})`);

// Garder val1 et val2 en vie pour la durée des tests
void [val1, val2];

// =============================================================================
// PARTIE 3 — Prédictions de rétention mémoire
// =============================================================================
// Ci-dessous, 4 scénarios créent des objets et les référencent de manières
// différentes. Pour CHAQUE scénario :
//   1. ÉCRIVEZ votre prédiction dans le commentaire AVANT d'exécuter
//   2. Exécutez le code et vérifiez avec le résultat affiché
//
// Un objet est « retenu » (survit au GC) s'il existe encore au moins une
// référence forte qui pointe vers lui. Une référence faible (WeakRef, WeakMap)
// ne compte PAS — elle n'empêche pas le GC de collecter l'objet.
// =============================================================================

separator('PARTIE 3 — Prédictions de rétention');

// TODO : Pour chaque scénario, écrivez votre prédiction (true/false)
//        puis comparez avec le résultat affiché.

// Scénario A — Closure
// Un objet est capturé par une closure stockée dans un tableau.
// Le tableau est toujours référencé. L'objet survit-il au GC ?
// VOTRE PRÉDICTION : _____ (true ou false)
{
  const closures = [];
  let obj = { label: 'closure-test', data: new Array(10000) };
  const ref = new WeakRef(obj);
  closures.push(() => obj.label); // Closure qui capture obj
  obj = null; // On supprime la variable locale
  global.gc();
  console.log('  Scénario A (closure)  — survit :', ref.deref() !== undefined);
  void closures; // Garder le tableau en vie
}

// Scénario B — Timer (setInterval)
// Un objet est référencé dans le callback d'un setInterval.
// Le timer est actif. L'objet survit-il au GC ?
// VOTRE PRÉDICTION : _____ (true ou false)
{
  let obj = { label: 'timer-test', data: new Array(10000) };
  const ref = new WeakRef(obj);
  const timer = setInterval(() => {
    void obj.label;
  }, 60_000); // Timer très long — ne se déclenchera pas pendant le test
  obj = null;
  global.gc();
  console.log('  Scénario B (timer)    — survit :', ref.deref() !== undefined);
  clearInterval(timer); // Nettoyage
}

// Scénario C — Map (référence forte)
// Un objet est stocké comme valeur dans une Map.
// La Map est toujours référencée. L'objet survit-il au GC ?
// VOTRE PRÉDICTION : _____ (true ou false)
{
  const map = new Map();
  let obj = { label: 'map-test', data: new Array(10000) };
  const ref = new WeakRef(obj);
  map.set('key', obj);
  obj = null;
  global.gc();
  console.log('  Scénario C (Map)      — survit :', ref.deref() !== undefined);
  void map;
}

// Scénario D — WeakMap
// Un objet est stocké comme valeur dans une WeakMap, avec une clé forte.
// La WeakMap est toujours référencée, MAIS la clé n'est plus référencée.
// L'objet survit-il au GC ?
// VOTRE PRÉDICTION : _____ (true ou false)
{
  const wm = new WeakMap();
  let key = {};
  let obj = { label: 'weakmap-test', data: new Array(10000) };
  const ref = new WeakRef(obj);
  wm.set(key, obj);
  obj = null;
  key = null; // La clé n'est plus référencée non plus
  global.gc();
  console.log('  Scénario D (WeakMap)  — survit :', ref.deref() !== undefined);
  void wm;
}

console.log();
console.log('  Résumé attendu :');
console.log('    A (closure)  : true  — la closure dans le tableau retient obj');
console.log('    B (timer)    : true  — le callback du timer retient obj');
console.log('    C (Map)      : true  — la Map garde une référence forte');
console.log('    D (WeakMap)  : false — ni la clé ni l\'objet n\'ont de ref forte');

// =============================================================================
// PARTIE 4 — Implémenter measureGCPause(liveObjectCount)
// =============================================================================
// Contrat :
//   - liveObjectCount : number — nombre d'objets vivants à créer
//
// La fonction doit :
//   1. Créer un tableau de `liveObjectCount` objets { id, value: Math.random() }
//   2. Mesurer le temps que prend global.gc() avec performance.now()
//   3. Retourner la durée en millisecondes (nombre à virgule flottante)
//   4. IMPORTANT : le tableau doit rester référencé PENDANT le GC
//      (sinon les objets seraient collectés, pas scannés)
//
// Après implémentation, appelez la fonction avec 0, 100_000, 500_000, 1_000_000
// et expliquez la relation entre le nombre d'objets vivants et la durée du GC.
// =============================================================================

separator('PARTIE 4 — Pause GC et objets vivants');

// TODO : Implémentez la fonction measureGCPause ci-dessous

function measureGCPause(liveObjectCount) {
  // À implémenter entièrement
}

// --- Tests ---
// Nettoyage préalable
global.gc();

const pause0    = measureGCPause(0);
const pause100k = measureGCPause(100_000);
const pause500k = measureGCPause(500_000);
const pause1M   = measureGCPause(1_000_000);

console.log(`  0 objets      : ${pause0.toFixed(3)} ms`);
console.log(`  100k objets   : ${pause100k.toFixed(3)} ms`);
console.log(`  500k objets   : ${pause500k.toFixed(3)} ms`);
console.log(`  1M objets     : ${pause1M.toFixed(3)} ms`);

// Le résultat doit être un nombre positif
console.assert(typeof pause0 === 'number' && pause0 >= 0, 'pause doit être un nombre >= 0');
console.assert(typeof pause1M === 'number' && pause1M >= 0, 'pause doit être un nombre >= 0');

console.log();
console.log('  Ratios :');
if (pause100k > 0) {
  console.log(`    500k / 100k : ${(pause500k / pause100k).toFixed(2)}x`);
  console.log(`    1M / 100k   : ${(pause1M / pause100k).toFixed(2)}x`);
}

// TODO : Écrivez votre explication ci-dessous en commentaire :
// La relation observée entre le nombre d'objets vivants et la durée du GC est :
// _______________________________________________________________
// _______________________________________________________________
// _______________________________________________________________

// =============================================================================
// PARTIE 5 (Bonus) — Moniteur GC avec PerformanceObserver
// =============================================================================
// Objectif : créer un observateur qui enregistre CHAQUE événement GC déclenché
// par le ramasse-miettes et affiche son type et sa durée.
//
// Contrat :
//   - Utilisez new PerformanceObserver(callback) avec le type 'gc'
//   - Le callback reçoit une PerformanceObserverEntryList
//   - Chaque entrée a : .name, .entryType, .duration, .detail.kind
//   - detail.kind peut être :
//       1 = Scavenge (young generation)
//       2 = Minor Mark-Compact
//       4 = Major Mark-Compact
//       8 = Incremental marking
//      15 = All
//   - Démarrez l'observateur, forcez 3 GC avec des allocations entre chaque,
//     puis affichez un résumé.
//
// Indice : observer.observe({ type: 'gc', buffered: true })
// =============================================================================

separator('PARTIE 5 (Bonus) — PerformanceObserver GC');

// TODO : Implémentez le moniteur GC ci-dessous

// Étape 1 : Créez un tableau pour stocker les événements GC
// Étape 2 : Créez un PerformanceObserver qui pousse chaque entrée dans le tableau
// Étape 3 : Démarrez l'observation avec { type: 'gc', buffered: true }
// Étape 4 : Forcez 3 cycles GC avec des allocations entre chaque
// Étape 5 : Affichez un résumé (nombre d'événements, durée totale, types observés)

console.log('  TODO : Implémentez le moniteur GC avec PerformanceObserver');

console.log('\n=== Fin du Lab 07 ===');
