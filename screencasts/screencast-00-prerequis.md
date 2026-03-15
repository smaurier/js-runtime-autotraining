# Screencast 00 — Prérequis et Vue d'Ensemble

## Informations
- **Durée estimée** : 12-15 min
- **Module** : `modules/00-prerequis-et-vue-ensemble.md`
- **Lab associé** : Aucun lab dédié (exploration du projet)
- **Prérequis** : Node.js >= 20 installé, éditeur de code, terminal

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Navigateur ouvert sur le dépôt GitHub du cours
- [ ] Éditeur de code avec l'arborescence du projet visible

## Script

### [00:00-01:30] Introduction — Bienvenue

> Bonjour et bienvenue dans ce cours sur les **mécanismes internes du runtime JavaScript**.
> Je m'appelle [Prénom] et pendant les prochains modules, on va plonger ensemble
> sous le capot de JavaScript — pas pour apprendre la syntaxe, mais pour comprendre
> **comment le moteur exécute réellement votre code**.
>
> À la fin de ce parcours, vous saurez expliquer précisément ce qui se passe entre
> le moment où vous écrivez `node app.js` et le moment où le résultat s'affiche.

**Action** : Montrer le slide d'introduction ou le README du cours.

### [01:30-04:00] Concept clé — Le modèle mental du pipeline

> Commençons par le modèle mental central de tout ce cours.
> Quand vous exécutez du JavaScript, votre code passe par un **pipeline** :
>
> 1. **Code source** — votre fichier `.js` tel que vous l'avez écrit.
> 2. **Parsing** — le moteur transforme le texte en un AST (Abstract Syntax Tree).
> 3. **Bytecode** — l'interpréteur (Ignition dans V8) génère du bytecode exécutable.
> 4. **Code optimisé** — le compilateur JIT (TurboFan) optimise les fonctions chaudes.
>
> Ce pipeline, c'est le fil rouge du cours. Chaque module explore un maillon de la chaîne.

**Action** : Dessiner ou afficher un schéma du pipeline `Source → AST → Bytecode → Optimized Code`.

> On va aussi voir que ce pipeline ne se fait pas en isolation : il y à la **call stack**,
> la **boucle d'événements**, le **garbage collector**, et bien d'autres composants
> qui interagissent en permanence.

### [04:00-08:00] Démonstration pratique — Explorer le projet

> Passons à la pratique. Vérifions d'abord notre environnement.

**Commandes à exécuter** :
```bash
node --version        # Doit afficher v20+
npm --version         # Vérification npm
```

> Parfait. Maintenant explorons la structure du projet.

**Action** : Ouvrir l'arborescence dans l'éditeur et commenter.

```
js-runtime-course/
├── modules/          # Les 16 fiches de cours en Markdown
├── labs/             # Un lab par module avec exercise.js + solution.js
├── visualizations/   # Pages HTML interactives (call-stack, event-loop, etc.)
├── quizzes/          # QCM de validation par module
├── screencasts/      # Les scripts des vidéos (ce que vous regardez !)
└── README.md         # Point d'entrée du cours
```

> Chaque module suit le même schéma : **une fiche théorique**, **un lab pratique**,
> **une visualisation interactive**, et **un quiz** de validation.

**Action** : Ouvrir un fichier lab d'exemple et le lancer.

```bash
node labs/lab-01-call-stack-observation/exercise.js
```

> On verra en détail ce lab au prochain screencast. Pour l'instant, notez que
> le projet est conçu pour être progressif — chaque module s'appuie sur le précédent.

### [08:00-11:00] Les trois moteurs — V8, SpiderMonkey, JSC

> JavaScript n'est pas un monolithe — il existe **plusieurs moteurs** qui l'implémentent.
> Les trois principaux sont :
>
> - **V8** (Google) — utilisé dans Chrome et Node.js. C'est notre référence principale.
> - **SpiderMonkey** (Mozilla) — utilisé dans Firefox. Le tout premier moteur JS, créé par Brendan Eich.
> - **JavaScriptCore / JSC** (Apple) — utilisé dans Safari et Bun.
>
> Tous suivent la spécification ECMAScript, mais leurs stratégies d'optimisation diffèrent.
> Par exemple, V8 utilise Ignition + TurboFan, tandis que JSC utilise un pipeline à 4 niveaux
> (LLInt → Baseline → DFG → FTL).

**Action** : Afficher le glossaire du cours (`modules/00-prerequis-et-vue-ensemble.md` section glossaire).

> Ce glossaire vous accompagnera tout au long du cours. Je vous recommande de le garder
> ouvert comme référence. Vous y trouverez les définitions de : AST, bytecode, JIT,
> GC, event loop, microtask, et bien d'autres.

### [11:00-14:00] Récap + Aperçu des modules suivants

> Récapitulons ce qu'on a vu :
>
> 1. Le **pipeline** Source → Bytecode → Code optimisé est le modèle mental central.
> 2. Le projet est organisé en **modules progressifs** avec labs, visualisations et quiz.
> 3. On travaille principalement avec **V8** (Node.js), mais on comparera avec SpiderMonkey et JSC.
>
> Voici ce qui vous attend dans les prochains modules :
>
> - **Module 01** : La Call Stack et les contextes d'exécution
> - **Module 02** : Scope, Closures et Mémoire
> - **Module 03** : La Boucle d'Événements
> - **Modules 04-06** : Microtâches, Promises, Async/Await
> - **Module 07** : Le Garbage Collector
> - **Modules 08-15** : Prototypes, optimisations JIT, Web APIs, Streams, Workers...
>
> Avant de passer au module suivant, assurez-vous que votre environnement est prêt :
> Node.js 20+, un éditeur de code, et Chrome DevTools.

**Action** : Mentionner le quiz du module 00 dans `quizzes/`.

> Allez faire le quiz du module 00 pour valider vos acquis. On se retrouve au prochain screencast !

## Points d'attention pour l'enregistrement
- Parler lentement lors de l'explication du pipeline — c'est le fondement de tout le cours
- S'assurer que le terminal est lisible (taille de police >= 16pt)
- Vérifier que `node --version` affiche bien une version >= 20 avant l'enregistrement
- Garder le schéma du pipeline visible pendant toute la section [01:30-04:00]
- Ne pas s'attarder sur les détails des moteurs — ce sera approfondi dans les modules suivants
