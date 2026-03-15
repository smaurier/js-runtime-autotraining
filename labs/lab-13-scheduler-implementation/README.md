# Lab 13 — Scheduler Implementation

## Objectifs

- Implementer un ordonnanceur cooperatif de taches avec priorites et time-slicing
- Comprendre la cedation au loop d'événements (yield to event loop) via setTimeout/setImmediate
- Implementer un rate limiter (limiteur de debit) : max N executions par fenêtre de temps
- Implementer debounce et throttle from scratch, comprendre les implications event loop
- Implementer une file de priorite avec preemption entre time slices

## Prérequis

- Node.js v18+ (ES modules)
- Comprehension de l'event loop Node.js (microtasks, macrotasks, timers)
- Connaissance de `performance.now()` pour la mesure de temps précisé

## Commande d'exécution

```bash
node exercise.js
node solution.js
```

## Structure du lab

| Partie | Sujet |
|--------|-------|
| 1 | Scheduler cooperatif : addTask(fn, priority), run(), cancel(taskId), time-slicing 5ms |
| 2 | Rate limiter : max N executions par fenêtre de temps |
| 3 | Debounce et throttle from scratch avec explications event loop |
| 4 | File de priorite avec preemption des taches high sur les low |

## Interfaces a implementer

```javascript
// Partie 1 — Scheduler cooperatif
const scheduler = new CooperativeScheduler();
const taskId = scheduler.addTask(fn, 'high');  // 'high' | 'medium' | 'low'
scheduler.cancel(taskId);                       // annule la tache
await scheduler.run();                          // execute tout, yield entre taches

// Partie 2 — Rate Limiter
const limiter = createRateLimiter(maxCalls, windowMs);
limiter(fn);  // execute fn ou rejette si quota depasse

// Partie 3 — Debounce / Throttle
const debounced = debounce(fn, delayMs);
const throttled = throttle(fn, intervalMs);

// Partie 4 — Priority Queue avec preemption
const pq = new PreemptiveScheduler();
pq.addTask(fn, 'high');
await pq.run();  // les high preemptent les low entre time slices
```

## Indices

- `setTimeout(resolve, 0)` encapsule dans une Promise pour ceder au loop
- `performance.now()` pour mesurer le temps ecoule dans un time slice de 5ms
- Un `Map` pour stocker les taches avec leur ID et leur statut
- Les taches doivent etre des generators ou des fonctions decoupables pour le time-slicing

## Criteres de reussite

- Le scheduler exécuté les taches high avant medium avant low
- Chaque tache cede au loop après 5ms maximum de travail CPU
- cancel(taskId) empeche l'exécution d'une tache non-demarree
- Le rate limiter bloque les appels excessifs dans la fenêtre
- Debounce reporte l'exécution au dernier appel, throttle espace les executions
- Les taches high preemptent les low entre time slices dans la partie 4
