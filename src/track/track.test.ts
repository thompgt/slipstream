import { describe, expect, it } from 'vitest'
import { vec2 } from '../core/math'
import {
  buildTrackIndex,
  createTrackPosition,
  lapDelta,
  locate,
  surfaceDrag,
  surfaceGrip,
} from './query'
import { buildTrack, pointAt, sampleAt, type TrackNode } from './spline'

/**
 * A circle of known radius, which makes almost everything checkable in closed
 * form: the length is 2*pi*r, the curvature is exactly 1/r everywhere, and the
 * distance around it is the arc length. Testing a spline against a hand-authored
 * circuit only tells you the spline agrees with itself.
 */
const circle = (radius: number, nodes = 16, width = 6): TrackNode[] =>
  Array.from({ length: nodes }, (_, i) => {
    const angle = (i / nodes) * Math.PI * 2
    // Clockwise in the x/z convention, so the track curves right — matching the
    // positive-curvature sign the physics uses for a right-hand turn.
    return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius, width }
  })

const straightThenCorner = (): TrackNode[] => [
  { x: 0, z: 0, width: 6, runoffLeft: 'gravel', runoffRight: 'grass' },
  { x: 0, z: 60, width: 6, runoffLeft: 'gravel', runoffRight: 'grass' },
  { x: 0, z: 120, width: 6, kerbRight: true, runoffLeft: 'gravel' },
  { x: 30, z: 170, width: 5, kerbRight: true, name: 'Turn 1' },
  { x: 90, z: 170, width: 7 },
  { x: 120, z: 110, width: 6 },
  { x: 120, z: 40, width: 6 },
  { x: 60, z: -20, width: 6 },
]

describe('buildTrack', () => {
  it('measures a circle’s length as its circumference', () => {
    const track = buildTrack(circle(100), { name: 'circle' })
    // A 16-node spline through a circle is very slightly polygonal, so allow a
    // fraction of a percent rather than demanding exactness.
    expect(track.length).toBeGreaterThan(2 * Math.PI * 100 * 0.99)
    expect(track.length).toBeLessThan(2 * Math.PI * 100 * 1.01)
  })

  it('samples at an even spacing that closes the loop exactly', () => {
    const track = buildTrack(circle(100), { name: 'circle', spacing: 2 })

    expect(track.spacing).toBeCloseTo(track.length / track.samples.length, 9)
    for (let i = 1; i < track.samples.length; i++) {
      const step = track.samples[i]!.distance - track.samples[i - 1]!.distance
      expect(step).toBeCloseTo(track.spacing, 6)
    }
  })

  it('recovers the curvature of a circle as 1/radius', () => {
    for (const radius of [50, 100, 250]) {
      const track = buildTrack(circle(radius, 24), { name: 'circle' })
      // Skip nothing — a closed circle has no ends, so every sample should agree.
      for (const sample of track.samples) {
        expect(Math.abs(sample.curvature)).toBeGreaterThan(0.9 / radius)
        expect(Math.abs(sample.curvature)).toBeLessThan(1.1 / radius)
      }
    }
  })

  it('signs curvature positive for a right-hand turn', () => {
    // Same sign convention as yaw rate and steering input. Getting this backwards
    // makes the AI steer the wrong way out of every corner.
    const track = buildTrack(circle(100), { name: 'clockwise' })
    expect(track.samples[0]!.curvature).toBeGreaterThan(0)
  })

  it('points heading along the direction of travel', () => {
    const track = buildTrack(straightThenCorner(), { name: 'mixed' })
    // The first leg runs straight up +z, which is heading 0.
    const onStraight = sampleAt(track, 30)
    expect(Math.abs(onStraight.heading)).toBeLessThan(0.15)
  })

  it('interpolates width between authored nodes', () => {
    const track = buildTrack(straightThenCorner(), { name: 'mixed' })
    for (const sample of track.samples) {
      expect(sample.width).toBeGreaterThanOrEqual(5)
      expect(sample.width).toBeLessThanOrEqual(7)
    }
  })

  it('refuses a circuit too short to spline', () => {
    expect(() => buildTrack([{ x: 0, z: 0, width: 5 }], { name: 'stub' })).toThrow(/at least 4/)
  })

  it('places sector boundaries around the lap', () => {
    const track = buildTrack(circle(100), { name: 'circle' })
    expect(track.sectors[0]).toBe(0)
    expect(track.sectors[1]).toBeGreaterThan(0)
    expect(track.sectors[2]).toBeGreaterThan(track.sectors[1])
    expect(track.sectors[2]).toBeLessThan(track.length)
  })
})

describe('pointAt', () => {
  it('offsets to the right of the direction of travel', () => {
    const track = buildTrack(circle(100), { name: 'circle' })
    const out = vec2()

    // On a clockwise circle the inside is to the right, so a positive lateral
    // offset must land closer to the centre.
    pointAt(track, 0, 10, out)
    expect(Math.hypot(out.x, out.z)).toBeLessThan(100)

    pointAt(track, 0, -10, out)
    expect(Math.hypot(out.x, out.z)).toBeGreaterThan(100)
  })

  it('round-trips against locate', () => {
    const track = buildTrack(straightThenCorner(), { name: 'mixed' })
    const index = buildTrackIndex(track)
    const out = createTrackPosition()
    const point = vec2()

    for (const distance of [0, 50, 137, 260, track.length - 5]) {
      for (const lateral of [-3, 0, 2.5]) {
        pointAt(track, distance, lateral, point)
        locate(index, point.x, point.z, out)

        expect(out.lateralOffset).toBeCloseTo(lateral, 1)
        // Compare the wrapped difference, not the raw values.
        expect(Math.abs(lapDelta(distance, out.distanceAlong, track.length))).toBeLessThan(1.5)
      }
    }
  })
})

describe('locate', () => {
  it('agrees with a brute-force nearest-sample search', () => {
    // The spatial index is an optimisation, so it needs an oracle. A wrong
    // answer here would surface as cars randomly gaining or losing a lap.
    const track = buildTrack(straightThenCorner(), { name: 'mixed' })
    const index = buildTrackIndex(track)
    const out = createTrackPosition()

    for (let x = -60; x <= 200; x += 7) {
      for (let z = -80; z <= 240; z += 7) {
        locate(index, x, z, out)

        let bestIndex = 0
        let best = Infinity
        for (let i = 0; i < track.samples.length; i++) {
          const sample = track.samples[i]!
          const d = (sample.x - x) ** 2 + (sample.z - z) ** 2
          if (d < best) {
            best = d
            bestIndex = i
          }
        }

        expect(out.sampleIndex, `at (${x}, ${z})`).toBe(bestIndex)
      }
    }
  })

  it('finds the track from far outside it', () => {
    // A car through a barrier still has to be locatable, or standings break at
    // the worst possible moment.
    const track = buildTrack(circle(100), { name: 'circle' })
    const index = buildTrackIndex(track)
    const out = createTrackPosition()

    locate(index, 100000, -100000, out)
    expect(Number.isFinite(out.distanceAlong)).toBe(true)
    expect(out.distanceAlong).toBeGreaterThanOrEqual(0)
    expect(out.distanceAlong).toBeLessThan(track.length)
  })

  it('increases distanceAlong monotonically driving forwards, and wraps once', () => {
    // The property PLAN.md says to validate lap counting with, rather than
    // trigger volumes.
    const track = buildTrack(circle(100), { name: 'circle' })
    const index = buildTrackIndex(track)
    const out = createTrackPosition()
    const point = vec2()

    let previous = 0
    let travelled = 0
    for (let step = 0; step <= 400; step++) {
      const distance = (step / 400) * track.length * 1.5
      pointAt(track, distance % track.length, 0, point)
      locate(index, point.x, point.z, out)

      if (step > 0) {
        const delta = lapDelta(previous, out.distanceAlong, track.length)
        expect(delta).toBeGreaterThanOrEqual(-0.001)
        travelled += delta
      }
      previous = out.distanceAlong
    }

    expect(travelled).toBeCloseTo(track.length * 1.5, 0)
  })

  it('reports lateral offset with a consistent sign', () => {
    const track = buildTrack(circle(100), { name: 'circle' })
    const index = buildTrackIndex(track)
    const out = createTrackPosition()

    // Inside the circle is right of travel, so positive.
    locate(index, 0, 90, out)
    expect(out.lateralOffset).toBeGreaterThan(0)
    locate(index, 0, 110, out)
    expect(out.lateralOffset).toBeLessThan(0)
  })
})

describe('surfaces', () => {
  it('reads asphalt on the road and run-off beyond it', () => {
    const track = buildTrack(straightThenCorner(), { name: 'mixed' })
    const index = buildTrackIndex(track)
    const out = createTrackPosition()
    const point = vec2()

    pointAt(track, 40, 0, point)
    expect(locate(index, point.x, point.z, out).surface).toBe('asphalt')

    // Well beyond the road and any kerb, on the gravel side.
    pointAt(track, 40, -20, point)
    expect(locate(index, point.x, point.z, out).surface).toBe('gravel')
  })

  it('grips worst on gravel and best on asphalt', () => {
    expect(surfaceGrip('asphalt')).toBe(1)
    expect(surfaceGrip('kerb')).toBeLessThan(surfaceGrip('asphalt'))
    expect(surfaceGrip('grass')).toBeLessThan(surfaceGrip('kerb'))
    expect(surfaceGrip('gravel')).toBeLessThan(surfaceGrip('grass'))
  })

  it('drags hardest on gravel — the trap is the scrub, not the grip', () => {
    expect(surfaceDrag('gravel')).toBeGreaterThan(surfaceDrag('grass'))
    expect(surfaceDrag('grass')).toBeGreaterThan(surfaceDrag('asphalt'))
    expect(surfaceDrag('asphalt')).toBe(1)
  })
})

describe('lapDelta', () => {
  it('measures forward progress across the start/finish line', () => {
    // The bug this exists to prevent: 1000 -> 5 on a 1005m lap is 10m forward,
    // not 995m backwards.
    expect(lapDelta(1000, 5, 1005)).toBeCloseTo(10, 9)
    expect(lapDelta(5, 1000, 1005)).toBeCloseTo(-10, 9)
    expect(lapDelta(100, 150, 1005)).toBeCloseTo(50, 9)
  })

  it('is antisymmetric', () => {
    for (const [a, b] of [
      [10, 900],
      [400, 600],
      [999, 1],
    ] as const) {
      expect(lapDelta(a, b, 1000)).toBeCloseTo(-lapDelta(b, a, 1000), 9)
    }
  })
})
