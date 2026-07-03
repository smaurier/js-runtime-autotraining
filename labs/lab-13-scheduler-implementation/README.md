# Lab 13 — Scheduler coopératif : découper un gros travail sans bloquer

> **Outcome :** à la fin, tu sais implémenter de zéro un scheduler coopératif qui découpe un gros traitement CPU-bound en chunks, cède l'event loop entre chaque lot, et tu prouves — mesure à l'appui — que l'API reste réactive. Puis tu compares avec une version offloadée en `worker_threads`.
> **Vrai outil :** Node.js (≥ 20) + `node:worker_threads` + `node:perf_hooks`. Aucun harnais simulé, aucun test-runner auto-correcteur.
> **Feedback :** le coach valide en session en lisant la sortie console (lag event loop mesuré, temps total comparé).

---

## Énoncé

Tu reproduis le problème réel de l'API TribuZen : un export CSV de 80 000 membres qui **gèle l'event loop** et fait attendre toutes les autres requêtes. Tu vas :

1. **Reproduire le blocage** — écrire la version monolithique et mesurer le lag de l'event loop pendant qu'elle tourne.
2. **Implémenter un scheduler coopératif** — une fonction `runChunked` qui découpe le travail et cède l'event loop entre les chunks avec `setImmediate`.
3. **Prouver la réactivité** — la même sonde de lag doit rester basse pendant la version chunkée.
4. **Comparer avec l'offload** — déplacer le calcul dans un `worker_threads` et observer que l'event loop du thread principal ne bouge pas du tout.

**Ce que tu dois produire toi-même** (pas de gap-fill) :
- `probe.mjs` — la sonde de lag event loop.
- `blocking.mjs` — la version qui bloque.
- `scheduler.mjs` — le scheduler coopératif `runChunked`.
- `worker-version.mjs` + `csv.worker.mjs` — la version offloadée.

### Starter minimal

Crée un dossier `lab13/` et ce fichier de données partagé. Rien d'autre n'est fourni : tu écris chaque module.

```js
// lab13/data.mjs — jeu de données commun
export function makeMembers(n = 80_000) {
  const roles = ['admin', 'mod', 'member'];
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `Membre ${i}`,
    email: `membre${i}@tribuzen.app`,
    role: roles[i % 3],
    joinedAt: 1_700_000_000_000 + i * 1000,
  }));
}

// Travail volontairement un peu coûteux par ligne (échappement + formatage)
export function formatRow(m) {
  const name = m.name.includes(',') ? `"${m.name.replace(/"/g, '""')}"` : m.name;
  const date = new Date(m.joinedAt).toISOString();
  return `${m.id},${name},${m.email},${m.role},${date}`;
}
```

Lance chaque étape avec `node lab13/<fichier>.mjs` et lis la console.

---

## Étapes (en friction)

1. **Écris `probe.mjs`** — une fonction `startProbe(intervalMs = 50)` qui arme un `setInterval` : à chaque tick, calcule `lag = now - last - intervalMs`, stocke-le, et renvoie une fonction `stop()` qui rend `{ max, avg }` des lags observés. C'est ton instrument de mesure — sans lui, tu ne prouves rien.
2. **Écris `blocking.mjs`** — importe `makeMembers` + `formatRow`, démarre la sonde, construis le CSV dans **une seule boucle synchrone** (`lines.push(formatRow(m))` puis `lines.join('\n')`), arrête la sonde, affiche `lag max` et `lag avg`. Observe : le `lag max` explose (l'event loop n'a jamais pu tourner pendant la boucle).
3. **Écris `scheduler.mjs`** — implémente `runChunked(items, handle, { chunkSize = 2000 })` : boucle sur `items`, appelle `handle(item, i)`, et **tous les `chunkSize` éléments, cède avec `await new Promise(r => setImmediate(r))`**. Réutilise `probe.mjs` : le `lag max` doit maintenant rester bas (quelques ms). Affiche aussi le **temps total** — il est légèrement plus grand que la version bloquante. Explique en commentaire pourquoi (concurrence ≠ vitesse).
4. **Fais varier `chunkSize`** — teste 200, 2000, 20000. Note le compromis : petit chunk = plus réactif mais plus lent (plus de yields) ; gros chunk = plus rapide mais lag plus élevé.
5. **Écris `csv.worker.mjs` + `worker-version.mjs`** — le worker reçoit les membres via `workerData`, construit le CSV **d'un seul tenant** (pas besoin de chunker : il est seul sur son thread), et `postMessage` le résultat. Le thread principal démarre la sonde AVANT de lancer le worker et l'arrête à réception : le `lag max` doit être **quasi nul** — l'event loop principal n'a rien fait de lourd.
6. **Conclus** (commentaire ou note) : quand préférer chunking (rester réactif, temps total ok, pas de frontière à payer) vs offload (zéro impact event loop, data lourde, parallélisable en pool) ?

---

## Corrigé complet commenté

```js
// ─── lab13/probe.mjs ────────────────────────────────────────────
import { performance } from 'node:perf_hooks';

// Sonde de lag event loop : on programme un tick toutes les intervalMs.
// Si l'event loop est bloqué, le tick arrive EN RETARD ; ce retard = le lag.
export function startProbe(intervalMs = 50) {
  const lags = [];
  let last = performance.now();

  const id = setInterval(() => {
    const now = performance.now();
    // Écart entre l'instant réel et l'instant théorique du tick.
    // 0 = event loop libre ; grand = event loop monopolisé.
    lags.push(now - last - intervalMs);
    last = now;
  }, intervalMs);

  // Ne pas empêcher le process de sortir à cause de la sonde
  id.unref?.();

  return function stop() {
    clearInterval(id);
    const max = lags.length ? Math.max(...lags) : 0;
    const avg = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : 0;
    return { max, avg, samples: lags.length };
  };
}

// ─── lab13/blocking.mjs ─────────────────────────────────────────
import { performance } from 'node:perf_hooks';
import { makeMembers, formatRow } from './data.mjs';
import { startProbe } from './probe.mjs';

const members = makeMembers();

const stop = startProbe(50);
const t0 = performance.now();

// UNE seule boucle synchrone : rien ne peut interrompre ce bloc.
// La sonde ne pourra pas tirer un seul tick pendant tout ce temps.
const lines = ['id,name,email,role,joinedAt'];
for (const m of members) {
  lines.push(formatRow(m));
}
const csv = lines.join('\n');

const total = performance.now() - t0;
// Laisser un tour d'event loop pour que la sonde capture l'après-coup
setTimeout(() => {
  const { max, avg } = stop();
  console.log('[BLOCKING]');
  console.log(`  lignes CSV     : ${csv.split('\n').length}`);
  console.log(`  temps total    : ${total.toFixed(1)} ms`);
  console.log(`  event loop lag : max ${max.toFixed(1)} ms | avg ${avg.toFixed(1)} ms`);
  // Attendu : lag max ENORME (proche du temps total) -> event loop gelé.
}, 0);

// ─── lab13/scheduler.mjs ────────────────────────────────────────
import { performance } from 'node:perf_hooks';
import { makeMembers, formatRow } from './data.mjs';
import { startProbe } from './probe.mjs';

// Yield PROPRE en Node : phase "check". Une microtâche (queueMicrotask,
// Promise.resolve) NE marcherait PAS ici : elle est drainée avant l'I/O.
const yieldToLoop = () => new Promise((r) => setImmediate(r));

// Le scheduler coopératif : découpe le travail et cède entre les lots.
export async function runChunked(items, handle, { chunkSize = 2000 } = {}) {
  for (let i = 0; i < items.length; i++) {
    handle(items[i], i);
    // Point de yield : l'event loop reprend la main après chaque lot plein de chunkSize items.
    // C'est CE await qui rend l'application réactive.
    if (i > 0 && i % chunkSize === 0) {
      await yieldToLoop();
    }
  }
}

// Démo : même export CSV, mais coopératif
if (import.meta.url === `file://${process.argv[1]}`) {
  const members = makeMembers();

  for (const chunkSize of [200, 2000, 20000]) {
    const lines = ['id,name,email,role,joinedAt'];
    const stop = startProbe(50);
    const t0 = performance.now();

    await runChunked(members, (m) => lines.push(formatRow(m)), { chunkSize });

    const total = performance.now() - t0;
    const { max, avg } = stop();
    console.log(`[CHUNKED chunkSize=${chunkSize}]`);
    console.log(`  temps total    : ${total.toFixed(1)} ms`);
    console.log(`  event loop lag : max ${max.toFixed(1)} ms | avg ${avg.toFixed(1)} ms`);
    // Attendu : lag max BAS (quelques ms) même si temps total un peu plus grand.
    // Concurrence != vitesse : on ne va pas plus vite, on reste réactif.
  }
}

// ─── lab13/csv.worker.mjs ───────────────────────────────────────
import { parentPort, workerData } from 'node:worker_threads';
import { formatRow } from './data.mjs';

// On est SEUL sur ce thread : inutile de chunker, on peut boucler d'un trait.
// Le blocage ici n'affecte QUE ce worker, pas l'event loop principal.
const lines = ['id,name,email,role,joinedAt'];
for (const m of workerData.members) {
  lines.push(formatRow(m));
}
parentPort.postMessage(lines.join('\n'));

// ─── lab13/worker-version.mjs ───────────────────────────────────
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { makeMembers } from './data.mjs';
import { startProbe } from './probe.mjs';

const members = makeMembers();

const stop = startProbe(50);
const t0 = performance.now();

const worker = new Worker(new URL('./csv.worker.mjs', import.meta.url), {
  workerData: { members }, // structured clone à la frontière (coût O(n))
});

worker.once('message', (csv) => {
  const total = performance.now() - t0;
  worker.terminate();
  // Laisser la sonde capturer l'état après réception
  setTimeout(() => {
    const { max, avg } = stop();
    console.log('[WORKER offload]');
    console.log(`  lignes CSV     : ${csv.split('\n').length}`);
    console.log(`  temps total    : ${total.toFixed(1)} ms (inclut le clone + le calcul)`);
    console.log(`  event loop lag : max ${max.toFixed(1)} ms | avg ${avg.toFixed(1)} ms`);
    // Attendu : lag max QUASI NUL -> le thread principal n'a rien fait de lourd.
  }, 0);
});

worker.once('error', (err) => { console.error(err); process.exit(1); });
```

**Pourquoi ce corrigé est correct :**
- `probe.mjs` mesure exactement ce qui compte : le **retard des ticks**, image directe du temps pendant lequel l'event loop n'a pas pu tourner. C'est la preuve objective de réactivité.
- `blocking.mjs` montre le symptôme : un `lag max` proche du temps total — l'event loop est mort pendant toute la boucle.
- `runChunked` cède avec `setImmediate` (macrotâche), **pas** une microtâche : c'est la seule façon de laisser l'I/O respirer (piège #2 du module). Le `lag max` chute.
- La version worker prouve la distinction concurrence/parallélisme : ici l'event loop principal est **totalement libre** (lag ~0), là où le chunking le gardait juste *réactif* (lag bas mais non nul). Le worker paie en échange le coût du structured clone de `workerData`.
- Aucun test simulé : la validation, c'est **lire les trois `lag max`** et constater blocking ≫ chunked > worker.

---

## Variante J+30 (fading)

**Même objectif, reproduit de mémoire, contraintes ajoutées — en 30 minutes, sans rouvrir ce corrigé ni le module :**

1. Généralise `runChunked` en **scheduler à budget de temps** : au lieu de céder tous les `chunkSize` éléments, cède dès que le lot en cours a consommé **plus de 8 ms** (mesure avec `performance.now()` à l'entrée du lot). C'est le vrai pattern « time slicing » : on découpe par **temps**, pas par nombre fixe d'items.
2. Ajoute l'**annulation** : `runChunked` accepte un `AbortSignal` ; si `signal.aborted`, la boucle s'arrête proprement au prochain point de yield.
3. Transforme la version worker en **pool de 2 workers** : découpe `members` en 2 moitiés, lance les deux workers en parallèle, `Promise.all` les résultats, concatène. Compare le temps total au worker unique — le pool doit être plus rapide (2 cœurs).

**Critère de réussite :** le scheduler à budget garde un `lag max` sous ~10 ms quel que soit le volume ; l'annulation stoppe bien à mi-course ; le pool de 2 workers bat le worker unique en temps total.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce lab se porte directement dans l'API :

```
tribuzen/apps/api/src/
  lib/eventloop-probe.ts      # startProbe -> monté en dev pour surveiller le lag
  lib/run-chunked.ts          # runChunked réutilisable (export CSV, imports, migrations)
  routes/export.ts            # GET /api/export/members.csv -> runChunked (setImmediate)
  services/stats-service.ts   # orchestration de l'offload
  workers/stats.worker.ts     # agrégation d'engagement en worker_threads
```

**Différences par rapport au lab :**
- Le CSV réel est **streamé** vers la réponse (`res.write` + gestion du `'drain'` pour la backpressure) au lieu d'être bufferisé en mémoire — sur 80 000 lignes, on ne veut pas garder tout le CSV en RAM.
- Le worker de stats **lit la DB lui-même** (on lui passe l'`id` de famille, pas les millions de lignes) pour éviter le structured clone lourd vu à l'étape 5.
- La sonde de lag alimente une métrique observée en continu (seuil d'alerte si `lag > 50 ms`), pas juste un `console.log`.

**Commit cible :**
```
feat(api): runChunked — export CSV coopératif qui ne gèle plus l'event loop
feat(api): stats.worker — agrégation d'engagement offloadée en worker_threads
chore(api): sonde de lag event loop en dev
```
