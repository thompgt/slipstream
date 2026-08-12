/**
 * How the car moves *on* itself — steering, wheel rotation, and the way the body
 * leans on its suspension.
 *
 * All of it is cosmetic and all of it is render-side. The simulation already
 * knows the car is braking; nothing here tells it anything. But a rigid car
 * whose wheels point straight ahead through a chicane is the single loudest
 * "this is a prototype" signal left after the lighting, because the car visibly
 * does not respond to the thing the player is doing with their hands.
 *
 * The functions are pure and the constants are in one object, for the reason
 * ARCHITECTURE.md gives for `cameraSetup`: these are numbers about *watching* the
 * car, not about the car, and putting them in `physics/carSetup.ts` is what
 * previously dragged `render/` into importing `physics/`. Being pure also means
 * they are testable, which matters — the sign conventions below are the kind of
 * thing that is wrong 50% of the time on the first go and looks *nearly* right
 * when it is.
 */

/** Render-side tuning for how the car carries itself. */
export const carMotion = {
  /**
   * Front wheel angle at full lock, radians.
   *
   * ~17 degrees. Far less than a road car, which is correct and looks wrong
   * until you know it: an F1 car has very little steering lock, and drawing it
   * with 35 degrees like a hatchback is a giveaway.
   */
  steerLock: 0.3,

  /** Body pitch per g of longitudinal acceleration, radians. Nose-down braking. */
  pitchGain: 0.014,
  /** Body roll per g of lateral acceleration, radians. Leans away from the turn. */
  rollGain: 0.011,
  /** Ceilings. F1 suspension is stiff enough that the real numbers are tiny. */
  maxPitch: 0.045,
  maxRoll: 0.038,

  /**
   * How fast the body settles onto a new attitude, 1/s.
   *
   * Not instant, because the accelerations it follows come from a 60Hz solver
   * and step visibly when a tyre lets go. Not slow either — a body that keeps
   * leaning after the corner reads as a boat.
   */
  attitudeStiffness: 11,
} as const

export interface Attitude {
  /** Radians. Positive is nose-down. */
  pitch: number
  /** Radians. Positive raises the right-hand side. */
  roll: number
}

const clamp = (value: number, limit: number): number => Math.min(Math.max(value, -limit), limit)

/**
 * Where the body wants to sit, given what the car is doing.
 *
 * Both signs are worth stating because both are easy to invert. Braking gives a
 * negative `longitudinalG`, and the nose must go *down*, so the pitch is
 * negated. Turning right gives a positive `lateralG`, and the body leans
 * *left* — which raises the right-hand side, so the roll is not.
 */
export function bodyAttitude(longitudinalG: number, lateralG: number): Attitude {
  return {
    pitch: clamp(-longitudinalG * carMotion.pitchGain, carMotion.maxPitch),
    roll: clamp(lateralG * carMotion.rollGain, carMotion.maxRoll),
  }
}

/**
 * Front wheel angle for a driver input.
 *
 * `steer` is +1 at full right lock and the wheel turns toward +x, which is the
 * car's right — so this is a straight scale with no sign flip. It reads the
 * driver's *input* rather than any slip angle the physics computed, because the
 * player's hands are what they expect the wheels to follow.
 */
export const steerAngle = (steer: number): number => steer * carMotion.steerLock

/**
 * Radians a wheel of this radius turns in `dt` seconds at this road speed.
 *
 * Derived from road speed rather than from wheel speed, so it cannot show
 * wheelspin or a locked front. That is a real limitation and it is deliberate:
 * the physics does not currently expose per-wheel angular velocity, and faking
 * it from throttle position would be an animation that lies about the
 * simulation. When the tyre model carries wheel speed, this takes it instead.
 */
export const rollRate = (speed: number, radius: number, dt: number): number => (speed / radius) * dt

/**
 * Framerate-independent exponential approach.
 *
 * The naive `current += (target - current) * k` moves a different fraction of
 * the way per second at 30fps than at 144fps, which would make the body lean
 * further on a slow machine.
 */
export const approach = (current: number, target: number, stiffness: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-stiffness * dt))

/**
 * Steering and spin for one frame, as the renderer needs them.
 *
 * Bundled because the two are always wanted together and the alternative is
 * three call sites in the draw loop doing arithmetic, which is where sign errors
 * hide.
 */
export function wheelAngles(
  steer: number,
  speed: number,
  dt: number,
  radii: { front: number; rear: number },
): { steer: number; frontSpin: number; rearSpin: number } {
  return {
    steer: steerAngle(steer),
    frontSpin: rollRate(speed, radii.front, dt),
    rearSpin: rollRate(speed, radii.rear, dt),
  }
}
