/**
 * What hitting things costs you.
 *
 * The failure modes here are all ones that would pass a drive-test. A damage
 * model that is linear in speed still "works" — you hit a wall, a number goes
 * up — and it is wrong in the way that matters, because the whole difference
 * between a brush and a shunt lives in that exponent. A model that takes the
 * same downforce off both ends still "works", and turns every shunt into the
 * lap-time tax CLAUDE.md is written against rather than a car that has stopped
 * turning in. And damage that reads off `setup.aero` somewhere downstream still
 * "works" right up until the one path that skipped it is the one under the
 * tyres.
 *
 * So the assertions below are mostly about *asymmetry*: front is not rear, drag
 * up is not drag down, and a broken car is a different car rather than a slower
 * one.
 */

import { describe, expect, it } from 'vitest'
import { createCar, createDamage, type WallQuery } from '../core/world'
import { stepCar, resetCar } from './car'
import { carSetup } from './carSetup'
import { applyImpact, createAeroState, damagedAero } from './damage'

const STEP = 1000 / 60

/** Square into the wall, at the front. The reference hit for everything below. */
const hit = (closing: number, atFront = true, headOn = 1) => {
  const damage = createDamage()
  applyImpact(damage, closing, atFront, headOn)
  return damage
}

describe('applyImpact', () => {
  it('lets you park against a barrier for free', () => {
    // Rolling into a wall in the pit lane is not a damaged car, and a model
    // that says it is will have written the front wing off before the lights
    // have gone out.
    expect(hit(1.5)).toEqual(createDamage())
    expect(hit(0)).toEqual(createDamage())
  })

  it('breaks things on energy rather than on speed', () => {
    // The one exponent that makes a brush a brush. Doubling the closing speed
    // has to cost distinctly more than double, or every hit between the two
    // thresholds feels like the same hit.
    const gentle = hit(8).frontWing
    const double = hit(14).frontWing // twice the speed *over the floor*
    expect(gentle).toBeGreaterThan(0)
    expect(double).toBeGreaterThan(gentle * 3)
  })

  it('writes the wing off in one hit at motorway speed', () => {
    expect(hit(30).frontWing).toBeGreaterThan(0.8)
  })

  it('never takes a part past gone, however many times you hit it', () => {
    const damage = createDamage()
    for (let i = 0; i < 20; i++) applyImpact(damage, 40, true, 1)
    expect(damage.frontWing).toBe(1)
    expect(damage.floor).toBe(1)
  })

  it('only ever adds — nothing repairs itself by being hit gently afterwards', () => {
    const damage = createDamage()
    applyImpact(damage, 25, true, 1)
    const after = damage.frontWing
    applyImpact(damage, 3, true, 1)
    expect(damage.frontWing).toBeGreaterThanOrEqual(after)
  })

  it('damages the end of the car that actually touched the wall', () => {
    const front = hit(20, true)
    const rear = hit(20, false)
    expect(front.frontWing).toBeGreaterThan(0)
    expect(front.rearWing).toBe(0)
    expect(rear.rearWing).toBeGreaterThan(0)
    expect(rear.frontWing).toBe(0)
  })

  it('tears wings off square hits and drags the floor off glancing ones', () => {
    const square = hit(20, true, 1)
    const glance = hit(20, true, 0)
    // The wing is what sticks out furthest and is designed to fail first...
    expect(square.frontWing).toBeGreaterThan(glance.frontWing)
    // ...but a scrape down the side of the car loads the whole length of floor.
    expect(glance.floor).toBeGreaterThan(square.floor)
  })

  it('costs the floor something even in a square hit', () => {
    // Nothing about hitting a wall head-on leaves the plank untouched, and a
    // zero here would let a driver farm head-on hits to protect the floor.
    expect(hit(20, true, 1).floor).toBeGreaterThan(0)
  })
})

describe('damagedAero', () => {
  const out = createAeroState()
  const pristine = damagedAero(carSetup, createDamage(), createAeroState())

  it('hands back the setup untouched on an undamaged car', () => {
    // The whole model routes through here every step of every car's life, so
    // the overwhelmingly common case has to be exactly the identity.
    expect(pristine.downforce).toBeCloseTo(carSetup.aero.downforce)
    expect(pristine.balanceFront).toBeCloseTo(carSetup.aero.balanceFront)
    expect(pristine.drag).toBeCloseTo(carSetup.aero.drag)
  })

  it('pushes the balance rearward when the front wing goes', () => {
    // This is the entire point of modelling damage on the balance rather than
    // on a lap-time penalty: a car with no front wing does not go slower, it
    // stops turning in.
    const broken = damagedAero(carSetup, { frontWing: 1, rearWing: 0, floor: 0 }, out)
    expect(broken.balanceFront).toBeLessThan(pristine.balanceFront)
  })

  it('pushes the balance forward when the rear wing goes', () => {
    const broken = damagedAero(carSetup, { frontWing: 0, rearWing: 1, floor: 0 }, out)
    expect(broken.balanceFront).toBeGreaterThan(pristine.balanceFront)
  })

  it('makes a car with no rear wing faster in a straight line', () => {
    // The rear wing is the biggest single drag item on the car, so losing it
    // leaves the car quicker down the straight and undriveable at the end of
    // it. Anyone who has watched a driver limp a wingless car past the pit wall
    // at full speed and then go straight on at the first corner has seen this.
    const broken = damagedAero(carSetup, { frontWing: 0, rearWing: 1, floor: 0 }, out)
    expect(broken.drag).toBeLessThan(pristine.drag)
    expect(broken.downforce).toBeLessThan(pristine.downforce)
  })

  it('makes a car with a hanging front wing slower in a straight line', () => {
    // The opposite sign, and the reason drag is not one number times total
    // damage: a front wing off its mounts is a brake bolted to the nose.
    const broken = damagedAero(carSetup, { frontWing: 1, rearWing: 0, floor: 0 }, out)
    expect(broken.drag).toBeGreaterThan(pristine.drag)
  })

  it('leaves something behind when everything is gone', () => {
    // A destroyed car is still a shape in an airstream. Zero downforce is both
    // wrong and a division waiting to happen in `balanceFront`.
    const wreck = damagedAero(carSetup, { frontWing: 1, rearWing: 1, floor: 1 }, out)
    expect(wreck.downforce).toBeGreaterThan(0)
    expect(wreck.downforce).toBeLessThan(pristine.downforce * 0.25)
    expect(wreck.drag).toBeGreaterThan(0)
    expect(Number.isFinite(wreck.balanceFront)).toBe(true)
  })

  it('starves the rear when the floor goes, not just the total', () => {
    // An F1 car is one aerodynamic system. A floor loss that came off both ends
    // evenly would make a broken car merely slower, and the thing that actually
    // ends the lap is that it has gone loose.
    const broken = damagedAero(carSetup, { frontWing: 0, rearWing: 0, floor: 1 }, out)
    expect(broken.downforce).toBeLessThan(pristine.downforce)
    expect(broken.balanceFront).toBeGreaterThan(pristine.balanceFront)
  })

  it('is monotonic in every part', () => {
    // Not a maths curiosity: a non-monotonic term would mean some amount of
    // damage was worth seeking out, and the driver would be rewarded for
    // hitting something harder.
    let previous = pristine.downforce
    for (const d of [0.2, 0.4, 0.6, 0.8, 1]) {
      const now = damagedAero(carSetup, { frontWing: d, rearWing: d, floor: d }, out).downforce
      expect(now).toBeLessThan(previous)
      previous = now
    }
  })
})

/** A wall running along z, with everything past `limit` in x inside it. */
const wallAtX =
  (limit: number): WallQuery =>
  (x, _z, radius, out) => {
    const depth = x + radius - limit
    if (depth <= 0) return false
    out.depth = depth
    out.normalX = -1
    out.normalZ = 0
    return true
  }

describe('a car that has hit something', () => {
  it('carries the damage out of the collision solver', () => {
    const car = createCar(0, true)
    car.position.x = 10
    car.heading = Math.PI / 2 // facing +x, square into the wall
    car.velocity.x = 30

    stepCar(car, STEP, carSetup, wallAtX(10))

    expect(car.damage.frontWing).toBeGreaterThan(0.5)
    expect(car.damage.rearWing).toBe(0)
  })

  it('understeers where the same car used to turn in', () => {
    // The end-to-end claim, and the only one that proves damage reaches the
    // tyres rather than stopping at a number on the overlay: same speed, same
    // steering lock, same everything but a missing front wing.
    const lateral = (frontWing: number): number => {
      const car = createCar(0, true)
      car.velocity.z = 70
      car.damage.frontWing = frontWing
      for (let i = 0; i < 60; i++) {
        car.input.steer = 0.5
        car.input.throttle = 0.4
        stepCar(car, STEP, carSetup)
      }
      return Math.abs(car.telemetry.lateralG)
    }

    expect(lateral(1)).toBeLessThan(lateral(0))
  })

  it('is a new car after R, not a repaired one', () => {
    // R exists to recover from a shunt. Carrying damage through it would make
    // the recovery button the one thing that cannot recover.
    const car = createCar(0, true)
    car.damage.frontWing = 1
    car.damage.floor = 0.6
    resetCar(car)
    expect(car.damage).toEqual(createDamage())
  })
})
