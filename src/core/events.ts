/**
 * Typed event bus.
 *
 * Lets `physics/` announce things without importing `audio/` or `render/`.
 * Events are fire-and-forget; they must never carry simulation authority.
 */

export interface GameEvents {
  'wheel-lock': { carId: number; intensity: number }
  collision: { carId: number; otherId: number | null; impulse: number }
  'surface-change': { carId: number; surface: 'track' | 'kerb' | 'gravel' | 'grass' }
  'lap-complete': { carId: number; lap: number; lapTime: number }
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void

export interface EventBus {
  on<K extends keyof GameEvents>(event: K, handler: Handler<K>): () => void
  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void
  clear(): void
}

export function createEventBus(): EventBus {
  const handlers = new Map<keyof GameEvents, Set<Handler<never>>>()

  return {
    on(event, handler) {
      let set = handlers.get(event)
      if (!set) {
        set = new Set()
        handlers.set(event, set)
      }
      set.add(handler as Handler<never>)
      return () => {
        set.delete(handler as Handler<never>)
      }
    },
    emit(event, payload) {
      const set = handlers.get(event)
      if (!set) return
      for (const handler of set) {
        ;(handler as Handler<typeof event>)(payload)
      }
    },
    clear() {
      handlers.clear()
    },
  }
}
