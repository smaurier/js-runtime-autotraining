// =============================================================================
// Lab 10 — JIT Deoptimization
// =============================================================================
// Commandes :
//   node --trace-opt --trace-deopt exercise.js
//   node --allow-natives-syntax exercise.js        (pour %GetOptimizationStatus)
//   node --allow-natives-syntax --trace-opt --trace-deopt exercise.js (les deux)
//
// Ce lab explore le cycle optimisation → désoptimisation de TurboFan.
// Vous allez observer comment V8 optimise les fonctions « chaudes » puis
// les désoptimise quand les hypothèses de type sont violées.
// =============================================================================

import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/**
 * Décode le bitmask retourné par %GetOptimizationStatus(fn).
 * Nécessite --allow-natives-syntax.
 * Bits principaux :
 *   1  = fonction is_function
 *   2  = jamais optimisée (never optimized)
 *   4  = toujours optimisée (always optimized)
 *   8  = peut-être désoptimisée (maybe deoptimized)
 *  16  = optimisée (optimized)
 *  32  = optimisée par TurboFan
 *  64  = interprétée (interpreted)
 * 128  = marquée pour optimisation (marked for optimization)
 * 256  = marquée pour optimisation concurrente
 * 512  = en cours d'optimisation concurrente
 */
function describeOptStatus(status: number): string {
  const flags = [];
  if (status & 2)   flags.push('jamais optimisée');
  if (status & 16)  flags.push('OPTIMISÉE');
  if (status & 32)  flags.push('TurboFan');
  if (status & 64)  flags.push('interprétée');
  if (status & 128) flags.push('marquée pour optim.');
  return flags.length > 0 ? flags.join(', ') : `bits: ${status}`;
}

/**
 * Benchmark avec méthodologie correcte : plusieurs runs, on prend la médiane.
 */
function benchmark(name: string, fn: () => any, iterations: number = 1_000_000, runs: number = 5): number {
  // Échauffement
  for (let i = 0; i < 10_000; i++) fn();

  const times = [];
  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    times.push(performance.now() - start);
  }

  // Tri pour obtenir la médiane (plus stable que la moyenne)
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const opsPerSec = ((iterations / median) * 1000).toFixed(0);
  console.log(`  [bench] ${name}: ${median.toFixed(2)} ms médiane (${opsPerSec} ops/sec)`);
  return median;
}

function separator(title: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70) + '\n');
}

// =============================================================================
// PARTIE 1 — Vérifier l'optimisation d'une fonction
// =============================================================================
// Objectif : écrire une fonction, l'appeler 100 000+ fois avec le MÊME type,
// et vérifier :
//   (a) avec --trace-opt dans le terminal → cherchez « [compiling method ... using TurboFan] »
//   (b) avec %GetOptimizationStatus() dans le code (--allow-natives-syntax)
//
// Note : le npm script utilise --trace-opt --trace-deopt. Pour la vérification
// programmatique, ajoutez --allow-natives-syntax à votre commande.
// =============================================================================

separator('PARTIE 1 — Optimisation et vérification');

// TODO 1.1 : Écrivez une fonction `compute(a, b)` qui fait un calcul
// arithmétique simple (par exemple : a * b + a - b). Retournez le résultat.

function compute(a: any, b: any): any {
  // TODO : implémentez un calcul arithmétique
  // 💡 Indice : une opération simple comme a * b + a - b suffit.
  // L'important n'est pas la complexité du calcul mais le fait que V8
  // puisse prédire les types (toujours des entiers → Smi).
}

// TODO 1.2 : Appelez compute 100 000 fois avec des ENTIERS uniquement.
// V8 va observer que a et b sont toujours des Smi et optimiser la fonction.

// TODO : boucle d'échauffement ici (100 000 itérations avec des entiers)
// 💡 Indice : une simple boucle for appelant compute(i, i+1) suffit.
// V8 a besoin de voir la fonction appelée suffisamment de fois pour
// décider de l'optimiser avec TurboFan.

// TODO 1.3 : Si vous exécutez avec --allow-natives-syntax, décommentez les
// lignes ci-dessous pour vérifier programmatiquement l'état d'optimisation.
// Sinon, vérifiez dans la sortie --trace-opt.

// const status = %GetOptimizationStatus(compute);
// console.log(`  compute — statut : ${describeOptStatus(status)}`);
// console.assert(status & 16, 'compute devrait être optimisée après 100k appels');

console.log('  Vérifiez --trace-opt : compute devrait être optimisée');

// =============================================================================
// PARTIE 2 — Trouver les 3 causes de désoptimisation cachées
// =============================================================================
// La fonction `processRecords` ci-dessous est un pipeline de traitement de
// données réaliste. Elle contient 3 erreurs qui provoquent des
// désoptimisations. Votre mission :
//
//   1. Exécutez avec --trace-deopt et lisez la sortie
//   2. Identifiez les 3 causes de désoptimisation
//   3. Notez le numéro de ligne et le type de deopt pour chacune
//
// Les 3 causes sont de natures DIFFÉRENTES :
//   - Une concerne les types des valeurs
//   - Une concerne la forme (hidden class) des objets
//   - Une concerne une opération JavaScript interdite dans le code optimisé
//
// NE MODIFIEZ PAS cette fonction — analysez-la seulement.
// =============================================================================

separator('PARTIE 2 — Trouver les causes de désoptimisation');

/**
 * Pipeline de traitement de données.
 * Reçoit un tableau d'enregistrements et retourne des statistiques.
 */
function processRecords(records: any[]): any {
  let totalRevenue = 0;
  let count = 0;
  let maxRevenue = -Infinity;
  let categories = {};

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Étape 1 : calcul du revenu
    const revenue = record.price * record.quantity;
    totalRevenue += revenue;

    // Étape 2 : suivi du maximum
    if (revenue > maxRevenue) {
      maxRevenue = revenue;
    }

    // Étape 3 : comptage par catégorie
    const cat = record.category;
    if (categories[cat] === undefined) {
      categories[cat] = 0;
    }
    categories[cat] += revenue;

    // Étape 4 : filtrage
    if (record.active) {
      count++;
    }
  }

  return {
    totalRevenue,
    averageRevenue: totalRevenue / count,
    maxRevenue,
    categories,
    activeCount: count,
  };
}

// --- Données d'échauffement : forme cohérente, types stables ---
function createTrainingData(n: number): any[] {
  const cats = ['electronics', 'books', 'clothing'];
  const data = [];
  for (let i = 0; i < n; i++) {
    data.push({
      price: (Math.random() * 100) | 0,    // Entier (Smi)
      quantity: ((Math.random() * 10) | 0) + 1,
      category: cats[i % 3],
      active: true,
    });
  }
  return data;
}

// Échauffement : 100 000 appels pour que TurboFan optimise processRecords
const trainingBatch = createTrainingData(100);
for (let i = 0; i < 100_000; i++) {
  processRecords(trainingBatch);
}
console.log('  processRecords optimisée (100k appels d\'échauffement)');

// --- Maintenant, introduisons les 3 causes de désoptimisation ---

// Lot A : un enregistrement a `price` en string au lieu de number
const lotA = createTrainingData(50);
lotA[25].price = '49.99'; // <-- Cause de deopt #1 : changement de type

// Lot B : un enregistrement a une propriété supplémentaire (hidden class différente)
const lotB = createTrainingData(50);
lotB[30].discount = 0.1;  // <-- Cause de deopt #2 : hidden class différente

// Lot C : un enregistrement utilise un getter (piège pour TurboFan)
const lotC = createTrainingData(50);
Object.defineProperty(lotC[10], 'price', {
  get() { return 42; },   // <-- Cause de deopt #3 : accessor property au lieu de data property
});

// Exécution des lots problématiques
processRecords(lotA);
processRecords(lotB);
processRecords(lotC);

console.log('  3 lots avec défauts exécutés');
console.log('  Exécutez avec --trace-deopt pour voir les 3 désoptimisations');

// TODO 2.1 : Identifiez les 3 causes de désoptimisation. Écrivez-les ici :
// 💡 Indice : dans la sortie --trace-deopt, cherchez les lignes contenant
// "deoptimizing" ou "deopt". Elles mentionnent le nom de la fonction et la
// raison (ex: "wrong map", "not a Smi", "has accessor").
//
// Cause #1 (type)          : ________________________________________
// Ligne approximative      : ________________________________________
// Message --trace-deopt    : ________________________________________
//
// Cause #2 (hidden class)  : ________________________________________
// Ligne approximative      : ________________________________________
// Message --trace-deopt    : ________________________________________
//
// Cause #3 (opération)     : ________________________________________
// Ligne approximative      : ________________________________________
// Message --trace-deopt    : ________________________________________

// =============================================================================
// PARTIE 3 — Corriger le pipeline
// =============================================================================
// Objectif : réécrire processRecords pour qu'elle résiste aux 3 types de
// problèmes identifiés en partie 2, SANS se désoptimiser.
//
// Stratégies possibles :
//   - Convertir explicitement les types (Number(), String(), etc.)
//   - Normaliser la forme des objets AVANT le traitement
//   - Éviter de dépendre de l'absence d'accessors
//
// Vérifiez avec --trace-deopt qu'aucune désoptimisation ne se produit.
// =============================================================================

separator('PARTIE 3 — Pipeline corrigé');

// TODO 3.1 : Écrivez `processRecordsSafe(records)` qui :
//   - Produit le même résultat que processRecords
//   - Ne se désoptimise PAS quand on passe les lots A, B, C
//   - Reste performante (pas de copie inutile de tous les objets)

function processRecordsSafe(records: any[]): any {
  // TODO : implémentez le pipeline corrigé
  // 💡 Indice : pour chaque record, convertissez price avec Number(record.price)
  // avant de l'utiliser. Cela « normalise » le type et évite la deopt #1.
  // Pour la hidden class (#2), vous pouvez accéder aux propriétés de façon
  // défensive (avec 'in' ou des valeurs par défaut).
  // Pour l'accessor (#3), lire la valeur une seule fois dans une variable locale.
}

// TODO 3.2 : Testez avec les mêmes lots problématiques
// Échauffement
// for (let i = 0; i < 100_000; i++) processRecordsSafe(trainingBatch);
// processRecordsSafe(lotA);
// processRecordsSafe(lotB);
// processRecordsSafe(lotC);
// console.log('  processRecordsSafe exécutée sur les 3 lots sans deopt');

// =============================================================================
// PARTIE 4 — Benchmark : original vs corrigé
// =============================================================================
// Objectif : mesurer concrètement la différence de performance entre
// la version qui se désoptimise et la version corrigée.
//
// Méthodologie :
//   - Plusieurs runs (5 minimum) pour chaque version
//   - Prendre la MÉDIANE (pas la moyenne — elle est sensible aux outliers)
//   - Comparer sur les mêmes données
//   - Forcer un GC entre les benchmarks pour éviter les interférences
// =============================================================================

separator('PARTIE 4 — Benchmark original vs corrigé');

// TODO 4.1 : Créez des données de benchmark (1 000 enregistrements, cohérents)
// const benchData = createTrainingData(1_000);

// TODO 4.2 : Benchmarkez processRecords (elle a déjà été désoptimisée)
// const timeOriginal = benchmark('processRecords (désoptimisée)', () => processRecords(benchData), 10_000);

// TODO 4.3 : Benchmarkez processRecordsSafe (après échauffement propre)
// const timeSafe = benchmark('processRecordsSafe (stable)', () => processRecordsSafe(benchData), 10_000);

// TODO 4.4 : Affichez le ratio
// console.log(`\n  Ratio original/corrigé : ${(timeOriginal / timeSafe).toFixed(2)}x`);
// console.log('  La version stable devrait être sensiblement plus rapide');
// console.log('  car TurboFan maintient le code optimisé.');

console.log('  TODO : Implémentez le benchmark ci-dessus');

console.log('\n=== Lab 10 terminé ===');
