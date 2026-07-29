/**
 * The single mutable state container.
 *
 * Deliberately plain and mutable: allocating fresh state for every car at 60Hz
 * creates GC pressure that shows up as frame hitching. See ARCHITECTURE.md.
 *
 * Only `physics/` and `game/` may write to this. Everything else reads.
 */

import { vec2, type Vec2 } from './math'

/** Normalised driver intent. Produced identically by `input/` and `ai/`. */
export interface InputState {
  /** -1 full left .. 1 full right */
  steer: number
  /** 0 .. 1 */
  throttle: number
  /** 0 .. 1 */
  brake: number
  handbrake: boolean
}

export const createInputState = (): InputState => ({
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
})

/**
 * Per-car state. `previous*` fields hold the pose from the last physics step so
 * `render/` can interpolate between steps — without them, motion micro-stutters.
 */
export interface Car {
  id: number
  isPlayer: boolean

  position: Vec2
  /** Heading in radians; 0 faces +z. */
  heading: number
  velocity: Vec2
  /** Rotation rate in rad/s. */
  yawRate: number

  previousPosition: Vec2
  previousHeading: number

  input: InputState

  lap: number
  /** Metres travelled along the centreline; drives standings and lap validation. */
  distanceAlongTrack: number
}

export function createCar(id: number, isPlayer = false): Car {
  return {
    id,
    isPlayer,
    position: vec2(),
    heading: 0,
    velocity: vec2(),
    yawRate: 0,
    previousPosition: vec2(),
    previousHeading: 0,
    input: createInputState(),
    lap: 0,
    distanceAlongTrack: 0,
  }
}

export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finished'

export interface RaceState {
  phase: RacePhase
  totalLaps: number
  /** Car ids, leader first. */
  standings: number[]
}

export interface World {
  /** Accumulated simulation time in ms. The only clock for game timing. */
  time: number
  cars: Car[]
  race: RaceState
  /** Populated in M2. */
  track: null
}

export function createWorld(): World {
  return {
    time: 0,
    cars: [],
    race: { phase: 'idle', totalLaps: 3, standings: [] },
    track: null,
  }
}
