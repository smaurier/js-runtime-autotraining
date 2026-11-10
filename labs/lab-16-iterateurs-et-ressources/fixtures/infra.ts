// Infrastructure simulée du lab. TU NE MODIFIES PAS CE FICHIER.
//
// Il fournit un faux pool de connexions, un jeu de 12 000 lignes, et une fonction de
// normalisation INSTRUMENTÉE : l'oracle compte ses appels pour vérifier que ta chaîne est
// bien paresseuse. Si tu normalises 12 000 lignes pour en rendre 20, le test le voit.

export type LigneBrute = {
  id: number;
  prenom: string;
  statut: "actif" | "inactif";
  family_id: number;
};

export type Membre = {
  id: number;
  prenom: string;
  actif: boolean;
};

/** Compteurs observés par l'oracle. Remis à zéro par `reinitialiser()`. */
export const compteurs = {
  normalisations: 0,
  connexionsOuvertes: 0,
  connexionsFermees: 0,
  lignesLues: 0,
};

export function reinitialiser() {
  compteurs.normalisations = 0;
  compteurs.connexionsOuvertes = 0;
  compteurs.connexionsFermees = 0;
  compteurs.lignesLues = 0;
  normaliserJetteSur = null;
}

/** Quand ce prénom est rencontré, `normaliser` jette. Sert à prouver la libération. */
let normaliserJetteSur: string | null = null;

export function faireJeterLaNormalisationSur(prenom: string) {
  normaliserJetteSur = prenom;
}

/** Une ligne active sur quatre, 12 000 lignes au total. */
const LIGNES: LigneBrute[] = Array.from({ length: 12_000 }, (_, i) => ({
  id: i + 1,
  prenom: `membre-${i + 1}`,
  statut: i % 4 === 0 ? "actif" : "inactif",
  family_id: 1,
}));

export function normaliser(ligne: LigneBrute): Membre {
  compteurs.normalisations += 1;
  if (normaliserJetteSur !== null && ligne.prenom === normaliserJetteSur) {
    throw new Error(`ligne corrompue : ${ligne.prenom}`);
  }
  return { id: ligne.id, prenom: ligne.prenom, actif: ligne.statut === "actif" };
}

/** Connexion simulée. `release()` incrémente le compteur de fermetures. */
export class ConnexionBrute {
  #libereee = false;

  query(_sql: string, _parametres: unknown[]): { rows: LigneBrute[] } {
    compteurs.lignesLues += LIGNES.length;
    return { rows: LIGNES };
  }

  /** Un curseur paresseux : il ne lit que ce qu'on lui demande. */
  *curseur(_sql: string, _parametres: unknown[]): Generator<LigneBrute> {
    for (const ligne of LIGNES) {
      compteurs.lignesLues += 1;
      yield ligne;
    }
  }

  release() {
    if (this.#libereee) return;
    this.#libereee = true;
    compteurs.connexionsFermees += 1;
  }

  get estLiberee() {
    return this.#libereee;
  }
}

export const pool = {
  async connect(): Promise<ConnexionBrute> {
    compteurs.connexionsOuvertes += 1;
    return new ConnexionBrute();
  },
};
