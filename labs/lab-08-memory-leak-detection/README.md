# Lab 08 — Détection et correction d'une fuite mémoire

> **Outcome :** à la fin, tu sais reproduire une fuite mémoire réaliste, la **prouver** avec la méthode des 3 heap snapshots (`v8.writeHeapSnapshot()` + Chrome DevTools), remonter l'arbre des retainers jusqu'à la référence fautive, et la corriger (cache LRU borné + cleanup de listener).
> **Vrai outil :** Node.js (≥ 20) avec `--expose-gc`, `v8.writeHeapSnapshot()`, `process.memoryUsage()`, et l'onglet **Memory** de Chrome DevTools (vue Comparison + Retainers). Aucun harnais simulé, aucun test-runner.
> **Feedback :** le coach valide en session en lisant ta sortie console, tes trois `.heapsnapshot` chargés dans DevTools, et ton interprétation de l'arbre des retainers.

## Énoncé

On reproduit la fuite de l'API TribuZen vue dans le module : un `FamiliesService` qui **(1)** cache des familles dans un `Map` jamais borné et **(2)** ajoute un listener `family:updated` sur un `EventEmitter` global **à chaque requête**, sans jamais le retirer. En trafic constant, le tas monte en escalier jusqu'à l'OOM.

Tu vas écrire **un seul fichier** `leak-lab.js`, lancé avec `node --expose-gc leak-lab.js`, qui :

1. **Reproduit** la fuite et écrit trois heap snapshots (repos / après charge / après GC).
2. **Prouve** la fuite : `heapUsed` ne redescend pas après GC, `cache.size` et `listenerCount` explosent.
3. **Corrige** les deux sources (cache LRU borné + un seul listener retiré au `dispose()`) et montre que le tas redescend.

Puis tu ouvres les `.heapsnapshot` dans Chrome DevTools et tu appliques la **vue Comparison** + l'**arbre des retainers** pour nommer la référence fautive.

### Starter minimal (à compléter, pas de gap-fill dirigé)

```js
// leak-lab.js — lancer : node --expose-gc leak-lab.js
if (typeof global.gc !== 'function') {
  console.error('Relance avec :  node --expose-gc leak-lab.js');
  process.exit(1);
}
const v8 = require('v8');
const { EventEmitter } = require('events');

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' Mo';
const heap = () => process.memoryUsage().heapUsed;

// À toi : LRUCache, FamiliesServiceLeaky, FamiliesServiceFixed, reproduire(), corriger()
```

### Comment analyser les snapshots dans DevTools

```
1. Ouvre Chrome -> DevTools (F12) -> onglet "Memory"
2. Bouton "Load profile..." -> charge A.heapsnapshot, puis C.heapsnapshot
3. Sélectionne C -> menu déroulant en haut à gauche -> "Comparison" -> base = A
4. Trie par "# New" ou "Size Delta" décroissant
5. Repère les constructeurs à delta positif (Map, (closure), system / Context...)
6. Déplie un objet suspect -> panneau "Retainers" en bas -> remonte jusqu'à un root
```

---

## Étapes (en friction)

1. **Écris `LRUCache`** (clé `string` → `WeakMap` impossible, il faut une éviction). `#map = new Map()`, `#max`. `get` : ré-insère la clé en fin (marque « récemment utilisé »). `set` : si plein, `delete` la première clé de `keys().next().value` (la plus ancienne) avant d'insérer.
2. **Écris `FamiliesServiceLeaky`** : un `cache = new Map()` ; `getFamily(id)` charge un objet lourd (`members: new Array(200).fill({ role: 'member' })`), ajoute `bus.on('family:updated', evt => …)` **dans** `getFamily` (la fuite (2)), puis `cache.set(id, family)` (la fuite (1)). Fais `bus.setMaxListeners(0)` pour observer la fuite sans le warning.
3. **Écris `reproduire()`** : `global.gc()`, log + `writeHeapSnapshot('A.heapsnapshot')` (repos) ; martèle `getFamily('fam-'+i)` 50 000 fois avec des ids **uniques** (0 hit) ; log + `B.heapsnapshot` ; `global.gc()` ; log + `C.heapsnapshot`. Affiche `cache.size` et `bus.listenerCount('family:updated')`.
4. **Constate** : entre B et C le tas **ne redescend pas** ; les deux compteurs valent 50 000. Charge `A` et `C` dans DevTools, vue Comparison → identifie les deltas, remonte les retainers jusqu'à `.cache` et la liste de listeners.
5. **Écris `FamiliesServiceFixed`** : `cache = new LRUCache(500)` ; **un seul** listener `this.onUpdated` enregistré au constructeur ; `getFamily` sans `bus.on` ; méthode `dispose()` qui fait `bus.off('family:updated', this.onUpdated)`.
6. **Écris `corriger()`** : refais le martèlement 50 000 fois sur la version fixée, `dispose()`, `global.gc()`, et prouve que `cache.size <= 500`, `listenerCount === 0`, et que `heapUsed` est retombé proche du repos.
7. **Interprète à voix haute** pour le coach : pourquoi `WeakMap` ne convenait pas ici, et pourquoi les deux fixes sont **orthogonaux** (l'un sans l'autre laisse une fuite).

---

## Corrigé complet commenté

```js
// leak-lab.js — lancer : node --expose-gc leak-lab.js
if (typeof global.gc !== 'function') {
  console.error('Relance avec :  node --expose-gc leak-lab.js');
  process.exit(1);
}
const v8 = require('v8');
const { EventEmitter } = require('events');

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' Mo';
const heap = () => process.memoryUsage().heapUsed; // tas V8 utilisé : le plus parlant

// Bus global qui vit toute la durée du process (comme le bus d'events TribuZen)
const bus = new EventEmitter();
bus.setMaxListeners(0); // désactive MaxListenersExceededWarning pour observer la fuite "pure"

// ─── Cache LRU borné : clé = string (familyId) donc WeakMap impossible ──────
class LRUCache {
  #map = new Map(); // Map itère dans l'ordre d'insertion -> tête = plus ancien
  #max;
  constructor(max = 500) { this.#max = max; }

  get(key) {
    if (!this.#map.has(key)) return undefined;
    const v = this.#map.get(key);
    this.#map.delete(key); this.#map.set(key, v); // ré-insère en fin = "récemment utilisé"
    return v;
  }

  set(key, value) {
    if (this.#map.has(key)) {
      this.#map.delete(key);
    } else if (this.#map.size >= this.#max) {
      // évince la clé la plus anciennement utilisée = première du Map
      this.#map.delete(this.#map.keys().next().value);
    }
    this.#map.set(key, value);
  }

  get size() { return this.#map.size; }
}

// Simule le chargement d'une famille lourde (membres, etc.)
function loadFamily(id) {
  return { id, members: new Array(200).fill({ role: 'member' }) };
}

// ─── Version qui FUIT (les deux sources cumulées) ───────────────────────────
class FamiliesServiceLeaky {
  cache = new Map(); // (1) jamais borné, jamais vidé

  async getFamily(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const family = loadFamily(id);
    // (2) un listener AJOUTÉ À CHAQUE requête, jamais retiré.
    // La closure capture `id` -> retient l'entrée de cache correspondante.
    bus.on('family:updated', (evt) => {
      if (evt.id === id) this.cache.set(id, evt.family);
    });
    this.cache.set(id, family);
    return family;
  }
}

// ─── Version CORRIGÉE ───────────────────────────────────────────────────────
class FamiliesServiceFixed {
  constructor() {
    this.cache = new LRUCache(500); // (1) borné : 500 familles max en mémoire
    // (2) UN SEUL listener, au niveau du service, dont on garde la référence
    this.onUpdated = (evt) => this.cache.set(evt.id, evt.family);
    bus.on('family:updated', this.onUpdated);
  }

  async getFamily(id) {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const family = loadFamily(id);
    this.cache.set(id, family); // LRU évince le plus ancien au-delà de 500
    return family;
  }

  dispose() {
    bus.off('family:updated', this.onUpdated); // cleanup explicite : coupe l'arête depuis le bus
    this.cache = null;
  }
}

async function hammer(service, n) {
  for (let i = 0; i < n; i++) await service.getFamily(`fam-${i}`); // ids uniques -> 0 hit
}

// ─── Partie A : reproduire et PROUVER la fuite ──────────────────────────────
async function reproduire() {
  console.log('\n=== Reproduction de la fuite (3 snapshots) ===');
  const svc = new FamiliesServiceLeaky();

  global.gc();
  console.log(`  Snap A (repos)         : ${mb(heap())}`);
  v8.writeHeapSnapshot('A.heapsnapshot');

  await hammer(svc, 50_000);
  console.log(`  Snap B (après 50k req) : ${mb(heap())}`);
  v8.writeHeapSnapshot('B.heapsnapshot');

  global.gc(); // le déchet légitime part ; ce qui reste au-dessus de A est suspect
  console.log(`  Snap C (après GC)      : ${mb(heap())}   <- NE redescend PAS = fuite`);
  console.log(`    cache.size           : ${svc.cache.size}`);
  console.log(`    listeners sur le bus : ${bus.listenerCount('family:updated')}`);
  v8.writeHeapSnapshot('C.heapsnapshot');

  // Nettoyage pour ne pas polluer la partie B : on retire tous les listeners empilés
  bus.removeAllListeners('family:updated');
}

// ─── Partie B : corriger et prouver que le tas redescend ────────────────────
async function corriger() {
  console.log('\n=== Version corrigée ===');
  global.gc();
  const base = heap();

  const svc = new FamiliesServiceFixed();
  await hammer(svc, 50_000);
  const afterHammer = heap();

  svc.dispose();  // retire le listener + coupe la réf au cache
  global.gc();
  const afterFix = heap();

  console.log(`  repos                  : ${mb(base)}`);
  console.log(`  après 50k req          : ${mb(afterHammer)}`);
  console.log(`  après dispose + GC     : ${mb(afterFix)}   <- redescend proche du repos`);
  console.log(`    cache.size (borné)   : ${svc.cache ? svc.cache.size : 0} (<= 500)`);
  console.log(`    listeners sur le bus : ${bus.listenerCount('family:updated')} (0)`);
}

(async () => {
  await reproduire();
  await corriger();
  console.log('\n--- Charge A.heapsnapshot et C.heapsnapshot dans Chrome DevTools -> Memory ---');
  console.log('--- Vue "Comparison" (base = A) : delta sur Map (elements) + closures ---');
  console.log('--- Panneau "Retainers" : remonte jusqu\'à FamiliesService.cache / liste du bus ---');
})();
```

Sortie attendue (les chiffres varient selon la machine, l'ordre de grandeur compte) :

```
=== Reproduction de la fuite (3 snapshots) ===
  Snap A (repos)         : 3.10 Mo
  Snap B (après 50k req) : 78.40 Mo
  Snap C (après GC)      : 61.20 Mo   <- NE redescend PAS = fuite
    cache.size           : 50000
    listeners sur le bus : 50000
  Snap C (après GC)      : ...

=== Version corrigée ===
  repos                  : 3.30 Mo
  après 50k req          : 12.80 Mo
  après dispose + GC     : 3.90 Mo   <- redescend proche du repos
    cache.size (borné)   : 0 (<= 500)
    listeners sur le bus : 0 (0)
```

**Pourquoi ce corrigé est correct :**
- Les deux fixes sont **orthogonaux** : garder seulement le LRU laisserait 50 000 listeners (fuite (2)) ; retirer seulement le listener laisserait le `Map` croître (fuite (1)). Il faut les deux.
- `WeakMap` est **exclu** ici : la clé est `familyId` (string). Une `WeakMap` n'accepte que des clés objet — d'où le cache **LRU borné**.
- `dispose()` coupe l'arête depuis le bus (`bus.off`) *avant* de lâcher le cache : sinon la closure du listener retiendrait encore les entrées (PIÈGE #3 du module : `= null` ne suffit pas tant qu'une autre arête existe).
- La preuve est empirique et reproductible : Snap C ne redescend pas (fuite), la version fixée redescend (sain) — exactement le contraste sain/fuite du module 07.

---

## Variante J+30 (fading)

Refais le lab **de mémoire, en 25 min**, sans relire le corrigé, avec **une contrainte ajoutée** : remplace la source (2) par un **timer** au lieu d'un listener. Dans `FamiliesServiceLeaky`, chaque `getFamily` fait un `setInterval(() => this.cache.set(id, loadFamily(id)), 10_000)` jamais annulé (fuite : chaque timer est une racine GC qui retient sa closure). Dans la version fixée, garde **un seul** timer de rafraîchissement au constructeur et `clearInterval` dans `dispose()`. Prouve au coach, snapshots à l'appui, que le nombre de timers actifs retombe à 0 après `dispose()` (indice : compare `heapUsed` et laisse le process se terminer — un `setInterval` non nettoyé empêche même Node de sortir).

---

## Application TribuZen

Porte le corrigé dans l'API TribuZen (`smaurier/tribuzen`).

- `apps/api/src/families/lru-cache.ts` — la classe `LRUCache` réutilisable (générique `<K, V>`).
- `apps/api/src/families/families.service.ts` — remplace le `Map` non borné par `new LRUCache(500)` ; enregistre le listener `family:updated` **une seule fois** dans le constructeur ; retire-le dans le hook NestJS `onModuleDestroy()` (équivalent de `dispose()`).
- `apps/web/src/features/family/FamilyLive.tsx` — corrige la fuite React miroir : le `useEffect` qui s'abonne au bus temps réel **doit** retourner `() => unsubscribe()`.
- `apps/api/src/common/observability/heap-probe.ts` — expose un déclencheur `v8.writeHeapSnapshot()` à la demande (endpoint admin protégé ou signal `SIGUSR2`), **jamais** `global.gc()` dans le code de prod. Sert à rejouer la méthode des 3 snapshots sur un run `autocannon` réel.

Commit cible :
```
fix(families): cache LRU borné + listener unique retiré (onModuleDestroy) — stop OOM
fix(web): désabonnement dans FamilyLive useEffect cleanup
chore(obs): heap-probe writeHeapSnapshot à la demande (dev/admin)
```
