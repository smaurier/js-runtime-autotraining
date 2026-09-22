// RoutineWatcher.ts — L'EXISTANT, EN PRODUCTION. Ticket : « à chaque changement de page dans
// l'app, on crée un nouveau RoutineWatcher et on `dispose()` l'ancien. Après une session
// longue, l'app ralentit — on soupçonne une fuite mémoire, mais rien ne plante, ça marche
// "juste" de plus en plus lentement. »
//
// Ce fichier COMPILE et MARCHE : un `RoutineWatcher` fraîchement créé compte bien les
// complétions de routine. Le bug est invisible à l'usage normal (une seule instance, une
// courte session) — il ne se voit qu'en créant/jetant BEAUCOUP d'instances, exactement ce
// qu'une navigation répétée dans l'app fait en vrai.
//
// AVANT de corriger : ouvre CE fichier ET `EventBus.ts` (donné, déjà correct), et remplis
// `AUDIT.md`.
//
// Contrat à respecter (signatures inchangées) :
//   constructor(bus: EventBus)
//   get completions(): number
//   dispose(): void — après cet appel, le watcher ne doit PLUS jamais réagir à un emit() du
//     bus, ET le bus ne doit plus le retenir (son listenerCount doit redescendre).
import type { EventBus } from "../EventBus";

export class RoutineWatcher {
  private count = 0;

  constructor(bus: EventBus) {
    bus.subscribe(() => {
      this.count++;
    });
  }

  get completions(): number {
    return this.count;
  }

  dispose(): void {
    // Rien ici — c'est le bug.
  }
}
