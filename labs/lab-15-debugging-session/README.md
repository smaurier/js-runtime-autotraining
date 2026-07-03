# Lab 15 — Session de debugging runtime

> **Outcome :** à la fin, tu sais diagnostiquer trois bugs runtime (blocage event loop, fuite mémoire, déopt hot path) avec les vrais outils Node/V8, du symptôme au fix vérifié.
> **Vrai outil :** Node.js (`--inspect`, `--cpu-prof`, `--heap-prof`, `--trace-gc`, `--trace-deopt`, `monitorEventLoopDelay`, `v8.writeHeapSnapshot`) + Chrome DevTools. JAMAIS un harnais simulé.
> **Feedback :** le coach valide en session (pas de test-runner auto-correcteur). La preuve, c'est ta mesure avant/après.

## Énoncé

Tu récupères une mini-API TribuZen volontairement défaillante, `slow-api.mjs`, avec trois endpoints, chacun porteur d'un bug runtime d'une famille différente. Ta mission : pour **chacun**, mener le workflow complet **reproduire → isoler → mesurer → hypothèse → corriger → vérifier**, avec une mesure chiffrée avant/après.

Starter minimal (à créer, c'est du vrai code exécutable — pas de gap-fill) :

```js
// slow-api.mjs — lancer : node slow-api.mjs  (puis charger avec autocannon ou curl)
import http from 'node:http';

// ── BUG 1 — blocage event loop : /report fait un calcul CPU synchrone ──────
function heavyReport() {
  let acc = 0;
  for (let i = 0; i < 5e8; i++) acc += Math.sqrt(i) % 7; // ~2-3 s synchrones
  return acc;
}

// ── BUG 2 — fuite mémoire : /track garde tout dans une Map non bornée ──────
const sessionCache = new Map();
function track(id, payload) {
  sessionCache.set(id, { payload, at: Date.now() }); // jamais purgé
}

// ── BUG 3 — déopt : /ingest crée des objets de shapes incohérentes ─────────
function parseRow(headers, values) {
  const row = {};
  for (let i = 0; i < headers.length; i++) {
    if (values[i]) row[headers[i]] = values[i]; // propriété absente si vide → shapes variables
  }
  return row.total ? row.total * 2 : 0;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/report') { const r = heavyReport(); res.end(String(r)); return; }
  if (url.pathname === '/track') { track(Math.random().toString(36), 'x'.repeat(1024)); res.end('ok'); return; }
  if (url.pathname === '/ingest') {
    const headers = ['name', 'total', 'city', 'tag'];
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const values = [`n${i}`, i % 3 ? String(i) : '', i % 5 ? 'Lyon' : '', i % 7 ? 'a' : ''];
      sum += parseRow(headers, values);
    }
    res.end(String(sum)); return;
  }
  if (url.pathname === '/_health') { res.end(JSON.stringify(process.memoryUsage())); return; }
  res.statusCode = 404; res.end('not found');
});
server.listen(3000, () => console.log('slow-api on :3000'));
```

## Étapes (en friction)

1. **Bug 1 — blocage.** Lance le serveur. Ajoute un `monitorEventLoopDelay()` qui log le p99 toutes les 2 s. Frappe `/report` pendant que tu frappes `/_health` en boucle : observe que `/_health` devient lent EN MÊME TEMPS. Note le p99 de l'event loop pendant le freeze. Formule l'hypothèse, puis corrige (déléguer à un `worker_threads`). Re-mesure : `/_health` doit rester rapide pendant `/report`.
2. **Bug 2 — fuite.** Lance avec `node --inspect slow-api.mjs`, attache Chrome DevTools > Memory. Prends 3 heap snapshots : baseline, après ~1 000 hits sur `/track`, après ~5 000. Compare, trouve le retainer (`sessionCache`). Corrige (cache borné LRU + TTL). Re-mesure sur `/_health` : `heapUsed` doit se stabiliser après GC.
3. **Bug 3 — déopt.** `node --trace-deopt slow-api.mjs 2>&1 | grep -c deoptimizing` pendant que tu frappes `/ingest`. Confirme les déopts répétées, puis `--trace-ic` pour voir le site megamorphic. Corrige (normaliser la shape : `null` au lieu de propriété absente). Re-compte les déopts (doit tomber à ~0) et chronomètre `/ingest` avant/après avec `performance.now()`.
4. **Capitaliser.** Rédige un mini-runbook (`RUNBOOK.md`) : pour chaque symptôme, la commande, comment lire la sortie, le fix appliqué.

## Corrigé complet commenté

```js
// slow-api.fixed.mjs — lancer : node slow-api.fixed.mjs
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { LRUCache } from 'lru-cache';

// ── Observabilité : preuve avant/après du blocage event loop ────────────────
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
setInterval(() => {
  console.log(`loop p99: ${(loop.percentile(99) / 1e6).toFixed(1)} ms`); // ns → ms
  loop.reset();
}, 2000);

// ── FIX BUG 1 — décharger le calcul CPU vers un worker ──────────────────────
// report-worker.mjs contient :  parentPort.postMessage(heavyReport());
function runReport() {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./report-worker.mjs', import.meta.url));
    w.on('message', (v) => { resolve(v); w.terminate(); });
    w.on('error', reject);
  });
}

// ── FIX BUG 2 — cache borné : plus de croissance illimitée ──────────────────
const sessionCache = new LRUCache({ max: 10_000, ttl: 60_000 }); // borne + expiration
function track(id, payload) {
  sessionCache.set(id, { payload, at: Date.now() }); // éviction auto quand plein
}

// ── FIX BUG 3 — shape uniforme : toutes les lignes ont les mêmes propriétés ──
function parseRow(headers, values) {
  const row = {};
  for (let i = 0; i < headers.length; i++) {
    row[headers[i]] = values[i] || null; // null au lieu d'absence → une seule hidden class
  }
  return row.total ? Number(row.total) * 2 : 0;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/report') {           // ne bloque plus l'event loop
    const r = await runReport();
    res.end(String(r)); return;
  }
  if (url.pathname === '/track') {
    track(Math.random().toString(36), 'x'.repeat(1024));
    res.end('ok'); return;
  }
  if (url.pathname === '/ingest') {
    const headers = ['name', 'total', 'city', 'tag'];
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const values = [`n${i}`, i % 3 ? String(i) : '', i % 5 ? 'Lyon' : '', i % 7 ? 'a' : ''];
      sum += parseRow(headers, values);        // monomorphic → optimisé par TurboFan
    }
    res.end(String(sum)); return;
  }
  if (url.pathname === '/_health') { res.end(JSON.stringify(process.memoryUsage())); return; }
  res.statusCode = 404; res.end('not found');
});
server.listen(3000, () => console.log('slow-api.fixed on :3000'));
```

**Preuves attendues (avant → après) :**

```
  Bug 1 (blocage)  loop p99 pendant /report : 2450 ms → 3 ms
  Bug 2 (fuite)    heapUsed après 5000 /track : monte sans fin → stable ~150 Mo
  Bug 3 (déopt)    grep -c deoptimizing sur /ingest : ~800 → 0 ; /ingest ~5× plus rapide
```

## Variante J+30 (fading)

Reprends `slow-api.mjs` **sans regarder le corrigé**, en 25 min chrono. Contrainte ajoutée : tu n'as **pas** le droit d'utiliser Chrome DevTools (serveur sans UI, SSH only). Diagnostique les trois bugs uniquement en ligne de commande — `--cpu-prof` + `node inspect`, `v8.writeHeapSnapshot()` déclenché sur `SIGUSR2`, `--trace-gc`, `--trace-deopt`. Objectif : prouver chaque cause avec une mesure CLI, sans interface graphique.

## Application TribuZen

Porte la démarche dans `smaurier/tribuzen` :
1. Ajoute `src/observability/eventLoopMonitor.mjs` (`monitorEventLoopDelay`) et `gcMonitor.mjs` (`PerformanceObserver` gc), exposés sur `/_health`.
2. Ajoute `scripts/heapdump.mjs` : un handler `SIGUSR2` qui appelle `v8.writeHeapSnapshot()` — permet de dumper en prod sans redéploiement.
3. Applique le fix LRU+TTL au vrai `timelineCache` du handler timeline (le hot path du module 15).
4. Écris `docs/runbooks/runtime-debugging.md` : l'arbre de décision symptôme → commande → lecture → fix, pour l'astreinte.
5. Commit : `feat(observability): runbook + monitoring runtime (event loop, GC, heapdump)`.
