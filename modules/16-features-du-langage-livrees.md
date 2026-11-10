---
titre: Les features du langage déjà livrées
cours: 01-js-runtime
notions: [helpers d'itérateurs, paresse et flux, Object.groupBy et Map.groupBy, Array.fromAsync, Promise.withResolvers, Promise.try, méthodes d'ensembles, RegExp.escape, gestion explicite des ressources, using et await using, Symbol.dispose, DisposableStack]
outcomes: [chaîner des transformations sans matérialiser de tableau intermédiaire, libérer une ressource de façon garantie avec using, grouper sans réduire à la main, vérifier soi-même la disponibilité d'une feature avant de s'appuyer dessus]
prerequis: [13-scheduling-concurrence]
next: 17-propositions-a-surveiller
libs: []
tribuzen: la couche de lecture de l'API TribuZen — parcourir un flux de membres sans le charger, et fermer proprement connexions et fichiers
last-reviewed: 2026-11
---

# Les features du langage déjà livrées

> **Outcomes, tu sauras FAIRE :** chaîner des transformations sur un flux sans matérialiser de
> tableau intermédiaire, libérer une ressource de façon garantie même en cas d'exception,
> grouper des données sans écrire un `reduce`, et vérifier toi-même qu'une feature est
> disponible avant de t'appuyer dessus.
> **Difficulté :** :star::star::star:

> ⚠️ **Ce module ne te demande pas de croire une liste de versions.** Chaque feature vient avec
> sa commande de vérification. Lance-la sur ta cible réelle, c'est-à-dire ta version de Node et
> les navigateurs que tu supportes, et décide ensuite. La grille de décision complète est au
> cours 25, module 21.

## 1. Cas concret d'abord

L'API TribuZen expose la liste des membres d'une grande famille. Un collègue a écrit le handler
de lecture comme ceci :

```js
// GET /families/:id/members?actifs=true&limite=20
async function premiersMembresActifs(familyId, limite) {
  const connexion = await pool.connect();          // ressource à fermer
  const toutes = await connexion.query('SELECT * FROM members WHERE family_id = $1', [familyId]);

  const lignes = toutes.rows;                      // 1er tableau : 12 000 lignes
  const normalisees = lignes.map(normaliser);       // 2e tableau : 12 000 objets
  const actifs = normalisees.filter((m) => m.actif); // 3e tableau : 9 000 objets
  const page = actifs.slice(0, limite);             // on en voulait 20

  connexion.release();                              // jamais atteint si une ligne jette
  return page;
}
```

Deux défauts, et ils ont le même remède : le langage a appris à les éviter.

1. **Trois tableaux intermédiaires pour en garder vingt.** `map` et `filter` sur un tableau
   construisent un nouveau tableau à chaque étape. On alloue 33 000 objets pour en rendre 20.
2. **La connexion fuit dès qu'une exception passe.** `normaliser` jette sur une ligne corrompue,
   et `release()` n'est jamais appelé. Un `try/finally` règle le cas, et personne ne l'écrit.

À la fin de ce module, ce handler ne fera plus ni l'un ni l'autre, et il sera plus court.

## 2. Théorie complète, concise

### 2.1 Les helpers d'itérateurs : chaîner sans matérialiser

`map`, `filter`, `take`, `drop`, `flatMap`, `reduce`, `toArray`, `forEach`, `some`, `every`,
`find` existent désormais **sur les itérateurs**, et non seulement sur les tableaux.

La différence est de nature, pas de confort : **ils sont paresseux.** Rien n'est calculé avant
qu'on ne demande une valeur, et seul le nécessaire est calculé.

```js
// Sur un tableau : 3 tableaux intermédiaires, tout est calculé
const page = lignes.map(normaliser).filter((m) => m.actif).slice(0, 20);

// Sur un itérateur : zéro tableau intermédiaire, et on s'arrête à 20
const page = lignes.values()           // un itérateur
  .map(normaliser)
  .filter((m) => m.actif)
  .take(20)
  .toArray();
```

Dans la seconde version, `normaliser` est appelé **autant de fois qu'il faut pour trouver 20
membres actifs**, pas 12 000 fois. Sur un jeu où un membre sur quatre est actif, cela fait
environ 80 appels au lieu de 12 000.

Deux règles de lecture :

- **La chaîne ne fait rien tant qu'elle n'est pas consommée.** `toArray()`, `reduce()`,
  `forEach()`, `find()`, `some()` et `every()` consomment. Sans l'un d'eux, il ne s'est rien
  passé.
- **Un itérateur se consomme une fois.** Le reparcourir rend un résultat vide, sans erreur. C'est
  la différence la plus coûteuse avec un tableau, et le piège n°2 du § 4.

`Iterator.from()` emballe n'importe quel itérable, utile sur un générateur ou un objet maison :

```js
Iterator.from(lireLignesDuFichier()).take(5).toArray();
```

**Vérifier :**

```bash
node -e "console.log(typeof Iterator?.prototype?.take === 'function' ? 'disponible' : 'absent')"
```

### 2.2 Grouper sans écrire un `reduce`

```js
// Avant : un reduce qu'il fallait relire deux fois
const parRole = membres.reduce((acc, m) => {
  (acc[m.role] ??= []).push(m);
  return acc;
}, {});

// Maintenant
const parRole = Object.groupBy(membres, (m) => m.role);
const parFamille = Map.groupBy(membres, (m) => m.familyId);
```

`Object.groupBy` rend un objet **sans prototype**, ce qui évite la collision avec `constructor`
ou `toString` quand les clés viennent de données. `Map.groupBy` rend une `Map`, donc accepte des
clés non textuelles, un objet famille par exemple.

**Vérifier :** `node -e "console.log(typeof Object.groupBy)"`

### 2.3 `Array.fromAsync` : collecter un flux asynchrone

```js
// Avant
const lignes = [];
for await (const ligne of fluxDeLignes()) lignes.push(ligne);

// Maintenant
const lignes = await Array.fromAsync(fluxDeLignes());
```

Accepte aussi un itérable de promesses, et les attend dans l'ordre. À ne pas confondre avec
`Promise.all`, qui lance tout en parallèle : `fromAsync` parcourt **séquentiellement**, ce qui
est exactement ce qu'on veut sur un flux qu'on ne veut pas noyer.

### 2.4 `Promise.withResolvers` : sortir le `resolve` du constructeur

```js
// Avant : la gymnastique de la variable capturée
let resoudre, rejeter;
const promesse = new Promise((res, rej) => { resoudre = res; rejeter = rej; });

// Maintenant
const { promise, resolve, reject } = Promise.withResolvers();
```

Utile chaque fois que la résolution arrive d'ailleurs : un évènement, un message de socket, un
callback d'une bibliothèque. C'est la forme propre d'une promesse différée.

### 2.5 `Promise.try` : rendre la partie synchrone rattrapable

```js
// Si parseConfig() jette SYNCHRONEMENT, ce catch ne l'attrape pas
const p = Promise.resolve(parseConfig(entree)).catch(gerer);

// Avec Promise.try, la partie synchrone est dans la chaîne
const p = Promise.try(() => parseConfig(entree)).catch(gerer);
```

Le piège qu'il supprime est réel : une fonction « asynchrone » qui valide ses arguments avant
tout `await` jette de façon synchrone, et le `.catch()` posé après ne voit rien.

### 2.6 Les méthodes d'ensembles

```js
const invitesA = new Set(['a@x.fr', 'b@x.fr']);
const invitesB = new Set(['b@x.fr', 'c@x.fr']);

invitesA.union(invitesB);              // a, b, c
invitesA.intersection(invitesB);       // b
invitesA.difference(invitesB);         // a
invitesA.symmetricDifference(invitesB);
invitesA.isSubsetOf(invitesB);
invitesA.isDisjointFrom(invitesB);
```

Remplacent les contournements par `filter` et `has`, et sont plus rapides parce qu'ils travaillent
sur la table de hachage sans passer par un tableau.

### 2.7 `RegExp.escape`

```js
// L'utilisateur tape "c++" : sans échappement, l'expression est invalide ou fausse
const terme = RegExp.escape(saisieUtilisateur);
const motif = new RegExp(terme, 'iu');
```

Supprime une classe entière de bugs et d'injections dans les recherches construites depuis une
saisie.

### 2.8 La gestion explicite des ressources : `using`

C'est l'apport le plus structurant du lot, parce qu'il déplace une responsabilité : **l'objet
sait se fermer, et le langage garantit l'appel.**

```js
// Un objet devient « disposable » en implémentant Symbol.dispose
class ConnexionTribuZen {
  static async ouvrir(pool) {
    const brute = await pool.connect();
    return new ConnexionTribuZen(brute);
  }
  constructor(brute) { this.brute = brute; }

  [Symbol.dispose]() {
    this.brute.release();
  }
}

function lireMembres(pool, familyId) {
  using connexion = ConnexionTribuZen.ouvrirSync(pool);
  return connexion.brute.query('…', [familyId]);
  // release() est appelé à la sortie du bloc, exception comprise
}
```

Pour les ressources asynchrones, `await using` et `Symbol.asyncDispose` :

```js
async function lireMembres(pool, familyId) {
  await using connexion = await ConnexionTribuZen.ouvrir(pool);
  return connexion.brute.query('…', [familyId]);
}
```

Quatre propriétés à connaître :

1. **La libération se fait à la sortie du bloc**, pas de la fonction. Un `using` dans un `if` se
   libère à la fin du `if`.
2. **L'ordre est inverse de la déclaration**, comme une pile. La dernière ressource ouverte est
   la première fermée, ce qui est le bon ordre pour une transaction dans une connexion.
3. **Les exceptions de libération ne mangent pas l'exception d'origine** : elles sont agrégées
   dans une `SuppressedError`.
4. **`using` est une déclaration à portée de bloc**, comme `const`. On ne peut pas réaffecter.

Pour des ressources dont le nombre n'est pas connu à l'écriture, `DisposableStack` :

```js
function ouvrirPlusieursFichiers(chemins) {
  using pile = new DisposableStack();
  const fichiers = chemins.map((c) => pile.use(ouvrirFichier(c)));
  return traiter(fichiers);          // tout est fermé à la sortie, dans l'ordre inverse
}
```

`pile.defer(() => …)` enregistre une action de nettoyage quelconque, et `pile.move()` transfère
la propriété, ce qui sert à rendre une ressource encore ouverte depuis une fabrique.

**Vérifier, et c'est le cas le plus instructif du module.** Cette feature a besoin du support
**syntaxique**, donc vérifier la présence du symbole ne suffit **pas** :

```bash
# Ceci dit seulement que les symboles existent. Ce n'est PAS une preuve.
node -e "console.log(typeof Symbol.dispose, typeof Symbol.asyncDispose)"

# Ceci est la preuve : elle teste la SYNTAXE.
node --input-type=module -e "class R { [Symbol.dispose]() { console.log('ferme'); } } { using r = new R(); } console.log('sortie du bloc');"
```

**Mesure faite le 10/11/2026 sur ce poste, avec Node 23.7 :** la première commande répond
`symbol symbol`, donc les symboles existent. La seconde échoue sur une **erreur de syntaxe**.
Autrement dit, `using` n'était pas disponible nativement, alors que tout indiquait le contraire
si on s'arrêtait au premier test.

C'est la leçon à retenir du module, et elle dépasse `using` : **pour une feature de syntaxe, la
seule vérification valable est d'exécuter la syntaxe.** Un `typeof` sur un symbole, une méthode
ou un objet ne prouve rien sur la grammaire.

En pratique, cela ne t'empêche pas de l'écrire : TypeScript et esbuild la compilent vers une
forme équivalente. Le lab de ce module tourne sous Vitest, donc avec cette transpilation, et il
vérifie que l'ordre de libération et le passage des exceptions sont bien respectés.

## 3. Worked examples

### Exemple 1 — Le handler du § 1, réécrit

```js
async function premiersMembresActifs(familyId, limite) {
  await using connexion = await ConnexionTribuZen.ouvrir(pool);

  const resultat = await connexion.brute.query(
    'SELECT * FROM members WHERE family_id = $1',
    [familyId],
  );

  return resultat.rows.values()
    .map(normaliser)
    .filter((m) => m.actif)
    .take(limite)
    .toArray();
}
```

Ce qui a changé, et pourquoi c'est mieux :

- **zéro tableau intermédiaire**, et `normaliser` n'est appelé que le nombre de fois nécessaire ;
- **la connexion est libérée dans tous les cas**, y compris si `normaliser` jette ;
- le `try/finally` a disparu, donc il ne peut plus être oublié par le prochain qui touche à ce
  fichier.

Attention toutefois : ici, `SELECT *` charge déjà toutes les lignes en mémoire. La paresse des
itérateurs ne rattrape pas une requête trop large. Le vrai gain, c'est le § 3.2.

### Exemple 2 — Un flux qu'on ne charge jamais entièrement

```js
// Un curseur de base de données, ou un fichier ligne à ligne : la source est paresseuse
async function* lireMembresEnFlux(connexion, familyId) {
  const curseur = connexion.brute.query(new Cursor('SELECT * FROM members WHERE family_id = $1', [familyId]));
  let lot;
  while ((lot = await curseur.read(200)).length > 0) {
    yield* lot;
  }
}

async function rapportParRole(familyId) {
  await using connexion = await ConnexionTribuZen.ouvrir(pool);

  const membres = await Array.fromAsync(lireMembresEnFlux(connexion, familyId));
  return Object.groupBy(membres, (m) => m.role);
}
```

Et si on ne veut que les vingt premiers actifs, on ne lit jamais la suite du curseur : la chaîne
`.filter().take(20)` cesse de demander, donc `curseur.read()` cesse d'être appelé.

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que la chaîne s'exécute sans consommateur

```js
lignes.values().map(cherEtLent).filter(actif);   // il ne s'est RIEN passé
```

Aucune erreur, aucun effet. Il manque `.toArray()`, `.forEach()`, ou un `for…of`.

### PIÈGE #2 — Reparcourir un itérateur déjà consommé

```js
const flux = lignes.values().map(normaliser);
const total = flux.reduce((n) => n + 1, 0);   // consomme tout
const page = flux.take(20).toArray();          // [] — silencieusement vide
```

Un tableau se reparcourt, un itérateur non. Si les deux parcours sont nécessaires, matérialise
une fois avec `.toArray()` et travaille sur le tableau, ou recrée la chaîne.

### PIÈGE #3 — Attendre de la paresse ce que la source ne donne pas

Chaîner paresseusement sur un tableau déjà entièrement chargé économise les **tableaux
intermédiaires**, pas le chargement. Le gain devient majeur quand la source elle-même est
paresseuse, voir l'exemple 2.

### PIÈGE #4 — Croire que `using` suit la fonction

```js
async function traiter(chemins) {
  for (const c of chemins) {
    await using f = await ouvrir(c);    // fermé à chaque TOUR de boucle
    await lire(f);
  }
}
```

C'est généralement ce qu'on veut, et il faut le savoir : pour garder les fichiers ouverts jusqu'à
la fin, il faut un `DisposableStack` déclaré avant la boucle.

### PIÈGE #5 — Implémenter `Symbol.dispose` avec une méthode asynchrone

`Symbol.dispose` est **synchrone**. Y mettre un `async` rend une promesse que personne n'attend,
donc la ressource n'est pas réellement fermée à la sortie du bloc. Pour de l'asynchrone, c'est
`Symbol.asyncDispose` plus `await using`, et les deux doivent aller ensemble.

### PIÈGE #6 — `Object.groupBy` pris pour une `Map`

Les clés d'un `Object.groupBy` sont converties en chaînes. Grouper par objet famille rend une
seule clé `[object Object]`. Pour des clés non textuelles, c'est `Map.groupBy`.

## 5. Ancrage TribuZen

La couche de lecture de l'API gagne sur trois points.

1. **Les endpoints paginés** utilisent `.take(limite)` sur un curseur, donc le coût est
   proportionnel à la page rendue et non à la table.
2. **Toute ressource est `using`** : connexions, transactions, fichiers d'import. La règle de
   relecture devient simple, et vérifiable : si un fichier contient `pool.connect()` sans
   `using`, il est à corriger.
3. **Les statistiques de famille** passent par `Map.groupBy` avec l'objet famille en clé, sans
   sérialisation d'identifiant.

## 6. Points clés

- Les helpers d'itérateurs sont **paresseux** : rien ne se calcule sans consommateur, et seul le
  nécessaire se calcule.
- Un itérateur se consomme **une fois**. Le reparcourir rend du vide, sans erreur.
- `using` garantit la libération **à la sortie du bloc**, exception comprise, dans l'ordre
  inverse de la déclaration.
- `Symbol.dispose` est synchrone, `Symbol.asyncDispose` va avec `await using`.
- `Object.groupBy` convertit ses clés en chaînes, `Map.groupBy` non.
- La disponibilité se **vérifie**, elle ne se suppose pas : chaque section donne sa commande.

## 7. Seeds Anki

Question|Réponse
---|---
Que fait `lignes.values().map(f).filter(g)` sans consommateur ?|Rien. Aucune erreur, aucun effet : il manque `toArray()`, `forEach()` ou un `for…of`.
Combien d'appels à `normaliser` pour `.map(normaliser).filter(actif).take(20)` sur 12 000 lignes dont 1 sur 4 est active ?|Environ 80, pas 12 000. La chaîne s'arrête dès qu'elle a 20 résultats.
Pourquoi un itérateur reparcouru rend-il un tableau vide ?|Il se consomme une fois. Pour deux parcours, matérialiser avec `toArray()`.
Quand `using` libère-t-il la ressource ?|À la sortie du **bloc**, pas de la fonction, exception comprise, dans l'ordre inverse de la déclaration.
Différence entre `Symbol.dispose` et `Symbol.asyncDispose` ?|Le premier est synchrone et va avec `using`, le second asynchrone et va avec `await using`. Mettre un `async` dans `Symbol.dispose` ne ferme rien.
Pourquoi `Object.groupBy` échoue-t-il avec des clés objet ?|Ses clés sont converties en chaînes, donc tout tombe dans `[object Object]`. Utiliser `Map.groupBy`.
Que corrige `Promise.try` ?|Une erreur jetée **synchronement** avant le premier `await` n'était pas attrapée par le `.catch()` de la chaîne.
Que corrige `RegExp.escape` ?|Une saisie utilisateur insérée dans une expression régulière, qui la rendait invalide ou fausse.

## Pont vers le lab

[lab-16 — itérateurs et ressources](../labs/lab-16-iterateurs-et-ressources/README.md) reprend
exactement le handler du § 1 : trois tableaux intermédiaires et une connexion qui fuit. L'oracle
compte les appels à la fonction de normalisation et vérifie que la ressource est fermée **même
quand une exception traverse**. Les deux ne peuvent pas être satisfaits par un `try/finally`
seul.
