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
 * What the car is currently driving on, reduced to the two numbers the physics
 * needs.
 *
 * Declared here for the same reason `InputState` is: it is a contract between
 * two modules that must not import each other. `track/` knows that gravel is
 * gravel; `physics/` only ever needs to know that grip is scaled by 0.38 and
 * rolling resistance by 12. Passing the reduced form keeps `physics/` free of
 * any notion of a circuit — which is what lets the whole model still run in Node
 * with no track at all.
 */
export interface SurfaceContact {
  /** Multiplies available tyre grip. 1 is dry asphalt. */
  grip: number
  /** Multiplies rolling resistance. 1 is dry asphalt. */
  drag: number
}

/** Dry asphalt — the default, and what a car with no track under it drives on. */
export const createSurfaceContact = (): SurfaceContact => ({ grip: 1, drag: 1 })

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

  /**
   * Body-frame lateral acceleration, m/s^2, rightward, from the previous step.
   *
   * Same one-step feedback as `longitudinalAccel`, for the same reason: load
   * transfer depends on acceleration and acceleration depends on load. 16ms of
   * lag at 60Hz, in exchange for a closed-form step.
   */
  lateralAccel: number

  /**
   * Written by `game/` from the track query, read by `physics/`.
   *
   * A step reads the surface found under the car at the *end of the previous*
   * step — the same one-frame feedback as the accelerations above, and for the
   * same reason: locating the car needs its new position, and the physics needs
   * the surface before it moves. 16ms of lag at the moment two wheels cross a
   * white line is not something a driver can perceive.
   */
  surface: SurfaceContact

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
    lateralAccel: 0,
    surface: createSurfaceContact(),
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
