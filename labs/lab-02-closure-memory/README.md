# Lab 02 — Closures et mémoire

> **Outcome :** à la fin, tu sais **observer au heap snapshot** ce qu'une closure retient réellement, reproduire une fuite mémoire causée par une closure (timer non nettoyé), la corriger, et encapsuler un cache avec le module pattern.
> **Vrai outil :** Node.js 20+ (`--expose-gc`) + Chrome DevTools (onglet **Memory**, heap snapshots). Aucun test-runner.
> **Feedback :** le coach valide en session à partir de tes snapshots et de tes observations — pas d'auto-correcteur.

---

## Énoncé

Tu enquêtes sur la fuite du `FamilyDashboard` de l'admin TribuZen (cas concret du module). Le but n'est **pas** d'écrire un composant React, mais de **voir de tes yeux**, au niveau du moteur, ce qu'une closure garde vivant — puis de casser la fuite.

Tu vas produire un petit script Node qui reproduit le motif « closure + gros objet + timer », l'inspecter au heap snapshot, puis le refactorer.

### Starter minimal

Crée un dossier de travail et un fichier `leak.mjs`. Voici **seulement** l'échafaudage de mesure (pas la solution) — tu écris le reste toi-même :

```js
// leak.mjs — lance avec : node --expose-gc leak.mjs
function heapMB() {
  return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
}

function forceGC() {
  if (global.gc) global.gc();
  else throw new Error('relance avec --expose-gc');
}

// ── À TOI d'écrire loadFamilies, startLeaky, startFixed, buildCache ──

console.log('baseline :', heapMB(), 'MB');
```

`loadFamilies()` doit simuler les ~40 Mo de familles :

```js
function loadFamilies() {
  // ~40 Mo : 50 000 familles avec un peu de contenu chacune
  return Array.from({ length: 50_000 }, (_, i) => ({
    id: `fam-${i}`,
    name: `Famille ${i}`,
    blob: 'x'.repeat(800), // gonfle chaque objet
  }));
}
```

---

## Étapes (en friction)

1. **Reproduis la fuite.** Écris `startLeaky()` qui, comme le composant : charge `loadFamilies()` dans une variable `families`, lance un `setInterval` dont le callback **lit `families.length`**, et **ne retourne pas** de fonction d'arrêt. Appelle-la, `forceGC()`, puis logge `heapMB()`. Garde une référence au timer pour pouvoir le stopper plus tard dans le lab.
2. **Observe au heap snapshot.** Lance `node --inspect-brk --expose-gc leak.mjs`, ouvre `chrome://inspect` → *Open dedicated DevTools for Node* → onglet **Memory** → **Take heap snapshot**. Dans le filtre, cherche `(closure)` puis `Array` : repère le gros tableau et, dans le panneau **Retainers** (en bas), remonte jusqu'à la closure du `setInterval`. **Note qui retient quoi.**
3. **Prouve la rétention sélective de V8.** Écris deux closures : `usesLen` qui lit `families.length`, et `usesNothing` qui ne lit rien de son scope. Dans une console Chrome, fais `console.dir(usesNothing)` puis `console.dir(usesLen)` et déplie `[[Scopes]]` → `Closure`. Note laquelle contient `families` et laquelle ne le contient pas.
4. **Corrige la fuite.** Écris `startFixed()` : n'expose au callback que ce dont il a besoin (extrais `const total = families.length`), **et** retourne une fonction `stop()` qui fait `clearInterval`. Appelle `stop()`, `forceGC()`, re-mesure : la mémoire doit retomber près de la baseline.
5. **Encapsule un cache (module pattern).** Écris `buildCache()` sous forme d'IIFE qui garde une `Map` privée `store` et expose `get` / `set` / `clear` / `size`. Vérifie que `cache.store` est `undefined` (privé), remplis le cache, mesure, puis `cache.clear()`, `forceGC()`, re-mesure : la mémoire doit redescendre.
6. **Compare les trois mesures** (fuite / corrigé / cache vidé) et explique-les au coach en termes de « qui garde quoi vivant ».

---

## Corrigé complet commenté

```js
// leak.mjs — node --expose-gc leak.mjs
function heapMB() {
  return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
}
function forceGC() {
  if (!global.gc) throw new Error('relance avec --expose-gc');
  global.gc();
}

function loadFamilies() {
  return Array.from({ length: 50_000 }, (_, i) => ({
    id: `fam-${i}`,
    name: `Famille ${i}`,
    blob: 'x'.repeat(800),
  }));
}

// ── Étape 1 : la fuite ──────────────────────────────────────────────
// Le callback est une closure qui capture `families` (gros objet).
// Tant que l'interval tourne, la closure est joignable
// -> families ne peut PAS être collecté, même si on n'a plus besoin de lui.
function startLeaky() {
  const families = loadFamilies();
  const id = setInterval(() => {
    // lit families.length -> capture families entier
    void families.length;
  }, 1000);
  return id; // on garde l'id juste pour pouvoir couper à la fin du lab
}

// ── Étape 3 : prouver la rétention sélective de V8 ──────────────────
function scopeProof() {
  const families = loadFamilies();
  const usesLen = () => families.length; // [[Scopes]] contiendra families
  const usesNothing = () => 42;          // [[Scopes]] ne contiendra PAS families
  return { usesLen, usesNothing };
  // console.dir(usesNothing) -> Closure vide de families
  // console.dir(usesLen)     -> Closure { families: Array(50000) }
}

// ── Étape 4 : la correction ─────────────────────────────────────────
// (1) On n'expose au callback qu'une primitive (total), pas le tableau.
// (2) On retourne stop() -> on peut tuer la closure -> families collectable.
function startFixed() {
  const families = loadFamilies();
  const total = families.length; // extrait ce dont on a besoin
  const id = setInterval(() => {
    void total; // capture un number, pas 40 Mo
  }, 1000);
  return function stop() {
    clearInterval(id); // plus aucune closure vivante ne retient families
  };
}

// ── Étape 5 : module pattern (IIFE + closure) ───────────────────────
// store est PRIVÉ (aucun accès depuis l'extérieur), mais on expose
// clear() -> on peut relâcher la mémoire à la demande.
function buildCache() {
  return (function () {
    const store = new Map(); // scope privé, gardé vivant par les méthodes
    return {
      get(key) { return store.get(key); },
      set(key, value) { store.set(key, value); },
      clear() { store.clear(); },
      size() { return store.size; },
    };
  })();
}

// ── Scénario de mesure ──────────────────────────────────────────────
forceGC();
console.log('baseline        :', heapMB(), 'MB');

const leakTimer = startLeaky();
forceGC();
console.log('après fuite     :', heapMB(), 'MB'); // grimpe (~40 Mo retenus)

const stop = startFixed();
stop();                   // tue la closure de startFixed -> son families devient collectable
clearInterval(leakTimer); // on coupe AUSSI la fuite de startLeaky, sinon ses ~40 Mo faussent la mesure
forceGC();
console.log('après corrigé   :', heapMB(), 'MB'); // families de startFixed collecté -> ~baseline

const cache = buildCache();
for (let i = 0; i < 50_000; i++) cache.set(`k${i}`, { blob: 'x'.repeat(800) });
forceGC();
console.log('cache rempli    :', heapMB(), 'MB'); // remonte
console.log('store privé ?   :', cache.store === undefined); // true
cache.clear();
forceGC();
console.log('cache vidé      :', heapMB(), 'MB'); // redescend
```

**Ce que les mesures prouvent :**
- `après fuite` reste haut : la closure du `setInterval` de `startLeaky` maintient `families` vivant malgré le `forceGC()`.
- `après corrigé` retombe près de la baseline : `stop()` a tué la seule closure qui retenait le `families` de `startFixed`, donc le GC l'a collecté (on a coupé le timer de fuite juste avant pour ne mesurer que cet effet).
- `cache vidé` redescend : `clear()` vide la `Map` privée sans détruire le module — la rétention est **circonscrite et pilotable**, contrairement à la fuite anonyme.

Au heap snapshot (étape 2), tu dois voir, dans les **Retainers** du gros `Array`, une chaîne du type `Array → context → (closure) → Timeout`. C'est la preuve visuelle que « une closure vivante garde tout son scope vivant ».

---

## Variante J+30 (fading)

Sans relire le corrigé, en **20 minutes** : pars d'un `startLeaky()` donné et, à partir d'**un seul heap snapshot**, identifie le retainer fautif, puis écris `startFixed()` **et** un `buildCache()` avec un `clear()`. Contrainte ajoutée : le callback du timer doit rester (il logge un compteur), tu n'as le droit de casser la fuite **que** par extraction de la donnée + `clearInterval` — interdit de supprimer le timer.

---

## Application TribuZen

Porter le motif dans `smaurier/tribuzen` :

1. **`src/features/admin/FamilyDashboard.tsx`** — appliquer la correction de l'étape 4 : `useEffect` avec `return () => clearInterval(id)` et capture d'une primitive au lieu de la liste. Vérifier au heap snapshot (Profiler React + Memory) que démonter/remonter le composant 10 fois ne fait plus grimper la mémoire en escalier.
2. **`src/lib/familyCache.ts`** — écrire le cache en module pattern (étape 5), `store` privé, exposer `clear()`, et brancher ce `clear()` sur l'événement de déconnexion admin.
3. Commit sur `smaurier/tribuzen` : `fix(admin): stop family dashboard leak + encapsulate family cache`.

> Rappel : le **diagnostic systématique** des fuites (snapshots comparés, dominators, détection de croissance) est le sujet du **module 08 — Memory leaks**. Ce lab te donne le réflexe de base ; le module 08 en fait une méthode.
