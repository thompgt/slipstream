/**
 * What hitting things costs you.
 *
 * CLAUDE.md names damage as the one place this should beat the big F1 games,
 * and the thing those games get wrong is not the visuals — it is that a
 * destroyed front wing costs you a second a lap and a pit stop, rather than
 * costing you the car. Here it costs you the car.
 *
 * ## Why only three parts
 *
 * Every component in `CarDamage` has to change how the car drives, or it is
 * decoration. A 2D bicycle model with per-axle load can express exactly one
 * family of failures properly: aerodynamic ones. Front wing, rear wing, floor.
 * A punctured tyre or a bent wishbone needs per-wheel slip and suspension
 * travel, neither of which exists yet, and inventing a fudge for them now would
 * be the same forgiving hand-wave in the other direction.
 *
 * ## Why it is quadratic in closing speed
 *
 * Structures break on energy, not on speed, and energy goes as the square. That
 * one exponent is what makes the difference between a brush and a shunt feel
 * right without any thresholds beyond the two below: at 5m/s you scuff an
 * endplate, at 25m/s the wing is gone, and nothing in between needs a rule.
 *
 * ## What a broken car feels like
 *
 * Not "slower". A lost front wing understeers into every corner while still
 * doing 320 down the straight, and a lost rear wing is *faster* on the straight
 * and terrifying at Ascari. That asymmetry is the point — see `damagedAero`.
 */

import { clamp } from '../core/math'
import type { CarDamage } from '../core/world'
import type { CarSetup } from './carSetup'

/** Below this closing speed, m/s, nothing breaks. Kerbs and parking are free. */
const DAMAGE_FLOOR = 2

/**
 * Closing speed, m/s, that writes off in one hit whatever it lands on.
 *
 * ~100kph square into an Armco. Real F1 wings are more fragile than this and
 * real barriers are softer than this model's, and the two roughly cancel.
 */
const WRITE_OFF = 26

/**
 * How a hit at one end of the car is shared between the wing at that end and
 * the floor, split by whether it arrived square or as a glance.
 *
 * A square hit is a wing impact almost entirely: that is the part that sticks
 * out furthest and is designed to fail first. A glance along the side of the
 * car loads the endplate and then drags down the whole length of the floor,
 * which is why the sideways column moves so much more onto it.
 */
const SHARE = {
  wingHeadOn: 0.85,
  wingGlance: 0.35,
  floorHeadOn: 0.15,
  floorGlance: 0.4,
} as const

/**
 * Record the damage done by one wall contact.
 *
 * @param closing m/s of closing speed at the contact point.
 * @param atFront true if the contact was at the front axle.
 * @param headOn 0 for a pure sideways scrape, 1 for square into the wall.
 *   `Math.abs` of the wall normal's forward component in the body frame.
 */
export function applyImpact(
  damage: CarDamage,
  closing: number,
  atFront: boolean,
  headOn: number,
): void {
  if (closing <= DAMAGE_FLOOR) return

  const scaled = (closing - DAMAGE_FLOOR) / (WRITE_OFF - DAMAGE_FLOOR)
  const severity = Math.min(scaled * scaled, 1)

  const square = clamp(headOn, 0, 1)
  const glance = 1 - square

  const wing = severity * (SHARE.wingHeadOn * square + SHARE.wingGlance * glance)
  const floor = severity * (SHARE.floorHeadOn * square + SHARE.floorGlance * glance)

  if (atFront) damage.frontWing = add(damage.frontWing, wing)
  else damage.rearWing = add(damage.rearWing, wing)
  damage.floor = add(damage.floor, floor)
}

const add = (current: number, extra: number): number => Math.min(current + extra, 1)

/**
 * How much of each surface's downforce survives being destroyed.
 *
 * Not zero for the wings: a wing that has lost its flaps and half an endplate
 * is still a plane in an airstream, and the front of an F1 car makes some
 * downforce from its nose and floor leading edge whatever is bolted to it. The
 * floor keeps least of all, because the thing that kills ground effect is
 * losing the seal to the road, and a damaged floor has lost it everywhere.
 */
const SURVIVES = { frontWing: 0.35, rearWing: 0.4, floor: 0.15 } as const

/**
 * How much of the *other* end's downforce a broken part takes with it.
 *
 * This is what makes damage a handling problem rather than a lap-time tax. An
 * F1 car is one aerodynamic system: the front wing's job is as much to feed
 * clean air down the car as to make load itself, so losing it starves the floor
 * behind it, and losing the floor unloads the rear wing sitting in its wake. A
 * model where each surface only loses its own share would make a broken car
 * merely slower, and a broken car is not slower — it is unbalanced.
 */
const KNOCK_ON = { frontWingOnRear: 0.3, floorOnRear: 0.45, rearWingOnFront: 0.1 } as const

/**
 * Drag change per unit of damage.
 *
 * The signs are the interesting part and they are not the same. A front wing
 * hanging off its mounts is a brake bolted to the nose — more drag, not less.
 * A rear wing that has gone is the single biggest drag item on the car leaving
 * with it, so a car with no rear wing is *quicker* in a straight line. Anyone
 * who has watched a driver limp a wingless car past the pit wall at full speed
 * and then go straight on at the first corner has seen exactly this.
 */
const DRAG = { frontWing: 0.3, rearWing: -0.25, floor: 0.05 } as const

/** The aero the car actually has, as opposed to the one it left the garage with. */
export interface AeroState {
  /** Downforce = coefficient * speed^2, N. */
  downforce: number
  /** Fraction of that downforce over the front axle. */
  balanceFront: number
  /** Drag = coefficient * speed^2, N. */
  drag: number
}

export const createAeroState = (): AeroState => ({ downforce: 0, balanceFront: 0.5, drag: 0 })

/**
 * Fold damage into the setup's aerodynamics.
 *
 * Mutates and returns `out` — this is called once per car per step, and the
 * no-allocation rule applies here as everywhere on the 60Hz path.
 *
 * Front and rear are solved as separate downforce figures and only recombined
 * into a total and a balance at the end, because the balance is the whole
 * point: `wheelLoads` splits by `balanceFront`, so this is the single number
 * through which a broken wing reaches the tyres.
 */
export function damagedAero(setup: CarSetup, damage: CarDamage, out: AeroState): AeroState {
  const { aero } = setup

  const baseFront = aero.downforce * aero.balanceFront
  const baseRear = aero.downforce - baseFront

  const front =
    baseFront *
    keeps(damage.frontWing, SURVIVES.frontWing) *
    (1 - KNOCK_ON.rearWingOnFront * damage.rearWing)

  const rear =
    baseRear *
    keeps(damage.rearWing, SURVIVES.rearWing) *
    (1 - KNOCK_ON.frontWingOnRear * damage.frontWing) *
    (1 - KNOCK_ON.floorOnRear * damage.floor)

  // The floor runs the length of the car, so its loss is taken off both ends
  // rather than assigned to one — the `floorOnRear` term above is the extra bite
  // it takes out of the rear on top of this.
  const floorFactor = keeps(damage.floor, SURVIVES.floor)

  const total = (front + rear) * floorFactor

  out.downforce = total
  // A car with no downforce at all still has to report a balance, and the
  // static one is the only honest answer: nothing is being divided.
  out.balanceFront = total > 0 ? (front * floorFactor) / total : aero.balanceFront
  out.drag =
    aero.drag *
    Math.max(
      0.2,
      1 +
        DRAG.frontWing * damage.frontWing +
        DRAG.rearWing * damage.rearWing +
        DRAG.floor * damage.floor,
    )

  return out
}

/** What fraction of a surface's contribution is left at this much damage. */
const keeps = (damage: number, survives: number): number => 1 - (1 - survives) * clamp(damage, 0, 1)
