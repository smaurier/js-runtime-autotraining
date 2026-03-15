# Screencast 07 — Le Garbage Collector

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/07-garbage-collector.md`
- **Lab associé** : `labs/lab-07-gc-observation/`
- **Prérequis** : Modules 00-06 terminés, notions de gestion mémoire

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Navigateur ouvert sur `visualizations/gc-tricolor.html`
- [ ] Éditeur de code avec `labs/lab-07-gc-observation/exercise.js`
- [ ] Node.js lancé avec les flags `--expose-gc` et `--trace-gc` disponibles

## Script

### [00:00-01:30] Introduction — La mémoire automatique, un luxe à comprendre

> Bienvenue dans le module 07. Quand vous écrivez `const obj = { name: "Alice" }`,
> de la mémoire est allouée pour cet objet. Mais quand est-elle libérée ?
> Vous n'appelez jamais `free()` comme en C. Alors, qui nettoie ?
>
> C'est le **Garbage Collector** (GC) — le ramasse-miettes. Il fonctionne
> automatiquement, en arrière-plan, et la plupart du temps vous n'y pensez pas.
> Mais en production, avec des millions de requêtes, comprendre le GC peut faire
> la différence entre une application qui tient la charge et une qui s'effondre.
>
> Aujourd'hui, on va voir comment V8 gère la mémoire, comment observer le GC,
> et comment éviter les problèmes.

### [01:30-04:00] Concept clé — Le GC générationnel et le tri-color marking

> V8 utilise un GC **générationnel**. L'idée repose sur une observation empirique :
> **la plupart des objets meurent jeunes**.
>
> La mémoire heap est divisée en deux espaces :
>
> - **Young Génération** (Nursery + Intermediate) — petite, collectée fréquemment.
>   Les nouveaux objets arrivent ici. Le GC utilise un algorithme de **Scavenge**
>   (semi-space copying) : les objets survivants sont copiés dans l'autre demi-espace.
>   Rapide, mais coûteux en espace (50% inutilisé).
>
> - **Old Génération** — plus grande, collectée rarement. Les objets qui ont
>   survécu à 2 Scavenges sont "promus" ici. Le GC utilise un algorithme
>   de **Mark-Sweep-Compact**.

**Action** : Afficher un schéma Young Gen / Old Gen avec les flèches de promotion.

> L'algorithme Mark-Sweep-Compact de l'Old Génération utilise le **tri-color marking** :
>
> 1. **Blanc** — L'objet n'a pas encore été visité. À la fin, tout objet blanc est considéré mort.
> 2. **Gris** — L'objet a été visité, mais ses références n'ont pas toutes été explorées.
> 3. **Noir** — L'objet et toutes ses références ont été visités. Il est vivant.
>
> Le GC part des racines (global, stack, handles), les marque en gris, puis explore
> récursivement. Quand un objet gris a toutes ses références traitées, il passe en noir.
> À la fin, tout ce qui est blanc est libéré.

**Action** : Dessiner un petit graphe d'objets avec les 3 couleurs.

> V8 appelle son implémentation **Orinoco**. Orinoco effectue le marquage de façon
> **incrémentale** et **concurrente** — le GC travaille en parallèle avec votre code
> JavaScript pour minimiser les pauses.

### [04:00-08:00] Démonstration pratique — Observer le GC en action

> Passons à la pratique. On va observer le GC directement.

**Action** : Ouvrir `labs/lab-07-gc-observation/exercise.js`.

> Ce lab alloue un grand nombre d'objets, puis les déréférence progressivement.
> On va le lancer avec des flags spéciaux de Node.js.

**Commande** :
```bash
node --expose-gc --trace-gc labs/lab-07-gc-observation/exercise.js
```

> Le flag `--expose-gc` rend la fonction `global.gc()` disponible, ce qui permet
> de déclencher manuellement une collecte. Le flag `--trace-gc` affiche chaque
> événement GC avec des détails.

**Action** : Commenter la sortie du `--trace-gc`.

> Regardez les lignes. Vous voyez des événements comme :
> - `Scavenge` — collecte de la Young Génération (quelques millisecondes).
> - `Mark-Sweep` — collecte de l'Old Génération (plus long, mais incrémental).
>
> La colonne de taille mémoire montre l'avant/après de chaque collecte.
> Observez comment la mémoire diminue après le déréférencement des objets.

**Commande** (pour observer les stats mémoire en continu) :
```bash
node --expose-gc -e "
  const used = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  console.log('Avant allocation:', used(), 'MB');
  let arr = Array.from({ length: 1_000_000 }, () => ({ x: Math.random() }));
  console.log('Après allocation:', used(), 'MB');
  arr = null;
  global.gc();
  console.log('Après GC:', used(), 'MB');
"
```

> On voit clairement : allocation de ~80 MB, puis après `arr = null` et `gc()`,
> la mémoire redescend. La clé ici, c'est `arr = null` — supprimer la référence
> rend les objets éligibles à la collecte.

### [08:00-11:00] Visualisation interactive — gc-tricolor.html

> Ouvrons la visualisation pour voir le tri-color marking en action.

**Action** : Ouvrir `visualizations/gc-tricolor.html` dans le navigateur.

> Cette page montre un graphe d'objets. Les racines sont à gauche.
> À chaque clic sur "Step", un objet gris est traité : ses voisins deviennent
> gris (s'ils étaient blancs), et lui-même passe en noir.

**Action** : Cliquer step par step et commenter.

> Observez :
> - Les racines commencent en **gris**.
> - Les objets atteignables deviennent progressivement **noirs**.
> - Les objets isolés (sans chemin depuis les racines) restent **blancs**.
> - À la fin, tous les objets blancs sont "morts" et seront libérés.
>
> Modifions le graphe : supprimons une arête pour créer un objet isolé,
> puis relançons l'algorithme. L'objet devient blanc → il sera collecté.

**Action** : Modifier le graphe si la visualisation le permet, sinon décrire le scénario.

> Ce qu'il faut retenir : un objet est collecté si et seulement si
> **aucun chemin** ne le relie aux racines. Pas de comptage de références
> (donc pas de problème de cycles), juste de l'atteignabilité.

### [11:00-14:00] Récap — WeakRef, FinalizationRegistry et non-déterminisme

> Récapitulons et parlons de fonctionnalités avancées liées au GC.
>
> 1. Le GC de V8 est **générationnel** : Young Gen (Scavenge) + Old Gen (Mark-Sweep-Compact).
> 2. Le **tri-color marking** détermine les objets vivants par atteignabilité.
> 3. **Orinoco** rend le marquage incrémental et concurrent pour réduire les pauses.
> 4. `--expose-gc` et `--trace-gc` sont vos outils d'observation.
>
> **WeakRef** et **FinalizationRegistry** (ES2021) :

```javascript
let target = { data: "important" };
const weakRef = new WeakRef(target);

// Plus tard :
const obj = weakRef.deref(); // Retourne l'objet ou undefined s'il a été collecté
```

> `WeakRef` permet de référencer un objet **sans empêcher sa collecte**.
> `FinalizationRegistry` permet d'enregistrer un callback qui sera appelé
> quand un objet est collecté.
>
> **Attention** : le GC est **non-déterministe**. Vous ne pouvez pas prédire
> QUAND un objet sera collecté. Ne basez jamais votre logique métier sur
> `FinalizationRegistry` — utilisez-le uniquement pour du nettoyage secondaire
> (fermer des file handles, libérer des ressources natives).

```javascript
const registry = new FinalizationRegistry((heldValue) => {
  console.log(`Objet avec clé "${heldValue}" collecté`);
});

let obj = { data: "test" };
registry.register(obj, "ma-clé");
obj = null; // L'objet devient éligible au GC
// Le callback sera appelé... éventuellement. Ou jamais, si le process termine avant.
```

**Action** : Mentionner le quiz du module 07.

> Faites le quiz et l'exercice du lab. Dans les prochains modules, on abordera
> les prototypes, les optimisations JIT, et la suite du runtime JavaScript.
> Bravo d'être arrivé jusqu'ici — vous avez maintenant une compréhension solide
> des fondations : call stack, scope, event loop, Promises, async/await, et GC.
> À bientôt pour la suite !

## Points d'attention pour l'enregistrement
- Vérifier que `--expose-gc` et `--trace-gc` fonctionnent avant l'enregistrement
- Le schéma Young Gen / Old Gen doit rester affiché pendant l'explication
- La visualisation gc-tricolor.html doit être testée — vérifier qu'elle fonctionne
- Bien insister sur le non-déterminisme du GC — c'est une erreur classique
- L'exemple mémoire avec `process.memoryUsage()` doit montrer des résultats clairs
- Ne pas s'attarder sur WeakRef/FinalizationRegistry — les mentionner mais rester concis
- Préparer le flag `--max-old-space-size=50` si on veut forcer des GC plus fréquents
