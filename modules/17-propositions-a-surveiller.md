---
titre: Les propositions à surveiller
cours: 01-js-runtime
notions: [processus TC39, étapes d'une proposition, Temporal, décorateurs, pattern matching, opérateur de pipeline, signaux, AsyncContext, structs, ShadowRealm, import defer, Iterator.zip et concat, grille de décision]
outcomes: [savoir parler d'une proposition sans l'utiliser, appliquer une grille de décision à une feature non livrée, reconnaître ce qui remplace un contournement coûteux, vérifier soi-même l'étape réelle d'une proposition]
prerequis: [16-features-du-langage-livrees]
next: 18-chaine-d-outils
libs: []
tribuzen: aucune. Ce module existe pour décider de NE PAS utiliser quelque chose, et savoir dire pourquoi
last-reviewed: 2026-11
---

# Les propositions à surveiller

> **Outcomes, tu sauras FAIRE :** parler d'une proposition en entretien sans l'avoir utilisée,
> appliquer une grille de décision à une feature non livrée, et reconnaître les deux ou trois
> propositions qui supprimeront du code existant plutôt que d'ajouter une possibilité.
> **Difficulté :** :star::star:

> **L'objectif de ce module est inhabituel : il sert à décider de ne PAS utiliser quelque chose,
> et à savoir dire pourquoi.** C'est une compétence d'entretien autant que de métier.

## 1. Cas concret d'abord

En entretien, on te demande ce que tu penses du pattern matching en JavaScript. Trois réponses
possibles.

- « Je ne connais pas. » Honnête, et c'est tout.
- « C'est génial, je l'utilise déjà. » Faux, et vérifiable en trente secondes.
- « C'est une proposition qui n'est pas finalisée. Elle remplacerait des chaînes de `if` sur la
  forme des données, ce qu'on écrit aujourd'hui avec des unions discriminées et un `switch`. Je
  ne l'utilise pas : la syntaxe peut encore changer, et le gain ne justifie pas de dépendre d'un
  transpileur pour ça. Je la suis parce que le jour où elle arrive, elle supprimera du code. »

La troisième réponse est ce que ce module produit.

## 2. Théorie complète, concise

### 2.1 Le processus, en une minute

Une proposition traverse des étapes numérotées de 0 à 4, de l'idée à l'intégration dans la
norme. Ce qu'il faut en retenir tient en trois points :

- avant l'avant-dernière étape, **la syntaxe peut changer**, donc le code écrit avec est à
  réécrire ;
- la dernière étape signifie « dans la norme », pas « dans ton navigateur » : la livraison des
  moteurs suit, avec son propre calendrier ;
- une proposition peut **reculer**, ou être abandonnée après des années.

**L'étape d'une proposition se vérifie, elle ne se retient pas.** La liste officielle est le
dépôt `tc39/proposals` sur GitHub, et chaque proposition a son propre dépôt avec son état. Tout
chiffre d'étape écrit dans un cours est périmé à la lecture : c'est pourquoi ce module n'en cite
aucun.

### 2.2 La grille de décision, rappelée

Celle du cours 25, module 21, s'applique telle quelle. Cinq questions :

1. **Qu'est-ce qui se passe chez celui qui ne l'a pas ?**
2. **Est-ce que le repli coûte plus cher que le gain ?**
3. **Est-ce que ça remplace du code existant, ou ça en ajoute ?**
4. **Est-ce que ça demande une permission, et que fait-on du refus ?** (sans objet pour le
   langage)
5. **Est-ce que ça change l'accessibilité ou la vie privée ?** (sans objet ici aussi)

Pour une feature de langage, la question 1 a une réponse brutale : **une erreur de syntaxe**. Il
n'y a pas d'amélioration progressive possible sur de la grammaire. Soit le moteur comprend, soit
le fichier entier ne se charge pas. D'où la seule voie d'adoption anticipée : un transpileur, ce
qui déplace la question sur la 2.

## 3. Les propositions, classées par décision

### 3.1 Celles qui remplaceront du code, à suivre activement

**Temporal.** Remplace l'objet `Date`, dont les défauts sont connus depuis vingt ans : mutabilité,
mois indexés à zéro, fuseaux horaires impraticables, pas d'arithmétique de durée. Remplace aussi
les bibliothèques de dates, qui pèsent entre dix et soixante kilo-octets.

C'est la proposition la plus importante du lot, et la plus avancée : certains moteurs la livrent
déjà. **Vérifier avant d'y toucher**, puis l'adopter dès qu'elle est partout, parce que le gain
est une suppression de dépendance.

```bash
node -e "console.log(typeof Temporal !== 'undefined' ? 'disponible' : 'absent')"
```

**Les décorateurs, et leurs métadonnées.** Déjà utilisés en pratique via TypeScript, et le cours
`00-typescript` les traite au lab 14. Le point à savoir : la version TypeScript historique et la
proposition normalisée **ne sont pas la même chose**, et un projet NestJS repose sur la première.
Savoir laquelle on utilise est une question d'entretien fréquente.

**`import defer` et les imports de phase source.** Permettent de charger un module sans
l'évaluer, donc de payer le coût au premier usage. Remplacent des `import()` dynamiques écrits à
la main pour la même raison. Utile sur une application lourde au démarrage.

**`Iterator.zip` et `Iterator.concat`.** Prolongent les helpers du module 16. Remplacent des
boucles d'index écrites à la main, avec leur lot d'erreurs de bornes.

### 3.2 Celles dont on parle beaucoup, et qui changeraient l'écriture

**Le pattern matching.** Une expression qui branche sur la **forme** d'une donnée, pas seulement
sur une valeur. Ce qu'on écrit aujourd'hui avec une union discriminée et un `switch` exhaustif,
voir `00-typescript` module 04. Le gain serait réel sur du code qui traite des messages ou des
états.

**L'opérateur de pipeline.** Écrire `valeur |> f |> g` au lieu de `g(f(valeur))`. Débat long sur
la forme exacte. Gain de lisibilité, zéro gain fonctionnel : à ce titre, la question 3 de la
grille répond « ça ajoute », donc patience.

**Les signaux.** Un modèle de réactivité fine, c'est-à-dire ce que Vue, Angular et Solid
implémentent chacun à leur façon. Normaliser le mécanisme permettrait aux frameworks de partager
une base. À suivre parce que l'enjeu dépasse le langage, mais sans impact sur ton code tant que
ton framework ne l'expose pas.

**`AsyncContext`.** Propager un contexte à travers des frontières asynchrones, ce qui est le
problème que `AsyncLocalStorage` résout aujourd'hui côté Node. Intéressant pour la traçabilité
d'une requête, sujet du cours 15 Observabilité.

### 3.3 Celles qui ne concernent presque personne

**Les structs et les objets partagés.** Mémoire partagée entre travailleurs avec un modèle
d'objet, pour du parallélisme réel. Public visé : les moteurs de jeu, le calcul lourd. Pas une
application métier.

**`ShadowRealm`.** Exécuter du code dans un contexte isolé, sans navigateur autour. Son parcours
a été accidenté. Pour isoler du code non fiable aujourd'hui, la réponse est un bac à sable
d'infrastructure, voir le cours 14 Sécurité.

**Les clés composites, les extracteurs, l'objet observable, l'accès à la source d'un
`JSON.parse`, le découpage d'itérateurs.** Chacune règle un problème précis et peu fréquent.
Les connaître de nom suffit.

## 4. Pièges & misconceptions

### PIÈGE #1 — Confondre « dans la norme » et « dans mon runtime »

La dernière étape du processus signifie que le texte est accepté. Les moteurs livrent ensuite, à
leur rythme, et les versions de Node suivent les versions de V8. La seule vérification qui vaut
est celle qu'on lance sur sa cible.

### PIÈGE #2 — Adopter par transpileur « en attendant »

Le transpileur rend la feature utilisable, et crée deux dettes : le code est écrit dans une
syntaxe qui peut encore changer, et la chaîne de build devient un prérequis pour lire le projet.
Acceptable pour les décorateurs, qui sont stables dans l'écosystème TypeScript depuis longtemps.
Douteux pour une proposition en débat.

### PIÈGE #3 — Croire qu'une proposition célèbre est avancée

La notoriété d'une proposition ne dit rien de son état. Le pattern matching et l'opérateur de
pipeline sont très commentés et peu avancés ; les helpers d'itérateurs du module 16 ont été
livrés dans une relative discrétion.

### PIÈGE #4 — Ignorer qu'une proposition peut reculer

Écrire du code sur une proposition non finalisée, c'est accepter de le réécrire. C'est un choix
légitime sur un projet personnel, pas sur une base de code partagée.

## 5. Ancrage TribuZen

Aucun. C'est voulu, et c'est le seul module du curriculum dans ce cas.

La décision tenue pour TribuZen est : **aucune proposition non finalisée dans le code**, à la
seule exception des décorateurs, que NestJS impose de fait. Temporal entrera le jour où il est
disponible partout, et il remplacera alors du code existant plutôt que d'en ajouter.

## 6. Points clés

- Pour une feature de **langage**, l'absence ne dégrade pas : elle casse. Il n'y a pas
  d'amélioration progressive sur de la grammaire.
- La seule voie d'adoption anticipée est le transpileur, ce qui déplace la question sur le coût
  du repli.
- Le filtre utile est la question 3 de la grille : **qu'est-ce qui me permet de supprimer du
  code ?** Temporal oui, le pipeline non.
- L'étape d'une proposition se **vérifie** sur `tc39/proposals`. Aucun chiffre d'étape n'est
  écrit dans ce module, parce qu'il serait faux à la lecture.
- Savoir dire pourquoi on **n'utilise pas** une feature est une compétence, pas un aveu.

## 7. Seeds Anki

Question|Réponse
---|---
Que se passe-t-il chez quelqu'un dont le moteur ne connaît pas une syntaxe nouvelle ?|Une erreur de syntaxe, et le fichier entier ne se charge pas. Pas de dégradation progressive possible.
Quelle proposition supprimerait le plus de code existant, et pourquoi ?|Temporal : elle remplace `Date` et les bibliothèques de dates, donc une dépendance entière.
Où vérifier l'état réel d'une proposition ?|Le dépôt `tc39/proposals` et le dépôt propre de la proposition. Jamais un cours : le chiffre y est périmé.
Pourquoi les décorateurs sont-ils un cas à part ?|La version TypeScript historique et la proposition normalisée diffèrent, et NestJS repose sur la première.
Quel filtre appliquer pour décider de suivre une proposition ?|La question 3 : est-ce que ça remplace du code existant, ou est-ce que ça en ajoute ?
Que répondre en entretien sur le pattern matching ?|Que c'est une proposition non finalisée, qu'elle remplacerait les unions discriminées plus `switch`, et qu'on ne l'utilise pas parce que la syntaxe peut changer.

## Pont vers le lab

Aucun lab. Ce module ne produit pas un geste, il produit une décision et un vocabulaire. Son
contrôle est oral : le correcteur peut demander, pour une proposition tirée au hasard, ce qu'elle
remplacerait et pourquoi tu ne l'utilises pas.
