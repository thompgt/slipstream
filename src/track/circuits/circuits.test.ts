import { describe, expect, it } from 'vitest'
import { buildTrackIndex, createTrackPosition, locate } from '../query'
import { pointAt } from '../spline'
import { vec2 } from '../../core/math'
import { monza, monzaLayout } from './monza'

/**
 * Every circuit must pass these. They are the difference between "the spline
 * ran" and "this is drivable", and each one corresponds to a failure that is
 * miserable to diagnose from the symptom alone — a car that loses a lap on the
 * main straight, an AI that brakes for a corner that isn't there, a kink you can
 * feel but cannot see.
 */
const describeCircuit = (name: string, build: () => ReturnType<typeof monza>, expectedLength: number): void => {
  describe(name, () => {
    const track = build()

    it('is the right length', () => {
      expect(track.length).toBeCloseTo(expectedLength, 0)
    })

    it('has no kink at the start/finish seam', () => {
      // The seam is where a lap joins itself, and it is the one join no amount
      // of driving will make you look at directly — you just feel the car dart.
      // A radius under ~40m anywhere on a straight is a mistake in the layout.
      const seam = track.samples.filter(
        (sample) => sample.distance < 100 || sample.distance > track.length - 100,
      )
      for (const sample of seam) {
        expect(Math.abs(sample.curvature), `at ${sample.distance.toFixed(0)}m`).toBeLessThan(1 / 200)
      }
    })

    it('has no corner tighter than a hairpin anywhere', () => {
      // Catches a spline overshoot, which shows up as a single sample with
      // enormous curvature rather than as a visibly wrong shape.
      for (const sample of track.samples) {
        expect(Math.abs(sample.curvature), `at ${sample.distance.toFixed(0)}m`).toBeLessThan(1 / 12)
      }
    })

    it('has a plausible road width everywhere', () => {
      for (const sample of track.samples) {
        expect(sample.width).toBeGreaterThan(3)
        expect(sample.width).toBeLessThan(12)
      }
    })

    it('varies in curvature — it is a circuit, not a circle', () => {
      const curvatures = track.samples.map((sample) => Math.abs(sample.curvature))
      const straightish = curvatures.filter((k) => k < 1 / 500).length
      const corners = curvatures.filter((k) => k > 1 / 100).length

      expect(straightish).toBeGreaterThan(track.samples.length * 0.15)
      expect(corners).toBeGreaterThan(track.samples.length * 0.05)
    })

    it('locates a lap driven down its own centreline', () => {
      const index = buildTrackIndex(track)
      const out = createTrackPosition()
      const point = vec2()

      for (let distance = 0; distance < track.length; distance += 25) {
        pointAt(track, distance, 0, point)
        locate(index, point.x, point.z, out)

        expect(Math.abs(out.lateralOffset), `at ${distance}m`).toBeLessThan(1)
        expect(out.surface, `at ${distance}m`).toBe('asphalt')
      }
    })

    it('puts its sectors in order and inside the lap', () => {
      const [s1, s2, s3] = track.sectors
      expect(s1).toBe(0)
      expect(s2).toBeGreaterThan(s1)
      expect(s3).toBeGreaterThan(s2)
      expect(s3).toBeLessThan(track.length)
    })
  })
}

describeCircuit('Monza', monza, 5793)

describe('Monza layout', () => {
  const layout = monzaLayout()

  it('turns through exactly one full circle', () => {
    // Heading closure. If this is not 360 the lap physically cannot join up, and
    // every other symptom is downstream of it.
    expect(layout.totalTurn()).toBeCloseTo(360, 6)
  })

  it('returns to where it started', () => {
    // Position closure. A metre or so is invisible once the duplicate end node
    // is dropped and the spline bridges it; tens of metres is a dogleg in the
    // main straight. Corner angles are fixed by what Monza is, so the Serraglio
    // and the run to Parabolica are the two straights that solve this — change
    // a corner and they must be re-solved, and this test is what tells you.
    expect(layout.closureError()).toBeLessThan(3)
  })

  it('names its corners', () => {
    const named = layout
      .nodes()
      .map((node) => node.name)
      .filter(Boolean)

    expect(named).toContain('Rettifilo')
    expect(named).toContain('Curva Grande')
    expect(named).toContain('Lesmo 1')
    expect(named).toContain('Ascari')
    expect(named).toContain('Parabolica')
  })
})
