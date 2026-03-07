// =============================================================================
// Lab 01 — Observer la Call Stack — SOLUTION
// =============================================================================
// Exécuter avec : node solution.js
// =============================================================================

console.log("=== Lab 01 : Observer la Call Stack — SOLUTION ===\n");

// =============================================================================
// PARTIE 1 : Prédire l'état de la pile d'appels
// =============================================================================
// Explication : chaque appel de fonction ajoute un "frame" sur la pile.
// La pile se lit du sommet (fonction en cours) vers la base (point d'entrée).
// =============================================================================

function alpha() {
  // Point A — La pile contient : alpha (sommet) puis main (base)
  // car main() a appelé alpha(), et alpha() est en cours d'exécution.
  const predictionA = "alpha -> main -> <module>";
  console.log(`Prédiction A : ${predictionA}`);

  beta();
}

function beta() {
  // Point B — beta a été appelée par alpha, qui a été appelée par main.
  // La pile a donc 3 frames + le module racine.
  const predictionB = "beta -> alpha -> main -> <module>";
  console.log(`Prédiction B : ${predictionB}`);

  gamma();
}

function gamma() {
  // Point C — gamma -> beta -> alpha -> main -> <module>
  const predictionC = "gamma -> beta -> alpha -> main -> <module>";
  console.log(`Prédiction C : ${predictionC}`);

  delta();
}

function delta() {
  // Point D — Nous sommes au plus profond de la chaîne d'appels.
  // La pile complète : delta -> gamma -> beta -> alpha -> main -> <module>
  const predictionD = "delta -> gamma -> beta -> alpha -> main -> <module>";
  console.log(`Prédiction D : ${predictionD}`);

  // Vérification avec Error().stack
  const realStack = new Error().stack;
  console.log("\n--- Partie 1 : Vérification des prédictions ---");
  console.log("Trace réelle au point D :");
  console.log(realStack);

  // console.trace() écrit sur stderr et inclut le préfixe "Trace:"
  // Contrairement à Error().stack qui retourne une chaîne manipulable,
  // console.trace() est purement un outil d'affichage pour le débogage.
  console.log("\nconsole.trace() au point D :");
  console.trace("Point D");

  // Différence clé :
  // - new Error().stack -> retourne une CHAÎNE exploitable programmatiquement
  // - console.trace() -> AFFICHE sur stderr, ne retourne rien, utile pour le debug
}

function main() {
  alpha();
}

main();

// =============================================================================
// PARTIE 2 : Capture de stack traces à chaque niveau de récursion
// =============================================================================
// La fonction fait `depth` niveaux de récursion et stocke la trace à chaque
// niveau dans le tableau `traces`.
// =============================================================================

console.log("\n--- Partie 2 : Capture récursive de stack traces ---");

function captureStackAtEachLevel(depth, currentLevel = 0, traces = []) {
  // On capture la stack trace au niveau courant
  const stack = new Error().stack;
  traces.push(stack);

  // Si on n'a pas atteint la profondeur demandée, on descend d'un niveau
  if (currentLevel < depth - 1) {
    captureStackAtEachLevel(depth, currentLevel + 1, traces);
  }

  // On retourne le tableau rempli (il est passé par référence, donc
  // toutes les captures sont dans le même tableau)
  return traces;
}

const traces = captureStackAtEachLevel(5);

console.log(`Nombre de traces capturées : ${traces.length}`);
traces.forEach((trace, i) => {
  const frameCount = trace
    .split("\n")
    .filter((l) => l.trim().startsWith("at")).length;
  console.log(`  Niveau ${i} : ${frameCount} frames dans la pile`);
});

// Observation : à chaque niveau de récursion, on observe UN frame de plus
// dans la pile. C'est logique : chaque appel récursif empile un nouveau frame.
// Au niveau 0, on a ~3 frames (captureStackAtEachLevel + <module> + etc.)
// Au niveau 4, on a ~7 frames (5 appels récursifs + les frames de base).
console.log(
  "\n  Observation : chaque niveau ajoute exactement 1 frame supplémentaire."
);
console.log(
  "  Cela prouve que chaque appel de fonction empile un frame sur la pile.\n"
);

// =============================================================================
// PARTIE 3 : Trouver la profondeur maximale de la pile
// =============================================================================
// On mesure la profondeur maximale de deux manières :
// a) Avec une fonction récursive minimale (sans variables locales)
// b) Avec une fonction qui alloue des variables locales à chaque frame
// =============================================================================

console.log("--- Partie 3 : Profondeur maximale de la pile ---");

function findMaxStackDepth() {
  // Variante A : fonction récursive SANS variables locales
  // Chaque frame est minimal, donc on peut aller plus profond.
  let depthA = 0;
  function recurseLight() {
    depthA++;
    recurseLight();
  }
  try {
    recurseLight();
  } catch (e) {
    // On attrape le RangeError: Maximum call stack size exceeded
  }

  // Variante B : fonction récursive AVEC variables locales volumineuses
  // Chaque frame occupe plus d'espace à cause des variables locales,
  // donc la pile déborde plus tôt.
  let depthB = 0;
  function recurseHeavy() {
    // Ces variables occupent de l'espace dans le frame de la pile
    const a = new Array(10);
    const b = { x: 1, y: 2, z: 3 };
    const c = "une chaîne de caractères assez longue pour occuper de la mémoire";
    const d = [a, b, c];
    depthB++;
    recurseHeavy();
  }
  try {
    recurseHeavy();
  } catch (e) {
    // RangeError attrapé
  }

  return { sansVariables: depthA, avecVariables: depthB };
}

const maxDepth = findMaxStackDepth();
console.log(`Profondeur max SANS variables locales : ${maxDepth.sansVariables}`);
console.log(`Profondeur max AVEC variables locales : ${maxDepth.avecVariables}`);
console.log(
  `Différence : ${maxDepth.sansVariables - maxDepth.avecVariables} frames`
);

// Explication : la pile d'appels a une taille fixe en mémoire (~1 Mo par défaut
// dans V8). Chaque frame de la pile occupe un certain espace mémoire qui dépend
// du nombre et de la taille des variables locales.
// - Sans variables : ~10 000 à ~15 000 appels (frames minuscules)
// - Avec variables : moins d'appels car chaque frame est plus gros
// Note : les résultats exacts dépendent de la version de Node.js et de l'OS.
console.log(
  "\n  Explication : la taille de chaque frame affecte la profondeur maximale."
);
console.log(
  "  Plus un frame contient de variables, moins on peut empiler de frames."
);

// =============================================================================
// PARTIE BONUS : Fonctions fléchées et nommage dans la pile
// =============================================================================

console.log("\n--- Bonus : Nommage dans la pile ---\n");

// 1. Fonction déclarée — apparaît avec son nom dans la trace
function declaree() {
  const stack = new Error().stack;
  console.log("Fonction déclarée :");
  // On extrait la 2e ligne (la première est "Error", la 2e est le frame courant)
  console.log("  " + stack.split("\n")[1].trim());
  // Résultat attendu : "at declaree (...)"
}

// 2. Expression de fonction nommée — le NOM INTERNE apparaît dans la trace
const expressionNommee = function monNomInterne() {
  const stack = new Error().stack;
  console.log("Expression nommée :");
  console.log("  " + stack.split("\n")[1].trim());
  // Résultat attendu : "at monNomInterne (...)"
  // Note : c'est le nom interne qui apparaît, pas le nom de la variable
};

// 3. Fonction fléchée assignée à une variable — V8 infère le nom de la variable
const flecheAssignee = () => {
  const stack = new Error().stack;
  console.log("Flèche assignée :");
  console.log("  " + stack.split("\n")[1].trim());
  // Résultat attendu : "at flecheAssignee (...)"
  // V8 est assez intelligent pour inférer le nom depuis l'assignation
};

declaree();
expressionNommee();
flecheAssignee();

// 4. Callback anonyme — apparaît sans nom significatif
console.log("\nCallback anonyme dans setTimeout :");
setTimeout(() => {
  const stack = new Error().stack;
  console.log("  " + stack.split("\n")[1].trim());
  // Résultat : "at Timeout._onTimeout (...)" ou similaire
  // Les callbacks anonymes rendent le débogage plus difficile !
  // C'est pourquoi il est recommandé de nommer ses fonctions.
  console.log(
    "\n  Conseil : nommez toujours vos fonctions pour faciliter le débogage."
  );

  console.log("\n=== Fin du Lab 01 — SOLUTION ===");
}, 0);
