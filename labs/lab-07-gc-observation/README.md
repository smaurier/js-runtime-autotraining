# Lab 07 — Observer le Garbage Collector de V8

> **Outcome :** à la fin, tu sais observer le GC de V8 en direct — mesurer une libération mémoire, corréler la durée d'une pause GC au nombre d'objets vivants, et prouver qu'un cache `WeakMap` réduit la rétention — le tout avec `--expose-gc` et `process.memoryUsage()`.
> **Vrai outil :** Node.js (≥ 20) avec le flag `--expose-gc`, `process.memoryUsage()`, `performance.now()`. Aucun harnais simulé, aucun test-runner.
> **Feedback :** le coach valide en session en lisant ta sortie console et ton interprétation (pas d'auto-correcteur).

## Énoncé

On diagnostique le pic de latence P99 périodique de l'API TribuZen (vu dans le module). Tu vas écrire **un seul fichier** `gc-lab.js`, lancé avec `node --expose-gc gc-lab.js`, qui produit trois observations empiriques :

1. **Libération** — allouer beaucoup de déchet, forcer un GC, prouver via `heapUsed` que la mémoire est récupérée.
2. **Pause vs charge** — mesurer la durée de `global.gc()` selon le nombre d'objets **vivants** retenus.
3. **WeakMap vs Map** — montrer qu'une `Map` forte retient les familles (heap qui ne redescend pas) alors qu'une `WeakMap` les laisse collecter.

Starter minimal (à compléter, pas de gap-fill dirigé) :

```js
// gc-lab.js — lancer : node --expose-gc gc-lab.js
if (typeof global.gc !== 'function') {
  console.error('Relance avec :  node --expose-gc gc-lab.js');
  process.exit(1);
}
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' Mo';
const heap = () => process.memoryUsage().heapUsed;

// À toi : partie1(), partie2(), partie3()
```

## Étapes (en friction)

1. **Partie 1 — Libération.** Écris `partie1()` : force un GC de base, lis `heap()` (baseline), alloue 500 000 objets temporaires dans une boucle sans les retenir, relis `heap()`, force `global.gc()`, relis `heap()`. Affiche les trois valeurs avec `mb()`. Attendu : la valeur post-GC revient proche de la baseline.
2. **Partie 2 — Pause vs charge.** Écris `partie2()` : pour chaque `n` dans `[0, 100_000, 500_000, 1_000_000]`, construis un tableau qui **reste vivant** de `n` objets, encadre un `global.gc()` par `performance.now()`, et affiche la pause. Attendu : la pause croît avec `n`.
3. **Partie 3 — WeakMap vs Map.** Crée 50 000 objets `family`. Version A : indexe-les dans une `Map` forte `key->family`. Version B : dans une `WeakMap` `family->meta`. Dans les deux cas, mets à `null` le tableau source, force un GC, lis `heap()`. Attendu : la `WeakMap` laisse `heapUsed` redescendre ; la `Map` forte le maintient haut.
4. **Interprète** à voix haute pour le coach : pourquoi la partie 2 dépend des vivants et pas du total, et laquelle des deux structures de la partie 3 causerait le tas qui gonfle en prod.

## Corrigé complet commenté

```js
// gc-lab.js — lancer : node --expose-gc gc-lab.js
if (typeof global.gc !== 'function') {
  console.error('Relance avec :  node --expose-gc gc-lab.js');
  process.exit(1);
}

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' Mo';
const heap = () => process.memoryUsage().heapUsed; // tas V8 utilisé : le plus parlant

// ─── Partie 1 : prouver la libération ────────────────────────────────
function partie1() {
  console.log('\n=== Partie 1 — Libération ===');
  global.gc();                       // repartir d'un tas propre
  const baseline = heap();

  let bag = [];
  for (let i = 0; i < 500_000; i++) {
    // objet temporaire type "requête" ; on le pousse puis on jettera tout
    bag.push({ id: i, buf: new Array(10).fill(i) });
  }
  const afterAlloc = heap();         // en forte hausse

  bag = null;                        // on coupe la SEULE arête vers les 500k objets
  global.gc();                       // mark-and-sweep : rien n'est atteignable -> collecté
  const afterGC = heap();            // revient proche de baseline

  console.log(`  baseline    : ${mb(baseline)}`);
  console.log(`  après alloc : ${mb(afterAlloc)}`);
  console.log(`  après GC    : ${mb(afterGC)}   (récupéré : ${mb(afterAlloc - afterGC)})`);
  // Enseignement : bag = null ne libère rien ; c'est global.gc() qui récupère,
  // parce qu'après coup les objets ne sont plus atteignables depuis un root.
}

// ─── Partie 2 : la pause dépend des objets VIVANTS ───────────────────
function partie2() {
  console.log('\n=== Partie 2 — Pause GC vs nb objets vivants ===');
  for (const n of [0, 100_000, 500_000, 1_000_000]) {
    // ces objets RESTENT vivants pendant le GC -> ils doivent tous être marqués
    const live = [];
    for (let i = 0; i < n; i++) live.push({ id: i, m: new Array(20).fill(0) });

    const t0 = performance.now();
    global.gc();                     // Major GC : le mark parcourt tout le graphe vivant
    const pause = performance.now() - t0;

    console.log(`  vivants ${String(n).padStart(9)} | pause ${pause.toFixed(2)} ms`);
    void live.length;                // garde `live` référencé jusqu'ici
  }
  // Enseignement : la pause croît avec le nombre de vivants, pas avec le total alloué.
  // Un gros cache en mémoire FORTE rallonge donc chaque pause -> P99 dégradé.
}

// ─── Partie 3 : Map forte vs WeakMap ─────────────────────────────────
function makeFamilies(count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    arr.push({ id: i, members: new Array(30).fill({ role: 'member' }) });
  }
  return arr;
}

function partie3() {
  console.log('\n=== Partie 3 — Map forte vs WeakMap ===');
  const N = 50_000;

  // Version A : Map FORTE indexée par clé -> retient les familles
  global.gc();
  const baseA = heap();
  let famA = makeFamilies(N);
  const strongMap = new Map();
  for (const f of famA) strongMap.set(f.id, f); // arête forte via la Map
  famA = null;                                   // on coupe le tableau...
  global.gc();
  const afterA = heap();
  console.log(`  Map forte  : +${mb(afterA - baseA)} retenus (strongMap.size=${strongMap.size})`);
  // strongMap garde une arête vers chaque family -> rien n'est collecté.

  // Version B : WeakMap (clé = family) -> n'empêche PAS la collecte
  strongMap.clear();
  global.gc();
  const baseB = heap();
  let famB = makeFamilies(N);
  const weakMeta = new WeakMap();
  for (const f of famB) weakMeta.set(f, { lastAccess: Date.now() }); // clé faible
  famB = null;                                   // seule arête forte coupée
  global.gc();                                   // les familles deviennent collectables
  const afterB = heap();
  console.log(`  WeakMap    : +${mb(afterB - baseB)} retenus (le tas redescend)`);
  // Enseignement : la WeakMap laisse le GC récupérer les familles sans code de nettoyage.
  // La Map forte, elle, causerait le tas qui gonfle indéfiniment en prod.
}

partie1();
partie2();
partie3();
```

Sortie attendue (les chiffres varient selon la machine, l'ordre de grandeur compte) :

```
=== Partie 1 — Libération ===
  baseline    : 2.10 Mo
  après alloc : 58.40 Mo
  après GC    : 2.35 Mo   (récupéré : 56.05 Mo)

=== Partie 2 — Pause GC vs nb objets vivants ===
  vivants         0 | pause 0.40 ms
  vivants    100000 | pause 2.10 ms
  vivants    500000 | pause 8.90 ms
  vivants   1000000 | pause 17.30 ms

=== Partie 3 — Map forte vs WeakMap ===
  Map forte  : +14.20 Mo retenus (strongMap.size=50000)
  WeakMap    : +0.60 Mo retenus (le tas redescend)
```

## Variante J+30 (fading)

Refais le lab **de mémoire, en 20 min**, sans relire le corrigé, avec **une contrainte ajoutée** : remplace la Partie 3 par une comparaison `WeakRef` vs référence forte. Crée un gros objet, garde-le une fois via une variable normale (forte) et une fois via `new WeakRef(obj)`, mets la variable source à `null`, force deux GC espacés d'un `setTimeout(…, 50)`, et montre que `ref.deref()` finit par renvoyer `undefined` dans le cas WeakRef alors que la référence forte survit. Explique au coach pourquoi le timing est non déterministe.

## Application TribuZen

Porte la Partie 3 dans l'API TribuZen (`smaurier/tribuzen`). Le service `families.service.ts` calcule des permissions par `(family, user)`. Implémente `getPermissions(family, user)` avec un `WeakMap` (clé = objet `Family`, valeur = `Map` par `user.id`) au lieu d'une `Map` forte indexée par `family.id`, de sorte qu'aucune famille chargée pour une requête ne soit retenue après la fin du traitement. Ajoute un petit `common/observability/gc-probe.ts` qui, en mode dev/bench uniquement, échantillonne `process.memoryUsage().heapUsed` dans un `setInterval` pendant un run `autocannon` sur `GET /families/:id`, et vérifie que la courbe fait des dents de scie qui **redescendent** (sain) et non un escalier (fuite → module 08). Commit sur `smaurier/tribuzen`, jamais `global.gc()` dans le code de prod.
