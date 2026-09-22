# Audit — `RoutineWatcher.ts`

À remplir en lisant UNIQUEMENT `src/RoutineWatcher.ts` et `EventBus.ts` — rien d'autre. Le
correcteur lit ce fichier avant ton code.

1. **`bus.subscribe(fn)` sans second argument.** Regarde la signature de `subscribe` dans
   `EventBus.ts` — à quoi sert le second paramètre `options?.signal` ? Que se passe-t-il si
   on ne le fournit jamais ?

2. **`dispose()` est vide.** Une fois un `RoutineWatcher` "disposé", qu'est-ce qui le relie
   encore au `bus` ? Qu'est-ce que ce lien empêche le ramasse-miettes de faire ?

3. **Le symptôme rapporté** ("ça ralentit après une session longue, rien ne plante") — à quoi
   ce symptôme correspond-il typiquement (module 08) ? Pourquoi ce n'est visible qu'après
   BEAUCOUP de créations/destructions, jamais sur une seule instance ?

4. La correction minimale, en une phrase — quel outil du module 08 s'applique ici ?
