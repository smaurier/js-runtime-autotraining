# Screencast 11 — Hidden Classes & Inline Caching

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/11-hidden-classes-inline-caching.md`
- **Lab associé** : `labs/lab-11-hidden-classes/`
- **Prérequis** : Module 09 (Architecture V8), Module 10 (JIT, Feedback Vector), notion de Feedback Vector et type feedback

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Fichiers du lab-11 prêts (`exercise.js`, `walkthrough.js`)
- [ ] Node.js v20+ avec le flag `--allow-natives-syntax` disponible
- [ ] Visualisation `visualizations/hidden-classes.html` prête dans Chrome
- [ ] Éditeur ouvert sur les fichiers du lab

## Script

### [00:00-01:30] Introduction — Comment V8 rend l'accès aux propriétés rapide

> « Bienvenue dans le module 11. JavaScript est un langage dynamique : on peut ajouter, supprimer et modifier les propriétés d'un objet à tout moment. Pourtant, V8 accède aux propriétés presque aussi vite que C++. Comment ? Grâce aux Hidden Classes et à l'Inline Caching. »

- En C++ ou Java, le compilateur connaît l'offset mémoire de chaque propriété à la compilation
- En JS, les objets sont dynamiques → V8 ne peut pas connaître les offsets à l'avance
- Solution : V8 crée des **Hidden Classes** (appelées **Maps** dans le code source V8) qui décrivent la forme des objets
- L'**Inline Cache** mémorise la Hidden Class vue lors de l'accès précédent pour aller plus vite

**Transition** : « Voyons en détail comment fonctionnent ces Maps et leurs transitions. »

### [01:30-04:30] Concept clé — Maps, Transition Trees et IC States

#### Hidden Classes (Maps)
- Chaque objet JS à un pointeur caché vers sa **Map** (Hidden Class)
- La Map décrit : quelles propriétés existent, dans quel ordre, à quel offset
- Deux objets avec les mêmes propriétés dans le même ordre partagent la même Map

#### Transition Trees
- Quand on ajoute une propriété, V8 crée une **transition** vers une nouvelle Map
- L'ensemble des transitions forme un arbre :
  ```
  Map0 {} ──(+x)──> Map1 {x} ──(+y)──> Map2 {x, y}
                                  └──(+z)──> Map3 {x, z}
  ```
- Si deux objets suivent le même chemin de construction, ils partagent les mêmes Maps
- Si l'ordre diffère (`{x, y}` vs `{y, x}`), les Maps divergent → perte de performance

#### Inline Cache (IC) — Les 4 états
1. **Uninitialized** : jamais exécuté
2. **Monomorphic** : une seule Map vue → accès direct par offset (ultra-rapide)
3. **Polymorphic** : 2-4 Maps vues → lookup dans une petite table (rapide)
4. **Megamorphic** : 5+ Maps vues → lookup dans un dictionnaire global (lent)

- En production, on veut rester **monomorphic** le plus possible
- Chaque site d'accès (`obj.x`) a son propre IC indépendant

**Transition** : « Passons au lab pour observer ça avec les outils V8. »

### [04:30-08:30] Démonstration pratique — Lab 11

#### Étape 1 : Observer les Maps avec `%DebugPrint()`
```bash
node --allow-natives-syntax labs/lab-11-hidden-classes/exercise.js
```
- Montrer la sortie de `%DebugPrint(obj)` :
  - Le champ `map` avec l'adresse mémoire de la Hidden Class
  - Les propriétés listées avec leurs offsets
  - Le type de stockage (in-object, fast properties, dictionary)
- Créer deux objets avec les mêmes propriétés dans le même ordre → **même adresse Map**
- Créer un objet avec un ordre différent → **adresse Map différente**

#### Étape 2 : Observer l'état de l'IC avec `%GetFeedback()`
- Écrire une fonction qui accède à `obj.x` dans une boucle
- Passer toujours le même type d'objet → montrer IC monomorphic
- Passer des objets de formes différentes → observer la transition polymorphic → megamorphic
- Mesurer la différence de performance avec `performance.now()` :
  - Monomorphic : ~X ms
  - Megamorphic : ~Y ms (souvent 5-10x plus lent)

#### Étape 3 : L'impact de `delete`
```javascript
const obj = { x: 1, y: 2, z: 3 };
%DebugPrint(obj); // fast properties
delete obj.y;
%DebugPrint(obj); // dictionary mode !
```
- Montrer que `delete` fait passer l'objet en **dictionary mode** (slow properties)
- Les accès deviennent un lookup de hash table au lieu d'un offset fixe
- Alternative : `obj.y = undefined` préserve la Map

**Transition** : « Visualisons ces transitions de manière interactive. »

### [08:30-11:30] Visualisation — Hidden Classes en action

- Ouvrir `visualizations/hidden-classes.html` dans Chrome

#### Scénario 1 : Construction cohérente
- Deux objets créés avec `{ x: 1, y: 2 }` → même Map, IC monomorphic
- Le schéma montre les deux objets pointant vers la même Map

#### Scénario 2 : Construction incohérente
- Objet A : `{ x: 1, y: 2 }` puis objet B : `{ y: 2, x: 1 }`
- Maps différentes → IC polymorphic
- Montrer l'arbre de transitions qui diverge

#### Scénario 3 : Ajout dynamique de propriétés
- Partir de `{}` et ajouter des propriétés une par une
- Montrer la chaîne de transitions : Map0 → Map1 → Map2 → ...
- Comparer avec la création directe via un objet littéral (moins de transitions)

- Commenter chaque scénario en direct, pointer les éléments visuels

**Transition** : « Résumons les règles à retenir. »

### [11:30-14:00] Récap — Les 4 règles d'or

#### Règle 1 : Même forme = fast
- Créer des objets avec les mêmes propriétés dans le même ordre
- Utiliser des constructeurs ou des factory functions cohérentes
- Éviter d'ajouter des propriétés conditionnellement

#### Règle 2 : `delete` = slow
- `delete obj.prop` → dictionary mode → tous les accès deviennent lents
- Préférer `obj.prop = undefined` si possible
- Ou mieux : restructurer le code pour ne pas avoir besoin de supprimer

#### Règle 3 : Constructeurs cohérents
```javascript
// Bien : toujours les mêmes propriétés dans le même ordre
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

// Mal : propriétés conditionnelles
class Point {
  constructor(x, y, z) {
    this.x = x;
    if (y) this.y = y; // Maps différentes selon le cas
    if (z) this.z = z;
  }
}
```

#### Règle 4 : Fonctions monomorphiques
- Passer toujours des objets de la même forme à une fonction
- Si besoin de polymorphisme, regrouper en 2-3 formes maximum
- Au-delà de 4 formes → megamorphic → performance dégradée

#### Quiz rapide
- « Combien de Maps différentes avant qu'un IC devienne megamorphic ? » → 5+
- « Pourquoi `delete` est-il lent ? » → Il fait passer l'objet en dictionary mode

> « Prochain screencast : les Performance Patterns. On va apprendre à mesurer avant d'optimiser. »

## Points d'attention pour l'enregistrement
- L'adresse Map dans `%DebugPrint()` est en hexadécimal — bien la mettre en évidence
- Montrer visuellement la différence entre fast properties et dictionary mode
- La visualisation HTML est un moment fort — prendre le temps d'explorer les 3 scénarios
- Bien insister sur le fait que l'IC est **par site d'accès** (pas par fonction)
- La mesure de performance doit être claire : afficher les nombres à l'écran
