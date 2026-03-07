# Screencast 12 — Performance Patterns

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/12-performance-patterns.md`
- **Lab associé** : `labs/lab-12-performance-profiling/`
- **Prérequis** : Modules 09-11 (V8, JIT, Hidden Classes), familiarité avec Chrome DevTools, ligne de commande Node.js

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Fichiers du lab-12 prêts (`exercise.js`, `walkthrough.js`)
- [ ] Chrome DevTools prêt (onglet Performance)
- [ ] Node.js v20+ avec les flags `--prof` et `--prof-process` disponibles
- [ ] (Optionnel) Clinic.js installé : `npm install -g clinic`

## Script

### [00:00-01:30] Introduction — « Always measure before optimizing »

> « Bienvenue dans le module 12. La règle numéro 1 de la performance, c'est : mesure d'abord, optimise ensuite. Sans mesure, tu ne fais que deviner. »

- Citation de Donald Knuth : « Premature optimization is the root of all evil »
- Raconter un cas concret : un développeur qui micro-optimise une boucle rapide alors que le vrai problème est un appel réseau bloquant
- L'objectif du module : apprendre une **méthodologie** de profiling, pas une liste de trucs
- Loi d'Amdahl : si une partie du programme prend 5% du temps total, l'optimiser de 100% ne gagne que 5% au global

**Transition** : « Voyons la méthodologie complète de profiling. »

### [01:30-04:00] Concept clé — Méthodologie de profiling

#### Étape 1 : Définir une baseline
- Mesurer les performances **avant** toute modification
- Utiliser un benchmark reproductible (même données, même machine, même conditions)
- Enregistrer : temps total, temps CPU, mémoire consommée

#### Étape 2 : Identifier le bottleneck
- **CPU profiler** : flame chart → où le temps est passé
- **Heap profiler** : allocation timeline → où la mémoire est allouée
- **Traces V8** : `--trace-opt`, `--trace-deopt` → est-ce que le moteur est malheureux ?
- Chercher le **hotspot** : la fonction qui consomme le plus de temps

#### Étape 3 : Formuler une hypothèse
- « Cette fonction est lente parce que l'IC est megamorphic »
- « La mémoire fuit à cause d'un cache non borné »
- « Le temps de parsing est élevé à cause d'un bundle trop gros »

#### Étape 4 : Optimiser et mesurer l'impact
- Appliquer **une seule** modification à la fois
- Re-mesurer avec la même baseline
- Si le gain est significatif → garder. Sinon → revert

#### Étape 5 : Vérifier les régressions
- Tester les cas limites (edge cases)
- S'assurer que l'optimisation ne casse pas la correction

**Transition** : « Mettons cette méthode en pratique avec le lab 12. »

### [04:00-08:30] Démonstration pratique — Profiling avec --prof

#### Étape 1 : Générer le profil V8
```bash
node --prof labs/lab-12-performance-profiling/exercise.js
```
- Un fichier `isolate-0x....-v8.log` est créé
- Ce fichier contient les échantillons CPU bruts (illisible tel quel)

#### Étape 2 : Traiter le fichier de profil
```bash
node --prof-process isolate-*.log > profile.txt
```
- Ouvrir `profile.txt` et expliquer les sections :
  - **Statistical profiling result** : résumé global
  - **[JavaScript]** : temps passé dans le code JS
  - **[C++]** : temps passé dans le runtime V8
  - **[Summary]** : répartition JS vs C++ vs GC
  - **[Bottom up (heavy) profile]** : les fonctions les plus coûteuses

#### Étape 3 : Lire le flame chart dans DevTools
- Alternative : ouvrir le `.log` dans Chrome DevTools (onglet Performance → Load profile)
- Naviguer dans le flame chart :
  - Axe X = temps, axe Y = profondeur de pile
  - Les barres larges = les fonctions lentes
  - Zoomer sur les hotspots
  - Cliquer sur une barre pour voir le code source
- Identifier la fonction la plus coûteuse du lab-12

#### Étape 4 : Appliquer une optimisation
- Montrer le code problématique (ex. concaténation de strings dans une boucle)
- Corriger (utiliser un tableau + `join`)
- Re-profiler et comparer les résultats

**Transition** : « Voyons les anti-patterns les plus courants. »

### [08:30-11:30] Approfondissement — Anti-patterns de performance

#### 1. IC Megamorphique
- Passer des objets de formes différentes à la même fonction
- Symptôme : la fonction n'est jamais optimisée par TurboFan
- Correction : normaliser les formes d'objets en amont

#### 2. Allocation pressure
- Créer beaucoup d'objets temporaires dans une hot loop
- Symptôme : le GC passe beaucoup de temps (voir Summary dans le profil)
- Correction : réutiliser les objets, utiliser des types primitifs, escape analysis-friendly

#### 3. Concaténation de strings
```javascript
// Lent (allocation quadratique) :
let result = '';
for (const s of strings) result += s;

// Rapide (allocation linéaire) :
const result = strings.join('');
```

#### 4. Parsing de gros JSON
- `JSON.parse()` sur un fichier de 10 Mo bloque le main thread
- Solutions : streaming parser, Web Worker, découpage

#### 5. `arguments` dans les fonctions hot
- L'objet `arguments` empêche certaines optimisations
- Utiliser les rest parameters `...args` à la place

#### DevTools Performance tab (navigateur)
- Enregistrer un profil de 5 secondes
- Identifier : Long Tasks (>50ms), Layout Shifts, Painting
- Montrer l'intégration avec le flame chart JS

**Transition** : « Résumons les outils à votre disposition. »

### [11:30-14:00] Récap + Boîte à outils

#### Outils Node.js
| Outil | Usage |
|-------|-------|
| `--prof` + `--prof-process` | Profil CPU détaillé |
| `--trace-opt` / `--trace-deopt` | Suivi JIT |
| `--trace-gc` | Activité du GC |
| `process.memoryUsage()` | Mémoire en temps réel |
| `performance.now()` | Mesure de temps précise |

#### Outils externes
| Outil | Usage |
|-------|-------|
| Chrome DevTools Performance | Flame chart navigateur |
| Chrome DevTools Memory | Heap snapshots |
| Clinic.js Doctor | Diagnostic automatique |
| Clinic.js Flame | Flame chart Node.js |
| Clinic.js Bubbleprof | Analyse async |
| 0x | Flame chart rapide |

#### Checklist avant production
- [ ] Aucun Long Task > 50ms sur le main thread
- [ ] Profil GC < 5% du temps total
- [ ] Pas de fuite mémoire sur 24h
- [ ] Toutes les hot functions optimisées (pas de déopt récurrente)

#### Quiz rapide
- « Que dit la loi d'Amdahl ? » → L'accélération maximale est limitée par la proportion non optimisée
- « Que cherche-t-on en premier dans un flame chart ? » → Les barres les plus larges (fonctions les plus coûteuses)

> « Prochain module : Scheduling et Concurrence — comment garder le main thread réactif. »

## Points d'attention pour l'enregistrement
- La commande `--prof-process` peut échouer si le fichier .log est trop gros — utiliser un lab court
- Bien expliquer le flame chart : c'est l'outil que les apprenants utiliseront le plus en production
- Ne pas aller trop vite sur le profil texte — c'est dense mais très informatif
- Montrer la différence avant/après optimisation avec des chiffres concrets
- Mentionner Clinic.js mais ne pas s'attarder — c'est un outil complémentaire
