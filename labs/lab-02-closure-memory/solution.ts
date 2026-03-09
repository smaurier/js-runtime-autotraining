// =============================================================================
// Lab 02 — Closures et rétention mémoire — SOLUTION
// =============================================================================
// Exécuter avec : node --import tsx/esm --expose-gc solution.ts
// Le flag --expose-gc est OBLIGATOIRE pour que global.gc() fonctionne.
// =============================================================================

declare const gc: (() => void) | undefined;

console.log("=== Lab 02 : Closures et rétention mémoire — SOLUTION ===\n");

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + " Mo";
}

function getHeapUsed(): number {
  return process.memoryUsage().heapUsed;
}

function forceGC(): void {
  if ((globalThis as any).gc) {
    (globalThis as any).gc();
  } else {
    console.warn(
      "  global.gc() indisponible. Lancez avec : node --import tsx/esm --expose-gc solution.ts"
    );
  }
}

function separator(title: string): void {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70) + "\n");
}

// =============================================================================
// PARTIE 1 — Closures qui retiennent volontairement de gros buffers
// =============================================================================

separator("PARTIE 1 — Rétention volontaire de gros buffers");

function createHeavyClosures(count: number): (() => number)[] {
  const closures: (() => number)[] = [];
  for (let i = 0; i < count; i++) {
    const buf: Buffer = Buffer.alloc(1024 * 1024);
    const closure = (): number => buf.length;
    closures.push(closure);
  }
  return closures;
}

forceGC();
const avantP1: number = getHeapUsed();

const heavyClosures: (() => number)[] = createHeavyClosures(100);

forceGC();
const apresP1: number = getHeapUsed();

console.log(`Mémoire avant  : ${formatMB(avantP1)}`);
console.log(`Mémoire après  : ${formatMB(apresP1)}`);
console.log(`Delta          : ${formatMB(apresP1 - avantP1)}`);
console.log(`Attendu        : ~100 Mo (100 buffers de 1 Mo retenus par les closures)`);

console.log(`Vérification   : heavyClosures[0]() = ${heavyClosures[0]()}`);
console.log();

const mem: NodeJS.MemoryUsage = process.memoryUsage();
console.log(`  Détail mémoire complète :`);
console.log(`    heapUsed  : ${formatMB(mem.heapUsed)}`);
console.log(`    external  : ${formatMB(mem.external)}`);
console.log(`    rss       : ${formatMB(mem.rss)}`);

// =============================================================================
// PARTIE 2 — Corriger les closures pour libérer le buffer
// =============================================================================

separator("PARTIE 2 — Libération du buffer, conservation de la donnée utile");

function createLightClosures(count: number): (() => number)[] {
  const closures: (() => number)[] = [];
  for (let i = 0; i < count; i++) {
    const buf: Buffer = Buffer.alloc(1024 * 1024);
    const len: number = buf.length;
    const closure = (): number => len;
    closures.push(closure);
  }
  return closures;
}

forceGC();
const avantP2: number = getHeapUsed();

const lightClosures: (() => number)[] = createLightClosures(100);

forceGC();
const apresP2: number = getHeapUsed();

console.log(`Mémoire avant  : ${formatMB(avantP2)}`);
console.log(`Mémoire après  : ${formatMB(apresP2)}`);
console.log(`Delta          : ${formatMB(apresP2 - avantP2)}`);
console.log(`Attendu        : ~0 Mo (les buffers ont été libérés par le GC)`);
console.log(`Vérification   : lightClosures[0]() = ${lightClosures[0]()}`);
console.log();
console.log(`  Comparaison avec Partie 1 :`);
console.log(`    Heavy closures : ${formatMB(apresP1 - avantP1)}`);
console.log(`    Light closures : ${formatMB(apresP2 - avantP2)}`);
console.log(`    La différence prouve que la technique "extraire, ne pas capturer" fonctionne.`);

// =============================================================================
// PARTIE 3 — Les closures capturent la portée entière (contexte partagé V8)
// =============================================================================

separator("PARTIE 3 — Capture de portée complète (contexte partagé V8)");

function scenarioA_captureDirecte(count: number): (() => number)[] {
  const closures: (() => number)[] = [];
  for (let i = 0; i < count; i++) {
    const buf: Buffer = Buffer.alloc(1024 * 1024);
    closures.push(() => buf.length);
  }
  return closures;
}

function scenarioB_sansCapture(count: number): (() => number)[] {
  const closures: (() => number)[] = [];
  for (let i = 0; i < count; i++) {
    const buf: Buffer = Buffer.alloc(1024 * 1024);
    closures.push(() => i);
  }
  return closures;
}

function scenarioC_contextePartage(count: number): (() => number)[] {
  const closures: (() => number)[] = [];
  for (let i = 0; i < count; i++) {
    const buf: Buffer = Buffer.alloc(1024 * 1024);
    const closureA = (): number => buf.length;
    const closureB = (): number => i;
    closures.push(closureB);
    void closureA;
  }
  return closures;
}

function scenarioD_corrige(count: number): (() => number)[] {
  const closures: (() => number)[] = [];

  function createSafeClosure(index: number): () => number {
    return () => index;
  }

  for (let i = 0; i < count; i++) {
    const buf: Buffer = Buffer.alloc(1024 * 1024);
    const closureA = (): number => buf.length;
    const closureB: () => number = createSafeClosure(i);
    closures.push(closureB);
    void closureA;
  }
  return closures;
}

forceGC();
const avantA: number = getHeapUsed();
const closuresA: (() => number)[] = scenarioA_captureDirecte(50);
forceGC();
const apresA: number = getHeapUsed();
console.log(`Scénario A (capture directe)   : ${formatMB(apresA - avantA)}`);

forceGC();
const avantB: number = getHeapUsed();
const closuresB: (() => number)[] = scenarioB_sansCapture(50);
forceGC();
const apresB: number = getHeapUsed();
console.log(`Scénario B (sans capture)      : ${formatMB(apresB - avantB)}`);

forceGC();
const avantC: number = getHeapUsed();
const closuresC: (() => number)[] = scenarioC_contextePartage(50);
forceGC();
const apresC: number = getHeapUsed();
console.log(`Scénario C (contexte partagé)  : ${formatMB(apresC - avantC)}`);

forceGC();
const avantD: number = getHeapUsed();
const closuresD: (() => number)[] = scenarioD_corrige(50);
forceGC();
const apresD: number = getHeapUsed();
console.log(`Scénario D (corrigé — helper)  : ${formatMB(apresD - avantD)}`);

console.log();
console.log("  Analyse :");
console.log("  - A (~50 Mo)  : normal, chaque closure retient son buffer.");
console.log("  - B (~0 Mo)   : V8 optimise, buf n'est capturé par personne.");
console.log("  - C (~50 Mo)  : PIEGE ! closureB retient buf via le contexte partagé.");
console.log("  - D (~0 Mo)   : CORRIGE ! closureB est dans une portée séparée.");
console.log();
console.log("  Leçon clé : ne JAMAIS créer dans la même portée une closure qui");
console.log("  capture une grosse donnée et une closure longue durée qui n'en a");
console.log("  pas besoin. Utilisez des fonctions helper pour séparer les contextes.");

void [closuresA, closuresB, closuresC, closuresD];

// =============================================================================
// PARTIE 4 — WeakRef : observer la désallocation par le GC
// =============================================================================

separator("PARTIE 4 — WeakRef et observation de la désallocation");

function weakRefExperiment(): void {
  let bigObject: { data: Buffer; label: string } | null = { data: Buffer.alloc(10 * 1024 * 1024), label: "BigObject" };

  const weakRef = new WeakRef(bigObject);

  const registry = new FinalizationRegistry((heldValue: string) => {
    console.log(`  [FinalizationRegistry] L'objet "${heldValue}" a été collecté par le GC !`);
  });
  registry.register(bigObject, "bigObject");

  console.log(`  Avant toute suppression :`);
  console.log(`    weakRef.deref() existe ? ${weakRef.deref() !== undefined}`);

  let closure: (() => number) | null = () => bigObject!.data.length;
  console.log(`  Closure créée, elle retient bigObject.`);
  console.log(`    closure() = ${closure()}`);

  bigObject = null;
  forceGC();
  console.log(`\n  Après bigObject = null + GC (closure encore vivante) :`);
  console.log(`    weakRef.deref() existe ? ${weakRef.deref() !== undefined}`);

  closure = null;
  forceGC();
  console.log(`\n  Après closure = null + GC (plus aucune référence forte) :`);
  console.log(`    weakRef.deref() existe ? ${weakRef.deref() !== undefined}`);

  const memApres: NodeJS.MemoryUsage = process.memoryUsage();
  console.log(`\n  Mémoire après libération :`);
  console.log(`    heapUsed : ${formatMB(memApres.heapUsed)}`);
  console.log(`    external : ${formatMB(memApres.external)}`);
}

weakRefExperiment();

setTimeout(() => {
  forceGC();

  separator("BONUS — Mini-cache avec WeakRef");

  class WeakCache<T extends object> {
    private factory: (key: string) => T;
    private cache: Map<string, WeakRef<T>> = new Map();
    public hits: number = 0;
    public misses: number = 0;
    private registry: FinalizationRegistry<string>;

    constructor(factory: (key: string) => T) {
      this.factory = factory;
      this.registry = new FinalizationRegistry((key: string) => {
        const ref = this.cache.get(key);
        if (ref && ref.deref() === undefined) {
          this.cache.delete(key);
        }
      });
    }

    get(key: string): T {
      const ref = this.cache.get(key);
      if (ref) {
        const value = ref.deref();
        if (value !== undefined) {
          this.hits++;
          return value;
        }
      }
      this.misses++;
      const value: T = this.factory(key);
      this.cache.set(key, new WeakRef(value));
      this.registry.register(value, key);
      return value;
    }

    stats(): { hits: number; misses: number; size: number } {
      return { hits: this.hits, misses: this.misses, size: this.cache.size };
    }
  }

  const cache = new WeakCache<{ id: string; data: Buffer }>((key: string) => {
    return { id: key, data: Buffer.alloc(1024 * 1024) };
  });

  console.log("  Remplissage du cache avec 20 entrées de 1 Mo :");
  const refs: { id: string; data: Buffer }[] = [];
  for (let i = 0; i < 20; i++) {
    const obj = cache.get(`item-${i}`);
    refs.push(obj);
  }
  console.log(`  Stats : ${JSON.stringify(cache.stats())}`);

  forceGC();
  const memAvantRelease: NodeJS.MemoryUsage = process.memoryUsage();
  console.log(`  Mémoire (refs vivantes) : ${formatMB(memAvantRelease.rss)}`);

  refs.length = 0;
  forceGC();
  const memApresRelease: NodeJS.MemoryUsage = process.memoryUsage();
  console.log(`  Mémoire (refs libérées) : ${formatMB(memApresRelease.rss)}`);
  console.log(`  Delta RSS : ${formatMB(memApresRelease.rss - memAvantRelease.rss)}`);

  for (let i = 0; i < 5; i++) {
    cache.get(`item-${i}`);
  }
  console.log(`  Stats après re-accès : ${JSON.stringify(cache.stats())}`);
  console.log();
  console.log("  Le WeakCache permet au GC de libérer les entrées inutilisées.");
  console.log("  Quand on ré-accède à une entrée collectée, le cache la recrée.");

  void [heavyClosures, lightClosures];

  console.log("\n=== Fin du Lab 02 — SOLUTION ===");
}, 100);
