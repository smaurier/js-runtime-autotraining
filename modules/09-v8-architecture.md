# Module 09 — Architecture V8

> **Objectif** : Comprendre le pipeline complet de compilation de V8 — du code source JavaScript au code machine natif — en passant par le scanner, le parseur, l'interpréteur Ignition, le compilateur baseline Sparkplug, le compilateur intermédiaire Maglev, le compilateur optimisant TurboFan et le nouveau backend Turboshaft. Savoir inspecter le bytecode, comprendre le code caching et le streaming compilation.

> **Difficulté** : ⭐⭐⭐⭐ (Expert) — Le module le plus technique sur V8.

---

## Prérequis

- Module 01 — Call Stack et Execution Context
- Module 07 — Garbage Collector (espaces mémoire V8)
- Notions de base en compilation (AST, bytecode, code machine)
- Familiarité avec la ligne de commande Node.js

### Rappel : les étapes de la compilation

Si les termes AST, bytecode et code machine sont nouveaux pour toi :

- **Code source** → le texte JavaScript que tu écris
- **AST (Abstract Syntax Tree)** → un arbre qui représente la structure de ton code (comme le sommaire d'un livre). Le moteur le construit en lisant ton code.
- **Bytecode** → des instructions simples pour une machine virtuelle (comme une recette de cuisine étape par étape, plus facile à suivre que le texte original)
- **Code machine** → les instructions que ton processeur exécute directement (des 0 et des 1)

Le pipeline est : `texte JS → AST → bytecode → (éventuellement) code machine`. Chaque étape transforme le code dans un format plus proche de ce que le processeur comprend.

---

## Théorie

> **Analogie pour débuter** : V8, c'est comme une usine de traduction. Ton code JavaScript arrive comme un texte en français, et l'usine doit le traduire en langage machine. L'usine a 4 niveaux de traduction : (1) une traduction orale rapide mais mot-à-mot (Ignition — l'interpréteur), (2) une traduction écrite un peu plus propre (Sparkplug — compilation rapide), (3) une traduction qui adapte les tournures de phrase (Maglev — optimisation intermédiaire), (4) une traduction littéraire parfaite mais qui prend du temps (TurboFan — optimisation maximale). L'usine commence toujours par le niveau 1, et ne monte que pour les textes qu'on lui demande de traduire encore et encore.

### 1. V8 : un moteur au coeur d'un vaste écosystème

V8 est le moteur JavaScript développé par Google, écrit en C++. Il compile le JavaScript en **code machine natif** pour les architectures x64, ARM64, ARM32, RISC-V, s390x, PPC, MIPS, et LoongArch.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │                      ÉCOSYSTÈME V8                                │
  │                                                                   │
  │  ┌──────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
  │  │ Chrome /     │  │ Node.js  │  │  Deno    │  │ Cloudflare   │ │
  │  │ Chromium     │  │          │  │          │  │  Workers     │ │
  │  └──────────────┘  └──────────┘  └──────────┘  └──────────────┘ │
  │  ┌──────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
  │  │ Electron     │  │ Opera    │  │  Edge    │  │ Hermes (*)   │ │
  │  │              │  │          │  │(Chromium)│  │              │ │
  │  └──────────────┘  └──────────┘  └──────────┘  └──────────────┘ │
  │                                                                   │
  │  (*) Hermes (React Native) n'utilise PAS V8 — c'est un moteur    │
  │      séparé. Bun utilise JavaScriptCore (WebKit), pas V8.        │
  │      Safari utilise JavaScriptCore. Firefox utilise SpiderMonkey. │
  └───────────────────────────────────────────────────────────────────┘
```

V8 est open source (licence BSD) et hébergé sur [chromium.googlesource.com/v8/v8](https://chromium.googlesource.com/v8/v8). Le miroir GitHub officiel est [github.com/v8/v8](https://github.com/v8/v8). Il évolue rapidement : une nouvelle version toutes les ~4 semaines, alignée sur les releases Chrome.

### 2. Le pipeline complet de compilation V8

Voici la carte du territoire — chaque étape sera détaillée dans les sections suivantes.

```
  Code Source JavaScript
  "function add(a, b) { return a + b; }"
         │
         ▼
  ┌──────────────────────┐
  │       SCANNER         │  Analyse lexicale (tokenisation)
  │       (Lexer)         │  Convertit le texte en tokens :
  │                       │  [FUNCTION] [IDENT:add] [(] [IDENT:a] ...
  │  UTF-16 stream →      │
  │  tokens                │
  └──────────┬────────────┘
             │
             ▼
  ┌──────────────────────┐
  │       PARSER          │  Analyse syntaxique → AST
  │                       │
  │  Deux modes :          │
  │  • Pre-parser (lazy)  │  Vérifie la syntaxe sans générer l'AST
  │  • Full parser        │  Génère l'AST complet + scopes
  └──────────┬────────────┘
             │
             ▼
  ┌──────────────────────┐
  │        AST            │  Abstract Syntax Tree
  │                       │
  │  FunctionDecl         │
  │   ├─ name: "add"      │
  │   ├─ params: [a, b]   │
  │   └─ body:            │
  │      └─ ReturnStmt    │
  │         └─ BinaryOp + │
  │            ├─ Var a    │
  │            └─ Var b    │
  └──────────┬────────────┘
             │
             │  BytecodeGenerator (une seule passe sur l'AST)
             ▼
  ╔══════════════════════════════════════════════════════════════════╗
  ║  TIER 0 — IGNITION (Interpréteur)                               ║
  ║                                                                  ║
  ║  AST → Bytecode V8 (compact, register-based)                     ║
  ║  Exécute instruction par instruction via des handlers C++        ║
  ║  Collecte le TYPE FEEDBACK dans les Feedback Vectors             ║
  ║                                                                  ║
  ║  TOUT le code JavaScript passe d'abord par Ignition.             ║
  ║  Seuil : 0 (immédiat, c'est le point d'entrée)                  ║
  ╚═══════════╤══════════════════════════════════════════════════════╝
              │
              │  Code tiède (~6-10 appels, ou boucle itérée ~16 fois)
              ▼
  ╔══════════════════════════════════════════════════════════════════╗
  ║  TIER 1 — SPARKPLUG (Compilateur baseline)                       ║
  ║                                                                  ║
  ║  Bytecode → Code machine NON optimisé                             ║
  ║  Compilation en une seule passe linéaire, pas d'IR                ║
  ║  Élimine seulement le surcoût de l'interprétation                 ║
  ║                                                                  ║
  ║  Depuis V8 9.1 / Chrome 91 (mai 2021)                            ║
  ║  Seuil très bas : ~6 appels (heuristique interne)                ║
  ╚═══════════╤══════════════════════════════════════════════════════╝
              │
              │  Code chaud (~100-1000 appels ou boucles chaudes)
              ▼
  ╔══════════════════════════════════════════════════════════════════╗
  ║  TIER 2 — MAGLEV (Compilateur mid-tier SSA)                      ║
  ║                                                                  ║
  ║  Bytecode + Type Feedback → Code machine partiellement optimisé   ║
  ║  IR basée sur SSA (Static Single Assignment)                      ║
  ║  10-100x plus rapide à compiler que TurboFan                      ║
  ║  Code généré ~2-5x plus lent que TurboFan                        ║
  ║                                                                  ║
  ║  Depuis V8 11.3 / Chrome 114 (mai 2023)                          ║
  ║  Activé par défaut depuis Chrome 117 (sept 2023)                  ║
  ╚═══════════╤══════════════════════════════════════════════════════╝
              │
              │  Code très chaud (~3000-10000+ appels, hot loops)
              ▼
  ╔══════════════════════════════════════════════════════════════════╗
  ║  TIER 3 — TURBOFAN (Compilateur optimisant)                      ║
  ║                                                                  ║
  ║  Bytecode + Type Feedback → Sea of Nodes IR → optimisations      ║
  ║  → scheduling → code machine hautement optimisé                   ║
  ║                                                                  ║
  ║  Optimisations : inlining, escape analysis, constant folding,     ║
  ║  dead code elimination, bounds check elimination, etc.            ║
  ║                                                                  ║
  ║  Backend progressivement remplacé par TURBOSHAFT (V8 11.1+)      ║
  ║                                                                  ║
  ║  Peut DÉOPTIMISER si les hypothèses de type sont violées          ║
  ║  → retour à Ignition (détaillé dans le Module 10)                ║
  ╚══════════════════════════════════════════════════════════════════╝
```

**Les seuils exacts** sont des heuristiques internes qui dépendent de : nombre d'appels, taille de la fonction, nombre d'itérations de boucle, pression mémoire, et le type feedback disponible. Les chiffres ci-dessus sont approximatifs.

```
  Comparaison des tiers :

  ┌───────────┬──────────────────┬───────────┬──────────────────┐
  │  Tier     │ Vitesse de       │ Qualité   │ Utilise le type  │
  │           │ compilation      │ du code   │ feedback ?       │
  ├───────────┼──────────────────┼───────────┼──────────────────┤
  │ Ignition  │ Instantanée      │ Lente     │ Le collecte      │
  │ Sparkplug │ Très rapide      │ Basique   │ Non              │
  │ Maglev    │ Rapide (~10x TF) │ Bonne     │ Oui (simple)     │
  │ TurboFan  │ Lente            │ Optimale  │ Oui (spéculatif) │
  └───────────┴──────────────────┴───────────┴──────────────────┘

  Performance relative du code généré (temps d'exécution) :

  Ignition    ████████████████████████████████████████  100%
  Sparkplug   ████████████████████████████              65%
  Maglev      ████████████████                          35%
  TurboFan    █████                                     12%
              ─────────────────────────────────────────────>
                                              plus rapide
```

### 3. Ignition — l'interpréteur bytecode

Ignition est le coeur du pipeline V8. Tout code JavaScript passe d'abord par Ignition.

**Caractéristiques clés** :
- **Register-based** (par opposition à stack-based comme la JVM). Chaque fonction a un nombre fixe de registres locaux (r0, r1, r2...) et un **accumulateur** implicite.
- Bytecode **compact** (~50% plus petit que le code machine équivalent, ~25% plus petit qu'un bytecode stack-based équivalent).
- Chaque instruction bytecode a un **handler natif** pré-compilé en C++ (dispatch table).
- Collecte le **type feedback** dans les **Feedback Vectors** — c'est la donnée essentielle pour les compilateurs optimisants.

#### L'accumulateur et les registres

```
  ┌──────────────────────────────────────────────────────────┐
  │  MODÈLE D'EXÉCUTION IGNITION                              │
  │                                                            │
  │  ┌──────────────┐                                          │
  │  │ Accumulateur  │  Registre implicite pour les            │
  │  │ (acc)         │  résultats intermédiaires               │
  │  └──────────────┘                                          │
  │                                                            │
  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐                              │
  │  │ a0 │ │ a1 │ │ a2 │ │ ...│  Paramètres (a0 = this)     │
  │  └────┘ └────┘ └────┘ └────┘                              │
  │                                                            │
  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐                              │
  │  │ r0 │ │ r1 │ │ r2 │ │ ...│  Registres locaux            │
  │  └────┘ └────┘ └────┘ └────┘  temporaires                 │
  │                                                            │
  │  Convention :                                              │
  │  - La plupart des instructions lisent/écrivent dans        │
  │    l'accumulateur                                          │
  │  - Ldar rX = load register rX dans l'accumulateur          │
  │  - Star rX = store l'accumulateur dans le registre rX      │
  │  - Star0..Star4 = versions raccourcies (1 octet)           │
  │  - [slot] = feedback slot dans le Feedback Vector          │
  └──────────────────────────────────────────────────────────┘
```

#### Les Feedback Vectors

Chaque fonction possède un **Feedback Vector** — un tableau de slots qui enregistrent les informations de type observées à l'exécution. C'est le mécanisme qui alimente les compilateurs optimisants.

```
  Feedback Vector pour la fonction add(a, b) :

  ┌────────┬─────────────────────────────────────────────┐
  │ Slot 0 │ BinaryOp(Add) : Smi + Smi                   │
  │ Slot 1 │ (non utilisé)                                │
  └────────┴─────────────────────────────────────────────┘

  Après add("hello", " world") :

  ┌────────┬─────────────────────────────────────────────┐
  │ Slot 0 │ BinaryOp(Add) : Smi + Smi, String + String  │
  │ Slot 1 │ (non utilisé)                                │
  └────────┴─────────────────────────────────────────────┘

  Le slot 0 a maintenant vu deux combinaisons de types.
  TurboFan devra gérer les deux cas ou spéculer sur un seul.
```

#### Les instructions bytecode courantes

> ⚙️ **Référence optionnelle** — Le tableau ci-dessous liste les instructions bytecode courantes d'Ignition. Tu n'as PAS besoin de le mémoriser. Il est là comme référence pour quand tu liras la sortie de `--print-bytecode`. En première lecture, retiens juste les 5 instructions de base : `Ldar` (charger une variable), `Star` (stocker dans un registre), `Add`/`Mul` (opérations), `Return` (retourner le résultat), `JumpLoop` (boucler).

```
  ┌────────────────────┬──────────────────────────────────────────────┐
  │ Catégorie          │ Instructions                                  │
  ├────────────────────┼──────────────────────────────────────────────┤
  │ Chargement         │ LdaSmi [n]      Charger un petit entier      │
  │                    │ LdaZero         Charger 0                     │
  │                    │ LdaUndefined    Charger undefined             │
  │                    │ LdaConstant [k] Charger constante k           │
  │                    │ Ldar rX         Charger registre → acc        │
  │                    │ LdaGlobal [slot] Charger une globale          │
  │                    │ GetNamedProperty  obj.prop (anciennement      │
  │                    │                  LdaNamedProperty)            │
  │                    │ GetKeyedProperty  obj[key]                    │
  ├────────────────────┼──────────────────────────────────────────────┤
  │ Stockage           │ Star rX         Store acc → registre          │
  │                    │ Star0..Star4    Store acc → r0..r4 (compact)  │
  │                    │ SetNamedProperty  obj.prop = acc              │
  │                    │ SetKeyedProperty  obj[key] = acc              │
  ├────────────────────┼──────────────────────────────────────────────┤
  │ Arithmétique       │ Add rX, [slot]  acc = acc + rX                │
  │                    │ Sub rX, [slot]  acc = acc - rX                │
  │                    │ Mul rX, [slot]  acc = acc * rX                │
  │                    │ Div rX, [slot]  acc = acc / rX                │
  │                    │ Inc [slot]      acc = acc + 1                  │
  ├────────────────────┼──────────────────────────────────────────────┤
  │ Comparaison        │ TestEqual rX             acc == rX            │
  │                    │ TestEqualStrict rX       acc === rX           │
  │                    │ TestLessThan rX          acc < rX             │
  │                    │ TestTypeOf [literal]     typeof acc           │
  ├────────────────────┼──────────────────────────────────────────────┤
  │ Contrôle de flux   │ Jump [offset]            saut inconditionnel  │
  │                    │ JumpIfTrue [offset]      si acc == true       │
  │                    │ JumpIfFalse [offset]     si acc == false      │
  │                    │ JumpLoop [offset, slot]  retour de boucle     │
  │                    │         (le slot alimente le profiling tier)   │
  ├────────────────────┼──────────────────────────────────────────────┤
  │ Appels             │ CallProperty rX, rY, [n] appel de méthode    │
  │                    │ CallUndefinedReceiver    appel de fonction    │
  │                    │ Construct rX, rY, [n]    new ...              │
  ├────────────────────┼──────────────────────────────────────────────┤
  │ Objets/Arrays      │ CreateObjectLiteral      {a: 1, b: 2}        │
  │                    │ CreateArrayLiteral       [1, 2, 3]            │
  │                    │ CreateClosure            function() {...}     │
  ├────────────────────┼──────────────────────────────────────────────┤
  │ Retour             │ Return                   retourner acc        │
  └────────────────────┴──────────────────────────────────────────────┘

  [slot] = feedback slot dans le Feedback Vector (type feedback)
```

#### Lecture d'un bytecode réel — exemple annoté

```js
function add(a, b) {
  return a + b;
}
add(1, 2);
```

```
  [generated bytecode for function: add (0x1234...)]
  Bytecode length: 6
  Parameter count 3            ← this (a0) + a (a1) + b (a2)
  Register count 0             ← pas de registre local nécessaire
  Frame size 0
  Feedback vector : slot 0 = BinaryOp feedback

  Adresse  Octets        Instruction      Commentaire
  ─────────────────────────────────────────────────────────
  0x0000   0b 02         Ldar a1          acc = paramètre 'b'
  0x0002   39 03 00      Add a0, [0]      acc = acc + paramètre 'a'
                                           ↑ feedback slot [0] :
                                           V8 y enregistre les types
                                           observés (Smi+Smi, Number+Number,
                                           String+String, etc.)
  0x0005   a9            Return           retourne acc

  Flux d'exécution :
  ┌────────────────────────────────────────────────┐
  │  1. Ldar a1     │ acc = b                       │
  │  2. Add a0, [0] │ acc = a + b (feedback → Smi)  │
  │  3. Return      │ retourne acc                   │
  └────────────────────────────────────────────────┘

  Remarque : "a0" dans le bytecode = paramètre 'a' (pas this).
  V8 numérote les paramètres en partant de this (a0 interne),
  mais le bytecode affiché utilise a0 pour le premier paramètre
  déclaré et a1 pour le second.
```

### 4. Sparkplug — le compilateur baseline rapide

Introduit dans V8 9.1 (Chrome 91, mai 2021), Sparkplug comble le fossé de performance entre l'interprétation par Ignition et l'optimisation par TurboFan/Maglev.

**Comment Sparkplug fonctionne** :
- Il prend le bytecode Ignition en entrée (pas l'AST).
- Il le traduit en code machine **instruction par instruction**, sans IR intermédiaire.
- C'est une compilation en **une seule passe linéaire** — extrêmement rapide.
- Il ne fait **aucune optimisation** — c'est une traduction quasi-1:1.
- Il conserve le même frame layout qu'Ignition (pas de re-matérialisation nécessaire lors d'une déoptimisation).
- Il n'a pas d'allocateur de registres — chaque registre du bytecode est mappé à un emplacement mémoire fixe sur la pile.

```
  Bytecode Ignition           Code machine Sparkplug (x64)
  ┌──────────────────┐       ┌──────────────────────────────┐
  │ Ldar a1          │  ───> │ mov rax, [rbp+0x18]          │
  │ Add a0, [0]      │  ───> │ mov rcx, [rbp+0x20]          │
  │                  │       │ call AddStub                  │
  │ Return           │  ───> │ ret                           │
  └──────────────────┘       └──────────────────────────────┘

  Pas d'analyse de type, pas d'inlining, pas d'optimisation.
  Juste la suppression du surcoût de dispatch des handlers
  bytecode. Gain typique : ~30-40% par rapport à Ignition.
```

**Pourquoi Sparkplug existe** : le dispatch de bytecode (lire l'instruction, trouver le handler, sauter au handler) représente une part significative du temps d'exécution dans l'interpréteur. Sparkplug élimine ce surcoût pour un coût de compilation quasi-nul.

**Quand Sparkplug intervient** : V8 compile une fonction avec Sparkplug quand elle est appelée environ 6 fois (seuil très bas et variable).

### 5. Maglev — le compilateur mid-tier SSA

Introduit dans V8 11.3 (Chrome 114, mai 2023), activé par défaut depuis Chrome 117.

**Pourquoi Maglev existe** : avant Maglev, le gap entre Sparkplug (0 optimisation) et TurboFan (optimisation maximale mais compilation lente) était trop grand. Beaucoup de fonctions étaient "trop chaudes pour Sparkplug, pas assez pour justifier TurboFan".

**Architecture de Maglev** :
- IR basée sur **SSA** (Static Single Assignment) — chaque valeur n'est assignée qu'une fois, ce qui facilite l'analyse.
- Construit un graphe directement depuis le bytecode (pas depuis l'AST).
- Utilise le type feedback collecté par Ignition pour spécialiser le code.
- Fait des optimisations simples : élimination de checks redondants, propagation de constantes, représentation spécialisée (Smi, Float64).
- Ne fait **pas** : inlining agressif, escape analysis, loop optimizations, code motion avancé.
- Compile en ~10ms là où TurboFan prendrait ~100ms pour la même fonction.

```
  Pipeline Maglev (simplifié) :

  Bytecode + Feedback Vector
         │
         ▼
  ┌──────────────────┐
  │  Graph Building    │  Construire le graphe SSA à partir
  │                    │  du bytecode + type feedback
  └────────┬──────────┘
           │
           ▼
  ┌──────────────────┐
  │  Phi insertion     │  Fusionner les valeurs aux points
  │                    │  de jonction (branches if/else)
  └────────┬──────────┘
           │
           ▼
  ┌──────────────────┐
  │  Register alloc   │  Allocateur de registres linéaire
  │  (linéaire)       │  (plus simple que celui de TurboFan)
  └────────┬──────────┘
           │
           ▼
  ┌──────────────────┐
  │  Code generation   │  Émettre le code machine final
  └──────────────────┘
```

### 6. TurboFan — le compilateur optimisant

TurboFan est le compilateur le plus agressif de V8. Il produit du code machine **hautement optimisé**, mais sa compilation est coûteuse (dizaines à centaines de millisecondes).

#### Sea of Nodes IR

TurboFan utilise une représentation intermédiaire unique : la **Sea of Nodes**, où les noeuds représentent des opérations et les arêtes représentent des dépendances. Les dépendances de **données** et de **contrôle** coexistent dans le même graphe, mais ne sont pas confondues.

```
  function clamp(x, min, max) {
    if (x < min) return min;
    if (x > max) return max;
    return x;
  }

  Sea of Nodes (simplifié) :

             [Start]
                │
         ┌──────┴───────┐
         │               │
      [Param x]   [Param min]   [Param max]
         │               │            │
         ├───────────────┤            │
         │               │            │
    [LessThan x,min]     │            │
         │               │            │
    [Branch]             │            │
     ┌───┴────┐          │            │
  [True]   [False]       │            │
     │        │          │            │
     │   [GreaterThan x,max]          │
     │        │                       │
     │   [Branch]                     │
     │    ┌──┴───┐                    │
     │ [True] [False]                 │
     │    │      │                    │
  [Ret min] [Ret max] [Ret x]
         │        │            │
         └────────┴────────────┘
                  │
               [End]
```

**Avantage de la Sea of Nodes** : les dépendances de données et de contrôle sont explicites. Les optimisations comme le code motion, l'élimination de redondances et le scheduling de l'instruction sont plus naturelles car les noeuds « flottent » librement tant que les dépendances sont respectées.

**Les principales optimisations de TurboFan** (détaillées dans le Module 10) :
- Inlining (avec budget)
- Dead code elimination
- Constant folding / propagation
- Escape analysis (allocation scalaire)
- Range analysis / bounds check elimination
- Loop peeling et loop unrolling
- Représentation spécialisée des nombres (Smi, Float64)
- Réduction de force (strength reduction)

### 7. Turboshaft — le nouveau backend IR

Turboshaft est la **nouvelle IR backend** qui remplace progressivement le backend de TurboFan, à partir de V8 11.1 (Chrome 111, mars 2023).

**Pourquoi Turboshaft ?**

Le backend de TurboFan (la partie qui va de l'IR Sea of Nodes vers le code machine) est devenu extrêmement complexe au fil des années. La Sea of Nodes, bien que puissante pour les optimisations de haut niveau, rend le scheduling et l'allocation de registres plus difficiles.

```
  Pipeline TurboFan SANS Turboshaft (historique) :

  Bytecode + Feedback
       │
       ▼
  Sea of Nodes IR ──> Optimisations ──> Scheduling ──> Register Alloc ──> Code Gen
  (frontend)          (middle-end)       (backend Sea of Nodes)

  ─────────────────────────────────────────────────────────────────────────

  Pipeline TurboFan AVEC Turboshaft (V8 11.1+) :

  Bytecode + Feedback
       │
       ▼
  Sea of Nodes IR ──> Optimisations ──> Turboshaft IR ──> Reg Alloc ──> Code Gen
  (frontend)          (middle-end)      (nouveau backend)

  Turboshaft utilise une IR CFG-based (Control Flow Graph) plus
  traditionnelle, ce qui simplifie :
  - L'allocation de registres
  - L'ordonnancement des instructions
  - L'ajout de nouvelles optimisations backend
  - Le débogage du compilateur lui-même
```

**État actuel** : Turboshaft remplace progressivement les phases backend de TurboFan. Depuis V8 12.x, la majorité des backends (x64, ARM64) utilisent Turboshaft. L'objectif à terme est de remplacer entièrement le backend Sea of Nodes.

Référence : [V8 Blog — Turboshaft: a new IR](https://v8.dev/blog/turboshaft)

### 8. Parsing : lazy parsing, pre-parsing et le problème du double parsing

V8 ne parse pas tout le code immédiatement. Le **lazy parsing** diffère l'analyse complète des fonctions non appelées.

```js
function outerFunction() {        // FULL PARSE (top-level, appelée)
  function innerUnused() {         // PRE-PARSE seulement
    // V8 vérifie la syntaxe et détecte les variables de scope
    // Mais ne génère PAS de bytecode
    return complexComputation();
  }

  function innerUsed() {           // PRE-PARSE d'abord, puis FULL PARSE à l'appel
    return 42;
  }

  return innerUsed();              // Déclenche le full parse de innerUsed
}
```

```
  ┌────────────────────────────────────────────────────────────┐
  │  LAZY PARSING vs EAGER PARSING                              │
  │                                                             │
  │  Phase 1 — Chargement du script :                           │
  │                                                             │
  │  function A() { ... }  ──> Pre-parse (rapide, ~2x)         │
  │  function B() { ... }  ──> Pre-parse (rapide, ~2x)         │
  │  function C() { ... }  ──> Pre-parse (rapide, ~2x)         │
  │                                                             │
  │  Phase 2 — Exécution :                                      │
  │                                                             │
  │  A();  ──> Full parse + génération bytecode pour A          │
  │  B();  ──> Full parse + génération bytecode pour B          │
  │                                                             │
  │  C n'est jamais appelée → jamais full-parsée                │
  │  → économie de temps de démarrage et de mémoire             │
  │                                                             │
  │  Pre-parse :                                                │
  │  - Vérifie la syntaxe (erreurs détectées immédiatement)     │
  │  - Identifie les variables et les scopes                    │
  │  - NE génère PAS de bytecode                                │
  │  - ~2x plus rapide que le full parse                        │
  └────────────────────────────────────────────────────────────┘
```

#### Le problème du double parsing

Si une fonction est pre-parsée puis appelée, elle sera parsée **deux fois** : une fois par le pre-parser, une fois par le full parser. C'est le **double parsing problem**.

```
  ┌────────────────────────────────────────────────────────────┐
  │  LE DOUBLE PARSING PROBLEM                                  │
  │                                                             │
  │  Script chargé :                                            │
  │  (function() {              // IIFE                         │
  │    // ... 500 lignes ...                                    │
  │  })();                                                      │
  │                                                             │
  │  1. Pre-parser parcourt les 500 lignes  ← travail gaspillé │
  │  2. L'IIFE est immédiatement exécutée                       │
  │  3. Full parser re-parcourt les 500 lignes                  │
  │                                                             │
  │  Solution de V8 : heuristiques pour détecter les IIFEs      │
  │  - Si le parser voit `(function` ou `!function`, il passe   │
  │    directement en full parse (eager parsing)                │
  │                                                             │
  │  Conseil : pour les fonctions qui seront TOUJOURS appelées  │
  │  immédiatement, l'envelopper dans des parenthèses aide :    │
  │  const init = (function() { ... })                          │
  └────────────────────────────────────────────────────────────┘
```

### 9. Code Caching — bytecode sérialisé

Quand V8 compile du JavaScript en bytecode, ce travail peut être **sérialisé sur disque** pour éviter de le refaire au prochain chargement. C'est le **code caching**.

```
  ┌────────────────────────────────────────────────────────────┐
  │  CODE CACHING (Chrome / Node.js)                            │
  │                                                             │
  │  Premier chargement d'un script :                           │
  │  ┌──────────┐    ┌───────┐    ┌──────────┐                 │
  │  │ Source JS │ →  │ Parse │ →  │ Bytecode │                 │
  │  └──────────┘    └───────┘    └────┬─────┘                 │
  │                                     │                       │
  │                                     ▼                       │
  │                              ┌─────────────┐                │
  │                              │ Sérialiser   │                │
  │                              │ le bytecode  │                │
  │                              │ sur disque   │                │
  │                              └─────────────┘                │
  │                                                             │
  │  Deuxième chargement (même script, même version) :          │
  │  ┌──────────┐    ┌──────────────┐    ┌──────────┐          │
  │  │ Source JS │ →  │ Désérialiser │ →  │ Bytecode │          │
  │  └──────────┘    │ depuis cache │    │ (prêt !) │          │
  │                  └──────────────┘    └──────────┘          │
  │                                                             │
  │  Gain : on saute le parsing + la génération de bytecode     │
  │  = démarrage beaucoup plus rapide (30-50% plus vite)        │
  │                                                             │
  │  Chrome : utilise un cache à 3 niveaux (cold, warm, hot)    │
  │  - Cold : premier chargement, pas de cache                  │
  │  - Warm : bytecode compilé et mis en cache                  │
  │  - Hot : code TurboFan aussi mis en cache                   │
  │                                                             │
  │  Node.js : v8.serialize() / vm.Script avec cachedData       │
  └────────────────────────────────────────────────────────────┘
```

### 10. Streaming Compilation

Dans Chrome, V8 peut commencer à parser et compiler le JavaScript **pendant que le script est encore en cours de téléchargement** via le réseau.

```
  ┌────────────────────────────────────────────────────────────┐
  │  STREAMING COMPILATION                                      │
  │                                                             │
  │  Réseau :  [chunk 1] [chunk 2] [chunk 3] [chunk 4]         │
  │                │         │         │         │              │
  │  Thread        │         │         │         │              │
  │  principal :   ▼         ▼         ▼         ▼              │
  │            (affiche la page, gère le DOM...)                │
  │                                                             │
  │  Thread de      │         │         │         │             │
  │  parsing :      ▼         ▼         ▼         ▼             │
  │            [parse 1] [parse 2] [parse 3] [parse 4]         │
  │                                                             │
  │  Le parsing se fait en parallèle du téléchargement          │
  │  et du rendering, sur un thread dédié.                      │
  │                                                             │
  │  Conditions : scripts avec type="module" ou assez grands    │
  │  (> 30 KB par défaut dans Chrome)                           │
  │                                                             │
  │  Depuis V8 7.5 / Chrome 75 (2019)                           │
  └────────────────────────────────────────────────────────────┘
```

### 11. Hidden Classes et Inline Caches — aperçu

Les **Hidden Classes** (appelées "Maps" dans V8) et les **Inline Caches** (ICs) sont les deux mécanismes qui rendent l'accès aux propriétés des objets JavaScript aussi rapide que dans un langage typé statiquement.

En bref : chaque objet possède un pointeur vers sa Map, qui décrit sa structure (quelles propriétés, à quels offsets). Les ICs mémorisent cette Map au site d'appel pour éviter de la re-chercher à chaque accès.

Ces mécanismes sont **détaillés en profondeur dans le Module 11** — qui constitue la référence unique sur le sujet. Dans le présent module, il suffit de retenir que le type feedback collecté par Ignition (via les Feedback Vectors) inclut les informations de Maps observées aux ICs, et que ce feedback est la matière première des compilateurs optimisants (Maglev et TurboFan).

### 12. Comment inspecter le pipeline V8

```bash
# ─── BYTECODE ─────────────────────────────────────────────────────
# Voir le bytecode de TOUTES les fonctions (très verbeux)
node --print-bytecode script.js

# Filtrer par nom de fonction (recommandé)
node --print-bytecode --print-bytecode-filter="add" script.js

# Voir aussi l'AST
node --print-bytecode --print-bytecode-filter="fibonacci" --print-ast script.js

# ─── OPTIMISATION / DÉOPTIMISATION ──────────────────────────────
# Voir quand V8 optimise et par quel tier
node --trace-opt script.js

# Voir les déoptimisations (avec raison)
node --trace-deopt script.js

# Les deux ensemble (recommandé pour le diagnostic)
node --trace-opt --trace-deopt script.js

# ─── PARSING ──────────────────────────────────────────────────────
# Tracer les décisions de parsing (lazy vs eager)
node --trace-parse script.js

# Désactiver le lazy parsing (pour comparer le temps de démarrage)
node --no-lazy script.js

# ─── COMPILATION / MAGLEV / TURBOFAN ────────────────────────────
# Voir les décisions d'inlining de TurboFan
node --trace-turbo-inlining script.js

# Générer un fichier .json lisible dans Turbolizer
# Outil officiel : https://v8.github.io/tools/turbolizer/
node --trace-turbo script.js

# ─── INTRINSICS V8 ──────────────────────────────────────────────
# Activer les fonctions natives V8 (%DebugPrint, %HaveSameMap, etc.)
node --allow-natives-syntax script.js

# ─── INLINE CACHES ──────────────────────────────────────────────
# Tracer les transitions IC (redirection stderr nécessaire)
node --trace-ic script.js 2> ic-trace.log
```

---

## Démonstration

### Demo 1 : Voir et analyser le bytecode d'une fonction simple

```js
// demo-bytecode-simple.js
// Lancer : node --print-bytecode --print-bytecode-filter="add" demo-bytecode-simple.js

function add(a, b) {
  return a + b;
}

// Appeler pour forcer la compilation
console.log(add(1, 2));        // 3
console.log(add(3.14, 2.71));  // 5.85
console.log(add('hello', ' world')); // 'hello world'

// Sortie attendue (simplifiée) :
//
// [generated bytecode for function: add]
// Bytecode length: 6
// Parameter count 3
// Register count 0
//    0 : 0b 02         Ldar a1
//    2 : 39 03 00      Add a0, [0]
//    5 : a9             Return
//
// Le feedback slot [0] aura vu : Smi, HeapNumber, String
// → le feedback est polymorphique (3 types différents)
```

### Demo 2 : Bytecode d'une boucle (avec JumpLoop et feedback)

```js
// demo-bytecode-loop.js
// Lancer : node --print-bytecode --print-bytecode-filter="fibonacci" demo-bytecode-loop.js

function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

console.log(fibonacci(10)); // 55

// Points à repérer dans le bytecode :
// - LdaSmi [1]           → charger la constante 1
// - TestLessThanOrEqual  → comparaison n <= 1
// - JumpIfFalse          → branchement conditionnel
// - JumpLoop [offset, slot] → retour en début de boucle
//   ↑ le slot alimente le compteur d'itérations pour la
//     promotion vers Maglev/TurboFan
// - Star rX              → stocker dans des registres locaux
// - Add rX, [slot]       → addition avec feedback
```

### Demo 3 : Observer les tiers de compilation

```js
// demo-compilation-tiers.js
// Lancer : node --trace-opt --trace-deopt demo-compilation-tiers.js

function hotFunction(x) {
  let sum = 0;
  for (let i = 0; i < x; i++) {
    sum += i * i;
  }
  return sum;
}

// Phase 1 : quelques appels → Ignition puis Sparkplug
for (let i = 0; i < 10; i++) {
  hotFunction(100);
}
console.log('Phase 1 : Ignition / Sparkplug');

// Phase 2 : beaucoup d'appels → Maglev
for (let i = 0; i < 500; i++) {
  hotFunction(100);
}
console.log('Phase 2 : probablement Maglev');

// Phase 3 : hot loop → TurboFan
for (let i = 0; i < 100_000; i++) {
  hotFunction(100);
}
console.log('Phase 3 : probablement TurboFan');

// Avec --trace-opt, vous verrez des lignes comme :
// [marking 0x... hotFunction for optimization to maglev]
// [compiling method 0x... hotFunction using Maglev]
// [marking 0x... hotFunction for optimization to turbofan]
// [compiling method 0x... hotFunction using TurboFan]
// [completed optimizing 0x... hotFunction]
```

### Demo 4 : Impact du lazy parsing sur le temps de démarrage

```js
// demo-lazy-parsing.js
// Lancer : node demo-lazy-parsing.js
// Puis :  node --no-lazy demo-lazy-parsing.js  (pour comparer)

// Définir beaucoup de fonctions qui ne sont jamais appelées
function unused1() { return Array.from({length: 1000}, (_, i) => i * i).reduce((a, b) => a + b); }
function unused2() { return Array.from({length: 1000}, (_, i) => i * i).reduce((a, b) => a + b); }
function unused3() { return Array.from({length: 1000}, (_, i) => i * i).reduce((a, b) => a + b); }
function unused4() { return Array.from({length: 1000}, (_, i) => i * i).reduce((a, b) => a + b); }
function unused5() { return Array.from({length: 1000}, (_, i) => i * i).reduce((a, b) => a + b); }
function unused6() { return Array.from({length: 1000}, (_, i) => i * i).reduce((a, b) => a + b); }
function unused7() { return Array.from({length: 1000}, (_, i) => i * i).reduce((a, b) => a + b); }
function unused8() { return Array.from({length: 1000}, (_, i) => i * i).reduce((a, b) => a + b); }
function unused9() { return Array.from({length: 1000}, (_, i) => i * i).reduce((a, b) => a + b); }
function unused10() { return Array.from({length: 1000}, (_, i) => i * i).reduce((a, b) => a + b); }

// Seule cette fonction est appelée
function actualWork() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += i;
  return sum;
}

const start = performance.now();
const result = actualWork();
const elapsed = (performance.now() - start).toFixed(3);

console.log(`Résultat : ${result}`);
console.log(`Temps : ${elapsed} ms`);
console.log('Les 10 fonctions unused* ont été PRE-PARSÉES seulement (lazy parsing).');
console.log('Relancer avec --no-lazy pour forcer le full parse et comparer.');
```

---

### V8 vs SpiderMonkey (Firefox)

V8 n'est pas le seul moteur JavaScript performant. SpiderMonkey (Firefox) et JavaScriptCore (Safari) utilisent des architectures similaires avec des noms différents. Comprendre les équivalences aide à voir que les principes sont universels.

**Pipeline de compilation comparé :**

| Tier | V8 (Chrome/Node) | SpiderMonkey (Firefox) | JavaScriptCore (Safari) |
|---|---|---|---|
| Interpréteur | **Ignition** (bytecode register-based) | **Baseline Interpreter** (bytecode) | **LLInt** (Low Level Interpreter) |
| Baseline JIT | **Sparkplug** (1:1 bytecode → machine code) | **Baseline JIT** (compilation rapide) | **Baseline JIT** |
| Mid-tier JIT | **Maglev** (SSA, mid-tier) | *(pas d'équivalent direct)* | **DFG** (Data Flow Graph) |
| Optimizing JIT | **TurboFan** (sea-of-nodes, optimisant) | **WarpMonkey** (optimisant, CacheIR-based) | **FTL** (Faster Than Light, LLVM-based puis B3) |
| Backend | **Turboshaft** (nouveau backend TurboFan) | *(intégré dans WarpMonkey)* | *(intégré dans B3/Air)* |

**Points clés de comparaison :**

- **SpiderMonkey a 3 tiers** (Interpreter → Baseline → WarpMonkey) contre **4 tiers pour V8** (Ignition → Sparkplug → Maglev → TurboFan). JSC en a également 4 (LLInt → Baseline → DFG → FTL).
- **Baseline Interpreter de SpiderMonkey ≈ Ignition de V8** : les deux interprètent du bytecode et collectent du feedback de types.
- **WarpMonkey ≈ TurboFan** : les deux sont des compilateurs optimisants spéculatifs. La différence principale est que WarpMonkey utilise **CacheIR** (informations de types basées sur les inline caches) tandis que TurboFan utilise des **Feedback Vectors**.
- **JSC (JavaScriptCore)** a un pipeline en 4 étapes : LLInt → Baseline JIT → DFG (optimisations basées sur l'interprétation abstraite) → FTL (optimisations agressives).

```
  V8 :           Ignition → Sparkplug → Maglev → TurboFan (→ Turboshaft)
  SpiderMonkey : Interpreter → Baseline JIT → WarpMonkey
  JSC :          LLInt → Baseline JIT → DFG → FTL
```

> **À retenir** : tous les moteurs modernes suivent le même schéma fondamental — interpréter d'abord (démarrage rapide), puis compiler progressivement le code chaud (exécution rapide). Les noms changent, le principe reste.

---

## Points clés

1. Le pipeline V8 comporte **4 tiers** : Ignition (interpréteur) → Sparkplug (baseline) → Maglev (mid-tier SSA) → TurboFan (optimisant), avec Turboshaft comme nouveau backend de TurboFan.
2. **Tout code** passe d'abord par Ignition qui génère du bytecode register-based et collecte le type feedback dans les Feedback Vectors.
3. **Sparkplug** traduit le bytecode en code machine sans optimisation — il élimine juste le surcoût de dispatch de l'interpréteur.
4. **Maglev** utilise le type feedback pour produire du code partiellement optimisé, avec une compilation 10-100x plus rapide que TurboFan.
5. **TurboFan** utilise une IR "Sea of Nodes" pour des optimisations agressives. **Turboshaft** remplace progressivement son backend avec une IR CFG-based plus maintenable.
6. Le **code caching** sérialise le bytecode sur disque pour accélérer les chargements suivants.
7. Le **streaming compilation** permet de parser pendant le téléchargement.
8. Le **lazy parsing** évite de parser les fonctions non appelées → accélère le démarrage. Attention au double parsing pour les IIFEs.
9. Les Hidden Classes et Inline Caches sont les mécanismes de type feedback qui alimentent tout le pipeline (détaillés dans le Module 11).
10. `--print-bytecode`, `--trace-opt`, `--trace-deopt` et `--trace-parse` sont les outils essentiels d'inspection.

---

## Lab associé

**Lab 09 — Exploration du pipeline V8**

Fichier : `labs/lab-09-v8-pipeline/`

1. Écrire 5 fonctions de complexité croissante (identité, arithmétique, boucle, récursion, accès d'objet).
2. Utiliser `--print-bytecode --print-bytecode-filter` pour analyser le bytecode de chacune.
3. Identifier les registres, l'accumulateur, et les slots de feedback dans le bytecode.
4. Utiliser `--trace-opt` pour observer quelles fonctions sont optimisées et par quel tier (Maglev vs TurboFan).
5. Mesurer le temps de démarrage avec et sans lazy parsing (`--no-lazy` pour désactiver).
6. Comparer le bytecode d'une boucle `for` vs `Array.prototype.map()` pour la même opération.

---

## Pour aller plus loin

- [V8 Blog — Ignition: an interpreter for V8](https://v8.dev/blog/ignition-interpreter)
- [V8 Blog — Sparkplug, a non-optimizing JavaScript compiler](https://v8.dev/blog/sparkplug)
- [V8 Blog — Maglev, V8's fastest optimizing JIT](https://v8.dev/blog/maglev)
- [V8 Docs — TurboFan JIT Design](https://v8.dev/docs/turbofan)
- [V8 Blog — Turboshaft, a new compiler backend](https://v8.dev/blog/turboshaft)
- [V8 Blog — Blazingly fast parsing (scanner)](https://v8.dev/blog/scanner)
- [V8 Blog — Preparser (lazy parsing)](https://v8.dev/blog/preparser)
- [V8 Blog — Code caching for JavaScript developers](https://v8.dev/blog/code-caching-for-devs)
- [V8 Blog — Background compilation](https://v8.dev/blog/background-compilation)
- [Benedikt Meurer — Speculative Optimization in V8](https://benediktmeurer.de/2017/12/13/an-introduction-to-speculative-optimization-in-v8/)
- [V8 Source Code (GitHub mirror)](https://github.com/v8/v8)
- [V8 Source Code (official)](https://chromium.googlesource.com/v8/v8)

---

## Défi

Cette fonction devrait être rapide — elle fait un simple calcul de distance. Pourtant, après l'avoir utilisée dans deux contextes différents, elle devient 10x plus lente. Diagnostiquez le problème avec les flags V8 et corrigez-le.

```js
// node --trace-opt --trace-deopt defi-09.js

function computeDistance(point1, point2) {
  const dx = point1.x - point2.x;
  const dy = point1.y - point2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Contexte 1 : points uniformes
const points1 = Array.from({ length: 10000 }, (_, i) => ({ x: i, y: i * 2 }));

console.time('Contexte 1');
for (let i = 0; i < points1.length - 1; i++) {
  computeDistance(points1[i], points1[i + 1]);
}
console.timeEnd('Contexte 1'); // ~2ms (rapide, TurboFan optimise)

// Contexte 2 : points avec hidden class instable
const points2 = Array.from({ length: 10000 }, (_, i) => {
  const p = { x: i, y: i * 2 };
  if (i % 1000 === 0) p.z = 0;  // Ajouter une propriété conditionnellement
  return p;
});

console.time('Contexte 2');
for (let i = 0; i < points2.length - 1; i++) {
  computeDistance(points2[i], points2[i + 1]);
}
console.timeEnd('Contexte 2'); // ~20ms (10x plus lent !)
```

<details>
<summary>Réponse</summary>

**Le problème : les Hidden Classes (Maps) sont différentes.**

Dans le Contexte 1, tous les objets `{ x: i, y: i * 2 }` ont la **même Map**. TurboFan optimise `computeDistance` pour cette Map spécifique (accès monomorphique).

Dans le Contexte 2, l'ajout conditionnel de `p.z = 0` crée **deux Maps différentes** :
- Map A : `{ x, y }` (pour 9990 objets)
- Map B : `{ x, y, z }` (pour 10 objets)

L'Inline Cache passe de **monomorphique** à **polymorphique**. TurboFan doit générer du code qui vérifie la Map à chaque accès, ou déoptimiser.

Avec `--trace-deopt`, vous verriez :
```
[deoptimizing: ... computeDistance ... reason: wrong map]
```

**Correction** : toujours créer les objets avec la même forme :

```js
const points2 = Array.from({ length: 10000 }, (_, i) => ({
  x: i, y: i * 2, z: i % 1000 === 0 ? 0 : undefined
}));
```

Ou mieux, utiliser une classe :

```js
class Point {
  constructor(x, y, z = undefined) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}
```

Pour en savoir plus sur les Hidden Classes et les Inline Caches, voir le **Module 11** qui couvre le sujet en profondeur.

</details>
