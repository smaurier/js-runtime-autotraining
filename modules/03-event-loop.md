---
titre: L'event loop
cours: 01-js-runtime
notions: [JS single-threaded, concurrence via event loop, call stack, task queue, APIs asynchrones fournies par le host, Web APIs navigateur, libuv Node, setTimeout(0) n'est pas 0, rendering et event loop, navigateur vs Node]
outcomes: [expliquer pourquoi JS mono-thread reste non-bloquant, tracer call stack + task queue + event loop sur un extrait, prédire l'ordre d'exécution d'un code mêlant sync et setTimeout]
prerequis: [02-scope-closures-memory]
next: 04-microtasks-macrotasks
libs: []
tribuzen: couche runtime de l'API TribuZen — ordonnancement des handlers et tâches différées côté Node
last-reviewed: 2026-07
---

# L'event loop

> **Outcomes — tu sauras FAIRE :** expliquer pourquoi un JS mono-thread reste non-bloquant, tracer call stack + task queue + event loop sur un extrait de code, prédire l'ordre d'exécution d'un code mêlant synchrone et `setTimeout`.
> **Difficulté :** :star::star::star:

## 1. Cas concret d'abord

Tu écris un handler dans l'API TribuZen (Node/Express). Quand un membre rejoint une famille, tu veux répondre tout de suite au client, puis envoyer un e-mail de bienvenue « juste après ». Un collègue a écrit ceci :

```js
// POST /families/:id/join — handler TribuZen
app.post('/families/:id/join', (req, res) => {
  console.log('1. début handler');

  setTimeout(() => {
    console.log('4. envoi e-mail de bienvenue');
    sendWelcomeEmail(req.body.email);
  }, 0); // "0ms => tout de suite", pense le collègue

  console.log('2. réponse envoyée au client');
  res.json({ joined: true });

  console.log('3. fin handler');
});
```

Le collègue s'attend à l'ordre `1, 4, 2, 3` — « le timer est à 0 ms, donc il part immédiatement ». La console affiche en réalité :

```
1. début handler
2. réponse envoyée au client
3. fin handler
4. envoi e-mail de bienvenue
```

Le `setTimeout(…, 0)` ne s'exécute **pas** au milieu du handler. Il attend que **toute** la fonction synchrone soit finie, que la call stack soit vide, avant d'être repris. Ce module explique pourquoi — et qui, exactement, décide de ce « plus tard ». Indice : ce n'est pas le moteur JavaScript.

---

## 2. Théorie complète, concise

### 2.1 JS est single-threaded

Un runtime JavaScript exécute ton code sur **un seul thread** : il y a une seule **call stack**, donc une seule chose s'exécute à un instant donné. Pas de parallélisme au niveau de ton code JS. Si une fonction tourne, rien d'autre ne tourne en même temps.

```js
function a() { b(); }
function b() { c(); }
function c() { console.log('au fond de la pile'); }

a();
// call stack empilée : a -> b -> c, puis dépilée c -> b -> a
```

Conséquence directe : **du code synchrone lourd bloque tout**. Une boucle qui tourne 5 secondes gèle le thread pendant 5 secondes — aucun autre code ne peut s'exécuter, aucun clic traité, aucune requête servie.

### 2.2 Alors comment JS fait-il des choses « en même temps » ?

C'est le paradoxe apparent : un thread unique, mais des milliers d'opérations I/O concurrentes (requêtes réseau, lectures de fichiers, timers). La réponse tient en un mot : **délégation**.

Le moteur JS (V8 dans Chrome et Node) ne sait faire qu'une chose : exécuter du JavaScript synchrone. Les opérations longues (attendre le réseau, lire un fichier, compter un délai) **ne sont pas exécutées par le moteur JS**. Elles sont déléguées à l'**environnement hôte** :

- Dans le **navigateur** : les **Web APIs** (fournies par le navigateur, pas par le moteur JS) — `setTimeout`, `fetch`, événements DOM, `XMLHttpRequest`…
- Dans **Node.js** : **libuv**, une bibliothèque écrite en C qui gère les timers, l'I/O disque/réseau via un thread pool et les APIs asynchrones de l'OS.

Le moteur JS se contente de :

1. enregistrer un callback,
2. confier l'opération longue à l'hôte,
3. continuer son code synchrone sans attendre,
4. récupérer le résultat plus tard, via le callback.

```
  Ton code JS (1 thread)            HÔTE (Web APIs / libuv) — hors du moteur JS
  ======================            ============================================
  setTimeout(cb, 100)   -enregistre-> minuteur compte 100 ms (en parallèle)
  fetch(url)            -délègue----> requête réseau via l'OS
  ...code sync continue...            ...travail de fond, ne bloque pas le thread JS...
  callback exécuté  <---quand prêt--- l'hôte pousse le callback dans la task queue
```

### 2.3 Les trois pièces : call stack, task queue, event loop

Trois éléments collaborent. **Point crucial d'audit : un seul des trois est dans le moteur JS.**

| Pièce | Rôle | Qui la fournit |
|---|---|---|
| **Call stack** | Empile les appels de fonction en cours. Une par thread. | Le moteur JS (V8) |
| **Task queue** (callback / macrotask queue) | File d'attente des callbacks prêts à être exécutés. | L'**hôte** (navigateur / Node) |
| **Event loop** | Boucle qui surveille la pile ; dès qu'elle est vide, prend le prochain callback de la file et le pousse sur la pile. | L'**hôte** (navigateur / libuv) — **PAS V8** |

> **À retenir absolument :** l'event loop **n'est pas dans le moteur JavaScript**. V8 ne connaît pas l'event loop : il exécute des fonctions et vide sa pile. C'est l'**hôte** (le navigateur, ou libuv pour Node) qui fournit l'event loop, la task queue, et toutes les APIs asynchrones. Le même moteur V8 tourne dans Chrome et dans Node, mais l'event loop et les APIs async diffèrent car l'hôte diffère.

L'algorithme de l'event loop, en version simplifiée :

```
répéter à l'infini :
  1. exécuter tout le code synchrone jusqu'à ce que la call stack soit VIDE
  2. la pile est vide ? prendre le prochain callback prêt dans la task queue
  3. le pousser sur la pile et l'exécuter (retour à l'étape 1)
```

La règle d'or : **l'event loop ne prend un callback dans la file QUE quand la call stack est complètement vide.** Un callback n'interrompt jamais du code synchrone en cours.

### 2.4 Dérouler le cas concret

Reprenons le handler du §1 :

1. `console.log('1…')` — synchrone, s'exécute, se dépile.
2. `setTimeout(cb, 0)` — le moteur JS **délègue** à l'hôte : « minuteur de 0 ms, puis mets `cb` dans la task queue ». Le moteur **ne s'arrête pas**, il continue.
3. `console.log('2…')` puis `res.json()` puis `console.log('3…')` — tout le reste du code synchrone s'exécute.
4. Le handler retourne. La call stack se vide.
5. **Maintenant seulement**, l'event loop voit la pile vide, prend `cb` dans la task queue et l'exécute → `console.log('4…')`.

Le timer était « prêt » depuis longtemps, mais il a dû **attendre la fin du synchrone**. D'où l'ordre `1, 2, 3, 4`.

### 2.5 `setTimeout(fn, 0)` n'est pas « 0 »

`setTimeout(fn, 0)` ne veut pas dire « exécute `fn` maintenant », ni même « exécute `fn` dans 0 ms ». Ça veut dire : **« mets `fn` dans la task queue une fois le délai écoulé ; elle sera reprise quand la pile sera vide »**. Deux raisons pour lesquelles ce n'est jamais vraiment 0 :

1. **La pile doit d'abord se vider.** Si du code synchrone prend 500 ms après le `setTimeout`, le callback attend 500 ms, pas 0.
2. **Le délai est « clampé » (minimum imposé).** La spec HTML impose un plancher de **4 ms** pour les timers imbriqués au-delà de 5 niveaux ; les onglets en arrière-plan sont ralentis (~1000 ms). Node clampe `setTimeout(fn, 0)` à **1 ms**.

`setTimeout(fn, 0)` est donc un idiome pour dire : **« exécute ça plus tard, après le code synchrone en cours »** — pas « immédiatement ».

### 2.6 Rendering et event loop (navigateur)

Dans le **navigateur**, l'event loop coordonne aussi le **rendu** (le repaint de l'écran). Le rendu s'intercale entre les tâches, quand le navigateur le juge nécessaire (typiquement ~toutes les 16 ms pour viser 60 fps) :

```
  navigateur, boucle simplifiée :
    1. exécuter UNE tâche de la task queue
    2. (les microtâches — détaillées au module 04)
    3. si le moment est venu de rafraîchir : style -> layout -> paint
    4. retour à 1.
```

Conséquence pratique : **le rendu ne peut pas se faire pendant qu'une tâche synchrone tourne.** Une boucle JS de 2 secondes gèle l'UI — pas de repaint, pas de scroll, pas de clic traité — car le navigateur ne peut repeindre qu'entre les tâches, et la pile n'est pas vide. C'est le fameux « la page ne répond plus ».

### 2.7 Navigateur vs Node : même principe, hôtes différents

Le concept est le même ; l'implémentation diffère car l'hôte diffère.

| Aspect | Navigateur | Node.js |
|---|---|---|
| Fournisseur de l'event loop | Le navigateur (Blink / Gecko) | **libuv** (C) |
| APIs asynchrones | Web APIs (`fetch`, DOM, `setTimeout`) | libuv + bindings (`fs`, `net`, `setTimeout`, `setImmediate`) |
| Rendu (paint) | Oui (DOM à l'écran) | Non (pas de DOM) |
| Structure de la boucle | Simple (une task queue + micro) | **6 phases** libuv (timers, poll, check…) |
| Extras | `requestAnimationFrame` | `setImmediate`, `process.nextTick` |

Node ajoute une granularité : libuv organise la boucle en **phases** (timers → pending → poll → check → close). On survole ici — le détail des phases et des microtâches / macrotâches est le sujet du **module 04**. Ce qu'il faut retenir maintenant : dans les deux cas, **c'est l'hôte, pas V8, qui fait tourner la boucle et fournit l'asynchrone**.

---

## 3. Worked examples

### Exemple 1 — Tracer call stack + task queue pas à pas

```js
console.log('A');

setTimeout(() => {
  console.log('B'); // délégué à l'hôte, repris plus tard
}, 0);

console.log('C');
```

Déroulé, pile et file à chaque étape :

```
étape 1 : console.log('A')       pile: [log]          file: []       -> affiche A
étape 2 : setTimeout(cb, 0)      pile: [setTimeout]   file: []
          -> l'hôte prend le relais : minuteur 0 ms puis dépose cb
          après ~1 ms, l'hôte :  pile: []             file: [cb]
étape 3 : console.log('C')       pile: [log]          file: [cb]     -> affiche C
étape 4 : pile VIDE              pile: []             file: [cb]
          -> event loop prend cb pile: [cb]           file: []       -> affiche B
```

**Sortie : `A`, `C`, `B`.** Bien que le timer soit à 0, `B` sort en dernier : le synchrone (`A`, `C`) passe toujours avant tout callback de la file.

### Exemple 2 — Le synchrone lourd retarde le timer (fading)

Même mécanique, mais on ajoute une contrainte : un calcul bloquant entre le `setTimeout` et la fin du code. Prédis avant de lire la réponse.

```js
console.log('début');

setTimeout(() => console.log('timer 0ms'), 0);

// calcul synchrone lourd : bloque le thread ~2 secondes
const fin = Date.now() + 2000;
while (Date.now() < fin) {
  // rien — on occupe le thread
}

console.log('fin du bloc synchrone');
```

Raisonnement :

1. `console.log('début')` s'exécute.
2. `setTimeout` délègue à l'hôte ; après ~1 ms le callback est **prêt dans la file**.
3. MAIS la call stack n'est **pas vide** : la boucle `while` tourne encore. L'event loop **ne peut rien prendre** tant que la pile n'est pas vide.
4. Au bout de 2 s, la boucle finit, `console.log('fin…')` s'exécute, la pile se vide.
5. Enfin l'event loop prend le callback → `console.log('timer 0ms')`.

**Sortie : `début`, `fin du bloc synchrone`, `timer 0ms`** — le timer « 0 ms » s'est exécuté après ~2 secondes. Le délai demandé est un **minimum**, jamais une garantie. C'est exactement le piège du handler TribuZen : un traitement synchrone lourd repousse toutes les tâches en attente.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « L'event loop est dans V8 / dans le moteur JS »

**Faux.** Le moteur JS (V8) ne fait qu'exécuter du JavaScript synchrone et gérer sa call stack. L'**event loop, la task queue et les APIs asynchrones sont fournis par l'HÔTE** : le navigateur, ou libuv pour Node. Preuve : le même V8 tourne dans Chrome et dans Node, pourtant `setImmediate` et `process.nextTick` n'existent que dans Node, et `requestAnimationFrame` / le DOM que dans le navigateur. Ce ne sont pas des fonctions du langage — ce sont des services de l'hôte.

### PIÈGE #2 — « `setTimeout(fn, 0)` exécute `fn` immédiatement »

**Faux.** `setTimeout(fn, 0)` planifie `fn` dans la task queue ; elle ne sera reprise que **quand la pile sera vide**, donc après tout le code synchrone en cours. Et le délai est clampé (min 1 ms Node, jusqu'à 4 ms navigateur). C'est un « exécute plus tard », jamais un « exécute maintenant ».

### PIÈGE #3 — « Le code asynchrone tourne en parallèle de mon code JS »

Nuance importante. Le **travail de fond** (attendre le réseau, lire un fichier, compter un timer) tourne bien en parallèle — mais **dans l'hôte** (Web APIs, thread pool libuv), **pas dans ton thread JS**. Ton **callback JavaScript**, lui, s'exécute toujours sur l'unique thread principal, un à la fois, jamais en parallèle d'un autre code JS. Le parallélisme est dans l'hôte, pas dans ton JS.

### PIÈGE #4 — « Un calcul lourd, c'est comme de l'I/O, ça ne bloque pas »

**Faux et dangereux.** L'I/O est délégué à l'hôte, donc non-bloquant. Mais un **calcul CPU synchrone** (grosse boucle, tri d'un énorme tableau, hachage) s'exécute **sur le thread JS** et **bloque tout** : dans le navigateur l'UI gèle, dans Node **toutes les requêtes attendent**. La solution n'est pas `setTimeout` (ça reste sur le même thread), mais de découper le travail ou de le déporter (Web Worker / `worker_threads`).

### PIÈGE #5 — « Navigateur et Node ont le même event loop »

Approximation trompeuse. Le **principe** est identique (pile vide → prendre un callback). Mais Node utilise **libuv** avec **6 phases** et des primitives propres (`setImmediate`, `process.nextTick`), tandis que le navigateur a une boucle plus simple qui gère en plus le **rendu**. Même idée, hôtes et détails différents (approfondis au module 04).

---

## 5. Ancrage TribuZen

L'API TribuZen tourne sous **Node**, donc son event loop est celui de **libuv** — c'est libuv qui ordonne les handlers HTTP, les requêtes Prisma vers PostgreSQL, les timers d'e-mails.

**Où ça compte concrètement :**

1. **Le `setTimeout` du cas concret** (`src/routes/families.ts`) — l'e-mail de bienvenue planifié « à 0 ms » ne part qu'une fois le handler terminé et la pile vide. Comprendre l'event loop, c'est savoir que « différer » ≠ « immédiatement », et ne pas s'étonner de l'ordre des logs.

2. **Un handler qui bloque l'event loop gèle l'API entière.** Si un endpoint TribuZen fait un calcul synchrone lourd — par exemple agréger en mémoire les statistiques d'activité de toutes les familles dans une grosse boucle — pendant ce calcul, **aucune autre requête n'est servie** : Node est mono-thread, la pile n'est jamais vide, l'event loop est à l'arrêt. Tous les membres connectés voient l'app « ramer ». Le réflexe : déléguer (job en arrière-plan, `worker_threads`, ou découper le calcul).

3. **Ordonner des tâches côté serveur.** Répondre vite au client, puis faire le travail non-urgent « après la réponse » (log analytics, notification, invalidation de cache) est un pattern courant. Comprendre que ces callbacks passent *après* le synchrone en cours est la base pour les ordonnancer correctement (le détail micro / macro et `setImmediate` vient au module 04).

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/src/
  routes/
    families.ts        # handler join + setTimeout e-mail
  services/
    stats.ts           # calcul d'agrégats — NE PAS bloquer l'event loop
```

---

## 6. Points clés

1. JavaScript est **single-threaded** : une seule call stack, une seule chose exécutée à la fois ; le code synchrone lourd bloque tout.
2. La concurrence vient de la **délégation** : les opérations longues sont confiées à l'**hôte**, pas exécutées par le moteur JS.
3. Les **APIs asynchrones** (`setTimeout`, `fetch`, `fs`…) sont fournies par l'**hôte** (Web APIs navigateur / libuv Node), **pas par le moteur JS**.
4. **L'event loop et la task queue ne sont PAS dans V8** : c'est l'hôte (navigateur / libuv) qui les fournit. V8 ne connaît que sa call stack.
5. Règle d'or : l'event loop ne prend un callback **que lorsque la call stack est vide** — un callback n'interrompt jamais du synchrone en cours.
6. `setTimeout(fn, 0)` = « plus tard, après le synchrone », pas « maintenant » ; le délai est clampé (1 ms Node, jusqu'à 4 ms navigateur) et attend la pile vide.
7. Dans le **navigateur**, le rendu (paint) s'intercale entre les tâches — un JS bloquant gèle l'UI.
8. **Navigateur vs Node** : même principe, hôtes différents. Node = libuv à 6 phases (`setImmediate`, `process.nextTick`) ; détail au module 04.

---

## 7. Seeds Anki

```
Combien de threads exécutent ton code JavaScript, et quelle en est la conséquence ?|Un seul (single-threaded) : une seule call stack, une chose à la fois. Conséquence : tout code synchrone lourd bloque le thread et gèle l'app.
Si JS est mono-thread, comment gère-t-il des milliers d'opérations I/O concurrentes ?|Par délégation : le moteur JS confie les opérations longues à l'hôte (Web APIs / libuv), continue son code synchrone, et récupère les résultats plus tard via des callbacks.
Qui fournit les APIs asynchrones comme setTimeout et fetch : le moteur JS ou l'hôte ?|L'hôte. Le navigateur fournit les Web APIs, Node fournit libuv. Ce ne sont PAS des fonctions du moteur JS (V8) ni du langage.
L'event loop est-il dans le moteur JavaScript (V8) ?|Non. V8 ne gère que la call stack et l'exécution du JS synchrone. L'event loop et la task queue sont fournis par l'hôte (navigateur / libuv). Le même V8 tourne dans Chrome et Node, mais l'event loop diffère car l'hôte diffère.
Quelle est la règle d'or de l'event loop vis-à-vis de la call stack ?|L'event loop ne prend un callback dans la task queue QUE lorsque la call stack est complètement vide. Un callback n'interrompt jamais du code synchrone en cours.
Que signifie réellement setTimeout(fn, 0) ?|« Mets fn dans la task queue après le délai, elle sera reprise quand la pile sera vide » — donc après tout le code synchrone en cours. Pas « immédiatement ». Le délai est en plus clampé (1 ms Node, jusqu'à 4 ms navigateur).
Pourquoi un calcul CPU lourd dans un handler Node bloque-t-il toutes les requêtes ?|Node est mono-thread : le calcul synchrone occupe la call stack, qui n'est jamais vide, donc l'event loop ne peut reprendre aucun autre callback (autres requêtes incluses) tant que le calcul n'est pas fini.
Quelle différence entre l'event loop du navigateur et celui de Node ?|Même principe (pile vide -> prendre un callback), mais hôtes différents : le navigateur gère aussi le rendu et a une boucle simple ; Node utilise libuv avec 6 phases et des primitives propres (setImmediate, process.nextTick).
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-03-event-loop-order/README.md`. Prédire puis observer l'ordre réel d'exécution d'extraits mêlant synchrone et `setTimeout`, en Node et dans le navigateur, avec corrigé commenté.
