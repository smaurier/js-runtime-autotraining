---
titre: Microtasks vs Macrotasks
cours: 01-js-runtime
notions: [microtask queue vidée entièrement après chaque macrotask, macrotasks (setTimeout/setInterval/IO/setImmediate), phases de l'event loop Node (timers/pending/poll/check/close), process.nextTick prioritaire sur les microtasks Promise, différence navigateur vs Node, prédiction d'ordre d'un mélange async]
outcomes: [prédire l'ordre exact d'un code mêlant setTimeout/Promise/nextTick/setImmediate, situer process.nextTick avant les microtasks Promise, distinguer l'ordonnancement navigateur de celui de Node]
prerequis: [03-event-loop]
next: 05-promises-implementation
libs: []
tribuzen: ordonnancement asynchrone de l'API TribuZen — flush des microtasks de log avant l'envoi de la réponse, protection contre la starvation de la file macrotask
last-reviewed: 2026-07
---

# Microtasks vs Macrotasks

> **Outcomes — tu sauras FAIRE :** prédire l'ordre exact d'un code mêlant `setTimeout`/`Promise`/`process.nextTick`/`setImmediate`, situer `process.nextTick` avant les microtasks Promise, distinguer l'ordonnancement du navigateur de celui de Node.
> **Difficulté :** :star::star::star:

## 1. Cas concret d'abord

Tu débugges un handler de l'API TribuZen. Un membre poste un message ; on veut logger l'événement AVANT de renvoyer la réponse HTTP. Le code semble correct :

```ts
// tribuzen/apps/api/src/api/postMessage.ts — AVANT correction
async function postMessage(req: Request, res: Response) {
  const message = await saveMessage(req.body); // await → reprise en microtask

  // On "log" via une microtask (Promise) au lieu d'attendre
  Promise.resolve().then(() => {
    auditLog.record('message.created', message.id); // microtask
  });

  // Et on programme une purge de cache "plus tard"
  setTimeout(() => cache.invalidate(message.roomId), 0); // macrotask

  res.json({ id: message.id }); // synchrone — part MAINTENANT
}
```

**Le bug observé en prod :** dans les logs d'audit, certains messages apparaissent APRÈS que la réponse est déjà partie — et si le process crash entre les deux, le message est renvoyé au client mais **jamais audité**. Pourquoi ? Parce que `res.json(...)` est **synchrone** : il s'exécute immédiatement, avant que la moindre microtask (`.then` de l'audit) ait tourné. Le `.then()` est mis en file et n'est vidé qu'une fois la pile d'appels vide — donc après le `return` du handler.

Et le `setTimeout` de purge de cache ? C'est une **macrotask** : elle ne s'exécute même pas dans le même tour que les microtasks. Si le handler enchaîne 100 000 microtasks (une boucle de `.then`), le `setTimeout` peut être retardé de plusieurs centaines de ms — c'est de la **starvation**.

Ce module te donne l'ordre EXACT dans lequel ces files se vident, pour que tu saches (a) ce qui a déjà tourné quand `res.json` part, et (b) comment ne pas affamer tes macrotasks.

---

## 2. Théorie complète, concise

### 2.1 Deux files, une règle d'or

Le runtime JS distingue deux catégories de callbacks asynchrones :

- **Macrotask** (la spec HTML dit *task*) : une unité de travail planifiée dans la file de tâches. `setTimeout`, `setInterval`, `setImmediate` (Node), callbacks I/O, `MessageChannel`, événements DOM.
- **Microtask** : un callback léger vidé **avant de rendre la main à l'event loop**. `Promise.then/catch/finally`, `queueMicrotask`, reprise après `await`, `MutationObserver` (navigateur).

**Règle d'or :** après CHAQUE macrotask, on vide **la totalité** de la microtask queue avant de toucher à la macrotask suivante.

```
1 macrotask
  └─→ vider TOUTE la microtask queue   (while, pas if)
      ├─ micro A
      ├─ micro B (créée par A → traitée dans le MÊME vidage)
      └─ micro C
[rendu éventuel — navigateur]
1 macrotask suivante
  └─→ vider TOUTE la microtask queue
...
```

Le point critique : c'est un `while`, pas un `if`. Si une microtask en planifie une autre, la nouvelle est traitée **dans le même vidage**, avant toute macrotask. C'est ce qui rend la starvation possible.

### 2.2 Ce qui crée quoi

| API | Catégorie | Contexte |
|-----|-----------|----------|
| `Promise.then/catch/finally` | microtask | navigateur + Node |
| `queueMicrotask(fn)` | microtask | navigateur + Node |
| reprise après `await` | microtask | navigateur + Node |
| `MutationObserver` | microtask | navigateur seulement |
| `process.nextTick(fn)` | file dédiée (**avant** microtasks) | Node seulement |
| `setTimeout` / `setInterval` | macrotask | navigateur + Node |
| `setImmediate(fn)` | macrotask (phase check) | Node seulement |
| callbacks I/O (`fs`, `net`…) | macrotask (phase poll) | Node |
| `MessageChannel` | macrotask | navigateur + Node |

Une Promise déjà résolue n'exécute **jamais** son `.then` de façon synchrone : il passe toujours par la microtask queue.

### 2.3 `process.nextTick` n'est PAS une microtask Promise

Confusion la plus fréquente. Dans Node, `process.nextTick` a sa **propre file**, distincte de la microtask queue, et elle est **prioritaire** : la nextTick queue est drainée **entièrement avant** la microtask queue Promise.

```ts
process.nextTick(() => console.log('nextTick 1'));
Promise.resolve().then(() => console.log('promise 1'));
process.nextTick(() => console.log('nextTick 2'));
Promise.resolve().then(() => console.log('promise 2'));

// Sortie :
// nextTick 1
// nextTick 2   ← TOUS les nextTick d'abord
// promise 1
// promise 2
```

**Ordre de priorité Node, du plus prioritaire au moins :**

```
1. code synchrone (call stack)
2. process.nextTick queue      (vidée entièrement, nextTick imbriqués inclus)
3. microtask queue Promise     (vidée entièrement, microtasks imbriquées incluses)
4. macrotasks selon la phase courante
```

Raison historique : `process.nextTick` existait avant les Promises ; sa priorité a été gardée pour rétrocompatibilité. La doc Node recommande `queueMicrotask()` pour le nouveau code.

### 2.4 Les phases de l'event loop Node

Une macrotask n'est pas « juste une file ». libuv organise chaque tour en **phases**, exécutées dans cet ordre fixe :

```
   ┌─────────────┐
┌─▶│   timers    │  callbacks de setTimeout / setInterval échus
│  ├─────────────┤
│  │   pending   │  certains callbacks I/O différés (erreurs TCP…)
│  ├─────────────┤
│  │ idle,prepare│  usage interne
│  ├─────────────┤
│  │    poll     │  récupère les I/O (fs, net) ; peut bloquer ici
│  ├─────────────┤
│  │    check    │  callbacks de setImmediate
│  ├─────────────┤
│  │  close cbs  │  'close' (socket.on('close')…)
│  └─────────────┘
└──────── tour suivant
```

**Entre chaque callback** (et entre chaque phase), Node vide la nextTick queue **puis** la microtask queue. Donc `nextTick` et `Promise.then` s'intercalent entre deux `setTimeout`, pas seulement à la fin du tour (comportement Node 11+).

Conséquence pratique sur `setTimeout(fn, 0)` vs `setImmediate` :
- **Au top-level**, l'ordre des deux est **non déterministe** (dépend du temps de démarrage vs le seuil de 1 ms du timer).
- **À l'intérieur d'un callback I/O** (phase poll), `setImmediate` (phase check, juste après) s'exécute **toujours avant** `setTimeout` (qui attend le prochain tour, phase timers). Là, c'est déterministe.

### 2.5 Navigateur vs Node

| | Navigateur | Node |
|---|---|---|
| Modèle | 1 macrotask → toutes microtasks → **rendu** | phases libuv, pas de rendu |
| `process.nextTick` | n'existe pas | file prioritaire dédiée |
| `setImmediate` | n'existe pas (non standard) | phase check |
| `requestAnimationFrame` | avant le rendu | n'existe pas |
| microtasks | vidées après chaque macrotask + avant rendu | vidées après nextTick, entre chaque callback |

Au navigateur, le point clé additionnel est le **rendu** : il n'a lieu qu'après avoir vidé les microtasks. Une boucle de microtasks bloque donc l'affichage. Pour porter du code Node vers le navigateur : remplace `process.nextTick(fn)` par `queueMicrotask(fn)` (comportement quasi identique, sauf la priorité vis-à-vis des Promises), et `setImmediate` par `setTimeout(fn, 0)` ou `MessageChannel`.

### 2.6 Chaînes `.then()` : elles s'entrelacent

Seul le **premier** `.then` d'une chaîne est en file au départ. Le suivant n'est ajouté qu'une fois le précédent résolu — d'où l'entrelacement entre chaînes parallèles.

```ts
Promise.resolve().then(() => console.log('1')).then(() => console.log('2'));
Promise.resolve().then(() => console.log('A')).then(() => console.log('B'));
// Sortie : 1, A, 2, B  (pas 1, 2, A, B)
```

### 2.7 Starvation : les microtasks affament les macrotasks

Puisque la microtask queue est vidée **entièrement** (`while`) avant toute macrotask, une microtask qui se re-planifie en boucle bloque indéfiniment `setTimeout`, l'I/O, `setImmediate` :

```ts
function boucle() {
  queueMicrotask(boucle); // se re-planifie → la file ne se vide jamais
}
boucle();
setTimeout(() => console.log('jamais atteint tant que la boucle tourne'), 0);
```

`process.nextTick` récursif est pire encore : il affame même les microtasks Promise. Un `while (true)` synchrone affame tout, microtasks comprises (la pile n'est jamais vide).

---

## 3. Worked examples

### Exemple 1 — Mélange navigateur (déterministe)

```js
console.log('1');
setTimeout(() => console.log('2'), 0);           // macrotask
Promise.resolve().then(() => console.log('3'));  // microtask
queueMicrotask(() => console.log('4'));          // microtask
console.log('5');
```

Raisonnement :
1. **Synchrone** d'abord : `1`, puis `5`.
2. Pile vide → on vide la microtask queue dans l'ordre d'enregistrement : `3` (le `.then` a été enregistré avant), puis `4`.
3. Enfin la macrotask : `2`.

**Sortie : `1, 5, 3, 4, 2`**

### Exemple 2 — Mélange Node (déterministe)

```js
console.log('A');

setTimeout(() => {
  console.log('T');
  process.nextTick(() => console.log('T-nextTick'));
  Promise.resolve().then(() => console.log('T-promise'));
}, 0);

process.nextTick(() => console.log('NT'));
Promise.resolve().then(() => console.log('P'));

console.log('B');
```

Raisonnement pas à pas :
1. **Synchrone** : `A`, `B`. La pile programme un `setTimeout` (macrotask), un `nextTick`, un `.then`.
2. Pile vide → **nextTick queue d'abord** : `NT`.
3. Puis **microtask queue** : `P`.
4. Phase timers → la macrotask `setTimeout` : `T`. Elle planifie un `nextTick` et un `.then`.
5. **Juste après ce callback**, Node vide nextTick puis microtasks : `T-nextTick`, puis `T-promise`.

**Sortie : `A, B, NT, P, T, T-nextTick, T-promise`**

Note : ici tout est déterministe parce qu'il n'y a qu'une seule macrotask. Le seul cas non déterministe classique — `setTimeout(…,0)` vs `setImmediate` au top-level — est traité en Piège #4.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que `process.nextTick` est une microtask Promise

```ts
// ❌ Attente : nextTick et Promise se mélangent dans l'ordre d'écriture
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
// Réalité de la sortie :
// nextTick   ← file dédiée, TOUJOURS avant les microtasks Promise
// promise
```

**Correct :** ordre Node = synchrone → **nextTick** → microtasks Promise → macrotasks. `nextTick` n'est ni une macrotask, ni une microtask Promise : c'est une file à part, plus prioritaire.

### PIÈGE #2 — `res.json()` synchrone avant les logs en microtask

```ts
// ❌ Le log en .then part APRÈS la réponse
Promise.resolve().then(() => auditLog.record(/* ... */)); // microtask
res.json({ ok: true });                                    // synchrone → maintenant
// La réponse est envoyée avant que auditLog ait tourné.

// ✅ await le log si son achèvement doit précéder la réponse
await auditLog.record(/* ... */); // la microtask de reprise est résolue avant la ligne suivante
res.json({ ok: true });
```

**Correct :** tout code synchrone (dont `res.json`) s'exécute avant la première microtask. Si l'ordre compte, `await` la microtask — ne la « fire-and-forget » pas.

### PIÈGE #3 — Croire que les chaînes `.then` se vident d'un bloc

```ts
// ❌ Attente : 1, 2, 3, A, B, C
Promise.resolve().then(() => console.log(1)).then(() => console.log(2)).then(() => console.log(3));
Promise.resolve().then(() => console.log('A')).then(() => console.log('B')).then(() => console.log('C'));
// Réalité : 1, A, 2, B, 3, C
```

**Correct :** seul le premier `.then` de chaque chaîne est en file au départ ; le suivant n'y entre qu'à la résolution du précédent. Les chaînes s'entrelacent.

### PIÈGE #4 — Attendre un ordre déterministe entre `setTimeout(0)` et `setImmediate` au top-level

```ts
// ❌ Au top-level, l'ordre n'est PAS garanti
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
// Sortie : parfois timeout puis immediate, parfois l'inverse.

// ✅ Dans un callback I/O, l'ordre est garanti : immediate AVANT timeout
const fs = require('node:fs');
fs.readFile(__filename, () => {           // on est en phase poll
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
});
// Sortie garantie : immediate, timeout
```

**Correct :** la phase check (`setImmediate`) suit immédiatement la phase poll ; les timers attendent le tour suivant. D'où l'ordre stable seulement à l'intérieur de l'I/O.

### PIÈGE #5 — Croire que le constructeur `new Promise(fn)` est asynchrone

```ts
// ❌ Attente : 'exécuteur' après 'après'
new Promise((resolve) => {
  console.log('exécuteur'); // SYNCHRONE
  resolve();
}).then(() => console.log('then'));
console.log('après');
// Réalité : exécuteur, après, then
```

**Correct :** l'exécuteur passé à `new Promise` s'exécute **immédiatement, de façon synchrone**. Seuls les callbacks `.then/.catch/.finally` sont des microtasks.

---

## 5. Ancrage TribuZen

Dans l'API TribuZen (backend Node), l'ordonnancement des files n'est pas une curiosité académique — il décide de la cohérence des données.

**Handler `postMessage` (`tribuzen/apps/api/src/api/postMessage.ts`)** — le cas concret du module. Règle appliquée : tout ce qui doit être garanti avant la réponse (audit log, invalidation de cache critique) est **`await`é** ; seul le vraiment optionnel (métriques best-effort) part en `.then` fire-and-forget. On ne compte jamais sur une microtask non attendue pour finir avant `res.json`.

**Middleware de logs (`tribuzen/apps/api/src/middleware/auditLog.ts`)** — on utilise `queueMicrotask` (et non `process.nextTick`) pour différer l'écriture des logs non bloquants : sémantique explicite, et pas de risque d'affamer les microtasks Promise du reste de la requête, ce que ferait un `nextTick` récursif.

**Worker de purge de cache (`tribuzen/apps/api/src/jobs/invalidate.ts`)** — les invalidations de cache passent par `setImmediate` (phase check) plutôt que par une microtask, pour **céder la main** à l'event loop entre deux lots. Objectif : ne pas geler les I/O réseau des autres requêtes. C'est la parade directe à la starvation vue en 2.7 — on planifie du travail en macrotask pour laisser respirer les phases poll/timers.

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/apps/api/src/
  api/postMessage.ts          # await des microtasks critiques avant res.json
  middleware/auditLog.ts      # queueMicrotask pour logs différés non bloquants
  jobs/invalidate.ts          # setImmediate pour céder l'event loop (anti-starvation)
```

---

## 6. Points clés

1. Après CHAQUE macrotask, la microtask queue est vidée **entièrement** (`while`, pas `if`) — les microtasks imbriquées sont traitées dans le même vidage.
2. Ordre Node : synchrone → `process.nextTick` → microtasks Promise → macrotasks. `nextTick` est une file dédiée, prioritaire sur les Promises.
3. Les phases Node dans l'ordre : timers → pending → poll → check (`setImmediate`) → close ; nextTick + microtasks se vident entre chaque callback.
4. `setTimeout(0)` vs `setImmediate` : non déterministe au top-level, mais `setImmediate` avant `setTimeout` à l'intérieur d'un callback I/O.
5. Navigateur : 1 macrotask → toutes microtasks → rendu. Pas de `nextTick`, pas de `setImmediate`.
6. Les chaînes `.then` s'entrelacent : seul le premier maillon est en file au départ.
7. Le constructeur `new Promise(fn)` est synchrone ; seuls les `.then/.catch/.finally` sont des microtasks.
8. Une boucle de microtasks (ou de `nextTick`) affame les macrotasks / l'I/O ; pour céder la main, planifie en macrotask (`setImmediate`, `setTimeout`).

---

## 7. Seeds Anki

```
Quand la microtask queue est-elle vidée, et jusqu'où ?|Après chaque macrotask (et, en Node, entre chaque callback), elle est vidée ENTIÈREMENT — c'est un while : les microtasks créées pendant le vidage sont traitées dans le même vidage, avant toute macrotask.
Où se place process.nextTick dans l'ordre d'exécution Node ?|Dans sa propre file, drainée APRÈS le code synchrone mais AVANT la microtask queue Promise. Ordre : synchrone → nextTick → microtasks Promise → macrotasks.
Quelles sont les phases de l'event loop Node, dans l'ordre ?|timers (setTimeout/setInterval) → pending callbacks → poll (I/O) → check (setImmediate) → close callbacks. nextTick + microtasks se vident entre chaque callback.
setTimeout(fn,0) vs setImmediate : lequel s'exécute en premier ?|Au top-level : non déterministe. À l'intérieur d'un callback I/O (phase poll) : setImmediate d'abord (phase check suit poll), setTimeout attend le tour suivant.
En quoi l'ordonnancement du navigateur diffère-t-il de Node ?|Navigateur : 1 macrotask → toutes les microtasks → rendu ; pas de process.nextTick ni setImmediate. Node : phases libuv, pas de rendu, nextTick queue prioritaire dédiée.
Pourquoi un .then de log peut-il s'exécuter après res.json() ?|res.json() est synchrone : tout le code synchrone tourne avant la première microtask. Le .then fire-and-forget n'est vidé qu'une fois la pile vide, donc après le handler. Il faut l'await si l'ordre compte.
Les chaînes .then() se vident-elles d'un bloc ?|Non. Seul le premier .then de chaque chaîne est en file au départ ; le maillon suivant n'y entre qu'à la résolution du précédent, d'où l'entrelacement entre chaînes parallèles.
Comment une microtask peut-elle affamer les macrotasks, et comment l'éviter ?|Une microtask qui se re-planifie en boucle (queueMicrotask/nextTick récursif) bloque le vidage : setTimeout/I/O ne tournent jamais. Parade : planifier le travail en macrotask (setImmediate/setTimeout) pour céder l'event loop.
```

---

## Pont vers le lab

> Lab associé : `01-js-runtime/labs/lab-04-microtask-macrotask/README.md`. Prédire à la main l'ordre exact d'un mélange `setTimeout`/`Promise`/`nextTick`/`setImmediate`, puis vérifier en exécutant sous Node — corrigé pas à pas fourni.
