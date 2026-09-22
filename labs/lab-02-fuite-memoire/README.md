# Lab 02 — Intervention : une fuite mémoire dans un composant existant

> **Outcome :** à la fin, tu sais reconnaître le symptôme classique d'une fuite mémoire
> ("ça ralentit après une longue session, rien ne plante") et le corriger avec l'outil
> moderne recommandé par le module 08 : `AbortController` — pas un compteur maison, pas un
> `removeListener` oublié dans un coin.
> **Vrai outil :** `AbortController`/`AbortSignal` (standard Web, disponible nativement dans
> Node). La preuve n'est pas un heap-snapshot (trop instable pour un test rapide et fiable)
> mais sa cause DIRECTE et mesurable : est-ce que le bus retient encore une référence vers un
> composant "disposé" ?
> **Feedback :** `npm run lab:02` — la non-régression est verte, la détection de fuite est
> rouge. `npm run solution:02` prouve l'oracle. `AUDIT.md` se remplit AVANT tout code.

## Prérequis technique

`npm install` depuis `01-js-runtime/labs`.

## Lire avant (une lecture bornée)

- Module [`08-memory-leaks.md`](../../modules/08-memory-leaks.md) — sources classiques de
  fuite (listeners, timers, closures), pourquoi `AbortController` est l'outil recommandé
  pour un listener qu'on doit pouvoir retirer proprement.

## Énoncé

`RoutineWatcher` (`src/RoutineWatcher.ts`) est **en production**, consommé partout où l'app
navigue d'une page à l'autre : un watcher créé, utilisé, puis `dispose()`. Ticket : *« après
une session longue, l'app ralentit — on soupçonne une fuite, mais rien ne plante. »*

`EventBus.ts` (donné, déjà correct) expose déjà le pattern `AbortController` — regarde sa
signature `subscribe(fn, { signal })`.

**0. `AUDIT.md`, avant toute ligne de code.**

**1. Corrige** `RoutineWatcher` : crée un `AbortController` dans le constructeur, passe son
`signal` à `bus.subscribe`, appelle `controller.abort()` dans `dispose()`.

**Le piège à éviter — et pourquoi ce lab existe.** Le bug est INVISIBLE à l'usage normal :
un seul `RoutineWatcher` créé une fois, dans un test rapide, "marche" très bien même buggé —
il compte correctement tant qu'on ne le dispose pas. La fuite ne se voit qu'en
créant/jetant BEAUCOUP d'instances, exactement ce qu'une navigation répétée dans une vraie
app fait sur une session longue. C'est pour ça que le dernier test de ce lab en crée 1000.

## Étapes (en friction)

1. Remplis `AUDIT.md`.
2. `npm run lab:02` : non-régression verte, détection de fuite rouge (le dernier test est
   sans appel : 1000 watchers créés/disposés, le bus en retient encore 1000).
3. Ajoute l'`AbortController`, câble le `signal`, appelle `abort()` dans `dispose()`.
4. Relance : les 4 tests doivent passer.

## Vérifier

```bash
cd 01-js-runtime/labs
npm install
npm run lab:02
npm run solution:02
```

**Ce que l'oracle vérifie**

Non-régression : un watcher actif compte bien les complétions. Fuite : après `dispose()`, le
`listenerCount` du bus redescend à 0 (pas juste "on espère") ; après `dispose()`, un nouvel
`emit()` ne fait plus réagir le watcher ; créer et disposer 1000 watchers ne laisse AUCUN
listener accroché au bus — la preuve à l'échelle où une vraie fuite se voit.

## Variante J+30 (fading)

Le produit ajoute un cache de familles récemment consultées, qui grossit à chaque
navigation et n'est jamais vidé. C'est une fuite de la même famille (référence retenue
inutilement) mais l'outil de correction n'est PAS `AbortController` — lequel, d'après le
module 08 ?

## Application TribuZen

Même correction sur un vrai composant de `tribuzen-admin` qui s'abonne à des événements
temps réel (cours 09, WebSockets) — un `AbortController` par montage de composant, aboli au
démontage. Commit :
`fix(routine-watcher): AbortController pour un désabonnement réel — fuite mesurée à 1000 instances`.
