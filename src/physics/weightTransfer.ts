/**
 * Vertical load on each axle.
 *
 * Grip is proportional to load, so this function is what makes braking give the
 * front end bite and throttle give the rear end traction. It's also the other
 * half of trail braking: coming off the brakes slowly keeps load on the front
 * while the car is turning, so the front axle keeps its extra grip through the
 * moment you need it most.
 *
 * Quasi-static — no suspension travel, no roll, no pitch dynamics. A real car's
 * load transfer lags the input by a hundred milliseconds or so; here it's
 * instant. That difference is exactly what `chassis.yawDamping` stands in for.
 */

import { GRAVITY, type CarSetup } from './carSetup'

export interface AxleLoads {
  /** Newtons on the front axle. */
  front: number
  /** Newtons on the rear axle. */
  rear: number
}

/**
 * @param longitudinalAccel m/s^2 in the car's forward direction. Negative under
 *   braking, which moves load forward.
 * @param speed m/s, for the downforce term.
 * @param out Optional target, mutated and returned. The sim path calls this
 *   every step for every car; allocating a fresh object each time is measurable
 *   GC pressure at 60Hz.
 */
export function axleLoads(
  longitudinalAccel: number,
  speed: number,
  setup: CarSetup,
  out: AxleLoads = { front: 0, rear: 0 },
): AxleLoads {
  const { chassis, aero } = setup

  const weight = chassis.mass * GRAVITY
  const staticFront = weight * chassis.frontWeightBias
  const staticRear = weight - staticFront

  // Load transferred rearward, N. Braking makes this negative, so the front gains.
  const transfer = (chassis.mass * longitudinalAccel * chassis.cgHeight) / chassis.wheelbase

  // Scales with speed squared, so grip roughly doubles between 100 and 250kph —
  // the reason a fast corner is a completely different problem to a slow one.
  const downforce = aero.downforce * speed * speed

  // Clamped at zero: under extreme braking the maths wants to lift the rear off
  // the ground, and negative load would flip the sign of that axle's grip.
  out.front = Math.max(0, staticFront - transfer + downforce * aero.balanceFront)
  out.rear = Math.max(0, staticRear + transfer + downforce * (1 - aero.balanceFront))
  return out
}
