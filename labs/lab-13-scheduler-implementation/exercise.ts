// =============================================================================
// Lab 13 — Scheduler Implementation
// =============================================================================
// Commande : npx tsx exercise.ts
//
// Ce lab vous demande d'implementer un ordonnanceur cooperatif, un rate limiter,
// debounce/throttle, et une file de priorite avec preemption.
// =============================================================================

import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------------------
// Utilitaires fournis
// ---------------------------------------------------------------------------

/** Pause asynchrone */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ceder le controle a la boucle d'evenements */
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Compteur d'ID auto-incremente */
let _nextId = 1;
function nextId(): number {
  return _nextId++;
}

// =============================================================================
// PARTIE 1 — Scheduler cooperatif avec time-slicing
// =============================================================================
// Objectif : implementer un ordonnanceur qui :
//   - accepte des taches avec 3 niveaux de priorite (high, medium, low)
//   - execute les taches high avant medium avant low
//   - cede le controle a l'event loop (yield) apres max 5ms de travail CPU
//   - permet l'annulation d'une tache via cancel(taskId)
//
// Le time-slicing signifie : si une tache s'execute depuis plus de 5ms,
// on pause et on cede au loop avant de continuer. Pour simplifier,
// chaque "tache" est une fonction synchrone. On verifie le temps
// ENTRE les taches (pas a l'interieur d'une tache).
// =============================================================================

class CooperativeScheduler {
  constructor() {
    // TODO : Initialisez les structures de donnees
    // Suggerees :
    //   this._queues = { high: [], medium: [], low: [] }
    //   this._tasks = new Map()  // taskId → { fn, priority, cancelled }
    //   this._timeSliceMs = 5
    // 💡 Indice : 3 files separees permettent de toujours traiter les high
    //    avant les medium, et les medium avant les low.
  }

  /**
   * Ajoute une tache a l'ordonnanceur.
   * @param {Function} fn - Fonction synchrone a executer
   * @param {'high'|'medium'|'low'} priority - Niveau de priorite
   * @returns {number} taskId - Identifiant unique de la tache
   */
  addTask(fn: () => any, priority: string = 'medium'): number {
    // TODO : Implementez addTask
    // 1. Validez la priorite (doit etre 'high', 'medium' ou 'low')
    // 2. Creez un objet tache { id, fn, priority, cancelled: false }
    // 3. Ajoutez-le dans la file de la priorite correspondante
    // 4. Stockez-le dans this._tasks par id
    // 5. Retournez l'id
    // 💡 Indice : utilisez nextId() pour generer un identifiant unique
    return 0;
  }

  /**
   * Annule une tache par son identifiant.
   * La tache ne sera pas executee lors du prochain run().
   * @param {number} taskId
   * @returns {boolean} true si la tache existait et a ete annulee
   */
  cancel(taskId: number): boolean {
    // TODO : Implementez cancel
    // Marquez la tache comme cancelled = true
    // Retournez true si trouvee, false sinon
    // 💡 Indice : cherchez la tache dans this._tasks avec .get(taskId)
    return false;
  }

  /**
   * Execute toutes les taches en respectant les priorites et le time-slicing.
   * Cede le controle a l'event loop apres chaque tranche de 5ms.
   */
  async run(): Promise<any[]> {
    // TODO : Implementez run
    //
    // Algorithme :
    // 1. Initialisez un tableau de resultats et un timestamp de debut de tranche
    // 2. Boucle tant qu'il y a des taches dans les files :
    //    a. Depiler la prochaine tache (high d'abord, puis medium, puis low)
    //    b. Si la tache est annulee, ignorez-la
    //    c. Executez fn() et stockez le resultat
    //    d. Verifiez le temps ecoule depuis le debut de la tranche
    //    e. Si >= 5ms, cedez au loop (await yieldToLoop()) et resetez le timestamp
    // 3. Retournez les resultats
    //
    // 💡 Indice : pour depiler par priorite, verifiez d'abord si this._queues.high
    //    a des elements, sinon medium, sinon low. Utilisez .shift() pour depiler.
    //    Pour verifier le temps : performance.now() - sliceStart >= this._timeSliceMs
    return [];
  }
}

// --- Tests Partie 1 ---
async function testPart1() {
  console.log('=== PARTIE 1 : Scheduler cooperatif ===\n');

  const scheduler = new CooperativeScheduler();
  const executionOrder = [];

  // Ajouter des taches dans le desordre
  scheduler.addTask(() => { executionOrder.push('low-1'); return 'low-1'; }, 'low');
  scheduler.addTask(() => { executionOrder.push('high-1'); return 'high-1'; }, 'high');
  scheduler.addTask(() => { executionOrder.push('medium-1'); return 'medium-1'; }, 'medium');
  scheduler.addTask(() => { executionOrder.push('high-2'); return 'high-2'; }, 'high');
  const cancelId = scheduler.addTask(() => { executionOrder.push('medium-cancel'); return 'oops'; }, 'medium');
  scheduler.addTask(() => { executionOrder.push('low-2'); return 'low-2'; }, 'low');

  // Annuler une tache
  scheduler.cancel(cancelId);

  const results = await scheduler.run();

  console.log('  Ordre d\'execution :', executionOrder.join(', '));
  console.log('  Resultats :', results);

  // Verifications
  const expectedOrder = ['high-1', 'high-2', 'medium-1', 'low-1', 'low-2'];
  const orderOk = executionOrder.every((v, i) => v === expectedOrder[i]);
  console.log(`  Ordre correct : ${orderOk ? 'OUI' : 'NON (attendu: ' + expectedOrder.join(', ') + ')'}`);
  console.log(`  Tache annulee non executee : ${!executionOrder.includes('medium-cancel') ? 'OUI' : 'NON'}`);

  // Test time-slicing : ajouter des taches lourdes
  const scheduler2 = new CooperativeScheduler();
  const yieldCount = { count: 0 };
  const originalYield = globalThis.setTimeout;

  for (let i = 0; i < 100; i++) {
    scheduler2.addTask(() => {
      // Simuler du travail CPU (busy wait ~0.5ms)
      const end = performance.now() + 0.5;
      while (performance.now() < end) { /* busy */ }
      return i;
    }, 'medium');
  }

  const start = performance.now();
  const results2 = await scheduler2.run();
  const elapsed = performance.now() - start;

  console.log(`  100 taches lourdes : ${results2.length} resultats en ${elapsed.toFixed(1)} ms`);
  console.log(`  (Le time-slicing devrait ceder au loop plusieurs fois)\n`);
}

// =============================================================================
// PARTIE 2 — Rate Limiter
// =============================================================================
// Objectif : implementer un limiteur de debit qui autorise au maximum
// `maxCalls` executions par fenetre de `windowMs` millisecondes.
//
// Si le quota est depasse, l'appel est rejete (retourne false ou leve une erreur).
// Le compteur se reinitialise apres chaque fenetre.
// =============================================================================

// TODO : Implementez createRateLimiter

/**
 * Cree un rate limiter.
 * @param {number} maxCalls - Nombre maximum d'appels autorises par fenetre
 * @param {number} windowMs - Duree de la fenetre en millisecondes
 * @returns {Function} limiter(fn) - Execute fn si le quota le permet
 */
function createRateLimiter(maxCalls: number, windowMs: number): (fn: () => any) => { limited: boolean; result?: any; retryAfter?: number } {
  // TODO : Implementez le rate limiter
  //
  // Structures suggerees :
  //   - Un tableau de timestamps des appels recents
  //   - A chaque appel, retirez les timestamps hors de la fenetre
  //   - Si le nombre d'appels restants dans la fenetre < maxCalls, executez fn
  //   - Sinon, retournez { limited: true, retryAfter: ... }
  //
  // Retournez une fonction (fn) => { ... }

  return function limiter(fn: () => any): { limited: boolean; result?: any; retryAfter?: number } {
    // TODO : implementez la logique
    // Retournez { limited: false, result: fn() } si autorise
    // Retournez { limited: true, retryAfter: ms } si bloque
    // 💡 Indice : filtrez d'abord les timestamps expires avec
    //    timestamps.filter(t => Date.now() - t < windowMs)
    //    Puis verifiez si le nombre restant < maxCalls.
  };
}

// --- Tests Partie 2 ---
async function testPart2() {
  console.log('=== PARTIE 2 : Rate Limiter ===\n');

  const limiter = createRateLimiter(3, 1000); // 3 appels max par seconde
  let counter = 0;

  // 3 premiers appels doivent passer
  for (let i = 0; i < 3; i++) {
    const res = limiter(() => ++counter);
    console.log(`  Appel ${i + 1} : limited=${res.limited}, result=${res.result}`);
  }

  // 4eme appel doit etre bloque
  const blocked = limiter(() => ++counter);
  console.log(`  Appel 4 (bloque) : limited=${blocked.limited}, retryAfter=${blocked.retryAfter}ms`);
  console.log(`  3 appels autorises puis bloque : ${blocked.limited ? 'OUI' : 'NON'}`);

  // Attendre la fin de la fenetre
  console.log('  Attente de la fenetre...');
  await sleep(1100);

  // Doit re-autoriser
  const afterWait = limiter(() => ++counter);
  console.log(`  Appel apres fenetre : limited=${afterWait.limited}, result=${afterWait.result}`);
  console.log(`  Re-autorise apres fenetre : ${!afterWait.limited ? 'OUI' : 'NON'}\n`);
}

// =============================================================================
// PARTIE 3 — Debounce et Throttle from scratch
// =============================================================================
// Objectif : implementer debounce et throttle sans librairie externe.
//
// Debounce : reporte l'execution de fn jusqu'a ce qu'il n'y ait PLUS
// d'appels pendant `delayMs` millisecondes. Seul le DERNIER appel est execute.
// Implication event loop : chaque appel clear le timer precedent et en cree
// un nouveau dans la macrotask queue.
//
// Throttle : garantit que fn est executee au maximum UNE FOIS par intervalle
// de `intervalMs` millisecondes. Le PREMIER appel est execute immediatement,
// les suivants sont ignores jusqu'a la fin de l'intervalle.
// Implication event loop : le timer de throttle est un macrotask qui reset
// le verrou apres intervalMs.
// =============================================================================

// TODO : Implementez debounce

/**
 * Cree une version debounced de fn.
 * @param {Function} fn - Fonction a debounceer
 * @param {number} delayMs - Delai d'attente en ms
 * @returns {Function} La fonction debounced (avec methode .cancel())
 */
function debounce(fn: (...args: any[]) => void, delayMs: number): ((...args: any[]) => void) & { cancel: () => void } {
  // TODO : Implementez debounce
  //
  // Algorithme :
  // 1. Maintenez une variable `timerId` (initialement null)
  // 2. A chaque appel :
  //    a. Si timerId existe, clearTimeout(timerId)
  //    b. Creez un nouveau timer : timerId = setTimeout(() => fn(...args), delayMs)
  // 3. Ajoutez une methode .cancel() qui clear le timer
  //
  // IMPLICATION EVENT LOOP :
  // Chaque setTimeout place un callback dans la macrotask queue (timers phase).
  // clearTimeout retire le callback avant qu'il ne soit execute.
  // Le debounce "repousse" constamment l'execution vers le futur.

  function debounced(...args: any[]): void {
    // TODO : clearTimeout du timer precedent, puis creez-en un nouveau
    // 💡 Indice : if (timerId) clearTimeout(timerId);
    //    timerId = setTimeout(() => fn(...args), delayMs);
  }

  debounced.cancel = (): void => {
    // TODO : annulez le timer en attente
    // 💡 Indice : clearTimeout(timerId); timerId = null;
  };

  return debounced as ((...args: any[]) => void) & { cancel: () => void };
}

// TODO : Implementez throttle

/**
 * Cree une version throttled de fn.
 * @param {Function} fn - Fonction a throttler
 * @param {number} intervalMs - Intervalle minimum entre executions
 * @returns {Function} La fonction throttled
 */
function throttle(fn: (...args: any[]) => void, intervalMs: number): (...args: any[]) => void {
  // TODO : Implementez throttle
  //
  // Algorithme :
  // 1. Maintenez un boolean `canRun` (initialement true)
  // 2. A chaque appel :
  //    a. Si canRun est true :
  //       - Executez fn(...args)
  //       - canRun = false
  //       - setTimeout(() => canRun = true, intervalMs)
  //    b. Si canRun est false : ignorez l'appel
  //
  // IMPLICATION EVENT LOOP :
  // Le setTimeout cree un macrotask qui reset canRun.
  // Pendant l'intervalle, TOUS les appels sont ignores.
  // Le timer est dans la timers phase du loop Node.js.

  function throttled(...args: any[]): void {
    // TODO : si canRun est true, executez fn et demarrez le cooldown
    // 💡 Indice : if (canRun) { fn(...args); canRun = false; setTimeout(() => canRun = true, intervalMs); }
  }

  return throttled;
}

// --- Tests Partie 3 ---
async function testPart3() {
  console.log('=== PARTIE 3 : Debounce et Throttle ===\n');

  // Test debounce
  console.log('  Test debounce (delai 100ms) :');
  let debounceCount = 0;
  const debouncedFn = debounce(() => debounceCount++, 100);

  // 5 appels rapides — seul le dernier doit s'executer
  for (let i = 0; i < 5; i++) {
    debouncedFn();
    await sleep(20); // 20ms entre chaque appel (< 100ms)
  }

  await sleep(150); // Attendre que le debounce se declenche
  console.log(`    5 appels rapides → executions: ${debounceCount} (attendu: 1)`);

  // Test cancel
  let cancelCount = 0;
  const cancelableFn = debounce(() => cancelCount++, 100);
  cancelableFn();
  cancelableFn.cancel();
  await sleep(150);
  console.log(`    cancel() empeche l'execution : ${cancelCount === 0 ? 'OUI' : 'NON'}`);

  // Test throttle
  console.log('\n  Test throttle (intervalle 100ms) :');
  let throttleCount = 0;
  const throttledFn = throttle(() => throttleCount++, 100);

  // 10 appels en 200ms — max 2-3 executions attendues
  for (let i = 0; i < 10; i++) {
    throttledFn();
    await sleep(20);
  }

  await sleep(150);
  console.log(`    10 appels en 200ms → executions: ${throttleCount} (attendu: 2-3)\n`);
}

// =============================================================================
// PARTIE 4 — File de priorite avec preemption
// =============================================================================
// Objectif : etendre le scheduler pour que les taches high puissent
// "preempter" les taches low. C'est-a-dire : si une tache high est ajoutee
// pendant l'execution d'une tache low, la tache low est suspendue
// (entre deux time slices) et la high s'execute d'abord.
//
// Pour simplifier, la preemption se fait ENTRE les taches, pas a l'interieur.
// Apres chaque time slice (5ms), on re-verifie les priorites.
// =============================================================================

class PreemptiveScheduler {
  constructor() {
    // TODO : Initialisez les structures
    // Comme CooperativeScheduler mais avec preemption
    // this._queues = { high: [], medium: [], low: [] }
    // this._tasks = new Map()
    // this._timeSliceMs = 5
    // this._running = false
  }

  /**
   * Ajoute une tache. Si le scheduler est en train de tourner et que
   * la priorite est high, elle sera traitee au prochain point de preemption.
   */
  addTask(fn: () => any, priority: string = 'medium'): number {
    // TODO : identique a CooperativeScheduler.addTask
    return 0;
  }

  cancel(taskId: number): boolean {
    // TODO : identique a CooperativeScheduler.cancel
    return false;
  }

  /**
   * Execute les taches avec preemption.
   * Apres chaque time slice ou chaque tache, re-verifie s'il y a
   * des taches de priorite superieure a traiter en premier.
   */
  async run(): Promise<any[]> {
    // TODO : Implementez run avec preemption
    //
    // Difference avec CooperativeScheduler :
    // Apres chaque tache executee (ou chaque time slice), on depile
    // la tache de PLUS HAUTE priorite, meme si on etait en train
    // de traiter les low. Si une high est ajoutee dynamiquement
    // pendant le run, elle sera traitee au prochain point de controle.
    //
    // Algorithme :
    // 1. Boucle tant qu'il y a des taches :
    //    a. Depiler la tache de plus haute priorite
    //    b. Si annulee, ignorer
    //    c. Executer fn()
    //    d. Verifier le temps → yield si >= 5ms
    //    e. AVANT de depiler la prochaine tache, re-verifier les priorites
    //       (c'est le point de preemption)
    //
    // 💡 Indice : la difference cle avec CooperativeScheduler est qu'a chaque
    //    iteration de la boucle, vous re-verifiez TOUTES les files par priorite
    //    au lieu de vider une file entiere avant de passer a la suivante.
    return [];
  }
}

// --- Tests Partie 4 ---
async function testPart4() {
  console.log('=== PARTIE 4 : Preemptive Scheduler ===\n');

  const scheduler = new PreemptiveScheduler();
  const executionOrder = [];

  // Ajouter des taches low
  for (let i = 0; i < 5; i++) {
    scheduler.addTask(() => {
      executionOrder.push(`low-${i}`);
      return `low-${i}`;
    }, 'low');
  }

  // Ajouter une tache medium
  scheduler.addTask(() => {
    executionOrder.push('medium-1');
    return 'medium-1';
  }, 'medium');

  // Ajouter des taches high
  scheduler.addTask(() => {
    executionOrder.push('high-1');
    return 'high-1';
  }, 'high');

  scheduler.addTask(() => {
    executionOrder.push('high-2');
    return 'high-2';
  }, 'high');

  const results = await scheduler.run();

  console.log('  Ordre d\'execution :', executionOrder.join(', '));
  console.log('  Resultats :', results);

  // Les high doivent etre executees en premier
  const highFirst = executionOrder[0] === 'high-1' && executionOrder[1] === 'high-2';
  console.log(`  High executees en premier : ${highFirst ? 'OUI' : 'NON'}`);

  // Test de preemption dynamique : ajouter une high pendant le run
  const scheduler2 = new PreemptiveScheduler();
  const order2 = [];

  // Ajouter des taches low qui prennent du temps
  for (let i = 0; i < 10; i++) {
    scheduler2.addTask(() => {
      order2.push(`low-${i}`);
      // Si c'est la 3eme tache low, ajouter une high dynamiquement
      if (i === 2) {
        scheduler2.addTask(() => {
          order2.push('dynamic-high');
          return 'dynamic-high';
        }, 'high');
      }
      return `low-${i}`;
    }, 'low');
  }

  await scheduler2.run();
  console.log('  Ordre avec preemption dynamique :', order2.join(', '));

  const dynamicIdx = order2.indexOf('dynamic-high');
  // La tache high dynamique devrait s'executer AVANT les low restantes
  console.log(`  High dynamique a l'index ${dynamicIdx} (devrait etre < 10)\n`);
}

// =============================================================================
// Execution de tous les tests
// =============================================================================

async function main() {
  console.log('Lab 13 — Scheduler Implementation\n');

  await testPart1();
  await testPart2();
  await testPart3();
  await testPart4();

  console.log('=== Lab 13 termine ===');
}

main().catch(console.error);
