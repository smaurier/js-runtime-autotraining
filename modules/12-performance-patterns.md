# Module 12 — Performance Patterns

> **Objectif** : Acquérir la méthodologie et les outils pour identifier, mesurer et corriger les goulots d'étranglement de performance dans un programme JavaScript, en comprenant les mécanismes internes du moteur V8 qui sous-tendent chaque optimisation.

> **Difficulté** : ⭐⭐⭐ (Avancé) — Très pratique, moins théorique.

---

## Prérequis

- Module 09 — V8 Engine Architecture (pipeline de compilation, TurboFan, déoptimisations)
- Module 11 — Hidden Classes & Inline Caching (classes cachées, transitions, polymorphisme)
- Module 07 — Garbage Collector (allocation, GC générationnel, pression mémoire)
- Module 03 — Event Loop (boucle d'événements, macrotâches, microtâches)
- Connaissance pratique de Chrome DevTools et de Node.js CLI

---

## Théorie

> **Analogie pour débuter** : Le profiling, c'est comme un médecin qui fait un bilan de santé. On ne prescrit pas de traitement sans diagnostic. Mesurer d'abord, optimiser ensuite.

### 1. Le mindset performance : mesurer d'abord, optimiser ensuite

L'erreur la plus courante en optimisation est de deviner où se trouve le problème.
Le cerveau humain est un très mauvais profileur.

```
  Workflow correct
  ================

  1. Reproduire le scénario lent
          |
          v
  2. MESURER avec un profiler
          |
          v
  3. Identifier le hotspot (>= 80% du temps)
          |
          v
  4. Comprendre POURQUOI c'est lent (V8 internals)
          |
          v
  5. Appliquer UNE correction ciblée
          |
          v
  6. MESURER à nouveau  -->  amélioration ?
          |                        |
          | non                    | oui
          v                        v
  Revenir à l'étape 3         Documenter & commiter
```

**Règle d'or** : ne jamais optimiser sans preuve mesurable. Le code optimisé
est souvent plus difficile à lire — il doit donc apporter un gain réel.

**Loi d'Amdahl** : si une fonction représente 5% du temps total, l'optimiser
de 10x ne donne qu'un gain global de ~4.7%. Concentrez-vous sur les 80%.

```
  Loi d'Amdahl — Gain maximal
  =============================

  Temps avant :  [===== 20% hotspot =====][======= 80% reste =======]

  Si on optimise le hotspot de 10x :
  Temps après :  [2%][============== 80% reste ==============]

  Gain global : 100 / (80 + 20/10) = 100/82 = 1.22x  (seulement 22%)

  Si le hotspot est 80% du temps et optimisé 10x :
  Temps après :  [8%][==== 20% reste ====]

  Gain global : 100 / (20 + 80/10) = 100/28 = 3.57x  (significatif !)
```

### 2. Outils de profiling V8 (Node.js CLI)

#### 2.1. `--prof` et `--prof-process`

V8 peut générer un fichier de profiling brut (tick-based sampling) :

```bash
# Étape 1 : générer le fichier de ticks
node --prof app.js

# Cela crée un fichier isolate-0x...-v8.log

# Étape 2 : transformer en rapport lisible
node --prof-process isolate-0x*.log > profile.txt
```

Le rapport contient :
- **Statistical profiling result** : répartition du temps CPU
- **[JavaScript]** : fonctions JS avec pourcentage de ticks
- **[C++]** : fonctions internes V8 (GC, compilation, etc.)
- **[Summary]** : répartition globale JS / C++ / GC

```
  Exemple de sortie --prof-process
  =================================

  [JavaScript]:
   ticks  total  nonlib   name
   1523   45.2%   52.1%  LazyCompile: processData app.js:42
    892   26.5%   30.5%  LazyCompile: sortItems app.js:78
    312    9.3%   10.7%  LazyCompile: formatOutput app.js:115

  [C++]:
   ticks  total  nonlib   name
    234    6.9%    ---    v8::internal::Runtime_StringAdd
    156    4.6%    ---    v8::internal::Heap::AllocateRaw

  [Summary]:
   ticks  total
   2727   81.0%  JavaScript
    512   15.2%  C++
    128    3.8%  GC
```

#### 2.2. `--cpu-prof` et `--heap-prof`

```bash
# Profiling CPU (génère un .cpuprofile chargeable dans DevTools)
node --cpu-prof --cpu-prof-interval=100 app.js

# Profiling mémoire (génère un .heapprofile)
node --heap-prof app.js
```

Ces fichiers s'ouvrent directement dans l'onglet **Performance** ou **Memory**
de Chrome DevTools (chrome://inspect).

#### 2.3. Flags de diagnostic V8

```bash
# Tracer les déoptimisations
node --trace-deopt app.js

# Tracer les inline caches (IC)
node --trace-ic app.js

# Afficher le code optimisé généré
node --print-opt-code app.js

# Tracer le GC (fréquence, durée, type)
node --trace-gc app.js

# Exemple de sortie --trace-gc :
# [12345:0x...]    12 ms: Scavenge 2.1 (6.0) -> 1.8 (7.0) MB, 0.8 ms
# [12345:0x...]   234 ms: Mark-Compact 14.2 (18.0) -> 8.1 (18.0) MB, 12.3 ms
```

### 3. Chrome DevTools — Onglet Performance

```
+-------------------------------------------------------------------+
| Chrome DevTools — Performance Tab                                 |
+-------------------------------------------------------------------+
|  [Record]  [Stop]  [Clear]                                        |
|                                                                   |
|  Timeline (ms)                                                    |
|  0        500       1000      1500      2000                      |
|  |---------|---------|---------|---------|                         |
|                                                                   |
|  === Flame Chart (top-down) ===                                   |
|  +--[ main() ]------------------------------------------+         |
|  |  +--[ processData() ]-------------------------+      |         |
|  |  |  +--[ sort() ]-------+  +--[ render() ]--+ |      |         |
|  |  |  |  +--[ cmp() ]-+  |  |                 | |      |         |
|  |  |  |  +------------+  |  +-----------------+ |      |         |
|  |  |  +-------------------+                      |      |         |
|  |  +---------------------------------------------+      |         |
|  +--------------------------------------------------------+         |
|                                                                   |
|  === Bottom-Up ===              === Call Tree ===                  |
|  cmp()        45.2%             main()       100%                 |
|  sort()       22.1%              processData() 88%                |
|  render()     18.3%               sort()       52%                |
|  GC           8.4%                render()     36%                |
+-------------------------------------------------------------------+
```

**Flame Chart** : chaque barre horizontale est un appel de fonction.
Plus la barre est large, plus la fonction a pris de temps CPU.
Les barres empilées montrent la pile d'appels.

**Bottom-Up** : trie par le temps *self* (temps passé directement dans
la fonction, hors appels enfants). Idéal pour trouver le hotspot.

**Call Tree** : montre la hiérarchie complète depuis la racine.
Idéal pour comprendre *comment* on arrive au hotspot.

### 4. Node.js `perf_hooks` et Clinic.js

#### 4.1. `perf_hooks` — API de mesure intégrée

```typescript
const { performance, PerformanceObserver } = require('node:perf_hooks');

// Observer pour collecter les mesures automatiquement
const obs = new PerformanceObserver((list: PerformanceObserverEntryList) => {
  for (const entry of list.getEntries()) {
    console.log(`${entry.name}: ${entry.duration.toFixed(2)} ms`);
  }
});
obs.observe({ entryTypes: ['measure'] });

// Marquer le début et la fin d'une opération
performance.mark('start-sort');
data.sort((a, b) => a - b);
performance.mark('end-sort');

// Créer la mesure (calcule automatiquement la durée)
performance.measure('tri-données', 'start-sort', 'end-sort');
// Output: "tri-données: 142.35 ms"
```

#### 4.2. Clinic.js — Suite de diagnostic Node.js

```
+---------------------------------------------+
|              Clinic.js Suite                 |
+---------------------------------------------+
| clinic doctor   | Détecte les problèmes     |
|                 | d'event loop, I/O, GC     |
+-----------------+---------------------------+
| clinic flame    | Génère des flame charts   |
|                 | (basé sur 0x)             |
+-----------------+---------------------------+
| clinic bubbleprof | Visualise les opérations|
|                 | asynchrones               |
+-----------------+---------------------------+
| clinic heapprofiler | Analyse mémoire       |
+-----------------+---------------------------+
```

```bash
# Installation
npm install -g clinic

# Diagnostic global (event loop delay, CPU, mémoire)
npx clinic doctor -- node app.js

# Flame chart interactif
npx clinic flame -- node app.js

# Visualisation des opérations async
npx clinic bubbleprof -- node app.js
```

Clinic Doctor génère un rapport HTML avec des recommandations :
- Event loop delay > 20ms ? Probable calcul CPU bloquant.
- Mémoire qui croît linéairement ? Probable fuite mémoire.
- GC fréquent (>10% du temps) ? Trop d'allocations éphémères.

### 5. Anti-patterns de performance

#### 5.1. Accès aux propriétés mégamorphiques

Quand un site d'accès voit trop de formes d'objets différentes (>4 en général),
V8 abandonne le cache inline et passe en mode **mégamorphique** (lookup dans
la table de hachage à chaque accès).

```
  Évolution de l'Inline Cache (IC)
  ==================================

  1 shape    =>  MONOMORPHIC    (1 vérification, accès direct)
  2-4 shapes =>  POLYMORPHIC    (chaîne de if/else, encore rapide)
  5+ shapes  =>  MEGAMORPHIC    (hash table lookup, LENT)

  Coût relatif :
  MONO:  |==|                          ~1x
  POLY:  |=====|                       ~2-3x
  MEGA:  |===================|         ~10-100x
```

```typescript
// --- MAUVAIS : mégamorphique ---
function getX(obj: { x: number; [key: string]: unknown }): number {
  return obj.x; // ce site voit des dizaines de shapes différentes
}

getX({ x: 1 });
getX({ x: 1, y: 2 });
getX({ a: 0, x: 1 });
getX({ x: 1, y: 2, z: 3 });
getX({ w: 0, x: 1 });
// V8 : "trop de shapes => megamorphic IC"

// --- BON : monomorphique ---
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function getX(point: Point): number {
  return point.x; // toujours la même hidden class
}

const p1 = new Point(1, 2);
const p2 = new Point(3, 4);
getX(p1); // monomorphic IC
getX(p2); // même shape => cache hit
```

#### 5.2. Hidden class thrashing

```typescript
// --- MAUVAIS : ordre d'initialisation incohérent ---
function createUser(name: string, age: number): { name: string; age: number } {
  const obj = {};
  if (age > 18) {
    obj.age = age;    // propriété 'age' d'abord
    obj.name = name;  // puis 'name'
  } else {
    obj.name = name;  // propriété 'name' d'abord
    obj.age = age;    // puis 'age'
  }
  return obj;
  // Résultat : DEUX hidden classes différentes
  // HC1: {} -> {age} -> {age, name}
  // HC2: {} -> {name} -> {name, age}
}

// --- BON : initialisation uniforme ---
function createUser(name: string, age: number): { name: string; age: number } {
  return { name, age }; // toujours le même ordre => une seule HC
}
```

```
  Arbre de transitions des Hidden Classes
  ==========================================

  Version MAUVAISE (2 chemins) :

       HC_0 {}
      /         \
  +age          +name
    |               |
  HC_1 {age}    HC_2 {name}
    |               |
  +name          +age
    |               |
  HC_3 {age,name} HC_4 {name,age}   <-- 2 HC différentes !

  Version BONNE (1 seul chemin) :

       HC_0 {}
         |
       {name, age}  (littéral objet)
         |
       HC_1 {name, age}              <-- 1 seule HC pour tous
```

#### 5.3. Allocation excessive dans les boucles chaudes

```typescript
// --- MAUVAIS : allocation dans la boucle ---
function processPixels(pixels: number[]): void {
  for (let i = 0; i < pixels.length; i++) {
    const color = { r: 0, g: 0, b: 0 }; // nouvel objet à chaque itération !
    color.r = pixels[i] & 0xFF;
    color.g = (pixels[i] >> 8) & 0xFF;
    color.b = (pixels[i] >> 16) & 0xFF;
    applyFilter(color);
  }
  // 1 million de pixels => 1 million d'objets éphémères => pression GC
}

// --- BON : réutilisation d'objet ---
function processPixels(pixels: number[]): void {
  const color = { r: 0, g: 0, b: 0 }; // un seul objet, réutilisé
  for (let i = 0; i < pixels.length; i++) {
    color.r = pixels[i] & 0xFF;
    color.g = (pixels[i] >> 8) & 0xFF;
    color.b = (pixels[i] >> 16) & 0xFF;
    applyFilter(color);
  }
}
```

```
  Impact GC : allocation dans hot loop
  ======================================

  1M objets éphémères (24 bytes chacun) = 24 Mo d'allocations

  Young Generation (semi-space) :
  +--[plein]--+--[vide]--+
  | obj obj   |          |   Scavenge déclenché tous les ~4 Mo
  | obj obj   |          |   => ~6 Scavenges pendant la boucle
  +-----------+----------+   => 6 pauses GC de 0.5-2ms chacune

  Avec réutilisation : 1 objet de 24 bytes
  => 0 Scavenge supplémentaire
```

#### 5.4. Concaténation de chaînes dans les boucles

```typescript
// --- MAUVAIS : concaténation O(n^2) en mémoire ---
function buildCSV(rows: string[][]): string {
  let csv = '';
  for (const row of rows) {
    csv += row.join(',') + '\n'; // chaque += peut copier tout le contenu
  }
  return csv;
}
// Avec 100 000 lignes : copies intermédiaires massives

// --- BON : array.join() O(n) ---
function buildCSV(rows: string[][]): string {
  const lines = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    lines[i] = rows[i].join(',');
  }
  return lines.join('\n');
}
```

> **Note V8** : V8 optimise la concaténation avec des *ConsStrings*
> (arbres de chaînes à évaluation paresseuse). Mais au-delà de quelques
> centaines de concaténations, le coût de *flattening* (linéarisation
> de l'arbre en une vraie chaîne) devient prohibitif.

```
  ConsString (représentation interne V8)
  ========================================

  "hello" + " " + "world" + "!"

  Représentation en mémoire (arbre) :
           ConsString
          /          \
     ConsString      "!"
    /         \
  ConsString  "world"
  /        \
"hello"   " "

  Quand on accède à str[i] ou str.indexOf(), V8 doit "flattenir"
  l'arbre en une chaîne contiguë => O(n) à chaque flattening.
```

#### 5.5. `JSON.parse`/`JSON.stringify` dans les chemins chauds

```typescript
// --- MAUVAIS : deep clone par JSON round-trip ---
function processItem(template: Record<string, unknown>): void {
  for (let i = 0; i < 100_000; i++) {
    const item = JSON.parse(JSON.stringify(template)); // TRÈS coûteux
    item.id = i;
    results.push(item);
  }
}
// JSON.stringify : parcours récursif + sérialisation texte
// JSON.parse : tokenisation + construction d'objets
// Coût : O(n) par appel, DEUX FOIS

// --- BON : spread (shallow clone) ---
function processItem(template) {
  for (let i = 0; i < 100_000; i++) {
    const item = { ...template, id: i }; // 10-50x plus rapide
    results.push(item);
  }
}

// --- BON : structuredClone (deep clone natif, si nécessaire) ---
function processItem(template) {
  for (let i = 0; i < 100_000; i++) {
    const item = structuredClone(template); // 2-5x plus rapide que JSON
    item.id = i;
    results.push(item);
  }
}
```

#### 5.6. I/O synchrone dans la boucle d'événements Node.js

```typescript
// --- MAUVAIS : bloque l'event loop ---
const fs = require('node:fs');
app.get('/config', (req, res) => {
  const data = fs.readFileSync('/etc/app/config.json', 'utf8'); // SYNC !
  res.json(JSON.parse(data));
});
// Chaque requête bloque le thread principal pendant le I/O disque

// --- BON : asynchrone + cache ---
const fs = require('node:fs/promises');
let configCache = null;

app.get('/config', async (req, res) => {
  if (!configCache) {
    const data = await fs.readFile('/etc/app/config.json', 'utf8');
    configCache = JSON.parse(data);
  }
  res.json(configCache);
});
```

### 6. Object pooling et réutilisation d'objets

Le pattern **object pool** pré-alloue un ensemble d'objets et les recycle
au lieu de les laisser au garbage collector.

```
  Object Pool — Cycle de vie
  ============================

  Initialisation :
  +-------+-------+-------+-------+-------+
  | obj_0 | obj_1 | obj_2 | obj_3 | obj_4 |   Pool (pré-alloué)
  | libre | libre | libre | libre | libre |   size = 5
  +-------+-------+-------+-------+-------+

  Après acquire() x3 :
  +-------+-------+-------+-------+-------+
  |       |       |       | obj_3 | obj_4 |   Pool restant
  |       |       |       | libre | libre |   size = 2
  +-------+-------+-------+-------+-------+
   obj_0   obj_1   obj_2
   (utilisés par le code client)

  Après release(obj_1) :
  +-------+-------+-------+-------+-------+
  |       |       | obj_1 | obj_3 | obj_4 |   Pool restant
  |       |       | reset | libre | libre |   size = 3
  +-------+-------+-------+-------+-------+
```

```typescript
class ObjectPool<T> {
  private _factory: () => T;
  private _reset: (obj: T) => void;
  private _pool: T[];
  private _size: number;

  constructor(factory: () => T, reset: (obj: T) => void, initialSize: number = 100) {
    this._factory = factory;
    this._reset = reset;
    this._pool = new Array(initialSize);
    this._size = initialSize;
    for (let i = 0; i < initialSize; i++) {
      this._pool[i] = factory();
    }
  }

  acquire(): T {
    if (this._size > 0) {
      return this._pool[--this._size];
    }
    // Pool vide : fallback allocation (éviter de crasher)
    return this._factory();
  }

  release(obj: T): void {
    this._reset(obj);
    if (this._size < this._pool.length) {
      this._pool[this._size++] = obj;
    }
    // Si le pool est plein, on laisse le GC récupérer l'objet
  }

  get available() { return this._size; }
}

// Exemple : pool de vecteurs 3D pour une simulation physique
interface Vec3 { x: number; y: number; z: number }
const vecPool = new ObjectPool<Vec3>(
  () => ({ x: 0, y: 0, z: 0 }),         // factory
  (v) => { v.x = 0; v.y = 0; v.z = 0; }, // reset
  1000
);

function simulate(particles: { x: number; y: number; z: number; vx: number; vy: number; vz: number }[], dt: number): void {
  for (const p of particles) {
    const vel = vecPool.acquire();
    vel.x = p.vx * dt;
    vel.y = p.vy * dt;
    vel.z = p.vz * dt;
    p.x += vel.x;
    p.y += vel.y;
    p.z += vel.z;
    vecPool.release(vel);
  }
  // Zéro allocation dans la boucle => pas de pression GC
}
```

### 7. Itération efficace : benchmarks et internals V8

```
  Coût relatif (V8, tableau dense PACKED_SMI, 10M éléments)
  ===========================================================

  Boucle              Temps relatif   Mécanisme interne
  -----------------   -------------   ---------------------------------
  for (i=0;i<n;i++)      1.0x        Accès direct par index compilé,
                                       bounds check éliminé par TurboFan,
                                       pas de frame supplémentaire

  while (i < n)           1.0x        Identique au for classique après
                                       compilation

  for...of                ~1.1-1.3x   Protocole itérateur : V8 crée un
                                       objet iterator, appelle .next()
                                       à chaque pas. Optimisé pour les
                                       tableaux mais léger overhead.

  forEach                 ~1.5-2.5x   Appel de callback par élément :
                                       nouveau frame de pile à chaque
                                       itération. TurboFan peut inliner
                                       le callback si la taille est
                                       raisonnable.

  for...in                ~5-20x      Conçu pour les clés d'objet.
                                       Énumère les clés chaîne + remonte
                                       la chaîne prototype.
                                       NE JAMAIS utiliser sur les arrays.
```

> **Attention** : ces chiffres varient selon la version de V8, le type
> d'éléments du tableau (SMI, DOUBLE, PACKED, HOLEY) et la nature du
> travail dans la boucle. Toujours mesurer sur votre cas réel.

### 8. Optimisation des tableaux

#### 8.1. Tableaux pré-alloués

```typescript
// --- LENT : le tableau grandit dynamiquement ---
const result = [];
for (let i = 0; i < 1_000_000; i++) {
  result.push(computeValue(i));
  // V8 réalloue le backing store quand la capacité est atteinte
  // Réallocations typiques : 4 -> 8 -> 16 -> 32 -> ... -> 1M
  // Chaque réallocation copie TOUS les éléments existants
}

// --- RAPIDE : taille connue à l'avance ---
const result = new Array(1_000_000);
for (let i = 0; i < 1_000_000; i++) {
  result[i] = computeValue(i); // pas de réallocation
}

// ATTENTION : new Array(n) crée un tableau HOLEY (éléments non définis).
// V8 utilise un chemin d'accès plus lent pour les tableaux HOLEY car il
// doit vérifier la présence de "holes" à chaque accès d'index.
// Si la performance d'itération post-remplissage est critique, préférez :
//   const result = Array.from({ length: 1_000_000 }, (_, i) => computeValue(i));
// Cela crée un tableau PACKED dès le départ (pas de hole check).
// Voir : https://v8.dev/blog/elements-kinds
```

#### 8.2. Typed Arrays pour le travail numérique

```typescript
// Typed Arrays : mémoire contiguë, pas de boxing, accès direct par offset
const positions = new Float64Array(3 * numParticles);
const velocities = new Float64Array(3 * numParticles);
// Layout : [x0, y0, z0, x1, y1, z1, ...]

for (let i = 0; i < numParticles; i++) {
  const base = i * 3;
  positions[base]     += velocities[base]     * dt; // x
  positions[base + 1] += velocities[base + 1] * dt; // y
  positions[base + 2] += velocities[base + 2] * dt; // z
}
// V8/TurboFan génère du code machine quasi-natif pour ce pattern :
// - Accès par offset fixe (pas de lookup de propriété)
// - Pas de type check (Float64 garanti)
// - Cache CPU friendly (données contiguës en mémoire)
```

```
  Mémoire : Array classique vs TypedArray
  =========================================

  Array classique (PACKED_DOUBLE) :
  +---------+---------+---------+---------+
  | Header  | Elem[0] | Elem[1] | Elem[2] |   Chaque élément peut
  | (map,   | 64-bit  | 64-bit  | 64-bit  |   être n'importe quel
  |  length,| double  | double  | double  |   type JS (boxed si
  |  elems) |         |         |         |   nécessaire)
  +---------+---------+---------+---------+

  Float64Array :
  +--------+-----------------------------+
  | Header | ArrayBuffer (mémoire brute) |
  +--------+-----------------------------+
           | 64-bit | 64-bit | 64-bit |
           | float  | float  | float  |
           +--------+--------+--------+
           Accès direct par offset mémoire
           Pas de vérification de type par élément
           Compatible SharedArrayBuffer (multi-thread)
```

### 9. Web Workers pour le travail CPU-intensif

```
  Thread principal              Worker Thread
  ==================            =================
  |                             |
  | postMessage(data) --------> |
  |                             | // calcul lourd
  | (event loop libre,         | // sur thread séparé
  |  UI réactive,              | // propre heap V8
  |  I/O traités)              |
  |                             |
  | <-------- postMessage(res)  |
  | onmessage(result)          |
  |                             | terminate()
```

```typescript
// main.js (navigateur)
const worker = new Worker('heavy-compute.js');

worker.postMessage({ pixels: imageData, filter: 'blur' });

worker.onmessage = (e) => {
  console.log('Résultat reçu en', e.data.duration, 'ms');
  applyResult(e.data.output);
};

worker.onerror = (e) => {
  console.error('Erreur Worker:', e.message);
};
```

```typescript
// heavy-compute.js (Worker)
self.onmessage = (e) => {
  const start = performance.now();
  const output = applyFilter(e.data.pixels, e.data.filter);
  const duration = performance.now() - start;
  self.postMessage({ output, duration });
};

function applyFilter(pixels, type) {
  // Travail CPU-intensif qui ne bloque PAS le thread principal
  const result = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const avg = (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
    result[i] = result[i+1] = result[i+2] = avg;
    result[i+3] = pixels[i+3]; // alpha inchangé
  }
  return result;
}
```

---

## Démonstration

### Démo 1 — Mesurer avec `performance.mark` / `performance.measure`

```typescript
// demo-perf-marks.mjs
import { performance, PerformanceObserver } from 'node:perf_hooks';

const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log(`  ${entry.name}: ${entry.duration.toFixed(3)} ms`);
  }
});
obs.observe({ entryTypes: ['measure'] });

// --- Fonction naïve : boucle ---
function sumNaive(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += i;
  }
  return total;
}

// --- Fonction optimisée : formule de Gauss ---
function sumGauss(n: number): number {
  return (n * (n - 1)) / 2;
}

const N = 100_000_000;

performance.mark('naive-start');
const r1 = sumNaive(N);
performance.mark('naive-end');
performance.measure('sumNaive (boucle)', 'naive-start', 'naive-end');

performance.mark('gauss-start');
const r2 = sumGauss(N);
performance.mark('gauss-end');
performance.measure('sumGauss (formule)', 'gauss-start', 'gauss-end');

console.log(`Résultats identiques : ${r1 === r2}`);
obs.disconnect();
```

### Démo 2 — Détecter le hidden class thrashing avec `--trace-ic`

```typescript
// demo-hidden-class-thrash.mjs
// Lancer avec : node --trace-ic demo-hidden-class-thrash.mjs 2>&1 | head -50

function readName(obj: { name: string }): string {
  return obj.name;
}

// Scénario 1 : monomorphique — même shape à chaque appel
console.log('=== Scénario monomorphique ===');
for (let i = 0; i < 1000; i++) {
  readName({ name: 'Alice', age: 30 });
}

// Scénario 2 : mégamorphique — shapes variées
console.log('=== Scénario mégamorphique ===');
const shapes = [
  { name: 'A' },
  { name: 'B', x: 1 },
  { name: 'C', x: 1, y: 2 },
  { name: 'D', x: 1, y: 2, z: 3 },
  { name: 'E', a: 1, b: 2, c: 3, d: 4 },
  { q: 0, name: 'F' },
];

for (let i = 0; i < 1000; i++) {
  readName(shapes[i % shapes.length]);
}

console.log('Vérifiez la sortie --trace-ic :');
console.log('  MONOMORPHIC => rapide (1 check, accès direct)');
console.log('  MEGAMORPHIC => lent (hash table lookup)');
```

### Démo 3 — Concaténation de chaînes : benchmark comparatif

```typescript
// demo-string-concat.mjs
import { performance } from 'node:perf_hooks';

const ROWS = 200_000;
const data = Array.from({ length: ROWS }, (_, i) =>
  [i, `item_${i}`, Math.random().toFixed(4)]
);

function benchConcatenation(data: (string | number)[][]): string {
  let csv = '';
  for (const row of data) {
    csv += row.join(',') + '\n';
  }
  return csv;
}

function benchArrayJoin(data: (string | number)[][]): string {
  const lines = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    lines[i] = data[i].join(',');
  }
  return lines.join('\n');
}

// Warmup (permettre à V8 de compiler les fonctions)
benchConcatenation(data.slice(0, 100));
benchArrayJoin(data.slice(0, 100));

// Benchmark
const t1 = performance.now();
const r1 = benchConcatenation(data);
const t2 = performance.now();
const r2 = benchArrayJoin(data);
const t3 = performance.now();

console.log(`Concaténation (+=)  : ${(t2 - t1).toFixed(1)} ms`);
console.log(`Array.join()        : ${(t3 - t2).toFixed(1)} ms`);
console.log(`Ratio               : ${((t2 - t1) / (t3 - t2)).toFixed(2)}x plus lent`);
console.log(`Tailles résultat    : ${r1.length} vs ${r2.length}`);
```

### Démo 4 — Object pool vs allocation libre

```typescript
// demo-object-pool.mjs
import { performance } from 'node:perf_hooks';

class VecPool {
  pool: { x: number; y: number; z: number }[];
  idx: number;
  constructor(size: number) {
    this.pool = new Array(size);
    this.idx = size;
    for (let i = 0; i < size; i++) {
      this.pool[i] = { x: 0, y: 0, z: 0 };
    }
  }
  acquire(): { x: number; y: number; z: number } {
    return this.idx > 0 ? this.pool[--this.idx] : { x: 0, y: 0, z: 0 };
  }
  release(v: { x: number; y: number; z: number }): void {
    v.x = 0; v.y = 0; v.z = 0;
    this.pool[this.idx++] = v;
  }
}

const ITERATIONS = 5_000_000;

// --- Sans pool : allocation à chaque itération ---
const t1 = performance.now();
let sum1 = 0;
for (let i = 0; i < ITERATIONS; i++) {
  const v = { x: i, y: i * 2, z: i * 3 };
  sum1 += v.x + v.y + v.z;
}
const t2 = performance.now();

// --- Avec pool : un seul objet recyclé ---
const pool = new VecPool(1);
const t3 = performance.now();
let sum2 = 0;
for (let i = 0; i < ITERATIONS; i++) {
  const v = pool.acquire();
  v.x = i; v.y = i * 2; v.z = i * 3;
  sum2 += v.x + v.y + v.z;
  pool.release(v);
}
const t4 = performance.now();

console.log(`Sans pool : ${(t2 - t1).toFixed(1)} ms`);
console.log(`Avec pool : ${(t4 - t3).toFixed(1)} ms`);
console.log(`Ratio     : ${((t2 - t1) / (t4 - t3)).toFixed(2)}x`);
console.log(`Checksums : ${sum1 === sum2}`);
```

### Démo 5 — Profiler, identifier, optimiser (workflow complet)

```typescript
// demo-profile-optimize.mjs
// Lancer avec : node --cpu-prof demo-profile-optimize.mjs
// Puis ouvrir le .cpuprofile dans Chrome DevTools > Performance
import { performance } from 'node:perf_hooks';

// =============================================
// Version LENTE (volontairement mal écrite)
// =============================================
function processDataSlow(records: { name: string; score: number }[]): string[] {
  let output = '';
  for (let i = 0; i < records.length; i++) {
    // Anti-pattern 1 : deep clone par JSON round-trip
    const copy = JSON.parse(JSON.stringify(records[i]));
    // Anti-pattern 2 : concaténation de chaîne
    output += `${copy.name}:${copy.score}\n`;
  }
  // Anti-pattern 3 : split + re-tri (travail redondant)
  const lines = output.split('\n').filter(Boolean);
  lines.sort(); // tri lexicographique (incorrect pour des scores numériques)
  return lines;
}

// =============================================
// Version RAPIDE (optimisée)
// =============================================
function processDataFast(records: { name: string; score: number }[]): string[] {
  // Pré-allouer le tableau de sortie
  const entries = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    // Pas de clone : accès direct aux propriétés nécessaires
    entries[i] = { name: records[i].name, score: records[i].score };
  }
  // Tri numérique correct, en une seule passe
  entries.sort((a, b) => a.score - b.score);
  // Construction du résultat en une seule opération
  return entries.map(e => `${e.name}:${e.score}`);
}

// Générer des données de test réalistes
const N = 100_000;
const records = Array.from({ length: N }, (_, i) => ({
  name: `user_${String(i).padStart(6, '0')}`,
  score: Math.floor(Math.random() * 10000),
  email: `user${i}@example.com`,
  metadata: { created: Date.now(), tags: ['a', 'b'] },
}));

console.log('--- Version lente ---');
const t1 = performance.now();
const r1 = processDataSlow(records);
const t2 = performance.now();
console.log(`  Durée : ${(t2 - t1).toFixed(1)} ms, lignes : ${r1.length}`);

console.log('--- Version rapide ---');
const t3 = performance.now();
const r2 = processDataFast(records);
const t4 = performance.now();
console.log(`  Durée : ${(t4 - t3).toFixed(1)} ms, lignes : ${r2.length}`);
console.log(`  Accélération : ${((t2 - t1) / (t4 - t3)).toFixed(1)}x`);
```

---

### V8 vs SpiderMonkey (Firefox)

Les anti-patterns de performance décrits dans ce module sont **universels** — ils s'appliquent à tous les moteurs JS. En revanche, les **outils de profiling** diffèrent selon le navigateur ou le runtime.

**Outils de profiling comparés :**

| Fonctionnalité | Chrome / Node.js (V8) | Firefox (SpiderMonkey) |
|---|---|---|
| Profiling CPU | Chrome DevTools → Performance tab | **Firefox Profiler** (profiler.firefox.com) |
| Flame charts | DevTools Performance → flame chart | Firefox Profiler → flame chart |
| Node.js CLI profiling | `node --prof` + `--prof-process` | *(non applicable — spécifique V8/Node)* |
| Profiling GC | `node --trace-gc` | `about:memory` + compteurs GC internes |
| Suite de diagnostic Node | **Clinic.js** (doctor, flame, bubbleprof) | *(non applicable — spécifique V8/Node)* |
| Inline Cache diagnostic | `node --trace-ic` | `about:config` → flags JIT internes |

**Points clés :**

- **Chrome DevTools Performance tab vs Firefox Profiler** : les deux offrent des flame charts, des vues bottom-up et call tree, et la possibilité d'enregistrer des traces de performance. L'interface est différente, mais les concepts sont les mêmes.
- **`--prof` est spécifique à V8/Node.js.** Il n'existe pas d'équivalent direct pour SpiderMonkey en ligne de commande. Firefox utilise son propre **Gecko Profiler** intégré.
- **Clinic.js est spécifique à Node.js** (et donc à V8). Il n'y a pas d'équivalent pour les applications Firefox.
- **Les anti-patterns sont universels** : l'allocation excessive dans les boucles chaudes, la concaténation de chaînes en boucle, les IC mégamorphiques, le JSON round-trip pour le clonage — tout cela nuit à la performance dans **tous** les moteurs.

> **À retenir** : apprends la méthodologie (mesurer → identifier → corriger → re-mesurer) et les anti-patterns. Les outils changent d'un navigateur à l'autre, mais la démarche est identique.

---

## Points clés

1. **Toujours mesurer avant d'optimiser** — le profiler est votre allié, l'intuition est votre ennemi.
2. **V8 fournit des outils puissants** : `--prof`, `--cpu-prof`, `--trace-deopt`, `--trace-ic` permettent de voir exactement ce que fait le moteur.
3. **Chrome DevTools Performance** offre trois vues complémentaires : flame chart (vue d'ensemble), bottom-up (trouver le hotspot), call tree (comprendre le contexte).
4. **Les IC mégamorphiques** tuent la performance : gardez des formes d'objets uniformes dans les chemins chauds.
5. **L'allocation dans les boucles chaudes** crée une pression GC massive : réutilisez les objets ou utilisez un pool.
6. **La concaténation de chaînes** en boucle crée des ConsStrings coûteuses à linéariser : préférez `Array.join()`.
7. **`JSON.parse(JSON.stringify())`** est le pire moyen de cloner dans un chemin chaud : préférez le spread ou `structuredClone`.
8. **Les Typed Arrays** offrent un accès mémoire contigu et des performances proches du natif pour le travail numérique.
9. **Le choix de boucle compte** dans les chemins chauds : `for` classique > `for...of` > `forEach` > `for...in`.
10. **L'object pooling** élimine la pression GC dans les scénarios à haute fréquence d'allocation/désallocation.

---

## Lab associé

**Lab 12 — Audit de performance** (`labs/12-performance-audit/`)

Dans ce lab, vous recevrez une application Node.js volontairement mal optimisée
(un serveur HTTP qui traite des données JSON). Vous devrez :

1. Profiler l'application avec `--cpu-prof` et `--trace-gc`
2. Identifier les 3 goulots d'étranglement principaux
3. Corriger chaque problème en appliquant les patterns de ce module
4. Démontrer l'amélioration avec des mesures avant/après

---

## Pour aller plus loin

- [V8 Blog — Optimizing V8 Memory Consumption](https://v8.dev/blog/optimizing-v8-memory)
- [V8 Blog — Fast Properties](https://v8.dev/blog/fast-properties)
- [V8 Blog — Elements Kinds in V8](https://v8.dev/blog/elements-kinds)
- [Chrome DevTools — Analyze Runtime Performance](https://developer.chrome.com/docs/devtools/performance)
- [Node.js — perf_hooks documentation](https://nodejs.org/api/perf_hooks.html)
- [Clinic.js — Documentation](https://clinicjs.org/documentation/)
- [MDN — Web Workers API](https://developer.mozilla.org/fr/docs/Web/API/Web_Workers_API)
- [MDN — TypedArray](https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Global_Objects/TypedArray)
- [web.dev — Optimize Long Tasks](https://web.dev/articles/optimize-long-tasks)
- [TC39 — ECMA-262: Array Objects](https://tc39.es/ecma262/#sec-array-objects)

---

## Défi

Considérez cette fonction qui traite un flux de données de capteurs :

```typescript
function processSensorData(readings: { ts: number; val: number; max: number; id: string }[]): { id: string; avg: number; report: string }[] {
  const results: { timestamp: number; value: number; normalized: number; label: string }[] = [];
  for (const reading of readings) {
    const point = {
      timestamp: reading.ts,
      value: reading.val,
      normalized: reading.val / reading.max,
      label: `sensor-${reading.id}-${reading.ts}`,
    };
    results.push(point);
  }

  const summary: Record<string, { sum: number; count: number }> = {};
  for (const r of results) {
    const key = r.label.split('-')[1]; // extraire l'id du sensor
    if (!summary[key]) {
      summary[key] = { sum: 0, count: 0 };
    }
    summary[key].sum += r.normalized;
    summary[key].count++;
  }

  return Object.keys(summary).map(k => ({
    id: k,
    avg: summary[k].sum / summary[k].count,
    report: JSON.stringify(summary[k]),
  }));
}
```

**Question** : Cette fonction est appelée 60 fois par seconde avec 10 000
lectures à chaque appel. Identifiez **au moins 5 problèmes de performance**
et proposez une version optimisée.

<details>
<summary>Réponse</summary>

**5 problèmes identifiés :**

1. **Allocation massive dans la boucle** : `point = { ... }` crée 10 000
   objets par appel, soit 600 000 objets/seconde. Chaque objet a 4 propriétés.
   Solution : traiter directement sans objet intermédiaire.

2. **Template literal + split** : `` `sensor-${id}-${ts}` `` crée 10 000
   chaînes, puis `split('-')` crée 30 000 sous-chaînes pour retrouver l'id.
   Solution : utiliser `reading.id` directement sans passer par une chaîne.

3. **Double itération inutile** : on crée le tableau `results` puis on le
   parcourt pour construire `summary`. Solution : fusionner en une seule passe.

4. **`JSON.stringify` dans le résultat final** : sérialisation inutile si
   les consommateurs travaillent en JavaScript. Solution : retourner les
   objets directement.

5. **`Object.keys().map()`** : crée un tableau intermédiaire de clés string.
   Solution : utiliser une `Map` et itérer directement avec `for...of`.

**Bonus** : `results.push()` cause des réallocations dynamiques du backing
store. Avec `new Array(readings.length)` + assignation par index, on évite
ces réallocations.

**Version optimisée :**

```typescript
// Réutiliser le Map entre les appels (pas de réallocation)
const summaryCache = new Map<string, { sum: number; count: number }>();

function processSensorDataFast(readings: { val: number; max: number; id: string }[]): { id: string; avg: number; sum: number; count: number }[] {
  summaryCache.clear();

  // Une seule passe, pas d'objet intermédiaire, pas de chaîne
  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    const normalized = r.val / r.max;
    const id = r.id; // accès direct, pas de template + split

    let entry = summaryCache.get(id);
    if (entry === undefined) {
      entry = { sum: 0, count: 0 };
      summaryCache.set(id, entry);
    }
    entry.sum += normalized;
    entry.count++;
  }

  // Pré-allouer le tableau de sortie
  const output = new Array(summaryCache.size);
  let idx = 0;
  for (const [id, entry] of summaryCache) {
    output[idx++] = {
      id,
      avg: entry.sum / entry.count,
      sum: entry.sum,
      count: entry.count,
    };
  }
  return output;
}
```

**Gains estimés** :
- Allocations : ~40 000 objets/appel vers ~N_capteurs objets/appel
- Chaînes : 40 000 chaînes/appel vers 0
- Itérations : 2 passes vers 1 passe
- JSON.stringify : supprimé
- `Map` au lieu d'objet plain pour les clés dynamiques (pas de hidden class thrashing)
- Accélération attendue : **5-15x** selon le nombre de capteurs uniques

</details>
