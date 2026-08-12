/**
 * Where the cameras are, and how they move.
 *
 * A broadcast has three shots of a car and they say different things. The chase
 * is the one you drive from: it lags, and the lag is what tells you how fast you
 * are going (PLAN.md flags a rigid chase camera as an M1 trap — it reads as *no
 * speed* and gets misdiagnosed as bad physics). The T-cam on the roll hoop is
 * bolted to the car, so the world pitches and rolls around it and you can see the
 * kerbs arrive. The halo cam sits at the driver's eyeline behind the front hoop,
 * where the steering and the front wheels do the talking.
 *
 * The two onboard rigs ride the body's pitch and roll; the chase deliberately
 * does not. That is the whole difference between a camera on the car and a camera
 * following it, and getting it backwards makes the chase seasick and the onboards
 * inert.
 *
 * Everything here is pure: rigs in, world-space eye and look-at out. The one
 * piece of state a camera needs — the chase spring's current position — lives in
 * the renderer, because it is the renderer that owns a frame clock.
 */

import * as THREE from 'three'
import { cameraSetup, type CameraSetup } from './cameraSetup'

export type CameraView = 'chase' | 'tcam' | 'cockpit'

export interface CameraRig {
  view: CameraView
  /** Shown in the telemetry overlay, so you know which key did what. */
  label: string
  /** Camera position in car-local metres: +x right, +y up, +z forward. */
  eye: readonly [number, number, number]
  /** Look-at point, same frame. Well ahead, so the shot leads the car. */
  look: readonly [number, number, number]
  /**
   * Position spring in 1/s, or null for a camera bolted to the bodywork.
   *
   * A spring only makes sense for a rig that is not attached to the car. Give
   * one to an onboard camera and it slides around inside the tub.
   */
  stiffness: number | null
  /** Does the rig ride the body's pitch and roll, or only its heading? */
  sprung: boolean
  /** FOV at a standstill, degrees. */
  baseFov: number
  /** Degrees added at `fovSpeed`. */
  fovGain: number
  /** Speed, m/s, at which the full FOV gain is applied. */
  fovSpeed: number
  /**
   * Shake multiplier.
   *
   * Onboard cameras are bolted to a car with no suspension travel worth
   * speaking of, so they get all of it. The chase camera is notionally a
   * helicopter or a trackside operator and gets a fraction, or the whole frame
   * buzzes for no reason the viewer can see.
   */
  shake: number
}

/**
 * The chase rig, expressed as offsets so it shares the maths below.
 *
 * Its numbers still live in `cameraSetup.ts` because the tuning panel edits them
 * live and STACK.md wants one file per tuning surface. The onboard rigs are not
 * tunable: their positions are where the cameras physically are on a 2026 car,
 * and a slider that moves the roll-hoop camera off the roll hoop is a slider
 * that only makes the shot wrong.
 */
function chaseRig(setup: CameraSetup): CameraRig {
  return {
    view: 'chase',
    label: 'chase',
    eye: [0, setup.height, -setup.distance],
    look: [0, 0.8, setup.lookAhead],
    stiffness: setup.stiffness,
    sprung: false,
    baseFov: setup.baseFov,
    fovGain: setup.fovGain,
    fovSpeed: setup.fovSpeed,
    shake: 0.35,
  }
}

/**
 * Above the airbox, behind the driver's head — the shot every race is directed
 * from. The roll hoop tops out at y 0.92 and the airbox intake sits just behind
 * it, so 1.15 clears both without floating.
 */
const T_CAM: CameraRig = {
  view: 'tcam',
  label: 'T-cam',
  eye: [0, 1.15, -0.62],
  look: [0, 0.45, 14],
  stiffness: null,
  sprung: true,
  // Narrower than the chase: a long lens is what makes the trackside furniture
  // appear to arrive rather than pass, and this camera has furniture to arrive.
  baseFov: 55,
  fovGain: 12,
  fovSpeed: 80,
  shake: 1,
}

/**
 * The halo cam, at the driver's eyeline.
 *
 * Deliberately just above and ahead of the helmet (which is a sphere centred at
 * y 0.72, so its crown is about y 0.86) rather than inside it. A camera at the
 * visor sees the inside of the driver's own head, and the fix is not to delete
 * the helmet — it is to put the camera where the broadcast one actually is,
 * looking out through the front hoop.
 */
const COCKPIT: CameraRig = {
  view: 'cockpit',
  label: 'cockpit',
  eye: [0, 0.95, 0.24],
  look: [0, 0.62, 14],
  stiffness: null,
  sprung: true,
  // Wide, because an onboard lens is wide: it is what makes a barrier a metre
  // from the sidepod feel a metre away.
  baseFov: 72,
  fovGain: 8,
  fovSpeed: 80,
  shake: 1,
}

/** Cycle order. Chase first, because that is the one you can drive from cold. */
export const CAMERA_VIEWS: readonly CameraView[] = ['chase', 'tcam', 'cockpit']

export function rigFor(view: CameraView, setup: CameraSetup = cameraSetup): CameraRig {
  switch (view) {
    case 'chase':
      // Rebuilt each call so the tuning panel's edits to `cameraSetup` take
      // effect on the next frame rather than at the next reload.
      return chaseRig(setup)
    case 'tcam':
      return T_CAM
    case 'cockpit':
      return COCKPIT
  }
}

export function nextView(view: CameraView): CameraView {
  const index = CAMERA_VIEWS.indexOf(view)
  return CAMERA_VIEWS[(index + 1) % CAMERA_VIEWS.length] ?? 'chase'
}

/** The car's pose as the renderer has interpolated it for this frame. */
export interface CarPose {
  x: number
  z: number
  /** Radians; 0 faces +z. */
  heading: number
  /**
   * Body pitch, radians.
   *
   * Positive is nose-*down*, matching `carMotion.bodyAttitude` and the scene
   * graph: a positive rotation about +x carries +z toward -y. Braking produces
   * positive pitch.
   */
  pitch: number
  /** Body roll, radians. */
  roll: number
}

const scratchEuler = new THREE.Euler()
const scratchQuaternion = new THREE.Quaternion()

/**
 * The rig's world rotation.
 *
 * Reuses one quaternion: this runs every frame, and a fresh allocation at 60Hz
 * is exactly the GC pressure `World` is kept mutable to avoid.
 */
function orientation(rig: CameraRig, pose: CarPose): THREE.Quaternion {
  scratchEuler.set(rig.sprung ? pose.pitch : 0, pose.heading, rig.sprung ? pose.roll : 0, 'YXZ')
  return scratchQuaternion.setFromEuler(scratchEuler)
}

/**
 * Car-local offsets to world space.
 *
 * The rotation order is YXZ so it composes exactly as the scene graph does: the
 * renderer turns the car group by `heading` about y and then leans the body by
 * pitch and roll inside it. Any other order puts the onboard cameras somewhere
 * the car is not, and it only shows up when you are leaning and turning at once
 * — which is most of a lap.
 */
export function cameraPose(
  rig: CameraRig,
  pose: CarPose,
  eye: THREE.Vector3,
  look: THREE.Vector3,
): void {
  const rotation = orientation(rig, pose)

  eye.set(rig.eye[0], rig.eye[1], rig.eye[2]).applyQuaternion(rotation)
  eye.x += pose.x
  eye.z += pose.z

  look.set(rig.look[0], rig.look[1], rig.look[2]).applyQuaternion(rotation)
  look.x += pose.x
  look.z += pose.z
}

/**
 * Which way is up for this rig.
 *
 * World up for the chase — a helicopter does not lean with the car, and if it
 * did the horizon would swing every corner and the shot would be unwatchable.
 * Body up for the onboards, because they are bolted to bodywork that leans: the
 * horizon tilting under braking and through a fast corner is most of what makes
 * an onboard shot feel like a car rather than a camera on rails.
 */
export function cameraUp(rig: CameraRig, pose: CarPose, out: THREE.Vector3): void {
  out.set(0, 1, 0)
  if (rig.sprung) out.applyQuaternion(orientation(rig, pose))
}

/** Degrees. Widens with speed — cheap, and it sells pace better than geometry. */
export function fovFor(rig: CameraRig, speed: number): number {
  return rig.baseFov + rig.fovGain * Math.min(Math.max(speed, 0) / rig.fovSpeed, 1)
}

export const shake = {
  /** Metres of camera travel at full roughness, full speed, on an onboard rig. */
  amplitude: 0.05,
  /** Speed, m/s, at which shake reaches full scale. */
  speed: 70,
  /**
   * How much shake a perfectly smooth surface still gets, as a fraction.
   *
   * Not zero: a car doing 300kph on billiard-table asphalt is still moving in
   * the frame, and a dead-still onboard shot at that speed looks like a render,
   * not a lap.
   */
  floor: 0.08,
  /** Grip loss, below dry asphalt's 1.0, that counts as maximally rough. */
  gripSpan: 0.6,
  /**
   * Metres of camera travel per m/s of impact.
   *
   * Separate from the surface term and not scaled by speed: a barrier hit at
   * 30kph in the pit lane still throws the camera, and a car that has just been
   * stopped dead by a wall has no speed left to scale by at the moment it most
   * needs to look violent.
   */
  impactGain: 0.008,
  /** Ceiling on the impact term, m. Past a certain point it is just unreadable. */
  impactMax: 0.18,
} as const

/**
 * How rough what you are driving on is, 0..1.
 *
 * Derived from the grip multiplier the physics is already using rather than from
 * the surface name, because `render/` reads `World` and `World` carries the
 * reduced contact, not the circuit (see `core/world.ts` on why the track is not
 * on `World`). It lands where you would want it to anyway: kerb 0.25, concrete
 * 0.13, grass 0.92, gravel 1.
 *
 * This is the kerb half of what CLAUDE.md asks for; `shakeAmount` adds the
 * impact half from `Car.impact`.
 */
export function roughness(grip: number): number {
  return Math.min(Math.max((1 - grip) / shake.gripSpan, 0), 1)
}

/**
 * Metres of shake to apply this frame.
 *
 * Two terms that add rather than blend. The surface term is a continuous buzz
 * that needs speed to exist; the impact term is a decaying jolt that does not,
 * and the moment a barrier has taken all your speed away is exactly when the
 * camera must not go still.
 *
 * `impact` is the decaying closing speed of the last hit, in m/s — `physics/`
 * owns the decay, so this stays a pure function of the state it is handed.
 */
export function shakeAmount(rig: CameraRig, speed: number, grip: number, impact = 0): number {
  const rough = shake.floor + (1 - shake.floor) * roughness(grip)
  const pace = Math.min(Math.max(speed, 0) / shake.speed, 1)
  const hit = Math.min(Math.max(impact, 0) * shake.impactGain, shake.impactMax)
  return rig.shake * (shake.amplitude * rough * pace + hit)
}

/**
 * A deterministic wobble.
 *
 * Sines at frequencies with no common factor rather than `Math.random`: random
 * per-frame offsets are white noise, which at 60Hz reads as the image tearing
 * rather than the car vibrating. Two per axis, at different rates, gives
 * something that never visibly repeats over a lap.
 *
 * The rates are capped around 6-8Hz, which is a deliberate compromise. Real
 * onboard vibration runs higher, but anything approaching half the frame rate
 * aliases — and the frame rate is not a constant. At 60fps a 14Hz wobble is
 * fine; on the machine that drops to 30 it turns into the strobing this
 * function exists to avoid. Slower and always continuous beats accurate and
 * sometimes broken.
 */
export function shakeOffset(amount: number, time: number, out: THREE.Vector3): void {
  out.set(
    (Math.sin(time * 37.7) * 0.6 + Math.sin(time * 14.3) * 0.4) * amount,
    (Math.sin(time * 29.9) * 0.5 + Math.sin(time * 48.7) * 0.3) * amount,
    0,
  )
}
