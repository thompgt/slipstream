import { describe, expect, it } from 'vitest'
import { carSetup, GRAVITY, type CarSetup } from './carSetup'
import { axleLoads } from './weightTransfer'

const setup: CarSetup = carSetup
const weight = setup.chassis.mass * GRAVITY

describe('axleLoads', () => {
  it('carries exactly the car’s weight when static, split by the bias', () => {
    const loads = axleLoads(0, 0, setup)
    expect(loads.front).toBeCloseTo(weight * setup.chassis.frontWeightBias, 6)
    expect(loads.rear).toBeCloseTo(weight * (1 - setup.chassis.frontWeightBias), 6)
    expect(loads.front + loads.rear).toBeCloseTo(weight, 6)
  })

  it('conserves total load — transfer moves it, it does not create it', () => {
    for (const accel of [-30, -12, -1, 0, 1, 12, 30]) {
      const loads = axleLoads(accel, 0, setup)
      expect(loads.front + loads.rear).toBeCloseTo(weight, 6)
    }
  })

  it('loads the front under braking — this is what gives the car turn-in bite', () => {
    const braking = axleLoads(-12, 0, setup)
    const coasting = axleLoads(0, 0, setup)
    expect(braking.front).toBeGreaterThan(coasting.front)
    expect(braking.rear).toBeLessThan(coasting.rear)
  })

  it('loads the rear under acceleration', () => {
    const accelerating = axleLoads(12, 0, setup)
    const coasting = axleLoads(0, 0, setup)
    expect(accelerating.rear).toBeGreaterThan(coasting.rear)
    expect(accelerating.front).toBeLessThan(coasting.front)
  })

  it('transfers more with a higher centre of gravity', () => {
    const low = axleLoads(-12, 0, { ...setup, chassis: { ...setup.chassis, cgHeight: 0.2 } })
    const high = axleLoads(-12, 0, { ...setup, chassis: { ...setup.chassis, cgHeight: 0.6 } })
    expect(high.front).toBeGreaterThan(low.front)
  })

  it('transfers less over a longer wheelbase', () => {
    const short = axleLoads(-12, 0, { ...setup, chassis: { ...setup.chassis, wheelbase: 2.4 } })
    const long = axleLoads(-12, 0, { ...setup, chassis: { ...setup.chassis, wheelbase: 4.4 } })
    expect(long.front).toBeLessThan(short.front)
  })

  it('scales downforce with the square of speed', () => {
    const slow = axleLoads(0, 25, setup)
    const fast = axleLoads(0, 50, setup)
    const slowExtra = slow.front + slow.rear - weight
    const fastExtra = fast.front + fast.rear - weight
    expect(fastExtra).toBeCloseTo(slowExtra * 4, 4)
  })

  it('splits downforce by the aero balance', () => {
    const loads = axleLoads(0, 60, setup)
    const extraFront = loads.front - weight * setup.chassis.frontWeightBias
    const extraRear = loads.rear - weight * (1 - setup.chassis.frontWeightBias)
    expect(extraFront / (extraFront + extraRear)).toBeCloseTo(setup.aero.balanceFront, 6)
  })

  /**
   * Negative load would flip the sign of that axle's grip and send the car
   * sideways for no visible reason — a genuinely confusing bug to chase from
   * the driver's seat.
   */
  it('never reports negative load, however violent the input', () => {
    for (const accel of [-500, -100, 100, 500]) {
      const loads = axleLoads(accel, 0, setup)
      expect(loads.front).toBeGreaterThanOrEqual(0)
      expect(loads.rear).toBeGreaterThanOrEqual(0)
    }
  })

  it('writes into the caller’s object so the sim path allocates nothing', () => {
    const out = { front: 0, rear: 0 }
    const returned = axleLoads(-5, 30, setup, out)
    expect(returned).toBe(out)
    expect(out.front).toBeGreaterThan(0)
  })

  it('produces roughly 2.5x static load at 300kph, as a downforce sanity check', () => {
    const loads = axleLoads(0, 300 / 3.6, setup)
    const ratio = (loads.front + loads.rear) / weight
    expect(ratio).toBeGreaterThan(2)
    expect(ratio).toBeLessThan(4)
  })
})
