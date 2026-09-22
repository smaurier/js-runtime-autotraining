// recomputeChecksums.ts — L'EXISTANT, EN PRODUCTION. Ticket : « pendant le recalcul des
// empreintes des pièces jointes d'une famille (après un changement d'algorithme de hash),
// l'API TribuZen ne répond plus à AUCUNE autre requête pendant plusieurs centaines de
// millisecondes. Pas d'erreur, pas de crash — juste un blocage total, en plein milieu d'une
// opération censée être asynchrone. »
//
// Ce fichier COMPILE et MARCHE : le résultat est correct. Le problème est que `recompute` a
// beau être `async`, tout son travail réel est SYNCHRONE — Node.js est mono-thread, un `for`
// qui ne rend jamais la main bloque TOUT le reste (autres requêtes, timers, I/O) pendant sa
// durée totale, `async`/`await` ou pas.
//
// AVANT de corriger : ouvre CE fichier et remplis `AUDIT.md`.
//
// Contrat à respecter (signature inchangée) :
//   recomputeChecksums(payloads: string[]): Promise<string[]>
//     - Même résultat qu'aujourd'hui (un hash par payload).
//     - Doit LAISSER RESPIRER la boucle d'événements pendant le calcul — d'autres tâches
//       planifiées (setInterval, autres promesses) doivent pouvoir s'exécuter PENDANT que ce
//       calcul tourne, pas seulement avant ou après. Découpe le travail en morceaux, avec un
//       point de reprise (`setImmediate` ou équivalent) entre chaque morceau.
import { createHash } from "node:crypto";

const ROUNDS = 300;

function hashChain(seed: string): string {
  let h = seed;
  for (let i = 0; i < ROUNDS; i++) h = createHash("sha256").update(h).digest("hex");
  return h;
}

export async function recomputeChecksums(payloads: string[]): Promise<string[]> {
  return payloads.map((p) => hashChain(p));
}
