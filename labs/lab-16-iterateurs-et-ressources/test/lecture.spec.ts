// Oracle du lab 16.
//
// Il ne vérifie pas seulement le résultat : il compte les appels à la normalisation et les
// libérations de connexion. Un `try/finally` satisfait la seconde exigence mais pas la
// première, et une chaîne paresseuse sur un tableau déjà chargé satisfait la première mais
// pas la lecture paresseuse. Les deux ensemble demandent `using` plus un curseur.

import { describe, test, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { premiersMembresActifs } from "@lab/lectureMembres";
import { compteurs, reinitialiser, faireJeterLaNormalisationSur } from "../fixtures/infra";

// Injecté par la config vitest : "src" en mode lab, "solution" en mode solution.
declare const __CIBLE__: string;

/** Le source réellement aliasé, pour les assertions de forme. */
function sourceTeste() {
  const dossier = __CIBLE__;
  const chemin = fileURLToPath(new URL(`../${dossier}/lectureMembres.ts`, import.meta.url));
  return { dossier, contenu: readFileSync(chemin, "utf8") };
}

describe("Lecture paresseuse et ressource garantie", () => {
  beforeEach(() => {
    reinitialiser();
  });

  test("le résultat est juste : les 20 premiers membres actifs", async () => {
    const page = await premiersMembresActifs(1, 20);

    expect(page).toHaveLength(20);
    expect(page.every((m) => m.actif)).toBe(true);
    expect(page[0].id, "une ligne sur quatre est active, donc la première est la 1").toBe(1);
    expect(page[1].id, "puis la 5").toBe(5);
    expect(page[19].id, "puis la 77").toBe(77);
  });

  test("la normalisation n'est PAS appelée sur toutes les lignes", async () => {
    await premiersMembresActifs(1, 20);

    expect(
      compteurs.normalisations,
      `${compteurs.normalisations} normalisations pour rendre 20 membres. Une chaîne paresseuse ` +
        `s'arrête dès qu'elle a son compte : il en faut environ 80, pas 12 000.`,
    ).toBeLessThan(200);

    expect(
      compteurs.normalisations,
      "il faut bien en faire quelques-unes : une ligne sur quatre est active",
    ).toBeGreaterThanOrEqual(20);
  });

  test("la source elle-même est lue paresseusement", async () => {
    await premiersMembresActifs(1, 20);

    expect(
      compteurs.lignesLues,
      `${compteurs.lignesLues} lignes lues. Avec un curseur paresseux, on ne lit que ce qu'on ` +
        `consomme. Un query() qui rend tout le tableau en lit 12 000 d'un coup.`,
    ).toBeLessThan(200);
  });

  test("la connexion est ouverte puis fermée, exactement une fois", async () => {
    await premiersMembresActifs(1, 20);

    expect(compteurs.connexionsOuvertes).toBe(1);
    expect(compteurs.connexionsFermees, "la connexion doit être libérée").toBe(1);
  });

  test("la connexion est fermée MÊME si la normalisation jette", async () => {
    // La ligne 5 est le deuxième membre actif : l'exception traverse au milieu de la chaîne.
    faireJeterLaNormalisationSur("membre-5");

    await expect(premiersMembresActifs(1, 20)).rejects.toThrow(/ligne corrompue/);

    expect(
      compteurs.connexionsFermees,
      "c'est tout l'objet de `using` : la libération a lieu à la sortie du bloc, exception comprise",
    ).toBe(1);
  });

  test("la libération ne passe pas par un try/finally écrit à la main", () => {
    const { contenu, dossier } = sourceTeste();

    expect(
      contenu,
      `${dossier}/lectureMembres.ts contient un finally. Le lab porte sur \`using\` : ` +
        `l'objet sait se fermer, et le langage garantit l'appel.`,
    ).not.toMatch(/\bfinally\b/);

    expect(
      contenu,
      "il faut déclarer la ressource avec `using` ou `await using`",
    ).toMatch(/\b(await\s+)?using\s+\w+/);
  });

  test("la chaîne utilise les helpers d'itérateurs, pas slice sur un tableau", () => {
    const { contenu } = sourceTeste();

    expect(
      contenu,
      "`.take(limite)` s'arrête dès qu'il a son compte ; `.slice()` suppose un tableau déjà construit",
    ).toMatch(/\.take\(/);
    expect(contenu, "pas de slice sur un tableau intermédiaire").not.toMatch(/\.slice\(/);
  });

  test("demander moins coûte moins", async () => {
    await premiersMembresActifs(1, 5);
    const pourCinq = compteurs.normalisations;

    reinitialiser();
    await premiersMembresActifs(1, 40);
    const pourQuarante = compteurs.normalisations;

    expect(
      pourCinq,
      `${pourCinq} normalisations pour 5 membres, ${pourQuarante} pour 40. Le coût doit suivre ` +
        `la demande : c'est la définition de la paresse.`,
    ).toBeLessThan(pourQuarante);
  });
});
