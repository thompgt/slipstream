/**
 * The performance envelope of the car, frozen as assertions.
 *
 * This is a *characterisation* test, not a correctness one. It does not claim
 * these numbers are right — it claims they are what the tuned car does today, so
 * that a change to the model announces itself as a number instead of a vague
 * feeling three weeks later.
 *
 * The four-wheel rewrite is the reason this exists. That work replaces the load
 * model, the tyre evaluation, and the drivetrain, and the one thing it must not
 * quietly destroy is the handling that took the tuning passes to find. Every
 * phase of the rewrite runs this suite.
 *
 * **When a change legitimately alters the car, update the band and say why in a
 * comment.** A silently widened tolerance is the same as deleting the test.
 *
 * Bands are deliberately loose enough to survive floating-point and refactoring
 * noise, and tight enough that a real change to the physics cannot slip through.
 */

import { describe, expect, it } from 'vitest'
import { FIXED_DT } from '../core/loop'
import { createCar, type Car, type InputState } from '../core/world'
import { stepCar } from './car'
import { carSetup } from './carSetup'

const drive = (car: Car, input: Partial<InputState>, seconds: number): Car => {
  Object.assign(car.input, input)
  const steps = Math.round(seconds * 1000 / FIXED_DT)
  for (let i = 0; i < steps; i++) stepCar(car, FIXED_DT, carSetup)
  return car
}

const speedKph = (car: Car): number => Math.hypot(car.velocity.x, car.velocity.z) * 3.6

/** A car at ~220kph in a straight line — the entry state for the handling tests. */
const atSpeed = (): Car => drive(createCar(0, true), { throttle: 1 }, 7)

describe('straight-line performance', () => {
  it('accelerates 0-100 and 0-200 kph in the expected times', () => {
    const car = createCar(0, true)
    car.input.throttle = 1

    let to100 = 0
    let to200 = 0
    for (let i = 0; i < 60 * 30; i++) {
      stepCar(car, FIXED_DT, carSetup)
      const kph = speedKph(car)
      if (!to100 && kph >= 100) to100 = i / 60
      if (!to200 && kph >= 200) to200 = i / 60
    }

    // Traction-limited off the line, then power-limited. Baseline 2.82s / 5.93s.
    expect(to100).toBeGreaterThan(2.6)
    expect(to100).toBeLessThan(3.05)
    expect(to200).toBeGreaterThan(5.7)
    expect(to200).toBeLessThan(6.2)
  })

  it('tops out where drag balances power, in top gear', () => {
    const car = drive(createCar(0, true), { throttle: 1 }, 30)

    // Baseline 276 kph in 8th at ~13970 rpm. Drag is the limit, not the limiter.
    expect(speedKph(car)).toBeGreaterThan(270)
    expect(speedKph(car)).toBeLessThan(283)
    expect(car.gear).toBe(carSetup.gearbox.ratios.length)
    expect(car.rpm).toBeLessThan(carSetup.engine.limiterRpm)
  })

  it('stops from top speed in a believable distance', () => {
    const car = drive(createCar(0, true), { throttle: 1 }, 30)
    const entrySpeed = speedKph(car)
    const start = car.position.z

    Object.assign(car.input, { throttle: 0, brake: 1 })
    let steps = 0
    while (speedKph(car) > 1 && steps < 60 * 30) {
      stepCar(car, FIXED_DT, carSetup)
      steps++
    }

    // Baseline 107m from 276kph. Downforce is what makes this short — an F1 car
    // brakes hardest at the start of the stop, not the end.
    const distance = car.position.z - start
    expect(entrySpeed).toBeGreaterThan(270)
    expect(distance).toBeGreaterThan(95)
    expect(distance).toBeLessThan(120)
    expect(steps / 60).toBeLessThan(4)
  })
})

describe('cornering', () => {
  it('holds a steady-state corner at high lateral g', () => {
    const car = drive(createCar(0, true), { throttle: 1 }, 8)
    drive(car, { throttle: 0.35, steer: 1 }, 4)

    // Baseline ~141kph, 1.90g, ~74m radius. Downforce doing the work.
    const radius = Math.hypot(car.velocity.x, car.velocity.z) / Math.abs(car.yawRate)
    expect(Math.abs(car.telemetry.lateralG)).toBeGreaterThan(1.75)
    expect(radius).toBeGreaterThan(65)
    expect(radius).toBeLessThan(85)
  })

  /**
   * The feel assertion — the one this whole file exists to protect.
   *
   * Braking into a corner moves load onto the front axle, which buys front grip
   * exactly when the car needs to rotate. Past a point it reverses: the front
   * spends its friction circle on stopping instead of turning, and the car
   * pushes wide again. Both halves of that arc must survive the rewrite; the
   * peak in the middle *is* "rewards trail braking", and nothing in the model
   * scripts it.
   *
   * Measured over 0.5s at a modest 0.15 steer. Longer or harder inputs put the
   * car past the limit and into a spin, where this comparison measures spin
   * dynamics rather than turn-in.
   */
  it('rotates more on the brakes than coasting, and less again when over-braked', () => {
    const yawAfterTurnIn = (brake: number): number =>
      Math.abs(drive(atSpeed(), { throttle: 0, brake, steer: 0.15 }, 0.5).yawRate)

    const coasting = yawAfterTurnIn(0)
    const light = yawAfterTurnIn(0.15)
    const trail = yawAfterTurnIn(0.3)
    const overBraked = yawAfterTurnIn(0.5)

    // Baseline: 0.596 / 0.903 / 1.134 / 1.120 rad/s.
    expect(light).toBeGreaterThan(coasting * 1.3)
    expect(trail).toBeGreaterThan(light)
    expect(overBraked).toBeLessThan(trail)

    expect(coasting).toBeGreaterThan(0.5)
    expect(coasting).toBeLessThan(0.7)
    expect(trail).toBeGreaterThan(1.0)
    expect(trail).toBeLessThan(1.3)
  })

  it('puts more load on the front axle under trail braking than coasting', () => {
    // The mechanism behind the test above, asserted directly so that a failure
    // there points at either the load model or the tyre model, not both.
    const coasting = drive(atSpeed(), { throttle: 0, steer: 0.15 }, 0.5)
    const trail = drive(atSpeed(), { throttle: 0, brake: 0.3, steer: 0.15 }, 0.5)

    expect(trail.telemetry.loadFront).toBeGreaterThan(coasting.telemetry.loadFront)
  })
})

describe('recovery and edge cases', () => {
  it('provokes a slide with the handbrake that opposite lock can catch', () => {
    const car = drive(atSpeed(), { throttle: 0.3, steer: 1, handbrake: true }, 0.5)
    const peakYaw = Math.abs(car.yawRate)

    drive(car, { throttle: 0.3, steer: -0.3, handbrake: false }, 1.5)

    // Baseline: 6.96 rad/s peak, down to 0.70 after 1.5s of opposite lock. The
    // gentle post-peak fall-off of the tyre curve is what makes this catchable.
    expect(peakYaw).toBeGreaterThan(4)
    expect(Math.abs(car.yawRate)).toBeLessThan(peakYaw * 0.25)
  })

  it('reverses off the brake pedal from a standstill', () => {
    const car = drive(createCar(0, true), { throttle: 0, brake: 1 }, 3)

    // Baseline 41.5kph, 17.5m travelled backwards.
    expect(car.position.z).toBeLessThan(-12)
    expect(speedKph(car)).toBeGreaterThan(30)
  })

  it('stays finite steering at a standstill, and creeps only slowly', () => {
    // The slip-angle maths is singular at rest; this is the guard on the
    // low-speed damping that stands in for it.
    const car = drive(createCar(0, true), { steer: 1 }, 5)

    expect(Number.isFinite(car.position.x)).toBe(true)
    expect(Number.isFinite(car.heading)).toBe(true)

    // Known artifact, baseline ~12kph after 5s: with no clutch, engine braking
    // is applied as a rear-axle force even at zero throttle and zero speed, so
    // the car reverses itself into a slow circle instead of sitting still.
    // Harmless today (you are always on a pedal), but it is a force that should
    // not exist. The driveline phase of the four-wheel rewrite removes it by
    // giving the engine its own angular state behind a clutch — expect this
    // bound to drop to near zero then, and tighten it when it does.
    expect(speedKph(car)).toBeLessThan(15)
  })
})
