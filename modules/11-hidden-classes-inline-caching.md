---
titre: Hidden Classes et Inline Caching
cours: 01-js-runtime
notions: [hidden classes et Maps V8, forme d'objet et transitions, ordre d'ajout des propriétés, initialisation complète dans le constructeur, inline caches, IC monomorphe polymorphe mégamorphe, coût de delete et du dictionary mode, lien avec le JIT]
outcomes: [créer des objets de forme stable pour garder les accès monomorphes, diagnostiquer une divergence de hidden classes avec les intrinsics V8, réécrire un code qui casse les inline caches pour restaurer des accès rapides]
prerequis: [10-jit-compilation-optimization]
next: 12-performance-patterns
libs: []
tribuzen: normalisation de la forme des objets Member et Family de l'API TribuZen pour garder les inline caches monomorphes sur les chemins chauds
last-reviewed: 2026-07
---

# Hidden Classes et Inline Caching

> **Outcomes — tu sauras FAIRE :** créer des objets de forme stable pour garder les accès monomorphes, diagnostiquer une divergence de hidden classes avec `%HaveSameMap`, réécrire un code qui casse les inline caches pour restaurer les accès rapides.
> **Difficulté :** :star::star::star::star:

## 1. Cas concret d'abord

L'endpoint `GET /api/families/:id/members` de TribuZen renvoie la liste des membres d'une famille. Sous charge, le tri et l'agrégation deviennent 6x plus lents que ce que la logique justifie. Voici comment les objets `Member` sont construits dans le service :

```js
// members.service.js — AVANT (forme instable)
function buildMember(row) {
  const m = {};
  m.id = row.id;
  m.name = row.name;

  // Ajouts conditionnels : chaque combinaison crée une forme différente
  if (row.email) m.email = row.email;
  if (row.role === 'admin') m.isAdmin = true;
  if (row.avatarUrl) m.avatar = row.avatarUrl;

  // Ordre variable selon la source de données
  if (row.legacy) {
    m.familyId = row.familyId;
    m.joinedAt = row.joinedAt;
  } else {
    m.joinedAt = row.joinedAt;
    m.familyId = row.familyId;
  }

  // Nettoyage "propre" en apparence — en réalité catastrophique
  if (!row.email) delete m.email;

  return m;
}

// Chemin chaud : appelé sur chaque membre à chaque requête
function totalSeniority(members) {
  let total = 0;
  for (const m of members) {
    total += Date.now() - m.joinedAt; // accès m.joinedAt lu des milliers de fois
  }
  return total;
}
```

**Trois problèmes invisibles à l'œil nu :**
1. `email`, `isAdmin`, `avatar` sont ajoutés **conditionnellement** — 8 combinaisons possibles = jusqu'à 8 formes d'objet différentes.
2. L'ordre `familyId` / `joinedAt` **change** selon `row.legacy` — deux formes de plus, même avec les mêmes propriétés.
3. Le `delete m.email` fait **basculer l'objet en mode dictionnaire** — le pire cas.

Résultat : la boucle `totalSeniority` voit des dizaines de formes différentes pour `m.joinedAt`. Son inline cache passe de **monomorphe** (rapide) à **mégamorphe** (lent). Ce module explique pourquoi, et comment normaliser la forme pour restaurer la vitesse.

---

## 2. Théorie complète, concise

### 2.1 Le problème que V8 doit résoudre

En C++ ou Java, le compilateur connaît la structure exacte d'un objet : il sait que `point.x` est à l'offset mémoire 0, `point.y` à l'offset 8. L'accès est une seule instruction machine (~1 ns).

En JavaScript, un objet est un dictionnaire ouvert : on peut ajouter, supprimer, changer le type de n'importe quelle propriété à tout moment.

```js
const p = { x: 1, y: 2 };
p.z = 3;        // ajout à la volée
delete p.y;     // suppression
p.x = "hello";  // changement de type
```

Si V8 cherchait chaque propriété dans une table de hachage à chaque accès (~100 ns), JavaScript serait inutilisable pour du calcul. La solution : les **hidden classes**.

### 2.2 Hidden class = la forme d'un objet

Chaque objet JS pointe vers une **hidden class** (nommée **Map** dans V8, **Shape** dans Firefox, **Structure** dans Safari — même concept). La hidden class décrit la **forme** de l'objet, indépendamment de ses valeurs :

- la liste des propriétés et l'**offset** de chacune,
- le **type** de chaque propriété (entier, double, pointeur),
- le prototype,
- les **transitions** possibles vers d'autres formes.

Deux objets qui ont exactement les mêmes propriétés, dans le même ordre, avec les mêmes types, **partagent la même hidden class**. C'est ça qui permet à V8 de traiter `m.joinedAt` par un offset fixe au lieu d'un lookup.

```js
// node --allow-natives-syntax
const a = { x: 1, y: 2 };
const b = { x: 10, y: 20 };
console.log(%HaveSameMap(a, b)); // true — même forme, valeurs différentes
```

### 2.3 Les transitions de forme

Quand on part d'un objet vide et qu'on ajoute des propriétés, V8 crée une **chaîne de transitions** entre formes :

```js
const obj = {};   // forme F0 (vide)
obj.x = 1;        // transition F0 -> F1 (a "x")
obj.y = 2;        // transition F1 -> F2 (a "x", "y")
```

Point crucial : si un autre objet ajoute les **mêmes** propriétés dans le **même** ordre, il réemprunte les mêmes formes. Les transitions sont partagées.

```js
const a = {}; a.x = 1; a.y = 2;   // parcourt F0 -> F1 -> F2
const b = {}; b.x = 9; b.y = 8;   // réutilise F0 -> F1 -> F2
// a et b finissent sur F2 — même hidden class
```

### 2.4 Pourquoi l'ordre des propriétés compte

Les propriétés ajoutées dans un ordre différent produisent des **chemins de transition différents**, donc des hidden classes différentes — **même si les propriétés finales sont identiques**.

```js
function PointA(x, y) { this.x = x; this.y = y; } // chemin +x puis +y -> F2
function PointB(x, y) { this.y = y; this.x = x; } // chemin +y puis +x -> F4

const a = new PointA(1, 2); // forme F2
const b = new PointB(1, 2); // forme F4
// a.x === b.x et a.y === b.y, mais formes DIFFÉRENTES
console.log(%HaveSameMap(a, b)); // false
```

Une fonction qui lit `p.x` et reçoit tantôt des `PointA`, tantôt des `PointB`, voit deux formes → son cache d'accès se dégrade. D'où la règle : **toujours affecter les propriétés dans le même ordre.**

### 2.5 Initialiser toutes les propriétés dans le constructeur

Corollaire direct : si une propriété est parfois présente, parfois absente, tu crées deux formes. La solution est d'initialiser **toutes** les propriétés dès la construction, même à `null` ou `0` :

```js
// MAL — 2 formes selon la présence de bonus
const r1 = { id: 1, value: 42 };
if (hasBonus) r1.bonus = 10;

// BIEN — 1 seule forme, toujours
const r2 = { id: 1, value: 42, bonus: hasBonus ? 10 : 0 };
```

```js
// Classe : le constructeur garantit forme unique + ordre fixe
class Member {
  constructor(id, name, joinedAt) {
    this.id = id;
    this.name = name;
    this.joinedAt = joinedAt;
    this.email = null;   // même si inconnu pour l'instant
    this.avatar = null;  // réservé dans la forme
    this.isAdmin = false;
  }
}
// Toutes les instances partagent une seule hidden class.
```

### 2.6 Le type des propriétés compte aussi

V8 traque la **représentation** de chaque champ : entier court (Smi), double, ou pointeur (HeapObject). Changer le type d'un champ après coup fait **déprécier** la forme et migrer les objets — un coût caché.

```js
const p = { x: 1 };  // x tracké comme entier
p.x = 1.5;           // x migre vers Double : forme dépréciée
p.x = "hi";          // x migre vers pointeur : re-dépréciation
```

Règle : garder chaque champ d'un **type stable**. Si un champ peut être fractionnaire, l'initialiser avec `0.0`, pas `0`.

### 2.7 `delete` et le mode dictionnaire

`delete obj.prop` est le déclencheur n°1 du **mode dictionnaire** (slow properties) : l'objet abandonne sa hidden class et repasse à une vraie table de hachage. Les accès deviennent 10-20x plus lents **et l'inline caching est désactivé pour cet objet**. Pire : la récupération est quasi impossible, l'objet reste en mode dictionnaire.

```js
// MAL
delete user.tempData;      // -> mode dictionnaire, irréversible

// BIEN
user.tempData = undefined; // garde la forme intacte
// ENCORE MIEUX : ne jamais ajouter tempData si elle doit disparaître
```

### 2.8 Inline Caching (IC) : le cache des accès de propriété

Un **inline cache** est un cache attaché à **chaque site d'accès** de propriété dans le code (chaque `obj.x` écrit dans le source). Il mémorise « pour la forme F, la propriété x est à l'offset N ». Le prochain accès qui présente la même forme court-circuite tout le lookup.

Ce cache a quatre états, selon le **nombre de formes** vues à ce site :

```
  UNINITIALIZED  (jamais exécuté)
       |  1re forme observée
       v
  MONOMORPHE   (1 forme)      -> OPTIMAL   : 2-3 instructions machine
       |  2e forme différente
       v
  POLYMORPHE   (2 à 4 formes) -> ACCEPTABLE: chaîne de comparaisons
       |  ~5e forme différente
       v
  MÉGAMORPHE   (5+ formes)    -> LENT      : lookup générique par appel
```

- **Monomorphe** : le site n'a vu qu'une forme. V8 génère un accès direct par offset. C'est la cible.
- **Polymorphe** : 2 à 4 formes. V8 génère une petite chaîne de « si forme == F1 → offset a ; sinon si F2 → offset b ». Encore correct, mais coûte plus à chaque forme ajoutée.
- **Mégamorphe** : au-delà de ~4-5 formes, V8 abandonne la spécialisation et retombe sur un lookup générique (cache global partagé). Nettement plus lent (~5-10x le monomorphe).

Le seuil poly → méga est un paramètre interne V8 (4 ou 5 selon les versions).

### 2.9 Le lien avec le JIT (module 10)

Ce module et le module 10 décrivent **deux faces du même feedback**. Le type feedback que TurboFan consomme pour spéculer contient, pour chaque accès de propriété, **la ou les hidden classes observées et l'état de l'IC**.

- IC **monomorphe** → TurboFan inline l'accès en un chargement par offset, et peut enchaîner d'autres optimisations (module 10 : inlining, escape analysis).
- IC **mégamorphe** → TurboFan ne peut pas spécialiser : il génère un accès générique. La fonction reste compilée, mais lente.
- Un **changement de forme** après optimisation (nouvelle propriété, `delete`, changement de type) invalide la spéculation → **déoptimisation** (module 10, deopt lazy « wrong map »).

Autrement dit : **des formes instables sabotent le JIT.** Garder des hidden classes stables est le prérequis concret pour que tout ce que fait TurboFan tienne.

### 2.10 Récapitulatif des règles pratiques

1. Initialiser **toutes** les propriétés dans le constructeur / literal.
2. Toujours le **même ordre** d'affectation.
3. Ne **jamais** ajouter de propriété conditionnellement à la volée sur un chemin chaud.
4. Ne **jamais** utiliser `delete` (préférer `= undefined`, ou ne pas ajouter).
5. Garder chaque champ d'un **type stable**.
6. Préférer les **classes** pour les objets structurels réutilisés.
7. Pour un dictionnaire à clés dynamiques, utiliser `new Map()`, pas un objet littéral.

---

## 3. Worked examples

### Exemple 1 — Restaurer une forme stable dans le service TribuZen

Reprenons `buildMember` du cas concret et corrigeons-le pas à pas.

**Étape 1 — repérer les sources de divergence.** Trois : ajouts conditionnels (`email`, `isAdmin`, `avatar`), ordre variable (`familyId` / `joinedAt`), et le `delete m.email`.

**Étape 2 — figer la forme dans une classe** avec toutes les propriétés initialisées, dans un ordre unique :

```js
// members.service.js — APRÈS (forme stable)
class Member {
  constructor(row) {
    // Ordre FIXE, toutes les propriétés TOUJOURS présentes
    this.id = row.id;
    this.name = row.name;
    this.email = row.email ?? null;          // jamais absent, jamais delete
    this.avatar = row.avatarUrl ?? null;     // null si inconnu
    this.isAdmin = row.role === 'admin';     // booléen stable, jamais absent
    this.familyId = row.familyId;            // ordre garanti par le constructeur
    this.joinedAt = row.joinedAt;            // toujours après familyId
  }
}

function buildMember(row) {
  return new Member(row);
}

// Chemin chaud inchangé — mais maintenant m.joinedAt est monomorphe
function totalSeniority(members) {
  let total = 0;
  for (const m of members) {
    total += Date.now() - m.joinedAt;
  }
  return total;
}
```

**Étape 3 — vérifier que toutes les instances partagent la forme :**

```js
// node --allow-natives-syntax
const a = buildMember({ id: 1, name: 'A', role: 'admin', familyId: 7, joinedAt: 1000 });
const b = buildMember({ id: 2, name: 'B', role: 'member', familyId: 7, joinedAt: 2000 });
const c = buildMember({ id: 3, name: 'C', email: 'c@x.fr', familyId: 9, joinedAt: 3000 });

console.log(%HaveSameMap(a, b)); // true
console.log(%HaveSameMap(a, c)); // true — même avec email présent, la forme est identique
```

**Résultat :** l'IC de `m.joinedAt` dans `totalSeniority` ne voit plus qu'**une** forme → monomorphe → accès direct par offset. Les ~8 formes précédentes s'effondrent en une seule.

### Exemple 2 — Reproduire mono → poly → méga et le mesurer

On isole un site d'accès `obj.x` et on le nourrit avec un nombre croissant de formes.

```js
// ic-states.mjs
// node --allow-natives-syntax ic-states.mjs
function bench(label, fn, iter = 2_000_000) {
  for (let i = 0; i < 1000; i++) fn(); // warmup pour laisser l'IC se stabiliser
  const t = performance.now();
  for (let i = 0; i < iter; i++) fn();
  console.log(`${label}: ${(performance.now() - t).toFixed(1)} ms`);
}

function getX(obj) { return obj.x; } // UN seul site d'accès, réutilisé partout

// Monomorphe : une seule forme
const m1 = { x: 1, y: 2 };
const m2 = { x: 3, y: 4 };
console.log('mono même forme?', %HaveSameMap(m1, m2)); // true
bench('monomorphe', () => { getX(m1); getX(m2); });

// Polymorphe : 4 formes distinctes (nombre de props croissant)
const p1 = { x: 1 };
const p2 = { x: 1, y: 2 };
const p3 = { x: 1, y: 2, z: 3 };
const p4 = { x: 1, y: 2, z: 3, w: 4 };
bench('polymorphe (4)', () => { getX(p1); getX(p2); getX(p3); getX(p4); });

// Mégamorphe : 8 formes distinctes
const shapes = [];
for (let i = 0; i < 8; i++) {
  const o = { x: i };
  for (let j = 0; j < i; j++) o['p' + j] = j; // formes toutes différentes
  shapes.push(o);
}
bench('mégamorphe (8)', () => { for (const s of shapes) getX(s); });
```

Sortie typique (ordres de grandeur, machine-dépendante) :

```
monomorphe: 12.4 ms
polymorphe (4): 21.8 ms
mégamorphe (8): 74.1 ms
```

**Lecture :** le même code source `return obj.x` est ~6x plus lent quand le site voit 8 formes au lieu d'une. Ce n'est pas la logique qui coûte — c'est le nombre de formes présentées au site d'accès. Exactement le symptôme du cas concret.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que « mêmes propriétés » suffit

```js
const a = { x: 1, y: 2 };
const b = { y: 2, x: 1 }; // mêmes clés, mêmes valeurs... ordre différent
console.log(%HaveSameMap(a, b)); // false
```

**Pourquoi c'est faux :** la hidden class encode le **chemin de transition**, pas juste l'ensemble des clés. `{x,y}` et `{y,x}` sont deux formes. **Le correct :** normaliser l'ordre de construction (factory unique ou classe).

### PIÈGE #2 — `delete` pour « nettoyer » un objet

```js
// ❌ paraît propre, casse tout
if (!member.email) delete member.email; // -> mode dictionnaire, irréversible
```

**Pourquoi c'est faux :** `delete` fait basculer l'objet en mode dictionnaire (hash table), désactive son IC et rend la récupération impossible. **Le correct :** `member.email = null`, ou ne jamais créer un objet dont on devra retirer un champ.

### PIÈGE #3 — Ajouter une propriété « juste au cas où »

```js
// ❌ 2 formes selon la branche
const r = { id, value };
if (isSpecial) r.tag = 'x';
```

**Pourquoi c'est faux :** deux formes divergent au premier accès polymorphe en aval. **Le correct :** `const r = { id, value, tag: isSpecial ? 'x' : null };` — une seule forme.

### PIÈGE #4 — Confondre polymorphe et mégamorphe

Un site **polymorphe** (2-4 formes) reste raisonnablement rapide : V8 garde une petite chaîne de comparaisons. Le vrai décrochage est **mégamorphe** (5+ formes), où V8 abandonne la spécialisation. **La discrimination utile :** viser le monomorphe sur les chemins chauds, tolérer le polymorphe ailleurs, traquer et éliminer le mégamorphe. Ne pas paniquer sur 2 formes ; paniquer sur 8.

### PIÈGE #5 — Changer le type d'un champ

```js
const p = { ratio: 1 }; // entier
p.ratio = 0.5;          // -> Double : forme dépréciée + migration
```

**Pourquoi c'est faux :** même nom, même ordre, mais la représentation change → la forme est dépréciée. **Le correct :** initialiser avec le type cible (`{ ratio: 1.0 }`) et rester cohérent.

---

## 5. Ancrage TribuZen

L'API TribuZen (NestJS) sérialise en permanence des objets `Member` et `Family` sur les chemins chauds : listes de membres, agrégats de familles, tri, calculs de séniorité. Ces objets sont construits à partir de lignes SQL / documents, souvent par des mappers écrits au fil de l'eau — terrain idéal pour les formes instables.

**Objets `Member`** (`src/members/member.entity.ts` + mapper) — la source du cas concret. Propriétés conditionnelles (`email`, `avatar`, `isAdmin`), ordre variable selon la source legacy, `delete` de nettoyage. Normalisés en une classe `Member` à forme unique, toutes propriétés initialisées, ordre fixe.

**Objets `Family`** (`src/families/family.mapper.ts`) — même traitement : `members`, `tags`, `settings` toujours présents (tableau ou objet vide plutôt qu'absent), pas d'ajout conditionnel de `premiumUntil` (initialisé à `null`).

**Chemins chauds concernés :**
- `MembersService.totalSeniority()` — boucle qui lit `m.joinedAt` sur chaque membre.
- `FamiliesService.aggregateStats()` — lit `f.members.length`, `f.tags` sur chaque famille.
- Les DTO annotées `class-transformer` — garder l'ordre des champs cohérent pour ne pas multiplier les formes de sortie.

**Méthode de validation :** un script de bench dans `scripts/perf/` construit 100 000 membres via l'ancien mapper puis via la classe normalisée, compare `%HaveSameMap` sur un échantillon et le temps de `totalSeniority`. Objectif : passer d'un IC mégamorphe (dizaines de formes) à monomorphe (1 forme), avec un gain mesurable sur la boucle.

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/src/
  members/
    member.entity.ts       // classe Member, forme stable
    member.mapper.ts        // buildMember normalisé
    members.service.ts      // totalSeniority (chemin chaud)
  families/
    family.mapper.ts        // Family à forme stable
    families.service.ts     // aggregateStats
  scripts/perf/
    bench-member-shape.mjs  // mesure avant/après (--allow-natives-syntax)
```

---

## 6. Points clés

1. Une **hidden class** (Map V8 / Shape / Structure) décrit la **forme** d'un objet : propriétés, offsets, types, prototype — pas ses valeurs.
2. Deux objets partagent la même hidden class **seulement** s'ils ont les mêmes propriétés, dans le **même ordre**, avec les mêmes types.
3. Ajouter des propriétés génère des **transitions de forme** partagées ; l'**ordre d'ajout** détermine le chemin, donc la forme finale.
4. Initialiser **toutes** les propriétés dans le constructeur (même à `null`/`0`) garantit une forme unique et stable.
5. Un **inline cache** vit sur chaque site d'accès `obj.x` : **monomorphe** (1 forme, rapide) → **polymorphe** (2-4 formes) → **mégamorphe** (5+ formes, lent).
6. `delete` fait basculer l'objet en **mode dictionnaire** (10-20x plus lent, IC désactivé, irréversible) — utiliser `= undefined`.
7. Changer le **type** d'un champ déprécie la forme et migre les objets — garder les types stables.
8. Hidden classes stables = prérequis du **JIT** : IC monomorphe → TurboFan spécialise ; forme instable → déoptimisation.
9. Pour un dictionnaire à clés dynamiques, utiliser `new Map()`, jamais un objet littéral muté.

---

## 7. Seeds Anki

```
Qu'est-ce qu'une hidden class (Map V8) et que décrit-elle ?|Une structure interne qui décrit la FORME d'un objet — liste des propriétés, offset de chacune, type de chaque champ, prototype et transitions — indépendamment des valeurs. Elle permet à V8 d'accéder aux propriétés par offset fixe au lieu d'un lookup en table de hachage.
Deux objets { x:1, y:2 } et { y:2, x:1 } partagent-ils la même hidden class ?|Non. La hidden class encode le chemin de transition (l'ordre d'ajout des propriétés), pas seulement l'ensemble des clés. Ordre différent = forme différente, même avec les mêmes clés et valeurs.
Pourquoi faut-il initialiser toutes les propriétés dans le constructeur ?|Une propriété parfois présente / parfois absente crée deux formes d'objet distinctes. Tout initialiser (même à null ou 0) garantit une forme unique et stable, donc des inline caches monomorphes en aval.
Quels sont les 4 états d'un inline cache et lequel viser ?|UNINITIALIZED, MONOMORPHE (1 forme, optimal), POLYMORPHE (2-4 formes, acceptable), MÉGAMORPHE (5+ formes, lent). Sur les chemins chauds on vise le monomorphe ; on tolère le polymorphe ; on élimine le mégamorphe.
Pourquoi ne jamais utiliser delete sur un objet chaud ?|delete fait basculer l'objet en mode dictionnaire (vraie table de hachage) : accès 10-20x plus lents, inline caching désactivé, et récupération quasi impossible. Préférer obj.prop = undefined, ou ne pas ajouter la propriété.
Quel est le lien entre hidden classes et le JIT (TurboFan) ?|Le type feedback contient les hidden classes observées et l'état de l'IC par site d'accès. IC monomorphe -> TurboFan inline l'accès par offset et spécialise ; IC mégamorphe -> accès générique non spécialisé ; changement de forme après optimisation -> déoptimisation (wrong map).
Que se passe-t-il si on change le type d'un champ (entier -> double) après coup ?|V8 traque la représentation de chaque champ. Un changement de type déprécie la forme existante et migre les objets vers une nouvelle forme — un coût caché. Garder chaque champ d'un type stable (initialiser 0.0 si le champ peut être fractionnaire).
Quel intrinsic V8 permet de vérifier que deux objets ont la même forme ?|%HaveSameMap(a, b), disponible sous node --allow-natives-syntax. Retourne true si a et b partagent exactement la même hidden class. %DebugPrint(obj) affiche la forme, les types de champs et l'elements kind.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-11-hidden-classes/README.md`. Comparer objets de forme stable vs instable avec `%HaveSameMap`, mesurer la dégradation mono → poly → méga, puis normaliser un mapper `Member` de TribuZen pour restaurer un IC monomorphe.
