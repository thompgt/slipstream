/**
 * Hitting the wall.
 *
 * Pure, like the rest of `physics/` — it takes a car, a setup, and a function
 * that answers "is this point inside a barrier?". It has no idea what a circuit
 * is, which is what lets it be tested against a flat wall in Node.
 *
 * ## Why two contact points and not one
 *
 * The vehicle model is a bicycle model: the car is a point with a heading. Test
 * that point against the wall and every impact is a head-on one — the car stops
 * dead, square, and pointing the way it was. That is the arcade version, and
 * CLAUDE.md rules it out by name.
 *
 * So the test is against the two axles rather than the centre of mass, each
 * widened by half the car's width. A glancing hit puts one axle in the wall and
 * not the other, the correction is applied at that axle, and the offset from the
 * CG turns the impulse into yaw. Clip the barrier with the nose at Parabolica
 * and the car is spat into a spin, which is what actually happens.
 *
 * ## Restitution and scrub
 *
 * F1 barriers are built to absorb, not to return: an Armco with a tyre wall or a
 * TecPro stack gives back very little of what you bring to it. `RESTITUTION` is
 * accordingly low — high values are the single easiest way to make a game feel
 * like a pinball table. What actually costs you the lap is `SCRUB`, the friction
 * on the component of velocity running *along* the wall, because scraping down a
 * barrier at 200kph should not be a fast way through a corner.
 */

import { clamp } from '../core/math'
import type { Car, WallContact, WallQuery } from '../core/world'
import { carSetup, type CarSetup } from './carSetup'
import { applyImpact } from './damage'

/**
 * Fraction of closing speed returned by the barrier.
 *
 * Deliberately small. Real energy-absorbing barriers give back almost nothing,
 * and anything springy reads immediately as arcade.
 */
const RESTITUTION = 0.18

/**
 * Coulomb friction between bodywork and barrier.
 *
 * Deliberately a coefficient on the *normal impulse* and not a fraction of the
 * along-wall speed. A fraction is a rate in disguise: keeping 82% of your speed
 * per contact means keeping 0.82^60 of it per second, so a car resting against a
 * barrier is deleted in a third of a second and the same code behaves
 * differently at a different timestep — precisely what the fixed-timestep rule
 * exists to prevent. Bounded by the normal impulse, a hard hit scrubs hard and a
 * light graze barely scrubs at all, which is both correct and self-limiting.
 */
const FRICTION = 0.75

/**
 * How much of the impulse at an axle becomes yaw, relative to the rigid-body
 * answer.
 *
 * Well below 1 because the contact is a smear along a length of bodywork, not
 * the point this model pretends it is, and the true contact patch straddles the
 * CG far more than the axle position suggests. The rigid-body answer with this
 * car's 900 kg m^2 of yaw inertia hands a 5m/s brush of the front wing more than
 * four radians a second, which is a pirouette, not a moment lost.
 */
const SPIN = 0.2

/** rad/s. Roughly two-thirds of a spin per second — past that it is a cartoon. */
const MAX_YAW_RATE = 4

/**
 * Time constant for a recorded impact to fade, seconds.
 *
 * Short, because a hit is a jolt and not a hum. At a second the camera is still
 * visibly ringing three seconds after you clipped a barrier, which reads as the
 * car having broken rather than as an impact.
 */
const IMPACT_DECAY = 0.35

/** Below this closing speed it is a scrape, not a hit — no shake, no bang. */
const IMPACT_FLOOR = 1.5

/** Scratch, reused every step for every car. Same reasoning as `car.ts`. */
const contact: WallContact = { depth: 0, normalX: 0, normalZ: 1 }

/**
 * Resolve the car against the barriers, in place, after it has moved.
 *
 * Returns the closing speed of the hardest contact this step, in m/s, or zero if
 * the car is clear. Called at the end of `stepCar`, on the position the car
 * actually reached — not on last step's, which at 90m/s would let the nose reach
 * a metre and a half into a wall before anything noticed.
 */
export function resolveWalls(
  car: Car,
  dt: number,
  walls: WallQuery,
  setup: CarSetup = carSetup,
): number {
  const s = dt / 1000
  const { chassis } = setup

  // Fade whatever the last hit left behind before this step can add to it.
  car.impact *= Math.exp(-s / IMPACT_DECAY)
  if (car.impact < 0.01) car.impact = 0

  const distanceToFront = chassis.wheelbase * (1 - chassis.frontWeightBias)
  const distanceToRear = chassis.wheelbase * chassis.frontWeightBias

  const sinH = Math.sin(car.heading)
  const cosH = Math.cos(car.heading)

  let hardest = 0

  // Front axle first, then rear. Sequential rather than solved together: a car
  // wedged into a corner of two walls is not a case this circuit can produce,
  // and resolving one contact at a time is stable where a joint solve needs care
  // it would not repay.
  for (const arm of [distanceToFront, -distanceToRear]) {
    const pointX = car.position.x + sinH * arm
    const pointZ = car.position.z + cosH * arm

    // Half the bodywork width as the probe radius: the barrier stops the wing
    // endplate and the sidepod, not the centreline the axle point sits on.
    if (!walls(pointX, pointZ, chassis.width / 2, contact)) continue

    const { normalX, normalZ, depth } = contact

    // --- push out -------------------------------------------------------------
    // Applied at the CG, so the car translates rather than pivoting out of the
    // wall. Pivoting would rotate the *other* axle further in, and two contacts
    // taking turns to push each other into the barrier is how a car ends up
    // vibrating along it.
    car.position.x += normalX * depth
    car.position.z += normalZ * depth

    // --- velocity at the contact point ---------------------------------------
    // Includes the rotational term: a car that is spinning can be driving its
    // nose into a wall its CG is moving away from.
    const contactVx = car.velocity.x + car.yawRate * cosH * arm
    const contactVz = car.velocity.z - car.yawRate * sinH * arm

    const closing = -(contactVx * normalX + contactVz * normalZ)
    if (closing <= 0) continue // sliding out of it already
    if (closing > hardest) hardest = closing

    // Split the CG velocity about the wall plane and rebuild it: the normal part
    // reversed and mostly absorbed, the tangential part scrubbed by a friction
    // impulse the normal one bounds.
    const normalSpeed = car.velocity.x * normalX + car.velocity.z * normalZ
    const tangentX = car.velocity.x - normalSpeed * normalX
    const tangentZ = car.velocity.z - normalSpeed * normalZ

    // Per unit mass — the whole solve is, so mass cancels everywhere but the
    // yaw term below, which needs the real impulse against a real inertia.
    const normalImpulse = closing * (1 + RESTITUTION)
    const tangentSpeed = Math.hypot(tangentX, tangentZ)
    // Cannot exceed the speed it is removing: friction stops a slide, it does
    // not reverse one.
    const scrub = Math.min(tangentSpeed, FRICTION * normalImpulse)
    const kept = tangentSpeed > 1e-6 ? 1 - scrub / tangentSpeed : 0

    const bounce = closing * RESTITUTION
    car.velocity.x = tangentX * kept + normalX * bounce
    car.velocity.z = tangentZ * kept + normalZ * bounce

    // --- yaw ------------------------------------------------------------------
    // The impulse acts along the normal at a point `arm` ahead of the CG. Its
    // moment is the component of that normal across the car's own axis, which is
    // why a square hit produces no rotation and a clipped nose produces plenty.
    const acrossCar = normalX * cosH - normalZ * sinH
    const moment =
      (normalImpulse * chassis.mass * arm * acrossCar * SPIN) / chassis.yawInertia

    // Clamped: an impulse resolved in one step is not a physical impulse, and
    // without a bound a fast enough clip hands the car a yaw rate no amount of
    // damping recovers from within the same second.
    car.yawRate = clamp(car.yawRate + moment, -MAX_YAW_RATE, MAX_YAW_RATE)

    // --- damage -----------------------------------------------------------------
    // The normal's forward component in the body frame says how square the hit
    // was, which is the difference between a wing torn off and a floor dragged
    // down a barrier. It is the same decomposition as `acrossCar` above, one
    // axis over, so the collision solve already knows everything damage needs.
    const alongCar = normalX * sinH + normalZ * cosH
    applyImpact(car.damage, closing, arm > 0, Math.abs(alongCar))
  }

  if (hardest > IMPACT_FLOOR && hardest > car.impact) car.impact = hardest
  return hardest
}
