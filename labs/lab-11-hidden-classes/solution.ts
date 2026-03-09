// =============================================================================
// Lab 11 — Hidden Classes — SOLUTION
// =============================================================================
// Commande : node --import tsx/esm --allow-natives-syntax solution.ts
//
// Cette solution explique en detail POURQUOI chaque resultat %HaveSameMap()
// est vrai ou faux, et la theorie des hidden classes sous-jacente.
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

// =============================================================================
// PARTIE 1 — Partage de hidden classes avec %HaveSameMap()
// =============================================================================
// THEORIE DES HIDDEN CLASSES :
// V8 associe a chaque objet une "map" (hidden class) qui decrit sa structure :
// - Quelles proprietes existent
// - Dans quel ORDRE elles ont ete ajoutees
// - A quels offsets memoire elles sont stockees
// - Quels sont leurs attributs (writable, enumerable, configurable)
//
// Quand deux objets ont la meme map, V8 sait que la propriete .x est
// au MEME offset memoire dans les deux objets. Cela permet aux Inline Caches
// de verifier UNE SEULE map et d'acceder directement par offset.
// =============================================================================

console.log('=== PARTIE 1 : Partage de hidden classes ===\n');

// --- Test 1A : Meme proprietes, meme ordre → MEME map ---
// POURQUOI : V8 cree un arbre de transitions. Le chemin de creation
// {} → {x} → {x, y} est le meme pour les deux objets.
// Ils aboutissent donc a la meme map finale.
const obj1a = { x: 1, y: 2 };
const obj1b = { x: 10, y: 20 };
console.log('1A - Meme forme {x, y} :', (eval('%HaveSameMap(obj1a, obj1b)') as boolean)); // true

// --- Test 1B : Ordre different → MAP DIFFERENTE ---
// POURQUOI : l'ordre d'ajout des proprietes determine le chemin dans
// l'arbre de transitions. {} → {x} → {x,y} est un chemin DIFFERENT
// de {} → {y} → {y,x}. Les deux chemins menent a des maps differentes
// car les offsets memoire sont differents :
//   {x, y} : x est a l'offset 0, y a l'offset 1
//   {y, x} : y est a l'offset 0, x a l'offset 1
const obj2a = { x: 1, y: 2 };
const obj2b = { y: 2, x: 1 };
console.log('1B - Ordre different {x,y} vs {y,x} :', (eval('%HaveSameMap(obj2a, obj2b)') as boolean)); // false

// --- Test 1C : Ajout dynamique → MAP DIFFERENTE ---
// POURQUOI : apres la creation, obj3b fait une transition supplementaire
// pour ajouter z. Sa map est maintenant celle de {x, y, z} tandis que
// obj3a a la map de {x, y}. Deux structures differentes = deux maps.
const obj3a = { x: 1, y: 2 };
const obj3b = { x: 1, y: 2 };
obj3b.z = 3;
console.log('1C - Apres ajout dynamique de z :', (eval('%HaveSameMap(obj3a, obj3b)') as boolean)); // false

// --- Test 1D : Types de valeurs differents ---
// POURQUOI : dans les versions modernes de V8, la representation interne
// des valeurs affecte la map. Un Smi (Small Integer, 31 bits) est stocke
// directement dans le champ de l'objet (tagged pointer), tandis qu'un
// Double (nombre flottant) est stocke dans un champ de taille differente
// (64 bits non-tagge). V8 utilise des "field representations" dans la map
// pour distinguer ces cas, ce qui donne des maps differentes.
const obj4a = { x: 1, y: 2 };
const obj4b = { x: 1.5, y: 2 };
console.log('1D - Smi vs Double :', (eval('%HaveSameMap(obj4a, obj4b)') as boolean));
// Resultat : souvent false (depend de la version V8 et de l'heuristique)

// --- Test 1E : delete → MAP DIFFERENTE (passage en slow mode) ---
// POURQUOI : `delete` est la pire operation pour les hidden classes.
// Il fait passer l'objet en "dictionary mode" (slow properties) :
// au lieu d'offsets fixes, les proprietes sont stockees dans une hash table.
// C'est 10-100x plus lent pour l'acces aux proprietes car V8 ne peut
// plus utiliser d'Inline Cache efficace.
const obj5a = { x: 1, y: 2, z: 3 };
const obj5b = { x: 1, y: 2, z: 3 };
delete obj5b.z;
console.log('1E - Apres delete :', (eval('%HaveSameMap(obj5a, obj5b)') as boolean)); // false

// --- Test 1F : Instances d'une classe → MEME map ---
// POURQUOI : le constructeur ES6 est un code deterministe qui ajoute
// TOUJOURS les memes proprietes dans le MEME ordre (this.x puis this.y).
// Toutes les instances suivent le meme chemin de transition dans l'arbre.
// C'est LA raison principale pour laquelle les classes sont recommandees
// pour les performances : elles garantissent des hidden classes stables.
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
console.log('1F - Instances de la meme classe :', (eval('%HaveSameMap(p1, p2)') as boolean)); // true

console.log();

// =============================================================================
// PARTIE 2 — Benchmark : monomorphe vs polymorphe vs megamorphe
// =============================================================================
// THEORIE DES INLINE CACHES (IC) :
// V8 utilise des IC pour accelerer les acces aux proprietes.
// L'IC enregistre la map de l'objet et l'offset de la propriete.
//
// - Monomorphe (1 map) : 1 comparaison, acces direct → ~3 ns
// - Polymorphe (2-4 maps) : table de lookup lineaire → ~10-15 ns
// - Megamorphe (5+ maps) : lookup generique hash table → ~30-100 ns
//
// La degradation est souvent 3-10x entre mono et mega.
// =============================================================================

console.log('=== PARTIE 2 : Benchmark mono vs poly vs mega ===\n');

// MONOMORPHE : 1 000 objets avec la meme forme
const monoArray = [];
for (let i = 0; i < 1_000; i++) {
  monoArray.push({ x: i, y: i * 2, z: i * 3 });
}

// POLYMORPHE : 1 000 objets avec 4 formes
// POURQUOI 4 : V8 maintient un IC polymorphe jusqu'a 4 maps.
// Au-dela, il passe en megamorphe.
const polyArray = [];
for (let i = 0; i < 1_000; i++) {
  switch (i % 4) {
    case 0: polyArray.push({ x: i, y: i * 2, z: i * 3 }); break;
    case 1: polyArray.push({ x: i, y: i * 2, z: i * 3, a: 1 }); break;
    case 2: polyArray.push({ x: i, y: i * 2, z: i * 3, b: 2 }); break;
    case 3: polyArray.push({ x: i, y: i * 2, z: i * 3, c: 3 }); break;
  }
}

// MEGAMORPHE : 1 000 objets avec 8 formes differentes
// POURQUOI c'est mauvais : l'IC abandonne toute specialisation.
// V8 fait un lookup generique a chaque acces, ce qui est beaucoup plus lent.
const megaArray = [];
for (let i = 0; i < 1_000; i++) {
  switch (i % 8) {
    case 0: megaArray.push({ x: i, y: i * 2, z: i * 3 }); break;
    case 1: megaArray.push({ x: i, y: i * 2, z: i * 3, a: 1 }); break;
    case 2: megaArray.push({ x: i, y: i * 2, z: i * 3, b: 2 }); break;
    case 3: megaArray.push({ x: i, y: i * 2, z: i * 3, c: 3 }); break;
    case 4: megaArray.push({ x: i, y: i * 2, z: i * 3, d: 4 }); break;
    case 5: megaArray.push({ x: i, y: i * 2, z: i * 3, e: 5 }); break;
    case 6: megaArray.push({ x: i, y: i * 2, z: i * 3, f: 6 }); break;
    case 7: megaArray.push({ x: i, y: i * 2, z: i * 3, g: 7 }); break;
  }
}

function sumX(arr: { x: number }[]): number {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i].x;
  }
  return total;
}

// Verifications
console.log('  Somme mono:', sumX(monoArray));
console.log('  Somme poly:', sumX(polyArray));
console.log('  Somme mega:', sumX(megaArray));

const timeMono = bench('sumX monomorphe (1 forme)', () => sumX(monoArray));
const timePoly = bench('sumX polymorphe (4 formes)', () => sumX(polyArray));
const timeMega = bench('sumX megamorphe (8 formes)', () => sumX(megaArray));

console.log(`  Ratio poly/mono : ${(timePoly / timeMono).toFixed(1)}x`);
console.log(`  Ratio mega/mono : ${(timeMega / timeMono).toFixed(1)}x`);

console.log();

// =============================================================================
// PARTIE 3 — Casser les hidden classes
// =============================================================================

console.log('=== PARTIE 3 : Casser les hidden classes ===\n');

// --- 3A : Ordre different d'ajout des proprietes ---
// POURQUOI l'ordre compte : chaque ajout de propriete cree une TRANSITION
// dans l'arbre de maps. {} → +x → {x} → +y → {x,y} est une branche
// differente de {} → +z → {z} → +y → {z,y} → +x → {z,y,x}.
// Meme si les proprietes finales sont identiques, les offsets sont differents.
const objA1 = {};
objA1.x = 1;
objA1.y = 2;
objA1.z = 3;

const objA2 = {};
objA2.z = 3;
objA2.y = 2;
objA2.x = 1;

console.log('3A - Ordre different :', (eval('%HaveSameMap(objA1, objA2)') as boolean)); // false

// --- 3B : Suppression avec delete ---
// POURQUOI delete est destructeur : il fait passer l'objet en "slow mode"
// (dictionary properties). Les proprietes sont stockees dans une hash table
// au lieu d'offsets fixes. Meme si on re-ajoute la propriete supprimee,
// l'objet ne reviendra PAS en "fast mode". C'est irreversible.
const objB1 = { a: 1, b: 2, c: 3 };
const objB2 = { a: 1, b: 2, c: 3 };
delete objB2.c;

console.log('3B - Apres delete :', (eval('%HaveSameMap(objB1, objB2)') as boolean)); // false

// --- 3C : Object.defineProperty ---
// POURQUOI defineProperty change la map : les attributs de propriete
// (writable, enumerable, configurable) font partie de la description
// de la map. Si on change un attribut, la map change aussi.
// C'est different d'un simple changement de valeur qui ne touche pas la map.
const objC1 = { a: 1, b: 2 };
const objC2 = { a: 1, b: 2 };
Object.defineProperty(objC2, 'b', { writable: false });

console.log('3C - Apres defineProperty :', (eval('%HaveSameMap(objC1, objC2)') as boolean)); // false

console.log();

// =============================================================================
// PARTIE 4 — Corriger un factory function mal ecrit
// =============================================================================

console.log('=== PARTIE 4 : Corriger un factory function ===\n');

// --- Factory MAL ecrit ---
// Cree des objets avec des hidden classes incoherentes car :
// 1. Proprietes conditionnelles (certains objets les ont, d'autres non)
// 2. delete qui passe en slow mode
// 3. Bracket notation dynamique qui cree des noms de propriete uniques
function badCreateUser(name: string, age: number, options: any = {}): any {
  const user = {};
  if (options.isAdmin) user.isAdmin = true;  // Conditionnel
  user.name = name;
  if (age > 0) user.age = age;              // Conditionnel
  user.email = options.email || '';
  if (!options.email) delete user.email;      // delete = slow mode
  if (options.role) user[options.role + 'Level'] = 1; // Dynamique
  return user;
}

const badUser1 = badCreateUser('Alice', 30, { isAdmin: true, email: 'a@b.com' });
const badUser2 = badCreateUser('Bob', 25);
const badUser3 = badCreateUser('Charlie', -1, { role: 'editor' });
const badUser4 = badCreateUser('Diana', 40, { isAdmin: true, role: 'admin' });

console.log('BadUser - maps differentes :');
console.log('  badUser1 vs badUser2 :', (eval('%HaveSameMap(badUser1, badUser2)') as boolean)); // false
console.log('  badUser1 vs badUser3 :', (eval('%HaveSameMap(badUser1, badUser3)') as boolean)); // false
console.log('  badUser1 vs badUser4 :', (eval('%HaveSameMap(badUser1, badUser4)') as boolean)); // false

// --- Factory CORRIGE ---
// Principes appliques :
// 1. TOUJOURS initialiser les memes proprietes dans le MEME ordre
//    → garantit le meme chemin de transition dans l'arbre de maps
// 2. Utiliser des valeurs par defaut (false, 0, '', null) au lieu d'omissions
//    → chaque objet a TOUTES les proprietes, meme si la valeur est "vide"
// 3. JAMAIS utiliser delete
//    → evite le passage en slow mode (dictionary properties)
// 4. JAMAIS utiliser bracket notation dynamique pour les noms
//    → les noms de proprietes sont connus statiquement a la compilation
// 5. Stocker les donnees dynamiques dans une Map() ou un sous-objet fixe
//    → isole les donnees variables sans casser la hidden class principale
function goodCreateUser(name: string, age: number, options: any = {}): any {
  return {
    name,                              // Toujours present, meme ordre
    age: age > 0 ? age : 0,           // Toujours un nombre, jamais absent
    email: options.email || '',        // Toujours une chaine, jamais absent
    isAdmin: Boolean(options.isAdmin), // Toujours un boolean, jamais absent
    role: options.role || null,        // Toujours present, null si pas de role
  };
}

const goodUser1 = goodCreateUser('Alice', 30, { isAdmin: true, email: 'a@b.com' });
const goodUser2 = goodCreateUser('Bob', 25);
const goodUser3 = goodCreateUser('Charlie', -1, { role: 'editor' });
const goodUser4 = goodCreateUser('Diana', 40, { isAdmin: true, role: 'admin' });

console.log('\nGoodUser - toutes les maps identiques :');
console.log('  goodUser1 vs goodUser2 :', (eval('%HaveSameMap(goodUser1, goodUser2)') as boolean)); // true
console.log('  goodUser1 vs goodUser3 :', (eval('%HaveSameMap(goodUser1, goodUser3)') as boolean)); // true
console.log('  goodUser1 vs goodUser4 :', (eval('%HaveSameMap(goodUser1, goodUser4)') as boolean)); // true

// Benchmark comparatif
function accessUserFields(user: any): number {
  return user.name.length + user.age + user.email.length;
}

const badUsers = [];
const goodUsers = [];
for (let i = 0; i < 10_000; i++) {
  badUsers.push(badCreateUser(`user${i}`, i, {
    isAdmin: i % 3 === 0,
    email: i % 2 === 0 ? `user${i}@test.com` : undefined,
    role: i % 4 === 0 ? 'admin' : undefined,
  }));
  goodUsers.push(goodCreateUser(`user${i}`, i, {
    isAdmin: i % 3 === 0,
    email: i % 2 === 0 ? `user${i}@test.com` : undefined,
    role: i % 4 === 0 ? 'admin' : undefined,
  }));
}

function sumFieldLengths(arr: any[]): number {
  let total = 0;
  for (const user of arr) {
    total += accessUserFields(user);
  }
  return total;
}

console.log('\nBenchmark factory :');
const timeBad = bench('badCreateUser (maps heterogenes)', () => sumFieldLengths(badUsers));
const timeGood = bench('goodCreateUser (maps homogenes)', () => sumFieldLengths(goodUsers));
console.log(`  → goodCreateUser est ${(timeBad / timeGood).toFixed(1)}x plus rapide`);

console.log();

// =============================================================================
// PARTIE 5 — Comparer class vs literal vs Object.create (100 000 objets)
// =============================================================================
// POURQUOI cette comparaison est importante :
//
// - Classe ES6 : le constructeur garantit un ordre de proprietes deterministe.
//   V8 optimise specifiquement les constructeurs de classe pour pre-allouer
//   la bonne quantite de memoire et assigner les proprietes aux bons offsets.
//   C'est generalement la methode la plus rapide a la CREATION.
//
// - Object literal : le parser de V8 analyse le literal a la compilation
//   et pre-calcule la map finale. C'est aussi tres rapide car V8 utilise
//   un "boilerplate" (template) pour cloner rapidement les literals identiques.
//
// - Object.create : cree un objet avec un prototype specifique, puis
//   les proprietes sont ajoutees une par une. C'est plus lent car V8
//   ne peut pas pre-calculer la map finale (elle depend des ajouts).
// =============================================================================

console.log('=== PARTIE 5 : class vs literal vs Object.create ===\n');

const COUNT = 100_000;

// --- Methode 1 : Classe ES6 ---
class UserClass {
  name: string;
  age: number;
  active: boolean;
  constructor(name: string, age: number, active: boolean) {
    this.name = name;
    this.age = age;
    this.active = active;
  }
}

// --- Methode 2 : Object literal ---
function createUserLiteral(name: string, age: number, active: boolean): { name: string; age: number; active: boolean } {
  return { name, age, active };
}

// --- Methode 3 : Object.create ---
const userPrototype = {
  getInfo() {
    return `${this.name} (${this.age})`;
  },
};

function createUserFromProto(name: string, age: number, active: boolean): any {
  const user = Object.create(userPrototype);
  user.name = name;
  user.age = age;
  user.active = active;
  return user;
}

// Benchmark de CREATION
const classUsers = [];
const literalUsers = [];
const protoUsers = [];

const timeCreateClass = bench('Creation class (100k)', () => {
  classUsers.length = 0;
  for (let i = 0; i < COUNT; i++) {
    classUsers.push(new UserClass(`u${i}`, i, true));
  }
}, 10);

const timeCreateLiteral = bench('Creation literal (100k)', () => {
  literalUsers.length = 0;
  for (let i = 0; i < COUNT; i++) {
    literalUsers.push(createUserLiteral(`u${i}`, i, true));
  }
}, 10);

const timeCreateProto = bench('Creation Object.create (100k)', () => {
  protoUsers.length = 0;
  for (let i = 0; i < COUNT; i++) {
    protoUsers.push(createUserFromProto(`u${i}`, i, true));
  }
}, 10);

console.log(`  Ratio class/literal : ${(timeCreateClass / timeCreateLiteral).toFixed(2)}x`);
console.log(`  Ratio proto/literal : ${(timeCreateProto / timeCreateLiteral).toFixed(2)}x`);

// Benchmark d'ACCES
function sumAges(arr: { age: number }[]): number {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i].age;
  }
  return total;
}

console.log();
console.log('Benchmark acces :');
const timeAccessClass = bench('Acces class (100k)', () => sumAges(classUsers));
const timeAccessLiteral = bench('Acces literal (100k)', () => sumAges(literalUsers));
const timeAccessProto = bench('Acces Object.create (100k)', () => sumAges(protoUsers));

console.log(`  Ratio access class/literal : ${(timeAccessClass / timeAccessLiteral).toFixed(2)}x`);
console.log(`  Ratio access proto/literal : ${(timeAccessProto / timeAccessLiteral).toFixed(2)}x`);

// Verification des maps
console.log();
console.log('Verification des maps :');
console.log('  class[0] vs class[1] :', (eval('%HaveSameMap(classUsers[0], classUsers[1])') as boolean));       // true
console.log('  literal[0] vs literal[1] :', (eval('%HaveSameMap(literalUsers[0], literalUsers[1])') as boolean)); // true
console.log('  proto[0] vs proto[1] :', (eval('%HaveSameMap(protoUsers[0], protoUsers[1])') as boolean));         // true
console.log('  class[0] vs literal[0] :', (eval('%HaveSameMap(classUsers[0], literalUsers[0])') as boolean));     // false
console.log('  class[0] vs proto[0] :', (eval('%HaveSameMap(classUsers[0], protoUsers[0])') as boolean));         // false

// POURQUOI class[0] et literal[0] ont des maps differentes meme avec
// les memes proprietes : ils ont des prototypes differents.
// UserClass.prototype vs Object.prototype. La map inclut la reference
// au prototype, donc des prototypes differents = maps differentes.

console.log();
console.log('=== Resume ===');
console.log('1. L\'ORDRE des proprietes determine la hidden class (meme proprietes, ordre different = map differente)');
console.log('2. `delete` fait passer l\'objet en slow mode (dictionnaire) — IRREVERSIBLE');
console.log('3. `Object.defineProperty` qui change les attributs change la map');
console.log('4. Les classes ES6 garantissent des hidden classes stables (constructeur deterministe)');
console.log('5. Monomorphe est 3-10x plus rapide que megamorphe pour l\'acces aux proprietes');
console.log('6. TOUJOURS initialiser les memes proprietes dans le meme ordre avec des valeurs par defaut');
console.log();
console.log('=== Lab 11 termine ===');
