---
titre: Les fuites mémoire (memory leaks)
cours: 01-js-runtime
notions: [fuite = objet atteignable mais inutile, sources classiques (listeners, timers, closures, caches non bornés, références globales), noeuds DOM détachés en navigateur, Map/collection qui grossit sans borne, diagnostic par heap snapshots, méthode des 3 snapshots, allocation timeline, arbre des retainers, shallow size vs retained size, fix par cleanup explicite, WeakMap et WeakRef, cache LRU borné, AbortController pour les listeners]
outcomes: [distinguer une fuite (objet retenu mais inutile) d'une croissance normale ou d'une croissance bornée, diagnostiquer une fuite avec la méthode des 3 heap snapshots et remonter l'arbre des retainers, corriger chaque source de fuite avec le bon outil (cleanup, AbortController, WeakMap, cache LRU borné)]
prerequis: [07-garbage-collector]
next: 09-v8-architecture
libs: []
tribuzen: fuite réelle de l'API TribuZen (cache de familles non borné + listener non retiré) détectée au 3-snapshot puis corrigée (LRU + cleanup), plus une fuite React de subscription non désabonnée
last-reviewed: 2026-07
---

# Les fuites mémoire (memory leaks)

> **Outcomes — tu sauras FAIRE :** distinguer une vraie fuite (objet retenu mais inutile) d'une croissance normale ou bornée, diagnostiquer une fuite avec la méthode des 3 heap snapshots et l'arbre des retainers, corriger chaque source avec le bon outil (cleanup explicite, `AbortController`, `WeakMap`, cache LRU borné).
> **Difficulté :** :star::star::star:

> **Note de vérification (2026-07) :** Context7 non sollicité ici — le sujet porte sur des concepts moteur/DevTools stables, pas sur une API de lib versionnée. Les faits (méthode des 3 snapshots, retained size, `AbortController`, `v8.writeHeapSnapshot`) proviennent de la source v0 auditée `cours/08-memory-leaks.md` et des docs Chrome DevTools / Node.js citées en fin de module. À revérifier au prochain passage si l'UI DevTools change.

## 1. Cas concret d'abord

L'API TribuZen (Node.js/NestJS) tourne en prod depuis 3 jours. Le graphe de RSS du conteneur monte **en escalier** : chaque redéploiement repart bas, puis le `heapUsed` grimpe régulièrement sans jamais redescendre, et au bout de ~20 h le pod est tué par l'OOM killer (`FATAL ERROR: Reached heap limit — Allocation failed`). Le trafic, lui, est constant. Ce n'est donc pas la charge : c'est une **fuite**.

Tu isoles le suspect n°1 : le service qui sert les familles garde un cache et écoute un bus d'événements.

```js
// families.service.js — version qui FUIT (extrait)
const bus = require('../events/bus'); // EventEmitter global, vit toute la durée du process

class FamiliesService {
  constructor() {
    this.cache = new Map(); // (1) cache indexé par familyId — jamais borné, jamais vidé
  }

  async getFamily(id) {
    if (this.cache.has(id)) return this.cache.get(id);

    const family = await this.repo.load(id); // objet lourd : membres, events, médias

    // (2) un listener AJOUTÉ À CHAQUE requête, jamais retiré
    bus.on('family:updated', (evt) => {
      if (evt.id === id) this.cache.set(id, evt.family);
    });

    this.cache.set(id, family); // le cache ne fait que grandir
    return family;
  }
}
```

Deux fuites cohabitent : le `Map` grossit à chaque `id` unique jamais évincé **(1)**, et chaque appel empile un listener supplémentaire sur un `EventEmitter` qui vit aussi longtemps que le process **(2)** — chaque listener retient sa closure, donc `id`, donc l'entrée de cache correspondante. Après 100 000 requêtes : 100 000 listeners (`MaxListenersExceededWarning`) et un cache de plusieurs centaines de Mo.

Ce module te donne la méthode pour **prouver** que c'est bien ça (3 heap snapshots + retainers) et les outils pour **corriger** (cache LRU borné + cleanup du listener). On reproduit puis on répare cette fuite exacte dans le lab.

> **Audit d'abord, fix ensuite.** Le réflexe « je vois un `Map`, je le passe en `WeakMap` » sans mesurer est faux la moitié du temps (ici la clé est un `string`, `WeakMap` est impossible). On diagnostique avant de toucher au code.

---

## 2. Théorie complète, concise

### 2.1 Ce qu'est (et n'est pas) une fuite dans un langage à GC

En C/C++, fuite = mémoire allouée jamais `free()`. En JavaScript, le GC (module 07) libère automatiquement tout ce qui est **inatteignable depuis un root**. Une fuite JS a donc une définition précise :

> **De la mémoire qui reste atteignable (référencée depuis un root) alors qu'elle n'est plus utile au programme.**

Le GC fonctionne parfaitement. C'est **ton code** qui maintient involontairement une arête vers des objets morts pour la logique mais vivants pour le graphe. C'est le prolongement direct du PIÈGE #2 du module 07 : « plus utilisé » ≠ « inatteignable ».

Trois régimes à ne pas confondre :

| Régime | Le heap… | Fuite ? |
|---|---|---|
| Sain | monte puis **redescend** après GC (dents de scie) | Non |
| Croissance bornée | monte jusqu'à un plafond puis se stabilise (cache LRU plein, buffer circulaire) | Non |
| Fuite | monte **en escalier**, ne redescend jamais même après GC | **Oui** |

Symptômes typiques d'une fuite : OOM killer après quelques heures en Node, onglet Chrome à 2 Go après une longue session, latence qui se dégrade progressivement (pauses GC de plus en plus longues sur un tas de plus en plus gros — cf. module 07 : la pause croît avec le nombre d'objets vivants).

### 2.2 Les sources classiques de rétention involontaire

#### Source 1 — Timers non nettoyés (`setInterval`/`setTimeout`)

Un timer actif est une **racine GC** : tant qu'il n'est pas annulé, sa callback — et tout ce qu'elle capture — reste vivant.

```js
function startPolling(element) {
  const heavyData = loadLargeDataset(); // 50 Mo
  setInterval(() => {
    element.textContent = heavyData.getSummary(); // la closure retient heavyData + element
  }, 1000);
  // Aucun clearInterval -> heavyData vit pour toujours, même si element est retiré du DOM
}
```

Fix : garder l'`id` et `clearInterval`, ou s'auto-arrêter :

```js
function startPolling(element) {
  const heavyData = loadLargeDataset();
  const id = setInterval(() => {
    if (!element.isConnected) { clearInterval(id); return; } // stop si l'élément a disparu
    element.textContent = heavyData.getSummary();
  }, 1000);
  return () => clearInterval(id); // cleanup explicite renvoyé à l'appelant
}
```

#### Source 2 — Event listeners non retirés

`addEventListener` sur une cible à longue durée de vie (`window`, `document`, un `EventEmitter` global) retient le handler, donc le `this` qu'il capture, donc toute l'instance.

```js
class ChatWidget {
  constructor(container) {
    this.container = container;
    window.addEventListener('resize', this.onResize.bind(this)); // .bind crée une NOUVELLE fn
  }
  destroy() {
    this.container.remove();
    // FUITE : impossible de retirer le listener — on n'a pas gardé la référence bindée
  }
}
```

Fix historique : stocker la référence bindée. Fix moderne : **`AbortController`**, un seul `abort()` retire tous les listeners liés au signal.

```js
class ChatWidget {
  #ac = new AbortController();
  constructor(container) {
    this.container = container;
    const { signal } = this.#ac;
    window.addEventListener('resize', () => this.onResize(), { signal });
    document.addEventListener('keydown', (e) => this.onKeyDown(e), { signal });
  }
  destroy() {
    this.#ac.abort(); // retire TOUS les listeners d'un coup
    this.container.remove();
  }
}
```

#### Source 3 — Closures qui retiennent un gros scope

Plusieurs closures créées dans la même fonction **partagent le même objet de scope**. Si une seule survit, tout le scope survit — y compris les grosses variables que les autres closures utilisaient.

```js
function createHandlers() {
  const hugeData = new Array(1_000_000).fill('x'); // ~8 Mo
  const config = { debug: true };
  const useConfig = () => config.debug;   // n'utilise que config...
  const useHuge   = () => hugeData.length; // ...mais partage le scope de hugeData
  return useConfig; // useHuge est jeté, MAIS hugeData survit via le scope partagé
}
```

Fix : isoler le gros calcul dans son propre scope (IIFE ou fonction dédiée) pour qu'il ne soit pas capturé par la closure qui survit.

```js
function createHandlers() {
  const config = { debug: true };
  (function () {
    const hugeData = new Array(1_000_000).fill('x');
    processData(hugeData); // utilisé et libéré ici
  })();
  return () => config.debug; // hugeData n'est plus dans le scope capturé -> collecté
}
```

> C'est le pont direct avec le module 02 (scope & closures) : une closure est une **arête de référence vers son scope lexical**. Le GC ne peut pas savoir que tu n'utiliseras plus `hugeData` — il voit seulement que la closure vivante peut y accéder.

#### Source 4 — Collections / caches non bornés

Un `Map`, un `Array` ou un objet qui ne fait que `set`/`push` sans jamais évincer croît linéairement. Classique du cache mémoïsé par clé unique (timestamps, UUID, URL avec query).

```js
const cache = new Map();
function handle(req) {
  const key = req.url + JSON.stringify(req.query); // souvent unique -> jamais de hit
  if (!cache.has(key)) cache.set(key, expensive(req)); // le cache ne fait que grandir
  return cache.get(key);
}
```

Fix : borne la taille. Cache **LRU** (Least Recently Used) qui évince le plus ancien quand il atteint sa capacité (implémenté en 2.5).

#### Source 5 — Références globales

Une variable attachée au global (`globalThis`, module-level, singleton) est une racine permanente. Tout ce qu'elle référence vit jusqu'à la fin du process. Une faute de frappe suffit (`this.data = ...` dans du code non-strict crée `globalThis.data`).

#### Source 6 (navigateur) — Nœuds DOM détachés

Un nœud retiré du DOM mais encore référencé en JS est **détaché** : hors de l'arbre document, mais non collectable car un tableau/une closure le retient — avec tous ses enfants, styles, attributs.

```js
const rows = [];
function addRow(text) {
  const li = document.createElement('li');
  document.getElementById('list').appendChild(li);
  rows.push(li); // référence JS conservée
}
function clear() {
  document.getElementById('list').innerHTML = ''; // retiré du DOM...
  // ...mais rows[] retient encore chaque <li> -> nœuds détachés = fuite
}
```

Fix : couper aussi la référence JS — `rows.length = 0`.

### 2.3 Diagnostic — la méthode des 3 heap snapshots

La technique la plus fiable pour **prouver** une fuite et l'identifier. Elle exploite un principe simple : après un GC, tout ce qui subsiste et qui a été créé par une action répétée mais terminée est **suspect**.

```
  MÉTHODE DES 3 SNAPSHOTS

  [Snap A]  état de repos (page chargée / serveur démarré, au repos)
     │
     │  exécuter l'action suspecte N fois
     │  (ouvrir/fermer un modal x10, naviguer A<->B x10, 1000 requêtes...)
     ▼
  [Snap B]  juste après les N actions
     │
     │  forcer un GC (icône poubelle DevTools / global.gc() en Node)
     ▼
  [Snap C]  après le GC

  Vue "Comparison" : comparer C par rapport à A
    -> tout objet avec Delta positif a survécu au GC alors que l'action
       est terminée -> c'est ta fuite (ou un candidat sérieux)
```

Le GC entre B et C est **crucial** : il élimine tout le déchet légitime. Ce qui reste dans C au-dessus de A ne peut pas être « en cours d'utilisation » puisque les actions sont finies — donc c'est retenu à tort.

### 2.4 Lire un heap snapshot — retained size et retainers

Deux notions à ne jamais confondre :

```
  [Objet A] shallow 100 o ──ref──> [Objet B] 10 000 o (retenu UNIQUEMENT par A)

  Shallow size  = taille de l'objet seul (ses champs propres)
  Retained size = ce qui serait libéré si on collectait A
                  = A + tout ce que A retient exclusivement (ici 10 100 o)
```

On **trie par retained size** pour trouver les plus gros « retenteurs ». Puis, sur un objet suspect, on ouvre l'**arbre des retainers** (« qui te retient ? ») et on remonte jusqu'à un root :

```
  [Object @123]            <- pourquoi vivant ?
    ↑ retained by
  [Array].elements[42]
    ↑ retained by
  [FamiliesService].cache  <- LE coupable : le Map de cache
    ↑ retained by
  [global]                 <- racine GC
```

Le chemin complet **est** le diagnostic : il nomme la propriété fautive (`.cache`) et l'objet qui la porte. C'est l'outil n°1, plus que n'importe quel graphe.

**Allocation timeline** (complément) : DevTools → Memory → « Allocation instrumentation on timeline ». Chaque allocation est une barre ; les barres qui restent **bleues** (vivantes) sans jamais griser au fil du temps révèlent quelles allocations s'accumulent, avec la stack d'allocation.

### 2.5 Fix — le bon outil selon la source

| Source | Fix |
|---|---|
| Timer | garder l'`id`, `clearInterval`/`clearTimeout` au cleanup |
| Listener | `removeEventListener` avec la même réf, ou **`AbortController`** + `{ signal }` |
| Closure lourde | isoler le gros scope, ne capturer que le nécessaire |
| Cache non borné, clé objet | **`WeakMap`** (clé faible, entrée collectée avec l'objet) |
| Cache non borné, clé primitive | **cache LRU borné** (WeakMap impossible sur string/number) |
| DOM détaché | couper la référence JS (`arr.length = 0`, `ref = null`) |

**`WeakMap` / `WeakRef`** (revus au module 07) référencent sans maintenir vivant. Mais `WeakMap` exige une **clé objet** — inutilisable quand tu indexes par `familyId` (string). Dans ce cas, il faut une éviction explicite : le **cache LRU**.

```js
// Cache LRU borné : profite de l'ordre d'insertion garanti de Map
class LRUCache {
  #map = new Map();
  #max;
  constructor(max = 1000) { this.#max = max; }

  get(key) {
    if (!this.#map.has(key)) return undefined;
    const v = this.#map.get(key);
    this.#map.delete(key); this.#map.set(key, v); // ré-insère en fin = "récemment utilisé"
    return v;
  }

  set(key, value) {
    if (this.#map.has(key)) this.#map.delete(key);
    else if (this.#map.size >= this.#max) {
      this.#map.delete(this.#map.keys().next().value); // évince le plus ancien (tête du Map)
    }
    this.#map.set(key, value);
  }

  get size() { return this.#map.size; }
}
```

La clé : un `Map` **itère dans l'ordre d'insertion**. Le premier `keys().next().value` est donc l'entrée la plus anciennement utilisée → on l'évince. La taille est plafonnée → croissance bornée, pas de fuite.

### 2.6 Diagnostic côté Node.js

Sans DevTools, la trousse Node :

```js
process.memoryUsage().heapUsed;   // tas V8 utilisé — le plus parlant, à échantillonner
const v8 = require('v8');
v8.getHeapStatistics().number_of_native_contexts; // croissant = fuite de contextes (vm, worker)
v8.writeHeapSnapshot('snap.heapsnapshot');          // dump analysable dans Chrome DevTools
```

`v8.writeHeapSnapshot()` produit un fichier `.heapsnapshot` qu'on **ouvre dans Chrome DevTools → Memory → Load** : on applique alors exactement la méthode des 3 snapshots et l'arbre des retainers, même pour un serveur sans navigateur. `--max-old-space-size=<Mo>` abaisse la limite du tas pour faire crasher (donc détecter) une fuite plus vite en dev.

> **Prod :** jamais `global.gc()` (pause stop-the-world forcée). Pour la prod, `--heapsnapshot-signal=SIGUSR2` ou `v8.writeHeapSnapshot()` déclenché sur un endpoint d'admin suffit à capturer sans forcer de pause.

---

## 3. Worked examples

### Exemple 1 — Prouver la fuite TribuZen au 3-snapshot, puis la corriger

On reprend le cas concret. Objectif : mesurer, identifier, réparer — dans cet ordre.

```js
// leak-repro.js — lancer : node --expose-gc leak-repro.js
const v8 = require('v8');
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' Mo';
const heap = () => process.memoryUsage().heapUsed;

// EventEmitter global qui vit tout le process (comme le bus TribuZen)
const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(0); // on désactive le warning pour observer la fuite "pure"

class FamiliesServiceLeaky {
  cache = new Map();
  async getFamily(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const family = { id, members: new Array(200).fill({ role: 'member' }) }; // objet lourd
    bus.on('family:updated', (evt) => {                 // (2) listener jamais retiré
      if (evt.id === id) this.cache.set(id, evt.family); // capture id -> capture l'entrée
    });
    this.cache.set(id, family);                          // (1) cache jamais borné
    return family;
  }
}

async function hammer(service, n) {
  for (let i = 0; i < n; i++) await service.getFamily(`fam-${i}`); // ids uniques -> 0 hit
}

(async () => {
  const svc = new FamiliesServiceLeaky();

  // --- Snapshot A : au repos ---
  global.gc();
  console.log(`Snap A (repos)        : ${mb(heap())}`);
  v8.writeHeapSnapshot('A.heapsnapshot');

  // --- Action répétée : 50 000 requêtes ---
  await hammer(svc, 50_000);
  console.log(`Snap B (après 50k req): ${mb(heap())}`);
  v8.writeHeapSnapshot('B.heapsnapshot');

  // --- GC puis Snapshot C ---
  global.gc();
  console.log(`Snap C (après GC)     : ${mb(heap())}`); // NE redescend PAS -> fuite prouvée
  console.log(`  cache.size          : ${svc.cache.size}`);
  console.log(`  listeners sur bus   : ${bus.listenerCount('family:updated')}`);
  v8.writeHeapSnapshot('C.heapsnapshot');
})();
```

**Raisonnement pas à pas :**
1. Snap A capture le repos. Les 50 000 `getFamily` créent le déchet + la rétention.
2. Après GC (Snap C), `heapUsed` **ne revient pas** au niveau de A : c'est la signature d'une fuite (à comparer avec le régime sain du module 07 où le tas redescend).
3. `cache.size === 50000` et `listenerCount === 50000` : les deux compteurs confirment les deux sources. Dans DevTools, on chargerait `A` et `C`, vue **Comparison C vs A** : delta énorme sur `Map (elements)` et sur les closures `family:updated`. L'arbre des retainers pointe `FamiliesService.cache` et la liste de listeners du `bus`.
4. On répare **les deux** (mesure d'abord, fix ensuite) :

```js
// families.service.js — version CORRIGÉE
class FamiliesService {
  constructor(bus) {
    this.bus = bus;
    this.cache = new LRUCache(500); // (1) borné : au plus 500 familles en mémoire
    // (2) UN SEUL listener, au niveau du service, pas un par requête
    this.onUpdated = (evt) => this.cache.set(evt.id, evt.family);
    this.bus.on('family:updated', this.onUpdated);
  }

  async getFamily(id) {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const family = await this.repo.load(id);
    this.cache.set(id, family); // LRU évince le plus ancien au-delà de 500
    return family;
  }

  dispose() {
    this.bus.off('family:updated', this.onUpdated); // cleanup explicite
    this.cache = null;
  }
}
```

Deux corrections orthogonales : cache **LRU borné** (source 4, clé string → pas de WeakMap possible) et **un seul listener** enregistré une fois, retiré dans `dispose()` (source 2). Le tas retombe désormais après GC.

### Exemple 2 — La même fuite côté React : subscription non désabonnée

Le pattern se transpose au front. Un composant s'abonne à un store/WebSocket et oublie de se désabonner au démontage : à chaque montage/démontage (navigation), un abonnement de plus reste vivant, retenant l'instance et son state.

```tsx
// FamilyLive.tsx — version qui FUIT
import { useEffect, useState } from 'react';
import { familyBus } from '@/lib/familyBus';

function FamilyLive({ id }: { id: string }) {
  const [family, setFamily] = useState<Family | null>(null);

  useEffect(() => {
    familyBus.subscribe(id, setFamily); // abonnement...
    // ...aucun retour de cleanup -> l'abonnement survit au démontage
  }, [id]); // FUITE : chaque navigation empile un abonnement mort qui retient setFamily

  return <FamilyCard family={family} />;
}
```

**Fix — la fonction de cleanup de `useEffect` :**

```tsx
useEffect(() => {
  const unsubscribe = familyBus.subscribe(id, setFamily);
  return () => unsubscribe(); // React l'appelle au démontage ET avant re-run si id change
}, [id]);
```

Même diagnostic 3-snapshot dans Chrome : Snap A sur la page, naviguer entrer/sortir de `FamilyLive` 10 fois, GC, Snap C, Comparison → on voit N `FamilyLive` closures / `setFamily` retenus par la liste d'abonnés de `familyBus`. Le `return () => unsubscribe()` est le cleanup canonique : **tout abonnement, timer ou listener ouvert dans un effet doit être fermé dans son cleanup**.

> **Fading — à toi (J+0) :** reprends `startPolling` (source 1) et écris sa version React : un `useEffect` qui lance un `setInterval` et le `clearInterval` dans son cleanup. Vérifie mentalement qu'après 5 démontages il reste 0 timer actif.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Confondre croissance non bornée et fuite

```js
this.messages = [...this.messages, incoming]; // grandit sans limite
```

Ce n'est **pas une fuite au sens strict** si les données sont réellement utilisées (affichées, traitées) : c'est une **croissance non bornée**. La fuite concerne des objets *retenus mais inutiles*. La distinction change le fix : une fuite se corrige par un cleanup (on supprime la rétention) ; une croissance non bornée se corrige par une **borne** (`messages.slice(-1000)`, fenêtre glissante, pagination). Diagnostiquer lequel des deux avant de coder.

### PIÈGE #2 — « Passer en `WeakMap` corrige tout »

```js
const cache = new WeakMap();
cache.set(familyId, data); // ❌ TypeError : une clé WeakMap doit être un objet
```

`WeakMap` n'accepte que des **objets** en clé et rend faible la **clé**, pas la valeur. Elle est parfaite pour attacher des métadonnées à un objet dont tu ne contrôles pas la vie (cf. module 07). Elle est **inutilisable** pour un cache indexé par une primitive (`familyId: string`) : là, il faut une éviction explicite (LRU). Choisir l'outil d'après la clé, pas par réflexe.

### PIÈGE #3 — Croire que `= null` libère immédiatement

```js
this.cache = null; // ne libère RIEN tout de suite
```

Mettre à `null` **coupe une arête**. La mémoire n'est récupérée qu'au **prochain GC**, et seulement si aucune autre arête n'atteint l'objet. Dans le cas concret, `cache = null` ne suffirait pas tant que le `bus` retient encore les closures qui pointent vers les entrées : il faut d'abord retirer les listeners. Toujours couper **toutes** les arêtes, en remontant l'arbre des retainers.

### PIÈGE #4 — Diagnostiquer sur un seul snapshot

Un heap snapshot isolé montre un gros `Map`… qui est peut-être parfaitement légitime. Sans **comparaison** après une action répétée + GC, tu ne sais pas si l'objet *croît anormalement* ou s'il est stable. La méthode des 3 snapshots (delta C vs A) est ce qui transforme une intuition en preuve. Un seul snapshot = spéculation.

### PIÈGE #5 — `global.gc()` ou snapshots en production

`global.gc()` force une pause stop-the-world ; prendre un heap snapshot fige aussi le thread le temps du dump. Utiles en dev/bench, **jamais** dans le chemin chaud de prod. En prod : capturer un snapshot à la demande (signal, endpoint admin) puis l'analyser hors-ligne dans DevTools.

---

## 5. Ancrage TribuZen

La fuite du cas concret est **la** fuite type d'une API stateful comme TribuZen : un service qui cache des agrégats lourds (familles avec membres, events, médias) et qui écoute un bus d'événements.

**La fuite réelle (deux sources cumulées).** `FamiliesService` gardait un `Map` de familles jamais borné **et** ajoutait un listener `family:updated` par requête sur un `EventEmitter` global. En 20 h de trafic, le tas montait en escalier jusqu'à l'OOM. Diagnostic : `v8.writeHeapSnapshot()` sur trois points (repos / après charge `autocannon` sur `GET /families/:id` / après GC), chargés dans Chrome DevTools, vue Comparison → delta sur `Map (elements)` et sur les closures `family:updated`, retainers pointant `FamiliesService.cache` et la liste de listeners du bus.

**Le fix.** Cache **LRU borné** (500 familles max — clé `familyId` string, donc `WeakMap` exclue) + **un seul** listener enregistré au constructeur et retiré dans `dispose()` (cycle de vie NestJS `onModuleDestroy`). Le tas redevient des dents de scie qui redescendent après GC (régime sain du module 07).

**La fuite React (front admin).** Le composant `FamilyLive` s'abonnait au bus temps réel sans retourner de cleanup dans son `useEffect` → chaque navigation laissait un abonnement mort retenant l'instance. Fix : `return () => unsubscribe()`.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  apps/api/src/families/
    families.service.ts         # LRUCache borné + un listener retiré dans onModuleDestroy
    lru-cache.ts                # LRUCache réutilisable (module-level util)
  apps/admin/src/features/family/
    FamilyLive.tsx              # useEffect avec return () => unsubscribe()
  apps/api/src/common/observability/
    heap-probe.ts               # writeHeapSnapshot à la demande (dev/admin), jamais global.gc en prod
```

---

## 6. Points clés

1. Une fuite JS = objet **atteignable depuis un root mais inutile** au programme ; le GC est correct, c'est ton code qui retient.
2. Trois régimes : sain (le tas redescend), croissance **bornée** (plafonne), fuite (escalier qui ne redescend jamais) — distinguer avant de corriger.
3. Sources classiques : timers non annulés, listeners non retirés, closures qui retiennent un gros scope, caches/collections non bornés, références globales, nœuds DOM détachés (navigateur).
4. La **méthode des 3 snapshots** (repos → N actions → GC → snapshot, puis Comparison delta) transforme une intuition en preuve ; un seul snapshot ne suffit pas.
5. On trie par **retained size** et on remonte l'**arbre des retainers** jusqu'à un root : le chemin nomme la propriété fautive.
6. Fix par source : `clearInterval` (timer), `AbortController`/`removeEventListener` (listener), isoler le scope (closure), `WeakMap` (cache à clé objet), **cache LRU borné** (cache à clé primitive), couper la réf JS (DOM détaché).
7. `WeakMap` exige une clé **objet** et n'accepte pas les primitives — pas un fix universel ; `= null` ne libère qu'au prochain GC.
8. Côté React, tout abonnement/timer/listener ouvert dans un `useEffect` doit être fermé dans sa **fonction de cleanup** (`return () => ...`).
9. En Node : `process.memoryUsage().heapUsed`, `v8.getHeapStatistics()`, `v8.writeHeapSnapshot()` — jamais `global.gc()` ni snapshot dans le chemin chaud de prod.

---

## 7. Seeds Anki

```
Quelle est la définition précise d'une fuite mémoire en JavaScript ?|De la mémoire qui reste atteignable depuis un root (donc non collectée par le GC) alors qu'elle n'est plus utile au programme. Le GC fonctionne correctement ; c'est le code qui maintient involontairement une référence vers des objets morts logiquement.
Comment distinguer une fuite d'une croissance non bornée ?|Une fuite retient des objets inutiles -> fix = supprimer la rétention (cleanup). Une croissance non bornée accumule des données réellement utilisées -> fix = borner (slice, fenêtre glissante, pagination). Au heap : la fuite ne redescend jamais après GC ; un cache LRU plein plafonne.
Décris la méthode des 3 heap snapshots.|Snap A au repos ; exécuter l'action suspecte N fois ; Snap B ; forcer un GC ; Snap C. Puis vue Comparison C vs A : tout objet à delta positif a survécu au GC alors que l'action est finie -> c'est la fuite. Le GC entre B et C élimine le déchet légitime.
Différence entre shallow size et retained size dans un heap snapshot ?|Shallow size = taille de l'objet seul (ses champs propres). Retained size = ce qui serait libéré si on le collectait, incluant tout ce qu'il retient exclusivement. On trie par retained size pour trouver les plus gros retenteurs.
À quoi sert l'arbre des retainers ?|À répondre "pourquoi cet objet est-il encore vivant ?" : il remonte la chaîne de références de l'objet jusqu'à un root GC, nommant chaque propriété du chemin (ex: FamiliesService.cache). Le chemin complet EST le diagnostic de la référence fautive.
Pourquoi WeakMap n'est-il pas un fix universel de cache ?|WeakMap exige une clé OBJET (pas de string/number) et rend faible la clé, pas la valeur. Pour un cache indexé par une primitive (familyId), WeakMap est impossible : il faut une éviction explicite, typiquement un cache LRU borné.
Comment un cache LRU borné évite-t-il la fuite ?|Il plafonne le nombre d'entrées. Comme Map itère dans l'ordre d'insertion, la première clé est la plus anciennement utilisée ; à capacité pleine on l'évince avant d'insérer. La taille est bornée -> croissance bornée, pas de fuite.
Pourquoi un event listener ou un setInterval non nettoyé fuit-il ?|La cible (window, document, EventEmitter, liste de timers) est une racine GC qui retient le handler/callback, donc la closure et le this capturés, donc toute l'instance. Fix : removeEventListener / AbortController pour les listeners, clearInterval pour les timers.
Comment se manifeste et se corrige une fuite de subscription en React ?|Un useEffect qui s'abonne (store, WebSocket, bus) sans retourner de cleanup laisse un abonnement vivant à chaque démontage, retenant l'instance. Fix : retourner la fonction de désabonnement — return () => unsubscribe() — que React appelle au démontage et avant chaque re-run de l'effet.
Comment diagnostiquer une fuite dans un serveur Node sans navigateur ?|Échantillonner process.memoryUsage().heapUsed (escalier = suspect), et appeler v8.writeHeapSnapshot() à trois points (repos / après charge / après GC). On charge les .heapsnapshot dans Chrome DevTools et on applique la méthode des 3 snapshots + retainers. Jamais global.gc() en prod.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-08-memory-leak-detection/README.md`. Reproduire la fuite TribuZen (cache de familles non borné + listener par requête), la **prouver** avec `v8.writeHeapSnapshot()` + la méthode des 3 snapshots, puis la corriger (cache LRU borné + cleanup du listener). Corrigé complet inline + variante J+30 + application TribuZen.
