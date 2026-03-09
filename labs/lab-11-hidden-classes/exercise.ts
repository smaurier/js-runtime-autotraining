// =============================================================================
// Lab 11 — Hidden Classes
// =============================================================================
// Commande : node --import tsx/esm --allow-natives-syntax exercise.ts
//
// Ce lab explore les hidden classes (maps) de V8 et leur impact direct
// sur les performances d'accès aux propriétés.
// Le flag --allow-natives-syntax est OBLIGATOIRE pour %HaveSameMap()
// et %DebugPrint().
// =============================================================================

import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------------------
// Utilitaire de benchmark
// ---------------------------------------------------------------------------
function bench(name: string, fn: () => any, iterations: number = 1_000_000): number {
  for (let i = 0; i < 10_000; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const end = performance.now();
  console.log(`  [bench] ${name}: ${(end - start).toFixed(2)} ms`);
  return end - start;
}

function separator(title: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70) + '\n');
}

// =============================================================================
// PARTIE 1 — Prédictions de hidden classes avec %HaveSameMap()
// =============================================================================
// Objectif : pour chaque paire d'objets, PRÉDIRE si %HaveSameMap() retourne
// true ou false AVANT de lire le résultat dans la console.
//
// Écrivez vos prédictions dans les commentaires « VOTRE PRÉDICTION ».
// Puis exécutez et comparez.
// =============================================================================

separator('PARTIE 1 — Prédictions de hidden classes');

// --- Test 1A : Deux objets créés de la même façon ---
const obj1a = { x: 1, y: 2 };
const obj1b = { x: 10, y: 20 };

// VOTRE PRÉDICTION : _____
console.log('  1A - Même forme {x, y} :', (eval('%HaveSameMap(obj1a, obj1b)') as boolean));

// --- Test 1B : Propriétés dans un ordre différent ---
const obj2a = { x: 1, y: 2 };
const obj2b = { y: 2, x: 1 };

// VOTRE PRÉDICTION : _____
console.log('  1B - Ordre différent {x,y} vs {y,x} :', (eval('%HaveSameMap(obj2a, obj2b)') as boolean));

// --- Test 1C : Ajout dynamique d'une propriété ---
const obj3a = { x: 1, y: 2 };
const obj3b = { x: 1, y: 2 };
obj3b.z = 3;

// VOTRE PRÉDICTION : _____
console.log('  1C - Après ajout dynamique de z :', (eval('%HaveSameMap(obj3a, obj3b)') as boolean));

// --- Test 1D : Mêmes propriétés, types de valeurs différents ---
const obj4a = { x: 1, y: 2 };       // x est un Smi
const obj4b = { x: 1.5, y: 2 };     // x est un Double

// VOTRE PRÉDICTION : _____
console.log('  1D - Smi vs Double :', (eval('%HaveSameMap(obj4a, obj4b)') as boolean));

// --- Test 1E : Suppression avec delete ---
const obj5a = { x: 1, y: 2, z: 3 };
const obj5b = { x: 1, y: 2, z: 3 };
delete obj5b.z;

// VOTRE PRÉDICTION : _____
console.log('  1E - Après delete :', (eval('%HaveSameMap(obj5a, obj5b)') as boolean));

// --- Test 1F : Instances d'une même classe ES6 ---
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
const p1 = new Point(1, 2);
const p2 = new Point(10, 20);

// VOTRE PRÉDICTION : _____
console.log('  1F - Instances de la même classe :', (eval('%HaveSameMap(p1, p2)') as boolean));

// =============================================================================
// PARTIE 2 — Benchmark : monomorphe vs polymorphe vs mégamorphe
// =============================================================================
// Objectif : créer 3 tableaux d'objets avec 1, 4, et 8+ formes différentes,
// puis mesurer la performance d'accès aux propriétés pour chaque cas.
//
// Contexte V8 :
//   - Monomorphe (1 forme)  : l'Inline Cache (IC) a UNE entrée → accès direct
//   - Polymorphe (2-4 formes) : l'IC a plusieurs entrées → recherche linéaire
//   - Mégamorphe (5+ formes) : l'IC abandonne → lookup générique dans la map
//
// Vous devez TOUT écrire : la création des tableaux, le benchmark, l'analyse.
// =============================================================================

separator('PARTIE 2 — Benchmark mono/poly/méga');

// TODO 2.1 : Créez un tableau `monoArray` de 1 000 objets ayant TOUS la même
// forme { x, y, z }. C'est le cas monomorphe.

// TODO : créez monoArray ici
// 💡 Indice : une boucle for qui fait monoArray.push({ x: i, y: i*2, z: i*3 })

// TODO 2.2 : Créez un tableau `polyArray` de 1 000 objets avec 4 formes
// différentes. Toutes doivent avoir la propriété `x` (pour le benchmark).
// Exemple de formes : { x, y, z }, { x, y, z, a }, { x, y, z, b }, { x, y, z, c }

// TODO : créez polyArray ici
// 💡 Indice : utilisez i % 4 pour alterner entre 4 formes différentes.
// Ex: si i%4===0 → {x,y,z}, si i%4===1 → {x,y,z,a}, etc.

// TODO 2.3 : Créez un tableau `megaArray` de 1 000 objets avec 8+ formes
// différentes. Toutes doivent avoir la propriété `x`.

// TODO : créez megaArray ici

// Fonction de somme qui lit .x sur chaque élément du tableau.
// C'est cette fonction qui sera affectée par le polymorphisme de l'IC.
function sumX(arr: { x: number }[]): number {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i].x;
  }
  return total;
}

// TODO 2.4 : Benchmarkez sumX sur les 3 tableaux et affichez les ratios.
// Vérifiez que monomorphe < polymorphe < mégamorphe.

// TODO : appelez bench() pour chaque tableau et calculez les ratios

// Assertions attendues (décommentez après implémentation) :
// console.assert(monoArray.length === 1000, 'monoArray doit contenir 1000 objets');
// console.assert(polyArray.length === 1000, 'polyArray doit contenir 1000 objets');
// console.assert(megaArray.length === 1000, 'megaArray doit contenir 1000 objets');

// =============================================================================
// PARTIE 3 — Casser les hidden classes et observer avec %DebugPrint
// =============================================================================
// Objectif : à partir d'un objet factory, explorer 3 manières de « casser »
// la hidden class, et vérifier avec %HaveSameMap().
//
// NOUVEAU : utilisez %DebugPrint() sur au moins un objet pour voir la
// représentation interne V8 (map, propriétés, éléments).
//
// Factory de départ (NE PAS MODIFIER) :
// =============================================================================

separator('PARTIE 3 — Casser les hidden classes');

function createBase(): { a: number; b: number; c: number } {
  return { a: 1, b: 2, c: 3 };
}

// --- Observation avec %DebugPrint ---
// Exécutez avec --allow-natives-syntax pour voir la sortie.
const debugObj = createBase();
console.log('  %DebugPrint d\'un objet createBase() :');
eval('%DebugPrint(debugObj)');
console.log();

// TODO 3A : Ajout de propriété
// Créez deux objets avec createBase().
// Ajoutez une propriété `d` au deuxième.
// Vérifiez avec %HaveSameMap() — que se passe-t-il ?
// Écrivez votre observation en commentaire.

// TODO : implémentez 3A ici
// 💡 Indice : const a = createBase(); const b = createBase(); b.d = 4;
// Puis console.log((eval('%HaveSameMap(a, b)') as boolean));

// TODO 3B : Suppression de propriété (delete)
// Créez deux objets avec createBase().
// Supprimez la propriété `c` du deuxième avec delete.
// Vérifiez avec %HaveSameMap() — que se passe-t-il ?
// Utilisez %DebugPrint() sur l'objet après delete pour observer le changement.

// TODO : implémentez 3B ici

// TODO 3C : Changement d'ordre des propriétés
// Créez un objet vide et ajoutez les propriétés a, b, c dans l'ordre.
// Créez un autre objet vide et ajoutez c, b, a dans l'ordre inverse.
// Vérifiez avec %HaveSameMap() — que se passe-t-il ?

// TODO : implémentez 3C ici

// =============================================================================
// PARTIE 4 — Corriger un factory function mal écrit
// =============================================================================
// Le factory ci-dessous crée des objets avec des hidden classes incohérentes.
// Diagnostiquez les problèmes et écrivez une version corrigée.
// =============================================================================

separator('PARTIE 4 — Corriger un factory function');

// --- Factory MAL écrit ---
function badCreateUser(name: string, age: number, options: any = {}): any {
  const user = {};

  // Problème 1 : propriété conditionnelle — certaines instances l'ont, pas d'autres
  if (options.isAdmin) {
    user.isAdmin = true;
  }

  user.name = name;

  // Problème 2 : propriété conditionnelle selon la valeur de age
  if (age > 0) {
    user.age = age;
  }

  user.email = options.email || '';

  // Problème 3 : suppression avec delete
  if (!options.email) {
    delete user.email;
  }

  // Problème 4 : propriété dynamique avec bracket notation
  if (options.role) {
    user[options.role + 'Level'] = 1;
  }

  return user;
}

// Ces 4 instances auront probablement des maps différentes
const badUser1 = badCreateUser('Alice', 30, { isAdmin: true, email: 'a@b.com' });
const badUser2 = badCreateUser('Bob', 25);
const badUser3 = badCreateUser('Charlie', -1, { role: 'editor' });
const badUser4 = badCreateUser('Diana', 40, { isAdmin: true, role: 'admin' });

// Vérification : les maps sont bien différentes
console.log('  badUser1 vs badUser2 :', (eval('%HaveSameMap(badUser1, badUser2)') as boolean));
console.log('  badUser1 vs badUser3 :', (eval('%HaveSameMap(badUser1, badUser3)') as boolean));
console.log('  badUser1 vs badUser4 :', (eval('%HaveSameMap(badUser1, badUser4)') as boolean));

// TODO 4.1 : Écrivez un factory `goodCreateUser` corrigé qui :
//   - Initialise TOUJOURS les mêmes propriétés dans le MÊME ordre
//   - Utilise des valeurs par défaut (false, 0, '', null) au lieu de conditions
//   - N'utilise JAMAIS delete
//   - N'utilise JAMAIS de bracket notation dynamique pour les noms de propriétés

function goodCreateUser(name: string, age: number, options: any = {}): any {
  // TODO : implémentez le factory corrigé
  // Toutes les instances doivent avoir la MÊME hidden class.
}

// TODO 4.2 : Testez que toutes les instances ont la même map
// const goodUser1 = goodCreateUser('Alice', 30, { isAdmin: true, email: 'a@b.com' });
// const goodUser2 = goodCreateUser('Bob', 25);
// const goodUser3 = goodCreateUser('Charlie', -1, { role: 'editor' });
// const goodUser4 = goodCreateUser('Diana', 40, { isAdmin: true, role: 'admin' });
//
// console.log('  goodUser1 vs goodUser2 :', (eval('%HaveSameMap(goodUser1, goodUser2)') as boolean));
// console.log('  goodUser1 vs goodUser3 :', (eval('%HaveSameMap(goodUser1, goodUser3)') as boolean));
// console.log('  goodUser1 vs goodUser4 :', (eval('%HaveSameMap(goodUser1, goodUser4)') as boolean));
//
// console.assert((eval('%HaveSameMap(goodUser1, goodUser2)') as boolean), 'goodUser1 et goodUser2 doivent avoir la même map');
// console.assert((eval('%HaveSameMap(goodUser1, goodUser3)') as boolean), 'goodUser1 et goodUser3 doivent avoir la même map');
// console.assert((eval('%HaveSameMap(goodUser1, goodUser4)') as boolean), 'goodUser1 et goodUser4 doivent avoir la même map');

// =============================================================================
// PARTIE 5 — Comparer class vs literal vs Object.create
// =============================================================================
// Objectif : concevoir et exécuter votre propre benchmark comparant 3 approches
// de création d'objets. Vous devez :
//   1. Écrire les 3 approches (classe ES6, object literal, Object.create)
//   2. Créer 100 000 objets avec chaque approche
//   3. Mesurer le temps de CRÉATION et le temps d'ACCÈS aux propriétés
//   4. Vérifier que les objets d'une même approche partagent la même map
//
// Question de réflexion :
//   Les 3 approches produisent-elles la même performance ? Pourquoi ?
//   Les objets d'approches différentes partagent-ils la même map ?
// =============================================================================

separator('PARTIE 5 — class vs literal vs Object.create');

const COUNT = 100_000;

// TODO 5.1 : Écrivez une classe `UserClass` avec un constructeur
// qui initialise { name, age, active }

// TODO : class UserClass { ... }

// TODO 5.2 : Écrivez une fonction factory `createUserLiteral(name, age, active)`
// qui retourne un object literal { name, age, active }

// TODO : function createUserLiteral(...) { ... }

// TODO 5.3 : Écrivez un prototype et un factory avec Object.create.
// Le prototype peut contenir une méthode getInfo().
// Le factory crée les instances avec Object.create puis assigne les propriétés.

// TODO : const userPrototype = { ... };
// TODO : function createUserFromProto(...) { ... }

// TODO 5.4 : Créez 100 000 objets avec chaque approche et mesurez les temps.
// Utilisez bench() pour mesurer.

// TODO : benchmark de création

// TODO 5.5 : Mesurez le temps d'accès aux propriétés.

function sumAges(arr: { age: number }[]): number {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i].age;
  }
  return total;
}

// TODO : benchmark d'accès

// TODO 5.6 : Vérifiez les maps avec %HaveSameMap()
// Les objets d'une même approche doivent partager la même map.
// Les objets d'approches différentes ne partagent PAS la même map.

// Assertions attendues (décommentez après implémentation) :
// console.assert((eval('%HaveSameMap(classUsers[0], classUsers[1])') as boolean), 'instances de classe : même map');
// console.assert((eval('%HaveSameMap(literalUsers[0], literalUsers[1])') as boolean), 'literals : même map');
// console.assert((eval('%HaveSameMap(protoUsers[0], protoUsers[1])') as boolean), 'Object.create : même map');
// console.assert(!(eval('%HaveSameMap(classUsers[0], literalUsers[0])') as boolean), 'classe vs literal : maps différentes');

console.log('\n=== Lab 11 terminé ===');
