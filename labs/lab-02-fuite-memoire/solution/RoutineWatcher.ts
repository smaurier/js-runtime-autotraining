// RoutineWatcher.ts — SOLUTION DE RÉFÉRENCE (commentée). Ne l'ouvre pas avant ton GREEN.
import type { EventBus } from "../EventBus";

export class RoutineWatcher {
  private count = 0;
  private readonly controller = new AbortController();

  constructor(bus: EventBus) {
    bus.subscribe(
      () => {
        this.count++;
      },
      { signal: this.controller.signal },
    );
  }

  get completions(): number {
    return this.count;
  }

  dispose(): void {
    // abort() déclenche le listener "abort" posé par EventBus.subscribe, qui retire VRAIMENT
    // la fonction du Set — le bus ne retient plus rien de ce watcher après cet appel.
    this.controller.abort();
  }
}
