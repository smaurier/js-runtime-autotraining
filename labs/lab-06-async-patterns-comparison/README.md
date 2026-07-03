# Lab 06 — Séquentiel vs parallèle : mesurer le gain

> **Outcome :** à la fin, tu sais mesurer avec `performance.now()` l'écart réel entre un chargement `async/await` séquentiel et sa version `Promise.all`, reproduire le piège de l'`await`-dans-la-boucle, et borner le parallélisme.
> **Vrai outil :** Node.js (v18+) exécuté en ligne de commande — `node lab.mjs`. Mesures réelles via `performance.now()`, aucun test simulé.
> **Feedback :** le coach lit tes chiffres et ta conclusion en session — pas de test-runner auto-correcteur.

---

## Énoncé

On simule le chargement du dashboard famille TribuZen. Trois sources indépendantes (famille, membres, posts) et un enrichissement « dernier post par membre ». Tu vas **chronométrer toi-même** quatre variantes et confirmer les ordres de grandeur annoncés dans le module.

Chaque « requête » est simulée par un `delay(ms)` qui rend une Promise résolue après `ms` millisecondes (`setTimeout`). C'est fidèle : une I/O réseau, du point de vue de l'event loop, c'est exactement ça — une attente non bloquante.

**Starter minimal** — crée un dossier et un seul fichier `lab.mjs` (l'extension `.mjs` active les modules ES et le top-level `await`) :

```js
// lab.mjs — STARTER (à compléter)
import { performance } from 'node:perf_hooks';

// Simule une I/O : résout `value` après `ms` millisecondes.
function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// Sources simulées du dashboard (durées volontairement différentes)
const fetchFamily      = (id) => delay(120, { id, name: 'Les Dupont' });
const fetchMembers     = (id) => delay(150, Array.from({ length: 8 }, (_, i) => ({ id: `m${i}` })));
const fetchLatestPosts = (id) => delay(180, [{ id: 'p1' }, { id: 'p2' }]);

// Enrichissement : 1 requête ~100 ms par membre
const fetchLastPost = (memberId) => delay(100, { id: `post-${memberId}` });

// Petit utilitaire de chronométrage : renvoie [résultat, durée_ms]
async function timed(label, fn) {
  const t0 = performance.now();
  const result = await fn();
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`${label.padEnd(28)} ${ms} ms`);
  return result;
}

// TODO 1 : loadSequential
// TODO 2 : loadParallel
// TODO 3 : enrichLoop  (await dans la boucle)
// TODO 4 : enrichParallel (map + Promise.all)
// TODO 5 : enrichBounded (parallélisme borné, lots de 3)

// Zone d'exécution (top-level await)
```

Lance avec `node lab.mjs`. Aucune dépendance à installer.

---

## Étapes (en friction)

1. **Écris `loadSequential(id)`** — trois `await` en série (`fetchFamily`, puis `fetchMembers`, puis `fetchLatestPosts`), retourne `{ family, members, posts }`. Chronomètre-la avec `timed`.
2. **Écris `loadParallel(id)`** — même résultat, mais avec `Promise.all` sur les trois appels. Chronomètre.
3. **Prédis avant de lancer** : quel temps attends-tu pour chacune ? Note ta prédiction, PUIS exécute et compare.
4. **Écris `enrichLoop(members)`** — pour chaque membre, `await fetchLastPost(m.id)` dans un `for...of`, pousse `{ ...m, lastPost }` dans un tableau. Chronomètre.
5. **Écris `enrichParallel(members)`** — `members.map(async m => ...)` + `Promise.all`. Chronomètre. Vérifie que le résultat est identique à `enrichLoop` (même ordre, mêmes données).
6. **Écris `enrichBounded(members, size, fn)`** — traite les membres par lots de `size` (`slice` + `Promise.all` par lot, dans un `for`). Chronomètre avec `size = 3`.
7. **Conclus** : remplis un petit tableau `variante → durée mesurée` et explique, en une phrase par ligne, pourquoi chaque chiffre tombe là. C'est ce que le coach relira.

---

## Corrigé complet commenté

```js
// lab.mjs — CORRIGÉ
import { performance } from 'node:perf_hooks';

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const fetchFamily      = (id) => delay(120, { id, name: 'Les Dupont' });
const fetchMembers     = (id) => delay(150, Array.from({ length: 8 }, (_, i) => ({ id: `m${i}` })));
const fetchLatestPosts = (id) => delay(180, [{ id: 'p1' }, { id: 'p2' }]);
const fetchLastPost    = (memberId) => delay(100, { id: `post-${memberId}` });

async function timed(label, fn) {
  const t0 = performance.now();
  const result = await fn();
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`${label.padEnd(28)} ${ms} ms`);
  return result;
}

// ─── TODO 1 — Séquentiel : temps ≈ 120 + 150 + 180 = 450 ms ──────
async function loadSequential(id) {
  const family  = await fetchFamily(id);       // on attend 120 ms...
  const members = await fetchMembers(id);      // ...PUIS on lance, +150 ms...
  const posts   = await fetchLatestPosts(id);  // ...PUIS on lance, +180 ms
  return { family, members, posts };
}

// ─── TODO 2 — Parallèle : temps ≈ max(120,150,180) = 180 ms ──────
async function loadParallel(id) {
  // Les 3 appels partent AVANT le moindre await (appels synchrones dans le tableau).
  const [family, members, posts] = await Promise.all([
    fetchFamily(id),
    fetchMembers(id),
    fetchLatestPosts(id),
  ]);
  return { family, members, posts };
}

// ─── TODO 3 — await dans la boucle : temps ≈ 8 × 100 = 800 ms ────
async function enrichLoop(members) {
  const out = [];
  for (const m of members) {
    // Chaque tour SUSPEND 100 ms avant de lancer le suivant → série.
    const lastPost = await fetchLastPost(m.id);
    out.push({ ...m, lastPost });
  }
  return out;
}

// ─── TODO 4 — map + Promise.all : temps ≈ 100 ms (tout en //) ────
async function enrichParallel(members) {
  // map est SYNCHRONE : les 8 fetchLastPost partent d'un coup.
  return Promise.all(
    members.map(async (m) => {
      const lastPost = await fetchLastPost(m.id);
      return { ...m, lastPost };
    }),
  );
  // Note : l'ordre du tableau résultat suit l'ordre d'ENTRÉE (garantie de
  // Promise.all), pas l'ordre de résolution — même sortie que enrichLoop.
}

// ─── TODO 5 — parallélisme borné : lots de 3 → ⌈8/3⌉ = 3 lots ────
// temps ≈ 3 × 100 = 300 ms. Compromis entre vitesse et charge base.
async function enrichBounded(members, size, fn) {
  const out = [];
  for (let i = 0; i < members.length; i += size) {
    const batch = members.slice(i, i + size);   // ex. 3 membres
    const done = await Promise.all(batch.map(fn)); // 3 en //, on attend le lot
    out.push(...done);                          // puis lot suivant
  }
  return out;
}

// ─── Exécution (top-level await, autorisé en .mjs) ───────────────
console.log('--- Dashboard : séquentiel vs parallèle ---');
await timed('loadSequential', () => loadSequential('fam-1'));
const parallel = await timed('loadParallel', () => loadParallel('fam-1'));

console.log('\n--- Enrichissement : boucle vs parallèle vs borné ---');
const members = parallel.members;
await timed('enrichLoop', () => enrichLoop(members));
await timed('enrichParallel', () => enrichParallel(members));
await timed('enrichBounded (lots de 3)', () => enrichBounded(members, 3, (m) =>
  fetchLastPost(m.id).then((lastPost) => ({ ...m, lastPost })),
));
```

**Sortie typique (les chiffres varient de quelques ms) :**

```
--- Dashboard : séquentiel vs parallèle ---
loadSequential               452 ms
loadParallel                 181 ms

--- Enrichissement : boucle vs parallèle vs borné ---
enrichLoop                   806 ms
enrichParallel               101 ms
enrichBounded (lots de 3)    303 ms
```

**Pourquoi ces chiffres :**
- `loadSequential` ≈ **somme** (120+150+180) : chaque `await` attend la résolution complète avant de *lancer* la source suivante.
- `loadParallel` ≈ **max** (180) : les trois appels sont émis avant tout `await`, leurs horloges tournent ensemble ; on ne suspend qu'une fois sur `Promise.all`.
- `enrichLoop` ≈ **8 × 100** : l'`await` dans le `for...of` sérialise les 8 requêtes.
- `enrichParallel` ≈ **100** : `map` émet les 8 requêtes d'un coup, `Promise.all` attend le lot entier une seule fois.
- `enrichBounded` ≈ **3 × 100** : 3 lots de ≤ 3 requêtes ; chaque lot est parallèle mais on attend un lot avant le suivant — vitesse quasi parallèle tout en plafonnant les connexions simultanées.

---

## Variante J+30 (fading)

**Sans rouvrir ce corrigé ni le module, en 25 minutes :**

1. Ajoute une source `fetchEvents(id)` (`delay(90, ...)`) au dashboard. Version séquentielle ET parallèle — prédis puis mesure les deux nouveaux temps.
2. Rends `loadParallel` **résilient** : remplace `Promise.all` par `Promise.allSettled` et fais échouer volontairement `fetchLatestPosts` (retourne `Promise.reject(new Error('posts KO'))`). Le dashboard doit quand même renvoyer famille + membres, avec `posts: []`.
3. Ajoute à `enrichBounded` un `console.log` par lot (`lot 1/3…`) pour **voir** le découpage temporel : les logs doivent apparaître espacés d'~100 ms.

**Critère de réussite :** tes temps mesurés respectent les ordres de grandeur (somme vs max vs N×unité), et la version `allSettled` ne crash pas malgré le rejet des posts.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces patterns vivent côté serveur :

```
tribuzen/src/server/
  api/
    family.ts      ← loadFamilyDashboard : Promise.all (+ allSettled pour les widgets non critiques)
    members.ts     ← membersWithLastPost : members.map(...) + Promise.all
  lib/
    concurrency.ts ← inBatches(items, size, fn) : parallélisme borné (le enrichBounded du lab)
```

**Différences par rapport au lab :**
- `delay(ms)` devient de vraies requêtes Prisma / `fetch` — le raisonnement séquentiel vs parallèle est identique, seules les sources changent.
- Le parallélisme borné protège le **pool de connexions Postgres** : un `Promise.all` non borné sur 5 000 membres importés ouvrirait 5 000 requêtes simultanées et saturerait la base. `inBatches(members, 10, ...)` plafonne à 10.
- On instrumente les vrais temps avec `performance.now()` (ou un middleware de traçage) pour vérifier le gain en conditions réelles, comme dans ce lab.

**Commit cible :**
```
perf(api): loadFamilyDashboard en Promise.all — mesuré 450ms vers 180ms
feat(lib): inBatches — parallélisme borné pour l'import massif de membres
```
