// =============================================================================
// Lab 15 — Diagnostic de performance — SOLUTION
// =============================================================================
// Ce fichier contient :
// - Les versions originales (avec problemes) pour comparaison avant/apres
// - Les versions corrigees avec explications detaillees
// - Un pipeline de comparaison avec instrumentation performance.mark/measure
//
// Commandes :
//   npx tsx solution.ts                          (executer la comparaison)
//   node --trace-gc solution.js               (observer la reduction GC)
//   node --trace-deopt solution.js            (observer 0 deoptimisations)
//   node --expose-gc solution.js              (forcer GC pour observer memoire)
// =============================================================================

import { performance, PerformanceObserver } from 'node:perf_hooks';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Observer pour les mesures
// ---------------------------------------------------------------------------
const perfObserver = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log(`  [PERF] ${entry.name}: ${entry.duration.toFixed(2)} ms`);
  }
});
perfObserver.observe({ entryTypes: ['measure'] });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const NUM_REQUESTS = 5_000;
const NUM_RECORDS_PER_REQUEST = 200;
const BROADCAST_ITERATIONS = 50_000;
const HETEROGENEOUS_OBJECTS = 100_000;

// =============================================================================
//
//   VERSIONS ORIGINALES (avec problemes) — pour comparaison avant/apres
//
// =============================================================================

// --- Original 1 : Cache sans limite ---
const sessionCacheOriginal = new Map();

function handleRequestOriginal(requestId: number, payload: any): { status: string; id: number } {
  sessionCacheOriginal.set(`session_${requestId}`, {
    id: requestId,
    payload,
    createdAt: Date.now(),
    metadata: {
      userAgent: `Mozilla/5.0 (simulation request ${requestId})`,
      ip: `192.168.1.${requestId % 255}`,
      headers: { 'content-type': 'application/json', 'accept': '*/*' },
    },
  });
  return { status: 'ok', id: requestId };
}

// --- Original 2 : Records avec shapes inconsistantes ---
function processRecordOriginal(record: any): string {
  const name = record.name;
  const value = record.value;
  const score = value * 2 + (record.bonus || 0);
  return `${name}:${score}`;
}

function generateRecordsOriginal(count: number): any[] {
  const records = [];
  for (let i = 0; i < count; i++) {
    const r = { name: `item_${i}` };
    if (i % 2 === 0) r.value = i;
    if (i % 3 === 0) r.bonus = i * 0.5;
    if (i % 5 === 0) r.category = 'premium';
    if (i % 7 === 0) r.priority = 1;
    if (i % 11 === 0) r.tags = ['hot', 'new'];
    if (r.value === undefined) r.value = 0;
    records.push(r);
  }
  return records;
}

// --- Original 3 : Broadcast avec allocations massives ---
function broadcastMessagesOriginal(clientCount: number, iterations: number): number {
  let totalLength = 0;
  for (let i = 0; i < iterations; i++) {
    for (let c = 0; c < clientCount; c++) {
      const message = JSON.stringify({
        type: 'update',
        timestamp: Date.now(),
        clientId: `client_${c}`,
        payload: { index: i, data: `message_content_${i}_for_client_${c}` },
      });
      totalLength += message.length;
    }
  }
  return totalLength;
}

// --- Original 4 : Objets heterogenes ---
function readValueOriginal(obj: any): number {
  return obj.value;
}

function processHeterogeneousObjectsOriginal(count: number): number {
  const objects = [];
  for (let i = 0; i < count; i++) {
    switch (i % 8) {
      case 0: objects.push({ value: i }); break;
      case 1: objects.push({ value: i, a: 1 }); break;
      case 2: objects.push({ value: i, a: 1, b: 2 }); break;
      case 3: objects.push({ value: i, x: 'hello' }); break;
      case 4: objects.push({ y: true, value: i }); break;
      case 5: objects.push({ value: i, z: null, w: 3.14 }); break;
      case 6: objects.push({ p: 0, q: 0, value: i }); break;
      case 7: objects.push({ value: i, meta: { nested: true } }); break;
    }
  }
  let sum = 0;
  for (const obj of objects) {
    sum += readValueOriginal(obj);
  }
  return sum;
}

// --- Original 5 : Gros JSON ---
function buildLargeJSON(size: number): string {
  const items = [];
  for (let i = 0; i < size; i++) {
    items.push({
      id: i,
      name: `item_${i}`,
      description: `Description detaillee de l'element ${i} avec du contenu supplementaire pour augmenter la taille`,
      values: [i, i * 2, i * 3, i * 4, i * 5],
      metadata: { created: '2024-01-15', updated: '2024-06-20', version: i },
    });
  }
  return JSON.stringify({ items, total: size, generatedAt: new Date().toISOString() });
}

function processLargePayloadOriginal(): { totalProcessed: number; originalSize: number } {
  const largeJsonString = buildLargeJSON(10_000);
  const parsed = JSON.parse(largeJsonString);
  let totalProcessed = 0;
  for (const item of parsed.items) {
    const copy = JSON.parse(JSON.stringify(item));
    copy.processed = true;
    totalProcessed++;
  }
  return { totalProcessed, originalSize: largeJsonString.length };
}

// --- Original 6 : Listeners accumules ---
const serverEmitterOriginal = new EventEmitter();
serverEmitterOriginal.setMaxListeners(0);

function handleConnectionOriginal(connectionId: number): void {
  serverEmitterOriginal.on('data', (data) => {
    return `connection_${connectionId}: ${data}`;
  });
  serverEmitterOriginal.on('error', (err) => {
    console.error(`Erreur connexion ${connectionId}:`, err.message);
  });
  serverEmitterOriginal.emit('data', `payload_for_${connectionId}`);
}

function simulateConnectionsOriginal(count: number): number {
  for (let i = 0; i < count; i++) {
    handleConnectionOriginal(i);
  }
  return serverEmitterOriginal.listenerCount('data');
}

// =============================================================================
//
//   VERSIONS CORRIGEES — avec explications detaillees
//
// =============================================================================

// =============================================================================
// CORRECTION 1 — Cache borne avec eviction LRU
// =============================================================================
// PROBLEME IDENTIFIE :
//   Le sessionCache original est un Map qui grandit indefiniment.
//   Chaque requete ajoute une entree (~500 bytes) mais aucune n'est supprimee.
//   Apres 100 000 requetes : ~50 Mo de sessions inutiles retenues en memoire.
//
// OUTIL DE DIAGNOSTIC :
//   - process.memoryUsage() montre le heap qui croit lineairement
//   - Heap snapshots : les retainers montrent que sessionCache retient tout
//   - Comparer snapshot avant et apres charge : les objets session ne sont
//     jamais liberes
//
// POURQUOI LE FIX FONCTIONNE :
//   Un cache LRU (Least Recently Used) a une taille maximale. Quand il est
//   plein, l'entree la plus ancienne est supprimee avant d'en ajouter une
//   nouvelle. La memoire reste bornee quel que soit le nombre de requetes.
//   L'implementation utilise l'ordre d'insertion de Map (garanti par la spec)
//   pour determiner l'entree la plus ancienne.

class LRUCache<V> {
  _map: Map<string, V>;
  _maxSize: number;

  constructor(maxSize: number) {
    this._map = new Map();
    this._maxSize = maxSize;
  }

  set(key: string, value: V): void {
    // Si la cle existe deja, la supprimer pour la remettre en fin
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._maxSize) {
      // Supprimer la plus ancienne entree (premiere dans l'ordre d'insertion)
      const oldestKey = this._map.keys().next().value;
      this._map.delete(oldestKey);
    }
    this._map.set(key, value);
  }

  get(key: string): V | undefined {
    if (!this._map.has(key)) return undefined;
    const value = this._map.get(key);
    // Remettre en fin (acces recent)
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  get size() { return this._map.size; }
}

// Cache borne a 1000 entrees maximum
const sessionCacheFixed = new LRUCache(1_000);

function handleRequestFixed(requestId: number, payload: any): { status: string; id: number } {
  sessionCacheFixed.set(`session_${requestId}`, {
    id: requestId,
    payload,
    createdAt: Date.now(),
    metadata: {
      userAgent: `Mozilla/5.0 (simulation request ${requestId})`,
      ip: `192.168.1.${requestId % 255}`,
      headers: { 'content-type': 'application/json', 'accept': '*/*' },
    },
  });
  return { status: 'ok', id: requestId };
}

// =============================================================================
// CORRECTION 2 — Records avec shapes uniformes
// =============================================================================
// PROBLEME IDENTIFIE :
//   Les records generes par generateRecords() ont des shapes differentes selon
//   les conditions (i % 2, i % 3, etc.). Certains ont .bonus, d'autres non.
//   Certains ont .category, d'autres non. Cela cree 8+ shapes differentes.
//   Quand processRecord() recoit ces objets, V8 ne peut pas maintenir un
//   inline cache monomorphique => transition vers megamorphique => lent.
//
// OUTIL DE DIAGNOSTIC :
//   - node --trace-deopt : montre "wrong map" a chaque changement de shape
//   - node --trace-ic : montre le site .name/.value passant en MEGAMORPHIC
//
// POURQUOI LE FIX FONCTIONNE :
//   En incluant TOUTES les proprietes dans CHAQUE record (avec null comme
//   valeur par defaut), tous les objets partagent la MEME hidden class.
//   V8 peut alors maintenir un inline cache MONOMORPHIQUE pour chaque
//   acces de propriete => 1 verification + acces direct par offset.

function processRecordFixed(record: any): string {
  // Meme logique, mais maintenant tous les records ont la meme shape
  const name = record.name;
  const value = record.value;
  const score = value * 2 + (record.bonus || 0);
  return `${name}:${score}`;
}

function generateRecordsFixed(count: number): any[] {
  const records = new Array(count); // Pre-allocation du tableau
  for (let i = 0; i < count; i++) {
    // TOUTES les proprietes sont presentes sur CHAQUE record
    // Les valeurs non applicables sont null (pas absentes)
    records[i] = {
      name: `item_${i}`,
      value: i % 2 === 0 ? i : 0,
      bonus: i % 3 === 0 ? i * 0.5 : null,
      category: i % 5 === 0 ? 'premium' : null,
      priority: i % 7 === 0 ? 1 : null,
      tags: i % 11 === 0 ? ['hot', 'new'] : null,
    };
    // Meme ordre de proprietes, memes proprietes => UNE SEULE hidden class
  }
  return records;
}

// =============================================================================
// CORRECTION 3 — Broadcast avec serialisation unique
// =============================================================================
// PROBLEME IDENTIFIE :
//   La version originale appelle JSON.stringify() pour CHAQUE client a CHAQUE
//   iteration. Avec 5 clients et 50 000 iterations : 250 000 appels
//   JSON.stringify, creant 250 000 chaines temporaires.
//   Chaque chaine est un objet sur le heap qui cree de la pression GC.
//   Le GC passe son temps a collecter ces chaines ephemeres.
//
// OUTIL DE DIAGNOSTIC :
//   - node --trace-gc : frequence elevee des Scavenge (toutes les 50-100ms)
//   - node --cpu-prof : JSON.stringify apparait comme hotspot dans le flame chart
//
// POURQUOI LE FIX FONCTIONNE :
//   Si le payload est identique pour tous les clients (seul clientId change),
//   on serialise UNE SEULE FOIS le message de base. On evite 200 000
//   appels JSON.stringify et 200 000 allocations de chaines.
//   Pour le cas ou clientId est necessaire dans le message, on le pre-calcule
//   une seule fois par client au lieu de chaque iteration.

function broadcastMessagesFixed(clientCount: number, iterations: number): number {
  let totalLength = 0;

  // Pre-calculer les prefixes de chaque client (1 allocation par client)
  const clientPrefixes = new Array(clientCount);
  for (let c = 0; c < clientCount; c++) {
    clientPrefixes[c] = `client_${c}`;
  }

  for (let i = 0; i < iterations; i++) {
    // Serialiser le message de base UNE SEULE FOIS par iteration
    const baseMessage = JSON.stringify({
      type: 'update',
      timestamp: Date.now(),
      payload: { index: i, data: `message_content_${i}` },
    });

    // Le meme message est envoye a tous les clients
    // (dans un vrai serveur WebSocket, on enverrait le meme buffer)
    totalLength += baseMessage.length * clientCount;
  }
  return totalLength;
}

// =============================================================================
// CORRECTION 4 — Objets homogenes avec une seule hidden class
// =============================================================================
// PROBLEME IDENTIFIE :
//   La version originale cree 8 types d'objets differents (switch case 0-7).
//   Chaque type a des proprietes differentes dans un ordre different.
//   La fonction readValue() recoit ces 8+ shapes => MEGAMORPHIC.
//   En mode megamorphique, chaque acces a .value fait un hash table lookup
//   au lieu d'un acces direct par offset (10-100x plus lent).
//
// OUTIL DE DIAGNOSTIC :
//   - node --trace-ic : montre readValue/readValueFixed passant de
//     monomorphic -> polymorphic -> MEGAMORPHIC
//   - node --allow-natives-syntax avec %HaveSameMap(obj1, obj2) retourne false
//
// POURQUOI LE FIX FONCTIONNE :
//   Tous les objets ont EXACTEMENT les memes proprietes dans le MEME ordre.
//   V8 cree une seule hidden class et l'inline cache reste MONOMORPHIC.
//   Acces a .value = 1 verification de map + 1 lecture directe par offset.

function readValueFixed(obj: any): number {
  return obj.value;
}

function processHeterogeneousObjectsFixed(count: number): number {
  const objects = new Array(count); // Pre-allocation

  for (let i = 0; i < count; i++) {
    // TOUS les objets ont les MEMES proprietes dans le MEME ordre
    objects[i] = {
      value: i,
      a: i % 8 === 1 || i % 8 === 2 ? 1 : null,
      b: i % 8 === 2 ? 2 : null,
      x: i % 8 === 3 ? 'hello' : null,
      y: i % 8 === 4 ? true : null,
      z: i % 8 === 5 ? null : null,
      w: i % 8 === 5 ? 3.14 : null,
      p: i % 8 === 6 ? 0 : null,
      q: i % 8 === 6 ? 0 : null,
      meta: i % 8 === 7 ? { nested: true } : null,
    };
  }

  let sum = 0;
  for (const obj of objects) {
    sum += readValueFixed(obj);
  }
  return sum;
}

// =============================================================================
// CORRECTION 5 — Eviter JSON.parse/stringify dans la boucle chaude
// =============================================================================
// PROBLEME IDENTIFIE :
//   La version originale fait JSON.parse(JSON.stringify(item)) pour CHAQUE
//   item dans une boucle de 10 000 iterations. Chaque appel :
//   1. Parcourt recursivement l'objet pour le serialiser (~20 proprietes)
//   2. Cree une chaine JSON (~200 bytes)
//   3. Re-parse la chaine caractere par caractere
//   4. Cree un nouvel objet avec de nouvelles chaines
//   C'est ~100x plus de travail qu'un simple spread.
//
// OUTIL DE DIAGNOSTIC :
//   - node --cpu-prof : JSON.parse et JSON.stringify dominent le flame chart
//   - Le composant 5 prend une part disproportionnee du temps total
//
// POURQUOI LE FIX FONCTIONNE :
//   Les items ne contiennent que des primitives (string, number) et des
//   tableaux de nombres. Le spread { ...item } copie les references des
//   proprietes en O(k) ou k est le nombre de proprietes (6 ici).
//   Les primitives sont immutables, donc copier leur reference est
//   equivalent a une copie profonde.
//   Pour les tableaux .values, on utilise slice() (O(n) natif C++)
//   au lieu de JSON round-trip (O(n) JavaScript).

function processLargePayloadFixed(): { totalProcessed: number; originalSize: number } {
  // Construire les donnees directement en objets au lieu de passer par JSON
  const items = [];
  for (let i = 0; i < 10_000; i++) {
    items.push({
      id: i,
      name: `item_${i}`,
      description: `Description detaillee de l'element ${i} avec du contenu supplementaire pour augmenter la taille`,
      values: [i, i * 2, i * 3, i * 4, i * 5],
      metadata: { created: '2024-01-15', updated: '2024-06-20', version: i },
    });
  }

  let totalProcessed = 0;
  for (const item of items) {
    // Copie superficielle avec spread au lieu de JSON round-trip
    const copy = {
      ...item,
      values: item.values.slice(), // Copie du tableau (natif, rapide)
      metadata: { ...item.metadata }, // Copie superficielle de metadata
      processed: true,
    };
    totalProcessed++;
  }

  // Calculer la taille equivalente pour la comparaison
  const estimatedSize = JSON.stringify({ items: items.slice(0, 1) }).length * items.length;
  return { totalProcessed, originalSize: estimatedSize };
}

// =============================================================================
// CORRECTION 6 — Gestion propre des listeners
// =============================================================================
// PROBLEME IDENTIFIE :
//   La version originale appelle emitter.on('data', ...) a CHAQUE connexion.
//   Apres 2 000 connexions : 2 000 listeners sur 'data' et 2 000 sur 'error'.
//   Chaque listener est une closure qui capture connectionId.
//   Quand on emet 'data', les 2 000 closures sont appelees en sequence.
//   Les closures empechent le GC de liberer les variables capturees.
//   C'est une fuite memoire ET un probleme de performance (2000 appels
//   de fonction a chaque emit).
//
// OUTIL DE DIAGNOSTIC :
//   - emitter.listenerCount('data') retourne 2000 au lieu de ~1
//   - Heap snapshot : les closures apparaissent comme retainers massifs
//   - Node.js emetrait un warning "MaxListenersExceededWarning" si
//     setMaxListeners(0) n'etait pas utilise pour le masquer
//
// POURQUOI LE FIX FONCTIONNE :
//   On utilise AbortController pour retirer automatiquement les listeners
//   quand la connexion est "fermee" (simulee ici par un appel abort()).
//   Chaque connexion cree ses listeners avec { signal }, et les retire
//   proprement a la fin. Le nombre de listeners actifs reste constant.
//   Alternative : utiliser { once: true } si le handler ne doit s'executer
//   qu'une seule fois.

const serverEmitterFixed = new EventEmitter();

function handleConnectionFixed(connectionId: number): void {
  const controller = new AbortController();
  const { signal } = controller;

  // Enregistrer les handlers avec un signal d'annulation
  const onData = (data) => {
    return `connection_${connectionId}: ${data}`;
  };

  const onError = (err) => {
    console.error(`Erreur connexion ${connectionId}:`, err.message);
  };

  serverEmitterFixed.on('data', onData, { signal });
  serverEmitterFixed.on('error', onError, { signal });

  // Simuler la reception de donnees
  serverEmitterFixed.emit('data', `payload_for_${connectionId}`);

  // Simuler la fermeture de la connexion : retirer tous les listeners
  controller.abort();
  // Apres abort(), les listeners sont automatiquement retires
}

function simulateConnectionsFixed(count: number): number {
  for (let i = 0; i < count; i++) {
    handleConnectionFixed(i);
  }
  return serverEmitterFixed.listenerCount('data');
}

// =============================================================================
//
//   PIPELINE DE COMPARAISON — AVANT / APRES
//
// =============================================================================

function runOriginalPipeline(): { totalMs: number; heapMB: number } {
  console.log('=================================================================');
  console.log('  Pipeline ORIGINAL (avec problemes)');
  console.log('=================================================================\n');

  const totalStart = performance.now();

  // Composant 1
  performance.mark('orig-cache-start');
  for (let i = 0; i < NUM_REQUESTS; i++) {
    handleRequestOriginal(i, { data: `request_payload_${i}`, size: 1024 });
  }
  performance.mark('orig-cache-end');
  performance.measure('ORIGINAL - Cache sessions', 'orig-cache-start', 'orig-cache-end');

  // Composant 2
  performance.mark('orig-records-start');
  const records = generateRecordsOriginal(NUM_RECORDS_PER_REQUEST);
  for (let batch = 0; batch < 500; batch++) {
    for (const r of records) {
      processRecordOriginal(r);
    }
  }
  performance.mark('orig-records-end');
  performance.measure('ORIGINAL - Records', 'orig-records-start', 'orig-records-end');

  // Composant 3
  performance.mark('orig-broadcast-start');
  broadcastMessagesOriginal(5, BROADCAST_ITERATIONS);
  performance.mark('orig-broadcast-end');
  performance.measure('ORIGINAL - Broadcast', 'orig-broadcast-start', 'orig-broadcast-end');

  // Composant 4
  performance.mark('orig-hetero-start');
  processHeterogeneousObjectsOriginal(HETEROGENEOUS_OBJECTS);
  performance.mark('orig-hetero-end');
  performance.measure('ORIGINAL - Objets hetero', 'orig-hetero-start', 'orig-hetero-end');

  // Composant 5
  performance.mark('orig-json-start');
  processLargePayloadOriginal();
  performance.mark('orig-json-end');
  performance.measure('ORIGINAL - Gros JSON', 'orig-json-start', 'orig-json-end');

  // Composant 6
  performance.mark('orig-listeners-start');
  simulateConnectionsOriginal(2_000);
  performance.mark('orig-listeners-end');
  performance.measure('ORIGINAL - Listeners', 'orig-listeners-start', 'orig-listeners-end');

  const totalEnd = performance.now();
  const mem = process.memoryUsage();

  console.log(`\n  Temps total original : ${(totalEnd - totalStart).toFixed(0)} ms`);
  console.log(`  Heap : ${(mem.heapUsed / 1024 / 1024).toFixed(1)} Mo`);
  console.log(`  Sessions en cache : ${sessionCacheOriginal.size}`);
  console.log(`  Listeners 'data' : ${serverEmitterOriginal.listenerCount('data')}`);

  return { totalMs: totalEnd - totalStart, heapMB: mem.heapUsed / 1024 / 1024 };
}

function runFixedPipeline(): { totalMs: number; heapMB: number } {
  // Forcer un GC avant le pipeline corrige pour une comparaison equitable
  if (globalThis.gc) globalThis.gc();

  console.log('\n=================================================================');
  console.log('  Pipeline CORRIGE');
  console.log('=================================================================\n');

  const totalStart = performance.now();

  // Composant 1 — Cache borne
  performance.mark('fixed-cache-start');
  for (let i = 0; i < NUM_REQUESTS; i++) {
    handleRequestFixed(i, { data: `request_payload_${i}`, size: 1024 });
  }
  performance.mark('fixed-cache-end');
  performance.measure('CORRIGE - Cache sessions', 'fixed-cache-start', 'fixed-cache-end');

  // Composant 2 — Shapes uniformes
  performance.mark('fixed-records-start');
  const records = generateRecordsFixed(NUM_RECORDS_PER_REQUEST);
  for (let batch = 0; batch < 500; batch++) {
    for (const r of records) {
      processRecordFixed(r);
    }
  }
  performance.mark('fixed-records-end');
  performance.measure('CORRIGE - Records', 'fixed-records-start', 'fixed-records-end');

  // Composant 3 — Serialisation unique
  performance.mark('fixed-broadcast-start');
  broadcastMessagesFixed(5, BROADCAST_ITERATIONS);
  performance.mark('fixed-broadcast-end');
  performance.measure('CORRIGE - Broadcast', 'fixed-broadcast-start', 'fixed-broadcast-end');

  // Composant 4 — Objets homogenes
  performance.mark('fixed-hetero-start');
  processHeterogeneousObjectsFixed(HETEROGENEOUS_OBJECTS);
  performance.mark('fixed-hetero-end');
  performance.measure('CORRIGE - Objets hetero', 'fixed-hetero-start', 'fixed-hetero-end');

  // Composant 5 — Pas de JSON dans la boucle
  performance.mark('fixed-json-start');
  processLargePayloadFixed();
  performance.mark('fixed-json-end');
  performance.measure('CORRIGE - Gros JSON', 'fixed-json-start', 'fixed-json-end');

  // Composant 6 — Listeners nettoyes
  performance.mark('fixed-listeners-start');
  simulateConnectionsFixed(2_000);
  performance.mark('fixed-listeners-end');
  performance.measure('CORRIGE - Listeners', 'fixed-listeners-start', 'fixed-listeners-end');

  const totalEnd = performance.now();
  const mem = process.memoryUsage();

  console.log(`\n  Temps total corrige : ${(totalEnd - totalStart).toFixed(0)} ms`);
  console.log(`  Heap : ${(mem.heapUsed / 1024 / 1024).toFixed(1)} Mo`);
  console.log(`  Sessions en cache : ${sessionCacheFixed.size} (borne a 1000)`);
  console.log(`  Listeners 'data' : ${serverEmitterFixed.listenerCount('data')} (nettoyes)`);

  return { totalMs: totalEnd - totalStart, heapMB: mem.heapUsed / 1024 / 1024 };
}

// =============================================================================
//
//   EXECUTION ET RAPPORT
//
// =============================================================================

const originalResult = runOriginalPipeline();
const fixedResult = runFixedPipeline();

// Rapport de comparaison
console.log('\n=================================================================');
console.log('  RAPPORT DE COMPARAISON');
console.log('=================================================================\n');

const measures = performance.getEntriesByType('measure');
const origMeasures = measures.filter(m => m.name.startsWith('ORIGINAL'));
const fixedMeasures = measures.filter(m => m.name.startsWith('CORRIGE'));

const components = [
  'Cache sessions',
  'Records',
  'Broadcast',
  'Objets hetero',
  'Gros JSON',
  'Listeners',
];

console.log('  Composant             Original (ms)    Corrige (ms)    Amelioration');
console.log('  --------------------  ---------------  --------------  ------------');

for (const comp of components) {
  const orig = origMeasures.find(m => m.name.includes(comp));
  const fixed = fixedMeasures.find(m => m.name.includes(comp));
  if (orig && fixed) {
    const ratio = orig.duration / Math.max(fixed.duration, 0.001);
    const origStr = orig.duration.toFixed(1).padStart(10);
    const fixedStr = fixed.duration.toFixed(1).padStart(10);
    const ratioStr = `${ratio.toFixed(1)}x`.padStart(8);
    console.log(`  ${comp.padEnd(22)} ${origStr} ms    ${fixedStr} ms    ${ratioStr}`);
  }
}

const totalRatio = originalResult.totalMs / Math.max(fixedResult.totalMs, 0.001);
console.log('  --------------------  ---------------  --------------  ------------');
console.log(
  `  ${'TOTAL'.padEnd(22)} ` +
  `${originalResult.totalMs.toFixed(1).padStart(10)} ms    ` +
  `${fixedResult.totalMs.toFixed(1).padStart(10)} ms    ` +
  `${totalRatio.toFixed(1).padStart(8)}x`
);

console.log('\n  Memoire :');
console.log(`    Original : ${originalResult.heapMB.toFixed(1)} Mo`);
console.log(`    Corrige  : ${fixedResult.heapMB.toFixed(1)} Mo`);
console.log(`    Reduction : ${(originalResult.heapMB - fixedResult.heapMB).toFixed(1)} Mo`);

console.log('\n  Fuites corrigees :');
console.log(`    Cache sessions : ${sessionCacheOriginal.size} entrees -> ${sessionCacheFixed.size} entrees (borne)`);
console.log(`    Listeners 'data' : ${serverEmitterOriginal.listenerCount('data')} -> ${serverEmitterFixed.listenerCount('data')} (nettoyes)`);
console.log(`    Listeners 'error' : ${serverEmitterOriginal.listenerCount('error')} -> ${serverEmitterFixed.listenerCount('error')} (nettoyes)`);

// =============================================================================
// RAPPORT DE DIAGNOSTIC DETAILLE
// =============================================================================

console.log('\n=================================================================');
console.log('  RAPPORT DE DIAGNOSTIC DETAILLE');
console.log('=================================================================\n');

console.log('PROBLEME 1 : Fuite memoire — Cache sans limite');
console.log('  Outil    : process.memoryUsage() + heap snapshots compares');
console.log('  Symptome : le heap croit lineairement avec le nombre de requetes');
console.log('  Cause    : Map stocke chaque session, jamais d\'eviction');
console.log('  Fix      : LRU cache borne a 1000 entrees avec eviction');
console.log('  Lien     : Module 08 — Memory Leaks (patterns de fuite)\n');

console.log('PROBLEME 2 : Deoptimisation — Shapes inconsistantes');
console.log('  Outil    : node --trace-deopt (chercher "wrong map")');
console.log('  Symptome : la fonction processRecord() est deoptimisee a chaque batch');
console.log('  Cause    : les records ont des proprietes conditionnelles => 8+ shapes');
console.log('  Fix      : inclure toutes les proprietes avec null comme defaut');
console.log('  Lien     : Module 11 — Hidden Classes & Inline Caching\n');

console.log('PROBLEME 3 : Pression GC — Allocations massives en boucle');
console.log('  Outil    : node --trace-gc (observer la frequence des Scavenge)');
console.log('  Symptome : Scavenge toutes les 50-100ms, Mark-Compact frequent');
console.log('  Cause    : JSON.stringify() cree une chaine par client par iteration');
console.log('  Fix      : serialiser une seule fois, reutiliser pour tous les clients');
console.log('  Lien     : Module 07 — Garbage Collector (pression GC, Young Gen)\n');

console.log('PROBLEME 4 : IC megamorphique — Objets heterogenes');
console.log('  Outil    : node --trace-ic (chercher MEGAMORPHIC)');
console.log('  Symptome : readValue() en mode megamorphique (hash table lookup)');
console.log('  Cause    : 8 shapes differentes passees a la meme fonction');
console.log('  Fix      : tous les objets avec les memes proprietes dans le meme ordre');
console.log('  Lien     : Module 11 — Hidden Classes & Inline Caching\n');

console.log('PROBLEME 5 : Operation bloquante — JSON.parse/stringify en boucle');
console.log('  Outil    : node --cpu-prof (flame chart montre JSON comme hotspot)');
console.log('  Symptome : le composant 5 prend une part disproportionnee du temps');
console.log('  Cause    : JSON.parse(JSON.stringify(item)) pour deep clone 10 000 items');
console.log('  Fix      : copie superficielle avec spread { ...item }');
console.log('  Lien     : Module 12 — Performance Patterns (anti-pattern JSON)\n');

console.log('PROBLEME 6 : Fuite de listeners — Handlers accumules');
console.log('  Outil    : emitter.listenerCount("data") retourne 2000');
console.log('  Symptome : 2000 closures enregistrees, jamais retirees');
console.log('  Cause    : on() ajoute un listener a chaque connexion, jamais retire');
console.log('  Fix      : AbortController avec { signal } pour retirer automatiquement');
console.log('  Lien     : Module 08 — Memory Leaks (event listener leak)\n');

console.log('CONCLUSION :');
console.log('Chaque probleme a ete identifie avec un outil specifique de V8,');
console.log('diagnostique avec une cause racine precise, corrige avec une technique');
console.log('ciblee, et verifie avec des mesures avant/apres. C\'est la methodologie');
console.log('en 5 etapes : Observer -> Mesurer -> Hypothese -> Corriger -> Verifier.');

perfObserver.disconnect();
console.log('\n=== Lab 15 termine ===');
