/**
 * Lap counting, standings, and the start/finish wraparound.
 *
 * Cars are teleported around the circle rather than driven: the question here is
 * whether crossing the line is counted correctly, and driving a real car there
 * would make every case depend on the handling model too. The physics has its
 * own suites for that.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createCar, createWorld, type Car, type World } from '../core/world'
import { buildTrackIndex } from '../track/query'
import { buildTrack, pointAt, type TrackNode } from '../track/spline'
import { createRaceDirector } from './race'

const RADIUS = 200

/** A plain circle, so a distance along the lap maps to a position in closed form. */
const circle = (nodes = 24): TrackNode[] =>
  Array.from({ length: nodes }, (_, i) => {
    const angle = (i / nodes) * Math.PI * 2
    return { x: Math.sin(angle) * RADIUS, z: Math.cos(angle) * RADIUS, width: 8 }
  })

const track = buildTrack(circle(), { name: 'circle', spacing: 4 })
const index = buildTrackIndex(track)

let world: World
let car: Car
let director: ReturnType<typeof createRaceDirector>

const place = (target: Car, distance: number): void => {
  pointAt(track, distance, 0, target.position)
}

/** Put the car at a distance along the lap and let the director see it there. */
const moveTo = (distance: number, elapsed = 100): void => {
  place(car, distance)
  world.time += elapsed
  director.update(world)
}

beforeEach(() => {
  world = createWorld()
  car = createCar(0, true)
  world.cars.push(car)
  director = createRaceDirector(index)
})

describe('lap counting', () => {
  it('counts a lap when the car crosses the line, not before', () => {
    moveTo(0)
    for (const fraction of [0.25, 0.5, 0.75, 0.95]) {
      moveTo(track.length * fraction)
      expect(car.lap).toBe(0)
    }

    moveTo(track.length * 0.02)
    expect(car.lap).toBe(1)
  })

  it('counts several laps in a row', () => {
    moveTo(0)
    for (let lap = 1; lap <= 5; lap++) {
      for (const fraction of [0.3, 0.6, 0.9]) moveTo(track.length * fraction)
      moveTo(track.length * 0.01)
      expect(car.lap).toBe(lap)
    }
  })

  it('takes the lap back off a car that reverses over the line', () => {
    moveTo(0)
    moveTo(track.length * 0.5)
    moveTo(track.length * 0.99)
    moveTo(track.length * 0.02)
    expect(car.lap).toBe(1)

    moveTo(track.length * 0.99)
    expect(car.lap).toBe(0)
  })

  it('does not count a lap for a car that is placed on track mid-session', () => {
    // The first sight of a car has nothing to compare against. Without the
    // guard, a car spawned three-quarters of the way round would be credited
    // with having driven there — which on a grid is every car but pole.
    moveTo(track.length * 0.75)
    expect(car.lap).toBe(0)

    moveTo(track.length * 0.8)
    expect(car.lap).toBe(0)
  })
})

describe('lap timing', () => {
  /**
   * One lap in four hops taking `ms` in total.
   *
   * Quarters rather than halves on purpose: a car that teleports exactly half a
   * lap is genuinely ambiguous — forwards and backwards are the same distance —
   * and `lapDelta` resolves that tie by going backwards. Real cars move a metre
   * per step and never ask.
   */
  const driveLap = (ms: number): void => {
    moveTo(track.length * 0.3, ms * 0.3)
    moveTo(track.length * 0.6, ms * 0.3)
    moveTo(track.length * 0.9, ms * 0.3)
    moveTo(track.length * 0.02, ms * 0.1)
  }

  it('times a lap on simulation time', () => {
    moveTo(0, 0)
    driveLap(60_000)

    expect(car.lap).toBe(1)
    expect(director.timing(car.id)?.last).toBe(60_000)
    expect(director.timing(car.id)?.best).toBe(60_000)
  })

  it('keeps the best lap, not the most recent one', () => {
    moveTo(0, 0)
    driveLap(60_000)
    driveLap(45_000)
    driveLap(70_000)

    expect(director.timing(car.id)?.last).toBe(70_000)
    expect(director.timing(car.id)?.best).toBe(45_000)
  })

  it('restarts the clock on a reset but keeps the best lap', () => {
    moveTo(0, 0)
    driveLap(60_000)
    expect(director.timing(car.id)?.best).toBe(60_000)

    world.time += 5_000
    director.restart(car, world)
    expect(director.timing(car.id)?.current).toBe(0)
    expect(director.timing(car.id)?.last).toBe(null)
    expect(director.timing(car.id)?.best).toBe(60_000)
  })
})

describe('surface', () => {
  it('tells the car what it is standing on', () => {
    moveTo(0)
    expect(car.surface).toEqual({ grip: 1, drag: 1 })

    // Well outside the 8m half-width, onto the default grass run-off.
    place(car, track.length * 0.25)
    car.position.x *= 1.1
    car.position.z *= 1.1
    director.update(world)

    expect(car.surface.grip).toBeLessThan(0.6)
    expect(car.surface.drag).toBeGreaterThan(1)
  })
})

describe('standings', () => {
  it('sorts by laps first, then by distance round the lap', () => {
    const second = createCar(1)
    const third = createCar(2)
    world.cars.push(second, third)

    place(car, 10)
    place(second, track.length * 0.9)
    place(third, 5)
    director.update(world)

    // Lap counts are the director's to change, but nothing has moved since the
    // seeding update above, so they stand.
    car.lap = 1
    second.lap = 1
    third.lap = 2
    director.update(world)

    // The car nearly a full lap ahead on the road is still behind on race
    // distance — the case a naive sort on `distanceAlongTrack` gets backwards
    // every time the leader laps someone.
    expect(world.race.standings).toEqual([2, 1, 0])
  })
})
