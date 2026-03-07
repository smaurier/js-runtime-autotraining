// =============================================================================
// Lab 08 — Detection de fuites memoire (SOLUTION)
// =============================================================================
// Lancer avec : node --max-old-space-size=100 solution.js
//
// Toutes les 5 fuites sont identifiees, expliquees et corrigees.
// La memoire doit se stabiliser apres quelques secondes.
// =============================================================================

import { EventEmitter } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Utilitaire : surveillance memoire
// ---------------------------------------------------------------------------
function monitorMemory() {
  const baseline = process.memoryUsage().heapUsed;
  let tick = 0;

  const id = setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const rssMB = (mem.rss / 1024 / 1024).toFixed(2);
    const deltaMB = ((mem.heapUsed - baseline) / 1024 / 1024).toFixed(2);
    tick++;
    console.log(
      `[memoire] tick=${tick}  heap=${heapMB} MB  rss=${rssMB} MB  delta=${deltaMB} MB`
    );
  }, 1000);

  return id;
}

// ===========================================================================
// CORRECTION FUITE 1 — Cache de sessions avec TTL et taille max
// ===========================================================================
// EXPLICATION : La Map `sessionCache` recevait de nouvelles entrees a chaque
// requete (avec randomUUID() comme cle, donc jamais de cle en double) mais
// aucune entree n'etait jamais supprimee. La Map grandissait indefiniment.
//
// CORRECTION : On utilise le userId comme cle (pas un UUID aleatoire) pour
// eviter les doublons, et on ajoute un mecanisme de TTL + taille max
// qui purge regulierement les sessions expirees.

const sessionCache = new Map();
const SESSION_TTL_MS = 5_000; // 5 secondes
const SESSION_MAX_SIZE = 500;

function handleRequest(userId) {
  const sessionData = {
    userId,
    token: randomUUID(),
    data: randomBytes(1024).toString("hex"),
    createdAt: Date.now(),
  };

  // CORRECTION : utiliser userId comme cle (ecrase l'ancien au lieu d'accumuler)
  sessionCache.set(userId, sessionData);

  // Purge periodique des sessions expirees
  if (sessionCache.size > SESSION_MAX_SIZE) {
    const now = Date.now();
    for (const [key, session] of sessionCache) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        sessionCache.delete(key);
      }
    }
  }
}

// ===========================================================================
// CORRECTION FUITE 2 — Ecouteurs retires apres usage
// ===========================================================================
// EXPLICATION : A chaque nouvelle connexion, un listener etait ajoute au bus
// avec `bus.on("data", handler)` mais jamais retire. Chaque listener capturait
// un Buffer de 4 Ko dans sa closure. Avec des milliers de connexions, les
// listeners s'accumulaient (chacun retenant sa closure et son buffer).
//
// CORRECTION : Utiliser `bus.once()` au lieu de `bus.on()` pour que le listener
// soit automatiquement retire apres le premier appel. Ou bien, retirer
// explicitement le listener quand la connexion est "terminee".

const bus = new EventEmitter();
bus.setMaxListeners(0);

function onNewConnection(connectionId) {
  const handler = (event) => {
    if (event.target === connectionId) {
      // traitement...
    }
  };

  // CORRECTION : `once` au lieu de `on` — le listener est retire apres emission
  bus.once("data", handler);

  // Emettre l'evenement (le handler sera retire automatiquement apres)
  bus.emit("data", { target: connectionId, payload: "ping" });
}

// ===========================================================================
// CORRECTION FUITE 3 — Closure ne capturant plus le buffer
// ===========================================================================
// EXPLICATION : La fonction `createRequestLogger` creait un `hugeBuffer` de 1 Mo
// puis renvoyait une closure (le logger). Meme si la closure n'utilisait
// `hugeBuffer` que pour `.length`, elle retenait une reference a toute la
// portee lexicale englobante, gardant les 1 Mo en memoire tant que le logger
// existait. Multiplie par des centaines de requetes, ca explose.
//
// CORRECTION : Extraire les donnees necessaires AVANT de creer la closure,
// pour que le buffer puisse etre collecte. Ou bien ne pas stocker le logger
// indefiniment (vider `activeLoggers` periodiquement).

function createRequestLogger(requestId) {
  const hugeBuffer = Buffer.alloc(1024 * 1024);
  hugeBuffer.write(`Request ${requestId} processing data...`);

  // CORRECTION : capturer SEULEMENT ce dont on a besoin, pas le buffer entier
  const bufferLength = hugeBuffer.length;
  // `hugeBuffer` n'est plus reference dans la closure ci-dessous,
  // il peut etre collecte par le GC des que `createRequestLogger` retourne.

  const logger = () => {
    const msg = `[LOG] Requete ${requestId} traitee, buffer size = ${bufferLength}`;
    return msg;
  };

  return logger;
}

// CORRECTION : taille max du tableau de loggers, on purge les anciens
const activeLoggers = [];
const MAX_LOGGERS = 100;

// ===========================================================================
// CORRECTION FUITE 4 — Tableau de metriques avec taille bornee
// ===========================================================================
// EXPLICATION : `setInterval` creait une closure capturant `collectedMetrics`.
// Tant que l'intervalle tourne, le tableau est retenu en memoire. Et a chaque
// tick on y ajoute des objets (avec 512 octets de payload chacun) sans jamais
// en retirer. Le tableau grandit indefiniment.
//
// CORRECTION : Limiter la taille du tableau (buffer circulaire) et/ou vider
// les metriques apres traitement.

function startMetricsCollector() {
  const collectedMetrics = [];
  const MAX_METRICS = 200; // Garder au maximum 200 metriques en memoire

  const intervalId = setInterval(() => {
    const metric = {
      timestamp: Date.now(),
      cpuUsage: process.cpuUsage(),
      memory: process.memoryUsage(),
      randomPayload: randomBytes(512).toString("hex"),
    };

    collectedMetrics.push(metric);

    // CORRECTION : Quand on depasse la limite, on vide les anciennes metriques
    if (collectedMetrics.length > MAX_METRICS) {
      // Garder seulement les 50 plus recentes (simule un flush vers une base)
      const flushed = collectedMetrics.splice(0, collectedMetrics.length - 50);
      console.log(
        `[metrics] Flush de ${flushed.length} metriques, ${collectedMetrics.length} restantes`
      );
    }

    if (collectedMetrics.length % 100 === 0) {
      console.log(
        `[metrics] ${collectedMetrics.length} metriques en memoire`
      );
    }
  }, 10);

  return intervalId;
}

// ===========================================================================
// CORRECTION FUITE 5 — Nettoyage des timers et des references circulaires
// ===========================================================================
// EXPLICATION : `Server` et `RequestHandler` se referencent mutuellement
// (server.handler -> handler, handler.server -> server). Le GC V8
// (Mark-and-Sweep) sait normalement gerer les references circulaires.
// MAIS le `setInterval` dans le constructeur de RequestHandler cree une
// racine GC (le timer est enregistre dans la boucle d'evenements).
// Cette racine maintient `this` (le RequestHandler) en vie, qui maintient
// le Server en vie, qui maintient le handler en vie. Rien n'est collecte.
//
// CORRECTION : Ajouter une methode `destroy()` qui arrete le timer et
// casse les references. Appeler `destroy()` quand on n'a plus besoin
// de la paire Server/RequestHandler.

class Server {
  constructor(name) {
    this.name = name;
    this.connections = [];
    this.handler = null;
  }

  // CORRECTION : methode de nettoyage
  destroy() {
    if (this.handler) {
      this.handler.destroy();
      this.handler = null;
    }
    this.connections = null;
  }
}

class RequestHandler {
  constructor(server) {
    this.server = server;
    server.handler = this;
    this.buffer = Buffer.alloc(512 * 1024);
    this.processedCount = 0;

    this.intervalId = setInterval(() => {
      this.processedCount++;
      this.buffer.write(`Processed: ${this.processedCount}`, 0);
    }, 50);
  }

  // CORRECTION : arreter le timer et casser les references
  destroy() {
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.server = null;
    this.buffer = null;
  }
}

// CORRECTION : gestion avec taille max et nettoyage des anciens
const activeServers = [];
const MAX_SERVERS = 10;

// ===========================================================================
// Boucle principale corrigee
// ===========================================================================

function simulateServerActivity() {
  let requestCount = 0;

  const memoryMonitorId = monitorMemory();
  const metricsInterval = startMetricsCollector();

  const mainLoop = setInterval(() => {
    requestCount++;

    // --- FUITE 1 CORRIGEE : sessionCache utilise userId comme cle + purge ---
    const userId = `user-${requestCount % 1000}`;
    handleRequest(userId);

    // --- FUITE 2 CORRIGEE : `once` au lieu de `on` ---
    if (requestCount % 3 === 0) {
      onNewConnection(`conn-${requestCount}`);
    }

    // --- FUITE 3 CORRIGEE : closure ne capture plus le buffer ---
    if (requestCount % 5 === 0) {
      const logger = createRequestLogger(requestCount);
      activeLoggers.push(logger);

      // CORRECTION : limiter la taille du tableau de loggers
      while (activeLoggers.length > MAX_LOGGERS) {
        activeLoggers.shift();
      }
    }

    // --- FUITE 5 CORRIGEE : destroy() les anciennes paires ---
    if (requestCount % 50 === 0) {
      const server = new Server(`srv-${requestCount}`);
      const handler = new RequestHandler(server);
      activeServers.push({ server, handler });

      // CORRECTION : quand on depasse la limite, nettoyer les anciens
      while (activeServers.length > MAX_SERVERS) {
        const old = activeServers.shift();
        old.server.destroy(); // Arrete le timer, casse les refs
      }
    }

    if (requestCount % 500 === 0) {
      console.log(
        `[serveur] ${requestCount} requetes | sessions=${sessionCache.size} | loggers=${activeLoggers.length} | serveurs=${activeServers.length} | listeners(bus)=${bus.listenerCount("data")}`
      );
    }
  }, 5);

  // Arret propre apres 60 secondes
  setTimeout(() => {
    clearInterval(mainLoop);
    clearInterval(metricsInterval);
    clearInterval(memoryMonitorId);

    // Nettoyage final
    for (const { server } of activeServers) {
      server.destroy();
    }
    activeServers.length = 0;
    sessionCache.clear();
    activeLoggers.length = 0;

    console.log("\n=== Fin de la simulation (version corrigee) ===");
    console.log(`Total requetes : ${requestCount}`);

    // Forcer un GC si le flag est disponible
    if (global.gc) {
      global.gc();
      console.log("[GC] Ramasse-miettes force");
    }

    const mem = process.memoryUsage();
    console.log(
      `Memoire heap finale : ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`
    );
    console.log(
      "La memoire devrait s'etre stabilisee pendant l'execution."
    );
    process.exit(0);
  }, 60_000);
}

// Lancer la simulation corrigee
console.log("=== Demarrage du serveur (5 fuites CORRIGEES) ===");
console.log("Observez la memoire se stabiliser...\n");
simulateServerActivity();
