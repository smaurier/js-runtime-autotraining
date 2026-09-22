// recomputeChecksums.ts — SOLUTION DE RÉFÉRENCE (commentée). Ne l'ouvre pas avant ton GREEN.
import { createHash } from "node:crypto";

const ROUNDS = 300;
const CHUNK_SIZE = 10;

function hashChain(seed: string): string {
  let h = seed;
  for (let i = 0; i < ROUNDS; i++) h = createHash("sha256").update(h).digest("hex");
  return h;
}

function yieldToEventLoop(): Promise<void> {
  // setImmediate (pas setTimeout(0)) : s'exécute juste après la phase I/O du tick courant,
  // le point de reprise le plus direct pour "je rends la main puis je continue".
  return new Promise((resolve) => setImmediate(resolve));
}

export async function recomputeChecksums(payloads: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
    const chunk = payloads.slice(i, i + CHUNK_SIZE);
    for (const p of chunk) out.push(hashChain(p));
    await yieldToEventLoop(); // la boucle d'événements respire ici, entre deux morceaux
  }
  return out;
}
