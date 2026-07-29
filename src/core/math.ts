/** Small math helpers shared across simulation and rendering. No dependencies. */

/** A 2D point/vector on the ground plane. Physics is 2D; `y` is render-only. */
export interface Vec2 {
  x: number
  z: number
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value

/** Interpolate an angle in radians the short way around the circle. */
export function lerpAngle(a: number, b: number, t: number): number {
  const TAU = Math.PI * 2
  let delta = (b - a) % TAU
  if (delta > Math.PI) delta -= TAU
  if (delta < -Math.PI) delta += TAU
  return a + delta * t
}

export const vec2 = (x = 0, z = 0): Vec2 => ({ x, z })

export const length = (v: Vec2): number => Math.hypot(v.x, v.z)
