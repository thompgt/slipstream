/**
 * What driving off the road costs you.
 *
 * `Car.surface` is the whole of the track's influence on the physics: two
 * multipliers, written by `game/` from the track query. These tests assert the
 * two of them do different things, because the temptation when tuning is to
 * collapse them into one "off-track penalty" — and a single number cannot
 * express the difference between grass (you keep your speed and lose the ability
 * to point the car) and gravel (you can steer perfectly well, you are just no
 * longer going anywhere).
 */

import { describe, expect, it } from 'vitest'
import { FIXED_DT } from '../core/loop'
import { createCar, type Car, type InputState } from '../core/world'
import { resetCar, stepCar } from './car'
import { carSetup } from './carSetup'

/** A car already at speed, so the tests aren't dominated by the launch. */
function rolling(speed: number, grip = 1, drag = 1): Car {
  const car = createCar(0, true)
  car.velocity.z = speed
  car.gear = 6
  car.surface.grip = grip
  car.surface.drag = drag
  return car
}

const drive = (car: Car, steps: number, input: Partial<InputState>): void => {
  Object.assign(car.input, input)
  for (let i = 0; i < steps; i++) stepCar(car, FIXED_DT, carSetup)
}

const speedOf = (car: Car): number => Math.hypot(car.velocity.x, car.velocity.z)

describe('surface grip', () => {
  it('lengthens braking distance', () => {
    // Stop, then stop measuring. Holding the brake past a standstill is how you
    // reverse in this model, so a fixed number of steps would compare the two
    // cars' reversing speeds rather than their stopping distances.
    const stoppingDistance = (grip: number): number => {
      const car = rolling(60, grip)
      Object.assign(car.input, { brake: 1 })
      let steps = 0
      while (speedOf(car) > 1 && steps < 60 * 30) {
        stepCar(car, FIXED_DT, carSetup)
        steps++
      }
      return car.position.z
    }

    expect(stoppingDistance(0.45)).toBeGreaterThan(stoppingDistance(1) * 1.5)
  })

  it('cuts the lateral acceleration the car can hold in a corner', () => {
    const asphalt = rolling(45)
    const gravel = rolling(45, 0.38)

    drive(asphalt, 120, { throttle: 0.4, steer: 0.5 })
    drive(gravel, 120, { throttle: 0.4, steer: 0.5 })

    expect(Math.abs(gravel.telemetry.lateralG)).toBeLessThan(
      Math.abs(asphalt.telemetry.lateralG) * 0.75,
    )
  })

  it('does not, on its own, scrub off speed', () => {
    // The point of the pair: a car that runs wide onto a slippery *smooth*
    // surface should slide on helplessly, not stop. If this ever starts failing
    // it means grip has quietly been made to do drag's job.
    const asphalt = rolling(60)
    const slippery = rolling(60, 0.3)

    drive(asphalt, 180, {})
    drive(slippery, 180, {})

    expect(speedOf(slippery)).toBeCloseTo(speedOf(asphalt), 1)
  })
})

describe('surface drag', () => {
  it('scrubs speed off a coasting car', () => {
    const asphalt = rolling(60)
    const gravel = rolling(60, 1, 12)

    drive(asphalt, 180, {})
    drive(gravel, 180, {})

    expect(speedOf(gravel)).toBeLessThan(speedOf(asphalt) - 5)
  })

  it('opposes motion rather than pushing the car around', () => {
    // Rolling resistance is signed by direction of travel. Getting that wrong
    // with a x12 multiplier is not a subtle bug — a stationary car in the gravel
    // accelerates out of it backwards.
    const car = rolling(0, 1, 12)
    drive(car, 240, {})

    expect(speedOf(car)).toBeLessThan(0.5)
    expect(Math.abs(car.position.z)).toBeLessThan(0.5)
  })
})

describe('defaults', () => {
  it('starts on dry asphalt, so a car with no track under it drives normally', () => {
    const car = createCar(0, true)
    expect(car.surface).toEqual({ grip: 1, drag: 1 })
  })

  it('is restored by a reset, so the gravel does not follow you back to the line', () => {
    const car = rolling(30, 0.38, 12)
    drive(car, 60, { throttle: 1 })
    resetCar(car)
    expect(car.surface).toEqual({ grip: 1, drag: 1 })
  })
})
