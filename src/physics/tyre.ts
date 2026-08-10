/**
 * The tyre model — the single most feel-defining function in the codebase.
 *
 * This is a normalised Pacejka "magic formula". It returns a *coefficient* in
 * roughly -1..1, not a force: multiply it by the axle's available grip (peak
 * friction x vertical load, less whatever the friction ellipse already spent on
 * braking or acceleration) to get newtons.
 *
 * The shape is what matters:
 *
 *   grip
 *    1.0 |        ,-~-.__
 *        |      ,'       `--.___
 *        |    ,'                 `----
 *        |  ,'
 *      0 |,'________________________________ slip angle
 *        0    peak
 *
 * Grip climbs steeply, peaks around 8-10 degrees of slip, then falls away
 * *gently*. That gentle fall-off is the entire "grippy but slidey" brief: past
 * the peak the car slides but still has most of its grip, so the slide is
 * catchable. A curve that dropped to near-zero past the peak would snap — the
 * car would go from planted to spinning with no window to react.
 *
 * Being a plain function of slip angle, rather than an emergent property of a
 * constraint solver, is the whole reason physics is hand-rolled here (STACK.md).
 */

import type { TyreSetup } from './carSetup'

/**
 * Lateral force coefficient for a given slip angle, in radians.
 *
 * Odd function: negative slip gives negative force. The caller negates it when
 * applying, so the tyre always pushes back toward alignment.
 */
export function tyreForce(slipAngle: number, tyre: TyreSetup): number {
  const { stiffness: b, shape: c, curvature: e } = tyre
  const bx = b * slipAngle
  return Math.sin(c * Math.atan(bx - e * (bx - Math.atan(bx))))
}

/**
 * Slip angle, in radians, at which the curve peaks.
 *
 * Telemetry uses it to show how far past the limit an axle is, and M4's AI will
 * need it to derive a speed profile from track curvature. Solved by Newton
 * iteration rather than a numeric sweep — at the peak the argument of the outer
 * sine is exactly pi/2, which gives an equation to invert.
 */
export function peakSlipAngle(tyre: TyreSetup): number {
  const { stiffness: b, shape: c, curvature: e } = tyre
  const target = Math.tan(Math.PI / (2 * c))

  let x = target / b
  for (let i = 0; i < 16; i++) {
    const bx = b * x
    const f = bx - e * (bx - Math.atan(bx)) - target
    const df = b * (1 - e + e / (1 + bx * bx))
    if (df === 0) break
    x -= f / df
  }
  return Math.abs(x)
}
