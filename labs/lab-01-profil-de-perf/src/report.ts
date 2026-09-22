// report.ts — PAGE BLANCHE. Deux fonctions : l'outil de mesure, et la fonction à mesurer —
// dont la CORRECTION ne suffit pas, la PERFORMANCE fait partie du contrat (voir
// test/report.spec.ts : un `buildReport` fonctionnellement correct mais écrit avec une
// concaténation de chaînes en boucle échouera le test de performance).
//
// export function measure<T>(fn: () => T, options?: { warmupRuns?: number }): { result: T; durationMs: number }
//   - Un micro-benchmark qui NE MENT PAS (module 12) : `warmupRuns` (défaut 3) appels à
//     `fn()` AVANT la mesure, pour laisser le JIT de V8 optimiser le chemin chaud — sans ça,
//     tu mesures du code interprété non optimisé, pas ce qui tourne vraiment en prod après
//     quelques centaines d'appels.
//   - La mesure elle-même (`durationMs`) porte sur UN SEUL appel à `fn()`, chronométré avec
//     `performance.now()`, APRÈS le warm-up.
//   - Retourne `{ result, durationMs }` — le résultat du dernier appel ET le temps mesuré.
//
// export function buildReport(items: string[]): string
//   - Concatène tous les éléments de `items`, séparés par "\n", précédés d'un en-tête
//     "Rapport (<n> lignes) :\n" (`<n>` = `items.length`).
//   - DOIT être O(n) — voir le piège ci-dessous.
//
// LE PIÈGE (le sujet réel du lab, vérifié en construisant l'oracle — pas juste "en théorie") :
// `let texte = ""; for (...) texte += item + "\n";` reste FONCTIONNELLEMENT correct, et sur
// quelques dizaines de milliers d'éléments, V8 le masque presque entièrement (ConsString —
// V8 retarde la copie réelle). Le coût quadratique redevient visible au chronomètre à partir
// de centaines de milliers d'éléments (mesuré en construisant ce lab : ×17 à ×24 sur une
// concaténation en boucle entre 200 000 et 800 000 lignes, contre ×5 pour un tableau + join,
// alors que les données ont ×4). C'est exactement pourquoi le module 12 insiste sur MESURER,
// pas deviner : le même bug est invisible à petite échelle et réel en production.
export function measure<T>(_fn: () => T, _options?: { warmupRuns?: number }): { result: T; durationMs: number } {
  throw new Error("measure n'est pas encore implémenté");
}

export function buildReport(_items: string[]): string {
  throw new Error("buildReport n'est pas encore implémenté");
}
