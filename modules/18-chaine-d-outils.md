---
titre: La chaîne d'outils JavaScript
cours: 01-js-runtime
notions: [formateur et linter unifiés, Biome, oxlint, oxfmt, Rolldown, Vite+, coût d'une chaîne, règles partagées, migration depuis ESLint et Prettier, ce qu'un outil rapide ne règle pas]
outcomes: [arbitrer entre ESLint plus Prettier, Biome et oxlint sur des critères vérifiables, savoir ce que Rolldown change et ne change pas, défendre un choix d'outillage en revue de code]
prerequis: [16-features-du-langage-livrees]
next: ''
libs: []
tribuzen: la chaîne de qualité du dépôt TribuZen — un seul outil de formatage et de lint, et un bundler qu'on ne configure pas
last-reviewed: 2026-11
---

# La chaîne d'outils JavaScript

> **Outcomes, tu sauras FAIRE :** arbitrer entre ESLint plus Prettier, Biome et oxlint sur des
> critères vérifiables et non sur la mode, dire ce que Rolldown change et ce qu'il ne change pas,
> et défendre ce choix en revue de code.
> **Difficulté :** :star::star:

> **Pourquoi ce module existe ici.** Le relevé du 10/11/2026 sur les 24 cours du curriculum a
> montré qu'**aucun cours n'était propriétaire** des bundlers ni des linters : `vite` apparaît
> dans 81 fichiers du cours Vue et 68 du cours React, toujours comme outil **utilisé**, jamais
> enseigné. Ce module prend cette propriété, par défaut, parce que c'est le cours le plus proche.
> À déplacer si un cours d'outillage naît un jour.

> 📅 **Les chiffres de ce module sont datés de novembre 2026 et sourcés.** Un outillage bouge
> vite : la méthode d'arbitrage, elle, ne bouge pas. C'est elle qu'il faut retenir.

## 1. Cas concret d'abord

Le dépôt TribuZen a quatre fichiers de configuration de qualité : `.eslintrc`, `.prettierrc`,
un plugin d'intégration entre les deux, et un `lint-staged`. Le lint complet prend quarante
secondes, donc personne ne le lance avant de pousser, donc la CI casse une fois sur trois.

Un collègue propose de « passer à Biome, c'est cent fois plus rapide ». Trois questions avant de
répondre oui.

1. **Quelles règles on perd.** La vitesse n'est pas un argument si le nouvel outil ne sait pas
   faire ce que les règles actuelles font.
2. **Qui configure.** Quatre fichiers remplacés par un, c'est un gain réel et mesurable.
3. **Ce que ça ne règle pas.** Un linter rapide ne rend pas le code juste. Il rend le retour
   rapide.

Ce module donne de quoi répondre aux trois.

## 2. Théorie complète, concise

### 2.1 Ce qu'une chaîne de qualité fait, et dans quel ordre

Quatre fonctions distinctes, souvent confondues :

| Fonction | Question | Outils |
|---|---|---|
| **Formater** | la mise en forme est-elle uniforme ? | Prettier, Biome, oxfmt |
| **Linter** | ce code contient-il un motif connu pour être faux ? | ESLint, Biome, oxlint |
| **Vérifier les types** | les types sont-ils cohérents ? | `tsc`, et lui seul |
| **Empaqueter** | comment livrer tout ça au navigateur ? | Vite, Rolldown, esbuild, webpack |

La confusion la plus coûteuse est entre les deux premières : un formateur ne trouve **aucun
bug**, et un linter ne doit **pas** se mêler de mise en forme, sous peine de conflits. C'est la
raison d'être du plugin d'intégration ESLint-Prettier, et la raison pour laquelle un outil
unifié supprime le problème au lieu de l'arbitrer.

### 2.2 Biome

**Ce que c'est :** un outil unique qui formate et qui lint. En novembre 2026, la version
annoncée est **2.6**, avec **767 règles** reprises d'ESLint, de TypeScript ESLint et d'autres
sources, et **97 % de compatibilité avec Prettier** sur le formatage. Il couvre JavaScript,
TypeScript, JSX, JSON, HTML, CSS, SCSS, GraphQL, YAML et Markdown.
Source : <https://biomejs.dev>.

**Ce qu'il remplace :** ESLint, Prettier, et le plugin qui les réconcilie. Donc trois
configurations par une.

**Ce qu'il ne fait pas :** la vérification de types. `tsc --noEmit` reste nécessaire, et c'est
vrai de tous les outils de cette famille.

**La question à poser avant de migrer :** la liste de tes règles actuelles est-elle couverte ?
Une migration se mesure, elle ne s'espère pas :

```bash
# Combien de regles ton ESLint applique-t-il reellement ?
npx eslint --print-config src/index.ts | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Object.keys(JSON.parse(s).rules||{}).length,'regles actives'))"
```

### 2.3 oxlint, et la famille Oxc

**Ce que c'est :** un linter bâti sur la pile de compilation Oxc, en Rust. En novembre 2026 :
**plus de 870 règles**, et un facteur de vitesse annoncé de **50 à 100 fois** par rapport à
ESLint. Adopté par des projets de taille, dont Kibana, Sentry, Electron et Renovate. Il accepte
des **plugins JavaScript compatibles avec l'écosystème ESLint**, et propose un lint **conscient
des types** en s'appuyant sur le portage Go du compilateur TypeScript, ce qui permet par exemple
de détecter une promesse non attendue.
Source : <https://oxc.rs>.

**oxfmt** est le formateur de la même famille.

**Le point d'arbitrage avec Biome** n'est donc pas la vitesse, les deux étant très rapides. C'est
la **couverture de règles** et la **compatibilité des plugins** : si ta base dépend de plugins
ESLint spécifiques, oxlint les accepte, ce qui réduit le coût de migration.

### 2.4 Rolldown

**Ce que c'est :** un bundler en Rust, avec une **API compatible Rollup** et une parité de
fonctionnalités avec esbuild. Il est annoncé comme **le bundler unifié de Vite 8 et au-delà**.
Sur un test de 19 000 modules publié par le projet : **1,61 s**, contre 1,70 s pour esbuild et
40,10 s pour la combinaison Rollup plus esbuild.
Source : <https://rolldown.rs>.

**Ce que ça change pour toi :** probablement rien à écrire. Vite utilisait déjà esbuild en
développement et Rollup en production, c'est-à-dire **deux** bundlers aux comportements
légèrement différents. Rolldown unifie les deux, donc supprime une classe de bugs du type « ça
marche en dev, pas en build ».

**Ce que ça ne change pas :** ta configuration Vite, tes plugins, ton code. C'est une
substitution interne, et c'est précisément pour cela qu'elle est intéressante : un gain sans
migration.

### 2.5 Vite+

**Ce que c'est :** une chaîne unifiée publiée par VoidZero, qui réunit Vite, Vitest, oxlint,
oxfmt, Rolldown et tsdown derrière un point d'entrée unique, avec des commandes du type
`vp dev`, `vp build` et `vite test`. Passée d'alpha en mars 2026 à bêta en juillet 2026, sous
licence MIT.
Source : <https://voidzero.dev/posts/announcing-vite-plus-beta>.

**Ce que ça ne remplace pas :** l'écosystème Vite. Les plugins restent des plugins Vite.

**La décision, en appliquant la grille du cours 25 module 21 :** question 3, est-ce que ça
remplace du code existant ? Oui, une partie de la configuration. Question 2, le repli coûte-t-il
plus cher que le gain ? Sur un projet existant qui fonctionne, oui pour l'instant : une bêta de
chaîne complète est un pari d'infrastructure, pas une amélioration progressive. **À suivre, et à
essayer sur un projet neuf** avant de l'envisager sur TribuZen.

### 2.6 Ce qu'un outil rapide ne règle pas

Le point qui compte en revue de code, et qui fait la différence entre répéter une annonce et
comprendre un choix.

- **Un linter ne trouve que des motifs connus.** Il ne connaît pas ton domaine, donc il ne
  trouvera jamais une règle métier violée.
- **Un formateur ne lit pas.** Un code parfaitement formaté peut être incompréhensible.
- **Ni l'un ni l'autre ne vérifie les types.** `tsc` reste la seule autorité.
- **La vitesse change un usage, pas une qualité.** Un lint de quarante secondes n'est pas lancé,
  donc il ne sert à rien. Un lint d'une seconde est lancé à chaque sauvegarde, donc il attrape
  les erreurs au moment où elles coûtent le moins. **C'est là le vrai gain, et il est
  comportemental.**

C'est la réponse à donner en revue : on ne migre pas pour un chiffre de benchmark, on migre pour
que l'outil soit réellement utilisé.

## 3. Worked examples

### Exemple 1 — Mesurer avant de migrer

```bash
# 1. Combien de temps prend la chaine actuelle, a froid ?
time npx eslint . --ext .ts,.tsx
time npx prettier --check .

# 2. Combien de regles sont reellement actives ?
npx eslint --print-config src/index.ts > /tmp/config-eslint.json

# 3. Essayer le candidat SANS rien supprimer
npx @biomejs/biome check . > /tmp/biome.txt 2>&1 || true
npx oxlint . > /tmp/oxlint.txt 2>&1 || true

# 4. Comparer ce qui est signale de part et d'autre
```

La décision se prend sur l'écart constaté à l'étape 4, pas sur l'étape 1. Un outil qui va
cinquante fois plus vite en signalant la moitié des choses n'est pas un gain.

### Exemple 2 — La chaîne de TribuZen, telle qu'elle est décidée

Un seul outil de formatage et de lint, et un bundler qu'on ne configure pas.

```json
{
  "scripts": {
    "verif": "npm run verif:types && npm run verif:qualite && npm run verif:tests",
    "verif:types": "tsc --noEmit",
    "verif:qualite": "biome check .",
    "verif:tests": "vitest run"
  }
}
```

Trois commandes, trois autorités distinctes, dans l'ordre du moins cher au plus cher. Un hook de
pré-commit ne lance que `verif:qualite` sur les fichiers modifiés ; la CI lance les trois sur
tout.

Et le point de méthode qui vaut plus que le choix d'outil : **la CI et le poste de travail
lancent la même commande.** Une CI qui vérifie autre chose que ce que tu peux lancer chez toi
produit des échecs qu'on ne sait pas reproduire.

## 4. Pièges & misconceptions

### PIÈGE #1 — Migrer pour un chiffre de benchmark

La vitesse n'a de valeur que si elle change l'usage. Si le lint était déjà lancé à chaque
sauvegarde, passer de deux à une seconde ne change rien.

### PIÈGE #2 — Croire qu'un linter remplace `tsc`

Aucun de ces outils ne vérifie les types au sens de TypeScript. oxlint propose un lint conscient
des types, ce qui est autre chose : il exploite l'information de type pour des règles, il ne
valide pas ton programme.

### PIÈGE #3 — Garder ESLint et Prettier « pour les règles manquantes »

C'est le pire des deux mondes : deux chaînes à maintenir, et les conflits de formatage
reviennent. Si des règles manquent, soit on les attend, soit on reste, mais on ne cumule pas.

### PIÈGE #4 — Confondre Rolldown et une migration

Rolldown est une substitution **interne** à Vite. Il n'y a pas de migration à faire, et c'est
tout son intérêt.

### PIÈGE #5 — Adopter une bêta de chaîne complète sur un projet qui marche

Vite+ est une bêta. Sur un projet existant, le repli coûte plus cher que le gain, et la question
2 de la grille répond donc non. Sur un projet neuf, l'essai est légitime.

### PIÈGE #6 — Laisser la CI vérifier autre chose que le poste de travail

Produit des échecs non reproductibles, donc des contournements. Même commande des deux côtés.

## 5. Ancrage TribuZen

La chaîne de qualité du dépôt est : `tsc --noEmit` pour les types, un outil unifié pour le
formatage et le lint, `vitest` pour les tests. Trois commandes, et la même en local et en CI.

Le choix de l'outil unifié se fait par la mesure de l'exemple 1, pas par préférence. Et il est
réversible : la configuration tient dans un fichier.

## 6. Points clés

- Quatre fonctions distinctes : formater, linter, vérifier les types, empaqueter. Un outil
  unifié supprime le conflit entre les deux premières.
- **Aucun** de ces outils ne remplace `tsc`.
- Biome et oxlint se départagent sur la **couverture de règles** et la **compatibilité des
  plugins**, pas sur la vitesse.
- Rolldown unifie les deux bundlers que Vite utilisait, donc supprime les écarts entre
  développement et production. Aucune migration à faire.
- Vite+ est une bêta : à essayer sur un projet neuf, pas sur un projet qui marche.
- **Le vrai gain de la vitesse est comportemental** : un outil rapide est lancé, donc il sert.
- Une migration se **mesure** : comparer ce qui est signalé de part et d'autre, pas les
  chronomètres.

## 7. Seeds Anki

Question|Réponse
---|---
Quelles sont les quatre fonctions d'une chaîne de qualité ?|Formater, linter, vérifier les types, empaqueter. Les deux premières sont les plus souvent confondues.
Pourquoi un outil unifié supprime-t-il le plugin ESLint-Prettier ?|Parce que le conflit entre lint et formatage n'existe plus : un seul outil décide.
Qu'est-ce qu'aucun de ces outils ne fait ?|Vérifier les types. `tsc --noEmit` reste la seule autorité.
Sur quoi se départagent Biome et oxlint ?|La couverture de règles et la compatibilité des plugins ESLint existants. Pas la vitesse, les deux sont très rapides.
Que change Rolldown pour un projet Vite existant ?|Rien à écrire : c'est une substitution interne. Il unifie les deux bundlers utilisés en dev et en build, donc supprime les écarts entre les deux.
Quel est le vrai gain d'un linter rapide ?|Comportemental : un lint de quarante secondes n'est pas lancé, un lint d'une seconde l'est à chaque sauvegarde.
Comment décide-t-on d'une migration d'outillage ?|En comparant ce que chaque outil SIGNALE sur la même base, pas en comparant les chronomètres.
Pourquoi ne pas adopter Vite+ sur TribuZen aujourd'hui ?|C'est une bêta de chaîne complète : sur un projet qui marche, le repli coûte plus cher que le gain.

## Pont vers le lab

Aucun lab dédié. Le geste de ce module est une **mesure** puis une **décision**, et il se fait
sur un vrai dépôt : lance l'exemple 1 sur TribuZen, consigne l'écart constaté, et écris la
décision dans un ADR du dépôt. Le correcteur juge l'ADR, pas l'outil choisi.
