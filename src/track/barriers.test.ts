/**
 * Where the walls are.
 *
 * Arithmetic with a right answer, and one where being slightly wrong is
 * invisible: a normal pointing the wrong way pushes the car *through* the
 * barrier instead of out of it, and the car reappears in the trees rather than
 * on the road. The circuit here is a plain circle, so the answers can be checked
 * against the radius by hand.
 */

import { describe, expect, it } from 'vitest'
import { createWallContact } from '../core/world'
import { createWallQuery } from './barriers'
import { BARRIER_OFFSET } from './layout'
import { buildTrackIndex } from './query'
import { buildTrack, type TrackNode } from './spline'

const RADIUS = 200
const WIDTH = 7

const circle = (nodes = 48): TrackNode[] =>
  Array.from({ length: nodes }, (_, i) => {
    const angle = (i / nodes) * Math.PI * 2
    return { x: Math.sin(angle) * RADIUS, z: Math.cos(angle) * RADIUS, width: WIDTH }
  })

const track = buildTrack(circle(), { name: 'circle', spacing: 4 })
const walls = createWallQuery(buildTrackIndex(track))
const out = createWallContact()

/** On the circle, the wall lines sit this far from the centre either side. */
const OUTER = RADIUS + WIDTH + BARRIER_OFFSET
const INNER = RADIUS - WIDTH - BARRIER_OFFSET

describe('createWallQuery', () => {
  it('finds nothing on the racing surface', () => {
    expect(walls(0, RADIUS, 1, out)).toBe(false)
    expect(walls(0, RADIUS + WIDTH - 0.5, 1, out)).toBe(false)
    expect(walls(RADIUS, 0, 1, out)).toBe(false)
  })

  it('finds nothing in the run-off, which is not a wall', () => {
    // Running wide costs grip, and only grip, until you reach the barrier.
    expect(walls(0, RADIUS + WIDTH + 4, 1, out)).toBe(false)
  })

  it('catches a car past the outer barrier and points it back at the road', () => {
    expect(walls(0, OUTER + 0.4, 0, out)).toBe(true)
    expect(out.depth).toBeCloseTo(0.4, 1)
    // At this point on the circle the road runs along x, so back toward the
    // centre is -z.
    expect(out.normalZ).toBeCloseTo(-1, 2)
    expect(out.normalX).toBeCloseTo(0, 2)
  })

  it('catches a car past the inner barrier and points it the other way', () => {
    expect(walls(0, INNER - 0.4, 0, out)).toBe(true)
    expect(out.depth).toBeCloseTo(0.4, 1)
    expect(out.normalZ).toBeCloseTo(1, 2)
  })

  it('reports a unit normal, wherever on the lap it is asked', () => {
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      const x = Math.sin(angle) * (OUTER + 1)
      const z = Math.cos(angle) * (OUTER + 1)
      expect(walls(x, z, 0, out), `at ${i}`).toBe(true)
      expect(Math.hypot(out.normalX, out.normalZ), `at ${i}`).toBeCloseTo(1)
      // On a circle the outward normal is the inward radius, exactly.
      expect(out.normalX, `at ${i}`).toBeCloseTo(-Math.sin(angle), 1)
      expect(out.normalZ, `at ${i}`).toBeCloseTo(-Math.cos(angle), 1)
    }
  })

  it('lets a wide car touch a barrier its centreline has not reached', () => {
    const justInside = OUTER - 0.5
    expect(walls(0, justInside, 0, out)).toBe(false)
    expect(walls(0, justInside, 1, out)).toBe(true)
    expect(out.depth).toBeCloseTo(0.5, 1)
  })

  it('leaves the contact untouched when the car is clear', () => {
    out.depth = 99
    expect(walls(0, RADIUS, 1, out)).toBe(false)
    // Writing nothing on a miss is what makes the common case free.
    expect(out.depth).toBe(99)
  })
})
