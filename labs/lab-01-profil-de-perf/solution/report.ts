// report.ts — SOLUTION DE RÉFÉRENCE (commentée). Ne l'ouvre pas avant ton GREEN.
export function measure<T>(fn: () => T, options?: { warmupRuns?: number }): { result: T; durationMs: number } {
  const warmupRuns = options?.warmupRuns ?? 3;
  for (let i = 0; i < warmupRuns; i++) fn();

  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

export function buildReport(items: string[]): string {
  // Un tableau accumule les morceaux, `.join` ne recopie qu'UNE fois à la fin — O(n), pas
  // O(n²) comme le `texte += ...` répété.
  const lignes = new Array<string>(items.length);
  for (let i = 0; i < items.length; i++) lignes[i] = items[i];
  return `Rapport (${items.length} lignes) :\n${lignes.join("\n")}`;
}
