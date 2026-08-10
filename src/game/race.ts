/**
 * Where every car is on the circuit, and what that means.
 *
 * This is the module that connects the track pipeline to the simulation. It runs
 * once per physics step, after the cars have moved, and it does four things per
 * car: locate it, record how far round it is, notice when it crosses the line,
 * and tell it what it is driving on.
 *
 * Position is `(lap * length) + distanceAlongTrack`, sorted descending. Lap
 * counting is the part that goes wrong: a car crossing the line goes from
 * `length - 1` to `1`, which read literally is a lap driven backwards. All of it
 * routes through `lapDelta`, which resolves that to the short way round, so
 * there is exactly one place for the wraparound to be wrong.
 *
 * All timing reads `world.time` — accumulated simulation time — never
 * `performance.now()`. The loop deliberately drops wall-clock time after a tab
 * switch, and a lap time must not notice.
 */

import type { Car, World } from '../core/world'
import {
  createTrackPosition,
  lapDelta,
  locate,
  surfaceDrag,
  surfaceGrip,
  type TrackIndex,
  type TrackPosition,
} from '../track/query'

export interface LapTiming {
  /** ms elapsed on the lap in progress. */
  current: number
  /** ms for the last completed lap, or `null` before one has been. */
  last: number | null
  best: number | null
}

export interface RaceDirector {
  /** Call once per physics step, after the cars have moved. */
  update: (world: World) => void
  /** Forget a car's progress — for a reset, which is not a lap. */
  restart: (car: Car, world: World) => void
  timing: (carId: number) => LapTiming | undefined
  /** Where the car was last located. Live, and mutated every step. */
  positionOf: (carId: number) => TrackPosition | undefined
}

interface Progress {
  position: TrackPosition
  timing: LapTiming
  /** `world.time` when the current lap began, ms. */
  lapStarted: number
  /**
   * False until the car has been located once.
   *
   * The first update has nothing to compare against: `distanceAlongTrack` starts
   * at zero, so a car placed anywhere but the start line would look like it had
   * just driven there — and on a grid, that is every car but one.
   */
  located: boolean
}

const newProgress = (): Progress => ({
  position: createTrackPosition(),
  timing: { current: 0, last: null, best: null },
  lapStarted: 0,
  located: false,
})

export function createRaceDirector(index: TrackIndex): RaceDirector {
  const { length } = index.track
  // Allocated on first sight of a car and reused — this runs at 60Hz per car.
  const progress = new Map<number, Progress>()

  const forCar = (car: Car): Progress => {
    let state = progress.get(car.id)
    if (!state) {
      state = newProgress()
      progress.set(car.id, state)
    }
    return state
  }

  return {
    update(world) {
      for (const car of world.cars) {
        const state = forCar(car)
        const where = locate(index, car.position.x, car.position.z, state.position)

        // Read by `physics/` on the *next* step. See the note on `Car.surface`.
        car.surface.grip = surfaceGrip(where.surface)
        car.surface.drag = surfaceDrag(where.surface)

        if (!state.located) {
          state.located = true
          state.lapStarted = world.time
        } else {
          // `lapDelta` gives the short way round, so this is the unwrapped
          // distance the car would be at if the lap did not repeat. Below zero
          // or past the length means it crossed the line, and which side tells
          // you which way.
          const unwrapped =
            car.distanceAlongTrack + lapDelta(car.distanceAlongTrack, where.distanceAlong, length)

          if (unwrapped >= length) {
            car.lap += 1
            state.timing.last = world.time - state.lapStarted
            if (state.timing.best === null || state.timing.last < state.timing.best) {
              state.timing.best = state.timing.last
            }
            state.lapStarted = world.time
          } else if (unwrapped < 0) {
            // Reversing over the line. The lap in progress is void either way,
            // so the clock restarts rather than resuming where it left off —
            // there is no honest time to award someone who drove backwards
            // across the line and turned round.
            car.lap -= 1
            state.timing.last = null
            state.lapStarted = world.time
          }
        }

        car.distanceAlongTrack = where.distanceAlong
        state.timing.current = world.time - state.lapStarted
      }

      // Leader first. Race distance is monotonic in lap-and-distance, which is
      // what makes this a sort rather than a special case at the line.
      const order = world.cars.map((car) => ({
        id: car.id,
        distance: car.lap * length + car.distanceAlongTrack,
      }))
      order.sort((a, b) => b.distance - a.distance)
      world.race.standings = order.map((entry) => entry.id)
    },

    restart(car, world) {
      const state = forCar(car)
      state.located = false
      state.lapStarted = world.time
      state.timing.current = 0
      state.timing.last = null
      // `best` survives deliberately: a reset costs you the lap you were on, not
      // the one you already set.
    },

    timing: (carId) => progress.get(carId)?.timing,
    positionOf: (carId) => progress.get(carId)?.position,
  }
}
