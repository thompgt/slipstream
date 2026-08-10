import { beforeEach, describe, expect, it } from 'vitest'
import { carSetup, type CarSetup } from './carSetup'
import { engineRpm, engineTorque, totalRatio, updateGearbox, type GearboxState } from './gearbox'

const STEP = 1 / 60

/** Deep-ish clone so a test mutating setup can't leak into the next one. */
const setupCopy = (): CarSetup => structuredClone(carSetup)

let setup: CarSetup
let state: GearboxState

beforeEach(() => {
  setup = setupCopy()
  state = { gear: 1, rpm: 0, shiftTimer: 0 }
})

/** Road speed, m/s, that puts the engine at `rpm` in `gear`. */
const speedForRpm = (rpm: number, gear: number): number =>
  ((rpm * 2 * Math.PI) / 60 / totalRatio(gear, setup)) * setup.chassis.wheelRadius

describe('engineRpm', () => {
  it('idles at a standstill rather than stalling', () => {
    expect(engineRpm(0, 1, setup)).toBe(setup.engine.idleRpm)
  })

  it('acts as the rev limiter', () => {
    expect(engineRpm(1000, 1, setup)).toBe(setup.engine.limiterRpm)
  })

  it('drops for the same road speed in a taller gear', () => {
    const speed = 40
    for (let gear = 2; gear <= setup.gearbox.ratios.length; gear++) {
      // Non-strict: at 40m/s the low gears are both pinned on the limiter, and
      // clamping to it is the correct behaviour, not a monotonicity failure.
      expect(engineRpm(speed, gear, setup)).toBeLessThanOrEqual(
        engineRpm(speed, gear - 1, setup),
      )
    }
    // Strictly decreasing wherever the limiter isn't in play.
    expect(engineRpm(speed, 8, setup)).toBeLessThan(engineRpm(speed, 5, setup))
  })

  it('is unaffected by direction of travel', () => {
    expect(engineRpm(-25, 3, setup)).toBe(engineRpm(25, 3, setup))
  })
})

describe('engineTorque', () => {
  it('interpolates between curve points', () => {
    const [a, b] = setup.engine.torqueCurve
    if (!a || !b) throw new Error('torque curve needs at least two points')
    const midRpm = (a.rpm + b.rpm) / 2
    expect(engineTorque(midRpm, setup)).toBeCloseTo((a.torque + b.torque) / 2, 6)
  })

  it('is flat beyond both ends of the curve', () => {
    const curve = setup.engine.torqueCurve
    const first = curve[0]
    const last = curve[curve.length - 1]
    if (!first || !last) throw new Error('empty torque curve')
    expect(engineTorque(first.rpm - 5000, setup)).toBe(first.torque)
    expect(engineTorque(last.rpm + 5000, setup)).toBe(last.torque)
  })

  it('peaks below the limiter, so the last 1000rpm costs torque', () => {
    const peak = Math.max(...setup.engine.torqueCurve.map((p) => p.torque))
    expect(engineTorque(setup.engine.limiterRpm, setup)).toBeLessThan(peak)
  })
})

describe('updateGearbox — automatic shifting', () => {
  it('sits in first at a standstill', () => {
    updateGearbox(state, 0, 1, STEP, setup)
    expect(state.gear).toBe(1)
  })

  it('upshifts when the revs pass the upshift point under power', () => {
    updateGearbox(state, speedForRpm(setup.gearbox.upshiftRpm + 200, 1), 1, STEP, setup)
    expect(state.gear).toBe(2)
  })

  it('holds the gear off-throttle even at high revs', () => {
    updateGearbox(state, speedForRpm(setup.gearbox.upshiftRpm + 200, 1), 0, STEP, setup)
    expect(state.gear).toBe(1)
  })

  it('shifts at most one gear per step', () => {
    // Fast enough for seventh, but the box must walk up one gear at a time.
    const speed = speedForRpm(setup.gearbox.upshiftRpm, 7)
    updateGearbox(state, speed, 1, STEP, setup)
    expect(state.gear).toBe(2)
  })

  it('will not shift while a shift is still in progress', () => {
    const speed = speedForRpm(setup.gearbox.upshiftRpm + 500, 1)
    updateGearbox(state, speed, 1, STEP, setup)
    expect(state.gear).toBe(2)
    expect(state.shiftTimer).toBeGreaterThan(0)

    updateGearbox(state, speed, 1, STEP, setup)
    expect(state.gear).toBe(2)
  })

  it('walks up through all eight gears as speed builds, and stops at eighth', () => {
    let speed = 0
    // 20 seconds of acceleration is comfortably enough to reach top gear.
    for (let i = 0; i < 20 * 60; i++) {
      updateGearbox(state, speed, 1, STEP, setup)
      speed = Math.min(speed + 0.15, 95)
    }
    expect(state.gear).toBe(setup.gearbox.ratios.length)
  })

  it('downshifts as the car slows', () => {
    state.gear = 5
    let speed = speedForRpm(setup.gearbox.downshiftRpm + 2000, 5)
    for (let i = 0; i < 10 * 60; i++) {
      updateGearbox(state, speed, 0, STEP, setup)
      speed = Math.max(speed - 0.25, 0)
    }
    expect(state.gear).toBe(1)
  })

  it('never selects a gear outside the box', () => {
    for (const startGear of [-3, 0, 1, 8, 12]) {
      state.gear = startGear
      state.shiftTimer = 0
      updateGearbox(state, 60, 1, STEP, setup)
      expect(state.gear).toBeGreaterThanOrEqual(1)
      expect(state.gear).toBeLessThanOrEqual(setup.gearbox.ratios.length)
    }
  })

  /**
   * The bug this guards against: braking hard from top speed drags the revs
   * below the downshift point in every gear at once, and a naive box grabs
   * second at 300kph and pins the engine on the limiter.
   */
  it('refuses a downshift that would land on the limiter', () => {
    state.gear = 8
    const speed = speedForRpm(setup.gearbox.downshiftRpm, 8)
    updateGearbox(state, speed, 0, STEP, setup)
    expect(state.rpm).toBeLessThan(setup.engine.limiterRpm)
  })

  it('holds a steady gear at a constant cruising speed', () => {
    // Midway between shift points in fourth — the classic hunting scenario.
    const rpm = (setup.gearbox.upshiftRpm + setup.gearbox.downshiftRpm) / 2
    const speed = speedForRpm(rpm, 4)
    state.gear = 4
    for (let i = 0; i < 5 * 60; i++) updateGearbox(state, speed, 0.4, STEP, setup)
    expect(state.gear).toBe(4)
  })
})
