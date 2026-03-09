// =============================================================================
// Lab 08 — Detection de fuites memoire
// =============================================================================
// Lancer avec : node --import tsx/esm --max-old-space-size=100 exercise.ts
//
// Ce programme simule un serveur qui traite des requetes.
// Il contient 5 fuites memoire intentionnelles.
//
// Votre mission :
//   1. Identifier chaque fuite (cherchez "FUITE 1" a "FUITE 5")
//   2. Expliquer POURQUOI ca fuit dans un commentaire
//   3. Corriger la fuite
//   4. Verifier que la memoire se stabilise
// =============================================================================

import { EventEmitter } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Utilitaire : surveillance memoire (affiche heapUsed toutes les secondes)
// ---------------------------------------------------------------------------
function monitorMemory(): ReturnType<typeof setInterval> {
  const baseline = process.memoryUsage().heapUsed;
  let tick = 0;

  setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const rssMB = (mem.rss / 1024 / 1024).toFixed(2);
    const deltaMB = ((mem.heapUsed - baseline) / 1024 / 1024).toFixed(2);
    tick++;
    console.log(
      `[memoire] tick=${tick}  heap=${heapMB} MB  rss=${rssMB} MB  delta=${deltaMB} MB`
    );
  }, 1000);
}

// ===========================================================================
// FUITE 1 — Cache de sessions (Map croissante sans TTL)
// ===========================================================================
// Ce cache stocke les sessions utilisateur. En production, on en cree
// des milliers par seconde mais on ne les supprime jamais.

const sessionCache = new Map();

function handleRequest(userId: string): void {
  // Chaque requete cree ou met a jour la session
  const sessionData = {
    userId,
    token: randomUUID(),
    data: randomBytes(1024).toString("hex"), // 2 Ko par session
    createdAt: Date.now(),
  };

  // TODO FUITE 1 : Cette ligne ajoute sans cesse des entrees.
  // Expliquez pourquoi c'est une fuite et corrigez.
  // 💡 Indice : la cle est un UUID aleatoire different a chaque appel.
  //    Meme si userId est le meme, une NOUVELLE entree est creee a chaque fois.
  //    Pensez a utiliser userId comme cle, et/ou limiter la taille du cache.
  sessionCache.set(randomUUID(), sessionData);
}

// ===========================================================================
// FUITE 2 — Ecouteurs d'evenements ajoutes dans une boucle
// ===========================================================================
// On cree un EventEmitter partage et on attache un listener a chaque "connexion".

const bus = new EventEmitter();
// Desactiver l'avertissement par defaut pour observer la fuite
bus.setMaxListeners(0);

function onNewConnection(connectionId: string): void {
  // TODO FUITE 2 : Un listener est ajoute a chaque connexion mais jamais retire.
  // Expliquez pourquoi c'est une fuite et corrigez.
  // 💡 Indice : chaque handler capture `connectionId` et alloue un Buffer de 4 Ko.
  //    Apres le traitement, le listener reste attache au bus indefiniment.
  //    Pensez a utiliser bus.once() ou a retirer le listener apres usage.
  const handler = (event) => {
    // Chaque handler capture connectionId et un buffer dans sa closure
    const metadata = Buffer.alloc(4096);
    if (event.target === connectionId) {
      // traitement...
    }
  };

  bus.on("data", handler);

  // Simuler un traitement de la connexion
  bus.emit("data", { target: connectionId, payload: "ping" });
}

// ===========================================================================
// FUITE 3 — Closure retenant un gros buffer
// ===========================================================================
// Cette fonction cree un "logger" pour chaque requete. Le probleme :
// la closure capture involontairement un enorme buffer.

function createRequestLogger(requestId: number): () => string {
  // Ce buffer de 1 Mo simule un gros objet temporaire
  const hugeBuffer = Buffer.alloc(1024 * 1024);

  // On remplit le buffer (simule un traitement)
  hugeBuffer.write(`Request ${requestId} processing data...`);

  // TODO FUITE 3 : La fonction renvoyee capture `hugeBuffer` dans sa closure
  // meme si elle n'utilise que `requestId`.
  // Expliquez pourquoi c'est une fuite et corrigez.
  // 💡 Indice : la closure reference `hugeBuffer.length` directement.
  //    Extrayez les donnees necessaires (ex: la taille) dans une variable
  //    locale AVANT de creer la closure, pour que le buffer puisse etre libere.
  const logger = () => {
    // On voudrait juste loguer le requestId, mais la closure garde
    // une reference au scope entier, donc a `hugeBuffer`
    const msg = `[LOG] Requete ${requestId} traitee, buffer size = ${hugeBuffer.length}`;
    return msg;
  };

  return logger;
}

// Stockage des loggers actifs
const activeLoggers = [];

// ===========================================================================
// FUITE 4 — setInterval capturant un tableau grandissant
// ===========================================================================
// Un "worker" periodique qui accumule des resultats dans un tableau
// capture par la callback du setInterval.

function startMetricsCollector() {
  const collectedMetrics = [];

  // TODO FUITE 4 : Le setInterval maintient `collectedMetrics` en vie
  // et ce tableau grandit indefiniment.
  // Expliquez pourquoi c'est une fuite et corrigez.
  // 💡 Indice : le tableau n'est JAMAIS vide. Pensez a limiter sa taille
  //    (ex: garder seulement les N dernieres metriques avec splice ou shift),
  //    ou a traiter et vider le tableau periodiquement.
  const intervalId = setInterval(() => {
    // Collecter une metrique a chaque tick
    const metric = {
      timestamp: Date.now(),
      cpuUsage: process.cpuUsage(),
      memory: process.memoryUsage(),
      randomPayload: randomBytes(512).toString("hex"),
    };

    collectedMetrics.push(metric);

    // On "traite" les metriques (mais on ne vide jamais le tableau)
    if (collectedMetrics.length % 100 === 0) {
      console.log(
        `[metrics] ${collectedMetrics.length} metriques collectees (taille tableau en memoire)`
      );
    }
  }, 10);

  return intervalId;
}

// ===========================================================================
// FUITE 5 — Reference circulaire avec ressource externe
// ===========================================================================
// Deux objets se referencent mutuellement. Normalement le GC Mark-and-Sweep
// gere ca, MAIS un des objets detient un timer qui empeche la collecte.

class Server {
  name: string;
  connections: any[];
  handler: RequestHandler | null;

  constructor(name: string) {
    this.name = name;
    this.connections = [];
    this.handler = null; // Reference vers le RequestHandler
  }
}

class RequestHandler {
  server: Server | null;
  buffer: Buffer | null;
  processedCount: number;
  intervalId: ReturnType<typeof setInterval> | null;

  constructor(server: Server) {
    // TODO FUITE 5 : Reference circulaire + timer qui maintient tout en vie.
    // Le RequestHandler reference le Server, qui reference le RequestHandler.
    // Le timer empeche le GC de collecter l'ensemble.
    // Expliquez pourquoi c'est une fuite et corrigez.
    // 💡 Indice : le setInterval garde une reference a `this` (le RequestHandler),
    //    ce qui empeche le GC de collecter le cycle entier.
    //    Ajoutez une methode `destroy()` qui appelle clearInterval(this.intervalId)
    //    et casse les references circulaires (this.server = null, etc.).
    this.server = server;
    server.handler = this;
    this.buffer = Buffer.alloc(512 * 1024); // 512 Ko
    this.processedCount = 0;

    // Ce timer garde une reference a `this` (le RequestHandler)
    // ce qui garde aussi le Server en vie, et vice-versa
    this.intervalId = setInterval(() => {
      this.processedCount++;
      // Simule un traitement periodique
      this.buffer!.write(`Processed: ${this.processedCount}`, 0);
    }, 50);
  }
}

// Stockage des paires serveur/handler qu'on "oublie" de nettoyer
const activeServers = [];

// ===========================================================================
// Boucle principale — simule l'activite du serveur
// ===========================================================================

function simulateServerActivity() {
  let requestCount = 0;

  // Demarrer la surveillance memoire
  monitorMemory();

  // Demarrer le collecteur de metriques (FUITE 4)
  const metricsInterval = startMetricsCollector();

  // Simuler des requetes entrantes toutes les 5ms
  const mainLoop = setInterval(() => {
    requestCount++;

    // --- FUITE 1 : Creer une session a chaque requete ---
    const userId = `user-${requestCount % 1000}`;
    handleRequest(userId);

    // --- FUITE 2 : Nouvelle connexion ---
    if (requestCount % 3 === 0) {
      onNewConnection(`conn-${requestCount}`);
    }

    // --- FUITE 3 : Creer un logger par requete ---
    if (requestCount % 5 === 0) {
      const logger = createRequestLogger(requestCount);
      activeLoggers.push(logger);
      // On n'enleve jamais les vieux loggers du tableau
    }

    // --- FUITE 5 : Creer des paires serveur/handler ---
    if (requestCount % 50 === 0) {
      const server = new Server(`srv-${requestCount}`);
      const handler = new RequestHandler(server);
      activeServers.push({ server, handler });
      // Les anciennes paires ne sont jamais nettoyees, les timers tournent toujours
    }

    // Affichage periodique
    if (requestCount % 500 === 0) {
      console.log(
        `[serveur] ${requestCount} requetes traitees | sessions=${sessionCache.size} | loggers=${activeLoggers.length} | serveurs=${activeServers.length} | listeners(bus)=${bus.listenerCount("data")}`
      );
    }
  }, 5);

  // Arret propre apres 60 secondes (si on survit jusque la)
  setTimeout(() => {
    clearInterval(mainLoop);
    clearInterval(metricsInterval);
    console.log("\n=== Fin de la simulation ===");
    console.log(`Total requetes : ${requestCount}`);
    console.log(`Sessions en cache : ${sessionCache.size}`);
    console.log(`Loggers actifs : ${activeLoggers.length}`);
    console.log(`Serveurs actifs : ${activeServers.length}`);
    console.log(`Listeners sur bus : ${bus.listenerCount("data")}`);
    const mem = process.memoryUsage();
    console.log(
      `Memoire heap : ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`
    );
    process.exit(0);
  }, 60_000);
}

// Lancer la simulation
console.log("=== Demarrage du serveur simule (5 fuites memoire cachees) ===");
console.log("Observez la memoire augmenter...\n");
simulateServerActivity();
