# Screencast 09 — Architecture V8

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/09-v8-architecture.md`
- **Lab associé** : `labs/lab-09-v8-optimization/`
- **Prérequis** : Module 01 (Call Stack), Module 07 (GC/espaces mémoire), notions de compilation (AST, bytecode)

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Fichiers du lab-09 prêts (`exercise.js`, `walkthrough.js`)
- [ ] Visualisation `visualizations/jit-pipeline.html` prête dans un navigateur
- [ ] Node.js v20+ (pour les flags V8 récents)

## Script

### [00:00-01:30] Introduction — Du texte au code machine

> « Bienvenue dans le module 09. Aujourd'hui on ouvre le capot de V8, le moteur JavaScript qui fait tourner Chrome et Node.js. »

- Poser la question : « Quand tu écris `const x = 1 + 2`, que se passe-t-il entre ton fichier .js et l'exécution par le CPU ? »
- Analogie de l'usine de traduction à 4 niveaux :
  - Niveau 1 : traduction orale rapide mot-à-mot (Ignition)
  - Niveau 2 : traduction écrite plus propre (Sparkplug)
  - Niveau 3 : adaptation des tournures (Maglev)
  - Niveau 4 : traduction littéraire parfaite mais lente (TurboFan)
- V8 commence toujours par le niveau 1 et ne monte que pour le code « hot »

**Transition** : « Voyons chaque étape du pipeline en détail. »

### [01:30-04:30] Concept clé — Le pipeline de compilation V8

Afficher le schéma du pipeline complet :

```
Source JS → Scanner → Parser → AST → Ignition (bytecode)
                                         ↓
                                    Sparkplug (baseline)
                                         ↓
                                    Maglev (mid-tier)
                                         ↓
                                    TurboFan (optimized)
```

#### Scanner (Lexer)
- Transforme le texte en tokens : `const`, `x`, `=`, `1`, `+`, `2`
- Streaming : commence avant que tout le fichier soit téléchargé

#### Parser
- Construit l'AST (Abstract Syntax Tree) à partir des tokens
- **Lazy parsing** : ne parse que les fonctions appelées immédiatement, reporte le reste
- Mentionner le pre-parser pour les fonctions non appelées

#### Ignition (Interpréteur)
- Transforme l'AST en **bytecode** — des instructions compactes pour une machine virtuelle
- Exécute le bytecode instruction par instruction via un `dispatch table`
- Collecte le **feedback de types** dans le Feedback Vector

#### Sparkplug (Baseline compiler)
- Compilation directe du bytecode vers le code machine, sans optimisation
- Pas d'allocation de registres, utilise la pile
- Très rapide à compiler — amélioration immédiate des performances

#### Maglev (Mid-tier compiler)
- Utilise le feedback de types pour des optimisations simples
- Construit un graphe SSA (Static Single Assignment)
- Compromis entre vitesse de compilation et qualité du code généré

#### TurboFan (Optimizing compiler)
- Optimisations agressives : inlining, escape analysis, élimination de code mort
- Se base sur des **spéculations** → peut **déoptimiser** si les hypothèses sont fausses
- Produit du code machine quasi natif en performance

**Transition** : « Passons au terminal pour voir le bytecode de nos propres yeux. »

### [04:30-08:30] Démonstration pratique — Examiner le bytecode

#### Étape 1 : Afficher le bytecode Ignition
```bash
node --print-bytecode --print-bytecode-filter="add" labs/lab-09-v8-optimization/exercise.js
```
- Expliquer la sortie : nom de la fonction, taille du bytecode, registres
- Identifier les instructions clés : `Ldar`, `Add`, `Star`, `Return`
- Montrer que chaque ligne JS produit quelques instructions bytecode

#### Étape 2 : Comparer deux versions
- Version 1 : fonction monomorphique (toujours le même type)
- Version 2 : fonction polymorphique (types variés)
- Montrer que le bytecode est identique mais le **Feedback Vector** diffère
- Expliquer que c'est le feedback qui déclenche ou non TurboFan

#### Étape 3 : Observer la compilation tiered
```bash
node --trace-opt --trace-deopt labs/lab-09-v8-optimization/exercise.js
```
- Repérer les messages `[marking ... for optimization]`
- Montrer la progression : Ignition → Sparkplug → Maglev → TurboFan
- Expliquer le concept de **hot count** (seuil de déclenchement)

**Transition** : « Visualisons tout ça de manière interactive. »

### [08:30-11:30] Visualisation — Pipeline interactif

- Ouvrir `visualizations/jit-pipeline.html` dans Chrome
- Parcourir la visualisation étape par étape :
  1. Montrer le code source entrer dans le Scanner
  2. Voir les tokens se transformer en AST
  3. Observer Ignition générer le bytecode
  4. Montrer le Feedback Vector se remplir au fil des appels
  5. Voir TurboFan activer l'optimisation quand le code est « hot »
  6. Déclencher une déoptimisation en changeant le type
- Mettre en pause à chaque étape pour commenter

**Transition** : « Résumons les concepts clés à retenir. »

### [11:30-14:00] Récap — Ce qu'il faut retenir

#### Feedback Vector
- Chaque fonction à un vecteur qui enregistre les types vus à chaque opération
- C'est la source de vérité pour les décisions d'optimisation
- États : uninitialized → monomorphic → polymorphic → megamorphic

#### Éléments Kinds
- V8 catégorise les tableaux par le type de leurs éléments
- `PACKED_SMI_ELEMENTS` (entiers) → `PACKED_DOUBLE_ELEMENTS` (flottants) → `PACKED_ELEMENTS` (mixte)
- Les transitions ne vont que dans un sens (dégradation)
- Conseil : ne pas mélanger les types dans un tableau

#### Smi vs HeapNumber
- **Smi** (Small Integer) : entier encodé directement dans le pointeur (pas d'allocation heap)
- **HeapNumber** : nombre flottant alloué sur le tas (plus lent, allocation + GC)
- Rester en Smi quand possible → performances maximales

#### Quiz rapide
- « Pourquoi V8 ne compile-t-il pas directement en TurboFan ? » → Parce que la compilation prend du temps, et le code froid ne justifie pas cet investissement
- « Que contient le Feedback Vector ? » → Les types observés à chaque site d'appel

> « Module suivant : on plonge dans les optimisations JIT et les déoptimisations. À tout de suite ! »

## Points d'attention pour l'enregistrement
- Le pipeline est complexe — prendre le temps de bien séparer chaque étape
- Zoomer sur la sortie `--print-bytecode` et annoter les instructions importantes
- Utiliser la visualisation comme support visually — ne pas juste la montrer, interagir avec
- Répéter les acronymes (AST, SSA, IC) pour que les apprenants les retiennent
- S'assurer que les flags V8 sont tapés correctement (copier-coller recommandé)
