// =============================================================================
// Lab 12 — Performance Profiling
// =============================================================================
// Commande : node --prof exercise.js
//            node --prof-process isolate-0x*.log > profile-report.txt
//
// Ce programme est DELIBEREMENT LENT. Il contient 4 goulots d'etranglement
// que vous devez identifier avec le profiler V8, corriger, puis mesurer.
// =============================================================================

import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

// Creer le repertoire et les fichiers temporaires pour le lab
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
// GOULOT 1 — Fibonacci recursif (complexite exponentielle O(2^n))
// =============================================================================
// Cette fonction calcule le Neme nombre de Fibonacci de maniere recursive
// naive. Elle recalcule les memes sous-problemes des millions de fois.
// Pour n=30, ca genere environ 2^30 = ~1 milliard d'appels recursifs.

function slowFibonacci(n) {
  if (n <= 1) return n;
  return slowFibonacci(n - 1) + slowFibonacci(n - 2);
}

// =============================================================================
// GOULOT 2 — Concatenation de chaines avec += en boucle
// =============================================================================
// En JavaScript, les chaines sont IMMUTABLES. Chaque += cree une NOUVELLE
// chaine et copie tout le contenu precedent plus la nouvelle partie.
// Sur N iterations, le volume de copies est O(n^2).

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

// =============================================================================
// GOULOT 3 — JSON.parse/stringify dans le chemin chaud
// =============================================================================
// Cette fonction utilise JSON.parse(JSON.stringify(...)) pour "copier"
// chaque element. C'est extremement couteux : serialisation complete en
// chaine JSON puis re-parsing caractere par caractere.

function slowTransformData(items) {
  const results = [];
  for (let i = 0; i < items.length; i++) {
    // Copie profonde via JSON — tres couteux dans une boucle chaude
    const copy = JSON.parse(JSON.stringify(items[i]));
    copy.processed = true;
    copy.timestamp = Date.now();
    results.push(copy);
  }
  return results;
}

// =============================================================================
// GOULOT 4 — Lecture synchrone de fichiers dans une boucle
// =============================================================================
// Cette fonction lit des fichiers JSON de maniere synchrone a CHAQUE appel.
// Le syscall read est bloquant : user space → kernel → disk → kernel → user.
// Sur 50 repetitions x 10 fichiers = 500 lectures synchrones.

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
// PIPELINE PRINCIPAL — combine les 4 goulots
// =============================================================================

function runSlowPipeline() {
  console.log('--- Demarrage du pipeline lent ---');
  const totalStart = performance.now();

  // Etape 1 : Calcul de Fibonacci pour chaque element
  performance.mark('fib-start');
  const items = [];
  for (let i = 0; i < NUM_ITEMS; i++) {
    items.push({
      name: `product_${i}`,
      value: i * 10,
      fib: slowFibonacci(FIB_N),
      status: i % 2 === 0 ? 'active' : 'inactive',
    });
  }
  performance.mark('fib-end');
  performance.measure('Fibonacci', 'fib-start', 'fib-end');

  // Etape 2 : Transformation des donnees avec JSON
  performance.mark('transform-start');
  const transformed = slowTransformData(items);
  performance.mark('transform-end');
  performance.measure('Transform JSON', 'transform-start', 'transform-end');

  // Etape 3 : Construction du rapport par concatenation
  performance.mark('report-start');
  const report = slowBuildReport(transformed);
  performance.mark('report-end');
  performance.measure('Build Report', 'report-start', 'report-end');

  // Etape 4 : Chargement repete des configs depuis le disque
  performance.mark('io-start');
  for (let i = 0; i < 50; i++) {
    slowLoadConfigs();
  }
  performance.mark('io-end');
  performance.measure('Load Configs (50x)', 'io-start', 'io-end');

  const totalEnd = performance.now();
  const totalMs = (totalEnd - totalStart).toFixed(2);

  console.log(`\nResultats : ${items.length} items, rapport de ${report.length} caracteres`);
  console.log(`Temps total pipeline lent : ${totalMs} ms\n`);

  return { items, report, totalMs };
}

// =============================================================================
// PARTIE 1 — Profiler et identifier les goulots
// =============================================================================
// TODO 1.1 : Lancez le programme avec `node --prof exercise.js`
// TODO 1.2 : Analysez le rapport avec `node --prof-process isolate-0x*.log`
// TODO 1.3 : Identifiez les 4 fonctions les plus couteuses dans la section
//            [JavaScript] du rapport.
//
// Vos observations (a remplir apres lecture du rapport) :
// Goulot 1 : _________________________ (____% du temps)
// Goulot 2 : _________________________ (____% du temps)
// Goulot 3 : _________________________ (____% du temps)
// Goulot 4 : _________________________ (____% du temps)

// Lancer le pipeline lent
const slowResult = runSlowPipeline();

// Afficher les mesures performance.measure
const entries = performance.getEntriesByType('measure');
console.log('--- Mesures detaillees (pipeline lent) ---');
for (const entry of entries) {
  console.log(`  ${entry.name}: ${entry.duration.toFixed(2)} ms`);
}

// =============================================================================
// PARTIE 2 — Corriger les goulots d'etranglement
// =============================================================================
// Pour chaque goulot, ecrivez une version optimisee.

// TODO 2.1 : Fibonacci — remplacez la recursion naive par :
//   (a) une version iterative, OU
//   (b) une version avec memoisation (cache des resultats)
// POURQUOI : la recursion naive recalcule fib(15) des millions de fois.
// La version iterative fait n iterations. La memoisation fait n appels max.

function fastFibonacci(n) {
  // TODO : implementez la version rapide
  // Option A — Version iterative :
  //   Utilisez deux variables (prev, curr) et une boucle for.
  //   A chaque iteration, calculez le prochain nombre.
  // Option B — Version memoisation :
  //   Utilisez une Map comme cache des resultats deja calcules.
  //
  // 💡 Indice (version iterative) : a chaque iteration i,
  //    le nouveau curr = ancien prev + ancien curr.
  //    Puis prev prend l'ancienne valeur de curr.
}

// TODO 2.2 : String concat — remplacez += par un tableau + join
// POURQUOI : Array.push est O(1) amorti, et join() fait UNE SEULE
// allocation de la taille totale a la fin.

function fastBuildReport(items) {
  // TODO : utilisez un tableau `parts` avec push() et join('') a la fin
  // 💡 Indice : const parts = []; ... parts.push(`texte`); ... return parts.join('');
  //    Array.push est O(1) amorti, et join fait UNE SEULE allocation finale.
}

// TODO 2.3 : JSON — evitez JSON.parse/stringify dans le chemin chaud
// POURQUOI : les objets items ne contiennent que des primitives (string,
// number). Le spread { ...obj } ou Object.assign suffit pour copier.

function fastTransformData(items) {
  // TODO : copie superficielle avec le spread operator au lieu de JSON
  // 💡 Indice : { ...items[i], processed: true, timestamp: Date.now() }
  //    Le spread operator copie les proprietes sans serialiser en JSON.
}

// TODO 2.4 : I/O — lisez les fichiers UNE SEULE FOIS et cachez le resultat
// POURQUOI : un acces Map en memoire est ~1000x plus rapide qu'un syscall.

function fastLoadConfigs() {
  // TODO : implementez un cache (variable en dehors de la fonction)
  // Premiere invocation : lire les fichiers et stocker le resultat
  // Invocations suivantes : retourner le cache directement
  // 💡 Indice : declarez `let configCache = null;` AVANT cette fonction.
  //    Dans la fonction : if (configCache) return configCache;
  //    Sinon, lisez les fichiers, stockez dans configCache, et retournez.
}

// =============================================================================
// PARTIE 3 — Pipeline optimise avec instrumentation
// =============================================================================
// TODO 3.1 : Ecrivez runFastPipeline() en utilisant les fonctions fast*.
// TODO 3.2 : Ajoutez des performance.mark/measure pour chaque etape.
// TODO 3.3 : Comparez les durees avec le pipeline lent.

function runFastPipeline() {
  // TODO : meme logique que runSlowPipeline mais avec les fonctions fast*
  // Utilisez performance.mark('fast-fib-start') / mark('fast-fib-end')
  // et performance.measure('Fast Fibonacci', ...) pour chaque etape.
}

// TODO : Une fois les fonctions fast* implementees, ecrivez le code
//        pour executer le pipeline rapide et afficher les mesures.
//   Etapes :
//   1. Appelez performance.clearMarks() et performance.clearMeasures()
//   2. Appelez runFastPipeline() et stockez le resultat
//   3. Recuperez les mesures avec performance.getEntriesByType('measure')
//   4. Affichez chaque mesure avec entry.name et entry.duration
//
// 💡 Indice : clearMarks/clearMeasures reinitialise les compteurs
//    pour ne pas melanger les mesures du pipeline lent avec le rapide.

// =============================================================================
// PARTIE 4 — Rapport de synthese
// =============================================================================
// TODO 4 : Completez le rapport ci-dessous avec vos mesures reelles.
//
// RAPPORT D'OPTIMISATION
// =======================
//
// | Etape        | Avant (ms) | Apres (ms) | Amelioration | Technique utilisee      |
// |--------------|-----------|-----------|--------------|-------------------------|
// | Fibonacci    | _________ | _________ | _________x   | ________________________ |
// | Transform    | _________ | _________ | _________x   | ________________________ |
// | Build Report | _________ | _________ | _________x   | ________________________ |
// | Load Configs | _________ | _________ | _________x   | ________________________ |
// | TOTAL        | _________ | _________ | _________x   |                          |
//
// Conclusions :
// 1. _______________________________________________________________
// 2. _______________________________________________________________
// 3. _______________________________________________________________

// Nettoyage des fichiers temporaires
import { rmSync } from 'node:fs';
try {
  rmSync(DATA_DIR, { recursive: true, force: true });
} catch {
  // Ignorer les erreurs de nettoyage
}

console.log('\n=== Lab 12 termine ===');
