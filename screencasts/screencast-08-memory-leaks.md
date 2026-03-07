# Screencast 08 — Les Fuites Mémoire

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/08-memory-leaks.md`
- **Lab associé** : `labs/lab-08-memory-leak-detection/`
- **Prérequis** : Module 07 (Garbage Collector), Chrome DevTools (onglets Memory/Performance), notions DOM

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Chrome ouvert avec DevTools (onglet Memory)
- [ ] Fichiers du lab-08 prêts (`exercise.js`, `walkthrough.js`)
- [ ] Node.js lancé avec le flag `--max-old-space-size=100`

## Script

### [00:00-01:30] Introduction — Qu'est-ce qu'une fuite mémoire ?

> « Bonjour et bienvenue dans le screencast du module 08 sur les fuites mémoire. »

- Rappeler la métaphore du robinet qui goutte : chaque goutte est minuscule, mais la baignoire finit par déborder
- En JavaScript, le GC libère la mémoire **non atteignable**. Une fuite = de la mémoire qui **reste atteignable** alors qu'elle n'est plus utile
- Ce n'est **pas** un bug du GC, c'est le développeur qui maintient involontairement des références
- Montrer le schéma mental : `Racine GC → Objet utile → Objet inutile encore référencé`

**Transition** : « Voyons les 5 patterns classiques de fuites mémoire que vous allez rencontrer en production. »

### [01:30-04:00] Concept clé — Les 5 patterns classiques

Présenter chaque pattern avec un mini-exemple de code à l'écran :

1. **Timers oubliés** — `setInterval` sans `clearInterval`
   - Montrer un `setInterval` qui accumule des données dans un tableau
   - Le callback garde une closure sur le tableau → la référence persiste
2. **Références DOM détachées** — `removeChild` sans supprimer la variable JS
   - Un élément retiré du DOM mais encore référencé par une variable globale
3. **Closures excessives** — fermetures capturant plus de variables que nécessaire
   - Fonction interne qui capture tout le scope parent même si elle n'utilise qu'une variable
4. **Collections non bornées** — `Map`, `Set`, tableaux qui grandissent sans limite
   - Un cache sans politique d'éviction qui grossit indéfiniment
5. **Event listeners non nettoyés** — `addEventListener` sans `removeEventListener`
   - Composant qui s'abonne à un événement global sans se désabonner à la destruction

**Transition** : « Passons à la pratique. On va provoquer un crash mémoire et l'observer en direct. »

### [04:00-08:00] Démonstration pratique — Lab 08

#### Étape 1 : Provoquer le crash
```bash
node --max-old-space-size=100 labs/lab-08-memory-leak-detection/exercise.js
```
- Observer le message `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`
- Expliquer que `--max-old-space-size=100` limite le tas à 100 Mo pour accélérer le crash

#### Étape 2 : Surveiller avec `process.memoryUsage()`
- Ajouter un `setInterval` qui affiche `process.memoryUsage().heapUsed` toutes les secondes
- Montrer la croissance linéaire de la mémoire → signature typique d'une fuite
- Expliquer les champs : `rss`, `heapTotal`, `heapUsed`, `external`, `arrayBuffers`

#### Étape 3 : Identifier la source
- Ouvrir le code et identifier le pattern fautif (par ex. un cache `Map` non borné)
- Montrer que commenter la ligne qui stocke dans le cache stabilise la mémoire
- Rétablir le code et passer au correctif propre

**Transition** : « Maintenant qu'on sait provoquer et détecter une fuite, voyons la méthode professionnelle avec DevTools. »

### [08:00-11:00] Approfondissement — La méthode des 3 snapshots

#### Principe de la méthode
1. **Snapshot 1** : état initial après chargement
2. **Action** : effectuer l'opération suspecte plusieurs fois (ex. ouvrir/fermer un panneau)
3. **Snapshot 2** : après les opérations
4. **Snapshot 3** : après un GC forcé (bouton poubelle dans DevTools)

#### Démonstration dans Chrome DevTools
- Ouvrir l'onglet **Memory** → sélectionner **Heap snapshot**
- Prendre le Snapshot 1
- Exécuter l'action qui fuit 5 fois
- Prendre le Snapshot 2
- Forcer un GC → Prendre le Snapshot 3
- Comparer Snapshot 3 vs Snapshot 1 avec le filtre **« Objects allocated between Snapshot 1 and Snapshot 2 »**

#### Lire les résultats
- **Shallow Size** : taille propre de l'objet
- **Retained Size** : taille libérée si cet objet était GC'd (inclut les dépendants)
- **Retainers tree** : montre **qui** garde la référence → c'est la piste vers le bug
- Identifier l'objet fautif et remonter les retainers jusqu'à la racine

**Transition** : « Terminons avec les stratégies de correction. »

### [11:00-14:00] Récap + Stratégies de correction

#### Pattern WeakMap pour les caches
```javascript
// Avant (fuite) :
const cache = new Map();
cache.set(domElement, computedData);

// Après (pas de fuite) :
const cache = new WeakMap();
cache.set(domElement, computedData);
// Quand domElement est GC'd, l'entrée disparaît automatiquement
```

#### AbortController pour les listeners
```javascript
const controller = new AbortController();
element.addEventListener('click', handler, { signal: controller.signal });
// Plus tard : nettoie TOUS les listeners d'un coup
controller.abort();
```

#### Checklist de prévention
- Toujours `clearInterval` / `clearTimeout` dans les fonctions de nettoyage
- Utiliser `WeakMap` / `WeakSet` pour les associations objet→données
- Borner les caches (`LRU cache` avec taille maximale)
- Surveiller `process.memoryUsage()` en production (métriques Prometheus/Grafana)

#### Quiz rapide
- « Pourquoi `WeakMap` empêche les fuites ? » → Les clés sont des références faibles
- « Que signifie un `Retained Size` énorme sur un petit objet ? » → Il retient un gros graphe d'objets

> « Dans le prochain module, on plonge dans l'architecture de V8. À bientôt ! »

## Points d'attention pour l'enregistrement
- Bien montrer le crash OOM à l'écran — c'est un moment marquant pour les apprenants
- Zoomer sur les colonnes Shallow Size / Retained Size dans DevTools
- Prendre le temps de naviguer dans le Retainers tree — c'est la compétence clé
- Parler lentement lors de la méthode des 3 snapshots, c'est dense
- S'assurer que la taille de police du terminal est lisible (minimum 16px)
