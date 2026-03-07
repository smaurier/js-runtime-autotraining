# Module 08 — Les Fuites Mémoire (Memory Leaks)

> **Objectif** : Identifier, diagnostiquer et corriger les fuites mémoire en JavaScript, tant dans le navigateur que dans Node.js, en maîtrisant les 5 patterns classiques de rétention involontaire, les outils de profilage (Chrome DevTools Heap Snapshots, Allocation Timeline, méthode des 3 snapshots), et les stratégies de mitigation (WeakMap, WeakSet, WeakRef).

> **Difficulté** : ⭐⭐⭐ (Avancé)

---

## Prérequis

- Module 07 — Garbage Collector (mark-and-sweep, générations, tri-color marking, WeakRef)
- Familiarité avec Chrome DevTools (onglets Performance et Memory)
- Notions de base DOM (createElement, addEventListener, removeChild)
- Expérience Node.js (process.memoryUsage, flags V8)

---

## Théorie

> **Analogie pour débuter** : Une fuite mémoire, c'est comme un robinet qui goutte. Chaque goutte est minuscule, mais si on ne répare pas, la baignoire finit par déborder (crash). En JavaScript, le « robinet » ce sont les références que tu oublies de nettoyer.

### 1. Qu'est-ce qu'une fuite mémoire dans un langage à GC ?

En C/C++, une fuite mémoire signifie : de la mémoire allouée sans jamais être désallouée (appel `free()` manquant).

En JavaScript, le GC libère automatiquement la mémoire **non atteignable**. Une fuite mémoire signifie donc :

> **De la mémoire qui reste atteignable (référencée) depuis les racines GC alors qu'elle n'est plus nécessaire au programme.**

Le GC fait parfaitement son travail — c'est le **développeur** qui maintient involontairement des références vers des objets qui ne servent plus.

```
  Mémoire normale :                     Fuite mémoire :

  Racine GC                             Racine GC
     │                                     │
     ▼                                     ▼
  [Objet utile]                         [Objet utile]
     │                                     │
     ▼                                     ├──────────────────┐
  [Objet utile]                         [Objet utile]      [Objet INUTILE]
                                                              │
  Les objets inutiles                                      [Encore plus de
  sont automatiquement                                      données inutiles]
  collectés car non                                           │
  atteignables.                         Tout ce sous-arbre est
                                        retenu → la mémoire
                                        croît indéfiniment.
```

**Symptômes typiques** :
- Le processus Node.js est tué par l'OOM killer après quelques heures.
- L'onglet Chrome consomme 2 Go de RAM après une longue session.
- Le temps de réponse se dégrade progressivement (pauses GC de plus en plus longues sur un tas de plus en plus gros).

### 2. Les 5 patterns classiques de fuites mémoire

#### Pattern 1 : Timers oubliés (setInterval sans clearInterval)

```js
// FUITE : le callback et ses références vivent indéfiniment
function startPolling(element) {
  const heavyData = loadLargeDataset(); // 50 Mo de données

  setInterval(() => {
    // Ce callback référence 'heavyData' via la closure
    // Tant que le timer existe, heavyData ne peut pas être collecté
    element.textContent = heavyData.getSummary();
  }, 1000);

  // Aucun clearInterval() → la closure (et heavyData) survit pour toujours
}
```

```
  Chaîne de rétention :

  GC Root (Timers list)
     │
     ▼
  [setInterval handler]
     │
     ├──> closure context
     │       │
     │       ├──> heavyData (50 Mo !)
     │       └──> element (DOM node)
     │
     └── Le timer n'est jamais supprimé
         → toute la chaîne est retenue indéfiniment
```

**Correction** :

```js
function startPolling(element) {
  const heavyData = loadLargeDataset();

  const intervalId = setInterval(() => {
    if (!document.body.contains(element)) {
      clearInterval(intervalId);  // Arrêter si l'élément n'existe plus
      return;
    }
    element.textContent = heavyData.getSummary();
  }, 1000);

  // Retourner une fonction de nettoyage explicite
  return () => clearInterval(intervalId);
}

const cleanup = startPolling(myElement);
// Plus tard, quand le composant est démonté :
cleanup();
```

#### Pattern 2 : Noeuds DOM détachés (Detached DOM nodes)

Un noeud DOM retiré du document mais encore référencé en JavaScript :

```js
const elements = [];

function createListItem(text) {
  const li = document.createElement('li');
  li.textContent = text;
  document.getElementById('list').appendChild(li);
  elements.push(li);  // Référence stockée dans un tableau
}

function clearList() {
  document.getElementById('list').innerHTML = '';
  // Les noeuds sont retirés du DOM...
  // MAIS 'elements' contient encore les références !
  // → noeuds DOM détachés = fuite mémoire
}
```

```
  Avant clearList() :

  DOM Tree                         JS Array
  ┌──────────┐                    ┌──────────────┐
  │  <ul>    │                    │ elements[]   │
  │   <li>1  │◄──── reference ───┤ [0] ─> <li>1 │
  │   <li>2  │◄──── reference ───┤ [1] ─> <li>2 │
  │   <li>3  │◄──── reference ───┤ [2] ─> <li>3 │
  └──────────┘                    └──────────────┘

  Après clearList() (innerHTML = '') :

  DOM Tree                         JS Array
  ┌──────────┐                    ┌──────────────┐
  │  <ul>    │                    │ elements[]   │
  │  (vide)  │                    │ [0] ─> <li>1 │ ← DÉTACHÉ
  └──────────┘                    │ [1] ─> <li>2 │ ← DÉTACHÉ
                                  │ [2] ─> <li>3 │ ← DÉTACHÉ
                                  └──────────────┘
  Les <li> ne sont plus dans le DOM mais ne peuvent pas être
  collectés car elements[] les retient. Chaque noeud détaché
  retient aussi ses enfants, styles, attributs, etc.
```

**Correction** :

```js
function clearList() {
  document.getElementById('list').innerHTML = '';
  elements.length = 0;  // Supprimer les références JS aussi
}
```

#### Pattern 3 : Closures capturant des scopes volumineux

```js
function createHandlers() {
  const hugeData = new Array(1_000_000).fill('x'); // ~8 Mo
  const config = { debug: true };

  const handler1 = function () {
    return config.debug; // référence 'config' seulement
  };

  const handler2 = function () {
    return hugeData.length; // référence 'hugeData'
  };

  // handler1 et handler2 partagent le MÊME objet de scope (context)
  // → si handler1 survit, hugeData survit aussi !
  return handler1; // handler2 est jeté, mais hugeData survit via le scope
}
```

```
  Scope partagé de createHandlers()
  ┌────────────────────────────────────┐
  │  hugeData: [... 1M items, ~8 Mo]  │◄── Retenu car le scope est partagé
  │  config:   { debug: true }         │◄── Référencé par handler1
  │                                    │
  │  handler1: function() {...}        │──► retourné (vivant)
  │  handler2: function() {...}        │──► non retourné (mort)
  └────────────────────────────────────┘
         │
         └── Le scope entier survit car handler1 est vivant.

  NOTE : V8 optimise ce cas dans les scénarios simples — il effectue
  une analyse des variables capturées (context analysis) et ne retient
  que les variables réellement utilisées. Mais dans les cas complexes
  (eval, with, debugger attaché, multiples closures partageant un
  scope), V8 est contraint de retenir tout le scope.
```

**Correction** :

```js
function createHandlers() {
  const config = { debug: true };

  // Isoler les gros traitements dans leur propre scope
  (function () {
    const hugeData = new Array(1_000_000).fill('x');
    processData(hugeData); // utilisé et libéré
  })();

  const handler1 = function () {
    return config.debug;
  };

  return handler1; // hugeData n'est pas dans le même scope → collecté
}
```

#### Pattern 4 : Collections qui grandissent indéfiniment (Map/Array sans cleanup)

```js
// Cache sans limite de taille ni TTL
const responseCache = new Map();

async function handleRequest(req) {
  const key = req.url + JSON.stringify(req.query);

  if (responseCache.has(key)) {
    return responseCache.get(key);
  }

  const data = await fetchFromDB(req);

  // Le cache croît indéfiniment :
  // - Chaque URL unique ajoute une entrée
  // - Rien n'est jamais supprimé
  // - Après 10M requêtes avec des URLs uniques → centaines de Mo
  responseCache.set(key, data);

  return data;
}
```

```
  Croissance du cache dans le temps :

  Mémoire (Mo)
  250 │                                     /
  200 │                                   /
  150 │                               /
  100 │                          /
   50 │                    /
   25 │             /
   10 │       /
      └──────────────────────────────────
       0h    1h    2h    4h    8h    12h

  → Croissance linéaire = signe classique de fuite.
  → Après le GC, le heap ne diminue pas car tout est référencé.
```

**Correction** : cache LRU avec éviction :

```js
class LRUCache {
  #map = new Map();
  #maxSize;

  constructor(maxSize = 1000) {
    this.#maxSize = maxSize;
  }

  get(key) {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key);
    // Déplacer en fin (le plus récent) : supprimer et ré-insérer
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.#map.has(key)) {
      this.#map.delete(key);
    } else if (this.#map.size >= this.#maxSize) {
      // Supprimer le plus ancien (premier élément de Map, insertion order)
      const oldestKey = this.#map.keys().next().value;
      this.#map.delete(oldestKey);
    }
    this.#map.set(key, value);
  }

  get size() {
    return this.#map.size;
  }
}
```

#### Pattern 5 : Event listeners non supprimés

```js
class ChatWidget {
  constructor(container) {
    this.container = container;
    this.messages = [];

    // Chaque .bind(this) crée une NOUVELLE fonction anonyme
    window.addEventListener('resize', this.onResize.bind(this));
    document.addEventListener('keydown', this.onKeyDown.bind(this));
  }

  onResize() {
    this.container.style.height = `${window.innerHeight - 100}px`;
  }

  onKeyDown(event) {
    if (event.key === 'Enter') this.sendMessage();
  }

  destroy() {
    this.container.remove();
    // FUITE : les listeners sur window et document persistent !
    // On ne peut pas les supprimer car on n'a pas gardé de référence
    // vers les fonctions retournées par .bind()
  }
}
```

```
  Chaîne de rétention après destroy() :

  GC Root (window)
     │
     ├──> resize listener list
     │       │
     │       └──> bound onResize function
     │               │
     │               └──> this (ChatWidget instance)
     │                       │
     │                       ├──> container (DOM node détaché !)
     │                       └──> messages[] (potentiellement gros)
     │
     └──> Le widget "détruit" est toujours en mémoire.
          Chaque new ChatWidget() + destroy() ajoute des listeners
          sans jamais les supprimer → fuite cumulative.
```

**Correction** :

```js
class ChatWidget {
  constructor(container) {
    this.container = container;
    this.messages = [];

    // Stocker les références bound pour pouvoir les supprimer
    this._onResize = this.onResize.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);

    window.addEventListener('resize', this._onResize);
    document.addEventListener('keydown', this._onKeyDown);
  }

  // ... méthodes ...

  destroy() {
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('keydown', this._onKeyDown);
    this.container.remove();
    this.messages = null;
  }
}

// Alternative moderne et plus propre : AbortController
class ModernWidget {
  #controller = new AbortController();

  constructor(container) {
    this.container = container;
    const signal = this.#controller.signal;

    window.addEventListener('resize', () => this.onResize(), { signal });
    document.addEventListener('keydown', (e) => this.onKeyDown(e), { signal });
    // N'importe quel nombre de listeners — un seul abort() les supprime tous
  }

  destroy() {
    this.#controller.abort(); // Supprime TOUS les listeners d'un coup
    this.container.remove();
  }
}
```

### 3. Détection avec Chrome DevTools — Heap Snapshots

#### La méthode des 3 snapshots

C'est la technique la plus fiable pour identifier les fuites :

```
  ┌────────────────────────────────────────────────────────────────┐
  │  MÉTHODE DES 3 HEAP SNAPSHOTS                                  │
  │                                                                │
  │  Étape 1 : Prendre le Snapshot A (état initial, après charge-  │
  │            ment complet de la page ou démarrage du serveur)     │
  │                                                                │
  │  Étape 2 : Effectuer l'action suspecte N fois                   │
  │            (ex: ouvrir/fermer un modal 5 fois, naviguer entre   │
  │            deux pages 5 fois, envoyer 1000 requêtes, etc.)      │
  │                                                                │
  │  Étape 3 : Prendre le Snapshot B                                │
  │                                                                │
  │  Étape 4 : Forcer un GC (cliquer sur l'icône poubelle dans     │
  │            DevTools, ou global.gc() en Node.js)                 │
  │                                                                │
  │  Étape 5 : Prendre le Snapshot C                                │
  │                                                                │
  │  Étape 6 : Vue "Comparison" : comparer C vs A                   │
  │            → Objets avec Delta positif = objets créés par        │
  │              l'action répétée qui n'ont PAS été collectés         │
  │            → Ce sont vos fuites                                  │
  │                                                                │
  │  Timeline :                                                     │
  │  ──[A]──── action x N ────[B]──── GC ────[C]──                 │
  │    │                                       │                    │
  │    └────────── Comparison view ────────────┘                    │
  │                Delta > 0 = fuite                                │
  └────────────────────────────────────────────────────────────────┘
```

#### Comprendre Retained Size vs Shallow Size

```
  ┌──────────────┐
  │   Objet A     │ Shallow Size : 100 octets (A seul)
  │   size: 100   │ Retained Size : 10 100 octets (A + tout ce qu'il retient)
  │               │
  │   ┌─────────┐ │
  │   │ ref ────┼─┼──> [Objet B: 10 000 octets]
  │   └─────────┘ │     (retenu UNIQUEMENT par A)
  └──────────────┘

  Shallow Size  = taille de l'objet lui-même (ses champs propres)
  Retained Size = taille qui serait libérée si cet objet était collecté
                  (inclut tous les objets retenus exclusivement par lui)

  → Trier par Retained Size pour trouver les plus gros "retenteurs"
```

#### L'arbre des Retainers

```
  Dans un Heap Snapshot, sélectionner un objet suspect et voir "Retainers" :

  [Object @12345] ← Pourquoi cet objet est-il vivant ?
    ↑ retained by
  [Array @67890].elements[42]
    ↑ retained by
  [Object @11111].cache
    ↑ retained by
  [Window / global] (racine GC)

  → Le chemin complet explique POURQUOI l'objet n'est pas collecté.
  → Remonter jusqu'à la racine révèle la référence fautive.
```

#### Allocation Timeline

```
  Chrome DevTools → Memory → Allocation instrumentation on timeline

  Temps →
  ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██   ← barres BLEUES (vivants)
  ░░ ░░    ░░    ░░ ░░    ░░            ← barres GRISES (collectés)

  Si les barres bleues ne font que s'accumuler dans le temps
  sans que les grises compensent → fuite probable.

  Cliquer sur un segment bleu pour voir quels objets ont été
  alloués pendant cette période et pourquoi ils sont encore vivants.
```

### 4. Détection en Node.js

#### process.memoryUsage()

```js
function printMemory(label) {
  const mem = process.memoryUsage();
  const fmt = (b) => (b / 1024 / 1024).toFixed(2) + ' Mo';
  console.log(`[${label}]`);
  console.log(`  RSS          : ${fmt(mem.rss)}`);         // resident set size
  console.log(`  Heap Total   : ${fmt(mem.heapTotal)}`);   // heap alloué
  console.log(`  Heap Used    : ${fmt(mem.heapUsed)}`);    // heap utilisé
  console.log(`  External     : ${fmt(mem.external)}`);    // C++ objects liés
  console.log(`  ArrayBuffers : ${fmt(mem.arrayBuffers)}`);// Buffers alloués
}
```

#### v8.getHeapStatistics()

```js
const v8 = require('v8');

function printHeapStats() {
  const stats = v8.getHeapStatistics();
  console.log(`  Total heap size     : ${(stats.total_heap_size / 1024 / 1024).toFixed(2)} Mo`);
  console.log(`  Used heap size      : ${(stats.used_heap_size / 1024 / 1024).toFixed(2)} Mo`);
  console.log(`  Heap size limit     : ${(stats.heap_size_limit / 1024 / 1024).toFixed(0)} Mo`);
  console.log(`  Malloced memory     : ${(stats.malloced_memory / 1024 / 1024).toFixed(2)} Mo`);
  console.log(`  Native contexts     : ${stats.number_of_native_contexts}`);
  // ↑ Un nombre croissant de native_contexts est souvent signe de fuite !
  // (chaque iframe, worker, ou vm.createContext() crée un contexte)
}
```

#### --max-old-space-size

```bash
# Limiter le heap à 512 Mo
node --max-old-space-size=512 server.js

# NOTE : la valeur par défaut du heap V8 dépend de la version de Node.js.
# - Node.js < 12 : ~1.5 Go sur 64-bit, ~700 Mo sur 32-bit (valeurs fixes)
# - Node.js 12+ : la limite est dynamique et peut atteindre ~4 Go sur 64-bit,
#   ajustée en fonction de la mémoire système disponible.
# Vérifiez votre limite avec : node -e "console.log(v8.getHeapStatistics().heap_size_limit)"

# Utilité :
# - Détecter les fuites plus tôt (crash OOM plus rapide en dev)
# - Limiter la consommation en production (conteneurs Docker avec cgroup limits)
# - Éviter que le GC passe trop de temps à gérer un immense heap

```

### 5. WeakMap, WeakSet, WeakRef comme outils de mitigation

```
  ┌───────────────┬──────────────────────────────────────────────────┐
  │ Outil         │ Cas d'usage                                      │
  ├───────────────┼──────────────────────────────────────────────────┤
  │ WeakMap       │ Métadonnées associées à des objets (DOM nodes,   │
  │               │ instances de classes). La clé est faible : quand │
  │               │ l'objet-clé est collecté, l'entrée disparaît.    │
  ├───────────────┼──────────────────────────────────────────────────┤
  │ WeakSet       │ Suivre l'appartenance d'objets à un ensemble     │
  │               │ sans les retenir (ex: "objets déjà visités").    │
  ├───────────────┼──────────────────────────────────────────────────┤
  │ WeakRef       │ Cache où la valeur peut être collectée si la     │
  │               │ mémoire est sous pression. Combiner avec         │
  │               │ FinalizationRegistry pour le nettoyage.          │
  └───────────────┴──────────────────────────────────────────────────┘
```

```js
// Exemple : métadonnées pour des DOM nodes avec WeakMap
const nodeMetadata = new WeakMap();

function trackNode(node) {
  nodeMetadata.set(node, {
    clicks: 0,
    lastAccess: Date.now(),
  });
}

// Quand le node est retiré du DOM et qu'aucune autre référence forte n'existe,
// l'entrée WeakMap est automatiquement supprimée par le GC.
// Zéro code de nettoyage nécessaire — pas de risque de fuite.
```

### 6. Patterns réels de fuites en production

#### Connection pools sans drain

```js
// FUITE : les connexions ne sont jamais libérées
const connections = [];

function getConnection() {
  const conn = createDBConnection();
  connections.push(conn); // référence retenue dans un tableau global
  return conn;
}

// Même après utilisation, la connexion et ses buffers internes
// restent dans le tableau. Après 10 000 requêtes → 10 000 connexions
// avec leurs buffers de lecture/écriture en mémoire.
```

#### Caches sans TTL (Time-To-Live)

```js
// FUITE : memoize sans limite
const memo = {};

function memoize(fn) {
  return function (...args) {
    const key = JSON.stringify(args);
    if (memo[key] === undefined) {
      memo[key] = fn(...args);
    }
    return memo[key];
  };
}

// Si fn est appelée avec des arguments uniques (timestamps, UUIDs, requêtes),
// le cache croît indéfiniment sans jamais libérer d'entrées.
```

#### Global registries (EventEmitter abuse)

```js
// FUITE : listeners accumulés sur un EventEmitter global
const eventBus = new EventEmitter();

class UserSession {
  constructor(userId) {
    this.userId = userId;
    this.data = loadUserData(userId); // gros objet

    // Listener ajouté à chaque nouvelle session
    eventBus.on('broadcast', (msg) => {
      this.handleBroadcast(msg); // closure retient 'this'
    });
    // Jamais supprimé → chaque session passée reste en mémoire
  }
}

// Après 1000 connexions/déconnexions → 1000 listeners + 1000 UserSession
// Symptôme : Node.js affiche MaxListenersExceededWarning
```

---

## Démonstration

### Demo 1 : Provoquer et mesurer chaque pattern de fuite

```js
// demo-leak-patterns.mjs
// Lancer : node --expose-gc demo-leak-patterns.mjs

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function measureLeak(name, setup, iterations = 100) {
  global.gc();
  const before = process.memoryUsage().heapUsed;

  setup(iterations);

  global.gc();
  const after = process.memoryUsage().heapUsed;
  const leaked = after - before;

  console.log(
    `[${name.padEnd(30)}] ` +
    `Avant: ${formatMB(before).padStart(8)} Mo | ` +
    `Après: ${formatMB(after).padStart(8)} Mo | ` +
    `Fuite: ${formatMB(leaked).padStart(8)} Mo`
  );
}

console.log('=== Provoquer les 5 patterns de fuite ===\n');

// --- Pattern 1 : Timers (simulé avec callbacks stockés) ---
const timerCallbacks = [];
measureLeak('1. Timers (callbacks)', (n) => {
  for (let i = 0; i < n; i++) {
    const payload = { id: i, data: new Array(10_000).fill(0) };
    timerCallbacks.push(() => payload.data[0]);
  }
});

// --- Pattern 2 : DOM détaché (simulé avec objets) ---
const detachedNodes = [];
measureLeak('2. Noeuds détachés (simulé)', (n) => {
  for (let i = 0; i < n; i++) {
    const node = {
      tagName: 'div',
      innerHTML: 'x'.repeat(1000),
      children: [{ tagName: 'span' }, { tagName: 'span' }],
    };
    detachedNodes.push(node);
  }
});

// --- Pattern 3 : Closures volumineuses ---
const closures = [];
measureLeak('3. Closures volumineuses', (n) => {
  for (let i = 0; i < n; i++) {
    const bigData = new Array(50_000).fill(`data-${i}`);
    closures.push(() => bigData.length);
  }
});

// --- Pattern 4 : Cache Map sans eviction ---
const cache = new Map();
measureLeak('4. Cache sans eviction', (n) => {
  for (let i = 0; i < n; i++) {
    cache.set(`request-${i}`, {
      response: new Array(20_000).fill('x'),
      timestamp: Date.now(),
    });
  }
});

// --- Pattern 5 : Event listeners (simulé avec un registre) ---
const listenerRegistry = [];
measureLeak('5. Listeners non supprimés', (n) => {
  for (let i = 0; i < n; i++) {
    const widget = {
      data: new Array(5_000).fill(i),
      handler: function () { return this.data[0]; },
    };
    listenerRegistry.push(widget);
  }
});

// --- Nettoyage et vérification ---
console.log('\n=== Nettoyage de toutes les fuites ===\n');
timerCallbacks.length = 0;
detachedNodes.length = 0;
closures.length = 0;
cache.clear();
listenerRegistry.length = 0;

global.gc();
global.gc();

const finalHeap = process.memoryUsage().heapUsed;
console.log(`Heap après nettoyage total : ${formatMB(finalHeap)} Mo`);
console.log('La mémoire a été récupérée car toutes les références ont été supprimées.');
```

### Demo 2 : Détecter une fuite via la tendance du heap

```js
// demo-leak-detection.mjs
// Lancer : node --expose-gc demo-leak-detection.mjs

const leakyStore = [];

function simulateRequest() {
  leakyStore.push({
    timestamp: Date.now(),
    payload: Buffer.alloc(1024), // 1 Ko par requête
    headers: { 'content-type': 'application/json', 'x-request-id': Math.random().toString(36) },
  });
}

function detectLeak(samples) {
  let increasing = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] > samples[i - 1]) {
      increasing++;
    }
  }
  const ratio = increasing / (samples.length - 1);
  return {
    isLeak: ratio > 0.8,
    ratio: (ratio * 100).toFixed(1) + '%',
    growth: ((samples[samples.length - 1] - samples[0]) / 1024 / 1024).toFixed(2) + ' Mo',
  };
}

const heapSamples = [];

console.log('=== Simulation de requêtes avec fuite ===\n');
console.log('  Batch | Heap (Mo) | Entrees');
console.log('  ------+-----------+--------');

for (let batch = 0; batch < 20; batch++) {
  for (let i = 0; i < 500; i++) {
    simulateRequest();
  }

  global.gc();
  heapSamples.push(process.memoryUsage().heapUsed);

  const heapMB = (heapSamples[heapSamples.length - 1] / 1024 / 1024).toFixed(2);
  console.log(`    ${String(batch + 1).padStart(2)}  |  ${heapMB.padStart(7)} |  ${leakyStore.length}`);
}

console.log('\n=== Analyse automatique ===');
const analysis = detectLeak(heapSamples);
console.log(`  Fuite détectée       : ${analysis.isLeak ? 'OUI' : 'NON'}`);
console.log(`  Croissance monotone  : ${analysis.ratio} des échantillons`);
console.log(`  Croissance totale    : ${analysis.growth}`);
```

### Demo 3 : Corriger avec WeakMap vs Map

```js
// demo-weakmap-fix.mjs
// Lancer : node --expose-gc demo-weakmap-fix.mjs

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

// --- Version qui fuit (Map) ---
console.log('=== Test avec Map (fuite) ===');
const mapCache = new Map();

global.gc();
const mapBefore = process.memoryUsage().heapUsed;

for (let i = 0; i < 10_000; i++) {
  const obj = { id: i, data: new Array(100).fill(i) };
  mapCache.set(obj, { computed: i * 2, timestamp: Date.now() });
}

global.gc();
const mapAfter = process.memoryUsage().heapUsed;
console.log(`  Avant: ${formatMB(mapBefore)} Mo | Après: ${formatMB(mapAfter)} Mo`);
console.log(`  Map.size: ${mapCache.size} (toutes les entrées retenues)`);

// --- Version corrigée (WeakMap) ---
console.log('\n=== Test avec WeakMap (pas de fuite) ===');
const weakCache = new WeakMap();
let refs = [];

global.gc();
const weakBefore = process.memoryUsage().heapUsed;

for (let i = 0; i < 10_000; i++) {
  const obj = { id: i, data: new Array(100).fill(i) };
  weakCache.set(obj, { computed: i * 2, timestamp: Date.now() });
  refs.push(obj); // garder temporairement une référence forte
}

// Supprimer toutes les références fortes
refs = null;

global.gc();
global.gc();
const weakAfter = process.memoryUsage().heapUsed;
console.log(`  Avant: ${formatMB(weakBefore)} Mo | Après: ${formatMB(weakAfter)} Mo`);
console.log(`  WeakMap : les entrées sans référence forte ont été collectées`);

// --- Comparaison ---
console.log('\n=== Comparaison ===');
const mapRetained = (mapAfter - mapBefore) / 1024 / 1024;
const weakRetained = (weakAfter - weakBefore) / 1024 / 1024;
console.log(`  Map retient      : ${mapRetained.toFixed(2)} Mo`);
console.log(`  WeakMap retient  : ${weakRetained.toFixed(2)} Mo`);
```

### Demo 4 : Heap snapshot programmatique en Node.js

```js
// demo-heap-snapshot.mjs
// Lancer : node --expose-gc demo-heap-snapshot.mjs

const v8 = require('v8');
const path = require('path');

function takeSnapshot(label) {
  const filename = v8.writeHeapSnapshot(
    path.join(process.cwd(), `heap-${label}-${Date.now()}.heapsnapshot`)
  );
  console.log(`  Snapshot "${label}" → ${filename}`);
  return filename;
}

function fmt(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

// Étape 1 : baseline
global.gc();
console.log('=== Snapshot 1 : baseline ===');
console.log(`  Heap: ${fmt(process.memoryUsage().heapUsed)} Mo`);
takeSnapshot('baseline');

// Étape 2 : créer la fuite
console.log('\n=== Créer une fuite (10k entrées de cache sans TTL) ===');
const leakyCache = new Map();
for (let i = 0; i < 10000; i++) {
  leakyCache.set(`key-${i}`, {
    data: new Array(100).fill(`value-${i}`),
    metadata: { created: Date.now(), ttl: null },
  });
}
console.log(`  Heap: ${fmt(process.memoryUsage().heapUsed)} Mo | Cache: ${leakyCache.size}`);
takeSnapshot('with-leak');

// Étape 3 : GC sans corriger
global.gc();
console.log('\n=== Après GC (pas de correction) ===');
console.log(`  Heap: ${fmt(process.memoryUsage().heapUsed)} Mo (inchangé — tout est référencé)`);
takeSnapshot('after-gc-still-leaking');

// Étape 4 : corriger et GC
leakyCache.clear();
global.gc();
console.log('\n=== Après correction (clear + GC) ===');
console.log(`  Heap: ${fmt(process.memoryUsage().heapUsed)} Mo (mémoire récupérée)`);
takeSnapshot('after-fix');

console.log('\n--- Ouvrir les .heapsnapshot dans Chrome DevTools → Memory tab ---');
console.log('--- Utiliser la vue Comparison pour voir les deltas ---');
```

### Demo 5 : Monitoring mémoire automatisé avec alerte

```js
// demo-memory-monitor.mjs
// Lancer : node --expose-gc demo-memory-monitor.mjs

class MemoryLeakDetector {
  #samples = [];
  #intervalId;
  #windowSize;

  constructor(windowSize = 10) {
    this.#windowSize = windowSize;
  }

  start(intervalMs = 1000) {
    console.log(`Monitoring démarré (fenêtre glissante: ${this.#windowSize} échantillons)\n`);

    this.#intervalId = setInterval(() => {
      global.gc();
      const heapUsed = process.memoryUsage().heapUsed;
      this.#samples.push(heapUsed);

      // Garder seulement les N derniers échantillons
      if (this.#samples.length > this.#windowSize) {
        this.#samples.shift();
      }

      const heapMB = (heapUsed / 1024 / 1024).toFixed(2);
      const trend = this.#analyzeTrend();

      console.log(
        `  Heap: ${heapMB.padStart(8)} Mo | ` +
        `Tendance: ${trend.direction.padEnd(8)} | ` +
        `Pente: ${trend.slope > 0 ? '+' : ''}${trend.slope.toFixed(2)} Mo/échantillon`
      );

      if (trend.isLeak) {
        console.log('  >>> ALERTE : fuite mémoire probable détectée ! <<<');
      }
    }, intervalMs);
  }

  stop() {
    clearInterval(this.#intervalId);
    console.log('\nMonitoring arrêté.');
  }

  #analyzeTrend() {
    if (this.#samples.length < 3) {
      return { direction: 'N/A', slope: 0, isLeak: false };
    }

    // Régression linéaire simple
    const n = this.#samples.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      const y = this.#samples[i] / 1024 / 1024; // en Mo
      sumX += i;
      sumY += y;
      sumXY += i * y;
      sumXX += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const direction = slope > 0.1 ? 'HAUSSE' : slope < -0.1 ? 'BAISSE' : 'STABLE';
    const isLeak = slope > 0.5; // plus de 0.5 Mo par echantillon = suspect

    return { direction, slope, isLeak };
  }
}

// Simuler une fuite progressive
const detector = new MemoryLeakDetector(10);
detector.start(500);

const leakyData = [];
let round = 0;

const leakInterval = setInterval(() => {
  for (let i = 0; i < 2000; i++) {
    leakyData.push(Buffer.alloc(512));
  }
  round++;
  if (round >= 15) {
    clearInterval(leakInterval);
    setTimeout(() => detector.stop(), 2000);
  }
}, 500);
```

---

### V8 vs SpiderMonkey (Firefox)

Les fuites mémoire sont **indépendantes du moteur JavaScript** — les 5 patterns classiques (timers oubliés, noeuds DOM détachés, closures volumineuses, collections sans éviction, event listeners non supprimés) s'appliquent à **tous** les moteurs JS : V8, SpiderMonkey (Firefox), JavaScriptCore (Safari), etc. Le GC de chaque moteur a ses propres heuristiques, mais le problème fondamental (références non intentionnelles) est universel.

**Outils de diagnostic par navigateur :**

| Fonctionnalité | Chrome DevTools | Firefox DevTools |
|---|---|---|
| Heap Snapshots | Memory tab → « Heap snapshot » | Memory tab → « Take snapshot » |
| Allocation Timeline | Memory tab → « Allocation instrumentation on timeline » | Memory tab → « Record allocation stacks » |
| Retained Size / Retainers | Vue « Containment » + arbre Retainers | Vue « Tree Map » pour visualisation mémoire |
| Détails bas-niveau | `chrome://tracing` | `about:memory` (détails complets par onglet, workers, etc.) |
| Comparaison de snapshots | Vue « Comparison » entre deux snapshots | Vue « Diff » entre deux snapshots |

**Spécificités Firefox :**

- **`about:memory`** : une page interne Firefox qui affiche une ventilation détaillée de la mémoire de chaque onglet, worker, et composant interne. Très utile pour un premier diagnostic sans ouvrir DevTools.
- **Tree Map** : Firefox propose une vue « Tree Map » dans l'onglet Memory qui donne une représentation visuelle proportionnelle de la mémoire — les gros blocs sont immédiatement visibles.
- **Mêmes concepts, UI différente** : la méthode des 3 snapshots fonctionne exactement de la même manière dans Firefox — seule l'interface change.

> **À retenir** : si tu apprends à diagnostiquer les fuites dans Chrome DevTools, tu sauras le faire dans Firefox. Les concepts (retained size, retainers, comparison) sont les mêmes partout.

---

## Points clés

1. Une fuite mémoire en JS = **référence non intentionnelle** vers des données obsolètes, empêchant le GC de les collecter.
2. Les **5 patterns classiques** : timers oubliés, noeuds DOM détachés, closures capturant de gros scopes, collections sans éviction, event listeners non supprimés.
3. La **méthode des 3 snapshots** est la technique la plus fiable : snapshot baseline, actions répétées, GC, snapshot de vérification, comparaison.
4. **Retained Size** (pas Shallow Size) révèle l'impact réel d'un objet sur la mémoire.
5. L'arbre des **Retainers** dans un Heap Snapshot montre le chemin exact de rétention — c'est l'outil principal de diagnostic.
6. En Node.js, `process.memoryUsage()` + `v8.getHeapStatistics()` + `v8.writeHeapSnapshot()` forment la trousse à outils complète.
7. `--max-old-space-size` permet de limiter le heap et de détecter les fuites plus tôt.
8. **WeakMap** est la solution idiomatique pour les caches et métadonnées associés à des objets.
9. **AbortController** avec `{ signal }` sur `addEventListener` simplifie le nettoyage des listeners.
10. Un `number_of_native_contexts` croissant dans `v8.getHeapStatistics()` est un signe de fuite de contextes (iframes, workers, vm.createContext).

---

## Lab associé

**Lab 08 — Chasse aux fuites mémoire**

Fichier : `labs/lab-08-memory-leaks/`

1. Un serveur Express avec 5 fuites mémoire cachées est fourni.
2. Lancer le serveur avec `node --inspect --expose-gc server.js`.
3. Utiliser Chrome DevTools (chrome://inspect → Memory tab) pour prendre des heap snapshots.
4. Identifier chaque fuite en utilisant la vue Comparison et l'arbre des Retainers.
5. Corriger chaque fuite et vérifier que le heap se stabilise après un load test.
6. Écrire un test automatisé qui vérifie l'absence de fuite (boucle de requêtes + mesure heap + assertion de stabilisation).

---

## Pour aller plus loin

- [Chrome DevTools — Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems/)
- [Chrome DevTools — Record heap snapshots](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots/)
- [V8 Blog — Trash talk: the Orinoco garbage collector](https://v8.dev/blog/trash-talk)
- [Node.js Docs — process.memoryUsage()](https://nodejs.org/api/process.html#processmemoryusage)
- [Node.js Docs — v8.getHeapStatistics()](https://nodejs.org/api/v8.html#v8getheapstatistics)
- [Node.js Docs — v8.writeHeapSnapshot()](https://nodejs.org/api/v8.html#v8writeheapsnapshotfilename)
- [MDN — WeakMap](https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Global_Objects/WeakMap)
- [MDN — WeakSet](https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Global_Objects/WeakSet)
- [Nolan Lawson — Fixing memory leaks in web applications](https://nolanlawson.com/2020/02/19/fixing-memory-leaks-in-web-applications/)

---

## Défi

Ce composant React fuit mémoire à chaque navigation. Après 50 allers-retours entre les pages, l'onglet consomme 2 Go. Trouvez **toutes les fuites** (il y en a 4) et écrivez le code de nettoyage complet.

```js
class DataDashboard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { data: [], connected: false };
    this.chartInstances = [];
  }

  componentDidMount() {
    // Fuite 1
    this.ws = new WebSocket('wss://api.example.com/stream');
    this.ws.onmessage = (event) => {
      const newData = JSON.parse(event.data);
      this.setState((prev) => ({
        data: [...prev.data, newData], // accumulation infinie
      }));
    };

    // Fuite 2
    this.resizeHandler = () => this.handleResize();
    window.addEventListener('resize', this.resizeHandler);

    // Fuite 3
    this.pollInterval = setInterval(() => {
      fetch('/api/health').then((r) => r.json()).then(console.log);
    }, 5000);

    // Fuite 4
    this.renderCharts();
  }

  renderCharts() {
    const container = document.getElementById('charts');
    for (let i = 0; i < 10; i++) {
      const canvas = document.createElement('canvas');
      container.appendChild(canvas);
      const chart = new Chart(canvas, this.getChartConfig(i));
      this.chartInstances.push(chart);
    }
  }

  componentWillUnmount() {
    // Que manque-t-il ici ?
  }

  // ...
}
```

<details>
<summary>Réponse</summary>

**Les 4 fuites et leurs mécanismes de rétention :**

1. **WebSocket non fermé** : `this.ws` reste ouvert après démontage. Le callback `onmessage` capture `this` (l'instance du composant) via la closure. Même après démontage du composant, le WebSocket continue de recevoir des messages et d'accumuler des données dans `this.state.data` (qui ne fait que croître avec le spread `[...prev.data, newData]`). Chaîne de rétention : GC root → WebSocket → onmessage closure → this → state.data + chartInstances + container.

2. **Event listener `resize` non supprimé** : `this.resizeHandler` est enregistré sur `window` (racine GC permanente) mais jamais supprimé dans `componentWillUnmount`. L'instance entière du composant (et toutes ses données) reste en mémoire via la closure du handler.

3. **`setInterval` non arrêté** : `this.pollInterval` continue de s'exécuter après démontage. Le callback retient une référence vers le scope de `componentDidMount` et le `this` via la closure de la méthode `fetch`.

4. **Instances Chart.js non détruites** : `this.chartInstances` contient des objets Chart qui allouent des buffers Canvas 2D/WebGL internes. Sans appel à `chart.destroy()`, les contextes graphiques (ctx) et leurs buffers GPU ne sont jamais libérés.

**Le `componentWillUnmount` corrigé :**

```js
componentWillUnmount() {
  // 1. Fermer le WebSocket et supprimer le handler
  if (this.ws) {
    this.ws.onmessage = null;
    this.ws.close();
    this.ws = null;
  }

  // 2. Supprimer le listener resize
  window.removeEventListener('resize', this.resizeHandler);

  // 3. Arreter le polling
  clearInterval(this.pollInterval);

  // 4. Détruire les instances Chart.js
  for (const chart of this.chartInstances) {
    chart.destroy();
  }
  this.chartInstances = [];
}
```

**Bonus** : `[...prev.data, newData]` n'est pas une fuite à proprement parler — c'est un problème de **croissance non bornée**. L'accumulation est intentionnelle (chaque message est ajouté) mais sans limite. La différence avec une fuite : ici les données sont utilisées (pour l'affichage), tandis qu'une fuite concerne des données retenues mais inutilisées. La correction serait de garder seulement les N derniers messages : `data: [...prev.data.slice(-1000), newData]`.

</details>
