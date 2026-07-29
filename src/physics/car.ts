/**
 * Vehicle physics.
 *
 * Pure functions over plain numbers — no Three.js, no DOM. That constraint is
 * what lets this run in Node under Vitest, and it is deliberate: importing a
 * rendering type here is a bug, not a shortcut.
 *
 * M0 is placeholder motion, just enough to prove input -> sim -> interpolated
 * render works end to end. The real 2D bicycle model (slip angles, tyre curve,
 * load transfer) replaces `stepCar` wholesale in M1 — see STACK.md for why this
 * is hand-rolled rather than a rigid-body engine.
 */

import { clamp } from '../core/math'
import type { Car } from '../core/world'
import { PLACEHOLDER } from './constants'

/**
 * Advance one car by exactly `dt` ms.
 *
 * `dt` is always FIXED_DT. Never scale behaviour by a variable frame delta —
 * integration of tyre slip is not linear in dt, so that would make the car feel
 * different on different machines.
 */
export function stepCar(car: Car, dt: number): void {
  // Snapshot the pose the renderer will interpolate from.
  car.previousPosition.x = car.position.x
  car.previousPosition.z = car.position.z
  car.previousHeading = car.heading

  const seconds = dt / 1000
  const { steer, throttle, brake } = car.input

  const speed = Math.hypot(car.velocity.x, car.velocity.z)

  const drive = throttle * PLACEHOLDER.acceleration - brake * PLACEHOLDER.braking
  const drag = -speed * PLACEHOLDER.drag
  const newSpeed = clamp(speed + (drive + drag) * seconds, 0, PLACEHOLDER.maxSpeed)

  // Steering authority falls off at a standstill so the car cannot pivot in place.
  const steerAuthority = Math.min(newSpeed / PLACEHOLDER.fullSteerSpeed, 1)
  car.yawRate = steer * PLACEHOLDER.turnRate * steerAuthority
  car.heading += car.yawRate * seconds

  car.velocity.x = Math.sin(car.heading) * newSpeed
  car.velocity.z = Math.cos(car.heading) * newSpeed

  car.position.x += car.velocity.x * seconds
  car.position.z += car.velocity.z * seconds
}
