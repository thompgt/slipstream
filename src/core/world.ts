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
 * Read-only-by-convention diagnostics, refreshed every physics step.
 *
 * Written by `physics/`, read by `ui/`. It lives on the car rather than being
 * returned from `stepCar` so there is nothing to allocate at 60Hz. Tuning the
 * tyre model without these numbers on screen is guesswork — PLAN.md calls that
 * out as M1's first trap.
 */
export interface CarTelemetry {
  /** m/s */
  speed: number
  rpm: number
  gear: number
  /** Radians. Positive means the axle is sliding toward the outside of the turn. */
  slipAngleFront: number
  slipAngleRear: number
  /** Newtons. */
  loadFront: number
  loadRear: number
  /** Aerodynamic downforce, N. */
  downforce: number
  /** Body-frame accelerations in g. */
  longitudinalG: number
  lateralG: number
  /** 0..1 — how much of each axle's friction circle is spent. >1 means sliding. */
  gripUsageFront: number
  gripUsageRear: number
  /** Net longitudinal force at the driven axle, N. Negative under braking. */
  driveForce: number
}

export const createTelemetry = (): CarTelemetry => ({
  speed: 0,
  rpm: 0,
  gear: 1,
  slipAngleFront: 0,
  slipAngleRear: 0,
  loadFront: 0,
  loadRear: 0,
  downforce: 0,
  longitudinalG: 0,
  lateralG: 0,
  gripUsageFront: 0,
  gripUsageRear: 0,
  driveForce: 0,
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

  // Drivetrain. Structurally a `physics/gearbox.GearboxState` — the shape is
  // declared here because `core/` imports nothing, by design.
  /** 1-based. */
  gear: number
  rpm: number
  /** Seconds of torque cut remaining after a shift. */
  shiftTimer: number

  /**
   * Body-frame longitudinal acceleration, m/s^2, from the previous step.
   *
   * Weight transfer depends on acceleration, and acceleration depends on grip,
   * which depends on weight transfer. Rather than solve that implicitly, we feed
   * back last step's value — one step of lag at 60Hz, which is 16ms and
   * invisible, in exchange for a closed-form step.
   */
  longitudinalAccel: number

  telemetry: CarTelemetry

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
    gear: 1,
    rpm: 0,
    shiftTimer: 0,
    longitudinalAccel: 0,
    telemetry: createTelemetry(),
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
