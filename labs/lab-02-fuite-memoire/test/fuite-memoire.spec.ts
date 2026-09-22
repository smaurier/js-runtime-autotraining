// Oracle du lab 02 (JS runtime). Ne pas modifier. La preuve d'une fuite n'est pas un
// heap-snapshot (trop instable pour un test rapide) mais sa cause DIRECTE, mesurée : est-ce
// que le bus retient encore une référence vers un composant "disposé" ? Un `listenerCount`
// qui ne redescend jamais EST la fuite, pas une approximation.
import { describe, expect, it } from "vitest";
import { EventBus } from "../EventBus";
import { RoutineWatcher } from "@lab/RoutineWatcher";

describe("RoutineWatcher — non-régression", () => {
  it("compte les complétions tant qu'il est actif", () => {
    const bus = new EventBus();
    const watcher = new RoutineWatcher(bus);
    bus.emit();
    bus.emit();
    expect(watcher.completions).toBe(2);
  });
});

describe("RoutineWatcher — dispose() doit VRAIMENT désabonner (pas de fuite)", () => {
  it("après dispose(), le bus ne retient plus le listener", () => {
    const bus = new EventBus();
    const watcher = new RoutineWatcher(bus);
    expect(bus.listenerCount).toBe(1);

    watcher.dispose();

    expect(bus.listenerCount).toBe(0);
  });

  it("après dispose(), un emit() ne fait plus réagir le watcher", () => {
    const bus = new EventBus();
    const watcher = new RoutineWatcher(bus);
    bus.emit();
    watcher.dispose();
    bus.emit();
    bus.emit();

    expect(watcher.completions).toBe(1); // seul le premier emit(), avant dispose, compte
  });

  it("créer/disposer 1000 watchers ne fait PAS grossir le bus sans borne (la fuite, à l'échelle)", () => {
    const bus = new EventBus();
    for (let i = 0; i < 1000; i++) {
      const watcher = new RoutineWatcher(bus);
      watcher.dispose();
    }
    expect(bus.listenerCount).toBe(0);
  });
});
