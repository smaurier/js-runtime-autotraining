// =============================================================================
// Lab 09 — V8 Optimization / Bytecode
// =============================================================================
// Commande : node --print-bytecode --print-bytecode-filter=hotFunction exercise.js
//
// Ce lab explore le bytecode genere par l'interpreteur Ignition de V8.
// Vous allez ecrire des fonctions, predire le bytecode attendu, puis
// verifier vos predictions avec les flags de Node.js.
// =============================================================================

// -----------------------------------------------------------------------------
// PARTIE 1 — Fonction chaude et bytecodes fondamentaux
// -----------------------------------------------------------------------------
// Objectif : ecrire une fonction arithmetique simple, l'appeler 10 000 fois
// pour qu'elle devienne "chaude", puis analyser le bytecode produit.
//
// Bytecodes a identifier dans la sortie :
//   LdaSmi [n]   — charge un petit entier (Small Integer) dans l'accumulateur
//   Star rN      — stocke l'accumulateur dans le registre rN
//   Add rN, [s]  — additionne l'accumulateur avec le registre rN
//   MulSmi [n]   — multiplie l'accumulateur par un petit entier
//   Return       — retourne la valeur de l'accumulateur
// -----------------------------------------------------------------------------

// TODO 1.1 : Ecrivez une fonction `hotFunction(a, b)` qui :
//   - multiplie a par 2
//   - ajoute b au resultat
//   - ajoute la constante 42
//   - retourne le resultat final
// Gardez-la simple pour que le bytecode soit lisible.

function hotFunction(a: number, b: number): number {
  // TODO : implementez le calcul (a * 2) + b + 42
  // 💡 Indice : une seule ligne suffit avec return et les operateurs *, +
}

// TODO 1.2 : Appelez hotFunction 10 000 fois avec des entiers
// pour la rendre chaude dans le moteur V8.
// Utilisez une boucle for classique.

// TODO : boucle d'appel ici

// TODO 1.3 : AVANT de lancer la commande --print-bytecode,
// ecrivez vos predictions ci-dessous.
// Quels bytecodes attendez-vous pour hotFunction ? Dans quel ordre ?
//
// Predictions :
// 1. _______________________________
// 2. _______________________________
// 3. _______________________________
// 4. _______________________________
// 5. _______________________________
// 6. _______________________________

console.log('--- Partie 1 terminee ---');
console.log('Resultat hotFunction(3, 7) :', hotFunction(3, 7));

// -----------------------------------------------------------------------------
// PARTIE 2 — Comparaison let / var / const et stabilite de types
// -----------------------------------------------------------------------------
// Objectif : observer comment le choix de declaration et la stabilite
// des types influencent le bytecode genere.
//
// Commandes :
//   node --print-bytecode --print-bytecode-filter=withLet exercise.js
//   node --print-bytecode --print-bytecode-filter=withVar exercise.js
//   node --print-bytecode --print-bytecode-filter=withConst exercise.js
//   node --print-bytecode --print-bytecode-filter=typeStable exercise.js
//   node --print-bytecode --print-bytecode-filter=typeUnstable exercise.js
// -----------------------------------------------------------------------------

// TODO 2.1 : Ecrivez trois fonctions qui font le meme calcul (a + b + 10)
// mais avec des variables intermediaires declarees differemment.

function withLet(a: number, b: number): number {
  // TODO : utilisez `let result = a + b` puis `result = result + 10`, retournez result
  // 💡 Indice : let permet la reassignation, donc result = result + 10 est valide
}

function withVar(a: number, b: number): number {
  // TODO : utilisez `var result = a + b` puis `result = result + 10`, retournez result
}

function withConst(a: number, b: number): number {
  // TODO : utilisez `const sum = a + b` puis `const result = sum + 10`, retournez result
  // 💡 Indice : const ne peut pas etre reassigne, donc il faut 2 variables distinctes
}

// TODO 2.2 : Appelez chaque fonction 5 000 fois avec des entiers

// TODO : boucles d'appel pour withLet, withVar, withConst

// TODO 2.3 : Ecrivez une fonction `typeStable(x)` qui fait x * 2 + 1.
// Appelez-la 5 000 fois UNIQUEMENT avec des entiers.

function typeStable(x: any): any {
  // TODO : retournez x * 2 + 1
}

// TODO : boucle d'appel typeStable (uniquement des entiers)

// TODO 2.4 : Ecrivez une fonction `typeUnstable(x)` avec le MEME corps
// que typeStable. Mais appelez-la avec un melange de types :
// entiers, flottants, chaines de caracteres, booleens.

function typeUnstable(x: any): any {
  // TODO : retournez x * 2 + 1 (meme corps que typeStable)
}

// TODO : boucle d'appel typeUnstable avec des types varies
// Exemples de valeurs a utiliser : 1, 2, 4.5, 6.7, 'hello', true, false, null

// TODO 2.5 : PREDICTIONS — quel bytecode sera different entre
// typeStable et typeUnstable ? Pourquoi ?
//
// Predictions :
// typeStable  : ________________________________________
// typeUnstable : ________________________________________
// Difference attendue : ________________________________

console.log('--- Partie 2 terminee ---');

// -----------------------------------------------------------------------------
// PARTIE 3 — Monomorphe vs Megamorphe
// -----------------------------------------------------------------------------
// Objectif : creer deux versions d'un meme calcul.
// - Version monomorphe : toujours la meme forme d'objet (meme hidden class)
// - Version megamorphe : formes d'objets differentes a chaque appel
//
// Comparez la taille du bytecode et surtout l'etat des Inline Caches.
//
// Commandes :
//   node --print-bytecode --print-bytecode-filter=monoAccess exercise.js
//   node --print-bytecode --print-bytecode-filter=megaAccess exercise.js
// -----------------------------------------------------------------------------

// TODO 3.1 : Ecrivez une fonction `monoAccess(obj)` qui lit obj.x et obj.y,
// et retourne leur somme. C'est la version monomorphe.

function monoAccess(obj: { x: number; y: number }): number {
  // TODO : retournez obj.x + obj.y
  // 💡 Indice : acces simple aux proprietes avec l'operateur point
}

// TODO 3.2 : Creez 10 000 objets avec EXACTEMENT la meme structure { x, y }
// (memes proprietes, meme ordre) et passez-les a monoAccess.

// TODO : boucle monomorphe ici
// Tous les objets doivent etre { x: valeur, y: valeur }

// TODO 3.3 : Ecrivez une fonction `megaAccess(obj)` avec le meme corps
// que monoAccess.

function megaAccess(obj: { x: number; y: number }): number {
  // TODO : retournez obj.x + obj.y (meme corps que monoAccess)
}

// TODO 3.4 : Creez 10 000 objets avec des structures DIFFERENTES
// et passez-les a megaAccess. Utilisez au moins 5 formes differentes.
//
// Exemples de formes differentes a alterner :
//   { x: 1, y: 2 }               — forme 1
//   { y: 2, x: 1 }               — forme 2 (ordre inverse)
//   { x: 1, y: 2, z: 3 }         — forme 3 (propriete en plus)
//   { a: 0, x: 1, y: 2 }         — forme 4 (propriete avant)
//   { x: 1, y: 2, toString() {} } — forme 5 (methode en plus)
//   Object.create(null) avec x, y — forme 6 (prototype different)

// TODO : boucle megamorphe ici — alternez entre les formes

// TODO 3.5 : PREDICTIONS — de combien le bytecode de megaAccess sera-t-il
// plus volumineux que celui de monoAccess ?
// Indice : le bytecode brut sera quasi identique. La difference se situe
// dans l'etat du feedback vector (monomorphe vs megamorphe).
//
// Predictions :
// _____________________________________________
// _____________________________________________

console.log('--- Partie 3 terminee ---');

// -----------------------------------------------------------------------------
// PARTIE 4 — Operations natives : bytecode compact vs volumineux
// -----------------------------------------------------------------------------
// Objectif : identifier quelles operations JavaScript produisent
// un bytecode compact et lesquelles produisent du bytecode volumineux.
//
// Commandes :
//   node --print-bytecode --print-bytecode-filter=compactOps exercise.js
//   node --print-bytecode --print-bytecode-filter=bloatedOps exercise.js
//   node --print-bytecode --print-bytecode-filter=withSpread exercise.js
//   node --print-bytecode --print-bytecode-filter=withManual exercise.js
// -----------------------------------------------------------------------------

// TODO 4.1 : Ecrivez une fonction `compactOps(arr)` qui :
//   - accede a arr[0] et arr[1]
//   - fait une addition des deux valeurs
//   - retourne le resultat
// C'est une operation simple qui devrait generer peu de bytecodes.

function compactOps(arr: number[]): number {
  // TODO : retournez arr[0] + arr[1]
}

// TODO 4.2 : Ecrivez une fonction `bloatedOps(obj)` qui :
//   - utilise `delete obj.temp` pour supprimer une propriete
//   - accede a une propriete via une cle dynamique : obj[Object.keys(obj)[0]]
//   - fait un `typeof` sur le resultat
//   - utilise l'operateur `in` : 'x' in obj
//   - retourne un objet contenant les resultats
// Ces operations generent beaucoup plus de bytecodes.

function bloatedOps(obj: any): any {
  // TODO : implementez les 4 operations lourdes decrites ci-dessus
  // et retournez { value, type, hasX } par exemple
  // 💡 Indice : delete obj.temp supprime une propriete de l'objet.
  //    Object.keys(obj)[0] retourne le nom de la premiere propriete.
  //    typeof value retourne le type sous forme de chaine.
  //    'x' in obj retourne true si obj a une propriete x.
}

// TODO 4.3 : Ecrivez deux fonctions pour comparer spread vs copie manuelle.
//
// `withSpread(source)` retourne { ...source, extra: 1 }
// `withManual(source)` retourne { x: source.x, y: source.y, extra: 1 }
//
// Quelle version genere moins de bytecode ?

function withSpread(source: any): any {
  // TODO : retournez { ...source, extra: 1 }
}

function withManual(source: { x: number; y: number }): { x: number; y: number; extra: number } {
  // TODO : retournez { x: source.x, y: source.y, extra: 1 }
}

// TODO 4.4 : Appelez toutes les fonctions de la partie 4 suffisamment
// de fois (5 000 iterations minimum) pour generer du bytecode observable.

// TODO : boucles d'appel pour compactOps, bloatedOps, withSpread, withManual

// TODO 4.5 : PREDICTIONS — classez ces operations de la plus compacte
// a la plus volumineuse en bytecode :
//   - Addition de nombres
//   - Acces a un index de tableau
//   - Copie manuelle de proprietes
//   - delete d'une propriete
//   - Object.keys() + acces dynamique
//   - Spread d'objet
//
// Votre classement (1 = plus compact, 6 = plus volumineux) :
// 1. _______________________________
// 2. _______________________________
// 3. _______________________________
// 4. _______________________________
// 5. _______________________________
// 6. _______________________________

console.log('--- Partie 4 terminee ---');
console.log('=== Lab 09 termine — lancez avec --print-bytecode pour verifier vos predictions ===');
