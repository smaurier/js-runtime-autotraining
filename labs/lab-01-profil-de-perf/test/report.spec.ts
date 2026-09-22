// Oracle du lab 01 (JS runtime). Ne pas modifier. La correction ne suffit pas : le dernier
// test mesure RÉELLEMENT le temps d'exécution à deux tailles et vérifie que ça ne grimpe pas
// en quadratique — un `buildReport` en `+=` répété, fonctionnellement correct, échoue CE
// test précis, pas les autres.
import { describe, expect, it } from "vitest";
import { buildReport, measure } from "@lab/report";

describe("buildReport — correction fonctionnelle", () => {
  it("construit l'en-tête et joint les lignes", () => {
    expect(buildReport(["a", "b", "c"])).toBe("Rapport (3 lignes) :\na\nb\nc");
  });

  it("gère une liste vide", () => {
    expect(buildReport([])).toBe("Rapport (0 lignes) :\n");
  });
});

describe("measure — un micro-benchmark qui ne ment pas", () => {
  it("retourne le résultat ET une durée mesurée", () => {
    const { result, durationMs } = measure(() => 21 * 2);
    expect(result).toBe(42);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it("exécute fn() en warm-up AVANT la mesure (3 fois par défaut, plus l'appel mesuré)", () => {
    let appels = 0;
    measure(() => {
      appels++;
    });
    expect(appels).toBe(4); // 3 warm-up + 1 mesuré
  });

  it("respecte un warmupRuns personnalisé", () => {
    let appels = 0;
    measure(
      () => {
        appels++;
      },
      { warmupRuns: 0 },
    );
    expect(appels).toBe(1);
  });
});

describe("buildReport — DOIT être O(n), pas O(n²) (preuve au chiffre)", () => {
  it("le temps ne grimpe pas en quadratique entre N et 4×N", () => {
    // À petite échelle (quelques dizaines de milliers), V8 masque presque le coût d'une
    // concaténation en boucle (ConsString) — mesuré en construisant ce lab. Il faut monter à
    // cette échelle pour que le piège soit RÉELLEMENT visible au chronomètre, pas supposé.
    const petit = Array.from({ length: 200_000 }, (_, i) => `ligne-${i}`);
    const grand = Array.from({ length: 800_000 }, (_, i) => `ligne-${i}`);

    const { durationMs: tPetit } = measure(() => buildReport(petit), { warmupRuns: 5 });
    const { durationMs: tGrand } = measure(() => buildReport(grand), { warmupRuns: 5 });

    // 4× plus de données : linéaire → ratio ≈ 4-5 (mesuré) ; quadratique → ratio ≈ 20+
    // (mesuré). On tranche large au milieu pour absorber le bruit machine.
    const ratio = tGrand / Math.max(tPetit, 0.001);
    expect(ratio).toBeLessThan(9);
  });
});
