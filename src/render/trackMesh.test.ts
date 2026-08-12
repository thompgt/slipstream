/**
 * Not a rendering test — a geometry test.
 *
 * CLAUDE.md says never to snapshot-test rendering, and this does not: it asserts
 * arithmetic that has a right answer. The reason it exists at all is that the
 * failure mode is silent and total. Wind the triangles the other way and every
 * face is back-facing: the circuit is culled, the screen is empty, and nothing
 * anywhere reports an error. That is a bug you debug for an hour and fix in a
 * character, which is exactly the kind worth a test.
 */

import { describe, expect, it } from 'vitest'
import { buildTrack, type TrackNode } from '../track/spline'
import { buildTrackMesh, trackBounds } from './trackMesh'

const RADIUS = 120
const WIDTH = 7

const circle = (nodes = 24): TrackNode[] =>
  Array.from({ length: nodes }, (_, i) => {
    const angle = (i / nodes) * Math.PI * 2
    return { x: Math.sin(angle) * RADIUS, z: Math.cos(angle) * RADIUS, width: WIDTH }
  })

const track = buildTrack(circle(), { name: 'circle', spacing: 4 })
const mesh = buildTrackMesh(track)
const position = mesh.geometry.getAttribute('position')
const index = mesh.geometry.getIndex()!

describe('buildTrackMesh', () => {
  it('closes the ribbon back onto itself', () => {
    // One segment per sample, not one fewer: the last joins the first, and a
    // circuit with a missing segment has a hole you only see from one angle.
    // One row of vertices more than there are samples, because that last
    // segment ends on a duplicate of row zero rather than on row zero itself —
    // same place, different distance along the lap, which is what keeps the
    // grain from unwinding across the start line.
    expect(position.count).toBe((track.samples.length + 1) * 14)
    expect(index.count).toBe(track.samples.length * 7 * 6)
  })

  it('ends the closing row exactly where it started', () => {
    const first = 0
    const closing = track.samples.length * 14
    for (let v = 0; v < 14; v++) {
      expect(position.getX(closing + v)).toBeCloseTo(position.getX(first + v))
      expect(position.getY(closing + v)).toBeCloseTo(position.getY(first + v))
      expect(position.getZ(closing + v)).toBeCloseTo(position.getZ(first + v))
    }
  })

  it('runs the grain forwards over a whole number of tiles', () => {
    const uv = mesh.geometry.getAttribute('uv')
    // v must increase monotonically along the lap and land on an integer at the
    // close, or the texture is discontinuous where every lap begins.
    for (let row = 1; row <= track.samples.length; row++) {
      expect(uv.getY(row * 14)).toBeGreaterThan(uv.getY((row - 1) * 14))
    }
    const total = uv.getY(track.samples.length * 14)
    expect(total).toBeCloseTo(Math.round(total))
    expect(total).toBeGreaterThan(1)
  })

  it('winds every triangle face-up', () => {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i)
      const b = index.getX(i + 1)
      const c = index.getX(i + 2)

      const abx = position.getX(b) - position.getX(a)
      const abz = position.getZ(b) - position.getZ(a)
      const acx = position.getX(c) - position.getX(a)
      const acz = position.getZ(c) - position.getZ(a)

      // The y component of (ab x ac). Positive is up; zero would be a degenerate
      // triangle, which is just as invisible.
      const normalY = abz * acx - abx * acz
      expect(normalY, `triangle at index ${i}`).toBeGreaterThan(0)
    }
  })

  it('lays the road down at the width the samples declare', () => {
    // Band 3 is the asphalt between the white lines. Its outer edge should sit
    // just inside the declared half-width — if the mesh and the query disagree
    // about where the road ends, the white line stops meaning anything.
    for (let sample = 0; sample < track.samples.length; sample += 7) {
      const vertex = sample * 14 + 3 * 2 + 1
      const x = position.getX(vertex)
      const z = position.getZ(vertex)
      const distanceFromCentre = Math.hypot(x, z)

      expect(Math.abs(distanceFromCentre - RADIUS)).toBeGreaterThan(WIDTH - 0.5)
      expect(Math.abs(distanceFromCentre - RADIUS)).toBeLessThan(WIDTH)
    }
  })

  it('measures bounds that contain the whole circuit', () => {
    const bounds = trackBounds(track)
    expect(bounds.centreX).toBeCloseTo(0, 1)
    expect(bounds.centreZ).toBeCloseTo(0, 1)
    expect(bounds.size).toBeGreaterThan(RADIUS * 2)
  })
})
