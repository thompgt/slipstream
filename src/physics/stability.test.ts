/**
 * The model must never explode, whatever the driver does.
 *
 * `stepCar` has a `Number.isFinite` guard that resets the car — cheap insurance
 * while the model is being tuned. This suite exists so that guard stays a bug
 * *detector* rather than a bug *fix*: if a NaN ever reaches it, one of these
 * cases should have caught the cause first.
 *
 * It matters most for the four-wheel rewrite ahead. Wheel-spin equations are
 * stiff at low speed — the slip-ratio denominator goes to zero at a standstill —
 * and the classic failure is oscillation, then NaN, then a car that vanishes, at
 * exactly the moment the game is most fun to test: a standing start. Every
 * adversarial case below is aimed at that band.
 *
 * Deliberately no `Math.random()`. A fuzz suite that finds a failure it cannot
 * reproduce is worse than no fuzz suite, so the input space is enumerated.
 */

import { describe, expect, it } from 'vitest'
import { FIXED_DT } from '../core/loop'
import { createCar, type Car } from '../core/world'
import { stepCar } from './car'
import { carSetup } from './carSetup'

/**
 * Physically impossible states, whatever the inputs were. Returns the reason a
 * state is bad, or `null` if it is fine.
 *
 * Deliberately a predicate rather than a pile of `expect`s: these run once per
 * step across tens of thousands of steps, and `expect` is far too slow to call
 * at that rate. The caller asserts once, on the first failure, with the context
 * needed to reproduce it.
 */
const insanity = (car: Car): string | null => {
  const speed = Math.hypot(car.velocity.x, car.velocity.z)

  if (!Number.isFinite(car.position.x)) return 'position.x is not finite'
  if (!Number.isFinite(car.position.z)) return 'position.z is not finite'
  if (!Number.isFinite(car.heading)) return 'heading is not finite'
  if (!Number.isFinite(car.velocity.x)) return 'velocity.x is not finite'
  if (!Number.isFinite(car.velocity.z)) return 'velocity.z is not finite'
  if (!Number.isFinite(car.yawRate)) return 'yawRate is not finite'
  if (!Number.isFinite(car.rpm)) return 'rpm is not finite'

  // 150 m/s is 540kph — comfortably past anything the car can reach, so this
  // catches a runaway rather than a mis-tune.
  if (speed >= 150) return `speed ran away to ${speed.toFixed(1)} m/s`
  // 8 rad/s is over a full rotation per second. A spin is legal; a centrifuge
  // is a numerical failure.
  if (Math.abs(car.yawRate) >= 8) return `yawRate ran away to ${car.yawRate.toFixed(2)} rad/s`
  if (car.gear < 1 || car.gear > carSetup.gearbox.ratios.length) return `gear ${car.gear}`
  // Negative load flips the sign of an axle's grip, which reads as the car
  // being flung sideways for no reason a tuner can find.
  if (car.telemetry.loadFront < 0) return `front load ${car.telemetry.loadFront.toFixed(0)}N`
  if (car.telemetry.loadRear < 0) return `rear load ${car.telemetry.loadRear.toFixed(0)}N`

  return null
}

const expectSane = (car: Car, context: string): void => {
  const reason = insanity(car)
  expect(reason === null ? 'sane' : `${context}: ${reason}`).toBe('sane')
}

const STEER = [-1, -0.5, 0, 0.35, 1]
const THROTTLE = [0, 0.5, 1]
const BRAKE = [0, 0.5, 1]

describe('stability across the input space', () => {
  it('survives every combination of steer, throttle, brake and handbrake held for 10s', () => {
    for (const steer of STEER) {
      for (const throttle of THROTTLE) {
        for (const brake of BRAKE) {
          for (const handbrake of [false, true]) {
            const car = createCar(0, true)
            Object.assign(car.input, { steer, throttle, brake, handbrake })

            for (let i = 0; i < 60 * 10; i++) stepCar(car, FIXED_DT, carSetup)

            expectSane(car, `steer ${steer} throttle ${throttle} brake ${brake} hb ${handbrake}`)
          }
        }
      }
    }
  })

  it('survives inputs that flip every single step', () => {
    // Alternating full throttle and full brake at 60Hz is the worst case for any
    // integrator: it is a square wave at the Nyquist frequency of the timestep.
    const car = createCar(0, true)
    let failure: string | null = null

    for (let i = 0; i < 60 * 20 && !failure; i++) {
      const flip = i % 2 === 0
      Object.assign(car.input, {
        throttle: flip ? 1 : 0,
        brake: flip ? 0 : 1,
        steer: flip ? 1 : -1,
        handbrake: i % 7 === 0,
      })
      stepCar(car, FIXED_DT, carSetup)
      const reason = insanity(car)
      if (reason) failure = `step ${i}: ${reason}`
    }

    expect(failure ?? 'sane').toBe('sane')
  })

  /**
   * The low-speed band, hammered.
   *
   * This is where the four-wheel rewrite is most likely to break: below a few
   * m/s the slip-angle denominator is softened and the slip-ratio denominator
   * will need the same treatment. Every case here starts from rest or crawls.
   */
  it('survives adversarial inputs in the 0-5 m/s band', () => {
    let failure: string | null = null

    for (const steer of STEER) {
      for (const handbrake of [false, true]) {
        const car = createCar(0, true)

        for (let i = 0; i < 60 * 15 && !failure; i++) {
          // Blip the throttle just enough to creep, then stamp on the brakes.
          const phase = Math.floor(i / 20) % 3
          Object.assign(car.input, {
            throttle: phase === 0 ? 0.25 : 0,
            brake: phase === 1 ? 1 : 0,
            steer,
            handbrake,
          })
          stepCar(car, FIXED_DT, carSetup)

          const context = `crawl steer ${steer} hb ${handbrake} step ${i}`
          const reason = insanity(car)
          if (reason) failure = `${context}: ${reason}`
          // The car should never get anywhere near real speed on 25% throttle
          // blips — if it does, something is injecting energy.
          else if (Math.hypot(car.velocity.x, car.velocity.z) > 30) {
            failure = `${context}: crawling car reached real speed`
          }
        }
      }
    }

    expect(failure ?? 'sane').toBe('sane')
  })

  it('survives a standing start under full power and full lock', () => {
    const car = createCar(0, true)
    Object.assign(car.input, { throttle: 1, steer: 1 })
    let failure: string | null = null

    for (let i = 0; i < 60 * 15 && !failure; i++) {
      stepCar(car, FIXED_DT, carSetup)
      const reason = insanity(car)
      if (reason) failure = `launch step ${i}: ${reason}`
    }

    expect(failure ?? 'sane').toBe('sane')
  })
})

describe('determinism', () => {
  it('produces bit-identical state from identical inputs', () => {
    // Ghost laps, replays, and headless AI benchmarking all rest on this. It is
    // also the reason nothing in `physics/` may call `Math.random()` or read a
    // wall clock — see ARCHITECTURE.md.
    const run = (): Car => {
      const car = createCar(0, true)
      for (let i = 0; i < 60 * 20; i++) {
        Object.assign(car.input, {
          throttle: i % 120 < 80 ? 1 : 0,
          brake: i % 120 >= 80 ? 0.6 : 0,
          steer: Math.sin(i / 40),
          handbrake: false,
        })
        stepCar(car, FIXED_DT, carSetup)
      }
      return car
    }

    const a = run()
    const b = run()

    expect(a.position.x).toBe(b.position.x)
    expect(a.position.z).toBe(b.position.z)
    expect(a.heading).toBe(b.heading)
    expect(a.velocity.x).toBe(b.velocity.x)
    expect(a.velocity.z).toBe(b.velocity.z)
    expect(a.yawRate).toBe(b.yawRate)
    expect(a.rpm).toBe(b.rpm)
    expect(a.gear).toBe(b.gear)
  })

  it('is unaffected by other cars being stepped in between', () => {
    // `car.ts` keeps a module-level scratch object for axle loads, reused by
    // every car. If anything ever leaks across that boundary, a 20-car grid
    // would desync from a solo run and the cause would be invisible.
    const solo = createCar(0, true)
    const interleaved = createCar(0, true)
    const others = [createCar(1), createCar(2), createCar(3)]

    for (let i = 0; i < 60 * 10; i++) {
      const input = { throttle: 1, brake: 0, steer: Math.sin(i / 30), handbrake: false }

      Object.assign(solo.input, input)
      stepCar(solo, FIXED_DT, carSetup)

      Object.assign(interleaved.input, input)
      for (const other of others) {
        Object.assign(other.input, { throttle: 0.4, brake: 0.3, steer: -1, handbrake: true })
        stepCar(other, FIXED_DT, carSetup)
      }
      stepCar(interleaved, FIXED_DT, carSetup)
    }

    expect(interleaved.position.x).toBe(solo.position.x)
    expect(interleaved.position.z).toBe(solo.position.z)
    expect(interleaved.heading).toBe(solo.heading)
  })
})
