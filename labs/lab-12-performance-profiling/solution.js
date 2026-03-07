// =============================================================================
// Lab 12 — Performance Profiling — SOLUTION
// =============================================================================
// Commande : node --prof solution.js
//            node --prof-process isolate-0x*.log > profile-report-fast.txt
//
// Cette solution corrige les 4 goulots d'etranglement, instrumente le code
// avec performance.mark/measure, et genere un rapport de synthese complet.
// =============================================================================

import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DATA_DIR = join(__dirname, '_temp_data');
const NUM_ITEMS = 500;
const FIB_N = 30;

// Creer les fichiers temporaires
function setupTempFiles() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  for (let i = 0; i < 10; i++) {
    const data = JSON.stringify({
      id: i,
      name: `config_${i}`,
      values: Array.from({ length: 100 }, (_, j) => j * i),
      settings: { threshold: i * 10, enabled: true, mode: 'auto' },
    });
    writeFileSync(join(DATA_DIR, `data_${i}.json`), data);
  }
}

setupTempFiles();

// =============================================================================
// VERSIONS LENTES (pour comparaison avant/apres)
// =============================================================================

function slowFibonacci(n) {
  if (n <= 1) return n;
  return slowFibonacci(n - 1) + slowFibonacci(n - 2);
}

function slowBuildReport(items) {
  let report = '';
  for (let i = 0; i < items.length; i++) {
    report += `[${String(i).padStart(4, '0')}] `;
    report += `Item: ${items[i].name} | `;
    report += `Value: ${items[i].value} | `;
    report += `Fib: ${items[i].fib} | `;
    report += `Status: ${items[i].status}\n`;
  }
  return report;
}

function slowTransformData(items) {
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const copy = JSON.parse(JSON.stringify(items[i]));
    copy.processed = true;
    copy.timestamp = Date.now();
    results.push(copy);
  }
  return results;
}

function slowLoadConfigs() {
  const configs = [];
  for (let i = 0; i < 10; i++) {
    const raw = readFileSync(join(DATA_DIR, `data_${i}.json`), 'utf-8');
    const parsed = JSON.parse(raw);
    configs.push(parsed);
  }
  return configs;
}

// =============================================================================
// CORRECTION 1 — Fibonacci iteratif
// =============================================================================
// POURQUOI la version recursive naive est lente :
// slowFibonacci(30) genere environ 2^30 appels recursifs (~1 milliard).
// Chaque appel empile un frame sur la call stack, alloue des registres,
// et recalcule des valeurs deja calculees. Par exemple, fib(15) est
// calcule ~32 768 fois pendant le calcul de fib(30). C'est du gaspillage
// pur de CPU et de memoire.
//
// POURQUOI la version iterative est rapide :
// Elle calcule chaque valeur UNE SEULE FOIS en maintenant les deux
// valeurs precedentes dans des variables locales. La complexite passe
// de O(2^n) a O(n) avec O(1) memoire.
// Pour n=30 : 30 iterations au lieu de ~1 milliard d'appels.

function fastFibonacci(n) {
  if (n <= 1) return n;
  let prev = 0;
  let curr = 1;
  for (let i = 2; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }
  return curr;
}

// Alternative educative : version avec memoisation
// Aussi O(n) mais utilise O(n) memoire pour le cache.
// Utile quand on appelle fib() avec differentes valeurs de n.
function memoFibonacci(n, cache = new Map()) {
  if (n <= 1) return n;
  if (cache.has(n)) return cache.get(n);
  const result = memoFibonacci(n - 1, cache) + memoFibonacci(n - 2, cache);
  cache.set(n, result);
  return result;
}

// =============================================================================
// CORRECTION 2 — Rapport avec Array.join
// =============================================================================
// POURQUOI += est lent pour la concatenation de chaines :
// Les chaines JavaScript sont IMMUTABLES. Chaque `report += str` :
//   1. Alloue une nouvelle chaine de taille (report.length + str.length)
//   2. Copie TOUT le contenu de report dans la nouvelle chaine
//   3. Copie str a la fin
//   4. L'ancienne report est abandonnee au GC
//
// Sur 500 items avec 5 concatenations par item :
//   Total de bytes copies = sum(80*k for k=1..2500) = ~250 000 000 bytes
//   C'est O(n^2) en allocation memoire, une pression enorme sur le GC.
//
// POURQUOI Array.join est rapide :
// Array.push() est O(1) amorti (pas de copie de chaine, juste un pointeur).
// join('') parcourt le tableau UNE FOIS, calcule la taille totale,
// fait UNE SEULE allocation, et copie chaque partie. C'est O(n).

function fastBuildReport(items) {
  const parts = [];
  for (let i = 0; i < items.length; i++) {
    parts.push(
      `[${String(i).padStart(4, '0')}] `,
      `Item: ${items[i].name} | `,
      `Value: ${items[i].value} | `,
      `Fib: ${items[i].fib} | `,
      `Status: ${items[i].status}\n`
    );
  }
  return parts.join('');
}

// =============================================================================
// CORRECTION 3 — Copie superficielle au lieu de JSON
// =============================================================================
// POURQUOI JSON.parse(JSON.stringify(obj)) est lent :
//   1. JSON.stringify parcourt TOUTE la structure, convertit chaque valeur
//      en representation textuelle, echappe les caracteres speciaux, et
//      alloue la chaine resultante.
//   2. JSON.parse re-lit la chaine caractere par caractere, valide la
//      syntaxe, cree de NOUVEAUX objets et chaines JavaScript.
//   3. Pour un objet simple { name, value, fib, status }, c'est ~100x
//      plus de travail que necessaire.
//
// POURQUOI la copie superficielle suffit ici :
// Les objets items ne contiennent que des PRIMITIVES (string, number).
// Les primitives sont immutables en JavaScript, donc copier leur reference
// est identique a une copie profonde. Le spread { ...obj } copie les
// references en O(k) ou k est le nombre de proprietes (4 ici).
//
// OPTIMISATION SUPPLEMENTAIRE : Date.now() est appele UNE SEULE FOIS
// hors de la boucle au lieu de 500 fois dans la boucle.

function fastTransformData(items) {
  const results = [];
  const now = Date.now(); // Un seul appel au lieu de N
  for (let i = 0; i < items.length; i++) {
    results.push({
      ...items[i],       // Copie superficielle O(k) au lieu de O(n) JSON
      processed: true,
      timestamp: now,
    });
  }
  return results;
}

// =============================================================================
// CORRECTION 4 — Cache de fichiers en memoire
// =============================================================================
// POURQUOI la lecture synchrone repetee est lente :
// Chaque readFileSync fait un syscall qui :
//   1. Passe du user space au kernel space (context switch ~1-5 us)
//   2. Le kernel verifie le page cache ou lit depuis le disque
//   3. Copie les donnees du kernel buffer vers le user buffer
//   4. Repasse en user space
// Meme avec le fichier en cache OS, le syscall prend 1-10 microsecondes.
// Sur 50 repetitions x 10 fichiers = 500 syscalls = 0.5-5 ms minimum.
//
// POURQUOI le cache en memoire est rapide :
// L'acces a une Map JavaScript est ~10 nanosecondes (1000x plus rapide).
// On lit chaque fichier UNE SEULE FOIS au premier appel, et on retourne
// la version cachee pour tous les appels suivants.

const configCache = new Map();

function fastLoadConfigs() {
  if (configCache.size === 0) {
    for (let i = 0; i < 10; i++) {
      const raw = readFileSync(join(DATA_DIR, `data_${i}.json`), 'utf-8');
      const parsed = JSON.parse(raw);
      configCache.set(i, parsed);
    }
  }
  return Array.from(configCache.values());
}

// =============================================================================
// PIPELINE LENT (reference)
// =============================================================================

function runSlowPipeline() {
  console.log('=== Pipeline LENT ===');
  const totalStart = performance.now();

  performance.mark('slow-fib-start');
  const items = [];
  for (let i = 0; i < NUM_ITEMS; i++) {
    items.push({
      name: `product_${i}`,
      value: i * 10,
      fib: slowFibonacci(FIB_N),
      status: i % 2 === 0 ? 'active' : 'inactive',
    });
  }
  performance.mark('slow-fib-end');
  performance.measure('LENT - Fibonacci', 'slow-fib-start', 'slow-fib-end');

  performance.mark('slow-transform-start');
  const transformed = slowTransformData(items);
  performance.mark('slow-transform-end');
  performance.measure('LENT - Transform JSON', 'slow-transform-start', 'slow-transform-end');

  performance.mark('slow-report-start');
  const report = slowBuildReport(transformed);
  performance.mark('slow-report-end');
  performance.measure('LENT - Build Report', 'slow-report-start', 'slow-report-end');

  performance.mark('slow-io-start');
  for (let i = 0; i < 50; i++) {
    slowLoadConfigs();
  }
  performance.mark('slow-io-end');
  performance.measure('LENT - Load Configs (50x)', 'slow-io-start', 'slow-io-end');

  const totalEnd = performance.now();
  const totalMs = totalEnd - totalStart;
  console.log(`  Temps total lent : ${totalMs.toFixed(2)} ms\n`);

  return { items: items.length, reportLen: report.length, totalMs };
}

// =============================================================================
// PIPELINE RAPIDE
// =============================================================================

function runFastPipeline() {
  console.log('=== Pipeline RAPIDE ===');
  const totalStart = performance.now();

  performance.mark('fast-fib-start');
  const items = [];
  for (let i = 0; i < NUM_ITEMS; i++) {
    items.push({
      name: `product_${i}`,
      value: i * 10,
      fib: fastFibonacci(FIB_N),
      status: i % 2 === 0 ? 'active' : 'inactive',
    });
  }
  performance.mark('fast-fib-end');
  performance.measure('RAPIDE - Fibonacci', 'fast-fib-start', 'fast-fib-end');

  performance.mark('fast-transform-start');
  const transformed = fastTransformData(items);
  performance.mark('fast-transform-end');
  performance.measure('RAPIDE - Transform', 'fast-transform-start', 'fast-transform-end');

  performance.mark('fast-report-start');
  const report = fastBuildReport(transformed);
  performance.mark('fast-report-end');
  performance.measure('RAPIDE - Build Report', 'fast-report-start', 'fast-report-end');

  performance.mark('fast-io-start');
  for (let i = 0; i < 50; i++) {
    fastLoadConfigs();
  }
  performance.mark('fast-io-end');
  performance.measure('RAPIDE - Load Configs (50x)', 'fast-io-start', 'fast-io-end');

  const totalEnd = performance.now();
  const totalMs = totalEnd - totalStart;
  console.log(`  Temps total rapide : ${totalMs.toFixed(2)} ms\n`);

  return { items: items.length, reportLen: report.length, totalMs };
}

// =============================================================================
// EXECUTION ET COMPARAISON
// =============================================================================

const slowResult = runSlowPipeline();
const fastResult = runFastPipeline();

// Afficher les mesures detaillees
console.log('=== Mesures detaillees ===\n');

const measures = performance.getEntriesByType('measure');
const slowMeasures = measures.filter(m => m.name.startsWith('LENT'));
const fastMeasures = measures.filter(m => m.name.startsWith('RAPIDE'));

console.log('  Pipeline LENT :');
for (const m of slowMeasures) {
  console.log(`    ${m.name}: ${m.duration.toFixed(2)} ms`);
}

console.log('\n  Pipeline RAPIDE :');
for (const m of fastMeasures) {
  console.log(`    ${m.name}: ${m.duration.toFixed(2)} ms`);
}

// Comparaison par etape
console.log('\n=== Comparaison etape par etape ===\n');

const stageNames = ['Fibonacci', 'Transform', 'Build Report', 'Load Configs'];
for (const stage of stageNames) {
  const slow = slowMeasures.find(m => m.name.includes(stage));
  const fast = fastMeasures.find(m => m.name.includes(stage));
  if (slow && fast) {
    const ratio = slow.duration / Math.max(fast.duration, 0.001);
    console.log(`  ${stage}:`);
    console.log(`    Lent: ${slow.duration.toFixed(2)} ms → Rapide: ${fast.duration.toFixed(2)} ms`);
    console.log(`    Amelioration : ${ratio.toFixed(1)}x`);
  }
}

const totalRatio = slowResult.totalMs / Math.max(fastResult.totalMs, 0.001);
console.log(`\n  TOTAL : ${slowResult.totalMs.toFixed(2)} ms → ${fastResult.totalMs.toFixed(2)} ms`);
console.log(`  Amelioration globale : ${totalRatio.toFixed(1)}x`);

// =============================================================================
// RAPPORT DE SYNTHESE
// =============================================================================
// POURQUOI documenter les optimisations :
// Le profiling est une activite empirique. Sans mesures et documentation,
// les decisions d'optimisation deviennent des "mythes" transmis sans preuves.
// Le rapport permet de :
// 1. Prouver que l'optimisation a un impact REEL et MESURE
// 2. Expliquer POURQUOI l'ancienne version etait lente (pour eviter la regression)
// 3. Partager les connaissances avec l'equipe

console.log('\n=== RAPPORT D\'OPTIMISATION ===\n');

console.log('1. FIBONACCI RECURSIF → ITERATIF');
console.log('   Probleme : complexite O(2^n), ~1 milliard d\'appels recursifs pour n=30');
console.log('   Solution : boucle iterative O(n), seulement 30 iterations');
console.log('   Pourquoi ca marche : chaque sous-probleme est calcule exactement 1 fois');
console.log();

console.log('2. CONCATENATION DE CHAINES → ARRAY.JOIN');
console.log('   Probleme : += copie la chaine entiere a chaque iteration → O(n^2) bytes copies');
console.log('   Solution : Array.push() O(1) amorti + join() avec 1 seule allocation');
console.log('   Pourquoi ca marche : les chaines sont immutables, Array.push ne copie rien');
console.log();

console.log('3. JSON.PARSE/STRINGIFY → COPIE SUPERFICIELLE (spread)');
console.log('   Probleme : serialisation + parsing complet pour copier des primitives');
console.log('   Solution : { ...obj } copie les references des primitives directement');
console.log('   Pourquoi ca marche : les primitives sont immutables, pas besoin de deep copy');
console.log();

console.log('4. LECTURE SYNCHRONE REPETEE → CACHE EN MEMOIRE');
console.log('   Probleme : syscall read() bloquant a chaque appel (context switch kernel)');
console.log('   Solution : lire 1 fois, cacher dans une Map, retourner le cache');
console.log('   Pourquoi ca marche : acces Map ~10 ns vs syscall ~1-10 us (1000x plus rapide)');
console.log();

console.log('CONCLUSION GENERALE :');
console.log('Le profiling avec --prof identifie objectivement les fonctions les plus couteuses.');
console.log('Les corrections ciblent : complexite algorithmique (O(2^n) → O(n)),');
console.log('allocations inutiles (chaines immutables), operations superflues (JSON),');
console.log('et I/O repetees (syscalls). Resultat : 10-1000x plus rapide selon la charge.');

// Nettoyage
try {
  rmSync(DATA_DIR, { recursive: true, force: true });
} catch {
  // Ignorer les erreurs de nettoyage
}

console.log('\n=== Lab 12 termine ===');
