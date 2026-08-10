/**
 * Input feel: how a digital key becomes an analogue control.
 *
 * This lives in `core/` rather than in `carSetup` because it is not a property
 * of the car. Two drivers on the same car want different ramp rates, and a
 * gamepad wants none of them at all — these numbers describe the *interface*, so
 * putting them in the vehicle setup made `input/` import `physics/`, which the
 * module table in ARCHITECTURE.md forbids for good reason.
 *
 * The speed-sensitive steering *lock* is a different thing and stays in
 * `carSetup.steering`: that one really is the car.
 */

export interface InputFeel {
  /** Keyboard steer ramp toward full lock at a standstill, units/s. */
  rate: number
  /** Keyboard steer ramp at `fullRateSpeed` — deliberately slower. */
  rateAtSpeed: number
  /**
   * Speed, m/s, at which `rateAtSpeed` fully applies.
   *
   * At 40kph a held key gives you lock almost instantly; at 300kph the same
   * press feeds in over most of a second. Without that, high-speed corrections
   * are all-or-nothing and every slide ends in a spin — which gets blamed on the
   * physics when it is really an input problem.
   */
  fullRateSpeed: number
  /**
   * Ramp back to centre, units/s. Faster than the ramp out on purpose: catching
   * a slide means unwinding lock quickly, and a symmetric ramp makes that
   * impossible.
   */
  returnRate: number
  /** Keyboard throttle/brake ramp, units/s. */
  pedalRate: number
  /** Gamepad stick deadzone, rescaled so the stick still reaches 1.0. */
  deadzone: number
}

export const inputFeel: InputFeel = {
  rate: 3.4,
  rateAtSpeed: 1.3,
  fullRateSpeed: 70,
  returnRate: 5.5,
  pedalRate: 6,
  deadzone: 0.12,
}
