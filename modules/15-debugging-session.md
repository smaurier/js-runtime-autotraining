---
titre: Session de debugging runtime
cours: 01-js-runtime
notions: [workflow reproduire-isoler-mesurer-hypothèse-vérifier, node --inspect + Chrome DevTools, node inspect CLI, --cpu-prof et --heap-prof, --trace-gc et PerformanceObserver gc, monitorEventLoopDelay, heap snapshots et retainers, flamegraphs clinic.js et 0x, diagnostic blocage event loop, diagnostic fuite mémoire, diagnostic déopt hot path, runbook de debugging prod]
outcomes: [mener une investigation runtime méthodique de la reproduction au fix vérifié, choisir le bon outil V8/Node selon le symptôme observé, diagnostiquer les trois grandes familles blocage-fuite-déopt sur une prod qui rame]
prerequis: [14-projet-final]
next: fin-du-parcours
libs: []
tribuzen: runbook de debugging runtime de l'API TribuZen — diagnostiquer une prod qui rame (latence + mémoire) inspect→profile→snapshot→fix
last-reviewed: 2026-07
---

# Session de debugging runtime

> **Outcomes — tu sauras FAIRE :** mener une investigation runtime méthodique de la reproduction au fix vérifié, choisir le bon outil V8/Node selon le symptôme, diagnostiquer les trois familles blocage / fuite / déopt sur une prod qui rame.
> **Difficulté :** :star::star::star::star::star: (module de synthèse — dernier du parcours)

## 1. Cas concret d'abord

Vendredi 17h. Alerte PagerDuty sur l'API TribuZen : le p99 de `GET /api/familles/:id/timeline` est passé de 40 ms à 1,8 s, et le conteneur Node se fait OOM-killer (`exit code 137`) toutes les nuits vers 3h. Deux symptômes, peut-être deux causes, peut-être une seule.

Tu n'as pas de test qui reproduit le bug. Tu as une prod qui rame et un dashboard :

```
  Heure    p99 timeline   heapUsed   RSS       event-loop p99
  ======   ============   ========   =======   ==============
  09:00        42 ms       180 Mo    260 Mo         3 ms
  13:00       310 ms       420 Mo    520 Mo        95 ms
  17:00      1820 ms       910 Mo   1050 Mo       780 ms
  ~03:00     Killed (OOMKilled, exit 137)
```

Le réflexe amateur : ouvrir le code, deviner « c'est sûrement le `JSON.parse` », coller un `.cache` quelque part, redéployer, espérer. Le cerveau humain est un **très mauvais profileur** : il devine la cause au lieu de la mesurer.

Ce module te donne la méthode et les outils pour transformer « ça rame » en un diagnostic chiffré, un fix ciblé, et une preuve avant/après. C'est la synthèse pratique de tout le cours : GC (07), fuites (08), V8 & déopt (09-11), perf (12), event loop & workers (03, 13).

---

## 2. Théorie complète, concise

### 2.1 Le workflow en 5 temps

Une session de debugging runtime suit toujours le même cycle. Ne jamais sauter à « Corriger ».

```
  REPRODUIRE  →  ISOLER  →  MESURER  →  HYPOTHÈSE  →  VÉRIFIER
      |            |          |             |             |
   rendre le    réduire     profiler,   une cause      re-mesurer
   bug fiable   au plus     heap snap,  précise ET     avant/après.
   & répétable  petit       trace-gc    testable       Disparu ? sinon
                périmètre                (UNE seule)    retour MESURER
```

Deux règles non négociables :
1. **Chaque fix est précédé d'une preuve mesurable du problème** et **suivi d'une preuve mesurable de l'amélioration**. Pas de « je pense que c'est mieux ».
2. **Une hypothèse = une correction.** Si tu changes trois choses d'un coup et que ça va mieux, tu ne sais pas laquelle a marché — et tu as peut-être introduit une régression masquée.

### 2.2 L'arbre de décision : quel outil pour quel symptôme

Le choix de l'outil découle du symptôme observé, pas de l'intuition.

| Symptôme | Première mesure | Outil d'approfondissement |
|---|---|---|
| « Lent globalement » | `node --cpu-prof app.js` → flame chart | Chrome DevTools > Performance (Bottom-Up) |
| « La mémoire monte sans cesse » | `process.memoryUsage()` en continu | Heap snapshots (3×) + retainers, `--heap-prof` |
| « Spikes de latence périodiques » | `node --trace-gc` | `PerformanceObserver({entryTypes:['gc']})` |
| « Une fonction précise est lente » | `--cpu-prof` (hotspot) | `--trace-deopt` puis `--trace-ic` |
| « Tout se fige pendant N secondes » | `monitorEventLoopDelay()` | `--cpu-prof` pendant le freeze → tâche CPU |

### 2.3 Les outils, concrètement

**`node --inspect app.js` + Chrome DevTools.** Ouvre `chrome://inspect`, clique « inspect ». Tu obtiens l'onglet Performance (CPU profile live), Memory (heap snapshots), et un vrai debugger avec breakpoints. `--inspect-brk` fige à la première ligne pour attacher avant l'exécution. C'est l'outil roi en dev et en préprod.

**`node inspect app.js` (CLI, sans Chrome).** Debugger en ligne de commande, utile en SSH sur un serveur sans UI : `cont`, `next`, `repl`, `watch('x')`. Dépannage rapide quand tu n'as pas de tunnel vers `chrome://inspect`.

**`--cpu-prof` / `--heap-prof`.** Écrivent un `.cpuprofile` / `.heapprofile` à la sortie du process, sans instrumentation manuelle. On les ouvre ensuite dans DevTools (Performance / Memory) hors-ligne. Idéal en CI ou sur un run reproductible.

```bash
node --cpu-prof --cpu-prof-dir=./prof app.js       # → ./prof/*.cpuprofile
node --heap-prof --heap-prof-dir=./prof app.js     # → ./prof/*.heapprofile
```

**`--trace-gc`.** Une ligne par cycle GC sur stderr. Format :

```
  [PID:isolate] timestamp: TYPE from(cap) -> to(cap) MB, pause / concurrent ms
  [12345:0x5a3b]  30123 ms: Mark-Compact 42.1 (64.0) -> 18.2 (48.0) MB, 187.3 / 0.0 ms
                                                                        ^^^^^ pause de 187 ms
```
`Scavenge` = young gen, rapide (< 2 ms). `Mark-Compact` = old gen, potentiellement > 100 ms → c'est lui qui cause les spikes.

**`--prof` + flamegraphs.** `clinic.js` (`clinic doctor`, `clinic flame`) et `0x` génèrent un flamegraph HTML interactif à partir d'un run. La largeur d'une barre = temps CPU cumulé ; le hotspot saute aux yeux. `clinic doctor` fait même un pré-diagnostic (event loop bloqué ? GC ? I/O ?).

**Mesure fine dans le code :** `performance.now()`, `console.time()/timeEnd()`, `PerformanceObserver`, et `monitorEventLoopDelay()` pour surveiller le retard de l'event loop en prod.

```js
import { performance } from 'node:perf_hooks';
const t = performance.now();
doWork();
console.log(`doWork: ${(performance.now() - t).toFixed(1)} ms`);
```

### 2.4 Famille 1 — Blocage de l'event loop (CPU-bound)

**Signature :** *toutes* les routes deviennent lentes en même temps, corrélé à un appel précis. Le p99 de l'event loop delay explose.

```js
import { monitorEventLoopDelay } from 'node:perf_hooks';
const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
setInterval(() => {
  console.log(`loop p99: ${(h.percentile(99) / 1e6).toFixed(1)} ms`); // ns → ms
  h.reset();
}, 5000);
// Pendant un calcul synchrone lourd : loop p99: 2450.3 ms  → BLOQUÉ
```

**Cause typique :** un calcul CPU synchrone (agrégation, crypto, parsing géant) sur le thread principal. **Fix :** déléguer à un `worker_threads` (module 13), découper avec `setImmediate`, ou précalculer.

### 2.5 Famille 2 — Fuite mémoire (heap qui monte)

**Signature :** `heapUsed` croît linéairement et ne redescend jamais après GC ; RSS suit ; OOM à terme.

**Méthode des 3 snapshots** (Chrome DevTools > Memory, attaché via `--inspect`) :
1. Snapshot baseline au démarrage.
2. Snapshot après charge (ex. 1 000 requêtes).
3. Snapshot après plus de charge (ex. 5 000 requêtes).

On sélectionne le snapshot 3, filtre « Objects allocated between Snapshot 1 and 2 » : ce qui apparaît là et n'a **pas** été collecté est retenu à tort. On ouvre l'arbre des **retainers** pour voir *qui* garde la référence (souvent : une `Map` module-level, des listeners jamais retirés, une closure qui capture un gros objet).

**Fixes canoniques :** cache borné (LRU / TTL) au lieu de `Map` infinie, `AbortController` / `removeListener` / `{ once: true }` pour les handlers, `WeakMap`/`WeakRef` pour les caches non critiques. `v8.writeHeapSnapshot()` prend un snapshot programmatique en prod.

### 2.6 Famille 3 — Déopt / hot path (CPU profile)

**Signature :** une fonction précise domine le CPU profile alors qu'elle « devrait » être rapide. `--trace-deopt` montre la même fonction déoptimisée en boucle (`Reason: wrong map`).

```bash
node --trace-deopt pipeline.mjs 2>&1 | grep -c deoptimizing   # → 847 déopts
node --trace-ic   pipeline.mjs 2>&1 | grep maFonction         # → MEGAMORPHIC
```

**Cause typique :** objets de **shapes** (hidden classes) incohérentes sur un même site d'accès → l'inline cache passe monomorphic → polymorphic → **megamorphic**, V8 abandonne le code optimisé. **Fix :** normaliser les formes (mêmes propriétés, même ordre, `null` plutôt que propriété absente ; éviter `delete` en hot path). Cf. modules 10-11.

### 2.7 Le runbook : formaliser pour l'équipe

Une session réussie se **capitalise** en runbook : un document versionné qui dit, pour chaque symptôme, quelle commande lancer, comment lire la sortie, quels fixes essayer. Il transforme une compétence individuelle en réflexe d'équipe et raccourcit le prochain incident de heures à minutes. On le range dans le repo (`docs/runbooks/`), à côté du code qu'il diagnostique.

---

## 3. Worked examples

### Exemple 1 — Diagnostic bout-en-bout de la prod TribuZen qui rame

Reprise du cas concret. Deux symptômes : latence timeline + mémoire qui monte. On applique le workflow.

**REPRODUIRE.** On rejoue le trafic de prod en préprod avec un script de charge sur `/api/familles/:id/timeline` (autocannon, 200 req/s pendant 10 min). Le p99 grimpe et le heap monte : bug reproduit hors prod. On peut mesurer sans risque.

**ISOLER.** On coupe les endpoints un par un. Seul `/timeline` reproduit les deux symptômes → périmètre réduit au handler timeline et à ce qu'il touche.

**MESURER — d'abord le CPU (la latence).**

```bash
node --cpu-prof --cpu-prof-dir=./prof src/server.mjs
# charge 10 min, arrêt propre → ./prof/xxx.cpuprofile ouvert dans DevTools
```

```
  Flame chart (Bottom-Up, simplifié)
  ==================================
  buildTimeline()                              72 % CPU
    └─ sortEvents()  →  JSON.parse()           58 % CPU
  ==> le handler re-parse et re-trie TOUT l'historique famille à CHAQUE requête
```

**MESURER — puis la mémoire.** 3 heap snapshots (baseline / 1 000 / 5 000 req). Comparaison sur le snapshot 3 :

```
  Constructor   # Delta   Size Delta   Retainer
  ===========   =======   ==========   ====================================
  (string)      +40 240   +3.2 Mo      key in Map → timelineCache (global)
  Object        +20 300   +1.8 Mo      value in Map → timelineCache (global)
  ==> timelineCache : Map module-level, une entrée par (familleId, curseur), JAMAIS purgée
```

**HYPOTHÈSE (deux causes distinctes, on les traite séparément) :**
- H1 (latence) : `buildTimeline` recalcule tout à chaque appel → CPU-bound sur le hot path.
- H2 (mémoire) : `timelineCache` est une `Map` non bornée → fuite.

**CORRIGER H1 puis H2, une à la fois.**

```js
// src/timeline/buildTimeline.mjs

// FIX H2 — cache borné LRU + TTL au lieu d'une Map infinie
import { LRUCache } from 'lru-cache';
const timelineCache = new LRUCache({ max: 5_000, ttl: 60_000 }); // 5k entrées, 60 s

// FIX H1 — sérialiser/trier UNE fois par (famille, version), pas par requête
export function buildTimeline(familleId, cursor, events, version) {
  const key = `${familleId}:${version}`;
  const cached = timelineCache.get(key);
  if (cached) return paginate(cached, cursor);        // hot path : plus de parse/sort

  const sorted = events
    .map((e) => (typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload))
    .sort((a, b) => a.ts - b.ts);                     // fait une seule fois
  timelineCache.set(key, sorted);
  return paginate(sorted, cursor);
}
```

**VÉRIFIER.** On rejoue la même charge 10 min :

```
  Métrique            AVANT        APRÈS
  =================   ==========   ==========
  p99 /timeline       1820 ms      46 ms       (~40× plus rapide)
  buildTimeline CPU   72 %         4 %
  heapUsed @ 5000     910 Mo       190 Mo (stable)
  cache size          illimité     ≤ 5 000 entrées
```

Les deux symptômes disparaissent, chiffrés avant/après. On documente et on commite.

### Exemple 2 — Le freeze périodique : event loop vs GC

Autre incident TribuZen : le WebSocket de présence (« qui est en ligne ») fige ~200 ms toutes les 30 s pour tous les clients. Deux suspects se ressemblent : blocage event loop ou pause Mark-Compact. On discrimine avec deux mesures.

```bash
node --trace-gc src/ws-presence.mjs 2>&1 | grep Mark-Compact
# [.. ] 30123 ms: Mark-Compact 42.1 (64.0) -> 18.2 (48.0) MB, 187.3 / 0.0 ms
# ==> pause GC de 187 ms, périodique ~30 s → c'est le GC, pas un calcul bloquant
```

```js
// corrélation GC ↔ latence
import { PerformanceObserver } from 'node:perf_hooks';
new PerformanceObserver((list) => {
  for (const e of list.getEntries())
    if (e.duration > 50) console.warn(`[GC] ${e.detail?.kind} ${e.duration.toFixed(0)}ms`);
}).observe({ entryTypes: ['gc'] });
// Chaque Mark-Compact 187ms coïncide avec un spike p99 → cause confirmée
```

**Cause :** le broadcast alloue un objet + une string JSON + un Buffer **par client** (200 clients × 10 msg/s = 120 000 objets/min) ; certains survivent aux Scavenge et sont promus en old gen → Mark-Compact fréquent.

```js
// FIX — sérialiser une seule fois, le message est identique pour tous
function broadcast(clients, data) {
  const frame = Buffer.from(JSON.stringify({ type: 'presence', data }), 'utf-8');
  for (const c of clients) c.send(frame); // 1 alloc au lieu de 200
}
```

**Vérifier :** Mark-Compact passe de toutes les 30 s (187 ms) à toutes les 5 min (14 ms) ; p99 de 210 ms à 9 ms. La discrimination `--trace-gc` vs `monitorEventLoopDelay` a évité de chercher un calcul bloquant qui n'existait pas.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Corriger avant de mesurer

```js
// ❌ « ça doit être le JSON.parse » → on colle un cache au pif
const cache = {};
function handler(id) {
  if (!cache[id]) cache[id] = expensive(id); // et si le vrai coût était ailleurs ?
  return cache[id];
}
```

On « optimise » une fonction qui pesait 3 % du CPU pendant que le vrai hotspot (58 %) reste intact — **et** on vient d'ajouter une fuite (`cache` objet non borné). **Règle :** un profil AVANT toute ligne de fix. Le hotspot est presque toujours là où l'intuition ne regarde pas.

### PIÈGE #2 — Confondre pic de mémoire et fuite

```
  Un heap qui monte PUIS redescend après GC  = usage normal (charge)
  Un heap qui monte et ne redescend JAMAIS   = fuite
```

Un seul `process.memoryUsage()` ne prouve rien : il faut la **tendance** après plusieurs GC. Forcer `global.gc()` (`--expose-gc`) puis mesurer : si ça ne redescend pas, c'est retenu. Sinon c'est juste de la pression temporaire.

### PIÈGE #3 — Changer plusieurs choses à la fois

```
  ❌ « J'ai ajouté un cache, réécrit le tri ET bumpé --max-old-space-size,
      c'est mieux »  → laquelle a marché ? y a-t-il une régression cachée ?
  ✅ Une hypothèse → un fix → une mesure → commit. Puis la suivante.
```

Le tuning GC (`--max-semi-space-size`, `--max-old-space-size`) est un pansement, pas un fix : il repousse l'OOM sans supprimer la fuite. À réserver après avoir traité la cause racine.

### PIÈGE #4 — Profiler le mauvais environnement

```
  ❌ Profiler en dev avec 10 entrées de données de test → aucun hotspot visible
  ✅ Reproduire avec un volume/charge réaliste (rejeu de trafic prod)
```

Beaucoup de bugs runtime (déopt megamorphic, Mark-Compact, fuites lentes) n'apparaissent qu'à l'échelle. Un profil sur un jeu de données jouet ment. **Toujours reproduire d'abord**, à une échelle qui déclenche le symptôme.

### PIÈGE #5 — Lire un flamegraph par la largeur totale seulement

La barre la plus large en **haut** n'est pas forcément le coupable : c'est souvent une fonction feuille appelée partout. Lire en **Bottom-Up** (temps propre / self time) pour trouver *où le CPU brûle réellement*, pas juste qui est en haut de la pile.

---

## 5. Ancrage TribuZen

Ce module fournit le **runbook de debugging runtime** de l'API TribuZen (`smaurier/tribuzen`), rangé dans `docs/runbooks/runtime-debugging.md`. Il code en dur la démarche pour l'astreinte :

```
tribuzen/
  docs/runbooks/
    runtime-debugging.md      # l'arbre de décision symptôme → outil → fix
  scripts/
    profile.mjs               # node --cpu-prof wrapper (charge + dump)
    heapdump.mjs              # v8.writeHeapSnapshot() sur signal SIGUSR2
  apps/api/src/
    observability/
      eventLoopMonitor.mjs    # monitorEventLoopDelay exposé sur /_health
      gcMonitor.mjs           # PerformanceObserver gc → logs structurés
    timeline/
      buildTimeline.mjs       # hot path corrigé (Exemple 1)
```

Les trois familles correspondent à trois incidents réels du produit :
- **Blocage** : l'export PDF d'un bilan famille (`/api/familles/:id/export`) fige l'API → déchargé en `worker_threads`.
- **Fuite** : `timelineCache` non borné → LRU + TTL (Exemple 1).
- **Déopt** : le parser d'événements créait des objets de shapes variables → normalisation des formes (module 11).

Le endpoint `/_health` expose `process.memoryUsage()` + event loop p99 ; un `SIGUSR2` déclenche un heap snapshot en prod sans redéploiement. C'est l'aboutissement du cours : le runtime n'est plus une boîte noire, c'est un système qu'on observe, mesure et corrige méthodiquement.

---

## 6. Points clés

1. Le workflow est fixe : **reproduire → isoler → mesurer → hypothèse → vérifier**. Jamais corriger avant d'avoir mesuré.
2. Une hypothèse = un fix = une mesure avant/après = un commit. Ne pas changer plusieurs choses à la fois.
3. L'outil découle du symptôme : `--cpu-prof` pour « lent », 3 heap snapshots pour « mémoire monte », `--trace-gc` pour « spikes périodiques », `monitorEventLoopDelay` pour « tout fige ».
4. **Blocage event loop** = calcul CPU synchrone → worker/setImmediate. Signature : toutes les routes lentes en même temps.
5. **Fuite mémoire** = heap qui ne redescend jamais après GC → retainers (Map infinie, listeners, closures) → cache borné / AbortController / WeakMap.
6. **Déopt hot path** = une fonction domine le CPU, `--trace-deopt` répété « wrong map » → normaliser les shapes d'objets.
7. `--trace-gc` (Mark-Compact) vs `monitorEventLoopDelay` discriminent une pause GC d'un calcul bloquant — deux causes qui se ressemblent.
8. Une session se capitalise en **runbook versionné** : symptôme → commande → lecture → fix, pour toute l'équipe.

---

## 7. Seeds Anki

```
Quelles sont les 5 étapes d'une session de debugging runtime ?|Reproduire → Isoler → Mesurer → Hypothèse → Vérifier. Chaque fix est précédé d'une preuve mesurable du problème et suivi d'une preuve mesurable de l'amélioration.
Symptôme « toutes les routes deviennent lentes en même temps » : quelle famille et quel outil ?|Blocage de l'event loop (calcul CPU synchrone sur le thread principal). Outil : monitorEventLoopDelay() pour confirmer, puis --cpu-prof pour trouver le calcul. Fix : worker_threads ou setImmediate.
Comment distinguer une fuite mémoire d'un simple pic de charge ?|La fuite : heapUsed monte et ne redescend JAMAIS après GC. Le pic : monte puis redescend après GC. On force global.gc() (--expose-gc) et on observe la tendance sur plusieurs cycles, pas une seule mesure.
Quelle est la méthode des 3 heap snapshots ?|Snapshot baseline, snapshot après charge, snapshot après plus de charge. On filtre « objects allocated between 1 and 2 » sur le snapshot 3 : ce qui n'a pas été collecté est retenu à tort. On lit l'arbre des retainers pour trouver qui garde la référence.
Que révèle --trace-deopt quand une fonction domine le CPU profile ?|La même fonction déoptimisée en boucle avec « Reason: wrong map » : ses arguments ont des shapes (hidden classes) incohérentes, l'inline cache devient megamorphic. Fix : normaliser les formes (mêmes props, même ordre, null plutôt que propriété absente).
Dans une ligne --trace-gc, comment repérer la pause qui cause les spikes de latence ?|Chercher les Mark-Compact (old gen) : leur temps de pause peut dépasser 100 ms. Les Scavenge (young gen) sont < 2 ms et bénins. Format : TYPE from(cap) -> to(cap) MB, pause / concurrent ms.
Pourquoi ne faut-il pas changer plusieurs choses à la fois pour corriger un bug de perf ?|Si trois changements sont appliqués ensemble et que ça va mieux, on ignore lequel a marché et on peut masquer une régression. Une hypothèse = une correction = une mesure avant/après = un commit.
À quoi sert un runbook de debugging runtime et où le range-t-on ?|Il capitalise la démarche (symptôme → commande → lecture de sortie → fix) pour transformer une compétence individuelle en réflexe d'équipe et raccourcir le prochain incident. On le versionne dans le repo, ex. docs/runbooks/.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-15-debugging-session/README.md`. Diagnostiquer trois bugs runtime réels (blocage event loop, fuite mémoire, déopt) avec les vrais outils Node/V8, du symptôme au fix vérifié, puis rédiger le runbook TribuZen. Dernier lab du parcours JS Runtime.
