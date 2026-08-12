/**
 * Camera rig maths.
 *
 * Not a rendering snapshot — CLAUDE.md rules those out, and rightly. What is
 * testable here is that a camera ends up where the geometry says it should:
 * behind a car that is facing any direction, on the roll hoop rather than beside
 * it, and leaning with the body only when it is bolted to the body. Those are
 * the failures that are invisible in a still frame and obvious at 200kph, which
 * makes them exactly the ones worth asserting.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CAR } from './carMesh'
import {
  CAMERA_VIEWS,
  cameraPose,
  cameraUp,
  fovFor,
  nextView,
  rigFor,
  roughness,
  shake,
  shakeAmount,
  shakeOffset,
  type CarPose,
} from './cameras'
import { cameraSetup } from './cameraSetup'

const pose = (overrides: Partial<CarPose> = {}): CarPose => ({
  x: 0,
  z: 0,
  heading: 0,
  pitch: 0,
  roll: 0,
  ...overrides,
})

const posed = (view: (typeof CAMERA_VIEWS)[number], p: CarPose) => {
  const eye = new THREE.Vector3()
  const look = new THREE.Vector3()
  const up = new THREE.Vector3()
  const rig = rigFor(view)
  cameraPose(rig, p, eye, look)
  cameraUp(rig, p, up)
  return { rig, eye, look, up }
}

describe('rigs', () => {
  it('offers every view exactly once, and cycles back to the start', () => {
    expect(new Set(CAMERA_VIEWS).size).toBe(CAMERA_VIEWS.length)
    let view = CAMERA_VIEWS[0] ?? 'chase'
    for (let i = 0; i < CAMERA_VIEWS.length; i++) view = nextView(view)
    expect(view).toBe(CAMERA_VIEWS[0])
  })

  it('springs the chase camera and bolts the onboards down', () => {
    // The distinction the whole file turns on. A spring on an onboard rig slides
    // the shot around inside the tub; no spring on the chase reads as no speed.
    expect(rigFor('chase').stiffness).toBe(cameraSetup.stiffness)
    expect(rigFor('tcam').stiffness).toBeNull()
    expect(rigFor('cockpit').stiffness).toBeNull()
  })

  it('takes the chase numbers from the tunable setup', () => {
    // The tuning panel edits `cameraSetup` in place, so a rig that snapshotted
    // those values at import time would ignore every slider.
    const rig = rigFor('chase', { ...cameraSetup, distance: 20, height: 5 })
    expect(rig.eye).toEqual([0, 5, -20])
  })
})

describe('where the cameras sit', () => {
  it('puts the chase camera behind and above a car facing +z', () => {
    const { eye, look } = posed('chase', pose())
    expect(eye.z).toBeCloseTo(-cameraSetup.distance)
    expect(eye.y).toBeCloseTo(cameraSetup.height)
    // And aimed up the road, not at the gearbox.
    expect(look.z).toBeGreaterThan(eye.z)
  })

  it('rotates the rig with the car rather than orbiting it', () => {
    // Heading +90° faces +x, so "behind" is -x. Getting this wrong is a camera
    // that swings out to the side of the car through every corner.
    const { eye } = posed('chase', pose({ heading: Math.PI / 2 }))
    expect(eye.x).toBeCloseTo(-cameraSetup.distance)
    expect(eye.z).toBeCloseTo(0)
  })

  it('follows the car across the circuit', () => {
    const { eye, look } = posed('chase', pose({ x: 120, z: -400 }))
    expect(eye.x).toBeCloseTo(120)
    expect(eye.z).toBeCloseTo(-400 - cameraSetup.distance)
    expect(look.x).toBeCloseTo(120)
  })

  it('mounts the onboards on the car, not near it', () => {
    for (const view of ['tcam', 'cockpit'] as const) {
      const { eye } = posed(view, pose())
      // Within the car's own footprint, ahead of the rear axle and behind the
      // nose. A camera outside this is not on the car whatever it is called.
      expect(Math.abs(eye.x)).toBeLessThan(CAR.width / 2)
      expect(eye.z).toBeGreaterThan(CAR.rearAxle)
      expect(eye.z).toBeLessThan(CAR.noseTip)
    }
  })

  it('clears the driver and the airbox', () => {
    // The helmet is a sphere centred at y 0.72 with a crown near 0.86, and the
    // roll hoop tops out at 0.92. A camera below either is inside the car.
    expect(posed('cockpit', pose()).eye.y).toBeGreaterThan(0.88)
    expect(posed('tcam', pose()).eye.y).toBeGreaterThan(0.95)
  })

  it('sits the T-cam behind the driver and the halo cam ahead of them', () => {
    expect(posed('tcam', pose()).eye.z).toBeLessThan(0)
    expect(posed('cockpit', pose()).eye.z).toBeGreaterThan(0)
  })
})

describe('leaning with the body', () => {
  it('tilts the onboard horizon with roll', () => {
    const level = posed('cockpit', pose()).up
    const leaning = posed('cockpit', pose({ roll: 0.3 })).up
    expect(level.x).toBeCloseTo(0)
    // Rolling the body must move the up vector off vertical, or the shot is a
    // camera on rails no matter what the car is doing.
    expect(Math.abs(leaning.x)).toBeGreaterThan(0.2)
    expect(leaning.length()).toBeCloseTo(1)
  })

  it('keeps the chase horizon level however the car leans', () => {
    const { up, eye } = posed('chase', pose({ roll: 0.3, pitch: 0.2 }))
    expect(up.x).toBeCloseTo(0)
    expect(up.y).toBeCloseTo(1)
    // And the rig itself ignores the lean: a helicopter does not pitch with the
    // car it is filming.
    expect(eye.y).toBeCloseTo(cameraSetup.height)
  })

  it('aims the onboards into the road when the car dives', () => {
    // The sign check that matters. `bodyAttitude` makes positive pitch nose-
    // *down* — braking — and the onboard shot must then look further into the
    // road, not further up it. Reading the sign the other way inverts every
    // braking event, which is the most-watched moment on the whole lap.
    const aim = (pitch: number): number => {
      const { eye, look } = posed('tcam', pose({ pitch }))
      return look.clone().sub(eye).normalize().y
    }
    expect(aim(0.2)).toBeLessThan(aim(0))
    expect(aim(-0.2)).toBeGreaterThan(aim(0))
  })

  it('pitches the onboards about the same point as the bodywork', () => {
    // `renderer.draw` leans the body group, which sits at the car's origin on
    // the road — so the cameras must rotate about that origin too. Anything
    // else and the shot drifts out of the car exactly when the car is doing
    // something worth watching.
    const rig = rigFor('cockpit')
    const eye = posed('cockpit', pose({ pitch: 0.25 })).eye
    const expected = new THREE.Vector3(...rig.eye).applyAxisAngle(
      new THREE.Vector3(1, 0, 0),
      0.25,
    )
    expect(eye.distanceTo(expected)).toBeCloseTo(0)
  })
})

describe('field of view', () => {
  it('widens with speed and stops widening', () => {
    const rig = rigFor('chase')
    expect(fovFor(rig, 0)).toBeCloseTo(rig.baseFov)
    expect(fovFor(rig, rig.fovSpeed)).toBeCloseTo(rig.baseFov + rig.fovGain)
    // Monza's main straight is well past `fovSpeed`, and an unclamped gain there
    // would be a fisheye.
    expect(fovFor(rig, 500)).toBeCloseTo(rig.baseFov + rig.fovGain)
    expect(fovFor(rig, -10)).toBeCloseTo(rig.baseFov)
  })

  it('gives the onboard cameras the lenses they really have', () => {
    // Onboard wide, T-cam long. Swapping them is the single fastest way to make
    // footage stop looking like F1.
    expect(rigFor('cockpit').baseFov).toBeGreaterThan(rigFor('chase').baseFov)
    expect(rigFor('tcam').baseFov).toBeLessThan(rigFor('chase').baseFov)
  })
})

describe('shake', () => {
  it('maps surface grip onto roughness', () => {
    expect(roughness(1)).toBe(0) // asphalt
    expect(roughness(0.85)).toBeCloseTo(0.25) // kerb
    expect(roughness(0.45)).toBeGreaterThan(0.9) // grass
    expect(roughness(0.38)).toBe(1) // gravel, and no further
  })

  it('needs speed as well as a rough surface', () => {
    const rig = rigFor('cockpit')
    // Parked in the gravel is not a bumpy ride.
    expect(shakeAmount(rig, 0, 0.38)).toBe(0)
    expect(shakeAmount(rig, 60, 0.38)).toBeGreaterThan(shakeAmount(rig, 60, 1))
  })

  it('leaves a little buzz on clean asphalt at speed', () => {
    const amount = shakeAmount(rigFor('cockpit'), 80, 1)
    expect(amount).toBeGreaterThan(0)
    expect(amount).toBeLessThan(shake.amplitude * 0.2)
  })

  it('shakes the chase camera less than the onboards', () => {
    expect(shakeAmount(rigFor('chase'), 80, 0.85)).toBeLessThan(
      shakeAmount(rigFor('tcam'), 80, 0.85),
    )
  })

  it('shakes on impact even with the car stopped dead', () => {
    const rig = rigFor('cockpit')
    // The surface term is speed-scaled and would be zero here. A barrier that
    // takes all your speed away must not also take the shake away with it —
    // that is the frame where the picture most needs to move.
    expect(shakeAmount(rig, 0, 1, 20)).toBeGreaterThan(shakeAmount(rig, 80, 1))
  })

  it('shakes harder the harder the hit, up to a ceiling', () => {
    const rig = rigFor('tcam')
    expect(shakeAmount(rig, 40, 1, 12)).toBeGreaterThan(shakeAmount(rig, 40, 1, 4))
    // Past a point more shake is just an unreadable screen, so a 40m/s hit and
    // an 80m/s one look the same. Both are over.
    expect(shakeAmount(rig, 40, 1, 80)).toBeCloseTo(shakeAmount(rig, 40, 1, 40))
  })

  it('treats no impact as no impact', () => {
    const rig = rigFor('chase')
    expect(shakeAmount(rig, 50, 0.85, 0)).toBe(shakeAmount(rig, 50, 0.85))
    // Decay can only approach zero from above, but a negative must not subtract
    // from the surface buzz if one ever arrives.
    expect(shakeAmount(rig, 50, 0.85, -5)).toBe(shakeAmount(rig, 50, 0.85))
  })

  it('stays inside its stated amplitude', () => {
    // The offset is a sum of sines whose coefficients must not add up to more
    // than one, or "5cm of shake" is 5cm on paper and more on screen.
    const out = new THREE.Vector3()
    let peak = 0
    for (let t = 0; t < 20; t += 0.001) {
      shakeOffset(0.05, t, out)
      peak = Math.max(peak, Math.abs(out.x), Math.abs(out.y))
    }
    expect(peak).toBeLessThanOrEqual(0.05)
    // ...and it should actually reach most of it, or the number is a fiction.
    expect(peak).toBeGreaterThan(0.04)
  })

  it('is continuous, so it reads as vibration rather than tearing', () => {
    // Per-frame randomness is white noise, which at 60Hz looks like the image
    // is breaking up. Consecutive frames must be close together.
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    for (let t = 0; t < 5; t += 1 / 60) {
      shakeOffset(0.05, t, a)
      shakeOffset(0.05, t + 1 / 60, b)
      expect(a.distanceTo(b)).toBeLessThan(0.05)
    }
  })

  it('never moves the camera along its own axis', () => {
    // Shake is applied to the eye and the look-at together; a z component would
    // dolly the shot in and out instead of vibrating it.
    const out = new THREE.Vector3()
    shakeOffset(0.05, 1.234, out)
    expect(out.z).toBe(0)
  })
})
