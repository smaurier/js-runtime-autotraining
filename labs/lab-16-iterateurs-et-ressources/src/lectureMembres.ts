// STARTER. Ce code marche, et il a les deux defauts du module 16.
//
// 1. Il materialise trois tableaux intermediaires pour rendre `limite` membres.
// 2. La connexion fuit des qu'une exception traverse : `release()` n'est jamais atteint.
//
// Tu reecris `premiersMembresActifs`. Tu ne modifies pas fixtures/infra.ts.

import { pool, normaliser, type Membre } from "../fixtures/infra";

export async function premiersMembresActifs(familyId: number, limite: number): Promise<Membre[]> {
  const connexion = await pool.connect();

  const resultat = connexion.query("SELECT * FROM members WHERE family_id = $1", [familyId]);

  const normalisees = resultat.rows.map(normaliser);
  const actifs = normalisees.filter((m) => m.actif);
  const page = actifs.slice(0, limite);

  connexion.release();
  return page;
}
