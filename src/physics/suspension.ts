/**
 * Vertical load on each of the four wheels.
 *
 * Supersedes the per-axle `weightTransfer.ts`. The axle totals are unchanged —
 * lateral transfer is antisymmetric within an axle, so it sums to zero — which
 * means this file on its own cannot alter how the car drives. That is
 * deliberate: it makes the four-wheel migration a step whose correctness can be
 * asserted rather than felt, and it is why the regression suite must pass
 * untouched alongside it.
 *
 * What it unlocks comes later, and comes from one number. Tyre grip is
 * sub-linear in load: a wheel carrying 6kN does not have twice the grip of one
 * carrying 3kN. So moving load *within* an axle, which changes nothing here,
 * loses that axle grip once `TyreSetup.loadSensitivity` is non-zero. That is the
 * whole mechanism behind anti-roll bar tuning, four-wheel drift behaviour, and a
 * lifted inside wheel meaning something.
 *
 * Quasi-static: no suspension travel, no damper lag. Load transfer here is
 * instant, where a real car takes a hundred milliseconds or so to settle.
 */

import { GRAVITY, type CarSetup } from './carSetup'

/**
 * Wheel order, fixed forever. Damage, telemetry, and rendering all index by it.
 *
 * A tuple rather than an array so that under `noUncheckedIndexedAccess` a
 * literal index is `number`, not `number | undefined` — this is read four times
 * per car per step and the guards would be pure noise.
 */
export type WheelLoads = [front_left: number, front_right: number, rear_left: number, rear_right: number]

export const FL = 0
export const FR = 1
export const RL = 2
export const RR = 3

export const createWheelLoads = (): WheelLoads => [0, 0, 0, 0]

/**
 * The four wheel loads summed back to two axles.
 *
 * The tyre model is still per axle, so `car.ts` folds the wheels back together
 * each step. The type lives here rather than in the retired per-axle solve it
 * used to belong to.
 */
export interface AxleLoads {
  /** Newtons on the front axle. */
  front: number
  /** Newtons on the rear axle. */
  rear: number
}

/**
 * Roll stiffness of one axle, Nm/rad: its bar plus what its springs already
 * contribute. Two springs a track width apart resist roll with `k·t²/2`.
 */
export const axleRollStiffness = (springRate: number, antiRoll: number, track: number): number =>
  antiRoll + (springRate * track * track) / 2

/**
 * Height of the roll axis directly beneath the centre of gravity, m.
 *
 * The roll centres are defined at the axles, so this interpolates between them
 * at the CG's longitudinal position. `frontWeightBias` is the fraction of weight
 * on the front axle, so the CG sits that fraction of the wheelbase *back from*
 * the front — hence the bias weights the front roll centre.
 */
export const rollAxisHeight = (setup: CarSetup): number => {
  const { rollCentreFront, rollCentreRear } = setup.suspension
  const bias = setup.chassis.frontWeightBias
  return rollCentreFront * bias + rollCentreRear * (1 - bias)
}

/**
 * Steady-state roll angle, radians, positive leaning right.
 *
 * Output only — nothing downstream feeds it back into the tyres. It exists for
 * the renderer (a car that does not lean reads as a toy) and, later, for ride
 * height and therefore aero.
 */
export function rollAngle(lateralAccel: number, setup: CarSetup): number {
  const { chassis, suspension } = setup
  const arm = chassis.cgHeight - rollAxisHeight(setup)

  const total =
    axleRollStiffness(suspension.springRateFront, suspension.antiRollFront, suspension.trackFront) +
    axleRollStiffness(suspension.springRateRear, suspension.antiRollRear, suspension.trackRear)

  // The `m·g·arm` term is the destabilising moment of a mass held above its own
  // roll axis — it makes the car want to keep rolling once it starts. On a stiff
  // car it is a rounding error, but leaving it out of a soft setup would
  // understate roll, and a non-positive denominator means the car would fall
  // over, so clamp rather than return an absurd angle.
  const denominator = total - chassis.mass * GRAVITY * arm
  if (denominator <= 0) return 0

  return (chassis.mass * lateralAccel * arm) / denominator
}

/**
 * Load on each wheel, N.
 *
 * @param longitudinalAccel m/s^2 forward. Negative under braking, which moves
 *   load onto the front axle.
 * @param lateralAccel m/s^2 rightward. Load transfers *away* from the direction
 *   of acceleration, so a right-hand corner loads the left-hand wheels.
 * @param speed m/s, for downforce.
 * @param out Mutated and returned. Called for every car every step; allocating
 *   here is measurable GC pressure at 60Hz.
 */
export function wheelLoads(
  longitudinalAccel: number,
  lateralAccel: number,
  speed: number,
  setup: CarSetup,
  out: WheelLoads = createWheelLoads(),
): WheelLoads {
  const { chassis, aero, suspension } = setup

  const weight = chassis.mass * GRAVITY
  const staticFront = weight * chassis.frontWeightBias
  const staticRear = weight - staticFront

  // --- longitudinal: front to rear ------------------------------------------
  const longTransfer = (chassis.mass * longitudinalAccel * chassis.cgHeight) / chassis.wheelbase

  // --- aero ------------------------------------------------------------------
  const downforce = aero.downforce * speed * speed
  const downforceFront = downforce * aero.balanceFront
  const downforceRear = downforce - downforceFront

  // Everything above is per axle. Split evenly, then move load side to side.
  const front = (staticFront - longTransfer + downforceFront) / 2
  const rear = (staticRear + longTransfer + downforceRear) / 2

  // --- lateral: side to side --------------------------------------------------
  // Two paths, and the split between them is what makes roll centre height a
  // real setup lever rather than decoration:
  //
  //   geometric — reacted through the suspension links at the roll centre. Acts
  //     instantly and causes no roll at all.
  //   elastic — reacted through the springs and bars above the roll axis. This
  //     is the part that rolls the car, and it is divided between the axles in
  //     proportion to their roll stiffness.
  //
  // Only the elastic split is tunable, which is exactly why anti-roll bars
  // change the balance and roll centres change how much there is to divide.
  const stiffnessFront = axleRollStiffness(
    suspension.springRateFront,
    suspension.antiRollFront,
    suspension.trackFront,
  )
  const stiffnessRear = axleRollStiffness(
    suspension.springRateRear,
    suspension.antiRollRear,
    suspension.trackRear,
  )
  const stiffnessTotal = stiffnessFront + stiffnessRear

  const arm = chassis.cgHeight - rollAxisHeight(setup)
  const lateralForce = chassis.mass * lateralAccel

  const geometricFront =
    (lateralForce * chassis.frontWeightBias * suspension.rollCentreFront) / suspension.trackFront
  const geometricRear =
    (lateralForce * (1 - chassis.frontWeightBias) * suspension.rollCentreRear) /
    suspension.trackRear

  const elasticTotal = lateralForce * arm
  const elasticFront =
    stiffnessTotal > 0 ? (elasticTotal * (stiffnessFront / stiffnessTotal)) / suspension.trackFront : 0
  const elasticRear =
    stiffnessTotal > 0 ? (elasticTotal * (stiffnessRear / stiffnessTotal)) / suspension.trackRear : 0

  const lateralFront = geometricFront + elasticFront
  const lateralRear = geometricRear + elasticRear

  shareAcrossAxle(front, lateralFront, out, FL, FR)
  shareAcrossAxle(rear, lateralRear, out, RL, RR)

  return out
}

/**
 * Split one axle's load across its two wheels, handling a lifted wheel.
 *
 * @param half Half the axle's total load, N.
 * @param transfer Load moved onto the left wheel and off the right, N.
 *
 * The subtlety is what to do when the transfer exceeds the load available. The
 * obvious `Math.max(0, ...)` on each wheel is wrong: it zeroes the inside wheel
 * while leaving the outside one where it was, inventing load that the car is not
 * carrying — several hundred newtons of free grip, appearing exactly when the
 * car is at its limit and least able to afford a surprise.
 *
 * The wheel really has left the ground, so its share goes to the other one. That
 * conserves the axle total, which is what lets the four-wheel model be checked
 * against the per-axle solve it replaced.
 */
function shareAcrossAxle(
  half: number,
  transfer: number,
  out: WheelLoads,
  left: number,
  right: number,
): void {
  const total = half * 2

  // The whole axle is unloaded — possible under violent braking, where the rear
  // wants to lift bodily.
  if (total <= 0) {
    out[left] = 0
    out[right] = 0
    return
  }

  const leftLoad = half + transfer
  const rightLoad = half - transfer

  if (rightLoad < 0) {
    out[left] = total
    out[right] = 0
  } else if (leftLoad < 0) {
    out[left] = 0
    out[right] = total
  } else {
    out[left] = leftLoad
    out[right] = rightLoad
  }
}
