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
    /** Keyboard steer ramp toward full lock at a standstill, units/s. */
    rate: number
    /** Keyboard steer ramp at `falloffSpeed` — deliberately slower. */
    rateAtSpeed: number
    /** Ramp back to centre, units/s. Faster than the ramp out, so catching a slide works. */
    returnRate: number
    /** Keyboard throttle/brake ramp, units/s. */
    pedalRate: number
    /** Gamepad stick deadzone. */
    deadzone: number
  }

  camera: {
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
    /** Degrees added at `fovSpeed`. */
    fovGain: number
    /** Speed, m/s, at which the full FOV gain is applied. */
    fovSpeed: number
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

  tyres: {
    // Peaks at ~9 degrees of slip and holds ~87% of peak grip at 3x that, which
    // is the "slidey but catchable" window the whole design rests on. Raising
    // `curvature` pushes the peak much further out and makes the car feel numb;
    // it is more sensitive than it looks.
    stiffness: 11,
    shape: 1.6,
    curvature: 0.4,
    peakGripFront: 1.55,
    peakGripRear: 1.62,
    handbrakeGrip: 0.45,
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
    rate: 3.4,
    rateAtSpeed: 1.3,
    returnRate: 5.5,
    pedalRate: 6,
    deadzone: 0.12,
  },

  camera: {
    distance: 9.5,
    height: 3.6,
    lookAhead: 8,
    stiffness: 6,
    baseFov: 62,
    fovGain: 16,
    fovSpeed: 80,
  },
}
