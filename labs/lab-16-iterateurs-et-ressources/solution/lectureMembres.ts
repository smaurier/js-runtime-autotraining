// SOLUTION DE REFERENCE. A n'ouvrir qu'apres ton GREEN.

import { pool, normaliser, ConnexionBrute, type Membre } from "../fixtures/infra";

/**
 * La ressource sait se fermer, et le langage garantit l'appel.
 *
 * `Symbol.asyncDispose` est synchrone a l'interieur, mais il est declare sur une ressource
 * obtenue de facon asynchrone : c'est donc `await using` qui la consomme. Module 16 § 2.8.
 */
class Connexion {
  static async ouvrir(): Promise<Connexion> {
    return new Connexion(await pool.connect());
  }

  constructor(readonly brute: ConnexionBrute) {}

  async [Symbol.asyncDispose]() {
    this.brute.release();
  }
}

export async function premiersMembresActifs(familyId: number, limite: number): Promise<Membre[]> {
  await using connexion = await Connexion.ouvrir();

  // Un curseur paresseux : la source ne lit que ce qu'on lui demande. Sans lui, la
  // paresse de la chaine economiserait les tableaux intermediaires mais pas la lecture.
  return connexion.brute
    .curseur("SELECT * FROM members WHERE family_id = $1", [familyId])
    .map(normaliser)
    .filter((m) => m.actif)
    .take(limite)
    .toArray();
}
