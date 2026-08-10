import { describe, expect, it } from 'vitest'
import { carSetup, GRAVITY, type CarSetup } from './carSetup'
import {
  axleRollStiffness,
  createWheelLoads,
  FL,
  FR,
  RL,
  RR,
  rollAngle,
  rollAxisHeight,
  wheelLoads,
} from './suspension'

const setup: CarSetup = carSetup
const weight = setup.chassis.mass * GRAVITY

const clone = (): CarSetup => structuredClone(setup)

/**
 * The per-axle solve the four-wheel model replaced, written out here rather than
 * imported.
 *
 * `physics/weightTransfer.ts` existed only to be this oracle once the car
 * stopped calling it — a retired model sitting in `src/` alongside live code,
 * where it reads as something the game uses. Spelling the formula out in the
 * test that needs it keeps the migration contract asserted against an
 * independent expression, which is what an oracle is for, and leaves nothing in
 * the shipped bundle that nothing calls.
 */
const axleOracle = (
  longitudinalAccel: number,
  speed: number,
  s: CarSetup,
): { front: number; rear: number } => {
  const w = s.chassis.mass * GRAVITY
  const staticFront = w * s.chassis.frontWeightBias
  const transfer = (s.chassis.mass * longitudinalAccel * s.chassis.cgHeight) / s.chassis.wheelbase
  const downforce = s.aero.downforce * speed * speed

  return {
    front: Math.max(0, staticFront - transfer + downforce * s.aero.balanceFront),
    rear: Math.max(0, w - staticFront + transfer + downforce * (1 - s.aero.balanceFront)),
  }
}

/** The live model's axle totals — what `car.ts` actually feeds the tyres. */
const axles = (
  longitudinalAccel: number,
  lateralAccel: number,
  speed: number,
  s: CarSetup = setup,
): { front: number; rear: number } => {
  const l = wheelLoads(longitudinalAccel, lateralAccel, speed, s, createWheelLoads())
  return { front: l[FL] + l[FR], rear: l[RL] + l[RR] }
}

describe('wheelLoads — agreement with the per-axle model it replaces', () => {
  /**
   * The migration contract.
   *
   * Lateral transfer is antisymmetric within an axle, so summing the four wheels
   * back to two axles must reproduce the old solve *exactly*. If this ever
   * fails, the four-wheel model has started changing the car through a path
   * nobody chose, and the regression suite would only tell you afterwards.
   */
  it('sums to exactly the per-axle solve, at every combination of accelerations', () => {
    const out = createWheelLoads()

    for (const longitudinal of [-30, -12, 0, 5, 12]) {
      for (const lateral of [-25, -10, 0, 10, 25]) {
        for (const speed of [0, 30, 60, 90]) {
          wheelLoads(longitudinal, lateral, speed, setup, out)
          const expected = axleOracle(longitudinal, speed, setup)

          expect(out[FL] + out[FR]).toBeCloseTo(expected.front, 6)
          expect(out[RL] + out[RR]).toBeCloseTo(expected.rear, 6)
        }
      }
    }
  })

  it('carries exactly the car’s weight when static, split evenly across each axle', () => {
    const loads = wheelLoads(0, 0, 0, setup)

    expect(loads[FL]).toBeCloseTo((weight * setup.chassis.frontWeightBias) / 2, 6)
    expect(loads[FL]).toBeCloseTo(loads[FR], 9)
    expect(loads[RL]).toBeCloseTo(loads[RR], 9)
    expect(loads[FL] + loads[FR] + loads[RL] + loads[RR]).toBeCloseTo(weight, 6)
  })
})

/**
 * Properties of the longitudinal and aero terms, asserted against the live
 * four-wheel model.
 *
 * These were previously only asserted against the retired per-axle solve, so
 * they held for the model the car had stopped using and reached the real one
 * only by way of the equality contract above.
 */
describe('longitudinal transfer and aero', () => {
  it('carries exactly the car’s weight when static, split by the bias', () => {
    const loads = axles(0, 0, 0)
    expect(loads.front).toBeCloseTo(weight * setup.chassis.frontWeightBias, 6)
    expect(loads.front + loads.rear).toBeCloseTo(weight, 6)
  })

  it('conserves total load — transfer moves it, it does not create it', () => {
    for (const accel of [-30, -12, -1, 0, 1, 12, 30]) {
      expect(axles(accel, 0, 0).front + axles(accel, 0, 0).rear).toBeCloseTo(weight, 6)
    }
  })

  it('loads the front under braking — this is what gives the car turn-in bite', () => {
    const braking = axles(-12, 0, 0)
    const coasting = axles(0, 0, 0)
    expect(braking.front).toBeGreaterThan(coasting.front)
    expect(braking.rear).toBeLessThan(coasting.rear)
  })

  it('loads the rear under acceleration', () => {
    const accelerating = axles(12, 0, 0)
    const coasting = axles(0, 0, 0)
    expect(accelerating.rear).toBeGreaterThan(coasting.rear)
    expect(accelerating.front).toBeLessThan(coasting.front)
  })

  it('transfers more with a higher centre of gravity, and less over a longer wheelbase', () => {
    const low = clone()
    low.chassis.cgHeight = 0.2
    const high = clone()
    high.chassis.cgHeight = 0.6
    expect(axles(-12, 0, 0, high).front).toBeGreaterThan(axles(-12, 0, 0, low).front)

    const short = clone()
    short.chassis.wheelbase = 2.4
    const long = clone()
    long.chassis.wheelbase = 4.4
    expect(axles(-12, 0, 0, long).front).toBeLessThan(axles(-12, 0, 0, short).front)
  })

  it('scales downforce with the square of speed', () => {
    const slow = axles(0, 0, 25)
    const fast = axles(0, 0, 50)
    expect(fast.front + fast.rear - weight).toBeCloseTo((slow.front + slow.rear - weight) * 4, 4)
  })

  it('splits downforce by the aero balance', () => {
    const loads = axles(0, 0, 60)
    const extraFront = loads.front - weight * setup.chassis.frontWeightBias
    const extraRear = loads.rear - weight * (1 - setup.chassis.frontWeightBias)
    expect(extraFront / (extraFront + extraRear)).toBeCloseTo(setup.aero.balanceFront, 6)
  })

  it('produces roughly 2.5x static load at 300kph, as a downforce sanity check', () => {
    const loads = axles(0, 0, 300 / 3.6)
    const ratio = (loads.front + loads.rear) / weight
    expect(ratio).toBeGreaterThan(2)
    expect(ratio).toBeLessThan(4)
  })
})

describe('lateral transfer', () => {
  it('moves load away from the direction of acceleration, and conserves it', () => {
    // Accelerating rightward is a right-hand corner, which loads the outside —
    // the left-hand wheels.
    const loads = wheelLoads(0, 15, 0, setup)

    expect(loads[FL]).toBeGreaterThan(loads[FR])
    expect(loads[RL]).toBeGreaterThan(loads[RR])
    expect(loads[FL] + loads[FR] + loads[RL] + loads[RR]).toBeCloseTo(weight, 6)
  })

  it('is symmetric under a sign flip', () => {
    const right = wheelLoads(0, 18, 40, setup, createWheelLoads())
    const left = wheelLoads(0, -18, 40, setup, createWheelLoads())

    expect(right[FL]).toBeCloseTo(left[FR], 6)
    expect(right[RL]).toBeCloseTo(left[RR], 6)
  })

  it('transfers more total load with a higher centre of gravity', () => {
    const low = clone()
    low.chassis.cgHeight = 0.2
    const high = clone()
    high.chassis.cgHeight = 0.5

    const spread = (s: CarSetup): number => {
      const l = wheelLoads(0, 15, 0, s, createWheelLoads())
      return l[FL] - l[FR] + (l[RL] - l[RR])
    }

    expect(spread(high)).toBeGreaterThan(spread(low))
  })

  /**
   * The setup lever this whole file exists to enable.
   *
   * A stiffer front bar makes the front axle take a larger share of the lateral
   * transfer. Because grip is sub-linear in load, that costs the front axle more
   * total grip than it costs the rear — which is understeer, arrived at without
   * anything anywhere scripting understeer.
   */
  it('sends more lateral transfer to whichever axle has the stiffer bar', () => {
    const stiffFront = clone()
    stiffFront.suspension.antiRollFront = 300000

    const baseline = wheelLoads(0, 15, 0, setup, createWheelLoads())
    const stiffened = wheelLoads(0, 15, 0, stiffFront, createWheelLoads())

    const frontSpread = (l: number[]): number => (l[FL] ?? 0) - (l[FR] ?? 0)
    const rearSpread = (l: number[]): number => (l[RL] ?? 0) - (l[RR] ?? 0)

    expect(frontSpread(stiffened)).toBeGreaterThan(frontSpread(baseline))
    expect(rearSpread(stiffened)).toBeLessThan(rearSpread(baseline))

    // And the axle totals are untouched, because a bar cannot change how much
    // load sits on an axle — only how it is shared across it.
    expect(stiffened[FL] + stiffened[FR]).toBeCloseTo(baseline[FL] + baseline[FR], 6)
  })

  it('splits transfer between the geometric and elastic paths by roll centre height', () => {
    // Raising the roll centre moves transfer onto the links, which is instant
    // and causes no roll — the axle's total transfer rises while the car leans
    // less. That trade is why roll centre height is a real setup knob.
    const raised = clone()
    raised.suspension.rollCentreFront = 0.15
    raised.suspension.rollCentreRear = 0.15

    expect(Math.abs(rollAngle(15, raised))).toBeLessThan(Math.abs(rollAngle(15, setup)))
  })

  it('never produces a negative load, however violent the cornering', () => {
    const out = createWheelLoads()
    for (const lateral of [-500, -60, 60, 500]) {
      for (const longitudinal of [-500, 0, 500]) {
        wheelLoads(longitudinal, lateral, 0, setup, out)
        // Zero is correct and physical — the wheel has left the ground. Negative
        // would flip the sign of that wheel's grip.
        for (const load of out) expect(load).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('lifts the inside wheel before the outside one, under enough load transfer', () => {
    const soft = clone()
    // A tall, narrow, bar-less car, to reach lift-off inside the sane range.
    soft.chassis.cgHeight = 0.9
    soft.suspension.trackFront = 1.0
    soft.suspension.trackRear = 1.0

    const loads = wheelLoads(0, 25, 0, soft, createWheelLoads())

    expect(loads[FR]).toBe(0)
    expect(loads[FL]).toBeGreaterThan(0)
  })
})

describe('roll', () => {
  it('leans into the direction of acceleration and scales with it', () => {
    expect(rollAngle(0, setup)).toBe(0)
    expect(rollAngle(15, setup)).toBeGreaterThan(0)
    expect(rollAngle(-15, setup)).toBeCloseTo(-rollAngle(15, setup), 9)
    expect(rollAngle(30, setup)).toBeGreaterThan(rollAngle(15, setup))
  })

  it('stays small on an F1-stiff car', () => {
    // ~1.9g, the steady-state cornering the regression suite pins. An F1 car
    // barely leans; several degrees here would mean the rates are wrong.
    const degrees = (rollAngle(18.6, setup) * 180) / Math.PI

    expect(degrees).toBeGreaterThan(0.1)
    expect(degrees).toBeLessThan(1.5)
  })

  it('rolls less as the bars are stiffened', () => {
    const stiff = clone()
    stiff.suspension.antiRollFront *= 4
    stiff.suspension.antiRollRear *= 4

    expect(rollAngle(15, stiff)).toBeLessThan(rollAngle(15, setup))
  })
})

describe('geometry helpers', () => {
  it('adds the springs’ own roll resistance to the bar', () => {
    const springsOnly = axleRollStiffness(200000, 0, 1.6)
    expect(springsOnly).toBeCloseTo((200000 * 1.6 * 1.6) / 2, 6)
    expect(axleRollStiffness(200000, 50000, 1.6)).toBeCloseTo(springsOnly + 50000, 6)
  })

  it('places the roll axis at the front roll centre when all the weight is at the front', () => {
    // A pure sanity check on the interpolation direction, which is easy to get
    // backwards: `frontWeightBias` of 1 puts the CG at the front axle.
    const allFront = clone()
    allFront.chassis.frontWeightBias = 1
    expect(rollAxisHeight(allFront)).toBeCloseTo(setup.suspension.rollCentreFront, 9)

    const allRear = clone()
    allRear.chassis.frontWeightBias = 0
    expect(rollAxisHeight(allRear)).toBeCloseTo(setup.suspension.rollCentreRear, 9)
  })
})
