/**
 * Chase camera tuning.
 *
 * Render-side, because the camera is not part of the simulation — nothing in
 * `physics/` can observe it, and it must stay that way or the sim would depend
 * on framerate. It lived in `carSetup` at first, which made `render/` import
 * `physics/` against the module table in ARCHITECTURE.md.
 *
 * The stiffness value is the one that matters. PLAN.md flags it as an M1 trap:
 * a camera rigidly attached to the car reads as *no speed*, and the problem gets
 * misdiagnosed as bad physics. The lag is the point.
 */

export interface CameraSetup {
  /** Metres behind the car. */
  distance: number
  /** Metres above the car. */
  height: number
  /** Look-at point, metres ahead of the car. */
  lookAhead: number
  /** Position spring, 1/s. Higher = stiffer. Too stiff reads as "no speed". */
  stiffness: number
  /** FOV at a standstill, degrees. */
  baseFov: number
  /** Degrees added at `fovSpeed`. Cheap, and it does more for the sensation of
   * pace than any amount of extra geometry. */
  fovGain: number
  /** Speed, m/s, at which the full FOV gain is applied. */
  fovSpeed: number
}

export const cameraSetup: CameraSetup = {
  distance: 9.5,
  height: 3.6,
  lookAhead: 8,
  stiffness: 6,
  baseFov: 62,
  fovGain: 16,
  fovSpeed: 80,
}
