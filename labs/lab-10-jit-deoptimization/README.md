# Lab 10 — Provoquer et corriger une déoptimisation JIT

> **Outcome :** à la fin, tu sais provoquer une déoptimisation sur une fonction chaude, la lire dans `--trace-deopt`, stabiliser les types pour l'éliminer, et mesurer le gain.
> **Vrai outil :** Node.js + les flags V8 `--trace-opt` / `--trace-deopt` / `--allow-natives-syntax`, et `performance.now()`. Aucun harnais de test simulé.
> **Feedback :** le coach valide en session à la lecture de tes traces et de ton benchmark (pas de test-runner auto-correcteur).

## Énoncé

Tu reprends la fonction de scoring du cœur de l'API TribuZen (endpoint `GET /families/:id/ranking`). Elle est appelée une fois par membre, à chaque requête — c'est une **hot function**. En prod, l'endpoint est 4x trop lent, et le diagnostic montre une déoptimisation en boucle.

Ta mission : reproduire la deopt, l'observer, la corriger, la mesurer.

Starter minimal (crée `scoring-deopt.mjs` dans ce dossier) :

```js
// scoring-deopt.mjs — starter
// Cœur de scoring TribuZen : classe les membres par activité.
export function computeScore(base, bonus) {
  return base + bonus * 1.5;
}

// Simule une source de données HÉTÉROGÈNE :
// - la BDD renvoie des number
// - les imports CSV / formulaires renvoient des string
export function buildRows(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: i,
      base: i % 50 === 0 ? String(i) : i,   // 1 ligne sur 50 est une string
      bonus: i % 3,
    });
  }
  return rows;
}
```

Commandes de référence :

```bash
# Observer optimisation + déoptimisation
node --trace-opt --trace-deopt scoring-deopt.mjs

# Inspecter l'état d'optimisation d'une fonction précise
node --allow-natives-syntax scoring-deopt.mjs
```

## Étapes (en friction)

1. **Chauffe et optimise.** Écris une boucle qui appelle `computeScore(Number(...), Number(...))` 200 000 fois avec des types **stables** (tout en `Number`). Lance avec `--trace-opt` et repère la ligne `completed optimizing … computeScore`. Note à partir de combien d'appels elle apparaît.
2. **Provoque la deopt.** Fais consommer `buildRows(200_000)` à `computeScore` **sans** normaliser (`computeScore(row.base, row.bonus)`). Lance avec `--trace-opt --trace-deopt`. Trouve la ligne `deoptimizing (DEOPT eager) … computeScore` et lis la **raison** + la **position** `fichier:ligne:colonne`.
3. **Nomme la cause.** Écris en une phrase pourquoi la deopt se produit (quel opérande, quel type inattendu, à quelle ligne).
4. **Corrige.** Normalise les types **à la frontière** (dans le map qui construit les scores), pas dans `computeScore`. Relance : `--trace-deopt` ne doit plus produire aucune ligne pour `computeScore`.
5. **Mesure.** Avec `performance.now()`, chronomètre 200 000 scorings en version instable puis en version stabilisée. Vise un écart mesurable (≥ 2x). Écris les deux nombres.
6. **Bonus.** Avec `--allow-natives-syntax` et `%GetOptimizationStatus`, confirme que la version stabilisée reste `optimized` après la boucle, et que la version instable ne l'est pas.

## Corrigé complet commenté

```js
// scoring-deopt.mjs — corrigé complet
// Lancer les diagnostics :
//   node --trace-opt --trace-deopt scoring-deopt.mjs
//   node --allow-natives-syntax scoring-deopt.mjs   (pour le bonus)

// ─── La hot function : cœur de scoring TribuZen ──────────────────
export function computeScore(base, bonus) {
  // Spéculée par TurboFan sur (Number, Number). Un guard vérifie le type
  // de base et de bonus ; s'il échoue → DEOPT eager "not a Number".
  return base + bonus * 1.5;
}

// ─── Source hétérogène : 1 ligne sur 50 a un `base` en string ─────
function buildRows(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: i,
      base: i % 50 === 0 ? String(i) : i,   // pollue le type de base
      bonus: i % 3,
    });
  }
  return rows;
}

const N = 200_000;
const rows = buildRows(N);

// ─── ÉTAPE 2 — version INSTABLE : provoque la deopt ──────────────
// computeScore voit tantôt Number, tantôt String → le guard casse en boucle.
function rankUnstable(rows) {
  const out = [];
  for (const r of rows) {
    out.push({ id: r.id, score: computeScore(r.base, r.bonus) });
    //                                        ^^^^^^  parfois string → DEOPT
  }
  return out;
}

// ─── ÉTAPE 4 — version STABLE : normalise à la frontière ─────────
// Number() une seule fois, AVANT le hot path. computeScore ne voit que des Number.
function rankStable(rows) {
  const out = [];
  for (const r of rows) {
    const base = Number(r.base);    // "120" → 120 en périphérie
    const bonus = Number(r.bonus);
    out.push({ id: r.id, score: computeScore(base, bonus) });
  }
  return out;
}

// ─── ÉTAPE 5 — benchmark ─────────────────────────────────────────
function bench(label, fn) {
  fn(rows);                          // 1er run : chauffe (compilation JIT)
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) fn(rows);
  const dt = performance.now() - t0;
  console.log(`${label} : ${dt.toFixed(1)} ms pour 20 passes`);
  return dt;
}

const dtUnstable = bench('instable', rankUnstable);
const dtStable = bench('stable  ', rankStable);
console.log(`gain : x${(dtUnstable / dtStable).toFixed(2)}`);

// ─── ÉTAPE 6 (bonus) — statut d'optimisation ─────────────────────
// N'exécuter que sous --allow-natives-syntax (sinon SyntaxError).
// Décommente le bloc suivant pour le bonus :
//
//   %OptimizeFunctionOnNextCall(computeScore);
//   computeScore(1, 2);
//   const OPTIMIZED = 0b10;
//   console.log('optimisée ?', (%GetOptimizationStatus(computeScore) & OPTIMIZED) !== 0);
```

**Lecture attendue de la trace (étape 2)** :

```
[completed optimizing … <JSFunction computeScore>]
[deoptimizing (DEOPT eager): begin … <JSFunction computeScore>]
    ;;; deoptimize at <scoring-deopt.mjs:8:10>, reason: not a Number
[deoptimizing (DEOPT eager): end … -> interpreter]
```

**Cause (étape 3)** : à la ligne du `base + …`, l'opérande `base` est parfois une `String` (1 ligne sur 50). Le guard `check_number` échoue → déoptimisation eager. En boucle, la fonction ne reste jamais optimisée → latence 4x.

**Résultat attendu (étape 5)** : la version stabilisée est nettement plus rapide (souvent ≥ 2x sur ce volume), car `computeScore` reste dans le code machine TurboFan sans jamais deopt.

## Variante J+30 (fading)

Refais le lab **de mémoire, en 20 minutes**, avec deux contraintes ajoutées :

1. Cette fois la deopt n'est **pas** un changement de type primitif mais un **changement de forme d'objet** : `computeScore(member)` lit `member.base`, et une partie des `member` ont une propriété `extra` en plus. Provoque la deopt `wrong map`, lis-la, corrige en garantissant une forme d'objet unique (mêmes clés, même ordre) sur tous les membres.
2. Interdiction d'utiliser `--allow-natives-syntax` : tu dois **prouver** l'optimisation puis la deopt uniquement par lecture de `--trace-opt --trace-deopt`.

## Application TribuZen

Porte la correction dans le vrai produit, `smaurier/tribuzen` :

- `tribuzen/api/src/families/scoring.ts` — `computeScore` reste une hot function pure, typée `(base: number, bonus: number) => number`. Aucune coercition dedans.
- `tribuzen/api/src/families/ranking.controller.ts` — normalise les types **une fois**, en périphérie : `Number(row.base)` / `Number(row.bonus)` (ou un DTO validé par `class-validator` / `zod`) avant d'atteindre le scoring.
- Ajoute un micro-bench dans `tribuzen/api/bench/scoring.bench.ts` qui mesure 200 000 scorings et échoue si le ratio instable/stable dépasse un seuil — filet anti-régression.

Commit type : `perf(scoring): stabilise les types de computeScore pour éviter la déopt JIT` sur `smaurier/tribuzen`.
