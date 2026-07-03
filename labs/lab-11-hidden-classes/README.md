# Lab 11 — Hidden Classes et Inline Caching

> **Outcome :** à la fin, tu sais distinguer un objet de forme stable d'un objet de forme instable avec `%HaveSameMap`, mesurer la dégradation d'un inline cache (mono → poly → méga), et réécrire un mapper qui casse les hidden classes pour restaurer un accès monomorphe.
> **Vrai outil :** Node.js (v18+) avec le flag `--allow-natives-syntax`, qui expose les intrinsics V8 (`%HaveSameMap`, `%DebugPrint`). Aucun harnais simulé.
> **Feedback :** le coach valide en session — pas de test-runner auto-correcteur.

---

## Énoncé

Tu diagnostiques la lenteur de l'endpoint `GET /api/families/:id/members` de TribuZen. Le mapper `buildMember` produit des objets de formes divergentes, ce qui rend l'accès `m.joinedAt` mégamorphe sur le chemin chaud. Tu vas :

1. **Observer** quelles constructions partagent une hidden class et lesquelles la cassent, avec `%HaveSameMap`.
2. **Mesurer** l'écart de perf entre un accès monomorphe, polymorphe et mégamorphe.
3. **Réparer** le mapper `buildMember` pour que 100 000 membres partagent tous une seule forme, et vérifier le gain.

**Le flag est obligatoire.** Sans `--allow-natives-syntax`, `%HaveSameMap` lève une `SyntaxError`.

```bash
node --allow-natives-syntax exercise.mjs
```

> `--allow-natives-syntax` donne accès à des fonctions internes de V8. Outil pédagogique uniquement — jamais en production.

### Starter minimal

Crée un fichier `exercise.mjs` avec ce point de départ (le mapper cassé est celui du service TribuZen) :

```js
// exercise.mjs — node --allow-natives-syntax exercise.mjs

// ─── Le mapper TribuZen, cassé (à NE PAS modifier en Partie 1-2) ───
function buildMemberBroken(row) {
  const m = {};
  m.id = row.id;
  m.name = row.name;
  if (row.email) m.email = row.email;            // ajout conditionnel
  if (row.role === 'admin') m.isAdmin = true;    // ajout conditionnel
  if (row.legacy) {                              // ordre variable
    m.familyId = row.familyId;
    m.joinedAt = row.joinedAt;
  } else {
    m.joinedAt = row.joinedAt;
    m.familyId = row.familyId;
  }
  if (!row.email) delete m.email;                // delete -> dictionary mode
  return m;
}

function totalSeniority(members) {
  let total = 0;
  for (const m of members) total += Date.now() - m.joinedAt; // site chaud
  return total;
}

// Utilitaire de mesure
function bench(label, fn, iter = 2_000_000) {
  for (let i = 0; i < 1000; i++) fn(); // warmup
  const t = performance.now();
  for (let i = 0; i < iter; i++) fn();
  console.log(`${label}: ${(performance.now() - t).toFixed(1)} ms`);
}

// TODO Partie 1, 2, 3 ci-dessous
```

---

## Étapes (en friction)

**Partie 1 — Observer les formes (`%HaveSameMap`).**
1. Construis deux membres via `buildMemberBroken` avec **exactement** le même profil (mêmes clés présentes, même `role`, même `legacy`). Vérifie `%HaveSameMap(a, b)` → devrait être `true`.
2. Construis deux membres qui diffèrent uniquement par `legacy` (`true` vs `false`). Vérifie `%HaveSameMap` → observe le résultat et explique.
3. Construis un membre `admin` et un membre `member`. Compare. Explique.
4. Construis un membre **sans** email (donc `delete m.email` s'exécute) et compare-le à un membre **avec** email. Utilise `%DebugPrint` sur celui qui a subi le `delete` et repère la mention `dictionary` / `slow` dans la sortie.

**Partie 2 — Mesurer mono → poly → méga.**
5. Écris `getX(obj) { return obj.x; }` (un seul site d'accès). Benche-le avec : une seule forme (mono), 4 formes distinctes (poly), 8 formes distinctes (méga). Note les 3 temps.
6. Construis un tableau de 100 000 membres via `buildMemberBroken` en variant `role`, `legacy` et présence d'`email` (pour générer beaucoup de formes). Benche `totalSeniority(members)`.

**Partie 3 — Réparer.**
7. Écris une classe `Member` avec **toutes** les propriétés initialisées (`email`/`avatar` à `null`, `isAdmin` booléen), dans un **ordre fixe**, **sans** `delete`.
8. Écris `buildMemberFixed(row)` qui retourne `new Member(row)`. Reconstruis les 100 000 membres avec, et vérifie via `%HaveSameMap` sur un échantillon qu'ils partagent tous la même forme.
9. Re-benche `totalSeniority` sur la version réparée. Compare au temps de l'étape 6.

**Critère de réussite (validé en session) :** toutes les comparaisons `%HaveSameMap` de la Partie 1 sont correctement prédites et expliquées ; le bench Partie 2 montre une dégradation nette mono < poly < méga ; la version réparée de la Partie 3 donne 1 seule forme pour tous les membres et un `totalSeniority` mesurablement plus rapide.

---

## Corrigé complet commenté

```js
// solution.mjs — node --allow-natives-syntax solution.mjs

// ══════════ Mapper cassé (rappel) ══════════
function buildMemberBroken(row) {
  const m = {};
  m.id = row.id;
  m.name = row.name;
  if (row.email) m.email = row.email;
  if (row.role === 'admin') m.isAdmin = true;
  if (row.legacy) { m.familyId = row.familyId; m.joinedAt = row.joinedAt; }
  else { m.joinedAt = row.joinedAt; m.familyId = row.familyId; }
  if (!row.email) delete m.email;
  return m;
}

function totalSeniority(members) {
  let total = 0;
  for (const m of members) total += Date.now() - m.joinedAt;
  return total;
}

function bench(label, fn, iter = 2_000_000) {
  for (let i = 0; i < 1000; i++) fn();
  const t = performance.now();
  for (let i = 0; i < iter; i++) fn();
  console.log(`${label}: ${(performance.now() - t).toFixed(1)} ms`);
}

// ══════════ PARTIE 1 — Observer les formes ══════════
console.log('=== Partie 1 : hidden classes ===');

// 1. Même profil exact -> même forme
const a = buildMemberBroken({ id: 1, name: 'A', email: 'a@x.fr', role: 'admin', legacy: false, familyId: 7, joinedAt: 1000 });
const b = buildMemberBroken({ id: 2, name: 'B', email: 'b@x.fr', role: 'admin', legacy: false, familyId: 7, joinedAt: 2000 });
console.log('même profil -> même forme ?', %HaveSameMap(a, b)); // true

// 2. legacy diffère -> ordre familyId/joinedAt inversé -> formes différentes
const leg = buildMemberBroken({ id: 3, name: 'C', email: 'c@x.fr', role: 'admin', legacy: true, familyId: 7, joinedAt: 3000 });
console.log('legacy change l\'ordre -> forme ?', %HaveSameMap(a, leg)); // false
// Explication : même avec les mêmes clés, l'ordre d'ajout familyId/joinedAt
// diffère -> chemin de transition différent -> hidden class différente.

// 3. admin vs member -> isAdmin présent ou absent -> formes différentes
const mem = buildMemberBroken({ id: 4, name: 'D', email: 'd@x.fr', role: 'member', legacy: false, familyId: 7, joinedAt: 4000 });
console.log('admin vs member -> forme ?', %HaveSameMap(a, mem)); // false
// Explication : isAdmin est ajouté conditionnellement -> une forme avec, une sans.

// 4. delete -> dictionary mode
const noEmail = buildMemberBroken({ id: 5, name: 'E', role: 'admin', legacy: false, familyId: 7, joinedAt: 5000 });
console.log('avec email vs delete email -> forme ?', %HaveSameMap(a, noEmail)); // false
console.log('--- %DebugPrint de l\'objet passé par delete ---');
%DebugPrint(noEmail); // cherche "dictionary" / "slow" dans la sortie
// Explication : le delete m.email fait basculer l'objet en mode dictionnaire
// (hash table). Sa forme n'est plus partageable, son IC est désactivé.

// ══════════ PARTIE 2 — Mesurer mono/poly/méga ══════════
console.log('\n=== Partie 2 : états d\'inline cache ===');

function getX(obj) { return obj.x; } // UN seul site d'accès

// Monomorphe : 1 forme
const s1 = { x: 1, y: 2 };
const s2 = { x: 3, y: 4 };
console.log('mono même forme ?', %HaveSameMap(s1, s2)); // true
bench('  monomorphe   ', () => { getX(s1); getX(s2); });

// Polymorphe : 4 formes
const p1 = { x: 1 };
const p2 = { x: 1, y: 2 };
const p3 = { x: 1, y: 2, z: 3 };
const p4 = { x: 1, y: 2, z: 3, w: 4 };
bench('  polymorphe(4)', () => { getX(p1); getX(p2); getX(p3); getX(p4); });

// Mégamorphe : 8 formes
const many = [];
for (let i = 0; i < 8; i++) {
  const o = { x: i };
  for (let j = 0; j < i; j++) o['p' + j] = j;
  many.push(o);
}
bench('  mégamorphe(8)', () => { for (const o of many) getX(o); });

// 6. totalSeniority sur 100 000 membres construits avec le mapper cassé
console.log('\n--- totalSeniority sur le mapper CASSÉ ---');
const rowsFor = (n) => Array.from({ length: n }, (_, i) => ({
  id: i,
  name: 'm' + i,
  email: i % 2 === 0 ? `m${i}@x.fr` : undefined, // moitié sans email -> delete
  role: i % 3 === 0 ? 'admin' : 'member',        // isAdmin conditionnel
  legacy: i % 5 === 0,                            // ordre variable
  familyId: i % 100,
  joinedAt: 1_000_000 + i,
}));

const rows = rowsFor(100_000);
const brokenMembers = rows.map(buildMemberBroken);
bench('  totalSeniority (cassé)', () => totalSeniority(brokenMembers), 200);

// ══════════ PARTIE 3 — Réparer ══════════
console.log('\n=== Partie 3 : forme stable ===');

class Member {
  constructor(row) {
    // Ordre FIXE + toutes les propriétés TOUJOURS présentes + aucun delete
    this.id = row.id;
    this.name = row.name;
    this.email = row.email ?? null;        // jamais absent
    this.avatar = row.avatarUrl ?? null;   // réservé dans la forme
    this.isAdmin = row.role === 'admin';   // booléen stable
    this.familyId = row.familyId;          // ordre garanti
    this.joinedAt = row.joinedAt;          // toujours après familyId
  }
}

function buildMemberFixed(row) {
  return new Member(row);
}

// 8. Toutes les instances partagent la même forme, quel que soit le profil
const fixedMembers = rows.map(buildMemberFixed);
console.log('échantillon : formes identiques ?',
  %HaveSameMap(fixedMembers[0], fixedMembers[1]) &&   // profils différents
  %HaveSameMap(fixedMembers[0], fixedMembers[7]) &&
  %HaveSameMap(fixedMembers[0], fixedMembers[99_999]));
// true : email présent ou null, admin ou non, legacy ou non -> UNE seule forme

// 9. Re-bench : l'IC de m.joinedAt est maintenant monomorphe
bench('  totalSeniority (réparé)', () => totalSeniority(fixedMembers), 200);
// Attendu : nettement plus rapide que la version cassée.
```

**Pourquoi ce corrigé est correct :**
- La classe `Member` fixe l'ordre d'affectation dans le constructeur → un seul chemin de transition → une seule hidden class pour toutes les instances.
- `email` et `avatar` sont **toujours** initialisés (à `null` si inconnus) : plus d'ajout conditionnel, donc plus de formes divergentes.
- `isAdmin` est un booléen **toujours présent** (`role === 'admin'`), pas une propriété ajoutée seulement pour les admins.
- Aucun `delete` : les objets restent en fast mode, l'inline caching fonctionne.
- Résultat : le site d'accès `m.joinedAt` dans `totalSeniority` ne voit qu'une forme → IC monomorphe → chargement par offset direct.

---

## Variante J+30 (fading)

**Même problème, contrainte ajoutée — à refaire de mémoire en 20 minutes, sans rouvrir ce corrigé :**

1. Ajoute un mapper `buildFamilyBroken(row)` qui construit un objet `Family` avec les mêmes défauts (ajout conditionnel de `premiumUntil`, `tags` seulement si non vide, `delete` d'un champ temporaire).
2. Écris un chemin chaud `aggregateStats(families)` qui lit `f.members.length` et `f.memberCount` dans une boucle.
3. Réécris en classe `Family` à forme stable (`members: []`, `tags: []`, `premiumUntil: null` toujours présents) et prouve avec `%HaveSameMap` que 50 000 familles partagent une forme unique.
4. Mesure le gain sur `aggregateStats`.

**Critère de réussite :** une seule forme pour toutes les familles, et `aggregateStats` mesurablement plus rapide qu'avec le mapper cassé.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, porte le résultat sur le vrai code :

```
tribuzen/apps/api/src/
  members/
    member.entity.ts        // class Member — forme stable, ordre fixe
    member.mapper.ts         // buildMember normalisé (plus de delete, plus d'ajout conditionnel)
    members.service.ts       // totalSeniority — chemin chaud, IC monomorphe
  families/
    family.entity.ts         // class Family idem (variante J+30)
    family.mapper.ts
    families.service.ts      // aggregateStats
  scripts/perf/
    bench-member-shape.mjs   // mesure avant/après (node --allow-natives-syntax)
```

**Différences par rapport au lab :**
- Le mapper réel lit des entités TypeORM / documents Mongo — la logique de normalisation de forme reste identique.
- Les DTO de sortie (annotées `class-transformer`) doivent garder un ordre de champs cohérent pour ne pas multiplier les formes sérialisées.
- Le script `bench-member-shape.mjs` tourne hors serveur (Node direct avec le flag), pas dans le process NestJS.

**Commit cible :**
```
perf(members): Member à forme stable — IC monomorphe sur totalSeniority
perf(families): Family à forme stable + bench avant/après
```
