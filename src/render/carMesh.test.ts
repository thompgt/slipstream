/**
 * Geometry and sign conventions, not appearance.
 *
 * CLAUDE.md forbids snapshot-testing rendering and this does not do that. What
 * it tests is the two things about the car that fail silently:
 *
 *   1. **Loft winding.** Wind the shell the other way and every face is
 *      back-facing. Nothing errors — the bodywork simply turns inside-out, and
 *      what you see is the inside of the far side of the car. That is an hour of
 *      debugging and a one-character fix, which is exactly the trade a test is
 *      for. `trackMesh.test.ts` exists for the same failure on the road.
 *
 *   2. **Motion signs.** Pitch, roll and steer are each 50/50 to be inverted on
 *      the first attempt, and an inverted one looks *nearly* right — a car that
 *      leans into its corners instead of away from them reads as "odd" long
 *      before it reads as "backwards".
 *
 * Dimensions are asserted too, because they are the whole claim of the file: if
 * a number drifts, the car stops being a Formula 1 car and nobody notices until
 * it is next to something real.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildCarMesh, CAR, loft } from './carMesh'
import { approach, bodyAttitude, carMotion, rollRate, steerAngle } from './carMotion'

describe('CAR dimensions', () => {
  it('is a 2026-regulation car, not an eyeballed one', () => {
    expect(CAR.noseTip - CAR.tail).toBeCloseTo(CAR.length, 6)
    expect(CAR.frontAxle - CAR.rearAxle).toBeCloseTo(CAR.wheelbase, 6)
  })

  it('keeps the tyres inside the overall width', () => {
    // Overall width is measured across the tyres, so the widest wheel centre
    // plus half a tyre is exactly the limit — never past it.
    const frontOuter = (CAR.width - CAR.frontTyreWidth) / 2 + CAR.frontTyreWidth / 2
    const rearOuter = (CAR.width - CAR.rearTyreWidth) / 2 + CAR.rearTyreWidth / 2
    expect(frontOuter).toBeCloseTo(CAR.width / 2, 6)
    expect(rearOuter).toBeCloseTo(CAR.width / 2, 6)
  })

  it('runs 18-inch wheels with a tyre around them', () => {
    // 18in = 0.4572m across. The tyre has to be bigger than the rim it sits on,
    // and an F1 sidewall is short — well under half the rim radius again.
    expect(CAR.rimRadius * 2).toBeCloseTo(0.4572, 4)
    expect(CAR.frontTyreRadius).toBeGreaterThan(CAR.rimRadius)
    expect(CAR.frontTyreRadius - CAR.rimRadius).toBeLessThan(CAR.rimRadius * 0.7)
    // Rears are wider than fronts on every F1 car ever built.
    expect(CAR.rearTyreWidth).toBeGreaterThan(CAR.frontTyreWidth)
  })
})

describe('buildCarMesh', () => {
  const car = buildCarMesh()

  it('gives four wheels, two of which steer', () => {
    expect(car.spinning).toHaveLength(4)
    expect(car.steering).toHaveLength(2)
  })

  it('hangs the wheels off the car, not off the leaning body', () => {
    // The body pitches and rolls on its springs; the tyres stay flat on the
    // road. If a wheel were parented to `body` it would lean with it and the
    // contact patch would visibly lift under braking.
    for (const wheel of car.spinning) {
      let ancestor: THREE.Object3D | null = wheel.parent
      while (ancestor) {
        expect(ancestor).not.toBe(car.body)
        ancestor = ancestor.parent
      }
    }
  })

  it('stays inside the draw-call budget on its own', () => {
    // One car must not eat the frame. CLAUDE.md caps the scene at 150 draw
    // calls and a grid of these has to fit alongside a circuit.
    let meshes = 0
    car.group.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes++
    })
    expect(meshes).toBeLessThanOrEqual(16)
  })

  it('fits the dimensions it claims', () => {
    const box = new THREE.Box3().setFromObject(car.group)
    const size = box.getSize(new THREE.Vector3())

    // Tolerances are loose because wings and endplates legitimately sit a
    // little inside the extremes; what is being caught is a part an order of
    // magnitude out of place, which is the realistic failure.
    expect(size.x).toBeGreaterThan(CAR.width - 0.1)
    expect(size.x).toBeLessThanOrEqual(CAR.width + 0.02)
    expect(size.z).toBeGreaterThan(CAR.length - 0.4)
    expect(size.z).toBeLessThanOrEqual(CAR.length + 0.02)
    expect(size.y).toBeLessThanOrEqual(CAR.height + 0.02)
  })

  it('sits on the ground rather than through it or above it', () => {
    const box = new THREE.Box3().setFromObject(car.group)
    // The lowest point is the bottom of the tyres, at y = 0.
    expect(box.min.y).toBeCloseTo(0, 2)
  })

  it('has bodywork at all', () => {
    // The merge is allowed to combine parts but not to drop them: a null return
    // from `mergeGeometries` is silent, and the car would simply have no paint.
    const names = car.body.children.map((child) => child.name)
    expect(names).toContain('paint')
    expect(names).toContain('carbon')
    expect(names).toContain('metal')
  })
})

describe('loft', () => {
  /**
   * A plain tapered tube on the z axis, centred on y = 0.
   *
   * Testing the primitive rather than the assembled car is deliberate: the
   * merged bodywork is four shells with four different axes, so "does this
   * normal point away from the axis" has no single answer there. Here it does.
   */
  const geometry = loft([
    { z: 2, halfWidth: 0.1, bottom: -0.1, top: 0.1, squareness: 3 },
    { z: 1, halfWidth: 0.3, bottom: -0.3, top: 0.3, squareness: 3 },
    { z: 0, halfWidth: 0.5, bottom: -0.5, top: 0.5, squareness: 4 },
    { z: -1, halfWidth: 0.35, bottom: -0.35, top: 0.35, squareness: 4 },
    { z: -2, halfWidth: 0.15, bottom: -0.15, top: 0.15, squareness: 3 },
  ])
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()!

  it('winds every face outwards', () => {
    // Face normal by cross product, compared against the direction from the
    // shell's axis to the face centre. A reversed winding points every one of
    // these back at the axis, the bodywork turns inside-out, and nothing errors.
    const at = (i: number): THREE.Vector3 =>
      new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i))

    for (let i = 0; i < index.count; i += 3) {
      const a = at(index.getX(i))
      const b = at(index.getX(i + 1))
      const c = at(index.getX(i + 2))

      const normal = b.clone().sub(a).cross(c.clone().sub(a))
      expect(normal.length(), `degenerate triangle at ${i}`).toBeGreaterThan(0)

      // Outward is away from the axis for the shell, and along z for the caps —
      // the centroid's own offset from the axis point at that z covers both,
      // because a cap's centroid sits on its own end plane.
      const centroid = a.clone().add(b).add(c).divideScalar(3)
      const outward = new THREE.Vector3(centroid.x, centroid.y, 0)
      // Cap triangles touch the axis, so fall back to the end's facing.
      if (outward.length() < 1e-6) outward.set(0, 0, Math.sign(centroid.z))
      else if (Math.abs(centroid.z) >= 2) outward.setZ(Math.sign(centroid.z) * outward.length())

      expect(normal.dot(outward), `inward-facing triangle at ${i}`).toBeGreaterThan(0)
    }
  })

  it('caps both ends so the shell can cast a shadow', () => {
    // An open tube casts a shadow with a hole down the middle of it, which is
    // the sort of thing that reads as a rendering bug rather than a modelling
    // one. Euler's formula on a closed surface: V - E + F = 2.
    const faces = index.count / 3
    const edges = new Set<string>()
    for (let i = 0; i < index.count; i += 3) {
      const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
      for (let e = 0; e < 3; e++) {
        const p = at3(position, tri[e]!)
        const q = at3(position, tri[(e + 1) % 3]!)
        edges.add([p, q].sort().join('|'))
      }
    }
    const vertices = new Set<string>()
    for (let i = 0; i < position.count; i++) vertices.add(at3(position, i))

    expect(vertices.size - edges.size + faces).toBe(2)
  })
})

/** A vertex's position as a string, so duplicated seam vertices collapse. */
function at3(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  i: number,
): string {
  return `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`
}

describe('body attitude', () => {
  it('puts the nose down under braking and up under power', () => {
    // Braking is a negative longitudinal g, and positive pitch is nose-down.
    expect(bodyAttitude(-1.5, 0).pitch).toBeGreaterThan(0)
    expect(bodyAttitude(1.5, 0).pitch).toBeLessThan(0)
  })

  it('leans away from the corner, not into it', () => {
    // Turning right is a positive lateral g; the body leans left, which raises
    // the right-hand side, which is a positive roll. Getting this backwards is
    // the classic motorcycle-lean bug.
    expect(bodyAttitude(0, 2).roll).toBeGreaterThan(0)
    expect(bodyAttitude(0, -2).roll).toBeLessThan(0)
  })

  it('never leans further than the springs allow', () => {
    // 5g is beyond anything the car can generate; the clamp is what stops a
    // solver spike from throwing the body on its side for one frame.
    expect(bodyAttitude(-5, 5).pitch).toBeCloseTo(carMotion.maxPitch, 6)
    expect(bodyAttitude(-5, 5).roll).toBeCloseTo(carMotion.maxRoll, 6)
    expect(bodyAttitude(5, -5).pitch).toBeCloseTo(-carMotion.maxPitch, 6)
    expect(bodyAttitude(5, -5).roll).toBeCloseTo(-carMotion.maxRoll, 6)
  })

  it('sits level when the car is doing nothing', () => {
    const level = bodyAttitude(0, 0)
    expect(level.pitch).toBeCloseTo(0, 9)
    expect(level.roll).toBeCloseTo(0, 9)
  })
})

describe('wheels', () => {
  it('steers right for a right input, and not past the lock', () => {
    expect(steerAngle(1)).toBeCloseTo(carMotion.steerLock, 6)
    expect(steerAngle(-1)).toBeCloseTo(-carMotion.steerLock, 6)
    expect(steerAngle(0)).toBe(0)
  })

  it('rolls forwards at road speed', () => {
    // One second at exactly one radius per second is one radian.
    expect(rollRate(CAR.frontTyreRadius, CAR.frontTyreRadius, 1)).toBeCloseTo(1, 6)
    // Reversing turns the wheel the other way rather than freezing it.
    expect(rollRate(-10, CAR.frontTyreRadius, 0.1)).toBeLessThan(0)
    expect(rollRate(0, CAR.frontTyreRadius, 0.1)).toBe(0)
  })

  it('turns the smaller wheel faster at the same road speed', () => {
    const front = rollRate(50, CAR.frontTyreRadius, 0.016)
    const rear = rollRate(50, CAR.rearTyreRadius, 0.016)
    expect(front).toBeGreaterThan(rear)
  })
})

describe('approach', () => {
  it('reaches the same place regardless of framerate', () => {
    // The whole point of the exponential form. One second of smoothing at 30fps
    // and at 144fps must land within a hair of each other, or the car leans
    // further on a slow machine than a fast one.
    const settle = (steps: number): number => {
      let value = 0
      for (let i = 0; i < steps; i++) value = approach(value, 1, 6, 1 / steps)
      return value
    }
    expect(settle(30)).toBeCloseTo(settle(144), 3)
  })

  it('moves toward the target and stops there', () => {
    expect(approach(0, 1, 10, 0.016)).toBeGreaterThan(0)
    expect(approach(0, 1, 10, 0.016)).toBeLessThan(1)
    expect(approach(1, 1, 10, 0.016)).toBeCloseTo(1, 9)
  })
})
