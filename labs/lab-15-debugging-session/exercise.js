// =============================================================================
// Lab 15 — Diagnostic de performance
// =============================================================================
// Ce programme simule un serveur Node.js avec 6 problemes de performance
// intentionnels. Votre mission : les identifier avec les outils V8,
// les diagnostiquer, les corriger, et verifier vos corrections.
//
// Commandes utiles :
//   node exercise.js                          (observer les symptomes)
//   node --trace-gc exercise.js               (tracer le GC)
//   node --trace-deopt exercise.js            (tracer les deoptimisations)
//   node --trace-ic exercise.js               (tracer les inline caches)
//   node --cpu-prof exercise.js               (profiling CPU)
//   node --expose-gc exercise.js              (forcer le GC pour observer la memoire)
// =============================================================================

import { performance, PerformanceObserver } from 'node:perf_hooks';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Observer pour les mesures performance.mark / performance.measure
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

// ============================================================================
// COMPOSANT 1 — Cache de sessions (PROBLEME : fuite memoire)
// ============================================================================
// Ce cache stocke les sessions de chaque "requete" simulee.
// TODO DIAGNOSTIC : quel est le probleme avec ce cache ?
// TODO DIAGNOSTIC : quel outil revele le probleme ?

const sessionCache = new Map();

function handleRequest(requestId, payload) {
  // Stocker chaque session dans le cache
  sessionCache.set(`session_${requestId}`, {
    id: requestId,
    payload,
    createdAt: Date.now(),
    metadata: {
      userAgent: `Mozilla/5.0 (simulation request ${requestId})`,
      ip: `192.168.1.${requestId % 255}`,
      headers: { 'content-type': 'application/json', 'accept': '*/*' },
    },
  });

  // Traiter la requete...
  return { status: 'ok', id: requestId };
}

// ============================================================================
// COMPOSANT 2 — Traitement de records (PROBLEME : deoptimisation)
// ============================================================================
// Cette fonction traite des records provenant de differentes sources.
// TODO DIAGNOSTIC : pourquoi cette fonction est-elle lente ?
// TODO DIAGNOSTIC : quel flag V8 revele le probleme ?

function processRecord(record) {
  const name = record.name;
  const value = record.value;
  const score = value * 2 + (record.bonus || 0);
  return `${name}:${score}`;
}

function generateRecords(count) {
  const records = [];
  for (let i = 0; i < count; i++) {
    // Chaque record a une shape differente selon la condition
    const r = { name: `item_${i}` };
    if (i % 2 === 0) r.value = i;
    if (i % 3 === 0) r.bonus = i * 0.5;
    if (i % 5 === 0) r.category = 'premium';
    if (i % 7 === 0) r.priority = 1;
    if (i % 11 === 0) r.tags = ['hot', 'new'];
    // Certains records n'ont PAS de .value
    if (r.value === undefined) r.value = 0;
    records.push(r);
  }
  return records;
}

// ============================================================================
// COMPOSANT 3 — Broadcast de messages (PROBLEME : pression GC)
// ============================================================================
// Cette fonction simule l'envoi de messages a des clients WebSocket.
// TODO DIAGNOSTIC : pourquoi genere-t-elle une forte pression GC ?
// TODO DIAGNOSTIC : quel flag V8 revele le probleme ?

function broadcastMessages(clientCount, iterations) {
  let totalLength = 0;
  for (let i = 0; i < iterations; i++) {
    for (let c = 0; c < clientCount; c++) {
      // Construire un message personnalise pour chaque client
      const message = JSON.stringify({
        type: 'update',
        timestamp: Date.now(),
        clientId: `client_${c}`,
        payload: {
          index: i,
          data: `message_content_${i}_for_client_${c}`,
        },
      });
      totalLength += message.length;
    }
  }
  return totalLength;
}

// ============================================================================
// COMPOSANT 4 — Traitement d'objets heterogenes (PROBLEME : IC megamorphique)
// ============================================================================
// Cette fonction lit la propriete .value de differents types d'objets.
// TODO DIAGNOSTIC : pourquoi l'acces a .value est-il lent ?
// TODO DIAGNOSTIC : quel flag V8 revele le probleme ?

function readValue(obj) {
  return obj.value;
}

function processHeterogeneousObjects(count) {
  // Creer des objets avec des shapes tres differentes
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
    sum += readValue(obj);
  }
  return sum;
}

// ============================================================================
// COMPOSANT 5 — Traitement de gros JSON (PROBLEME : operation bloquante)
// ============================================================================
// Cette fonction parse un gros JSON de maniere synchrone dans le chemin
// de traitement de chaque requete.
// TODO DIAGNOSTIC : pourquoi bloque-t-elle l'event loop ?
// TODO DIAGNOSTIC : quel outil revele le probleme ?

function buildLargeJSON(size) {
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

function processLargePayload() {
  // Construire un gros JSON (~5 Mo)
  const largeJsonString = buildLargeJSON(10_000);

  // Parser le JSON COMPLET de maniere synchrone
  // puis le re-serialiser pour chaque "reponse"
  const parsed = JSON.parse(largeJsonString);

  let totalProcessed = 0;
  for (const item of parsed.items) {
    // Deep clone inutile via JSON round-trip
    const copy = JSON.parse(JSON.stringify(item));
    copy.processed = true;
    totalProcessed++;
  }

  return { totalProcessed, originalSize: largeJsonString.length };
}

// ============================================================================
// COMPOSANT 6 — Gestionnaire d'evenements (PROBLEME : fuite de listeners)
// ============================================================================
// Ce systeme simule un serveur qui enregistre des handlers par "connexion".
// TODO DIAGNOSTIC : quel est le probleme avec la gestion des listeners ?
// TODO DIAGNOSTIC : comment le detecter ?

const serverEmitter = new EventEmitter();
// Augmenter la limite pour eviter le warning (masque le probleme !)
serverEmitter.setMaxListeners(0);

function handleConnection(connectionId) {
  // Enregistrer un handler pour chaque connexion
  serverEmitter.on('data', (data) => {
    // Traitement des donnees pour cette connexion
    const result = `connection_${connectionId}: ${data}`;
    return result;
  });

  serverEmitter.on('error', (err) => {
    console.error(`Erreur connexion ${connectionId}:`, err.message);
  });

  // Simuler la reception de donnees
  serverEmitter.emit('data', `payload_for_${connectionId}`);
}

function simulateConnections(count) {
  for (let i = 0; i < count; i++) {
    handleConnection(i);
  }
  return serverEmitter.listenerCount('data');
}

// ============================================================================
// PIPELINE PRINCIPAL — Execute tous les composants
// ============================================================================

function runDiagnosticPipeline() {
  console.log('=================================================================');
  console.log('  Lab 15 — Simulateur de serveur avec 6 problemes de performance');
  console.log('=================================================================\n');

  const totalStart = performance.now();

  // --- Composant 1 : Cache de sessions ---
  console.log('--- Composant 1 : Cache de sessions ---');
  performance.mark('cache-start');
  for (let i = 0; i < NUM_REQUESTS; i++) {
    handleRequest(i, { data: `request_payload_${i}`, size: 1024 });
  }
  performance.mark('cache-end');
  performance.measure('Cache de sessions', 'cache-start', 'cache-end');

  const mem1 = process.memoryUsage();
  console.log(`  Sessions en cache : ${sessionCache.size}`);
  console.log(`  Heap utilise : ${(mem1.heapUsed / 1024 / 1024).toFixed(1)} Mo\n`);

  // --- Composant 2 : Traitement de records ---
  console.log('--- Composant 2 : Traitement de records ---');
  performance.mark('records-start');
  const records = generateRecords(NUM_RECORDS_PER_REQUEST);
  let recordResults = 0;
  // Traiter les records de maniere repetee pour chauffer V8
  for (let batch = 0; batch < 500; batch++) {
    for (const r of records) {
      processRecord(r);
      recordResults++;
    }
  }
  performance.mark('records-end');
  performance.measure('Traitement de records', 'records-start', 'records-end');
  console.log(`  Records traites : ${recordResults}\n`);

  // --- Composant 3 : Broadcast de messages ---
  console.log('--- Composant 3 : Broadcast de messages ---');
  performance.mark('broadcast-start');
  const broadcastSize = broadcastMessages(5, BROADCAST_ITERATIONS);
  performance.mark('broadcast-end');
  performance.measure('Broadcast de messages', 'broadcast-start', 'broadcast-end');
  console.log(`  Taille totale broadcastee : ${(broadcastSize / 1024 / 1024).toFixed(1)} Mo\n`);

  // --- Composant 4 : Objets heterogenes ---
  console.log('--- Composant 4 : Objets heterogenes ---');
  performance.mark('hetero-start');
  const heteroSum = processHeterogeneousObjects(HETEROGENEOUS_OBJECTS);
  performance.mark('hetero-end');
  performance.measure('Objets heterogenes', 'hetero-start', 'hetero-end');
  console.log(`  Somme calculee : ${heteroSum}\n`);

  // --- Composant 5 : Gros JSON ---
  console.log('--- Composant 5 : Traitement gros JSON ---');
  performance.mark('json-start');
  const jsonResult = processLargePayload();
  performance.mark('json-end');
  performance.measure('Traitement gros JSON', 'json-start', 'json-end');
  console.log(`  Items traites : ${jsonResult.totalProcessed}`);
  console.log(`  Taille JSON originale : ${(jsonResult.originalSize / 1024).toFixed(0)} Ko\n`);

  // --- Composant 6 : Listeners ---
  console.log('--- Composant 6 : Gestionnaire de connexions ---');
  performance.mark('listeners-start');
  const listenerCount = simulateConnections(2_000);
  performance.mark('listeners-end');
  performance.measure('Gestionnaire de connexions', 'listeners-start', 'listeners-end');
  console.log(`  Listeners 'data' enregistres : ${listenerCount}`);
  console.log(`  Listeners 'error' enregistres : ${serverEmitter.listenerCount('error')}\n`);

  // --- Resume ---
  const totalEnd = performance.now();
  const mem2 = process.memoryUsage();

  console.log('=================================================================');
  console.log('  Resume');
  console.log('=================================================================');
  console.log(`  Temps total : ${(totalEnd - totalStart).toFixed(0)} ms`);
  console.log(`  Heap final : ${(mem2.heapUsed / 1024 / 1024).toFixed(1)} Mo`);
  console.log(`  RSS final : ${(mem2.rss / 1024 / 1024).toFixed(1)} Mo`);
  console.log(`  Sessions en cache : ${sessionCache.size}`);
  console.log(`  Listeners 'data' : ${serverEmitter.listenerCount('data')}`);
  console.log(`  Listeners 'error' : ${serverEmitter.listenerCount('error')}`);
}

runDiagnosticPipeline();

// =============================================================================
// PARTIE 1 — Diagnostic (a remplir par l'etudiant)
// =============================================================================
// Lancez le programme avec les differents flags V8 et notez vos observations.
//
// Probleme 1 (Cache de sessions) :
//   Outil utilise    : _________________________________________________
//   Observation      : _________________________________________________
//   Cause racine     : _________________________________________________
//
// Probleme 2 (Traitement de records) :
//   Outil utilise    : _________________________________________________
//   Observation      : _________________________________________________
//   Cause racine     : _________________________________________________
//
// Probleme 3 (Broadcast de messages) :
//   Outil utilise    : _________________________________________________
//   Observation      : _________________________________________________
//   Cause racine     : _________________________________________________
//
// Probleme 4 (Objets heterogenes) :
//   Outil utilise    : _________________________________________________
//   Observation      : _________________________________________________
//   Cause racine     : _________________________________________________
//
// Probleme 5 (Gros JSON) :
//   Outil utilise    : _________________________________________________
//   Observation      : _________________________________________________
//   Cause racine     : _________________________________________________
//
// Probleme 6 (Listeners) :
//   Outil utilise    : _________________________________________________
//   Observation      : _________________________________________________
//   Cause racine     : _________________________________________________

// =============================================================================
// PARTIE 2 — Corrections (a implementer par l'etudiant)
// =============================================================================
// Pour chaque probleme, ecrivez une version corrigee ci-dessous.
// Utilisez performance.mark/measure pour mesurer l'amelioration.

// TODO FIX 1 : Corriger le cache de sessions
//   Indice : le cache doit avoir une taille maximale
//   function handleRequestFixed(requestId, payload) { ... }

// TODO FIX 2 : Corriger le traitement de records
//   Indice : tous les records doivent avoir la meme shape
//   function generateRecordsFixed(count) { ... }

// TODO FIX 3 : Corriger le broadcast de messages
//   Indice : ne pas creer un message par client si le contenu est identique
//   function broadcastMessagesFixed(clientCount, iterations) { ... }

// TODO FIX 4 : Corriger les objets heterogenes
//   Indice : tous les objets doivent partager la meme hidden class
//   function processHeterogeneousObjectsFixed(count) { ... }

// TODO FIX 5 : Corriger le traitement du gros JSON
//   Indice : eviter JSON.parse/stringify dans la boucle chaude
//   function processLargePayloadFixed() { ... }

// TODO FIX 6 : Corriger la fuite de listeners
//   Indice : utiliser { once: true }, removeListener, ou AbortController
//   function handleConnectionFixed(connectionId) { ... }

// =============================================================================
// PARTIE 3 — Pipeline corrige (a implementer par l'etudiant)
// =============================================================================
// Ecrivez runFixedPipeline() qui utilise les fonctions corrigees.
// Comparez les resultats avec le pipeline original.

// function runFixedPipeline() {
//   console.log('=== Pipeline CORRIGE ===');
//   // TODO : reimplementer le pipeline avec les fonctions *Fixed
//   // TODO : ajouter performance.mark/measure pour chaque composant
//   // TODO : afficher la comparaison avant/apres
// }

// Decommentez quand les fixes sont implementes :
// performance.clearMarks();
// performance.clearMeasures();
// runFixedPipeline();

perfObserver.disconnect();
console.log('\n=== Lab 15 termine ===');
