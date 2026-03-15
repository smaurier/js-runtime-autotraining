# Module 10 — JIT Compilation & Optimisation

> **Objectif** : Comprendre comment TurboFan optimise le code JavaScript à partir du type feedback, quelles sont les optimisations clés (inlining, escape analysis, constant folding, etc.), comment fonctionne l'On-Stack Replacement (OSR), et surtout quelles sont les causes de déoptimisation et comment les diagnostiquer. Ce module ne ré-explique pas le pipeline V8 (Module 09) ni les Hidden Classes/ICs (Module 11) — il se concentre exclusivement sur la mécanique d'optimisation et de déoptimisation.

> **Difficulté** : ⭐⭐⭐⭐ (Expert)

---

## Prérequis

- Module 09 — Architecture V8 (pipeline Ignition → Sparkplug → Maglev → TurboFan)
- Notions de base sur les Hidden Classes et les Inline Caches (voir Module 11 pour le détail)
- Familiarité avec les flags V8 (`--trace-opt`, `--trace-deopt`)

---

## Théorie

> **Analogie pour débuter** : Le JIT, c'est comme un cuisinier qui observe tes habitudes. Si tu commandes toujours le même plat (mêmes types), il le prépare d'avance (optimisation). Mais si tu changes soudainement de commande (type différent), il doit tout jeter et recommencer (déoptimisation).

### 1. JIT vs AOT vs Interprétation : le spectre d'exécution

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  SPECTRE DES STRATÉGIES D'EXÉCUTION                               │
  │                                                                   │
  │  Interprétation       JIT                    AOT                  │
  │  pure                 (V8, SpiderMonkey,     (C, C++, Rust, Go)   │
  │  (anciens moteurs)     JavaScriptCore)                            │
  │                                                                   │
  │  ◄──────────────────────────────────────────────────────────────► │
  │                                                                   │
  │  Démarrage            Démarrage               Démarrage           │
  │  instantané           rapide                   lent (compilation   │
  │                                                à l'avance)        │
  │                                                                   │
  │  Exécution            Exécution               Exécution           │
  │  très lente           rapide (code chaud)      la plus rapide     │
  │                                                                   │
  │  Pas besoin de        Profile d'exécution     Pas de profile      │
  │  compilation          → optimisations          d'exécution :      │
  │                       spéculatives             impossible de       │
  │                       (avantage unique !)      spécialiser         │
  └───────────────────────────────────────────────────────────────────┘
```

L'avantage unique du JIT : **les optimisations spéculatives basées sur le profile d'exécution**. Un compilateur AOT ne sait pas quels types seront passés à une fonction. V8, lui, le sait grâce au type feedback collecté par Ignition.

### 2. Type feedback : comment V8 apprend les types

Le mécanisme central est le **Feedback Vector** (introduit dans le Module 09). Chaque opération dans le bytecode possède un slot qui enregistre les types et les comportements observés à l'exécution.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  FEEDBACK VECTOR — Ce que V8 enregistre                           │
  │                                                                   │
  │  Pour un BinaryOp (ex: a + b) :                                   │
  │  → Types des opérandes (Smi, HeapNumber, String, BigInt)          │
  │  → Type du résultat                                               │
  │                                                                   │
  │  Pour un property access (ex: obj.x) :                            │
  │  → Map(s) de l'objet observé + offset de la propriété             │
  │  → État de l'IC (mono/poly/mega) — détaillé dans le Module 11    │
  │                                                                   │
  │  Pour un appel de fonction (ex: fn(x)) :                          │
  │  → Quelle(s) fonction(s) ont été appelées                         │
  │  → Feedback sur le receveur (this)                                │
  │                                                                   │
  │  Pour une comparaison (ex: a < b) :                               │
  │  → Types comparés (Number, String, etc.)                          │
  │  → Résultat le plus fréquent (pour branch prediction)             │
  │                                                                   │
  │  Pour un JumpLoop (retour de boucle) :                            │
  │  → Compteur d'itérations → détermine la promotion de tier         │
  └───────────────────────────────────────────────────────────────────┘
```

### 3. Optimisation spéculative : parier sur la stabilité des types

TurboFan génère du code machine **spécialisé pour les types observés**. C'est une spéculation : le compilateur parie que les types ne changeront pas, et insère des **guards** (vérifications) pour chaque hypothèse.

> **Comment lire ce qui suit** — Le code ci-dessous n'est PAS du JavaScript. C'est une représentation simplifiée du **code machine** que TurboFan génère. Tu n'as pas besoin de comprendre chaque instruction. L'important est de voir le **pattern** :
>
> 1. Une **vérification** (guard) — "est-ce que `a` est bien un entier ?"
> 2. Une **opération simple** — l'addition ou multiplication elle-même
> 3. Si la vérification échoue → **désoptimisation** (retour au bytecode)
>
> Compare surtout le **nombre d'instructions** entre la version optimisée et la version générique. Moins d'instructions = plus rapide.

```
  function add(a, b) { return a + b; }

  Si le feedback montre : a = Smi, b = Smi (100% du temps)

  TurboFan génère (pseudo-assembleur x64) :
  ┌──────────────────────────────────────────────────────────┐
  │  ; Guard : vérifier que a est un Smi                     │
  │  test rdi, 0x1          ; bit 0 = 0 pour les Smi         │
  │  jnz deopt_point_1      ; sinon → déoptimisation         │
  │                                                           │
  │  ; Guard : vérifier que b est un Smi                     │
  │  test rsi, 0x1                                            │
  │  jnz deopt_point_2                                        │
  │                                                           │
  │  ; Addition entière (pas de conversion, pas de dispatch)  │
  │  mov rax, rdi                                             │
  │  add rax, rsi                                             │
  │                                                           │
  │  ; Guard : vérifier l'overflow                            │
  │  jo deopt_point_3       ; overflow → déoptimisation       │
  │                                                           │
  │  ret                                                      │
  └──────────────────────────────────────────────────────────┘

  Comparaison avec le code NON optimisé (générique) :
  ┌──────────────────────────────────────────────────────────┐
  │  if (isSmi(a) && isSmi(b))                               │
  │    result = smiAdd(a, b);                                │
  │    if (overflow) result = heapNumberAdd(a, b);           │
  │  else if (isNumber(a) && isNumber(b))                    │
  │    result = doubleAdd(toDouble(a), toDouble(b));         │
  │  else if (isString(a) || isString(b))                    │
  │    result = stringConcat(toString(a), toString(b));      │
  │  else                                                    │
  │    result = genericAdd(toPrimitive(a), toPrimitive(b)); │
  │  // → ~20 instructions vs ~5 en code spécialisé          │
  └──────────────────────────────────────────────────────────┘
```

### 4. Les optimisations clés de TurboFan

#### 4.1 Inlining (avec budget)

L'inlining est l'optimisation la plus impactante. TurboFan copie le corps d'une petite fonction directement dans l'appelant, éliminant le coût de l'appel et permettant d'autres optimisations en chaîne.

```js
// AVANT inlining
function square(x) { return x * x; }

function sumOfSquares(a, b) {
  return square(a) + square(b);
}

// APRÈS inlining par TurboFan (conceptuel)
function sumOfSquares(a, b) {
  const sq_a = a * a;  // square(a) inliné
  const sq_b = b * b;  // square(b) inliné
  return sq_a + sq_b;
  // → constant folding possible si a et b sont des constantes
  // → aucun coût d'appel de fonction
}
```

**Le budget d'inlining** : TurboFan ne peut pas tout inliner — il y a un budget de taille (en noeuds dans le graphe). Chaque inlining augmente la taille du graphe. Quand le budget est dépassé, TurboFan arrête d'inliner.

```
  ┌──────────────────────────────────────────────────────────────────┐
  │  INLINING — Critères de décision de TurboFan                     │
  │                                                                   │
  │  Inliné si :                                                      │
  │  ✓ Taille du bytecode < ~400 instructions (seuil ajustable)       │
  │  ✓ Budget total de noeuds du graphe pas dépassé                   │
  │  ✓ Profondeur d'inlining < ~5 niveaux                            │
  │  ✓ Le site d'appel est monomorphique (une seule cible)           │
  │                                                                   │
  │  PAS inliné si :                                                  │
  │  ✗ Fonction trop grande                                           │
  │  ✗ Appel polymorphique (plusieurs cibles possibles)               │
  │  ✗ Fonction récursive (au-delà d'1-2 niveaux)                    │
  │  ✗ Budget dépassé                                                 │
  │  ✗ Fonction contient eval()                                       │
  │                                                                   │
  │  Flag : --trace-turbo-inlining pour voir les décisions            │
  └──────────────────────────────────────────────────────────────────┘
```

#### 4.2 Dead Code Elimination

Suppression du code qui ne sera jamais exécuté ou dont le résultat n'est jamais utilisé.

```js
function example(x) {
  const a = x * 2;     // utilisé
  const b = x * 3;     // JAMAIS utilisé → supprimé
  if (false) {
    console.log('jamais atteint');  // supprimé
  }
  return a;
}
// TurboFan réduit à : return x * 2;
```

#### 4.3 Constant Folding / Propagation

Si TurboFan peut déterminer qu'une valeur est toujours constante, il remplace l'expression par sa valeur.

```js
function getDiscount() {
  const rate = 0.15;      // constante
  const base = 100;       // constante
  return base * rate;     // → 15 (calculé à la compilation)
}
// TurboFan génère simplement : return 15;
```

#### 4.4 Escape Analysis (analyse d'échappement)

Détecte les objets qui ne "s'échappent" pas d'une fonction (pas retournés, pas assignés à une variable externe). Ces objets sont "scalar-replaced" : leurs champs sont décomposés en variables locales (registres), éliminant l'allocation sur le tas.

```js
// AVANT escape analysis
function distance(x1, y1, x2, y2) {
  const p1 = { x: x1, y: y1 }; // allocation sur le tas
  const p2 = { x: x2, y: y2 }; // allocation sur le tas
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// APRÈS escape analysis par TurboFan
function distance(x1, y1, x2, y2) {
  // p1 et p2 "scalar-replaced" — aucune allocation !
  // Les champs deviennent directement des registres
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
```

**Impact** : zéro allocation → zéro pression sur le GC → performance maximale dans les hot loops.

**Limites** : l'objet ne doit pas s'échapper. S'il est retourné, stocké dans un tableau, passé à une fonction non inlinée, ou capturé par une closure, l'escape analysis échoue et l'objet est alloué normalement.

#### 4.5 Range Analysis et Bounds Check Elimination

TurboFan prouve que certaines valeurs sont toujours dans des bornes connues, ce qui permet de supprimer des vérifications inutiles.

```js
function sum(arr) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i];  // bounds check normalement nécessaire
  }
  return total;
}
// TurboFan prouve que 0 <= i < arr.length
// → le bounds check sur arr[i] est supprimé
// → gain significatif sur les boucles qui itèrent des tableaux
```

#### 4.6 Loop Peeling

La première itération d'une boucle est "pelée" (exécutée séparément). Cela permet de spécialiser le code de la boucle en utilisant le feedback de cette première itération.

```
  Boucle originale :             Après loop peeling :
  ┌──────────────────┐          ┌──────────────────┐
  │ for (i=0; i<n) { │          │ // Première itération
  │   body(i);       │          │ body(0);          │
  │ }                │          │                   │
  └──────────────────┘          │ // Boucle restante│
                                 │ for (i=1; i<n) { │
                                 │   body(i);       │  ← optimisée avec
                                 │ }                │    le feedback de
                                 └──────────────────┘    l'itération 0
```

### 5. On-Stack Replacement (OSR) : optimiser en plein vol

OSR permet de remplacer le code d'une fonction **pendant qu'elle s'exécute**, typiquement au milieu d'une boucle longue.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  ON-STACK REPLACEMENT (OSR)                                       │
  │                                                                   │
  │  function longLoop() {                                            │
  │    let sum = 0;                                                   │
  │    for (let i = 0; i < 10_000_000; i++) {                         │
  │      sum += i * 1.5;                                              │
  │    }                                                              │
  │    return sum;                                                    │
  │  }                                                                │
  │                                                                   │
  │  Sans OSR :                                                       │
  │  - Toutes les 10M itérations dans Ignition (LENT)                 │
  │  - TurboFan ne peut compiler qu'au PROCHAIN appel de longLoop     │
  │                                                                   │
  │  Avec OSR :                                                       │
  │  Itération :  1     ~1000      ~10000                   10000000  │
  │               │       │           │                        │      │
  │  Tier :    Ignition ─► [OSR] ──► TurboFan ──────────────► done    │
  │                         ▲                                         │
  │                         │                                         │
  │                    Remplacement du frame sur la pile :             │
  │                    1. TurboFan compile la fonction                 │
  │                    2. Construit un nouveau frame optimisé          │
  │                    3. Copie les variables locales                  │
  │                    4. Transfert l'exécution au point exact         │
  │                       de la boucle                                │
  │                                                                   │
  │  Résultat : les ~9,999,000 itérations restantes tournent          │
  │  en code machine optimisé                                         │
  └───────────────────────────────────────────────────────────────────┘
```

**Comment détecter l'OSR** dans `--trace-opt` :
```
[compiling method ... for on-stack replacement]
```

Le "on-stack replacement" indique un OSR, par opposition à un simple :
```
[compiling method ... using TurboFan]
```
qui compile pour les appels futurs.

### 6. Déoptimisation : les 3 types

Quand les hypothèses spéculatives de TurboFan sont violées, V8 effectue une **déoptimisation** : le code machine optimisé est abandonné et l'exécution revient à Ignition.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  LES 3 TYPES DE DÉOPTIMISATION                                    │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐  │
  │  │ EAGER DEOPT (immédiate)                                      │  │
  │  │                                                              │  │
  │  │ Quand : un guard check échoue pendant l'exécution du code   │  │
  │  │ optimisé. La valeur ne correspond pas au type attendu.       │  │
  │  │                                                              │  │
  │  │ Exemple : add(a, b) optimisé pour Smi, et a = "hello"       │  │
  │  │ → check_smi(a) échoue → DEOPT immédiate                     │  │
  │  │                                                              │  │
  │  │ Trace : [deoptimizing (DEOPT eager): ... not a Smi]         │  │
  │  └─────────────────────────────────────────────────────────────┘  │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐  │
  │  │ LAZY DEOPT (différée)                                        │  │
  │  │                                                              │  │
  │  │ Quand : une hypothèse a été invalidée par un événement       │  │
  │  │ externe (ex: la Map d'un objet global a changé, un           │  │
  │  │ prototype a été modifié, un champ a changé de type).         │  │
  │  │                                                              │  │
  │  │ Le code optimisé est marqué pour déoptimisation. Quand       │  │
  │  │ l'exécution y retourne, la déopt se produit.                 │  │
  │  │                                                              │  │
  │  │ Trace : [deoptimizing (DEOPT lazy): ... wrong map]          │  │
  │  └─────────────────────────────────────────────────────────────┘  │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐  │
  │  │ SOFT DEOPT (volontaire)                                      │  │
  │  │                                                              │  │
  │  │ Quand : V8 décide de déoptimiser pour recompiler avec un     │  │
  │  │ meilleur feedback. Ce n'est pas un échec — c'est une         │  │
  │  │ stratégie pour obtenir du code encore meilleur.              │  │
  │  │                                                              │  │
  │  │ Exemple : V8 a optimisé trop tôt, le feedback n'était pas    │  │
  │  │ encore assez riche. Après soft deopt, Ignition collecte      │  │
  │  │ plus de feedback, puis TurboFan recompile.                   │  │
  │  │                                                              │  │
  │  │ Trace : [deoptimizing (DEOPT soft): ... insufficient        │  │
  │  │          type feedback]                                      │  │
  │  └─────────────────────────────────────────────────────────────┘  │
  └───────────────────────────────────────────────────────────────────┘

  Ce que coûte une déoptimisation :
  ┌────────────────────────────────────────────────────────────────┐
  │ 1. Le frame optimisé doit être "traduit" en frame bytecode     │
  │ 2. Les registres machine → registres virtuels Ignition         │
  │ 3. L'exécution reprend dans l'interpréteur                     │
  │ 4. Si les types se stabilisent, recompilation possible         │
  │                                                                │
  │ Coût : ~100 microsecondes par déopt + perte du code optimisé   │
  └────────────────────────────────────────────────────────────────┘
```

### 7. Le deopt limiter : quand V8 abandonne

V8 ne tente pas d'optimiser indéfiniment une fonction qui déoptimise en boucle.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  DEOPT LIMITER                                                     │
  │                                                                   │
  │  Fonction f() :                                                   │
  │                                                                   │
  │  Tentative 1 : TurboFan compile → DEOPT (type change)            │
  │  Tentative 2 : TurboFan recompile → DEOPT (map change)           │
  │  Tentative 3 : TurboFan recompile → DEOPT (type change)          │
  │  ...                                                              │
  │                                                                   │
  │  Après ~10 déoptimisations (seuil interne, varie selon V8) :      │
  │  → V8 marque la fonction comme "don't optimize"                   │
  │  → Elle reste dans Sparkplug ou Ignition pour toujours            │
  │  → Plus jamais promue vers Maglev ou TurboFan                    │
  │                                                                   │
  │  Trace : [disabled optimization for ... reason: ...]              │
  │                                                                   │
  │  C'est la pire situation : le code est définitivement lent.       │
  │  La seule solution est de corriger le code source pour            │
  │  stabiliser les types.                                            │
  └───────────────────────────────────────────────────────────────────┘
```

### 8. Les déclencheurs courants de déoptimisation

**Note** : les causes liées aux Hidden Classes (Maps) et aux Inline Caches sont détaillées dans le Module 11. Ici, nous les listons brièvement pour compléter le tableau.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  CAUSES DE DÉOPTIMISATION                                          │
  │                                                                   │
  │  TYPE CHANGES                                                     │
  │  ─────────────────────────────────────────────────────────────── │
  │  function f(x) { return x + 1; }                                 │
  │  f(42);     // optimisé pour Smi                                  │
  │  f("oops"); // → DEOPT eager: not a Smi                          │
  │                                                                   │
  │  f(42);              // Smi OK                                    │
  │  f(2147483647);      // overflow → HeapNumber → DEOPT             │
  │                                                                   │
  │  MAP CHANGES (voir Module 11 pour le détail)                      │
  │  ─────────────────────────────────────────────────────────────── │
  │  function getX(p) { return p.x; }                                │
  │  getX({x:1, y:2});  // shape A → monomorphique                   │
  │  getX({y:2, x:1});  // shape B → polymorphique → DEOPT possible  │
  │                                                                   │
  │  PROTOTYPE CHAIN MODIFICATION                                     │
  │  ─────────────────────────────────────────────────────────────── │
  │  const obj = { x: 1 };                                           │
  │  // ... TurboFan optimise l'accès à obj.x ...                     │
  │  Object.setPrototypeOf(obj, newProto); // → DEOPT lazy            │
  │                                                                   │
  │  ARGUMENTS OBJECT                                                 │
  │  ─────────────────────────────────────────────────────────────── │
  │  function old() {                                                 │
  │    var args = Array.prototype.slice.call(arguments);              │
  │    // L'objet arguments "fuit" → TurboFan ne peut pas optimiser  │
  │  }                                                                │
  │  // Préférer : function modern(...args) { }                       │
  │                                                                   │
  │  eval() ET with                                                   │
  │  ─────────────────────────────────────────────────────────────── │
  │  function bad() {                                                 │
  │    eval("x = 42"); // Le scope devient dynamique                  │
  │  }                                                                │
  │  // V8 ne peut pas optimiser le scope → pas de TurboFan           │
  │                                                                   │
  │  delete SUR UN OBJET (voir Module 11 pour le détail)              │
  │  ─────────────────────────────────────────────────────────────── │
  │  const obj = { x: 1, y: 2 };                                     │
  │  delete obj.x; // → dictionary mode → DEOPT                      │
  └───────────────────────────────────────────────────────────────────┘
```

### 9. Background Compilation : TurboFan compile en arrière-plan

Depuis V8 6.6 (Chrome 66, 2018), TurboFan compile sur des **threads d'arrière-plan**, ce qui réduit les pauses sur le thread principal.

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  BACKGROUND COMPILATION                                            │
  │                                                                   │
  │  Thread principal :                                               │
  │  ──────────────────────────────────────────────────────────────── │
  │  [exécute JS] ... [marque f() pour opt] ... [exécute JS] ...      │
  │                          │                       │                │
  │                          │                  [installe le          │
  │                          │                   code compilé]        │
  │                          │                       ▲                │
  │  Thread background :     │                       │                │
  │  ────────────────────────┼───────────────────────┼──────────────  │
  │                          ▼                       │                │
  │                    [TurboFan compile f()  ────────┘                │
  │                     en arrière-plan]                               │
  │                                                                   │
  │  Seules 2 étapes nécessitent le thread principal :                │
  │  1. Marquer la fonction pour optimisation (rapide)                │
  │  2. Installer le code compilé (rapide)                            │
  │                                                                   │
  │  Tout le travail lourd (construction du graphe, optimisations,    │
  │  allocation de registres, génération de code) se fait en          │
  │  arrière-plan. Le thread principal n'est quasiment pas bloqué.    │
  │                                                                   │
  │  Maglev compile aussi en arrière-plan depuis V8 12.x              │
  └───────────────────────────────────────────────────────────────────┘
```

### 10. Lire --trace-opt et --trace-deopt : guide pratique

Quand vous lancez `node --trace-opt --trace-deopt script.js`, la sortie peut faire des centaines de lignes. Voici comment s'y retrouver.

#### Sortie --trace-opt

```
  [marking 0x2f4a... <JSFunction add> for optimization to turbofan]
  [compiling method 0x2f4a... <JSFunction add> using TurboFan]
  [completed optimizing 0x2f4a... <JSFunction add>]

  Lecture :
  ┌────────────────────────────────────────────────────────────────┐
  │ "marking"   → V8 a décidé que la fonction est assez chaude     │
  │ "to turbofan" ou "to maglev" → le tier cible                  │
  │ "compiling" → TurboFan est en train de compiler (background)   │
  │ "completed" → le code machine est prêt et installé             │
  │                                                                │
  │ Si vous voyez "for on-stack replacement" → c'est un OSR        │
  └────────────────────────────────────────────────────────────────┘
```

#### Sortie --trace-deopt

```
  [deoptimizing (DEOPT eager): begin 0x2f4a... <JSFunction add>]
    ;;; deoptimize at <script.js:2:12>, not a Smi
  [deoptimizing (DEOPT eager): end ... -> 0x1234 (interpreter)]

  Lecture :
  ┌────────────────────────────────────────────────────────────────┐
  │ "DEOPT eager" → guard check échoué pendant l'exécution         │
  │ "DEOPT lazy"  → hypothèse invalidée par un événement externe   │
  │ "DEOPT soft"  → déopt volontaire pour recompiler               │
  │                                                                │
  │ "not a Smi"   → la valeur n'était pas un entier                │
  │ "wrong map"   → la Map de l'objet ne correspondait pas         │
  │ "insufficient type feedback" → feedback pas assez riche         │
  │                                                                │
  │ "at <script.js:2:12>" → fichier, ligne, colonne du problème   │
  └────────────────────────────────────────────────────────────────┘
```

#### Méthodologie de diagnostic en 4 étapes

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  DIAGNOSTIC DE PERFORMANCE JIT — 4 ÉTAPES                         │
  │                                                                   │
  │  1. Identifier les fonctions chaudes                               │
  │     node --trace-opt script.js 2>&1 | grep "completed"           │
  │     → quelles fonctions sont compilées par TurboFan/Maglev ?     │
  │                                                                   │
  │  2. Chercher les déoptimisations                                  │
  │     node --trace-deopt script.js 2>&1 | grep "deoptimizing"      │
  │     → quelles fonctions déoptimisent ? quelle raison ?           │
  │                                                                   │
  │  3. Chercher les fonctions abandonnées                            │
  │     node --trace-opt script.js 2>&1 | grep "disabled"            │
  │     → quelles fonctions ne seront plus jamais optimisées ?       │
  │                                                                   │
  │  4. Corréler avec le code source                                  │
  │     La trace donne le fichier:ligne:colonne                       │
  │     → aller voir le code à cet endroit                            │
  │     → corriger le type instable ou la Map divergente              │
  └───────────────────────────────────────────────────────────────────┘
```

### 11. L'optimisation `return await`

Depuis V8 7.3 (Chrome 73), `return await promise` est optimisé différemment de `return promise` dans une fonction async.

```js
// Version A : return await (recommandée dans les fonctions async)
async function fetchData() {
  try {
    return await fetch('/api/data');  // la stack trace inclut fetchData
  } catch (e) {
    // Le catch fonctionne correctement
    console.error(e);
  }
}

// Version B : return sans await
async function fetchData() {
  try {
    return fetch('/api/data');  // la stack trace NE contient PAS fetchData
  } catch (e) {
    // Le catch NE capture PAS les rejections de fetch !
    console.error(e);
  }
}
```

**Pourquoi `return await` est optimisé** :
- V8 détecte le pattern `return await expr` et le traite de façon spéciale : si `expr` résout avec une valeur, V8 court-circuite la création d'une Promise intermédiaire.
- Résultat : `return await` n'a pas de surcoût par rapport à `return` dans le cas succès, mais il préserve la stack trace et le try/catch.
- **Recommandation** : toujours utiliser `return await` dans une fonction async, surtout si elle est dans un try/catch.

> **Note (2025+)** : Turboshaft remplace progressivement le backend de TurboFan comme pipeline d'optimisation par defaut dans V8. L'architecture reste la meme (Ignition → bytecode → optimisation), mais le backend genere un code machine plus performant avec des temps de compilation reduits. Voir le Module 09 (section 7) et le [blog V8 sur Turboshaft](https://v8.dev/blog/turboshaft) pour les details.

---

## Démonstration

### Demo 1 : Observer l'optimisation et la déoptimisation

```js
// demo-opt-deopt.mjs
// Exécuter avec : node --trace-opt --trace-deopt demo-opt-deopt.mjs

function add(a, b) {
  return a + b;
}

// Phase 1 : chauffer la fonction avec des Smi
console.log('Phase 1 : chauffer avec des entiers...');
for (let i = 0; i < 100_000; i++) {
  add(i, i + 1);
}
// → [compiling method ... <JSFunction add> using TurboFan]
// → [completed optimizing ... <JSFunction add>]

// Phase 2 : provoquer une déoptimisation
console.log('\nPhase 2 : provoquer la déoptimisation...');
add("hello", " world"); // String au lieu de Smi !
// → [deoptimizing ... <JSFunction add>: not a Smi]

// Phase 3 : la fonction sera re-compilée avec un type feedback élargi
console.log('\nPhase 3 : re-optimisation...');
for (let i = 0; i < 100_000; i++) {
  add(i, i + 1);
}
// → [compiling method ... <JSFunction add> using TurboFan] (recompilation)
```

### Demo 2 : OSR en action

```js
// demo-osr.mjs
// Exécuter avec : node --trace-opt demo-osr.mjs

function longComputation() {
  let sum = 0;

  // Cette boucle va déclencher un OSR
  for (let i = 0; i < 10_000_000; i++) {
    sum += Math.sqrt(i) * 1.5;
  }

  return sum;
}

console.time('longComputation');
const result = longComputation();
console.timeEnd('longComputation');
console.log('Résultat :', result.toFixed(2));

// Dans --trace-opt :
// [compiling method ... for on-stack replacement]
// Le "on-stack replacement" confirme l'OSR
```

### Demo 3 : Escape Analysis en pratique

```js
// demo-escape-analysis.mjs
// Exécuter avec : node --trace-gc demo-escape-analysis.mjs

function distanceBetween(x1, y1, x2, y2) {
  // Ces objets NE s'échappent PAS → escape analysis les élimine
  const p1 = { x: x1, y: y1 };
  const p2 = { x: x2, y: y2 };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Chauffer pour déclencher TurboFan + escape analysis
for (let i = 0; i < 200_000; i++) {
  distanceBetween(i, i * 2, i + 1, (i + 1) * 2);
}

// Si escape analysis fonctionne : très peu de Scavenge dans --trace-gc
// Car les objets temporaires {x, y} ne sont jamais alloués sur le tas

// Comparaison : forcer l'échappement
function distanceLeaky(x1, y1, x2, y2) {
  const p1 = { x: x1, y: y1 };
  const p2 = { x: x2, y: y2 };
  leaked.push(p1);  // p1 s'échappe ! → allocation obligatoire
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

const leaked = [];
for (let i = 0; i < 200_000; i++) {
  distanceLeaky(i, i * 2, i + 1, (i + 1) * 2);
}
// → beaucoup plus de Scavenge dans --trace-gc
```

### Demo 4 : Le deopt limiter en action

```js
// demo-deopt-limiter.mjs
// Exécuter avec : node --trace-opt --trace-deopt demo-deopt-limiter.mjs

function unstableAdd(a, b) {
  return a + b;
}

// Provoquer des déoptimisations répétées en alternant les types
const types = [1, "a", 1.5, true, null, 1n, Symbol('s')];

for (let round = 0; round < 20; round++) {
  // Chauffer
  for (let i = 0; i < 50_000; i++) {
    unstableAdd(types[round % types.length], 1);
  }
  console.log(`Round ${round} terminé`);
}

// À un moment vous verrez dans la trace :
// [disabled optimization for ... unstableAdd]
// → V8 a abandonné et ne tentera plus d'optimiser cette fonction
```

### Demo 5 : Patterns de déoptimisation courants

```js
// demo-deopt-patterns.mjs
// Exécuter avec : node --trace-opt --trace-deopt demo-deopt-patterns.mjs

// === Pattern 1 : Changement de type ===
function addNumbers(a, b) {
  return a + b;
}

for (let i = 0; i < 100_000; i++) addNumbers(i, i);
console.log('addNumbers optimisée pour Smi');

addNumbers('not', 'a number'); // → DEOPT
console.log('addNumbers déoptimisée\n');

// === Pattern 2 : Overflow de Smi ===
function increment(x) {
  return x + 1;
}

for (let i = 0; i < 100_000; i++) increment(i);
console.log('increment optimisée pour Smi');

increment(2 ** 30 - 1); // OK sur 64-bit (Smi = 32 bits sur x64)
// Sur certaines builds 32-bit : overflow → HeapNumber → DEOPT
console.log('increment avec grande valeur\n');

// === Pattern 3 : eval() tue l'optimisation ===
function withEval(x) {
  eval('');  // même un eval vide empêche TurboFan
  return x * 2;
}

for (let i = 0; i < 100_000; i++) withEval(i);
// → Vous ne verrez PAS "compiling method ... withEval using TurboFan"
// car eval() empêche l'optimisation
console.log('withEval : jamais optimisée par TurboFan');
```

---

### V8 vs SpiderMonkey (Firefox)

Les concepts d'optimisation spéculative et de déoptimisation sont **universels** à tous les moteurs JS modernes. Seules la terminologie et l'implémentation interne diffèrent.

**Optimisation spéculative — comparaison :**

| Concept | V8 (TurboFan) | SpiderMonkey (WarpMonkey) | JSC (DFG/FTL) |
|---|---|---|---|
| Source du feedback de types | **Feedback Vectors** (slots dans le bytecode) | **CacheIR** (info de types capturée par les inline caches) | **Value profiles** + interprétation abstraite |
| Spéculation | Basée sur le feedback vector | Basée sur les stubs CacheIR | DFG utilise l'**interprétation abstraite** pour spéculer |
| Déoptimisation | « Deoptimization » (eager, lazy, soft) | « **Bailout** » (même concept, terminologie différente) | « OSR exit » |
| Flag de diagnostic | `--trace-opt`, `--trace-deopt` | `about:config` → `javascript.options.jit.full_debug_checks` | Pas de flag public équivalent |

**Points clés :**

- **WarpMonkey** (le compilateur optimisant de SpiderMonkey) fait également de l'**optimisation spéculative** : il parie sur les types observés et insère des guards. Si un guard échoue → **bailout** (équivalent de la déoptimisation V8).
- **CacheIR vs Feedback Vectors** : V8 collecte le feedback dans des structures dédiées (Feedback Vectors attachées à chaque fonction). SpiderMonkey, lui, capture les informations de types directement depuis les **stubs d'inline cache** (CacheIR). Le résultat est le même — les deux moteurs savent quels types ont été observés — mais le mécanisme de collecte diffère.
- **DFG de JSC** utilise une approche unique : l'**interprétation abstraite** (abstract interpretation). Il exécute symboliquement le bytecode pour inférer les types possibles, plutôt que de se baser uniquement sur le feedback runtime.
- **`--trace-opt` est spécifique à V8/Node.js.** Pour Firefox, le diagnostic JIT passe par `about:config` et des flags internes moins accessibles. En pratique, les développeurs Firefox utilisent le **Firefox Profiler** (profiler.firefox.com) pour observer les effets des optimisations.

> **À retenir** : tous les moteurs JS modernes font de l'optimisation spéculative + déoptimisation (ou bailout). Les principes que tu apprends ici avec V8 s'appliquent conceptuellement à SpiderMonkey et JSC — seule la terminologie change.

---

## Points clés

1. **La JIT de V8 repose sur la spéculation de types** : le code est optimisé pour les types observés dans le feedback. Si les types changent, le code est déoptimisé.

2. **Le type feedback** est collecté dans les Feedback Vectors par Ignition et consommé par Maglev et TurboFan pour spécialiser le code.

3. **L'inlining** est l'optimisation reine : elle élimine le coût d'appel et ouvre la porte à d'autres optimisations (escape analysis, constant folding). TurboFan a un budget d'inlining.

4. **L'escape analysis** élimine les allocations d'objets temporaires dans les hot loops — mais l'objet ne doit pas s'échapper de la fonction.

5. **OSR** permet d'optimiser une boucle chaude **pendant** son exécution, sans attendre le prochain appel.

6. **Il y a 3 types de déoptimisation** : eager (guard check échoué), lazy (hypothèse externe invalidée), et soft (recompilation volontaire).

7. **Le deopt limiter** empêche V8 de tenter indéfiniment d'optimiser une fonction instable — après ~10 deopts, la fonction est abandonnée.

8. **Background compilation** : TurboFan (et Maglev) compilent sur des threads d'arrière-plan, minimisant les pauses du thread principal.

9. **`return await`** dans une fonction async est optimisé par V8 et préserve la stack trace — c'est la forme recommandée.

10. **`--trace-opt` et `--trace-deopt`** sont les outils essentiels. La méthodologie : identifier les fonctions chaudes, repérer les deopts, corriger les types instables.

---

## Lab associé

**Lab 10 — Optimisation JIT en pratique**

Fichier : `labs/lab-10-jit-optimization/`

1. Écrire une fonction de traitement de données et la profiler avec `--trace-opt`. Confirmer qu'elle est compilée par TurboFan.
2. Introduire intentionnellement une déoptimisation (type change) et l'observer avec `--trace-deopt`.
3. Corriger le code pour maintenir des types monomorphiques. Mesurer la différence de performance.
4. Créer un benchmark qui provoque un OSR observable dans `--trace-opt`.
5. Implémenter un object pool pour une boucle chaude et mesurer la réduction de pression GC (moins de Scavenge dans `--trace-gc`).
6. Vérifier que l'escape analysis fonctionne : créer des objets temporaires dans une boucle et confirmer que TurboFan les élimine.

---

## Pour aller plus loin

- [V8 Docs — TurboFan JIT Design](https://v8.dev/docs/turbofan)
- [V8 Blog — Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan)
- [V8 Blog — Background compilation](https://v8.dev/blog/background-compilation)
- [V8 Blog — Faster async functions and promises](https://v8.dev/blog/fast-async)
- [Benedikt Meurer — Speculative Optimization in V8](https://benediktmeurer.de/2017/12/13/an-introduction-to-speculative-optimization-in-v8/)
- [Vyacheslav Egorov (mraleph) — V8 performance blog](https://mrale.ph)
- [V8 Blog — Turboshaft](https://v8.dev/blog/turboshaft)
- [V8 Source Code (official)](https://chromium.googlesource.com/v8/v8)

---

## Défi

### Défi 10 — La fonction qui ne veut pas être optimisée

Le code ci-dessous traite un tableau de transactions financières. Le développeur a mesuré que le throughput est 8x inférieur à ce qu'il devrait être. Utilisez vos connaissances en JIT pour trouver **tous les problèmes** (il y en a au moins 5).

```js
function processTransactions(transactions) {
  var results = [];

  for (var i = 0; i < transactions.length; i++) {
    var tx = transactions[i];

    var amount = tx.amount;
    if (tx.currency !== 'EUR') {
      amount = convertCurrency(tx.amount, tx.currency, 'EUR');
    }

    var fee = amount * tx.feeRate;
    var total = amount - fee;

    var result = {};
    result.id = tx.id;
    result.total = total;
    result.fee = fee;
    result.timestamp = Date.now();

    if (tx.type === 'international') {
      result.swiftCode = tx.swiftCode;
    }
    if (tx.priority === 'high') {
      result.expedited = true;
    }

    results.push(result);
  }

  return results;
}

const transactions = [];
for (let i = 0; i < 100000; i++) {
  const tx = {
    id: i,
    amount: Math.random() * 10000,
    currency: i % 3 === 0 ? 'USD' : 'EUR',
    feeRate: 0.015,
    type: i % 5 === 0 ? 'international' : 'domestic',
  };
  if (tx.type === 'international') {
    tx.swiftCode = 'BNPAFRPP';
  }
  if (i % 7 === 0) {
    tx.priority = 'high';
  }
  transactions.push(tx);
}
```

**Questions** :

1. Pourquoi l'objet `result` a-t-il des Hidden Classes différentes selon les transactions ? Combien de Hidden Classes distinctes sont créées ? (Voir Module 11 pour la théorie des Maps.)
2. Comment la création conditionnelle de `tx.swiftCode` et `tx.priority` affecte-t-elle les ICs ?
3. Réécrivez `processTransactions` pour que :
   - Tous les objets `result` partagent la même Hidden Class
   - Tous les objets `tx` partagent la même Hidden Class
   - Les types sont stables et monomorphiques
4. Mesurez la différence de performance avec `console.time()` / `console.timeEnd()`.
5. **Bonus** : vérifiez avec `--trace-opt --trace-deopt` que votre version corrigée ne produit aucune déoptimisation.
