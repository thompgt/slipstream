/**
 * Hitting the wall.
 *
 * Tested against a flat wall rather than a circuit, which is the point of the
 * `WallQuery` reduction: none of this needs Monza, or a spline, or a renderer.
 *
 * The failure modes worth naming are all ones you would not notice by driving.
 * A car left a few centimetres inside the barrier looks fine and reads as a
 * different surface to the physics on the next step. A restitution slightly too
 * high looks like a hard hit and feels like a pinball table. And a sign error on
 * the yaw impulse spins the car *into* the wall it just touched, which reads as
 * the barrier grabbing you — a complaint about the handling, not about a minus.
 */

import { describe, expect, it } from 'vitest'
import { createCar, type Car, type WallQuery } from '../core/world'
import { carSetup } from './carSetup'
import { resolveWalls } from './collision'
import { stepCar } from './car'

const STEP = 1000 / 60

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

const WALL = 10
const HALF_WIDTH = carSetup.chassis.width / 2

interface Placement {
  x?: number
  z?: number
  heading?: number
  vx?: number
  vz?: number
  yawRate?: number
}

function place({ x = 0, z = 0, heading = 0, vx = 0, vz = 0, yawRate = 0 }: Placement): Car {
  const car = createCar(0, true)
  car.position.x = x
  car.position.z = z
  car.heading = heading
  car.velocity.x = vx
  car.velocity.z = vz
  car.yawRate = yawRate
  return car
}

/** Furthest either axle's bodywork reaches in x. Above `WALL` is inside the barrier. */
function reach(car: Car): number {
  const { wheelbase, frontWeightBias } = carSetup.chassis
  const front = wheelbase * (1 - frontWeightBias)
  const rear = -wheelbase * frontWeightBias
  return Math.max(
    car.position.x + Math.sin(car.heading) * front,
    car.position.x + Math.sin(car.heading) * rear,
  )
}

describe('resolveWalls', () => {
  it('leaves a car in clear air exactly as it found it', () => {
    const car = place({ x: 0, vz: 80 })
    expect(resolveWalls(car, STEP, wallAtX(WALL))).toBe(0)
    expect(car.position.x).toBe(0)
    expect(car.velocity.z).toBe(80)
    expect(car.impact).toBe(0)
  })

  it('puts the bodywork back outside the barrier', () => {
    // Centreline exactly on the wall line: half a car of overlap, both axles.
    const car = place({ x: WALL, vx: 12 })
    resolveWalls(car, STEP, wallAtX(WALL))
    expect(car.position.x).toBeCloseTo(WALL - HALF_WIDTH)
    expect(reach(car)).toBeLessThanOrEqual(WALL)
  })

  it('absorbs nearly all of a head-on hit rather than returning it', () => {
    const car = place({ x: WALL, heading: Math.PI / 2, vx: 40 })
    const closing = resolveWalls(car, STEP, wallAtX(WALL))
    expect(closing).toBeCloseTo(40)
    // Coming back off the wall, but at a fraction of the speed that went in. A
    // barrier that returns half of a 40m/s hit is a trampoline.
    expect(car.velocity.x).toBeLessThan(0)
    expect(Math.abs(car.velocity.x)).toBeLessThan(40 * 0.3)
  })

  it('scrubs speed off a car scraping along the wall', () => {
    const car = place({ x: WALL, vx: 2, vz: 70 })
    resolveWalls(car, STEP, wallAtX(WALL))
    // Along-wall speed is the one that matters: keeping it would make the
    // barrier a free guide rail through the corner.
    expect(car.velocity.z).toBeLessThan(70)
    expect(car.velocity.z).toBeGreaterThan(40)
  })

  it('does not spin a car that hits square', () => {
    // Pointing straight at the wall: heading PI/2 faces +x, and there is no
    // component of the impulse across the car to rotate it.
    const car = place({ x: WALL, heading: Math.PI / 2, vx: 30 })
    resolveWalls(car, STEP, wallAtX(WALL))
    expect(car.yawRate).toBeCloseTo(0)
  })

  it('spins a car that clips the wall with its nose, away from the wall', () => {
    // Running nearly parallel with the nose angled in — the classic Parabolica
    // exit. Only the front axle reaches the barrier.
    const car = place({ x: WALL - 1.1, heading: 0.25, vx: 6, vz: 60 })
    resolveWalls(car, STEP, wallAtX(WALL))
    // Negative is a rotation to the left, i.e. the nose knocked back off a wall
    // that is on the car's right. The other sign is the barrier grabbing you.
    expect(car.yawRate).toBeLessThan(0)
    expect(Math.abs(car.yawRate)).toBeLessThan(4.001)
  })

  it('records the hardest hit and forgets it within a couple of seconds', () => {
    const car = place({ x: WALL, heading: Math.PI / 2, vx: 25 })
    resolveWalls(car, STEP, wallAtX(WALL))
    expect(car.impact).toBeCloseTo(25)

    // Away from the wall and coasting: the number must fade on its own, because
    // the camera reads it every frame and nothing else will clear it.
    car.position.x = 0
    car.velocity.x = 0
    const clear: WallQuery = () => false
    for (let i = 0; i < 60 * 3; i++) resolveWalls(car, STEP, clear)
    expect(car.impact).toBe(0)
  })

  it('keeps the peak of a long scrape, not the last touch of it', () => {
    const car = place({ x: WALL, heading: Math.PI / 2, vx: 30 })
    resolveWalls(car, STEP, wallAtX(WALL))
    const peak = car.impact

    // Now barely touching it. Twelve gentle frames score nothing on their own —
    // they are under the floor — so what is left has to be the arrival still
    // fading, not the last touch overwriting it.
    for (let i = 0; i < 12; i++) {
      car.position.x = WALL
      car.velocity.x = 0.5
      resolveWalls(car, STEP, wallAtX(WALL))
    }
    expect(car.impact).toBeGreaterThan(10)
    // Fading, though: a scrape must not hold the camera at the peak forever.
    expect(car.impact).toBeLessThan(peak)
  })

  it('ignores a touch too gentle to be a hit', () => {
    const car = place({ x: WALL, vx: 0.4 })
    resolveWalls(car, STEP, wallAtX(WALL))
    // Resting against a barrier is not an impact, and a camera that shakes
    // while you are stationary against a wall is worse than one that never does.
    expect(car.impact).toBe(0)
  })
})

describe('a car driven into a wall', () => {
  it('never ends a step inside it, however hard it is pushed', () => {
    const car = place({ x: 0, heading: Math.PI / 2 - 0.05, vx: 85, vz: 4 })
    const walls = wallAtX(WALL)

    for (let i = 0; i < 240; i++) {
      car.input.throttle = 1
      stepCar(car, STEP, carSetup, walls)
      // Half a millimetre of tolerance for the float arithmetic; anything more
      // is the solver failing to keep up with the integrator.
      expect(reach(car), `step ${i}`).toBeLessThan(WALL + 0.0005)
      expect(Number.isFinite(car.position.x), `step ${i}`).toBe(true)
    }
  })

  it('costs the driver speed rather than stopping the car dead', () => {
    // A shallow brush should scrub, not anchor. Stopping dead on a graze is the
    // single most arcade thing a barrier can do.
    const car = place({ x: WALL - 1.05, heading: 0.02, vx: 1, vz: 75 })
    const walls = wallAtX(WALL)
    for (let i = 0; i < 30; i++) stepCar(car, STEP, carSetup, walls)

    const speed = Math.hypot(car.velocity.x, car.velocity.z)
    expect(speed).toBeLessThan(75)
    expect(speed).toBeGreaterThan(20)
  })
})
