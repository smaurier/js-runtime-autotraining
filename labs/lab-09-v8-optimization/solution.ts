// =============================================================================
// Lab 09 — V8 Optimization / Bytecode — SOLUTION
// =============================================================================
// Commande : node --print-bytecode --print-bytecode-filter=hotFunction solution.js
//
// Cette solution detaille le bytecode attendu pour chaque fonction et explique
// POURQUOI V8 genere tel ou tel bytecode.
// =============================================================================

// -----------------------------------------------------------------------------
// PARTIE 1 — Fonction chaude et bytecodes fondamentaux
// -----------------------------------------------------------------------------

// hotFunction fait un calcul simple : (a * 2) + b + 42
//
// POURQUOI cette fonction est ideale pour observer le bytecode :
// - Les operandes sont des Smi (Small Integers), V8 utilise LdaSmi/AddSmi/MulSmi
//   qui sont des instructions specialisees, plus rapides que les operations generiques.
// - Aucune conversion de type n'est necessaire car on passe toujours des entiers.
// - L'accumulateur (registre implicite) evite des copies inutiles entre registres.
//
// Bytecode attendu (simplifie) :
//   Ldar a0            — charge le parametre `a` dans l'accumulateur
//   MulSmi [2], [slot] — multiplie l'accumulateur par le petit entier 2
//   Star r0            — stocke le resultat intermediaire dans r0
//   Ldar a1            — charge le parametre `b`
//   Add r0, [slot]     — additionne avec r0 (resultat de a*2)
//   AddSmi [42], [slot] — ajoute le petit entier 42
//   Return             — retourne la valeur de l'accumulateur

function hotFunction(a: number, b: number): number {
  const doubled = a * 2;      // MulSmi [2]
  const withB = doubled + b;  // Add rN
  return withB + 42;          // AddSmi [42], Return
}

// On appelle la fonction 10 000 fois pour la rendre "chaude".
// POURQUOI 10 000 : V8 utilise un compteur d'invocations. Quand ce compteur
// depasse un seuil (~1000-2000 pour Ignition, ~10000 pour TurboFan),
// V8 considere la fonction comme "chaude" et collecte du feedback de type
// dans les feedback vector slots. Ce feedback sera exploite par TurboFan
// pour generer du code machine specialise.
for (let i = 0; i < 10_000; i++) {
  hotFunction(i, i + 1);
}

// Predictions pour hotFunction(a, b) :
// 1. Ldar a0            — charge le premier parametre (a)
// 2. MulSmi [2], [slot] — multiplication par la constante 2
// 3. Star r0            — stocke dans un registre temporaire
// 4. Ldar a1            — charge le deuxieme parametre (b)
// 5. Add r0, [slot]     — additionne a*2 + b
// 6. AddSmi [42], [slot] — ajoute la constante 42
// 7. Return             — retourne le resultat depuis l'accumulateur

console.log('--- Partie 1 terminee ---');
console.log('Resultat hotFunction(3, 7) :', hotFunction(3, 7)); // (3*2) + 7 + 42 = 55

// -----------------------------------------------------------------------------
// PARTIE 2 — Comparaison let / var / const et stabilite de types
// -----------------------------------------------------------------------------

// POURQUOI la difference entre let/var/const dans le bytecode :
//
// `const` : V8 sait que la valeur ne changera pas. Il peut omettre les
//   verifications de reassignation et eviter le bytecode ThrowReferenceErrorIfHole
//   lie a la Temporal Dead Zone.
//
// `let` : V8 genere potentiellement un check TDZ (ThrowReferenceErrorIfHole)
//   lors du premier acces si le compilateur ne peut pas prouver statiquement
//   que l'initialisation a deja eu lieu.
//
// `var` : pas de TDZ (hoistee a undefined), mais V8 doit gerer le hoisting.
//
// En PRATIQUE pour des fonctions simples comme celles-ci, la difference
// de bytecode est minime. La vraie difference se manifeste dans les closures
// et les boucles complexes.

function withLet(a: number, b: number): number {
  let result = a + b;   // Ldar a0, Add a1, Star r0
  result = result + 10; // Ldar r0, AddSmi [10]
  return result;        // Return
}

function withVar(a: number, b: number): number {
  var result = a + b;   // Bytecode quasi identique a withLet dans ce cas simple
  result = result + 10; // car il n'y a pas de closure ni de boucle
  return result;
}

function withConst(a: number, b: number): number {
  // POURQUOI const est legerement plus efficace ici :
  // V8 n'a pas besoin de generer de code pour verifier si `sum` ou `result`
  // sont reassignes plus tard. Le compilateur sait qu'ils sont finaux.
  // Deux variables const = deux registres distincts, mais pas de check TDZ.
  const sum = a + b;
  const result = sum + 10;
  return result;
}

// Chauffer les trois fonctions
for (let i = 0; i < 5_000; i++) {
  withLet(i, i + 1);
  withVar(i, i + 1);
  withConst(i, i + 1);
}

// POURQUOI la stabilite de type est CRUCIALE pour le bytecode :
//
// V8 utilise des "feedback vectors" attaches a chaque site d'operation.
// Quand un site voit TOUJOURS le meme type, le feedback est "monomorphe"
// et V8 peut generer du code specialise (ex: MulSmi pour entier * entier).
//
// Quand les types changent, le feedback devient "polymorphe" puis "megamorphe",
// et V8 doit generer du code generique qui gere TOUS les types possibles.
// Cela signifie des gardes de type supplementaires et des branchements.

function typeStable(x: any): any {
  return x * 2 + 1;
}

// Appel uniquement avec des entiers : le feedback reste monomorphe.
// V8 voit : Smi * Smi -> Smi, Smi + Smi -> Smi
// Bytecodes : MulSmi [2], AddSmi [1], Return — tres compact
for (let i = 0; i < 5_000; i++) {
  typeStable(i);
}

function typeUnstable(x: any): any {
  return x * 2 + 1;
}

// Appel avec des types varies : le feedback devient megamorphe.
//
// POURQUOI c'est problematique : l'operateur `*` se comporte differemment
// selon les types :
//   3 * 2 = 6          (entier, rapide)
//   3.5 * 2 = 7.0      (flottant, necessite conversion)
//   "hello" * 2 = NaN  (conversion string -> number -> NaN)
//   true * 2 = 2       (conversion boolean -> number)
//   null * 2 = 0       (conversion null -> 0)
//
// V8 doit generer du bytecode avec des gardes de type pour CHAQUE cas.
// Le bytecode est le meme en instructions, mais le feedback vector
// contient des etats differents qui empechent TurboFan d'optimiser.
const mixedValues = [
  1, 2, 3, 4.5, 6.7, 'hello', true, false, null, 0, -1, 3.14,
  'world', undefined, 42, 0.1, 'test', true, 99, 2.718,
];

for (let i = 0; i < 5_000; i++) {
  typeUnstable(mixedValues[i % mixedValues.length]);
}

// Predictions :
// typeStable  : MulSmi [2], AddSmi [1] — feedback monomorphe (Smi)
// typeUnstable : meme bytecode brut, MAIS feedback megamorphe
//   → TurboFan ne peut pas specialiser → code machine generique et lent

console.log('--- Partie 2 terminee ---');

// -----------------------------------------------------------------------------
// PARTIE 3 — Monomorphe vs Megamorphe
// -----------------------------------------------------------------------------

// POURQUOI le monomorphisme est crucial pour les acces aux proprietes :
//
// V8 utilise des "Inline Caches" (IC) pour accelerer l'acces aux proprietes.
// - Monomorphe : l'IC a vu UNE seule hidden class → acces direct par offset
//   memoire (~1 instruction machine)
// - Polymorphe (2-4 classes) : l'IC maintient une petite table de lookup
//   (~4-8 instructions machine)
// - Megamorphe (5+ classes) : l'IC abandonne et fait un lookup generique
//   via la hash table (~20-50 instructions machine)

function monoAccess(obj: { x: number; y: number }): number {
  return obj.x + obj.y;
  // Bytecodes :
  //   LdaNamedProperty a0, [0], [slot_x]  — charge obj.x via IC
  //   Star r0                              — stocke dans r0
  //   LdaNamedProperty a0, [1], [slot_y]  — charge obj.y via IC
  //   Add r0, [slot_add]                  — additionne
  //   Return
}

// Tous les objets ont EXACTEMENT la meme hidden class { x: Smi, y: Smi }.
// POURQUOI l'ordre de creation des proprietes compte : V8 cree la hidden class
// de maniere incrementale par transitions. { } → +x → { x } → +y → { x, y }.
// Si tous les objets suivent le meme chemin de transition, ils partagent
// la meme hidden class, et l'IC de monoAccess reste monomorphe.
for (let i = 0; i < 10_000; i++) {
  monoAccess({ x: i, y: i + 1 }); // Toujours { x, y } dans cet ordre
}

function megaAccess(obj: { x: number; y: number }): number {
  return obj.x + obj.y;
  // MEME bytecodes que monoAccess. La difference est INVISIBLE dans le
  // bytecode brut : elle se situe dans le feedback vector associe aux
  // slots IC. Apres 5+ formes differentes, les slots passent en etat
  // "megamorphic" et TurboFan ne peut plus inliner l'acces aux proprietes.
}

// On cree des objets avec des FORMES differentes (hidden classes differentes).
// POURQUOI chaque forme cree une hidden class differente :
// V8 utilise un arbre de transitions. Chaque chemin de creation distinct
// (ordre des proprietes, nombre de proprietes, prototype) definit
// une hidden class unique.
for (let i = 0; i < 10_000; i++) {
  const variant = i % 6;
  let obj;
  switch (variant) {
    case 0: obj = { x: i, y: i + 1 }; break;                        // forme 1
    case 1: obj = { y: i + 1, x: i }; break;                        // forme 2 (ordre inverse)
    case 2: obj = { x: i, y: i + 1, z: 0 }; break;                 // forme 3 (propriete en plus)
    case 3: obj = { a: 0, x: i, y: i + 1 }; break;                 // forme 4 (propriete avant x)
    case 4: obj = { x: i, y: i + 1, toString() { return ''; } }; break; // forme 5 (methode)
    case 5:                                                           // forme 6 (Object.create)
      obj = Object.create(null);
      obj.x = i;
      obj.y = i + 1;
      break;
  }
  megaAccess(obj);
}

// Predictions :
// Le bytecode de megaAccess est IDENTIQUE a monoAccess en instructions.
// La difference est dans le feedback vector :
// - monoAccess : IC monomorphe → 1 instruction machine pour l'acces
// - megaAccess : IC megamorphe → 20-50 instructions (lookup generique)
// L'impact sur les performances est enorme meme si le bytecode est identique.

console.log('--- Partie 3 terminee ---');

// -----------------------------------------------------------------------------
// PARTIE 4 — Operations natives : bytecode compact vs volumineux
// -----------------------------------------------------------------------------

// POURQUOI certaines operations generent plus de bytecode :
// Les operations "primitives" (arithmetique, acces par index) ont des bytecodes
// dedies dans Ignition. Les operations complexes (delete, typeof, in,
// Object.keys, spread) necessitent des appels a des builtins ou des
// runtime functions qui generent BEAUCOUP plus de bytecodes.

function compactOps(arr: number[]): number {
  // Bytecodes attendus (tres compact, ~4-5 instructions) :
  //   LdaKeyedProperty a0, [0], [slot]  — charge arr[0]
  //   Star r0
  //   LdaKeyedProperty a0, [1], [slot]  — charge arr[1]
  //   Add r0, [slot]                    — additionne
  //   Return
  //
  // POURQUOI c'est compact : l'acces par index numerique et l'addition
  // sont des operations fondamentales avec des bytecodes dedies.
  return arr[0] + arr[1];
}

function bloatedOps(obj: any): any {
  // `delete obj.temp` genere DeletePropertyStrict
  // POURQUOI c'est lourd meme si c'est 1 seul bytecode : delete modifie
  // la hidden class de l'objet, V8 doit gerer la transition vers une
  // nouvelle hidden class et potentiellement invalider tous les inline
  // caches qui referencaient l'ancienne hidden class.
  delete obj.temp;

  // `Object.keys(obj)[0]` genere ~6-8 bytecodes :
  //   LdaGlobal [Object], Star rN
  //   LdaNamedProperty rN [keys], Star rM
  //   CallProperty1 rM, rN, a0    — appelle Object.keys(obj)
  //   Star rK
  //   LdaKeyedProperty rK, [0]    — accede au premier element
  //
  // POURQUOI c'est lourd : Object.keys() est un appel de runtime qui
  // enumere toutes les proprietes, cree un tableau, puis on y accede.
  const firstKey = Object.keys(obj)[0];
  const value = obj[firstKey]; // Acces dynamique via LdaKeyedProperty

  // typeof genere un seul bytecode TypeOf — assez compact
  const type = typeof value;

  // 'x' in obj genere TestIn — un bytecode mais plus lourd en runtime
  // que LdaNamedProperty car il doit parcourir la chaine de prototypes
  const hasX = 'x' in obj;

  return { value, type, hasX };
}

// POURQUOI le spread est plus lourd que la copie manuelle :
// Le spread `{ ...source }` genere un appel au builtin CopyDataProperties
// qui doit :
// 1. Creer un nouvel objet vide
// 2. Enumerer TOUTES les proprietes enumerables de source
// 3. Les copier une par une (sans connaitre leur nombre a l'avance)
// 4. Ajouter les proprietes supplementaires
// C'est generique et donc volumineux en bytecode.

function withSpread(source: any): any {
  // Genere : CreateObjectLiteral, puis appel a CopyDataProperties builtin
  // V8 ne connait pas la forme finale de l'objet au moment de la compilation.
  return { ...source, extra: 1 };
}

function withManual(source: { x: number; y: number }): { x: number; y: number; extra: number } {
  // Genere : CreateObjectLiteral avec les proprietes connues a l'avance
  // POURQUOI c'est plus efficace : V8 connait la forme finale de l'objet
  // au moment de la compilation. Il cree directement un objet avec la
  // bonne hidden class { x, y, extra } sans enumerer les proprietes de source.
  // C'est plus de bytecodes individuels (LdaNamedProperty pour chaque prop)
  // mais chaque bytecode est simple et specialisable.
  return { x: source.x, y: source.y, extra: 1 };
}

// Chauffer toutes les fonctions de la partie 4
for (let i = 0; i < 5_000; i++) {
  compactOps([i, i + 1]);
  bloatedOps({ x: i, y: i + 1, temp: 'remove-me' });
  withSpread({ x: i, y: i + 1 });
  withManual({ x: i, y: i + 1 });
}

// Classement des operations de la plus compacte a la plus volumineuse :
//
// 1. Addition de nombres (Add / AddSmi) — 1-2 bytecodes
//    POURQUOI : operation primitive avec bytecode dedie, aucun appel de runtime
//
// 2. Acces a un index de tableau (LdaKeyedProperty) — 1-2 bytecodes
//    POURQUOI : operation primitive avec un seul bytecode + feedback IC
//
// 3. Copie manuelle de proprietes — ~5-8 bytecodes
//    POURQUOI : un LdaNamedProperty par propriete + CreateObjectLiteral,
//    mais chaque bytecode est simple et connu a la compilation
//
// 4. delete d'une propriete (DeletePropertyStrict) — 1 bytecode MAIS
//    effet de bord enorme sur les hidden classes et les IC en runtime
//    POURQUOI : le bytecode est court mais le travail sous-jacent est considerable
//
// 5. Object.keys() + acces dynamique — ~8-12 bytecodes
//    POURQUOI : appel de runtime + creation de tableau + acces dynamique
//
// 6. Spread d'objet (CopyDataProperties builtin) — appel builtin generique
//    POURQUOI : operation generique non-specialisable a la compilation

console.log('--- Partie 4 terminee ---');
console.log('=== Lab 09 termine — lancez avec --print-bytecode pour verifier vos predictions ===');
