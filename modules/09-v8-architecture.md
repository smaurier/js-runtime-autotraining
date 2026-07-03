---
titre: Architecture de V8 — le pipeline de compilation
cours: 01-js-runtime
notions: [scanner et parser, lazy parsing et pre-parsing, AST, Ignition et bytecode, feedback vectors, tiers de compilation, seuils de promotion, Sparkplug baseline, Maglev mid-tier, TurboFan optimisant, deoptimisation]
outcomes: [décrire le pipeline complet de V8 du texte source au code machine, observer le bytecode Ignition d'une fonction avec les flags V8, expliquer pourquoi une fonction chaude est promue vers TurboFan]
prerequis: [08-memory-leaks]
next: 10-jit-compilation-optimization
libs: []
tribuzen: profilage du tiering V8 sur les fonctions chaudes de l'API TribuZen (scoring de recommandation)
last-reviewed: 2026-07
---

# Architecture de V8 — le pipeline de compilation

> **Outcomes — tu sauras FAIRE :** décrire le pipeline complet de V8 (source → AST → bytecode → code machine), observer le bytecode Ignition d'une fonction avec les flags V8, expliquer pourquoi une fonction chaude de l'API finit compilée par TurboFan.
> **Difficulté :** :star::star::star::star:

## 1. Cas concret d'abord

L'API TribuZen expose un endpoint de recommandation. Pour chaque membre d'une famille, il calcule un score d'affinité avec les activités proposées. La fonction cœur tourne des milliers de fois par requête :

```js
// scoring.js — cœur de l'endpoint /recommendations
function affinityScore(member, activity) {
  const dx = member.energy - activity.energyCost;
  const dy = member.social - activity.socialLoad;
  return Math.sqrt(dx * dx + dy * dy);
}

// Simulation de charge : 3 phases de trafic croissant
const members = Array.from({ length: 5000 }, (_, i) => ({ energy: i % 10, social: i % 7 }));
const activity = { energyCost: 5, socialLoad: 3 };

console.time('froid');
for (const m of members) affinityScore(m, activity);
console.timeEnd('froid'); // lent : la fonction est INTERPRÉTÉE

console.time('tiède');
for (let r = 0; r < 50; r++) for (const m of members) affinityScore(m, activity);
console.timeEnd('tiède'); // plus rapide : code machine baseline

console.time('chaud');
for (let r = 0; r < 2000; r++) for (const m of members) affinityScore(m, activity);
console.timeEnd('chaud'); // très rapide : code machine optimisé
```

**Les questions que ce module résout :**
1. Pourquoi la même fonction devient-elle plus rapide au fil des appels, sans qu'on change une ligne ?
2. Qui décide de la « promouvoir » et sur quel critère ?
3. Comment *observer* ce qui se passe — le bytecode généré, le moment où V8 optimise ?

La réponse tient dans l'architecture interne de V8, le moteur qui exécute ton JavaScript dans Node.js et Chrome. On va suivre le code source de `affinityScore` à travers tout le pipeline.

---

## 2. Théorie complète, concise

### 2.1 Vue d'ensemble : un pipeline à plusieurs tiers

V8 est le moteur JavaScript de Google (écrit en C++) qui propulse Chrome, Node.js, Deno et Cloudflare Workers. Il ne se contente pas d'interpréter : il **compile progressivement** le code qui s'exécute souvent.

Le pipeline complet, du texte à l'exécution :

```
  Texte JS  →  Scanner  →  Parser  →  AST  →  Ignition (bytecode)
                                                    │
                                     collecte le type feedback
                                                    │
            code de plus en plus chaud ─────────────┤
                                                    ▼
              Sparkplug  →  Maglev  →  TurboFan  (code machine)
              (baseline)   (mid-tier)  (optimisant)
                                                    │
                        si une hypothèse de type est violée
                                                    ▼
                              DÉOPTIMISATION → retour à Ignition
```

L'idée directrice : **démarrer vite, optimiser le code chaud**. Interpréter démarre instantanément mais s'exécute lentement ; compiler en code machine optimisé coûte cher mais s'exécute vite. V8 fait les deux, dans cet ordre, et ne paie le coût de la compilation optimisante que pour le code qui le mérite.

### 2.2 Scanner et Parser — du texte à l'AST

Le **scanner** (lexer) transforme le flux de caractères UTF-16 en **tokens** :

```
  "function affinityScore(member, activity) {"
   → [FUNCTION] [IDENT:affinityScore] [(] [IDENT:member] [,] [IDENT:activity] [)] [{]
```

Le **parser** consomme ces tokens et produit l'**AST** (Abstract Syntax Tree), un arbre qui décrit la structure du code :

```
  FunctionDeclaration
   ├─ name: "affinityScore"
   ├─ params: [member, activity]
   └─ body:
      └─ ReturnStatement
         └─ CallExpression (Math.sqrt)
            └─ BinaryExpression (+)
               ├─ BinaryExpression (dx * dx)
               └─ BinaryExpression (dy * dy)
```

### 2.3 Lazy parsing et pre-parsing

V8 ne parse pas tout le code en entier immédiatement — ce serait du temps de démarrage gaspillé pour des fonctions jamais appelées. Il applique le **lazy parsing** :

- **Pre-parse** (rapide, ~2× le scan) : vérifie la syntaxe et repère les variables/scopes, mais **ne génère pas de bytecode**.
- **Full parse** (complet) : construit l'AST détaillé et génère le bytecode. Déclenché seulement quand la fonction est réellement appelée.

```js
function outer() {          // full-parsée (appelée)
  function neverCalled() {  // PRE-parsée seulement — pas de bytecode
    return heavyWork();
  }
  function used() {         // pre-parsée, puis full-parsée à l'appel
    return 42;
  }
  return used();            // déclenche le full parse de used()
}
```

**Le piège du double parsing** : une fonction pre-parsée *puis* appelée est parcourue deux fois. Pour une IIFE (exécutée immédiatement), c'est du gaspillage pur. V8 détecte les motifs `(function` / `!function` et passe alors directement en **eager parsing** (full parse d'emblée) pour éviter le double travail.

### 2.4 Ignition — l'interpréteur bytecode (Tier 0)

Tout le code JS passe d'abord par **Ignition**. Il traduit l'AST en **bytecode V8** — des instructions compactes pour une machine virtuelle — puis les exécute une par une.

Caractéristiques :
- **Register-based** (pas stack-based comme la JVM) : chaque fonction dispose de registres locaux `r0, r1…` et d'un **accumulateur** implicite (`acc`) qui porte les résultats intermédiaires.
- Bytecode **compact** (~50 % plus petit que le code machine équivalent) → bon pour la mémoire et le démarrage.
- Chaque instruction a un **handler** natif pré-compilé en C++.
- **Collecte le type feedback** : c'est ici que se constitue la matière première de l'optimisation.

Le bytecode de `affinityScore` reste lisible. Les instructions de base à connaître :

```
  Ldar rX          charger le registre rX dans l'accumulateur
  Star rX          stocker l'accumulateur dans le registre rX
  LdaSmi [n]       charger un petit entier (Small integer)
  Add / Mul rX,[s] acc = acc (+|*) rX,  avec un feedback slot [s]
  Return           retourner l'accumulateur
  JumpLoop [o,s]   retour de boucle (le slot s alimente le compteur d'itérations)
```

### 2.5 Les Feedback Vectors — la mémoire des types

Chaque fonction possède un **Feedback Vector** : un tableau de slots où Ignition enregistre les **types observés à l'exécution**. C'est le carburant des compilateurs optimisants.

```
  Feedback Vector de affinityScore, après les premiers appels :

  ┌────────┬──────────────────────────────────────────────┐
  │ Slot 0 │ BinaryOp(Sub) : Smi - Smi                     │
  │ Slot 1 │ BinaryOp(Mul) : Smi * Smi                     │
  │ Slot 2 │ LoadProperty  : Map{energy, social} (mono)    │
  └────────┴──────────────────────────────────────────────┘
```

Un slot qui n'a vu qu'un seul type/forme est **monomorphe** (le cas idéal). S'il en voit plusieurs, il devient **polymorphe**, puis **mégamorphe** — et l'optimisation devient plus difficile. Ce feedback repose sur les Hidden Classes (les *Maps* de V8) et les Inline Caches, **détaillés dans le module 11**. Ici, retiens juste : Ignition observe, note dans le Feedback Vector, et les tiers suivants s'en servent.

### 2.6 Les tiers de compilation et leurs seuils

Plus une fonction est appelée (ou plus sa boucle itère), plus V8 la fait « monter en tier ». Les seuils sont des **heuristiques internes** (nombre d'appels, taille de la fonction, itérations, pression mémoire) — les chiffres ci-dessous sont des ordres de grandeur, pas des constantes.

| Tier | Composant | Entrée | Sortie | Feedback ? | Depuis |
|---|---|---|---|---|---|
| 0 | **Ignition** | AST | bytecode (interprété) | le collecte | origine |
| 1 | **Sparkplug** | bytecode | code machine non optimisé | non | Chrome 91 (2021) |
| 2 | **Maglev** | bytecode + feedback | code partiellement optimisé | oui (simple) | Chrome 114/117 (2023) |
| 3 | **TurboFan** | bytecode + feedback | code hautement optimisé | oui (spéculatif) | origine |

```
  Vitesse d'exécution du code généré (plus court = plus rapide) :

  Ignition   ████████████████████████████████████████  (référence)
  Sparkplug  ████████████████████████████
  Maglev     ████████████████
  TurboFan   █████
```

### 2.7 Sparkplug — le compilateur baseline (Tier 1)

**Sparkplug** prend le *bytecode* (pas l'AST) et le traduit en code machine en **une seule passe linéaire**, sans aucune optimisation. Il n'a même pas d'allocateur de registres : chaque registre bytecode est mappé à un emplacement fixe sur la pile.

```
  Bytecode Ignition          Code machine Sparkplug (x64)
  ┌─────────────────┐       ┌──────────────────────────┐
  │ Ldar a1         │  ──►  │ mov rax, [rbp+0x18]      │
  │ Sub a0, [0]     │  ──►  │ call SubStub             │
  │ Return          │  ──►  │ ret                       │
  └─────────────────┘       └──────────────────────────┘
```

Ce qu'il gagne : il **supprime le surcoût de dispatch** de l'interpréteur (lire l'instruction, trouver le handler, sauter). Gain typique ~30-40 % sur Ignition, pour un coût de compilation quasi nul. Il conserve le même frame layout qu'Ignition, ce qui rend la déoptimisation triviale.

### 2.8 Maglev — le compilateur mid-tier (Tier 2)

Avant **Maglev**, le fossé entre Sparkplug (0 optimisation) et TurboFan (optimisation maximale mais compilation lente) était trop large. Maglev comble ce trou :

- IR basée sur **SSA** (Static Single Assignment) : chaque valeur assignée une seule fois → analyse simplifiée.
- Construit son graphe directement depuis le bytecode + le type feedback.
- Fait des optimisations **simples** : élimination de checks redondants, propagation de constantes, représentation spécialisée des nombres (Smi, Float64).
- **Ne fait pas** : inlining agressif, escape analysis, optimisations de boucles avancées.
- Compile ~10-100× plus vite que TurboFan, pour un code ~2-5× plus lent que TurboFan. Bon compromis pour le code « tiède-chaud ».

### 2.9 TurboFan — le compilateur optimisant (Tier 3)

**TurboFan** est le plus agressif. Il exploite le type feedback pour **spéculer** sur les types et générer du code machine spécialisé et très rapide. Sa compilation coûte des dizaines à des centaines de millisecondes — réservée au code très chaud.

Ses optimisations (inlining, escape analysis, bounds-check elimination, constant folding…) sont **le sujet du module 10**. Ici, deux points suffisent :

1. TurboFan **spécule** : il suppose que `member` aura toujours la forme `{energy, social}` vue dans le feedback, et génère un code qui n'est valide *que* pour cette hypothèse.
2. Si l'hypothèse est violée à l'exécution (un `member` d'une autre forme arrive), le code optimisé est jeté : c'est la **déoptimisation**, on retombe sur Ignition, et le cycle peut recommencer. Détaillée aussi dans le module 10.

> **Note backend — Turboshaft.** Depuis ~2023, V8 remplace progressivement le *backend* de TurboFan (la partie IR → code machine) par **Turboshaft**, une IR basée sur un graphe de flot de contrôle (CFG) plus classique, plus simple à maintenir que la « Sea of Nodes » historique. Pour l'apprenant, c'est un détail d'implémentation interne : le rôle de TurboFan (compilateur optimisant, dernier tier) ne change pas.

### 2.10 Inspecter le pipeline — les flags V8

```bash
# Bytecode Ignition d'une fonction précise (recommandé : filtrer)
node --print-bytecode --print-bytecode-filter="affinityScore" scoring.js

# Voir quand V8 optimise et vers quel tier
node --trace-opt scoring.js

# Voir les déoptimisations (avec la raison)
node --trace-deopt scoring.js

# Les décisions de parsing (lazy vs eager)
node --trace-parse scoring.js

# Désactiver le lazy parsing (pour mesurer son impact au démarrage)
node --no-lazy scoring.js
```

Ces flags Node exposent directement les flags V8 sous-jacents. Ce sont les outils du lab et de tout diagnostic de perf runtime.

---

## 3. Worked examples

### Exemple 1 — Lire le bytecode Ignition de `affinityScore`

But : voir de nos yeux le bytecode que génère Ignition, et repérer les feedback slots.

```bash
node --print-bytecode --print-bytecode-filter="affinityScore" scoring.js
```

Sortie (simplifiée et annotée) :

```
  [generated bytecode for function: affinityScore]
  Parameter count 3          ← this (a0) + member (a1) + activity (a2)
  Register count 2           ← r0 = dx, r1 = dy
  Frame size 16

  Adr    Octets         Instruction              Commentaire
  ──────────────────────────────────────────────────────────────
  0x00   ...            GetNamedProperty a1, [0]  acc = member.energy   (slot 0)
  0x05   ...            Star r0                   r0 = acc
  0x07   ...            GetNamedProperty a2, [2]  acc = activity.energyCost (slot 2)
  0x0c   ...            Sub r0, [4]               acc = member.energy - acc (slot 4)
  0x0f   ...            Star r0                   r0 = dx
  ...                   (idem pour dy → r1)
  0x1e   ...            Mul r0, [6]               acc = dx * dx (slot 6)
  ...                   CallProperty (Math.sqrt)
  0x2a   ...            Return                    retourne le score
```

**Ce qu'on lit :**
1. `GetNamedProperty a1, [0]` — l'accès `member.energy`, avec un **feedback slot [0]** : V8 y note la Map de `member` observée. Tant que tous les `member` ont la même forme, le slot reste **monomorphe**.
2. `Sub r0, [4]` — la soustraction porte un slot de type : V8 note `Smi - Smi`. Ce feedback dira à Maglev/TurboFan qu'ils peuvent générer une soustraction entière directe.
3. Aucun code machine ici : on est au Tier 0. C'est juste du bytecode interprété — le point de départ.

### Exemple 2 — Observer la montée en tier avec `--trace-opt`

But : prouver que la fonction chaude du cas concret est bien promue Maglev puis TurboFan.

```bash
node --trace-opt scoring.js
```

Extrait typique de la sortie (les adresses varient) :

```
  [marking 0x3f1a affinityScore for optimization to MAGLEV, reason: hot]
  [compiling method 0x3f1a affinityScore using Maglev]
  [completed compiling 0x3f1a affinityScore using Maglev]
  ...
  [marking 0x3f1a affinityScore for optimization to TURBOFAN, reason: hot and stable]
  [compiling method 0x3f1a affinityScore using TurboFan]
  [completed optimizing 0x3f1a affinityScore]
```

**Lecture pas à pas :**
1. Phase `froid` : la fonction est simplement interprétée par Ignition, puis très vite compilée par Sparkplug (Sparkplug n'apparaît pas dans `--trace-opt`, son seuil est trop bas et il n'est pas considéré comme une « optimisation »).
2. Phase `tiède` : après ~quelques centaines d'appels, `marking … to MAGLEV` — V8 juge la fonction assez chaude pour un code partiellement optimisé.
3. Phase `chaud` : la boucle massive rend la fonction très chaude *et* son feedback est **stable** (toujours la même Map, toujours `Smi`). V8 la promeut à **TurboFan**. C'est ce qui explique le `console.timeEnd('chaud')` très rapide.

> **Fading — variante à faire soi-même :** relance le même script après avoir rendu le feedback instable (par ex. mélanger des `member` de formes différentes). Avec `--trace-deopt`, tu verras une ligne `deoptimizing … reason: wrong map` : le code TurboFan est jeté. C'est le pont vers le module 10.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « V8 compile mon code en code machine dès le lancement »

Faux. **Tout** commence par de l'interprétation (Ignition). La compilation en code machine (Sparkplug → Maglev → TurboFan) n'arrive que *progressivement*, pour le code qui devient chaud. Une fonction appelée une seule fois n'est jamais optimisée — elle reste du bytecode interprété. C'est un choix délibéré : optimiser du code froid coûterait plus cher que de l'interpréter.

### PIÈGE #2 — Confondre le bytecode (Ignition) et le code machine (les JIT)

```
  ❌ « Ignition génère du code machine »
  ✅ Ignition génère du BYTECODE (portable, interprété par des handlers C++).
     Sparkplug / Maglev / TurboFan génèrent du CODE MACHINE (natif, spécifique CPU).
```

Le bytecode est une représentation intermédiaire portable ; le code machine est du x64/ARM64 exécuté directement par le processeur. Les feedback slots vivent dans le bytecode, pas dans le code machine.

### PIÈGE #3 — « Plus de tiers = toujours plus rapide, il faut viser TurboFan »

Monter en tier a un **coût** (temps de compilation, mémoire du code compilé). Pour du code exécuté peu de fois, rester en Ignition/Sparkplug est le bon choix. Vouloir « forcer » TurboFan partout (micro-benchmarks trompeurs, boucles de warmup artificielles) ne reflète pas la réalité d'une API où beaucoup de fonctions restent tièdes. La bonne question n'est pas « comment tout mettre en TurboFan » mais « ma fonction *chaude* atteint-elle bien TurboFan et y reste-t-elle (pas de déopt) ».

### PIÈGE #4 — Le double parsing des IIFE

```js
// ❌ V8 pre-parse les 200 lignes, puis les full-parse à l'exécution immédiate
const config = function () { /* 200 lignes */ }();

// ✅ Les parenthèses signalent l'exécution immédiate → eager parse direct
const config = (function () { /* 200 lignes */ })();
```

Une fonction qui sera *toujours* exécutée immédiatement gagne à être enveloppée de parenthèses : V8 la reconnaît comme IIFE et évite le pre-parse gaspillé. Effet marginal sur une petite fonction, réel sur de gros blocs d'init au démarrage.

### PIÈGE #5 — « Le feedback polymorphe, c'est juste un peu plus lent »

Le passage de monomorphe → polymorphe → mégamorphe n'est pas linéaire. Un site d'accès mégamorphe empêche l'inlining et peut provoquer des déoptimisations en cascade. Une fonction qui reçoit des objets de formes variées peut être **10× plus lente** que la même fonction avec un feedback stable. La stabilité des formes d'objets (module 11) compte autant que la « chaleur ».

---

## 5. Ancrage TribuZen

Le pipeline V8 n'est pas de la théorie décorative pour TribuZen : c'est ce qui fait qu'un endpoint tient la charge.

**`affinityScore`** (`api/src/recommendations/scoring.ts`) — la fonction du cas concret. Appelée `membres × activités` fois par requête `/recommendations`, elle est la définition d'une **fonction chaude**. Sur un service qui tourne en continu, V8 la promeut jusqu'à TurboFan et elle s'exécute alors en code machine spécialisé. Notre travail côté code : lui garantir un **feedback stable** — toujours les mêmes formes d'objets `member` et `activity` — pour qu'elle *reste* en TurboFan sans déoptimiser.

**Le warmup en production** — au démarrage du service Node, les premières requêtes sont plus lentes (Ignition/Sparkplug) : c'est le temps que les fonctions chaudes montent en tier. C'est pourquoi on ne mesure jamais la latence sur les toutes premières requêtes après un déploiement, et pourquoi certains services font un *warmup* synthétique avant d'accepter du trafic.

**L'observation** — pendant une session de perf sur l'API TribuZen, les flags de ce module sont les premiers réflexes :

```bash
# Sur un script isolé reproduisant la fonction chaude
node --trace-opt --trace-deopt scoring-repro.js
# → confirme que affinityScore atteint TurboFan et n'est pas déoptimisée
```

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/api/src/
  recommendations/
    scoring.ts          # affinityScore — fonction chaude
    scoring-repro.js    # repro isolé pour observer le tiering (hors prod)
```

---

## 6. Points clés

1. V8 suit un pipeline **texte → scanner → parser → AST → bytecode (Ignition) → code machine (JIT)**, avec le principe « démarrer vite, optimiser le code chaud ».
2. Le **lazy parsing** ne full-parse une fonction qu'à son premier appel ; les IIFE évitent le double parsing via l'eager parse.
3. **Ignition** interprète du bytecode register-based (accumulateur + registres) et **collecte le type feedback** dans les Feedback Vectors.
4. Il y a **4 tiers** : Ignition (interpréteur) → Sparkplug (baseline, 0 optimisation) → Maglev (mid-tier SSA) → TurboFan (optimisant spéculatif). Les seuils sont des heuristiques.
5. **Sparkplug** supprime le surcoût de dispatch ; **Maglev** optimise vite et modérément ; **TurboFan** optimise fort mais cher, en spéculant sur les types.
6. Un feedback **monomorphe et stable** est la condition pour qu'une fonction atteigne et *reste* en TurboFan ; violer l'hypothèse déclenche une **déoptimisation** (module 10).
7. `--print-bytecode`, `--trace-opt`, `--trace-deopt`, `--trace-parse` sont les outils d'inspection du pipeline.

---

## 7. Seeds Anki

```
Dans quel ordre V8 traite-t-il le code, du texte à l'exécution ?|Texte JS → scanner (tokens) → parser → AST → Ignition (bytecode interprété) → puis, pour le code chaud, Sparkplug → Maglev → TurboFan (code machine).
Quels sont les 4 tiers de compilation de V8 et leur rôle ?|Ignition (interpréteur bytecode, collecte le feedback), Sparkplug (baseline, code machine non optimisé), Maglev (mid-tier SSA, optimisation simple et rapide), TurboFan (optimisant spéculatif, code très rapide mais compilation coûteuse).
Qu'est-ce qu'un Feedback Vector et à quoi sert-il ?|Un tableau de slots où Ignition enregistre les types/formes observés à l'exécution pour chaque site (accès propriété, opération). C'est la matière première que Maglev et TurboFan utilisent pour spécialiser/spéculer.
Pourquoi Ignition génère-t-il du bytecode plutôt que du code machine ?|Le bytecode est compact (~50% plus petit que le code machine) et démarre instantanément. On ne paie le coût de la compilation en code machine que pour le code chaud, via les JIT.
Qu'apporte Sparkplug par rapport à Ignition ?|Il traduit le bytecode en code machine en une passe linéaire, sans optimisation, ce qui supprime le surcoût de dispatch de l'interpréteur (~30-40% de gain) pour un coût de compilation quasi nul.
Pourquoi Maglev a-t-il été ajouté entre Sparkplug et TurboFan ?|Pour combler le fossé : Sparkplug ne fait aucune optimisation, TurboFan optimise à fond mais compile lentement. Maglev (SSA) optimise modérément et compile 10-100x plus vite que TurboFan — idéal pour le code tiède-chaud.
Qu'est-ce que le lazy parsing et le piège du double parsing ?|Lazy parsing : V8 ne full-parse une fonction qu'à son premier appel (pre-parse rapide avant). Double parsing : une IIFE pre-parsée puis exécutée est parcourue deux fois ; l'envelopper de parenthèses fait passer V8 en eager parse et évite le gaspillage.
Quels flags Node/V8 permettent d'observer le pipeline ?|--print-bytecode (bytecode Ignition), --trace-opt (montée en tier), --trace-deopt (déoptimisations et raison), --trace-parse (décisions lazy/eager).
Pourquoi une fonction chaude peut-elle être déoptimisée après avoir atteint TurboFan ?|TurboFan spécule sur les types du feedback (ex. member toujours de forme {energy, social}). Si un objet d'une autre forme arrive, l'hypothèse est violée : le code optimisé est jeté et on retombe sur Ignition (détaillé au module 10).
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-09-v8-optimization/README.md`. Observer, avec les vrais flags V8, le bytecode d'une fonction et sa montée à travers les tiers Ignition → Maglev → TurboFan sur la fonction chaude de l'API TribuZen.
