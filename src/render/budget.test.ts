/**
 * The performance budget, enforced.
 *
 * CLAUDE.md: "The performance budget below is the one thing that does not bend.
 * Simulation quality that drops the game under 60fps is not a win." It then
 * gives the numbers — ≤150 draw calls, ≤120k triangles — and until now nothing
 * checked them, so they were an intention rather than a constraint.
 *
 * This is not a rendering snapshot; it counts geometry, which is arithmetic with
 * a right answer. What it catches is the realistic failure: scenery is exactly
 * the sort of thing that gets added a handful at a time, each addition obviously
 * affordable, until the frame is gone and no single commit is to blame.
 *
 * Instanced meshes count as one draw call and all their instances' triangles,
 * which is how the GPU sees them.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { monza } from '../track/circuits/monza'
import { buildCarMesh } from './carMesh'
import { buildTrackMesh } from './trackMesh'
import { buildTrackside } from './trackside'

const MAX_DRAW_CALLS = 150
const MAX_TRIANGLES = 120_000

/**
 * Headroom for the grid.
 *
 * M4 puts five AI cars on track. They are the same mesh as the player's, so the
 * scene has to survive six of them — if the static scenery leaves less room than
 * that, the budget is already spent and nobody has noticed yet.
 */
const GRID_SIZE = 6

interface Cost {
  calls: number
  triangles: number
}

function measure(objects: THREE.Object3D[]): Cost {
  let calls = 0
  let triangles = 0
  for (const object of objects) {
    object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      calls++
      const geometry = node.geometry
      const vertices = geometry.index
        ? geometry.index.count
        : geometry.getAttribute('position').count
      const instances = node instanceof THREE.InstancedMesh ? node.count : 1
      triangles += (vertices / 3) * instances
    })
  }
  return { calls, triangles }
}

describe('scene budget at Monza', () => {
  const track = monza()
  const road = measure([buildTrackMesh(track)])
  const trackside = measure(buildTrackside(track).objects)
  const car = measure([buildCarMesh().group])

  it('draws a full grid inside the draw-call budget', () => {
    const total = road.calls + trackside.calls + car.calls * GRID_SIZE
    expect(total).toBeLessThanOrEqual(MAX_DRAW_CALLS)
  })

  it('draws a full grid inside the triangle budget', () => {
    const total = road.triangles + trackside.triangles + car.triangles * GRID_SIZE
    expect(total).toBeLessThanOrEqual(MAX_TRIANGLES)
  })

  it('keeps one car cheap enough to multiply', () => {
    // The whole point of merging the bodywork by material. If a car ever costs
    // more than this, a grid stops fitting and the cause is here, not in the
    // scenery.
    expect(car.calls).toBeLessThanOrEqual(16)
    expect(car.triangles).toBeLessThanOrEqual(12_000)
  })

  it('spends most of the triangles on scenery, not on the road', () => {
    // A sanity check on the ribbon builder rather than a budget: the road is one
    // mesh at 2m spacing, and if it ever dominates the frame something has gone
    // wrong with the sample stride rather than with the art.
    expect(road.calls).toBe(1)
    expect(road.triangles).toBeLessThan(MAX_TRIANGLES / 2)
  })
})
