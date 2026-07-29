/**
 * Every tuning number lives here.
 *
 * One file, because tuning happens in passes: drive, notice the front end washes
 * out, change one number, drive again. Hunting constants across modules turns a
 * two-minute pass into a twenty-minute one — and PLAN.md budgets 6-8 hours of
 * these passes.
 */

/** Placeholder motion for M0. Deleted in M1 when the bicycle model lands. */
export const PLACEHOLDER = {
  /** m/s^2 */
  acceleration: 14,
  /** m/s^2 */
  braking: 26,
  /** Linear drag coefficient, 1/s. */
  drag: 0.35,
  /** m/s (~290 kph) */
  maxSpeed: 80,
  /** rad/s at full steering lock. */
  turnRate: 1.6,
  /** Speed in m/s at which full steering authority is available. */
  fullSteerSpeed: 12,
} as const

/** Real vehicle parameters, populated in M1. */
export const CAR = {
  /** kg */
  mass: 740,
  /** Distance front axle to rear axle, m. */
  wheelbase: 3.6,
  /** Fraction of mass over the front axle at rest. */
  frontWeightBias: 0.45,
} as const
