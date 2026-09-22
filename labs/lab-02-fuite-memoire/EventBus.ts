// EventBus.ts — DONNÉ, ne se modifie pas. L'utilitaire de pub/sub déjà correct (pattern
// `AbortController` recommandé par le module 08 pour désabonner un listener proprement).
// Ce n'est PAS le sujet du lab — le bug est dans le composant qui l'utilise.
export class EventBus {
  private readonly listeners = new Set<() => void>();

  subscribe(fn: () => void, options?: { signal?: AbortSignal }): void {
    this.listeners.add(fn);
    options?.signal?.addEventListener("abort", () => {
      this.listeners.delete(fn);
    });
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
