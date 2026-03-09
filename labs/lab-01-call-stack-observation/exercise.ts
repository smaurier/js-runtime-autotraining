// =============================================================================
// Lab 01 — Observer la Call Stack
// =============================================================================
// Exécuter avec : npx tsx exercise.ts
// =============================================================================

console.log("=== Lab 01 : Observer la Call Stack ===\n");

// =============================================================================
// PARTIE 1 : Prédire l'état de la pile d'appels
// =============================================================================
// Les fonctions ci-dessous s'appellent en cascade.
// À chaque point marqué PREDICTION, écrivez l'état de la pile d'appels
// tel que vous le prédisez (de la fonction la plus récente à la plus ancienne).
// Exemple de format : "delta -> gamma -> beta -> alpha -> main"
// =============================================================================

function alpha(): void {
  // Point A — La pile à cet instant précis :
  // TODO : Remplacez null par votre prédiction (chaîne de caractères)
  const predictionA: string | null = null;

  beta();
}

function beta(): void {
  // Point B
  // TODO : Remplacez null par votre prédiction
  const predictionB: string | null = null;

  gamma();
}

function gamma(): void {
  // Point C
  // TODO : Remplacez null par votre prédiction
  const predictionC: string | null = null;

  delta();
}

function delta(): void {
  // Point D — Nous sommes au plus profond de la chaîne
  // TODO : Remplacez null par votre prédiction
  const predictionD: string | null = null;

  // Vérifions vos prédictions avec la vraie trace
  const realStack: string | undefined = new Error().stack;
  console.log("--- Partie 1 : Vérification des prédictions ---");
  console.log("Trace réelle au point D :");
  console.log(realStack);
  console.log();

  // TODO : Utilisez console.trace() ici pour comparer avec Error().stack
  // Quelle différence observez-vous entre les deux méthodes ?
}

function main(): void {
  alpha();
}

main();

// =============================================================================
// PARTIE 2 : Capture de stack traces à chaque niveau de récursion
// =============================================================================
// Implémentez cette fonction qui effectue `depth` niveaux de récursion
// et capture la stack trace à chaque niveau.
// Elle doit retourner un tableau de stack traces (chaînes de caractères).
// =============================================================================

console.log("\n--- Partie 2 : Capture récursive de stack traces ---");

function captureStackAtEachLevel(depth: number, currentLevel: number = 0, traces: string[] = []): string[] {
  // TODO : Implémentez cette fonction
  // 1. Capturez la stack trace du niveau courant avec new Error().stack
  // 2. Si currentLevel < depth - 1, appelez récursivement avec currentLevel + 1
  // 3. Retournez le tableau `traces` rempli
  // 4. Chaque élément de traces doit être la stack trace à ce niveau

  return traces; // À modifier
}

const traces: string[] = captureStackAtEachLevel(5);

// Vérification
if (traces.length === 0) {
  console.log("La fonction captureStackAtEachLevel n'est pas encore implémentée.");
} else {
  console.log(`Nombre de traces capturées : ${traces.length}`);
  traces.forEach((trace: string, i: number) => {
    const frameCount: number = trace.split("\n").filter((l: string) => l.trim().startsWith("at")).length;
    console.log(`  Niveau ${i} : ${frameCount} frames dans la pile`);
  });
  console.log();
  // TODO : Qu'observez-vous concernant le nombre de frames à chaque niveau ?
  // Écrivez votre observation ici en commentaire.
}

// =============================================================================
// PARTIE 3 : Trouver la profondeur maximale de la pile
// =============================================================================
// Implémentez findMaxStackDepth() pour déterminer le nombre maximal
// d'appels récursifs avant que la pile ne déborde.
// =============================================================================

console.log("--- Partie 3 : Profondeur maximale de la pile ---");

interface StackDepthResult {
  sansVariables: number;
  avecVariables: number;
}

function findMaxStackDepth(): StackDepthResult {
  // TODO : Implémentez cette fonction
  // Stratégie :
  // 1. Créez une fonction récursive interne qui incrémente un compteur à chaque appel
  // 2. Enveloppez l'appel dans un try/catch pour attraper le RangeError
  // 3. Retournez la profondeur maximale atteinte
  //
  // Attention : la profondeur dépend de ce que chaque frame contient.
  // Essayez deux variantes :
  //   a) une fonction récursive SANS variables locales
  //   b) une fonction récursive AVEC plusieurs variables locales
  // Comparez les résultats.

  return { sansVariables: 0, avecVariables: 0 }; // À modifier
}

const maxDepth: StackDepthResult = findMaxStackDepth();
if (maxDepth.sansVariables === 0) {
  console.log("La fonction findMaxStackDepth n'est pas encore implémentée.");
} else {
  console.log(`Profondeur max SANS variables locales : ${maxDepth.sansVariables}`);
  console.log(`Profondeur max AVEC variables locales : ${maxDepth.avecVariables}`);
  console.log(
    `Différence : ${maxDepth.sansVariables - maxDepth.avecVariables} frames`
  );
  // TODO : Expliquez pourquoi il y a une différence (ou pas).
}

// =============================================================================
// PARTIE BONUS : Fonctions fléchées et nommage dans la pile
// =============================================================================

console.log("\n--- Bonus : Nommage dans la pile ---");

// TODO : Observez la différence dans les stack traces entre :
// 1. Une fonction déclarée (function declaration)
// 2. Une expression de fonction nommée (named function expression)
// 3. Une fonction fléchée assignée à une variable
// 4. Une fonction fléchée anonyme passée en callback

// Complétez le code ci-dessous pour observer les différences dans la stack trace :

// TODO : Déclarez une fonction `declaree` (function declaration) qui affiche
//        sa propre stack trace avec console.log(new Error().stack)

// TODO : Créez une expression de fonction nommée `expressionNommee`
//        (assigned to a variable) avec un nom interne `monNom`,
//        qui affiche sa stack trace.

// TODO : Créez une fonction fléchée `flecheAssignee` qui affiche sa stack trace.

// TODO : Appelez chaque fonction (declaree, expressionNommee, flecheAssignee)
//        et observez comment chacune apparaît dans la trace.

// TODO : Passez une fonction anonyme à setTimeout et observez la trace.
//        Comment apparaît une callback anonyme dans la pile d'appels ?

console.log("\n=== Fin du Lab 01 ===");
