---
titre: Le Garbage Collector de V8
cours: 01-js-runtime
notions: [reachability et roots, graphe d'objets, mark-and-sweep, GC générationnel, hypothèse générationnelle, Scavenge (new space), Mark-Compact (old space), GC incrémental et concurrent (Orinoco), WeakMap et WeakRef, FinalizationRegistry, coût des pauses GC, observation via expose-gc et process.memoryUsage]
outcomes: [expliquer comment V8 décide qu'un objet est collectable via la reachability depuis les roots, distinguer Scavenge (young) de Mark-Compact (old) et savoir pourquoi V8 sépare les générations, observer une pause GC et son impact latence avec global.gc et process.memoryUsage]
prerequis: [06-async-await-under-the-hood]
next: 08-memory-leaks
libs: []
tribuzen: observation mémoire de l'API TribuZen sous charge et cache WeakMap qui ne retient pas les familles
last-reviewed: 2026-07
---

# Le Garbage Collector de V8

> **Outcomes — tu sauras FAIRE :** expliquer pourquoi un objet est (ou non) collecté via la reachability depuis les roots, distinguer Scavenge et Mark-Compact et justifier la séparation young/old, observer une pause GC et son impact latence avec `global.gc()` et `process.memoryUsage()`.
> **Difficulté :** :star::star::star:

> **Note de vérification (2026-07) :** Context7 était indisponible (quota mensuel dépassé) au moment de la réécriture. Les faits V8 (Scavenge, Mark-Compact, Orinoco, seuils new space) proviennent de la source v0 auditée `cours/07-garbage-collector.md` et des blogs V8 cités en fin de module. À revérifier via Context7 (`v8 garbage collection scavenge orinoco`) au prochain passage.

## 1. Cas concret d'abord

L'API TribuZen (Node.js/NestJS) sert les familles. En prod, tu observes que **le P99 de `GET /families/:id` monte en flèche toutes les ~30 s** — 8 ms la plupart du temps, puis un pic isolé à 40 ms. Rien dans ton code applicatif n'explique ce pic périodique. Tu soupçonnes le garbage collector.

Avant toute théorie, mesure. Tu écris un script qui alloue comme ton endpoint (des objets `family` temporaires), force un GC, et lit la mémoire avant/après :

```js
// probe-gc.js — lancer avec : node --expose-gc probe-gc.js
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' Mo';

// On simule le traffic : chaque "requête" alloue un objet famille temporaire
function handleRequest(i) {
  const family = {
    id: i,
    members: new Array(200).fill({ role: 'member' }), // payload temporaire
    loadedAt: Date.now(),
  };
  return family.members.length; // on n'en garde rien -> déchet immédiat
}

for (let i = 0; i < 500_000; i++) handleRequest(i);

const before = process.memoryUsage().heapUsed;
const t0 = performance.now();
global.gc();                       // pause stop-the-world synchrone
const pause = performance.now() - t0;
const after = process.memoryUsage().heapUsed;

console.log(`Pause GC     : ${pause.toFixed(2)} ms`);
console.log(`Heap avant   : ${mb(before)}`);
console.log(`Heap après   : ${mb(after)}`);
console.log(`Libéré       : ${mb(before - after)}`);
```

Deux questions que ce module va rendre triviales :
1. Pourquoi les 500 000 objets `family` disparaissent-ils sans que tu appelles jamais `free()` ?
2. Pourquoi `global.gc()` **bloque** le thread — et donc pourquoi ton P99 se dégrade pile pendant une collecte ?

---

## 2. Théorie complète, concise

### 2.1 Reachability : la seule règle qui compte

JavaScript ne libère pas la mémoire d'un objet quand plus personne ne « l'utilise ». Il la libère quand l'objet devient **inaccessible (unreachable)** depuis un ensemble de points de départ appelés **roots**.

Les roots de V8 :
- l'objet global (`globalThis`, `global` en Node),
- la **call stack** courante (variables locales et paramètres des fonctions en cours),
- les registres CPU utilisés par le moteur.

Un objet est **vivant** s'il existe un chemin de références depuis un root jusqu'à lui. Sinon il est **mort** et sa mémoire est récupérable.

```
   ROOTS
   ┌──────────┐
   │ global    │
   │ stack     │───► A ───► B ───► C      (A, B, C vivants : chemin depuis un root)
   │ registers │
   └──────────┘
                     D ───► E             (D, E morts : aucun chemin depuis un root)
```

Conséquence directe : **ce n'est pas « qui pointe vers l'objet » qui compte, c'est « peut-on l'atteindre depuis un root »**. Deux objets qui se pointent mutuellement mais que personne d'autre ne référence sont morts tous les deux.

### 2.2 Le graphe d'objets

Le tas (heap) est un **graphe orienté** : les nœuds sont les objets, les arêtes sont les références (propriétés, éléments de tableau, variables capturées par closures). Le GC part des roots et fait un parcours de graphe (BFS/DFS) pour marquer tout ce qui est atteignable.

```js
const family = { name: 'Durand' };          // arête: variable locale (root stack) -> objet
family.members = [{ id: 1 }, { id: 2 }];    // arêtes: family -> array -> objets membres
const parent = family.members[0];           // 2e arête vers le même membre
```

Tant que `family` est sur la stack, tout le sous-graphe (`members`, chaque membre) est vivant.

### 2.3 Reference counting vs mark-and-sweep

Deux familles d'algorithmes. **V8 n'utilise PAS le reference counting** — mais il faut savoir pourquoi.

**Reference counting** : chaque objet compte ses références entrantes ; à 0, on libère. Simple, immédiat… mais **incapable de collecter les cycles** :

```js
function cycle() {
  const a = {};
  const b = {};
  a.other = b;   // b.refcount = 1
  b.other = a;   // a.refcount = 1
}                // après le return : a et b inaccessibles, mais refcount reste 1 -> fuite
```

C'est le bug historique d'Internet Explorer 6/7 (DOM + closures).

**Mark-and-sweep** (V8, SpiderMonkey, JavaScriptCore) : on part des roots, on **marque** tout ce qui est atteignable, puis on **balaie** (sweep) et on libère tout ce qui n'est pas marqué. Un cycle non atteignable depuis un root n'est jamais marqué → collecté correctement.

```
1. MARK  : roots -> parcours du graphe -> objets atteints = marqués
2. SWEEP : parcourir le tas -> libérer tout objet NON marqué
```

### 2.4 L'hypothèse générationnelle

Observation empirique validée sur des décennies : **la plupart des objets meurent jeunes**. Un objet temporaire (le `family` d'une requête, un résultat intermédiaire de `.map()`) vit quelques millisecondes ; un objet installé au démarrage (la config, un pool de connexions) vit pour toujours.

V8 en tire une stratégie : séparer le tas en deux **générations** et collecter la jeune **beaucoup plus souvent** que la vieille.

```
  ┌─────────────────────────── V8 HEAP ───────────────────────────┐
  │  YOUNG GENERATION (New Space)      OLD GENERATION (Old Space)  │
  │  petit : ~1–8 Mo                   grand : jusqu'à plusieurs Go│
  │  Scavenge (Minor GC), très fréquent  Mark-Compact (Major GC),  │
  │  copie les survivants                rare, plus coûteux        │
  └───────────────────────────────────────────────────────────────┘
```

Un objet qui **survit à 2 Minor GC** est **promu** dans l'Old Space (on parie qu'il vivra longtemps).

### 2.5 Young generation : Scavenge (Minor GC)

Le New Space est un **semi-space** : deux moitiés égales, **from-space** et **to-space**. À un instant donné on n'alloue que dans le from ; le to est vide.

Quand le from est plein, le **Scavenger** démarre (algorithme de Cheney, copie en largeur) :
1. parcourir les roots, **copier** chaque objet vivant dans le to-space ;
2. laisser une *forwarding address* dans le from pour rediriger les autres pointeurs ;
3. quand tout est copié, **échanger les rôles** : le to devient le nouveau from ; l'ancien from est vidé d'un coup.

```
  AVANT :  from [A][B][C][D][E]    to (vide)      (A,C,E vivants)
  APRÈS :  from (vide, réutilisable) to [A][C][E] (compacté, rapide)
```

Propriétés clés :
- coût proportionnel au nombre de **survivants**, pas au nombre total d'objets ;
- **compacte** automatiquement (pas de fragmentation) ;
- très rapide : pauses typiques **< 1–2 ms** ;
- limite : n'utilise que 50 % de l'espace à un instant donné.

> Les objets très gros (> ~256 Ko) sont alloués directement dans le Large Object Space de l'Old Space, sans passer par le semi-space.

### 2.6 Old generation : Mark-Compact (Major GC)

Les objets promus vivent dans l'Old Space, collecté par un algorithme plus lourd, adapté aux objets à longue durée de vie. V8 utilise un **marquage tricolore** pour pouvoir marquer par tranches sans tout figer :

| Couleur | Sens |
|---|---|
| Blanc | pas encore visité (candidat à la mort) |
| Gris | visité, mais ses enfants pas tous traités |
| Noir | visité, tous ses enfants traités (vivant) |

Invariant : **un objet noir ne pointe jamais directement vers un blanc**. Si le code JS modifie un objet noir pour pointer vers un blanc pendant un marquage concurrent, un **write barrier** intercepte l'écriture et re-grise l'objet.

Puis :
- **Mark-Sweep** : libère les blancs en place → peut fragmenter.
- **Mark-Compact** : déplace les vivants pour les regrouper → élimine la fragmentation, mais doit mettre à jour tous les pointeurs.

```
  Mark-Sweep :  [A][ ][ ][B][ ][C]     (trous = fragmentation)
  Mark-Compact: [A][B][C][ libre     ] (contigu)
```

V8 décide **page par page** selon le taux de fragmentation.

### 2.7 GC incrémental et concurrent — Orinoco

Un Major GC stop-the-world naïf figerait le thread JS 100 ms+ → catastrophe pour la latence. **Orinoco** est le nom de l'architecture GC moderne de V8 qui **répartit le travail hors du thread principal** :

- **Concurrent marking** : le marquage tourne sur un thread GC séparé pendant que le JS s'exécute.
- **Incremental marking** : le thread principal aide par petites tranches (~quelques ms) entre les tâches.
- **Parallel scavenge / compaction** : plusieurs threads GC en parallèle pendant une courte pause.
- **Concurrent sweeping** : la libération se fait sur un thread séparé, sans pause.

```
  Stop-the-world (ancien) : JS ████    ░░░░░░░░░░░░   ████   (longue pause)
  Concurrent (Orinoco)    : JS ██████████████████████████   (JS continue)
                            GC   ████████████  (thread séparé)  + courte finalisation
```

Résultat en pratique : Minor GC **< 1–2 ms**, Major GC **~5–10 ms** de pause sur un tas raisonnable. La pause ne disparaît pas totalement — c'est elle qui explique le pic P99 du cas concret.

### 2.8 Le coût du GC : les pauses

Une pause GC s'insère **entre** deux morceaux de ton code, de façon non déterministe :

```
  Requête HTTP avec pause GC malchanceuse :
  Recv 1ms │ Process 5ms │ GC PAUSE 15ms │ Send 1ms  = 22 ms au lieu de 7 ms
```

Le GC ne ralentit pas le débit moyen (throughput) de façon visible, mais il crée une **longue traîne** sur les percentiles hauts (P99, P99.9). Réduire la **pression d'allocation** (moins d'objets temporaires, réutiliser des buffers dans les hot paths) est le levier n°1 pour réduire l'impact.

### 2.9 WeakMap, WeakRef, FinalizationRegistry

Ces API permettent de référencer un objet **sans le maintenir vivant** — c'est-à-dire sans créer une arête « forte » qui empêche la collecte.

**`WeakMap` / `WeakSet`** — les **clés** sont faibles. Si la seule référence restante vers un objet-clé est celle détenue par la WeakMap, l'objet peut être collecté et l'entrée disparaît automatiquement.

```js
const meta = new WeakMap();
let family = { id: 42 };
meta.set(family, { lastAccess: Date.now() }); // n'empêche PAS la collecte de family
family = null;                                  // family devient collectable, l'entrée aussi
```

Cas d'usage type : **cache/metadata attaché à des objets** dont tu ne contrôles pas la durée de vie. Tu ne peux ni itérer ni lire `.size` d'une WeakMap — c'est le prix de la faiblesse.

**`WeakRef`** — référence faible vers **une valeur** (pas une clé). `deref()` renvoie l'objet, ou `undefined` s'il a été collecté.

```js
let big = { payload: new Array(1e6) };
const ref = new WeakRef(big);
big = null;
// plus tard, non déterministe :
const v = ref.deref(); // l'objet, ou undefined si déjà collecté
```

**`FinalizationRegistry`** — enregistre un callback appelé *après* la collecte d'un objet. Utile pour nettoyer une ressource externe associée (handle natif, entrée de cache).

```js
const registry = new FinalizationRegistry((key) => {
  // appelé un jour, peut-être, après collecte -> aucune garantie
  console.log(`objet "${key}" collecté`);
});
registry.register(someObject, 'clé-de-cleanup');
```

**Règle d'or :** `WeakRef.deref()` et les callbacks de `FinalizationRegistry` sont **non déterministes** — jamais de logique métier critique dessus. Ce sont des outils de cache/diagnostic, pas des destructeurs C++.

### 2.10 Observer le GC : `--expose-gc` et `process.memoryUsage()`

V8 interdit de déclencher le GC depuis JS par défaut. Le flag Node `--expose-gc` expose `global.gc()` :

```js
// node --expose-gc script.js
global.gc();                  // Major GC complet, synchrone (diagnostic uniquement)
global.gc({ type: 'minor' }); // Scavenge seulement
```

`process.memoryUsage()` donne l'état mémoire :

```js
const m = process.memoryUsage();
m.heapUsed;   // octets réellement utilisés dans le tas V8  <- le plus parlant pour le GC
m.heapTotal;  // tas V8 réservé
m.external;   // mémoire hors-tas (Buffers, add-ons natifs)
m.rss;        // Resident Set Size : mémoire totale du process
```

**Jamais `global.gc()` en production** : c'est une pause stop-the-world forcée. Pour le diagnostic prod, `v8.writeHeapSnapshot()` (analysable dans Chrome DevTools) et `--trace-gc` suffisent sans forcer de pause.

---

## 3. Worked examples

### Exemple 1 — Prouver que la reachability, pas le refcount, décide

On construit un cycle non atteignable et on vérifie qu'il est collecté (impossible avec du reference counting).

```js
// cycle.js — lancer : node --expose-gc cycle.js
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' Mo';

function makeCycle() {
  const a = { blob: new Array(500_000).fill(0) }; // ~4 Mo
  const b = { blob: new Array(500_000).fill(0) }; // ~4 Mo
  a.peer = b;   // a -> b
  b.peer = a;   // b -> a  (cycle)
  return null;  // aucune référence retournée : a et b sont inatteignables
}

global.gc();
const before = process.memoryUsage().heapUsed;

for (let i = 0; i < 20; i++) makeCycle(); // 20 cycles créés puis abandonnés

const afterAlloc = process.memoryUsage().heapUsed;
global.gc();                              // mark-and-sweep : les cycles morts partent
const afterGC = process.memoryUsage().heapUsed;

console.log(`Avant boucle : ${mb(before)}`);
console.log(`Après alloc  : ${mb(afterAlloc)}`); // en hausse (les blobs encore là)
console.log(`Après GC     : ${mb(afterGC)}`);    // ~= before : les cycles ont été collectés
```

**Raisonnement pas à pas :**
1. Chaque `makeCycle()` alloue ~8 Mo (deux blobs) qui se référencent mutuellement.
2. `makeCycle` retourne `null` → après le return, `a` et `b` ne sont atteignables depuis **aucun** root. Le fait qu'ils se pointent l'un l'autre n'y change rien.
3. Un GC par reference counting verrait `refcount === 1` pour chacun et **fuirait**. V8 fait un mark-and-sweep depuis les roots : ni `a` ni `b` ne sont marqués → sweep les libère.
4. `afterGC` revient au niveau de `before` : preuve empirique que **V8 collecte les cycles**.

### Exemple 2 — Isoler et mesurer une pause GC (le cas concret)

On reproduit le pic P99 de l'API TribuZen et on mesure la pause selon la charge vivante.

```js
// pause-vs-charge.js — lancer : node --expose-gc pause-vs-charge.js
function measurePause(liveObjectsCount) {
  // On maintient VIVANTS liveObjectsCount objets (ils survivent -> Old Space)
  const live = [];
  for (let i = 0; i < liveObjectsCount; i++) {
    live.push({ id: i, members: new Array(50).fill(0) });
  }

  // On génère aussi du déchet temporaire, comme le ferait le trafic
  for (let i = 0; i < 200_000; i++) {
    const tmp = { at: Date.now(), buf: new Array(20).fill(i) };
    void tmp.buf.length; // tmp meurt immédiatement
  }

  const t0 = performance.now();
  global.gc();                     // Major GC : doit scanner tous les objets VIVANTS
  const pause = performance.now() - t0;

  return { live: live.length, pause: pause.toFixed(2) };
}

for (const n of [0, 100_000, 500_000, 1_000_000]) {
  const r = measurePause(n);
  console.log(`Objets vivants : ${r.live.toString().padStart(9)} | pause GC : ${r.pause} ms`);
}
```

**Raisonnement pas à pas :**
1. La phase *mark* doit parcourir tout le graphe **vivant**. Plus il y a d'objets vivants, plus le marquage est long.
2. Le déchet temporaire (200 000 objets morts) coûte peu au *mark* (jamais marqué) mais alimente le *sweep*.
3. La pause **croît avec le nombre d'objets vivants**, pas avec le total alloué. C'est contre-intuitif : garder beaucoup d'objets vivants (gros cache en mémoire forte) **rallonge chaque pause**.
4. Retour au cas concret : ton pic P99 périodique = un Major GC qui tombe pendant une requête. Deux leviers — réduire les allocations temporaires (moins de GC déclenchés) et réduire le nombre d'objets retenus (pauses plus courtes). D'où l'intérêt d'un cache faible (section suivante).

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « Mettre à `null` libère la mémoire immédiatement »

```js
let family = { members: new Array(1e6) };
family = null; // NE libère RIEN tout de suite
```

`family = null` supprime **une arête**. La mémoire n'est récupérée qu'au **prochain GC**, et seulement si aucune autre arête n'atteint l'objet. Le GC est asynchrone et non déterministe. Mettre à `null` **aide** (rend l'objet collectable), mais ne « libère » pas au sens `free()`.

### PIÈGE #2 — Confondre « plus utilisé » et « inatteignable »

```js
function attachHandlers(node) {
  const huge = new Array(1e6).fill('data');
  node.onClick = () => console.log(huge.length); // la closure capture `huge`
}
```

Tu ne « utilises » plus `huge` visuellement, mais tant que `node.onClick` est atteignable depuis un root, la closure l'est, et `huge` aussi. **Le GC raisonne sur l'atteignabilité du graphe, pas sur ton intention.** C'est exactement le mécanisme des memory leaks (module 08).

### PIÈGE #3 — Croire que WeakMap accélère le GC ou « nettoie tout seul » n'importe quoi

```js
const cache = new WeakMap();
cache.set('user-42', data); // ❌ TypeError : les clés WeakMap doivent être des objets
```

`WeakMap` n'accepte que des **objets** comme clés (pas des strings/nombres). Sa faiblesse porte sur la **clé**, pas la valeur : si la clé reste vivante ailleurs, la valeur reste retenue. Ce n'est pas un cache LRU magique — c'est « les métadonnées disparaissent quand l'objet-clé disparaît ».

### PIÈGE #4 — S'appuyer sur `FinalizationRegistry` comme sur un destructeur

```js
const reg = new FinalizationRegistry((f) => closeSocket(f)); // ❌ fragile
```

Les callbacks de finalisation **ne sont pas garantis** : ils peuvent ne jamais s'exécuter (le process se termine avant), à un timing imprévisible. N'y mets **jamais** un nettoyage indispensable (fermeture de socket, flush de fichier). Pour ça : `try/finally`, `using` (explicit resource management), ou une fermeture explicite.

### PIÈGE #5 — Utiliser `global.gc()` ailleurs qu'en diagnostic

`global.gc()` force une pause complète synchrone. En appeler « pour libérer de la mémoire » en prod **dégrade** la latence au lieu de l'améliorer — tu provoques manuellement le pic que tu essaies d'éviter. C'est un outil d'observation en dev/bench uniquement.

---

## 5. Ancrage TribuZen

Le GC est invisible dans le code TribuZen, mais central pour la **tenue en charge de l'API**.

**Observation mémoire de l'API sous charge.** L'API TribuZen tourne sous Node. Lors d'un test de charge (`k6`/`autocannon` sur `GET /families/:id`), on trace deux choses : `process.memoryUsage().heapUsed` échantillonné dans un `setInterval`, et les pauses via `--trace-gc`. Si le `heapUsed` monte en dents de scie qui **redescendent** après chaque GC → sain (déchet temporaire normal). S'il monte en escalier qui **ne redescend jamais** → fuite (module 08). Le pic P99 périodique du cas concret se lit directement dans les lignes `Mark-Compact` de `--trace-gc`.

**Cache WeakMap qui ne retient pas les familles.** L'API attache des métadonnées de requête (permissions calculées, timestamp d'accès) à des objets `Family` chargés depuis Postgres. Si on stocke ça dans une `Map` classique indexée par l'objet famille, on **retient les familles vivantes indéfiniment** → le tas gonfle, les pauses GC s'allongent (Exemple 2). En passant à une `WeakMap`, dès qu'une `Family` n'est plus référencée par le traitement en cours, son entrée de métadonnées devient collectable **sans code de nettoyage** :

```js
// tribuzen-api : cache de permissions attaché à l'objet Family
const permsCache = new WeakMap(); // clé = objet Family, valeur = perms calculées

function getPermissions(family, user) {
  let byUser = permsCache.get(family);
  if (!byUser) { byUser = new Map(); permsCache.set(family, byUser); }
  if (!byUser.has(user.id)) byUser.set(user.id, computePerms(family, user));
  return byUser.get(user.id);
}
// Quand la requête se termine et que `family` sort du scope,
// l'entrée WeakMap devient collectable : zéro rétention, zéro cleanup manuel.
```

**Comprendre une pause GC qui cause une latence.** Le lab de ce module (observation `--expose-gc` + `process.memoryUsage()`) reproduit exactement le diagnostic qu'on ferait sur l'API : mesurer la pause en fonction du nombre d'objets vivants, et vérifier qu'un cache faible réduit la rétention donc les pauses.

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/apps/api/src/
  families/families.service.ts        # getPermissions via WeakMap (pas de Map forte)
  common/observability/gc-probe.ts    # échantillonnage heapUsed + trace pauses (dev/bench)
```

---

## 6. Points clés

1. Un objet est vivant s'il est **atteignable depuis un root** (global, call stack, registres) ; sinon il est collectable — ce n'est pas une histoire de compteur de références.
2. Le tas est un **graphe d'objets** ; le GC part des roots et marque tout le sous-graphe atteignable.
3. V8 utilise **mark-and-sweep** (pas de reference counting) : il collecte donc correctement les **cycles**.
4. L'**hypothèse générationnelle** (la plupart des objets meurent jeunes) justifie de séparer **young** (New Space) et **old** (Old Space).
5. Young = **Scavenge** (copie des survivants, semi-space, < 1–2 ms, compacte) ; Old = **Mark-Compact** (tricolore + write barrier, ~5–10 ms, plus rare).
6. **Orinoco** répartit le marquage/sweeping en concurrent + incrémental + parallèle pour éviter les longues pauses stop-the-world.
7. Le coût du GC se paie en **pauses** : impact sur le P99, proportionnel au nombre d'objets **vivants** à marquer, pas au total alloué.
8. **WeakMap/WeakSet** (clés faibles), **WeakRef** (valeur faible), **FinalizationRegistry** (callback post-collecte) référencent sans maintenir vivant — tous **non déterministes**, jamais pour de la logique critique.
9. `--expose-gc` + `global.gc()` + `process.memoryUsage().heapUsed` servent à **observer** le GC en dev/bench uniquement — jamais `global.gc()` en prod.

---

## 7. Seeds Anki

```
Selon quel critère V8 décide-t-il qu'un objet est collectable ?|La reachability : un objet est vivant s'il existe un chemin de références depuis un root (global, call stack, registres CPU) jusqu'à lui. Sinon il est mort, quel que soit le nombre de références qui pointent vers lui.
Pourquoi V8 n'utilise-t-il pas le reference counting ?|Parce que le reference counting ne collecte pas les cycles : deux objets qui se référencent mutuellement gardent un refcount de 1 même s'ils sont inatteignables depuis les roots. V8 utilise mark-and-sweep, qui les collecte correctement.
Qu'est-ce que l'hypothèse générationnelle et qu'en déduit V8 ?|La plupart des objets meurent jeunes. V8 en déduit qu'il faut séparer le tas en young generation (collectée très souvent, pas cher) et old generation (collectée rarement), et promouvoir en old les objets qui survivent à 2 Minor GC.
Différence entre Scavenge (Minor GC) et Mark-Compact (Major GC) ?|Scavenge collecte le New Space en copiant les survivants entre deux semi-spaces (rapide, < 1-2 ms, compacte, coût proportionnel aux survivants). Mark-Compact collecte l'Old Space via marquage tricolore puis compaction (plus rare, ~5-10 ms, plus coûteux).
Qu'est-ce qu'Orinoco et quel problème résout-il ?|Le nom de l'architecture GC moderne de V8. Il combine marquage concurrent (thread séparé), incrémental (par tranches sur le thread principal), scavenge/compaction parallèles et sweeping concurrent, pour éviter les longues pauses stop-the-world qui dégradaient la latence.
De quoi dépend la durée d'une pause GC ?|Principalement du nombre d'objets VIVANTS à marquer, pas du nombre total d'objets alloués. Garder beaucoup d'objets en mémoire forte (gros cache) rallonge chaque pause ; le déchet temporaire mort coûte surtout au sweep.
Quelle est la faiblesse portée par une WeakMap et à quoi ça sert ?|La clé est faible : si l'objet-clé n'est plus atteignable ailleurs, il peut être collecté et l'entrée disparaît automatiquement. Sert à attacher des métadonnées/cache à un objet sans le maintenir vivant ni écrire de code de nettoyage. Les clés doivent être des objets.
Pourquoi ne jamais s'appuyer sur FinalizationRegistry pour un nettoyage critique ?|Ses callbacks ne sont pas garantis : ils peuvent ne jamais s'exécuter (process terminé avant) et leur timing est non déterministe. Pour un nettoyage indispensable (socket, fichier) : try/finally ou fermeture explicite.
Comment observer une pause GC en Node et pourquoi pas en prod ?|Lancer avec --expose-gc, appeler global.gc() entouré de performance.now(), et lire process.memoryUsage().heapUsed avant/après. À réserver au dev/bench : global.gc() force une pause stop-the-world synchrone qui dégraderait la latence en production.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-07-gc-observation/README.md`. Observer le GC de V8 avec `--expose-gc` + `process.memoryUsage()` : mesurer une libération, corréler la durée de pause au nombre d'objets vivants, et prouver qu'un cache `WeakMap` réduit la rétention. Corrigé complet inline + variante J+30 + application TribuZen.
