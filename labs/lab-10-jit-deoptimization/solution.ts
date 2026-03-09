// =============================================================================
// Lab 10 — JIT Deoptimization — SOLUTION
// =============================================================================
// Commande : node --trace-opt --trace-deopt solution.js
//
// Cette solution montre comment provoquer, observer et corriger les
// deoptimisations JIT dans V8/TurboFan.
// =============================================================================

import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------------------
// Utilitaire : mesure de performance
// ---------------------------------------------------------------------------
function benchmark(name: string, fn: () => any, iterations: number = 1_000_000): number {
  for (let i = 0; i < 1_000; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const end = performance.now();

  const ms = (end - start).toFixed(2);
  const opsPerSec = ((iterations / (end - start)) * 1000).toFixed(0);
  console.log(`  [bench] ${name}: ${ms} ms (${opsPerSec} ops/sec)`);
  return end - start;
}

// =============================================================================
// PARTIE 1 — Fonction optimisee
// =============================================================================
// POURQUOI V8 optimise les fonctions chaudes :
// TurboFan utilise le "feedback de type" collecte par Ignition pendant
// l'interpretation. Si une fonction est appelee suffisamment de fois
// (seuil d'environ 1 000 a 10 000 appels) et que le feedback est stable
// (types constants), TurboFan compile la fonction en code machine natif
// specialise pour ces types. Le resultat est 10-100x plus rapide que
// l'interpretation du bytecode.
// =============================================================================

console.log('=== PARTIE 1 : Fonction optimisee ===');

function compute(a: any, b: any): any {
  return a * b + a - b;
}

// POURQUOI 100 000 appels : on veut etre CERTAIN que V8 a depasse le seuil
// d'optimisation. Le seuil exact depend de la version de V8 et de la
// complexite de la fonction, mais 100 000 est largement suffisant.
for (let i = 0; i < 100_000; i++) {
  compute(i, i + 1);
}

console.log('  compute(3, 7) =', compute(3, 7)); // 3*7 + 3 - 7 = 17
console.log('  → Verifiez --trace-opt : [compiling method compute using TurboFan]');
console.log();

// =============================================================================
// PARTIE 2 — Deoptimisation par changement de type
// =============================================================================
// POURQUOI un changement de type provoque une deoptimisation :
// TurboFan a genere du code machine SPECIALISE pour l'addition d'entiers.
// Ce code contient une instruction machine d'addition entiere (ADD)
// qui ne sait PAS concatener des chaines ou additionner des BigInt.
// Quand V8 detecte un type inattendu, il doit :
// 1. Abandonner le code machine optimise (deopt)
// 2. Revenir au bytecode Ignition (interprete)
// 3. Mettre a jour le feedback de type
// 4. Eventuellement reoptimiser avec un feedback plus large
// =============================================================================

console.log('=== PARTIE 2 : Deoptimisation par changement de type ===');

// Apres 100 000 appels avec des entiers, TurboFan a specialise compute
// pour Smi + Smi. Maintenant on casse cette hypothese :
const resultStr = compute('hello', ' world');
console.log(`  compute("hello", " world") = "${resultStr}"`);
console.log('  → Verifiez --trace-deopt : [deoptimizing compute]');

// POURQUOI meme les booleens causent une deopt :
// true et false ne sont PAS des Smi. Meme si true + true = 2 en JavaScript,
// le code machine genere pour Smi ne sait pas gerer les booleens.
const resultBool = compute(true, false);
console.log(`  compute(true, false) = ${resultBool}`);
console.log();

// =============================================================================
// PARTIE 3 — Trois scenarios de deoptimisation
// =============================================================================

console.log('=== PARTIE 3 : Trois scenarios de deopt ===');

// --- Scenario A : Changement de type ---
// POURQUOI c'est la cause de deopt la plus frequente :
// En JavaScript, n'importe quelle variable peut contenir n'importe quel type.
// TurboFan PARIE que les types resteront stables car c'est le cas en pratique
// dans la majorite du code. Quand ce pari echoue → deopt.

console.log('  Scenario A : Changement de type');

function addValues(a: any, b: any): any {
  return a + b;
}

// Phase 1 : echauffement monomorphe (toujours des entiers)
for (let i = 0; i < 100_000; i++) {
  addValues(i, i + 1);
}
console.log('    addValues optimisee pour Smi + Smi');

// Phase 2 : deoptimisation
addValues('x', 'y');         // Chaine → deopt
console.log('    addValues("x", "y") → deopt (type String)');

// --- Scenario B : Changement de hidden class ---
// POURQUOI la hidden class affecte l'optimisation :
// TurboFan inline les acces aux proprietes en se basant sur la hidden class
// observee pendant le feedback. L'acces `point.x` est compile en un acces
// memoire a un offset fixe (ex: [base + 16]). Si la hidden class change,
// l'offset de .x peut etre different → le code machine lit le mauvais emplacement.

console.log('  Scenario B : Changement de hidden class');

function getCoord(point: { x: number; y: number }): number {
  return point.x + point.y;
}

// Phase 1 : echauffement avec { x, y } toujours dans le meme ordre
for (let i = 0; i < 100_000; i++) {
  getCoord({ x: i, y: i + 1 });
}
console.log('    getCoord optimisee pour la map {x, y}');

// Phase 2 : deoptimisation avec une forme differente
// { y: 1, x: 2 } a une hidden class differente de { x: 1, y: 2 }
// car l'ORDRE de creation des proprietes determine la chaine de transitions.
getCoord({ y: 1, x: 2 });
console.log('    getCoord({y:1, x:2}) → deopt (wrong map)');

// { a: 0, x: 1, y: 2 } a AUSSI une hidden class differente
getCoord({ a: 0, x: 1, y: 2 });
console.log('    getCoord({a:0, x:1, y:2}) → deopt (wrong map)');

// --- Scenario C : Ajout de proprietes apres optimisation ---
// POURQUOI modifier un objet apres optimisation est dangereux :
// TurboFan a "photographie" la hidden class de l'objet pendant le feedback.
// Si on ajoute une propriete, la hidden class de l'objet CHANGE
// (transition vers une nouvelle map avec la propriete en plus).
// Le code machine optimise reference l'ANCIENNE map → deopt.

console.log('  Scenario C : Ajout de proprietes apres optimisation');

function processObj(obj: any): string {
  return obj.name + ': ' + obj.value;
}

// Phase 1 : echauffement avec un objet fixe
const template = { name: 'item', value: 42 };
for (let i = 0; i < 100_000; i++) {
  processObj(template);
}
console.log('    processObj optimisee pour la map {name, value}');

// Phase 2 : modifier la hidden class de l'objet
// POURQUOI c'est subtil : on ne change pas les TYPES des proprietes existantes,
// on AJOUTE une propriete. Mais cela suffit a changer la hidden class.
template.extra = true;  // Transition vers la map {name, value, extra}
processObj(template);
console.log('    template.extra = true → deopt (map changed)');

console.log();

// =============================================================================
// PARTIE 4 — Corriger les fonctions deoptimisees
// =============================================================================
// Strategies de correction :
// A) Garantir des types constants avec conversion explicite
// B) Garantir une hidden class constante avec une classe ES6
// C) Ne JAMAIS modifier un objet apres sa creation
// =============================================================================

console.log('=== PARTIE 4 : Fonctions stables (sans deopt) ===');

// --- Correction A : Conversion de type explicite ---
// POURQUOI cela fonctionne : en convertissant TOUJOURS en Number,
// le feedback de type est constant (toujours HeapNumber ou Smi),
// peu importe le type d'entree. TurboFan peut specialiser pour Number.
function stableAddValues(a: any, b: any): number {
  return Number(a) + Number(b);
}

// On teste avec des types melanges — PAS de deopt grace a Number()
for (let i = 0; i < 100_000; i++) {
  stableAddValues(i, i + 1);
}
stableAddValues('10', '20');     // Number("10") = 10 → pas de deopt
stableAddValues(true, false);    // Number(true) = 1 → pas de deopt
console.log('  stableAddValues("10", "20") =', stableAddValues('10', '20'));
console.log('  → Pas de deopt grace a Number()');

// --- Correction B : Classe ES6 pour garantir la hidden class ---
// POURQUOI une classe est plus stable qu'un literal :
// Le constructeur d'une classe ajoute TOUJOURS les proprietes dans le
// MEME ordre, ce qui garantit la meme chaine de transitions et donc
// la meme hidden class pour toutes les instances.
class StablePoint {
  constructor(x, y) {
    this.x = x;  // Toujours .x en premier
    this.y = y;  // Toujours .y en deuxieme
  }
}

function stableGetCoord(point: { x: number; y: number }): number {
  return point.x + point.y;
}

// Toutes les instances de StablePoint ont la meme hidden class
for (let i = 0; i < 100_000; i++) {
  stableGetCoord(new StablePoint(i, i + 1));
}
console.log('  stableGetCoord(new StablePoint(3, 7)) =', stableGetCoord(new StablePoint(3, 7)));
console.log('  → Pas de deopt grace a la classe ES6');

// --- Correction C : Objets immutables ---
// POURQUOI Object.freeze empeche les modifications :
// Un objet gele (frozen) ne peut plus recevoir de nouvelles proprietes,
// donc sa hidden class ne change JAMAIS apres la creation.
// ATTENTION : Object.freeze a un leger surcout lors de la creation,
// mais les acces en lecture sont aussi rapides qu'un objet normal.
function stableProcessObj(obj: any): string {
  return obj.name + ': ' + obj.value;
}

function createImmutableItem(name: string, value: number): Readonly<{ name: string; value: number }> {
  // POURQUOI on cree un nouvel objet a chaque fois au lieu de modifier :
  // Modifier un objet existant change sa hidden class. Creer un nouvel
  // objet avec toutes les proprietes des le depart garantit une hidden
  // class constante.
  return Object.freeze({ name, value });
}

for (let i = 0; i < 100_000; i++) {
  stableProcessObj(createImmutableItem('item', i));
}
console.log('  stableProcessObj(frozen) =', stableProcessObj(createImmutableItem('test', 42)));
console.log('  → Pas de deopt grace a Object.freeze');

console.log('  Verifiez --trace-deopt : AUCUNE deoptimisation pour les fonctions stable*');
console.log();

// =============================================================================
// PARTIE 5 — Benchmark : optimise vs deoptimise
// =============================================================================
// POURQUOI la difference est mesurable :
// Une fonction optimisee par TurboFan execute du code machine natif
// (ADD, MUL instructions CPU). Une fonction deoptimisee retourne en
// mode interprete (bytecode Ignition), qui est 10-100x plus lent.
// Apres deopt, V8 peut re-optimiser avec un feedback plus large,
// mais le code resultant est souvent moins efficace (generique au
// lieu de specialise).
// =============================================================================

console.log('=== PARTIE 5 : Benchmark optimise vs deoptimise ===');

// Fonction qui reste optimisee (toujours le meme type)
function optimizedAdd(a: any, b: any): any {
  return a + b;
}

// Echauffement avec des entiers uniquement → TurboFan specialise pour Smi
for (let i = 0; i < 100_000; i++) {
  optimizedAdd(i, i + 1);
}

// Mesure APRES optimisation
const timeOptimized = benchmark('optimizedAdd (optimise, entiers)', () =>
  optimizedAdd(42, 58)
);

// Fonction qu'on va deoptimiser
function deoptimizedAdd(a: any, b: any): any {
  return a + b;
}

// Echauffement puis deoptimisation avec plusieurs types
for (let i = 0; i < 100_000; i++) {
  deoptimizedAdd(i, i + 1);
}

// POURQUOI on passe PLUSIEURS types differents :
// Chaque nouveau type provoque une deopt supplementaire.
// Apres plusieurs deopts, V8 peut decider de ne plus re-optimiser
// la fonction (elle est "too hot to reoptimize" ou marquee "don't optimize").
deoptimizedAdd('x', 'y');            // String → deopt
deoptimizedAdd(true, false);          // Boolean → deopt
deoptimizedAdd(1n, 2n);               // BigInt → deopt
deoptimizedAdd({ valueOf: () => 1 }, { valueOf: () => 2 }); // Object → deopt

// Mesure APRES deoptimisation
const timeDeopt = benchmark('deoptimizedAdd (deoptimise, entiers)', () =>
  deoptimizedAdd(42, 58)
);

console.log(`  Ratio : x${(timeDeopt / timeOptimized).toFixed(1)} plus lent apres deopt`);

console.log();
console.log('=== Resume des bonnes pratiques ===');
console.log('1. Toujours passer le MEME TYPE d\'arguments a une fonction chaude');
console.log('2. Creer les objets avec les memes proprietes dans le meme ORDRE');
console.log('3. Ne JAMAIS ajouter/supprimer de proprietes apres creation');
console.log('4. Utiliser des classes ES6 pour garantir des hidden classes stables');
console.log('5. Preferer Number(x) si les types d\'entree sont incertains');
console.log('6. Eviter eval(), with, delete dans les fonctions chaudes');
console.log();
console.log('=== Lab 10 termine ===');
