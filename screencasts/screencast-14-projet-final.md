# Screencast 14 — Projet Final (Mini Event Loop)

## Informations
- **Durée estimée** : 14-16 min
- **Module** : `modules/14-projet-final.md`
- **Lab associé** : `labs/lab-14-mini-event-loop/`
- **Prérequis** : Tous les modules précédents (01-13), en particulier Module 03 (Event Loop), Module 04 (Microtasks/Macrotasks), Module 05 (Promises)

## Setup
- [ ] Terminal ouvert dans `js-runtime-course/`
- [ ] Fichiers du lab-14 prêts (`exercise.js`, tests associés)
- [ ] Éditeur de code ouvert sur `exercise.js` et le fichier de tests
- [ ] Node.js v20+ installé
- [ ] Tous les tests en rouge au départ (vérifier avec `node --test`)

## Script

### [00:00-02:00] Introduction — Tout assembler

> « Bienvenue dans le module 14, le projet final. On va construire une mini event loop — un simulateur qui reproduit le comportement réel de l'event loop de Node.js. C'est la synthèse de tout ce qu'on a appris depuis le début du cours. »

- Rappeler ce qu'on a vu :
  - Module 01 : la call stack et les contextes d'exécution
  - Module 03 : l'event loop et ses phases
  - Module 04 : les microtasks et macrotasks et leur priorité
  - Module 05 : comment les Promises résolvent via la microtask queue
- Ce projet prouve qu'on comprend ces mécanismes en profondeur — on les **implémente**
- Objectif : faire passer tous les tests du lab-14

**Transition** : « Voyons l'architecture de notre mini event loop. »

### [02:00-04:30] Concept clé — Architecture de la mini event loop

#### Les composants
1. **Call Stack** : un tableau simulant la pile d'appels
2. **Microtask Queue** : file pour `Promise.then`, `queueMicrotask`
3. **Macrotask Queue** : file pour `setTimeout`, `setInterval`
4. **Animation Queue** : file pour `requestAnimationFrame` (navigateur)

#### L'algorithme de drainage (drain)
```
1. Exécuter le script principal (global execution context)
2. BOUCLE tant qu'il reste des tâches :
   a. Drainer TOUTES les microtasks (vidange complète)
   b. Exécuter UNE macrotask de la queue
   c. Re-drainer TOUTES les microtasks générées par cette macrotask
   d. (Optionnel) Exécuter les animation callbacks
   e. Répéter
3. FIN quand toutes les queues sont vides
```

#### Points cruciaux
- Les microtasks ont **toujours** la priorité sur les macrotasks
- Une microtask peut créer d'autres microtasks → elles sont toutes exécutées avant la prochaine macrotask
- Chaque macrotask est suivie d'un drain complet des microtasks
- Un `setTimeout(fn, 0)` n'exécute `fn` qu'après le drain des microtasks en cours

**Transition** : « Lançons les tests et voyons où on en est. »

### [04:30-07:00] Démonstration — Tests en rouge et premiers pas

#### Lancer les tests
```bash
cd labs/lab-14-mini-event-loop && node --test
```
- Montrer que tous les tests échouent (rouge)
- Lire les noms des tests pour comprendre ce qui est attendu :
  - « should execute synchronous code in order »
  - « should execute microtasks before macrotasks »
  - « should drain all microtasks before next macrotask »
  - « should handle nested microtasks »
  - etc.

#### Ouvrir le squelette
- Ouvrir `exercise.js` et montrer la classe `MiniEventLoop`
- Identifier les méthodes à implémenter :
  - `_createContext()` : crée le contexte d'exécution avec `setTimeout`, `queueMicrotask` simulés
  - `_drainMicrotasks()` : vide la microtask queue
  - `_tick()` : exécute un cycle de l'event loop
  - `run(code)` : point d'entrée principal
- Montrer les propriétés déjà initialisées : `this.callStack`, `this.microtaskQueue`, `this.macrotaskQueue`

**Transition** : « Implémentons étape par étape. »

### [07:00-11:30] Walkthrough — Implémentation live

#### Étape 1 : `_createContext()`
```javascript
_createContext() {
  const self = this;
  return {
    setTimeout(fn, delay) {
      self.macrotaskQueue.push({ fn, delay, type: 'timeout' });
    },
    queueMicrotask(fn) {
      self.microtaskQueue.push(fn);
    },
    Promise: {
      resolve(value) {
        return {
          then(onFulfilled) {
            self.microtaskQueue.push(() => onFulfilled(value));
            return this;
          }
        };
      }
    }
  };
}
```
- Expliquer : on remplace les APIs globales par nos propres versions
- Chaque appel à `setTimeout` ajoute dans **notre** queue, pas celle de Node.js
- Relancer les tests → quelques-uns passent au vert

#### Étape 2 : `_drainMicrotasks()`
```javascript
_drainMicrotasks() {
  while (this.microtaskQueue.length > 0) {
    const task = this.microtaskQueue.shift();
    this.callStack.push(task);
    task();
    this.callStack.pop();
  }
}
```
- Point crucial : c'est un **while**, pas un for → les microtasks ajoutées pendant le drain sont aussi exécutées
- Relancer les tests → les tests de microtasks passent

#### Étape 3 : La méthode `run()`
```javascript
run(code) {
  const context = this._createContext();
  // Exécuter le code dans le contexte
  const fn = new Function(...Object.keys(context), code);
  this.callStack.push(fn);
  fn(...Object.values(context));
  this.callStack.pop();

  // Drainer les microtasks du script principal
  this._drainMicrotasks();

  // Boucle principale
  while (this.macrotaskQueue.length > 0) {
    const task = this.macrotaskQueue.shift();
    this.callStack.push(task.fn);
    task.fn();
    this.callStack.pop();
    this._drainMicrotasks();
  }
}
```
- Montrer l'ordre : script → microtasks → (macrotask → microtasks)*
- Relancer les tests → normalement tous verts

#### Gérer les cas limites
- Microtask qui crée une macrotask → traitée au prochain cycle
- Macrotask qui crée une microtask → drainée immédiatement après
- Montrer le test de nested microtasks qui valide ce comportement

**Transition** : « Comparons notre implémentation avec la vraie event loop. »

### [11:30-14:00] Récap — Notre mini event loop vs la vraie

#### Ce qu'on a implémenté fidèlement
- L'ordre microtasks > macrotasks
- Le drain complet des microtasks entre chaque macrotask
- Les microtasks imbriquées (nested)
- La call stack comme pile LIFO

#### Ce que la vraie event loop a en plus
- **Phases** : timers, pending callbacks, idle, poll, check, close
- **libuv** pour l'I/O asynchrone (fichiers, réseau, DNS)
- **process.nextTick** : encore plus prioritaire que les microtasks Promise
- **Delays réels** pour `setTimeout` (notre version ignore le delay)
- **setImmediate** dans la phase check
- **requestAnimationFrame** synchronisé avec le rendu navigateur

#### Ce que ce projet prouve
- L'event loop n'est **pas magique** — c'est un algorithme simple de queues et de priorités
- Les microtasks sont drainées de manière **exhaustive** → risque de starvation
- Comprendre le drain algorithm permet de prédire l'ordre d'exécution de n'importe quel code async

#### Quiz rapide
- « Que se passe-t-il si une microtask crée indéfiniment d'autres microtasks ? » → La macrotask queue n'est jamais traitée (starvation)
- « Pourquoi drainer toutes les microtasks entre chaque macrotask ? » → Pour garantir que les Promises se résolvent avant les timers

> « Dernier module : la session de Debugging intégratif. On combine tous les outils qu'on a appris. »

## Points d'attention pour l'enregistrement
- Ce screencast est plus long que les autres (~14-16 min) — c'est normal pour un projet final
- Coder en live est le moment fort — taper le code progressivement, ne pas copier-coller
- Lancer les tests après chaque étape pour montrer la progression rouge → vert
- Expliquer le `while` vs `for` dans `_drainMicrotasks` — c'est la subtilité la plus importante
- Prendre le temps de comparer avec la vraie event loop — les apprenants doivent comprendre les limites
- S'assurer que la police de code est grande et lisible (minimum 16px)
