# Guide de l'apprenant -- JS Runtime & Engine

> **Ce guide est ta boussole.** Il t'aide a savoir ou tu en es, par ou passer,
> et quoi faire quand tu bloques. Lis-le avant de commencer, et reviens-y regulierement.
>
> **Temps estime** : ~100-140h (3-4 mois a 8-10h/semaine)
>
> **Philosophie** : Comprendre le runtime JavaScript, c'est passer de "ca marche"
> a "je sais POURQUOI ca marche". Chaque concept ici te rendra meilleur dans
> tous les autres cours du cursus.

---

## Avant de commencer -- Auto-diagnostic

Reponds honnetement. Ce n'est pas un examen -- c'est un GPS.

### JavaScript -- le socle

Coche ce que tu sais faire SANS chercher sur Google :
- [ ] Expliquer ce qu'est le call stack
- [ ] Decrire la difference entre `setTimeout(fn, 0)` et une Promise resolue
- [ ] Expliquer pourquoi `typeof null === 'object'`
- [ ] Ecrire une closure et expliquer pourquoi elle "capture" une variable
- [ ] Utiliser `async`/`await` et gerer les erreurs avec `try/catch`
- [ ] Expliquer ce qu'est un garbage collector (meme vaguement)

**6/6** -> Tu as deja de bonnes bases. Commence au module 00, tu iras vite sur la Phase 1.
**3-5/6** -> Parfait, tu es exactement le public vise. Commence au debut.
**< 3/6** -> Revois d'abord les bases JavaScript (closures, promises). Ce cours suppose JS maitrise.

### Runtime -- ou en es-tu deja ?

- [ ] Tu sais ce qu'est la difference entre microtask et macrotask
- [ ] Tu sais expliquer ce qu'est V8 (ou SpiderMonkey, ou JavaScriptCore)
- [ ] Tu as deja utilise les Chrome DevTools pour profiler la memoire
- [ ] Tu sais ce qu'est le JIT (Just-In-Time compilation)
- [ ] Tu as deja diagnostique un memory leak en production

**5/5** -> Tu peux probablement sauter a la Phase 3 (module 07). Fais le checkpoint Phase 2 d'abord.
**2-4/5** -> Commence a la Phase 1, tu as des bases a consolider.
**0-1/5** -> C'est normal. La plupart des devs JavaScript ne connaissent pas leur runtime. C'est tout l'interet de ce cours.

### Le test decisif

Explique mentalement (ou sur papier) dans quel ordre s'affichent les logs :
```js
console.log('1');
setTimeout(() => console.log('2'), 0);
Promise.resolve().then(() => console.log('3'));
console.log('4');
```

- Si tu reponds `1, 4, 3, 2` et que tu sais expliquer pourquoi -> tu connais l'event loop. Verifie la Phase 2.
- Si tu hesites entre `3` et `2` -> c'est exactement ce qu'on va eclaircir.
- Si tu n'es pas sur -> pas de panique, le module 03 est fait pour toi.

---

## Les 4 phases de ta progression

### Phase 1 -- Fondamentaux (modules 00-03) ~20-30h

> **Objectif** : Comprendre comment JavaScript execute ton code, ligne par ligne.
> Call stack, scope, closures, et le coeur du sujet : l'event loop.
>
> **Analogie** : C'est comme ouvrir le capot d'une voiture que tu conduis depuis des annees.

| Module | Sujet | Temps | Note |
|---|---|---|---|
| 00 | Prerequis et vue d'ensemble | 1h30 | La carte du territoire -- lis-le attentivement |
| 01 | Call stack et contexte d'execution | 3h | **Cours cle** -- tout repose la-dessus |
| 02 | Scope, closures et memoire | 3h | Pourquoi les closures "capturent" des variables |
| 03 | Event loop | 4h | **Cours cle** -- le concept le plus important du cours |

**Exercices Phase 1** : Dessine le call stack a la main pour chaque exemple.
Ne te contente pas de lire -- trace l'execution pas a pas.

**Checkpoint Phase 1** :
- [ ] Tu sais dessiner le call stack pour un appel de fonction imbrique
- [ ] Tu sais expliquer pourquoi une closure garde une reference (pas une copie)
- [ ] Tu sais decrire les 3 parties de l'event loop (call stack, task queue, microtask queue)
- [ ] Tu sais pourquoi `setTimeout(fn, 0)` n'execute pas immediatement
- [ ] Tu peux expliquer pourquoi une boucle infinie bloque toute l'interface

> **Test** : Un collegue demande "pourquoi mon `setTimeout` ne se declenche pas a temps ?".
> Si tu reponds "parce que le call stack n'est pas vide", c'est bon.

---

### Phase 2 -- Asynchrone en profondeur (modules 04-06) ~25-30h

> **Objectif** : Maitriser microtasks vs macrotasks, comprendre l'implementation
> interne des Promises, et ce que `async/await` fait vraiment sous le capot.
>
> **Analogie** : Tu sais que la voiture a un moteur. Maintenant tu apprends comment fonctionne l'injection.

| Module | Sujet | Temps | Note |
|---|---|---|---|
| 04 | Microtasks et macrotasks | 3h | **Cours cle** -- la hierarchie des taches |
| 05 | Implementation des Promises | 4h | Construire une Promise from scratch |
| 06 | Async/await sous le capot | 3h | Ce que le compilateur fait de ton `await` |

**Conseil** : Le module 05 (implementer une Promise) est difficile mais extremement formateur.
Si tu bloques, ecris d'abord la version simplifiee (resolve/reject seulement),
puis ajoute `then` chaining progressivement.

**Checkpoint Phase 2** :
- [ ] Tu sais classer `setTimeout`, `setInterval`, `requestAnimationFrame`, `Promise.then`, `queueMicrotask`
- [ ] Tu sais implementer une Promise basique avec `resolve`, `reject` et `then`
- [ ] Tu sais ce que `await` fait a ton code (transformation en state machine)
- [ ] Tu sais pourquoi `Promise.all` est plus performant qu'une boucle de `await`
- [ ] Tu peux predire l'ordre d'execution d'un code mixant microtasks et macrotasks

> **Test** : Quelqu'un ecrit `for (const url of urls) { await fetch(url); }`.
> Si tu vois le probleme et proposes `Promise.all(urls.map(fetch))`, c'est bon.

---

### Phase 3 -- Memoire et V8 (modules 07-11) ~30-40h

> **Objectif** : Comprendre le garbage collector, diagnostiquer les memory leaks,
> et savoir comment V8 optimise (ou desoptimise) ton code.
>
> **Analogie** : Tu passes de mecanicien a ingenieur moteur. Tu comprends les choix de conception.

| Module | Sujet | Temps | Note |
|---|---|---|---|
| 07 | Garbage collector | 3h | Mark-and-sweep, generations, weak references |
| 08 | Memory leaks | 4h | **Cours cle** -- les patterns qui fuient et comment les detecter |
| 09 | Architecture V8 | 3h | Ignition, TurboFan, le pipeline de compilation |
| 10 | JIT compilation et optimisation | 4h | Comment V8 decide d'optimiser une fonction |
| 11 | Hidden classes et inline caching | 3h | Pourquoi l'ordre des proprietes compte |

**Attention** : Les modules 09-11 sont denses et theoriques. Alterne avec des sessions
pratiques (profiling dans DevTools). Ne fais pas plus d'un module theorique par jour.

**Checkpoint Phase 3** :
- [ ] Tu sais utiliser les Chrome DevTools pour prendre un heap snapshot
- [ ] Tu sais identifier les 5 causes classiques de memory leak (closures, DOM detache, timers, listeners, caches)
- [ ] Tu sais expliquer le pipeline Ignition -> TurboFan
- [ ] Tu sais pourquoi les fonctions polymorphiques sont plus lentes (hidden classes)
- [ ] Tu sais ce qu'est le deopt et comment l'eviter

> **Test** : Un serveur Node.js consomme de plus en plus de RAM. Par ou commences-tu ?
> Si tu reponds "heap snapshot, comparaison avant/apres, recherche de retained objects", c'est bon.

---

### Phase 4 -- Expert (modules 12-15) ~25-35h

> **Objectif** : Performance patterns avances, scheduling, concurrence,
> et un projet final + session de debugging en conditions reelles.
>
> **Analogie** : Tu ne repares plus le moteur -- tu le concois pour la performance.

| Module | Sujet | Temps | Note |
|---|---|---|---|
| 12 | Performance patterns | 4h | Debounce, throttle, batching, lazy init |
| 13 | Scheduling et concurrence | 4h | Web Workers, `scheduler.postTask`, patterns concurrents |
| 14 | Projet final | 8h+ | Tout assembler dans un scenario realiste |
| 15 | Session de debugging | 4h | Debug en live d'un probleme de performance reel |

**Checkpoint Phase 4** :
- [ ] Tu sais implementer un debounce/throttle et expliquer la difference
- [ ] Tu sais utiliser les Web Workers et communiquer via `postMessage`
- [ ] Tu sais profiler une application et identifier le bottleneck (CPU vs memoire vs I/O)
- [ ] Tu as termine le projet final avec des metriques de performance mesurables
- [ ] Tu sais mener une session de debugging performance de bout en bout

> **Test** : Un collegue dit "mon app est lente". Si tu sais distinguer
> si c'est un probleme de rendering, de calcul, de memoire, ou de reseau,
> et que tu sais quel outil utiliser pour chaque cas -- tu es expert.

---

## Quand tu bloques

Le runtime JavaScript est abstrait. C'est normal de ne pas "voir" ce qui se passe.
Voici comment debloquer selon la situation :

### "L'event loop, je ne comprends pas"
1. Utilise le site [Loupe](http://latentflip.com/loupe/) -- il visualise l'event loop en temps reel
2. Ecris un petit script avec `setTimeout`, `Promise.then` et `console.log`, et predis l'ordre AVANT de l'executer
3. Dessine sur papier : call stack a gauche, task queue a droite, microtask queue au milieu

### "Les microtasks et macrotasks, ca se melange dans ma tete"
1. Retiens une seule regle : les microtasks passent TOUJOURS avant les macrotasks
2. Microtasks = `Promise.then`, `queueMicrotask`, `MutationObserver`
3. Macrotasks = `setTimeout`, `setInterval`, `setImmediate`, I/O callbacks
4. Apres chaque macrotask, TOUTE la queue de microtasks se vide

### "Le garbage collector, c'est trop abstrait"
1. Ouvre Chrome DevTools > Memory > prends un heap snapshot
2. Cree un objet, stocke-le dans une variable, supprime la reference, reprends un snapshot
3. Compare les deux snapshots -- tu verras le GC en action

### "V8 et le JIT, je ne vois pas l'interet pratique"
1. Concentre-toi sur les consequences, pas sur l'implementation interne
2. Retiens : fonctions monomorphiques = rapides, polymorphiques = lentes
3. Retiens : les objets avec le meme "shape" partagent une hidden class = rapide
4. Le reste est du bonus culturel -- utile mais pas bloquant

### "Je n'arrive pas a trouver un memory leak"
1. Prends 3 heap snapshots : debut, apres action, apres cleanup
2. Compare snapshot 1 et 3 -- ce qui reste, c'est la fuite
3. Cherche les "retained objects" -- ce sont eux qui empechent le GC
4. Les coupables habituels : closures, event listeners non supprimes, caches illimites

### "Je n'arrive pas a faire l'exercice"
1. Relis le cours correspondant, en particulier les schemas et diagrammes
2. Utilise les DevTools pour experimenter -- c'est ton meilleur allie dans ce cours
3. Ecris la version naive d'abord, puis optimise

---

## Auto-evaluation par phase

Apres chaque phase, pose-toi ces questions. Si tu ne sais pas repondre,
reviens en arriere -- c'est un signe, pas un echec.

**Apres Phase 1** : "Pourquoi une boucle `while(true)` bloque-t-elle le rendu du navigateur ?"
-> Si tu reponds "parce que le call stack n'est jamais vide, donc l'event loop ne peut pas traiter les taches de rendu", c'est bon.

**Apres Phase 2** : "Dans quel ordre s'executent `queueMicrotask`, `setTimeout(0)` et `requestAnimationFrame` ?"
-> Si tu reponds "microtask d'abord, puis rAF (avant le rendu), puis setTimeout au prochain tick", c'est bon.

**Apres Phase 3** : "Pourquoi ajouter des proprietes dynamiquement a un objet ralentit V8 ?"
-> Si tu parles de hidden classes, de transitions de shape, et de deoptimisation de l'inline cache, c'est bon.

**Apres Phase 4** : "Comment paralleliser un calcul lourd sans bloquer le thread principal ?"
-> Si tu proposes Web Workers avec transfert de buffers et que tu sais dimensionner le pool, c'est bon.

---

## Rythme recommande

| Rythme | Par semaine | Duree totale |
|---|---|---|
| **Decouverte** (a cote du boulot) | 4-6h | 5-6 mois |
| **Regulier** (motivation) | 8-10h | 3-4 mois |
| **Intensif** (objectif pro) | 12-15h | 2-3 mois |

### Conseils concrets

- **1 module = 1 a 2 sessions.** Les modules sur V8 (09-11) meritent 2 sessions chacun.
- **Alterne theorie et pratique.** Apres chaque module theorique, ouvre les DevTools et experimente.
- **L'event loop (03-04) merite une semaine entiere.** C'est le concept central.
- **Le projet final (14) vaut 2 semaines.** C'est la que tu assembles tout.
- **Dessine.** Ce cours est tres visuel -- call stack, event loop, heap. Dessine sur papier ou tableau blanc.

### Quand faire une pause

- Si tu relis la meme phrase 3 fois -> arrete, fais autre chose, reviens demain
- Si l'event loop te semble "magique" malgre le cours -> regarde une video (Jake Archibald "In The Loop")
- Si V8 te semble trop bas niveau -> rappelle-toi que c'est du bonus culturel, pas un prerequis pour la suite

---

## Ressources complementaires

### Quand tu veux approfondir
- [Jake Archibald -- In The Loop](https://www.youtube.com/watch?v=cCOL7MC4Pl0) -- la meilleure explication de l'event loop
- [Loupe](http://latentflip.com/loupe/) -- visualisation interactive de l'event loop
- [V8 Blog](https://v8.dev/blog) -- articles techniques de l'equipe V8
- *JavaScript: The Definitive Guide* (David Flanagan) -- chapitres sur le runtime

### Quand tu cherches une reponse rapide
- Chrome DevTools > Performance tab -- profile en live
- Chrome DevTools > Memory tab -- heap snapshots
- `node --trace-opt --trace-deopt` -- voir les decisions du JIT en Node.js

---

## Et apres ?

Tu as fini les 16 modules ? Tu comprends ton runtime mieux que 95% des devs JavaScript.

Voici les prochaines etapes :
1. **Profile un vrai projet** -- prends une app existante et optimise-la avec les outils appris
2. **Passe au cours Testing (04)** -- comprendre le runtime aide enormement pour les tests async
3. **Explore NestJS (05)** -- le runtime Node.js prend tout son sens cote serveur
4. **Lis le code source de V8** -- pour les plus curieux, c'est fascinant
