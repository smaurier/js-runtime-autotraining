// Oracle du lab 03 (JS runtime). Ne pas modifier. La preuve n'est pas "ça a l'air fluide" —
// c'est l'écart maximal RÉELLEMENT mesuré entre deux ticks d'un timer qui tourne PENDANT le
// traitement. Si la boucle d'événements est bloquée, ce timer ne peut PHYSIQUEMENT pas
// s'exécuter tant que le calcul synchrone n'a pas rendu la main — ce n'est pas une
// approximation, c'est comment Node fonctionne.
import { describe, expect, it } from "vitest";
import { recomputeChecksums } from "@lab/recomputeChecksums";

async function mesurerEcartMaxBoucleEvenements(travail: () => Promise<unknown>): Promise<number> {
  const ecarts: number[] = [];
  let dernier = performance.now();
  const minuteur = setInterval(() => {
    const maintenant = performance.now();
    ecarts.push(maintenant - dernier);
    dernier = maintenant;
  }, 5);

  await travail();

  clearInterval(minuteur);
  ecarts.push(performance.now() - dernier); // le segment final, entre le dernier tick et la fin
  return Math.max(...ecarts, 0);
}

describe("recomputeChecksums — correction fonctionnelle", () => {
  it("renvoie un hash par payload", async () => {
    const resultats = await recomputeChecksums(["a", "b", "c"]);
    expect(resultats).toHaveLength(3);
    expect(resultats[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("des payloads différents donnent des hash différents", async () => {
    const [h1, h2] = await recomputeChecksums(["a", "b"]);
    expect(h1).not.toBe(h2);
  });
});

describe("recomputeChecksums — NE DOIT PAS bloquer la boucle d'événements (preuve au chiffre)", () => {
  it("un timer qui tourne PENDANT le calcul garde un écart raisonnable entre ses ticks", async () => {
    const payloads = Array.from({ length: 200 }, (_, i) => `payload-${i}`);

    const ecartMax = await mesurerEcartMaxBoucleEvenements(() => recomputeChecksums(payloads));

    // Mesuré en construisant ce lab : une version chunkée reste sous ~15 ms d'écart max ; une
    // version bloquante (tout le travail d'un coup) dépasse 100 ms — l'écart entre les deux
    // est énorme, le seuil peut rester généreux sans jamais laisser passer un blocage réel.
    expect(ecartMax).toBeLessThan(30);
  });
});
