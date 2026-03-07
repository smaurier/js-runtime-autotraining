# Module 11 — Hidden Classes & Inline Caching

> **Objectif** : Ce module est la référence unique et approfondie sur les Hidden Classes (Maps) et l'Inline Caching dans V8. Comprendre la structure mémoire interne des objets JavaScript (JSObject header, in-object properties, backing store), les chaînes et arbres de transitions de Maps, les descriptor arrays, le slack tracking, la dépréciation de Maps, le dictionary mode, l'Inline Caching (IC) et ses états, les Elements Kinds des tableaux, le property type tracking, et les intrinsics V8 pour le diagnostic. Ce module ne revient pas sur le pipeline V8 (Module 09) ni sur les optimisations JIT (Module 10) — il se concentre exclusivement sur la manière dont V8 représente et accède aux propriétés des objets.

> **Difficulté** : ⭐⭐⭐⭐ (Expert)

---

## Prérequis

- Module 09 — Architecture V8 (pipeline, Feedback Vectors)
- Bonne maîtrise de la création d'objets en JavaScript (literals, constructeurs, classes)
- Accès à Node.js >= 18 avec le flag `--allow-natives-syntax`

---

## Théorie

> **Analogie pour débuter** : Les Hidden Classes, c'est comme un plan d'architecte pour une maison. Toutes les maisons construites avec le même plan (mêmes propriétés, même ordre) partagent le plan. Mais si tu ajoutes une pièce après construction (ajouter une propriété), tu as besoin d'un nouveau plan.

### 1. Le problème fondamental : JavaScript est dynamique

En C++ ou Java, le compilateur connaît la structure exacte de chaque objet à la compilation. Le moteur sait à quel *offset mémoire* se trouve chaque propriété.

```cpp
// C++ — le compilateur sait que 'x' est à l'offset 0, 'y' à l'offset 8
struct Point { double x; double y; };

// L'accès à p.x est une simple instruction :
// mov rax, [rdi + 0]    ; offset 0 = x
// Temps : ~1 ns
```

> **Note** : même si tu ne connais pas le C++, l'idée est simple. Dans un langage statique comme C++, le compilateur sait **avant l'exécution** où chaque propriété se trouve en mémoire. En JavaScript, cette information n'existe pas à l'avance — d'où l'invention des Hidden Classes.

En JavaScript, un objet est un dictionnaire ouvert. On peut ajouter, supprimer, changer le type de n'importe quelle propriété à tout moment.

```js
const p = { x: 1, y: 2 };
p.z = 3;        // ajout dynamique
delete p.y;     // suppression
p.x = "hello";  // changement de type
```

Si V8 devait chercher chaque propriété dans un hash table à chaque accès, les performances seraient catastrophiques (~100 ns par accès au lieu de ~1 ns). D'où l'invention des **Hidden Classes**.

---

### 2. Hidden Classes (Maps) : la structure interne

Chaque objet JavaScript en V8 possède un pointeur vers une **Map** (aussi appelée *Hidden Class* dans la littérature académique, ou *Shape* dans SpiderMonkey/JSC).

Une Map décrit :
- La liste des propriétés de l'objet et l'**offset** de chacune dans le stockage interne
- Le **type** de chaque propriété (Smi, Double, HeapObject)
- Le **prototype** de l'objet
- Les **transitions** possibles vers d'autres Maps (quand on ajoute une propriété)
- La taille de l'objet et le nombre de propriétés in-object

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  STRUCTURE D'UN OBJET JS EN MÉMOIRE (JSObject)                    │
  │                                                                   │
  │  ┌──────────────────────────────────────────────────────┐         │
  │  │ JSObject Header (2 mots machine)                      │         │
  │  │ ┌─────────────────┐ ┌──────────────────────────────┐ │         │
  │  │ │  Map pointer     │ │  Properties/Elements pointer │ │         │
  │  │ │  (Hidden Class)  │ │  (backing store)             │ │         │
  │  │ └────────┬────────┘ └──────────────┬───────────────┘ │         │
  │  │          │                          │                 │         │
  │  │  In-object properties (slots fixes)                   │         │
  │  │ ┌────────┐ ┌────────┐ ┌────────┐                     │         │
  │  │ │ slot 0 │ │ slot 1 │ │ slot 2 │  ...                │         │
  │  │ │ (x: 1) │ │ (y: 2) │ │ (z: 3) │                     │         │
  │  │ └────────┘ └────────┘ └────────┘                     │         │
  │  └──────────────────────────────────────────────────────┘         │
  │                                                                   │
  │  Map pointer → pointe vers la Map qui décrit cette structure      │
  │  Properties pointer → pointe vers le backing store si les         │
  │    propriétés dépassent les slots in-object                       │
  │  Elements pointer → pointe vers le stockage des propriétés        │
  │    indexées (arr[0], arr[1], ...)                                  │
  └───────────────────────────────────────────────────────────────────┘
```

### 3. In-object properties vs Out-of-object backing store

V8 stocke les propriétés de deux manières :

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  IN-OBJECT PROPERTIES vs BACKING STORE                             │
  │                                                                   │
  │  Scénario 1 : peu de propriétés (< slots in-object disponibles)   │
  │                                                                   │
  │  const obj = { a: 1, b: 2, c: 3 };                               │
  │                                                                   │
  │  ┌────────────────────────────────────────┐                       │
  │  │ JSObject                                │                       │
  │  │ ┌──────────┐ ┌───────────────────────┐ │                       │
  │  │ │ Map *    │ │ Properties: empty_arr │ │                       │
  │  │ └──────────┘ └───────────────────────┘ │                       │
  │  │ ┌──────┐ ┌──────┐ ┌──────┐            │                       │
  │  │ │ a: 1 │ │ b: 2 │ │ c: 3 │ in-object  │ ← RAPIDE             │
  │  │ └──────┘ └──────┘ └──────┘            │ (un seul déréférencement)
  │  └────────────────────────────────────────┘                       │
  │                                                                   │
  │  Scénario 2 : trop de propriétés → overflow vers backing store    │
  │                                                                   │
  │  const obj = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, ... };      │
  │                                                                   │
  │  ┌────────────────────────────────────────┐                       │
  │  │ JSObject                                │                       │
  │  │ ┌──────────┐ ┌─────────────────────┐   │                       │
  │  │ │ Map *    │ │ Properties: ────────┼───┼──┐                    │
  │  │ └──────────┘ └─────────────────────┘   │  │                    │
  │  │ ┌──────┐ ┌──────┐ ┌──────┐            │  │                    │
  │  │ │ a: 1 │ │ b: 2 │ │ c: 3 │ in-object  │  │                    │
  │  │ └──────┘ └──────┘ └──────┘            │  │                    │
  │  └────────────────────────────────────────┘  │                    │
  │                                               │                    │
  │  ┌────────────────────────────────────────┐  │                    │
  │  │ FixedArray (backing store) ◄────────────┘                      │
  │  │ ┌──────┐ ┌──────┐ ┌──────┐                                    │
  │  │ │ d: 4 │ │ e: 5 │ │ f: 6 │ ...          │ ← PLUS LENT        │
  │  │ └──────┘ └──────┘ └──────┘              │ (deux déréférencements)
  │  └────────────────────────────────────────┘                       │
  │                                                                   │
  │  Nombre de slots in-object par défaut :                           │
  │  - Object literal : ~4 slots (ajustable par slack tracking)       │
  │  - Classe/constructeur : déterminé par le constructeur            │
  │  - Au-delà → FixedArray en backing store                          │
  └───────────────────────────────────────────────────────────────────┘
```

**Implication performance** : les propriétés in-object sont les plus rapides d'accès (un seul déréférencement de pointeur depuis l'objet). Les propriétés en backing store nécessitent un déréférencement supplémentaire vers le FixedArray.

### 4. Descriptor Arrays : les métadonnées des propriétés

Chaque Map possède un **Descriptor Array** qui décrit les propriétés associées à cette Map.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  DESCRIPTOR ARRAY                                                  │
  │                                                                   │
  │  Map M2 (pour les objets { x, y }) :                              │
  │                                                                   │
  │  Descriptor Array :                                               │
  │  ┌────────┬──────────────┬───────────┬──────────────────────┐     │
  │  │ Index  │ Nom          │ Type      │ Détails              │     │
  │  ├────────┼──────────────┼───────────┼──────────────────────┤     │
  │  │ 0      │ "x"          │ DATA      │ offset: 0            │     │
  │  │        │              │           │ repr: Smi            │     │
  │  │        │              │           │ attrs: W,E,C         │     │
  │  ├────────┼──────────────┼───────────┼──────────────────────┤     │
  │  │ 1      │ "y"          │ DATA      │ offset: 1            │     │
  │  │        │              │           │ repr: Smi            │     │
  │  │        │              │           │ attrs: W,E,C         │     │
  │  └────────┴──────────────┴───────────┴──────────────────────┘     │
  │                                                                   │
  │  W = Writable, E = Enumerable, C = Configurable                   │
  │  repr = représentation en mémoire (Smi, Double, Tagged/HeapObject)│
  │                                                                   │
  │  Le Descriptor Array est PARTAGÉ entre toutes les Maps qui        │
  │  sont dans la même chaîne de transitions (les Maps enfants        │
  │  réutilisent les descriptors de leurs parents + en ajoutent).     │
  └───────────────────────────────────────────────────────────────────┘
```

### 5. Chaînes de transitions (Transition Chains)

Quand on crée un objet vide puis qu'on ajoute des propriétés une par une, V8 crée une **chaîne de transitions** entre Maps.

```js
const obj = {};    // Map M0 (objet vide)
obj.x = 1;        // Transition M0 → M1 (propriété "x")
obj.y = 2;        // Transition M1 → M2 (propriétés "x", "y")
obj.z = 3;        // Transition M2 → M3 (propriétés "x", "y", "z")
```

```
  Chaîne de transitions (Transition Chain) :

  M0 (vide)
    │
    │ + "x" (Smi)
    ▼
  M1 { x }
    │
    │ + "y" (Smi)
    ▼
  M2 { x, y }
    │
    │ + "z" (Smi)
    ▼
  M3 { x, y, z }
```

**Point crucial** : si un autre objet ajoute les mêmes propriétés dans le même ordre, il **réutilise** les mêmes Maps. Les transitions sont partagées.

```js
const a = {};  a.x = 1;  a.y = 2;  // parcourt M0 → M1 → M2
const b = {};  b.x = 10; b.y = 20; // réutilise M0 → M1 → M2 (même Maps !)
// a et b partagent M2
```

### 6. Arbre de transitions (Transition Tree)

Quand des objets ajoutent des propriétés différentes à partir d'une même Map, cela crée un **arbre** de transitions :

```
  M0 (vide)
    ├──── + "x" ────→ M1 { x }
    │                    ├──── + "y" ────→ M2 { x, y }    ← objets {x, y}
    │                    └──── + "z" ────→ M5 { x, z }    ← objets {x, z}
    │
    └──── + "a" ────→ M3 { a }
                         └──── + "b" ────→ M4 { a, b }    ← objets {a, b}

  Les objets { x, y } et { a, b } n'ont PAS la même Map.
  Les objets { x, y } et { x, z } n'ont PAS la même Map non plus.

  Seuls les objets construits avec EXACTEMENT les mêmes propriétés,
  dans le MÊME ordre, partagent la même Map.
```

### 7. Pourquoi l'ordre des propriétés compte

```js
function PointA(x, y) {
  this.x = x;   // transition +x
  this.y = y;   // transition +y → Map M2
}

function PointB(x, y) {
  this.y = y;   // transition +y (chemin différent !)
  this.x = x;   // transition +x → Map M4 (pas M2 !)
}

const a = new PointA(1, 2);  // Map M2
const b = new PointB(1, 2);  // Map M4
// a et b ont les MÊMES propriétés (x et y) avec les MÊMES valeurs
// mais des Maps DIFFÉRENTES car l'ordre d'ajout diffère.
```

### 8. Slack Tracking : pré-allocation de slots

Quand V8 voit un constructeur ou un object literal pour la première fois, il ne sait pas combien de propriétés seront ajoutées. Le **slack tracking** est le mécanisme par lequel V8 pré-alloue des slots in-object supplémentaires en anticipation.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  SLACK TRACKING                                                    │
  │                                                                   │
  │  class Point {                                                    │
  │    constructor(x, y) {                                            │
  │      this.x = x;                                                  │
  │      this.y = y;                                                  │
  │    }                                                              │
  │  }                                                                │
  │                                                                   │
  │  Première instance : new Point(1, 2)                              │
  │  V8 alloue l'objet avec ~8 slots in-object (slack = 6)           │
  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ...               │
  │  │ x: 1 │ │ y: 2 │ │(vide)│ │(vide)│ │(vide)│                   │
  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘                   │
  │                                                                   │
  │  V8 crée ~8 instances en observant le pattern.                    │
  │                                                                   │
  │  Si après 8 instances, seuls x et y sont utilisés :               │
  │  → V8 réduit la taille à 2 slots + un petit slack (ex: 2)        │
  │  → Les instances suivantes sont plus compactes                    │
  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                             │
  │  │ x: 1 │ │ y: 2 │ │(vide)│ │(vide)│  ← slack réduit à 2       │
  │  └──────┘ └──────┘ └──────┘ └──────┘                             │
  │                                                                   │
  │  Le slack tracking se stabilise après ~8 instances du même        │
  │  constructeur (le nombre exact est un paramètre interne V8).      │
  │                                                                   │
  │  Implication : si vous ajoutez des propriétés après le            │
  │  constructeur et que le slack est déjà réduit, ces propriétés     │
  │  iront dans le backing store (plus lent).                         │
  └───────────────────────────────────────────────────────────────────┘
```

### 9. Map Deprecation : quand V8 déprécie une Map

Quand une propriété change de **représentation** (ex : d'un Smi vers un Double, ou d'un Double vers un HeapObject), V8 ne peut pas simplement modifier la Map existante car d'autres objets l'utilisent peut-être encore avec l'ancien type. V8 **déprécie** l'ancienne Map et en crée une nouvelle.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  MAP DEPRECATION                                                   │
  │                                                                   │
  │  const a = { x: 1, y: 2 };    // Map M2 : x=Smi, y=Smi          │
  │  const b = { x: 1, y: 2 };    // Map M2 (même)                   │
  │                                                                   │
  │  a.x = 1.5;  // x passe de Smi à Double !                        │
  │                                                                   │
  │  V8 ne peut pas modifier M2 (b l'utilise encore avec x=Smi)      │
  │  → V8 crée M2' avec x=Double, y=Smi                              │
  │  → V8 marque M2 comme "deprecated"                                │
  │                                                                   │
  │  M2 (deprecated)        M2' (nouvelle)                            │
  │  x: Smi, y: Smi        x: Double, y: Smi                         │
  │       ↑                      ↑                                    │
  │       │                      │                                    │
  │       b                      a                                    │
  │                                                                   │
  │  Quand b sera accédé la prochaine fois, V8 migrera               │
  │  automatiquement b vers M2' (migration transparente).             │
  │                                                                   │
  │  Ce qui déclenche la dépréciation :                               │
  │  - Changement de représentation (Smi → Double → HeapObject)      │
  │  - Changement d'attributs (writable → readonly)                   │
  │  - Reconfiguration via Object.defineProperty()                    │
  │                                                                   │
  │  Coût : la migration est O(nombre de propriétés) par objet.      │
  │  Si des milliers d'objets partagent la Map dépréciée,            │
  │  la migration peut être coûteuse (mais se fait paresseusement).  │
  └───────────────────────────────────────────────────────────────────┘
```

### 10. Property Type Tracking

V8 ne se contente pas de stocker les propriétés — il traque aussi leur **type** (représentation) dans les Descriptor Arrays de la Map.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  PROPERTY TYPE TRACKING                                            │
  │                                                                   │
  │  Trois représentations possibles par champ :                      │
  │                                                                   │
  │  Smi        : entier qui tient sur 31 bits (x64)                  │
  │               Stocké directement (pas de pointeur)                │
  │               Le plus rapide                                      │
  │                                                                   │
  │  Double     : nombre à virgule flottante (64 bits)                │
  │               Stocké inline (mutable double box) en in-object     │
  │               Pas d'allocation séparée pour les propriétés doubles │
  │               Depuis V8 9.0+ (avant : HeapNumber, allocation)     │
  │                                                                   │
  │  HeapObject : tout le reste (String, Object, Array, null, etc.)   │
  │               Stocké comme un pointeur (tagged pointer)           │
  │                                                                   │
  │  La transition Smi → Double → HeapObject est irréversible :       │
  │                                                                   │
  │  Smi ──────→ Double ──────→ HeapObject                            │
  │  (le plus     (pas de        (le plus                              │
  │   restrictif)  retour en      générique)                           │
  │               arrière !)                                           │
  │                                                                   │
  │  Exemple :                                                        │
  │  const p = { x: 1 };     // x tracké comme Smi                   │
  │  p.x = 1.5;              // x migre vers Double (Map dépréciée)  │
  │  p.x = 1;                // x RESTE Double (pas de retour)       │
  │  p.x = "hello";          // x migre vers HeapObject              │
  │                                                                   │
  │  Conseil : être consistant avec les types dès le départ.          │
  │  Si un champ peut être un double, initialiser avec 0.0 (pas 0).  │
  └───────────────────────────────────────────────────────────────────┘
```

### 11. Dictionary Mode (Slow Properties)

Quand un objet devient trop "dynamique", V8 abandonne les Maps et bascule l'objet en **dictionary mode** (aussi appelé **slow properties**). L'objet utilise alors un vrai hash table pour ses propriétés.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  DICTIONARY MODE — Ce qui le déclenche                             │
  │                                                                   │
  │  1. delete obj.prop                                               │
  │     Supprimer une propriété bascule l'objet en dictionary mode.   │
  │     C'est le déclencheur le plus courant.                         │
  │                                                                   │
  │  2. Trop de propriétés dynamiques                                 │
  │     Si un objet reçoit des propriétés avec des noms dynamiques    │
  │     (ex: obj[dynamicKey] = value), V8 peut basculer.             │
  │                                                                   │
  │  3. Trop de propriétés nommées (> ~820-1020 fast properties)      │
  │     Le seuil exact dépend de la version de V8 et de la taille    │
  │     des descriptor arrays. En pratique, c'est rare.               │
  │                                                                   │
  │  4. Trop de transitions depuis une même Map                       │
  │     Si une Map a trop de branches enfants, V8 peut décider        │
  │     de stopper les transitions et basculer.                       │
  │                                                                   │
  │  Peut-on récupérer du dictionary mode ?                           │
  │  ────────────────────────────────────────                         │
  │  NON, en général. Une fois en dictionary mode, l'objet y reste.   │
  │  La seule façon de "récupérer" est de créer un NOUVEL objet       │
  │  avec les mêmes propriétés. V8 ne re-migre pas automatiquement   │
  │  un objet du dictionary mode vers le fast mode.                   │
  │                                                                   │
  │  Performance :                                                    │
  │  Fast mode   │=================================│  ~1-2 ns/accès   │
  │  Dictionary  │=========│                          ~10-20 ns/accès │
  │                                                                   │
  │  Le dictionary mode désactive aussi l'Inline Caching             │
  │  pour cet objet spécifique.                                       │
  └───────────────────────────────────────────────────────────────────┘
```

---

### 12. Inline Caching (IC) : l'explication définitive

L'Inline Caching est le mécanisme qui rend l'accès aux propriétés rapide en mémorisant la Map observée et l'offset correspondant au site d'appel.

#### Le problème que résout l'IC

Sans IC, chaque accès `obj.x` nécessite :
1. Lire la Map de l'objet
2. Chercher "x" dans les descriptors de la Map
3. Calculer l'offset de la propriété
4. Lire la valeur à cet offset

Les étapes 2 et 3 sont coûteuses. L'IC les court-circuite en se souvenant du résultat.

#### Les 4 états de l'Inline Cache

```
  UNINITIALIZED (jamais exécuté)
       │
       │ Premier appel : observe Map M1
       ▼
  MONOMORPHIC (1 seule Map)  ───────────────────── OPTIMAL
       │
       │ Appel avec Map M2 (différente de M1)
       ▼
  POLYMORPHIC (2-4 Maps)  ─────────────────────── ACCEPTABLE
       │
       │ 5e Map différente observée
       ▼
  MEGAMORPHIC (5+ Maps)  ──────────────────────── LENT

  Notes sur les seuils :
  - Le seuil polymorphique → mégamorphique est de ~4-5 Maps
    (ce chiffre est un paramètre interne de V8 et a varié
    entre les versions : 4 dans certaines, 5 dans d'autres)
  - La transition est irréversible dans la même invocation
  - Un IC mégamorphique n'empêche pas TurboFan de compiler,
    mais le code généré sera générique (pas de spécialisation)
```

#### Comment chaque état fonctionne

> **Comment lire les blocs assembleur** — Les blocs ci-dessous montrent le code machine généré par TurboFan pour chaque état d'IC. Tu n'as **pas besoin de lire l'assembleur**. Concentre-toi sur le **nombre d'instructions** :
> - **Monomorphique** : 2-3 instructions → accès quasi-instantané
> - **Polymorphique** : une chaîne de comparaisons → plus lent
> - **Mégamorphique** : un appel de fonction générique → beaucoup plus lent
>
> Plus il y a d'instructions, plus c'est lent. C'est la seule chose à retenir.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  ÉTAT : MONOMORPHIC (1 Map)                                       │
  │                                                                   │
  │  function getX(obj) { return obj.x; }                             │
  │                                                                   │
  │  L'IC a vu : Map M2, propriété "x" à offset 0                    │
  │                                                                   │
  │  Code généré par TurboFan :                                       │
  │  ┌──────────────────────────────────────────────────────┐         │
  │  │ cmp [obj + 0], M2      ; la Map de obj == M2 ?       │         │
  │  │ jne deopt               ; non → déoptimiser           │         │
  │  │ mov rax, [obj + 16]    ; oui → lire offset 0 direct  │         │
  │  │ ret                                                    │         │
  │  └──────────────────────────────────────────────────────┘         │
  │                                                                   │
  │  → 2-3 instructions machine. Le plus rapide possible.             │
  └───────────────────────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────────────────┐
  │  ÉTAT : POLYMORPHIC (2-4 Maps)                                    │
  │                                                                   │
  │  L'IC a vu : M2 (offset 0), M5 (offset 0), M7 (offset 8)        │
  │                                                                   │
  │  Code généré :                                                    │
  │  ┌──────────────────────────────────────────────────────┐         │
  │  │ cmp [obj + 0], M2      ; Map == M2 ?                  │         │
  │  │ je  .load_offset_0      ; oui → offset 0              │         │
  │  │ cmp [obj + 0], M5      ; Map == M5 ?                  │         │
  │  │ je  .load_offset_0      ; oui → offset 0              │         │
  │  │ cmp [obj + 0], M7      ; Map == M7 ?                  │         │
  │  │ je  .load_offset_8      ; oui → offset 8              │         │
  │  │ jmp .slow_path          ; aucune → lookup générique    │         │
  │  └──────────────────────────────────────────────────────┘         │
  │                                                                   │
  │  → Chaîne de comparaisons. Encore rapide, mais le nombre          │
  │  de comparaisons croît avec le nombre de Maps.                    │
  └───────────────────────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────────────────┐
  │  ÉTAT : MEGAMORPHIC (5+ Maps)                                     │
  │                                                                   │
  │  Trop de Maps différentes → V8 abandonne la spécialisation.       │
  │                                                                   │
  │  Code généré :                                                    │
  │  ┌──────────────────────────────────────────────────────┐         │
  │  │ ; Lookup dans le megamorphic stub cache               │         │
  │  │ mov rdi, [obj + 0]     ; charger la Map               │         │
  │  │ call MegamorphicLookup  ; lookup générique            │         │
  │  │ ; résultat dans rax                                    │         │
  │  └──────────────────────────────────────────────────────┘         │
  │                                                                   │
  │  → Appel de fonction pour chaque accès. Nettement plus lent       │
  │  que monomorphique (~5-10x) mais utilise un cache global          │
  │  (megamorphic stub cache) qui est meilleur qu'un hash table.      │
  └───────────────────────────────────────────────────────────────────┘

  Performance relative (accès propriété, approximatif) :

  Monomorphic  |█████████████████████████████████| 1x     (~1-2 ns)
  Polymorphic  |█████████████████████|             ~2-3x  (~3-5 ns)
  Megamorphic  |████████████|                      ~5-10x (~8-15 ns)
  Dictionary   |██████|                            ~10-20x (~15-30 ns)
```

---

### 13. Elements Kinds : le système de types des tableaux

V8 classifie les tableaux selon le type de leurs éléments. Les transitions sont **irréversibles** (lattice à sens unique) :

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  ELEMENTS KINDS — LATTICE IRRÉVERSIBLE                             │
  │                                                                   │
  │  PACKED_SMI_ELEMENTS                                               │
  │    │         │                                                    │
  │    │(double) │(trou)                                              │
  │    ▼         ▼                                                    │
  │  PACKED_DOUBLE_ELEMENTS    HOLEY_SMI_ELEMENTS                     │
  │    │         │               │         │                          │
  │    │(objet)  │(trou)         │(double) │(trou)                    │
  │    ▼         ▼               ▼         ▼                          │
  │  PACKED_ELEMENTS      HOLEY_DOUBLE_ELEMENTS                       │
  │    │                    │                                         │
  │    │(trou)              │(objet)                                  │
  │    ▼                    ▼                                         │
  │  HOLEY_ELEMENTS  ◄──── HOLEY_ELEMENTS                            │
  │                                                                   │
  │  Direction : on ne remonte JAMAIS dans le lattice.                │
  │  Un tableau HOLEY ne redevient jamais PACKED.                     │
  │  Un tableau DOUBLE ne redevient jamais SMI.                       │
  └───────────────────────────────────────────────────────────────────┘
```

**PACKED_SMI_ELEMENTS** est le plus rapide : V8 n'a pas besoin de vérifier les trous ni de faire de conversion de type, et les Smi sont stockés directement (pas de boxing).

```js
// PACKED_SMI_ELEMENTS — optimal
const a = [1, 2, 3, 4, 5];

// PACKED_DOUBLE_ELEMENTS — un peu moins rapide (double boxing)
const b = [1.1, 2.2, 3.3];

// PACKED_ELEMENTS — pas de spécialisation de type
const d = [1, "two", { three: 3 }];

// HOLEY_SMI_ELEMENTS — pénalisé par les vérifications de trous
const c = new Array(10);  // 10 trous !
c[0] = 1;

// HOLEY_ELEMENTS — le pire cas (trous + types mélangés)
const e = [1, , "hello", , { x: 1 }];
```

```
  Pourquoi HOLEY est plus lent que PACKED :

  PACKED : arr[i] → lire directement la valeur à l'index i
  HOLEY  : arr[i] → vérifier si l'index existe (pas un trou)
                   → si trou : remonter la prototype chain
                   → si pas trou : lire la valeur

  Le check de trou ajoute une branche à CHAQUE accès indexé.
```

**Règles pour les tableaux** :
- Préférer `[]` ou `[1, 2, 3]` plutôt que `new Array(n)` (qui crée un tableau HOLEY)
- Éviter les trous : ne pas faire `arr[1000] = x` sur un petit tableau
- Ne pas mélanger les types dans un même tableau si possible
- `Array.from({length: n}, () => 0)` est préférable à `new Array(n)` (PACKED_SMI vs HOLEY)
- `push()` est préférable à l'assignation directe par index quand possible

---

### 14. Object.freeze() et Object.seal() : effets sur les Maps

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  Object.freeze() et Object.seal()                                 │
  │                                                                   │
  │  Object.seal(obj) :                                               │
  │  - Les propriétés existantes deviennent non-configurables          │
  │  - Mais restent modifiables (writable)                             │
  │  - On ne peut plus ajouter de nouvelles propriétés                │
  │  - Crée une NOUVELLE Map avec les attributs modifiés              │
  │  - Les ICs fonctionnent normalement (c'est toujours fast mode)    │
  │                                                                   │
  │  Object.freeze(obj) :                                             │
  │  - Les propriétés deviennent non-writable ET non-configurables    │
  │  - On ne peut plus ajouter de nouvelles propriétés                │
  │  - Crée une NOUVELLE Map                                          │
  │  - Les ICs fonctionnent normalement                               │
  │  - BONUS : V8 sait que les valeurs ne changeront plus             │
  │    → TurboFan peut inliner les valeurs des propriétés comme       │
  │    des constantes (constant folding amélioré)                     │
  │                                                                   │
  │  Attention : freeze/seal crée une Map différente pour CHAQUE      │
  │  objet, même si les objets avaient la même Map avant.             │
  │                                                                   │
  │  const a = { x: 1, y: 2 };                                       │
  │  const b = { x: 3, y: 4 };                                       │
  │  // a et b partagent la même Map                                  │
  │                                                                   │
  │  Object.freeze(a);                                                │
  │  // a a maintenant une Map différente de b                        │
  │  // Mais si on freeze b aussi, V8 réutilise la Map frozen         │
  │  Object.freeze(b);                                                │
  │  // a et b partagent à nouveau la même Map (frozen)               │
  └───────────────────────────────────────────────────────────────────┘
```

---

### 15. Comparaison : classes vs object literals vs Object.create

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  STABILITÉ DES MAPS SELON LE PATTERN DE CRÉATION                   │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐  │
  │  │ CLASSES (recommandé pour les hot paths)                      │  │
  │  │                                                              │  │
  │  │ class Point {                                                │  │
  │  │   constructor(x, y) { this.x = x; this.y = y; }            │  │
  │  │ }                                                            │  │
  │  │                                                              │  │
  │  │ + Toutes les instances partagent la même Map                 │  │
  │  │ + V8 optimise le slack tracking pour les classes              │  │
  │  │ + L'ordre des propriétés est garanti par le constructeur     │  │
  │  │ + Le prototype est partagé et stable                         │  │
  │  │ + Score : ★★★★★ pour la stabilité des Maps                  │  │
  │  └─────────────────────────────────────────────────────────────┘  │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐  │
  │  │ OBJECT LITERALS (bon si utilisé de manière cohérente)        │  │
  │  │                                                              │  │
  │  │ function makePoint(x, y) { return { x, y }; }              │  │
  │  │                                                              │  │
  │  │ + Toutes les instances partagent la même Map                 │  │
  │  │   (V8 utilise le bytecode CreateObjectLiteral qui            │  │
  │  │   prépare la Map dès la première exécution)                  │  │
  │  │ + Simple et lisible                                          │  │
  │  │ - Si on ajoute des propriétés conditionnellement après :     │  │
  │  │   Maps divergentes                                           │  │
  │  │ + Score : ★★★★ pour la stabilité des Maps                   │  │
  │  └─────────────────────────────────────────────────────────────┘  │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐  │
  │  │ Object.create(proto) (cas spéciaux uniquement)               │  │
  │  │                                                              │  │
  │  │ const p = Object.create(pointProto);                        │  │
  │  │ p.x = x; p.y = y;                                          │  │
  │  │                                                              │  │
  │  │ + Permet de personnaliser le prototype                       │  │
  │  │ - Les propriétés sont ajoutées une par une (transition       │  │
  │  │   chain plus longue qu'un literal)                           │  │
  │  │ - Object.create(null) crée un objet sans prototype           │  │
  │  │   → Map spéciale, mais ICs fonctionnent normalement          │  │
  │  │ + Score : ★★★ pour la stabilité des Maps                    │  │
  │  └─────────────────────────────────────────────────────────────┘  │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐  │
  │  │ Ajout dynamique de propriétés (éviter en hot path)           │  │
  │  │                                                              │  │
  │  │ const obj = {};                                              │  │
  │  │ for (const [k, v] of entries) { obj[k] = v; }              │  │
  │  │                                                              │  │
  │  │ - Chaque combinaison de clés crée une Map unique             │  │
  │  │ - Si les clés varient → ICs mégamorphiques                   │  │
  │  │ - Préférer new Map(entries) pour les dictionnaires           │  │
  │  │ + Score : ★ pour la stabilité des Maps                      │  │
  │  └─────────────────────────────────────────────────────────────┘  │
  └───────────────────────────────────────────────────────────────────┘
```

---

### 16. Intrinsics V8 pour le diagnostic

V8 expose des fonctions internes accessibles avec `--allow-natives-syntax`. Voici les plus utiles pour diagnostiquer les Maps et les ICs.

#### %HaveSameMap(a, b)

Retourne `true` si deux objets partagent exactement la même Map.

```js
// node --allow-natives-syntax
const a = { x: 1, y: 2 };
const b = { x: 10, y: 20 };
console.log(%HaveSameMap(a, b)); // true

const c = { y: 1, x: 2 };      // ordre différent !
console.log(%HaveSameMap(a, c)); // false

const d = { x: 1, y: 2 };
d.z = 3;                        // propriété ajoutée après
console.log(%HaveSameMap(a, d)); // false
```

#### %DebugPrint(obj)

Affiche les informations internes détaillées d'un objet : sa Map, ses propriétés, le elements kind (pour les tableaux), le type de chaque champ, etc.

```js
// node --allow-natives-syntax
const arr = [1, 2, 3];
%DebugPrint(arr);
// Sortie (extraits) :
// - map: 0x... [FastProperties]
// - elements: PACKED_SMI_ELEMENTS
// - length: 3
// - elements[0]: 1 (Smi)
// - elements[1]: 2 (Smi)
// - elements[2]: 3 (Smi)

arr.push(1.5);
%DebugPrint(arr);
// - elements: PACKED_DOUBLE_ELEMENTS  ← transition !
```

#### %GetOptimizationStatus(fn)

Retourne un bitmask indiquant l'état d'optimisation d'une fonction.

```js
// node --allow-natives-syntax
function add(a, b) { return a + b; }

// Chauffer
for (let i = 0; i < 100_000; i++) add(i, i);

const status = %GetOptimizationStatus(add);
// Les bits pertinents :
// bit 0 (1)  : la fonction est une fonction
// bit 1 (2)  : jamais optimisée
// bit 2 (4)  : toujours optimisée (pas de feedback nécessaire)
// bit 3 (8)  : peut-être déoptimisée
// bit 4 (16) : optimisée par TurboFan
// bit 5 (32) : optimisée par Maglev
// bit 6 (64) : interprétée par Ignition
// bit 7 (128): compilée par Sparkplug (baseline)

// Helpers utiles :
function isOptimized(fn) {
  const s = %GetOptimizationStatus(fn);
  return (s & 16) !== 0; // TurboFan
}

function isMaglev(fn) {
  const s = %GetOptimizationStatus(fn);
  return (s & 32) !== 0; // Maglev
}
```

#### Forcer l'optimisation pour les tests

```js
// node --allow-natives-syntax
function myFunc(x) { return x * 2; }

// Appeler une fois pour générer le feedback
myFunc(42);

// Dire à V8 de préparer la fonction pour l'optimisation
%PrepareFunctionForOptimization(myFunc);

// Appeler encore pour fournir du feedback
myFunc(42);

// Forcer l'optimisation par TurboFan
%OptimizeFunctionOnNextCall(myFunc);

// Cet appel sera exécuté en code optimisé
myFunc(42);

// Vérifier
console.log('Optimisée ?', (%GetOptimizationStatus(myFunc) & 16) !== 0);
```

---

### 17. Les règles d'or pour le code de production

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  RÈGLES D'OR — HIDDEN CLASSES & INLINE CACHING                    │
  │                                                                   │
  │  1. INITIALISER TOUTES LES PROPRIÉTÉS DANS LE CONSTRUCTEUR        │
  │     class User {                                                  │
  │       constructor(name, age) {                                    │
  │         this.name = name;                                         │
  │         this.age = age;                                           │
  │         this.email = null;   // même si pas encore connu          │
  │         this.score = 0;      // valeur par défaut                 │
  │       }                                                           │
  │     }                                                             │
  │                                                                   │
  │  2. TOUJOURS LE MÊME ORDRE DE PROPRIÉTÉS                          │
  │     // BIEN : factory cohérente                                   │
  │     function createPoint(x, y) { return { x, y }; }              │
  │                                                                   │
  │     // MAL : ordre conditionnel                                   │
  │     function createBadPoint(x, y) {                               │
  │       const p = {};                                               │
  │       if (cond) { p.x = x; p.y = y; }                            │
  │       else { p.y = y; p.x = x; }                                 │
  │       return p;                                                   │
  │     }                                                             │
  │                                                                   │
  │  3. NE PAS AJOUTER DE PROPRIÉTÉS CONDITIONNELLEMENT               │
  │     // MAL                                                        │
  │     const result = { id: 1, value: 42 };                          │
  │     if (hasBonus) result.bonus = 10;  // → 2 Maps possibles      │
  │                                                                   │
  │     // BIEN                                                       │
  │     const result = { id: 1, value: 42, bonus: hasBonus ? 10 : 0 };│
  │                                                                   │
  │  4. NE JAMAIS UTILISER delete                                     │
  │     // MAL                                                        │
  │     delete user.tempData;  // → dictionary mode                   │
  │     // BIEN                                                       │
  │     user.tempData = undefined;                                    │
  │     // ENCORE MIEUX : ne pas ajouter tempData au départ           │
  │                                                                   │
  │  5. NE PAS CHANGER LE TYPE D'UNE PROPRIÉTÉ                        │
  │     // MAL                                                        │
  │     const p = { x: 1, y: 2 };  // x est Smi                     │
  │     p.x = 1.5;                  // x → Double : Map dépréciée    │
  │     p.x = "hello";              // x → HeapObject : re-dépréciation│
  │                                                                   │
  │     // BIEN : être consistant dès le départ                       │
  │     const p = { x: 1.0, y: 2.0 };  // toujours Double           │
  │                                                                   │
  │  6. PRÉFÉRER LES CLASSES POUR LES OBJETS STRUCTURELS              │
  │     Les classes garantissent un constructeur unique avec un        │
  │     ordre de propriétés fixe et un prototype stable.              │
  │                                                                   │
  │  7. POUR LES DICTIONNAIRES, UTILISER Map() PAS LES OBJETS         │
  │     // Pour les clés dynamiques, Map est fait pour ça :           │
  │     const config = new Map(entries);                              │
  │     // Pas : const config = {}; config[key] = value;              │
  │                                                                   │
  │  8. TABLEAUX : GARDER LES TYPES HOMOGÈNES ET SANS TROUS           │
  │     const nums = [1, 2, 3, 4];          // PACKED_SMI — optimal  │
  │     // Éviter : new Array(1000), arr[999] = x, [1,,3]            │
  └───────────────────────────────────────────────────────────────────┘
```

---

## Démonstration

### Demo 1 : Monomorphique vs Polymorphique vs Mégamorphique

```js
// demo-ic-states.mjs
// node --allow-natives-syntax demo-ic-states.mjs

// --- Utilitaire de mesure ---
function bench(label, fn, iterations = 1_000_000) {
  for (let i = 0; i < 1000; i++) fn(); // warmup
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  console.log(`${label}: ${elapsed.toFixed(2)} ms (${iterations} it.)`);
}

// --- Accès monomorphique ---
function getX_mono(obj) { return obj.x; }

const mono1 = { x: 1, y: 2 };
const mono2 = { x: 10, y: 20 };
console.log("Même Map?", %HaveSameMap(mono1, mono2)); // true

bench("Monomorphique", () => {
  getX_mono(mono1);
  getX_mono(mono2);
});

// --- Accès polymorphique (4 shapes) ---
function getX_poly(obj) { return obj.x; }

const poly1 = { x: 1 };
const poly2 = { x: 1, y: 2 };
const poly3 = { x: 1, y: 2, z: 3 };
const poly4 = { x: 1, y: 2, z: 3, w: 4 };

bench("Polymorphique (4 shapes)", () => {
  getX_poly(poly1);
  getX_poly(poly2);
  getX_poly(poly3);
  getX_poly(poly4);
});

// --- Accès mégamorphique (8+ shapes) ---
function getX_mega(obj) { return obj.x; }

const shapes = [];
for (let i = 0; i < 8; i++) {
  const obj = { x: i };
  for (let j = 0; j < i; j++) {
    obj["prop" + j] = j;
  }
  shapes.push(obj);
}

bench("Megamorphique (8 shapes)", () => {
  for (const s of shapes) getX_mega(s);
});
```

### Demo 2 : Observer les transitions IC avec --trace-ic

```bash
# Générer le fichier de trace
node --trace-ic demo-ic-states.mjs 2> ic-trace.log

# Analyser (chercher les lignes contenant le nom de la fonction)
grep "getX_mega" ic-trace.log | head -20
```

Sortie typique :
```
[...] LoadIC [...] getX_mega [...] . -> 1 (monomorphic)
[...] LoadIC [...] getX_mega [...] 1 -> P (polymorphic)
[...] LoadIC [...] getX_mega [...] P -> N (megamorphic)
```

### Demo 3 : Transitions d'Elements Kinds

```js
// demo-array-kinds.mjs
// node --allow-natives-syntax demo-array-kinds.mjs

console.log("=== PACKED_SMI_ELEMENTS ===");
const a = [1, 2, 3];
%DebugPrint(a);

console.log("\n=== Ajout d'un double → PACKED_DOUBLE_ELEMENTS ===");
a.push(1.5);
%DebugPrint(a);

console.log("\n=== Ajout d'un string → PACKED_ELEMENTS ===");
a.push("hello");
%DebugPrint(a);

console.log("\n=== Création d'un trou → HOLEY_ELEMENTS ===");
a[100] = "far";
%DebugPrint(a);

console.log("\n=== new Array(5) → HOLEY dès le départ ===");
const b = new Array(5);
b[0] = 1;
%DebugPrint(b);

console.log("\n=== Array.from → PACKED (recommandé) ===");
const c = Array.from({ length: 5 }, () => 0);
%DebugPrint(c);
```

### Demo 4 : Map deprecation en action

```js
// demo-map-deprecation.mjs
// node --allow-natives-syntax demo-map-deprecation.mjs

class Config {
  constructor() {
    this.width = 100;    // Smi
    this.height = 200;   // Smi
    this.scale = 1;      // Smi
  }
}

const c1 = new Config();
const c2 = new Config();
console.log("Avant : même Map?", %HaveSameMap(c1, c2)); // true

// Changer le type de scale : Smi → Double
c1.scale = 1.5;
console.log("Après c1.scale = 1.5 : même Map?", %HaveSameMap(c1, c2));
// false — c1 a une nouvelle Map (scale = Double)
// c2 est sur la Map dépréciée (sera migré à la prochaine utilisation)

// Forcer la migration de c2
const _ = c2.scale;  // cet accès déclenche la migration
console.log("Après accès à c2.scale : même Map?", %HaveSameMap(c1, c2));
// true — c2 a été migré vers la même Map que c1
```

### Demo 5 : Dictionary mode et ses conséquences

```js
// demo-dictionary-mode.mjs
// node --allow-natives-syntax demo-dictionary-mode.mjs

function readXY(obj) {
  return obj.x + obj.y;
}

// Créer des objets en fast mode
const fast = { x: 1, y: 2, z: 3 };
const slow = { x: 1, y: 2, z: 3 };

// Vérifier : les deux ont la même Map
console.log("Même Map avant delete?", %HaveSameMap(fast, slow)); // true

// Basculer slow en dictionary mode
delete slow.z;

// Vérifier
console.log("Même Map après delete?", %HaveSameMap(fast, slow)); // false

// Benchmark
function benchAccess(label, obj, iterations = 10_000_000) {
  const start = performance.now();
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += obj.x + obj.y;
  }
  const elapsed = performance.now() - start;
  console.log(`${label}: ${elapsed.toFixed(2)} ms`);
  return sum;
}

benchAccess("Fast mode ", fast);
benchAccess("Dictionary", slow);
// Le dictionary mode sera significativement plus lent
```

### Demo 6 : Slack tracking observable

```js
// demo-slack-tracking.mjs
// node --allow-natives-syntax demo-slack-tracking.mjs

class Animal {
  constructor(name) {
    this.name = name;
    this.sound = "...";
  }
}

// Créer les premières instances (slack tracking actif)
const animals = [];
for (let i = 0; i < 20; i++) {
  animals.push(new Animal(`animal-${i}`));
}

// Afficher l'instance #0 (créée avec slack) et #19 (créée après stabilisation)
console.log("=== Instance #0 (peut avoir des slots slack) ===");
%DebugPrint(animals[0]);

console.log("\n=== Instance #19 (après stabilisation du slack) ===");
%DebugPrint(animals[19]);

// Observer la différence de taille dans le DebugPrint :
// Les premières instances peuvent avoir des slots supplémentaires
// alloués (slack) que les suivantes n'ont pas.
```

---

### V8 vs SpiderMonkey (Firefox)

Le concept de « Hidden Class » est **présent dans tous les moteurs JS modernes** — seul le nom change. C'est LE concept fondamental qui permet à JavaScript (langage dynamique) d'atteindre des performances proches des langages statiques.

**Terminologie comparée :**

| Concept | V8 | SpiderMonkey (Firefox) | JavaScriptCore (Safari) |
|---|---|---|---|
| Hidden Class | **Map** | **Shape** | **Structure** |
| Arbre de transitions | Map transition tree | Shape tree | Structure transition table |
| Accès par offset | In-object properties + backing store | Slots + backing store | Direct properties + butterfly |
| Inline Cache polymorphique | Polymorphic IC stubs | **ShapeTable** (table de shapes pour accès polymorphique) | Polymorphic IC |
| Mode dictionnaire | Dictionary mode (slow properties) | Dictionary mode | Non-cacheable dictionary |

```
  Même objet { x: 1, y: 2 } vu par chaque moteur :

  V8 :           Map (pointe vers descriptor array avec offsets de x et y)
  SpiderMonkey : Shape (chaîne de shapes décrivant x puis y)
  JSC :          Structure (table de transitions avec offsets)
```

**Les règles d'or sont universelles :**

Quel que soit le moteur (V8, SpiderMonkey, JSC), les mêmes bonnes pratiques s'appliquent :

1. **Initialiser toutes les propriétés dans le même ordre** → un seul Map/Shape/Structure pour tous les objets similaires.
2. **Ne pas utiliser `delete`** → éviter le passage en mode dictionnaire (lent dans tous les moteurs).
3. **Ne pas ajouter de propriétés après la construction** → chaque ajout crée une nouvelle transition dans l'arbre.
4. **Garder des shapes monomorphiques** dans les chemins chauds → les inline caches sont rapides partout quand il n'y a qu'une seule shape.

> **À retenir** : V8 appelle ça « Maps », SpiderMonkey appelle ça « Shapes », JSC appelle ça « Structures ». C'est **exactement le même concept** avec des noms différents. Les règles d'optimisation sont identiques dans les trois moteurs.

---

## Points clés

1. **Hidden Class (Map)** : structure interne qui décrit la forme d'un objet et permet à V8 d'accéder aux propriétés par offset plutôt que par lookup dans un hash table.

2. **In-object properties** : les premières propriétés sont stockées directement dans l'objet (un seul déréférencement). Les suivantes vont dans un backing store FixedArray (deux déréférencements).

3. **Chaîne/arbre de transitions** : les Maps sont partagées via un arbre de transitions. Deux objets construits de la même façon partagent les mêmes Maps et donc les mêmes optimisations.

4. **Slack tracking** : V8 pré-alloue des slots in-object supplémentaires pour les premiers objets d'un constructeur, puis réduit la taille après ~8 instances.

5. **Map deprecation** : quand le type d'une propriété change (Smi → Double → HeapObject), la Map est dépréciée et les objets sont migrés paresseusement vers une nouvelle Map.

6. **Property type tracking** : V8 traque le type de chaque propriété (Smi/Double/HeapObject) dans les descriptors. La transition de type est irréversible.

7. **Dictionary mode** : déclenché par `delete`, trop de propriétés dynamiques, ou trop de transitions. L'objet utilise un hash table — c'est la situation la plus pénalisante. La récupération est impossible.

8. **Inline Caching** — les 4 états : UNINITIALIZED → MONOMORPHIC (1 Map, optimal) → POLYMORPHIC (2-4 Maps, acceptable) → MEGAMORPHIC (5+ Maps, lent). Les seuils sont des paramètres internes V8.

9. **Elements Kinds** : les tableaux ont un lattice irréversible de PACKED_SMI → PACKED_DOUBLE → PACKED_ELEMENTS → HOLEY. Garder les tableaux PACKED et homogènes.

10. **`%HaveSameMap()`**, **`%DebugPrint()`**, **`%GetOptimizationStatus()`** sont les intrinsics V8 essentiels pour le diagnostic.

11. **Règles d'or** : initialiser toutes les propriétés dans le constructeur, même ordre, pas de `delete`, pas de changement de type, préférer les classes pour les objets structurels, utiliser `Map()` pour les dictionnaires.

---

## Lab associé

**Lab 11 — Diagnostiquer et corriger les déoptimisations de shape**

Fichier : `labs/lab-11-hidden-classes/`

1. On vous fournit un module `user-service.js` qui crée des objets utilisateur de 5 manières différentes (literal, constructeur, classe, factory, Object.create).
2. Lancez avec `--allow-natives-syntax` et vérifiez avec `%HaveSameMap` quels objets partagent la même Map.
3. Identifiez les 3 endroits où le code crée des Maps inutilement différentes.
4. Refactorez pour que tous les objets utilisateur partagent la même Map.
5. Utilisez `%DebugPrint` pour vérifier les elements kinds des tableaux dans le module.
6. Benchmarkez avant/après avec le script fourni.
7. **Bonus** : utilisez `--trace-ic` pour identifier les sites IC mégamorphiques et les corriger.

Critères de validation :
- `%HaveSameMap` retourne `true` pour tous les objets après correction
- Le benchmark montre une amélioration >= 30%
- Aucun site mégamorphique dans la trace IC

---

## Pour aller plus loin

- [V8 Blog — Fast properties in V8 (Maps)](https://v8.dev/blog/fast-properties)
- [V8 Blog — Elements kinds in V8](https://v8.dev/blog/elements-kinds)
- [V8 Blog — What's up with monomorphism?](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html)
- [Mathias Bynens — V8 Internals for JavaScript Developers (vidéo)](https://www.youtube.com/watch?v=m9cTaYI95Zc)
- [Benedikt Meurer — Speculative Optimization in V8](https://benediktmeurer.de/2017/12/13/an-introduction-to-speculative-optimization-in-v8/)
- [V8 Source — map.h](https://chromium.googlesource.com/v8/v8/+/main/src/objects/map.h)
- [V8 Source — map-inl.h](https://chromium.googlesource.com/v8/v8/+/main/src/objects/map-inl.h)
- [V8 Source — feedback-vector.h](https://chromium.googlesource.com/v8/v8/+/main/src/objects/feedback-vector.h)
- [V8 Blog — Slack tracking](https://v8.dev/blog/slack-tracking)

---

## Défi

**Défi : Le cache-breaker**

On vous donne la fonction suivante :

```js
function processItems(items) {
  let total = 0;
  for (const item of items) {
    total += item.value * item.weight;
    if (item.bonus) total += item.bonus;
  }
  return total;
}
```

Elle est appelée avec un tableau de 100 000 objets générés ainsi :

```js
const items = [];
for (let i = 0; i < 100_000; i++) {
  const item = { value: i, weight: Math.random() };
  if (i % 7 === 0) item.bonus = 10;
  if (i % 13 === 0) item.category = "special";
  if (i % 23 === 0) delete item.weight;
  items.push(item);
}
```

**Votre mission** :
1. Analysez combien de Maps différentes existent dans le tableau. Utilisez `%HaveSameMap` et `%DebugPrint` pour vérifier.
2. Identifiez chaque source de divergence de Maps :
   - L'ajout conditionnel de `bonus`
   - L'ajout conditionnel de `category`
   - Le `delete item.weight` (le plus destructeur — pourquoi ?)
3. Réécrivez la génération du tableau pour que TOUS les objets partagent la même Map.
4. Mesurez l'amélioration de performance sur `processItems`.
5. Expliquez pourquoi le `delete item.weight` est particulièrement destructeur (indication : dictionary mode, voir section 11 de ce module).

**Indice pour la correction** :

```js
const items = [];
for (let i = 0; i < 100_000; i++) {
  items.push({
    value: i,
    weight: i % 23 === 0 ? 0 : Math.random(), // pas de delete !
    bonus: i % 7 === 0 ? 10 : 0,              // toujours présent
    category: i % 13 === 0 ? "special" : null, // toujours présent
  });
}
```

Objectif : amélioration d'au moins 50% du temps d'exécution.
