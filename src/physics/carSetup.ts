/**
 * Every tuning number for the car, in one mutable object.
 *
 * Mutable on purpose: the lil-gui panel (`ui/tuningPanel.ts`) binds directly to
 * these fields, so a slider drag changes the car on the very next physics step.
 * Nothing here is cached or precomputed downstream — derived quantities like the
 * CG-to-axle distances are recomputed every step from these numbers, which costs
 * a few multiplies and buys live tuning. That trade is the whole point: PLAN.md
 * budgets 6-8 hours of tuning passes, and a reload per change would eat them.
 *
 * This module is a dependency leaf — it imports nothing, so any module may import
 * it without creating a cycle or dragging physics into the renderer.
 */

export const GRAVITY = 9.81

export interface TorqueCurvePoint {
  /** Engine speed, rpm. */
  rpm: number
  /** Crank torque at that speed, Nm. */
  torque: number
}

export interface TyreSetup {
  /**
   * Pacejka-style shape parameters. These describe the *shape* of the curve —
   * rise, peak, fall-off — normalised so the peak is 1.0. Actual force is this
   * coefficient times the axle's available grip.
   */
  stiffness: number
  shape: number
  curvature: number
  /** Peak friction coefficient, multiplied by vertical load. Front. */
  peakGripFront: number
  /** Peak friction coefficient, multiplied by vertical load. Rear. */
  peakGripRear: number
  /** Rear grip multiplier while the handbrake is pulled. */
  handbrakeGrip: number

  /**
   * How much the friction coefficient falls as a tyre is loaded up.
   *
   *   mu = peakGrip * (1 - loadSensitivity * (Fz / nominalLoad - 1))
   *
   * Real tyres are sub-linear in load: doubling the vertical load on a tyre
   * gives less than double the grip. That single fact is what makes lateral
   * weight transfer *cost* an axle grip rather than merely rearrange it, and
   * therefore what makes anti-roll bars, roll centres, and a lifted inside wheel
   * mean anything at all.
   *
   * At 0 the four-wheel load model is invisible and the car behaves exactly like
   * the per-axle bicycle model — which is how the migration was verified. Real
   * slicks are around 0.15-0.30.
   */
  loadSensitivity: number
  /** Load, N, at which mu is exactly `peakGrip`. Set near the static corner load. */
  nominalLoad: number
}

/**
 * Springs, bars, and the geometry that decides how load moves side to side.
 *
 * The single most useful thing in here is the *ratio* of the two anti-roll bar
 * rates. It decides how the car's lateral load transfer is split between the
 * axles, and because tyre grip is sub-linear in load (`TyreSetup.loadSensitivity`),
 * the axle taking more of the transfer loses more total grip. That is the
 * mechanism behind the oldest setup lever in motorsport: stiffen the front bar
 * to add understeer, stiffen the rear to add oversteer. Nothing scripts it.
 *
 * Rates are wheel rates, already through the motion ratio — modelling rockers
 * and pushrods would be a lot of trigonometry to arrive back at one number.
 */
export interface SuspensionSetup {
  /** Wheel rate, N/m. F1 is very stiff: ~200 N/mm. */
  springRateFront: number
  springRateRear: number
  /**
   * Anti-roll bar rates, Nm/rad, added to the roll stiffness each axle gets
   * from its springs.
   */
  antiRollFront: number
  antiRollRear: number
  /**
   * Roll centre heights, m. The lateral force reacts partly through the
   * suspension links at this height (instantly, causing no roll) and partly
   * through the springs above it (causing roll). Low roll centres are why F1
   * cars transfer load smoothly rather than jacking up on their outside wheels.
   */
  rollCentreFront: number
  rollCentreRear: number
  /** Track widths, m — the lever arm lateral transfer acts over. */
  trackFront: number
  trackRear: number
}

export interface CarSetup {
  chassis: {
    /** kg */
    mass: number
    /** Yaw moment of inertia, kg m^2. Lower = the car rotates more eagerly. */
    yawInertia: number
    /** Front axle to rear axle, m. */
    wheelbase: number
    /** Fraction of static weight on the front axle. */
    frontWeightBias: number
    /** Centre of gravity height, m. Drives how much load transfers. */
    cgHeight: number
    /** m */
    wheelRadius: number
    /** Rolling resistance coefficient, applied to total vertical load. */
    rollingResistance: number
    /**
     * Artificial yaw damping, Nm per rad/s. Not physical — it stands in for the
     * stabilising effects a 2D model has no room for (suspension geometry, tyre
     * relaxation length). Raise it if the car feels nervous rather than slidey.
     */
    yawDamping: number
    /**
     * Below this forward speed (m/s) the slip-angle maths goes singular, so we
     * soften the denominator and bleed off lateral velocity instead.
     */
    lowSpeedThreshold: number
    /** Rate, 1/s, at which lateral velocity and yaw bleed off below that speed. */
    lowSpeedDamping: number
  }

  engine: {
    idleRpm: number
    limiterRpm: number
    /** Interpolated linearly between points; extended flat beyond the ends. */
    torqueCurve: TorqueCurvePoint[]
    /** Crank torque resisting rotation off-throttle, Nm. */
    engineBraking: number
  }

  gearbox: {
    /** 8 forward ratios, first to eighth. */
    ratios: number[]
    finalDrive: number
    /** Fraction of crank torque reaching the wheels. */
    efficiency: number
    upshiftRpm: number
    downshiftRpm: number
    /** Torque-cut duration per shift, seconds. */
    shiftTime: number
    /**
     * A downshift is refused if it would land above this fraction of the
     * limiter. Without it the box grabs a lower gear under braking and bounces
     * off the rev limiter, which both sounds and feels wrong.
     */
    downshiftSafety: number
  }

  brakes: {
    /** Total force at full pedal, N, before the grip limit applies. */
    maxForce: number
    /** Fraction of brake force at the front axle. */
    biasFront: number
    /** Extra rear force from the handbrake, N. */
    handbrakeForce: number
    /** Force applied when reversing off the brake pedal at a standstill, N. */
    reverseForce: number
  }

  suspension: SuspensionSetup

  tyres: TyreSetup

  aero: {
    /** Downforce = coefficient * speed^2, N. */
    downforce: number
    /** Fraction of downforce over the front axle. */
    balanceFront: number
    /** Drag = coefficient * speed^2, N. */
    drag: number
  }

  steering: {
    /** Steering angle at full lock and low speed, radians. */
    maxAngle: number
    /**
     * Lock is scaled toward this fraction as speed rises to `falloffSpeed`.
     * This is what stops full lock at 300kph from spinning the car instantly.
     */
    highSpeedFactor: number
    /** Speed, m/s, at which the high-speed factor is fully applied. */
    falloffSpeed: number
  }
}

/**
 * Baseline setup. Broadly F1-shaped: ~740kg, ~640hp, heavy downforce.
 *
 * These are a starting point for tuning, not a target — the numbers that matter
 * are the ones that make the car fun, and those are found by driving.
 */
export const carSetup: CarSetup = {
  chassis: {
    mass: 740,
    yawInertia: 900,
    wheelbase: 3.6,
    frontWeightBias: 0.45,
    cgHeight: 0.3,
    wheelRadius: 0.33,
    rollingResistance: 0.015,
    yawDamping: 900,
    lowSpeedThreshold: 3,
    lowSpeedDamping: 6,
  },

  engine: {
    idleRpm: 3000,
    limiterRpm: 15000,
    torqueCurve: [
      { rpm: 3000, torque: 220 },
      { rpm: 6000, torque: 320 },
      { rpm: 9000, torque: 380 },
      { rpm: 11500, torque: 400 },
      { rpm: 13000, torque: 385 },
      { rpm: 15000, torque: 310 },
    ],
    engineBraking: 45,
  },

  gearbox: {
    ratios: [3.2, 2.55, 2.1, 1.78, 1.53, 1.33, 1.16, 1.0],
    finalDrive: 6.3,
    efficiency: 0.92,
    upshiftRpm: 14200,
    downshiftRpm: 9000,
    shiftTime: 0.05,
    downshiftSafety: 0.95,
  },

  brakes: {
    maxForce: 24000,
    biasFront: 0.62,
    handbrakeForce: 9000,
    reverseForce: 3000,
  },

  suspension: {
    springRateFront: 200000,
    springRateRear: 180000,
    // Roughly a third of the roll stiffness the springs already provide. Their
    // ratio starts near the static weight split so the car is balanced before
    // anyone touches it.
    antiRollFront: 90000,
    antiRollRear: 78000,
    rollCentreFront: 0.035,
    rollCentreRear: 0.055,
    trackFront: 1.62,
    trackRear: 1.58,
  },

  tyres: {
    // Peaks at ~9 degrees of slip and holds ~87% of peak grip at 3x that, which
    // is the "slidey but catchable" window the whole design rests on. Raising
    // `curvature` pushes the peak much further out and makes the car feel numb;
    // it is more sensitive than it looks.
    stiffness: 11,
    shape: 1.6,
    curvature: 0.4,
    // Raised 8% from the values the per-axle model was tuned with. Load
    // sensitivity costs the car grip everywhere it matters — cornering loads are
    // well above `nominalLoad` once downforce arrives — so peak grip was
    // re-solved to put the car back on its measured envelope rather than
    // accepting a slower one. That calibration is why the regression bands did
    // not have to move.
    peakGripFront: 1.674,
    peakGripRear: 1.75,
    handbrakeGrip: 0.45,
    /**
     * Conservative on purpose. Real slicks sit nearer 0.15-0.30, but the rest of
     * the model is not yet ready to absorb that: with per-axle tyre forces and
     * instant load transfer, a strong value makes the car snap at the limit
     * rather than slide. Raise it as per-wheel slip and suspension lag land.
     */
    loadSensitivity: 0.08,
    // Static load on one corner, ~1815N, rounded — so `peakGrip` keeps its plain
    // meaning of "grip at rest", and load sensitivity only takes grip away as
    // downforce and weight transfer pile on.
    nominalLoad: 1800,
  },

  aero: {
    downforce: 1.6,
    balanceFront: 0.45,
    drag: 1.0,
  },

  steering: {
    maxAngle: 0.42,
    highSpeedFactor: 0.35,
    falloffSpeed: 70,
  },
}
