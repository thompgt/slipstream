/**
 * Engine torque curve and the 8-speed automatic gearbox.
 *
 * Kept separate from `car.ts` because gear selection is a small state machine
 * with genuinely awkward edge cases (bouncing between two gears, downshifting
 * into the limiter, shifting while the clutch is already out) and those are much
 * easier to pin down in a unit test than by driving.
 *
 * No clutch or drivetrain inertia is modelled. The car is always in gear; a shift
 * is a torque cut of `shiftTime` seconds. For an arcade-sim that reads as a crisp
 * paddle shift, and it costs nothing.
 */

import { clamp } from '../core/math'
import type { CarSetup } from './carSetup'

export interface GearboxState {
  /** 1-based. Never 0 or negative — reverse is handled in `car.ts` as a brake mode. */
  gear: number
  rpm: number
  /** Seconds of torque cut remaining. */
  shiftTimer: number
}

/** Total reduction from crank to wheel for a gear. */
export function totalRatio(gear: number, setup: CarSetup): number {
  const ratio = setup.gearbox.ratios[gear - 1]
  return (ratio ?? 1) * setup.gearbox.finalDrive
}

/**
 * Engine speed implied by road speed in a given gear.
 *
 * Clamped to idle..limiter, which is doing two jobs: it stops the engine
 * "stalling" at a standstill, and it's the rev limiter.
 */
export function engineRpm(forwardSpeed: number, gear: number, setup: CarSetup): number {
  const wheelRadPerSec = Math.abs(forwardSpeed) / setup.chassis.wheelRadius
  const crankRadPerSec = wheelRadPerSec * totalRatio(gear, setup)
  const rpm = (crankRadPerSec * 60) / (2 * Math.PI)
  return clamp(rpm, setup.engine.idleRpm, setup.engine.limiterRpm)
}

/** Crank torque, Nm, linearly interpolated between curve points and flat beyond the ends. */
export function engineTorque(rpm: number, setup: CarSetup): number {
  const curve = setup.engine.torqueCurve
  const first = curve[0]
  if (!first) return 0
  if (rpm <= first.rpm) return first.torque

  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]
    const next = curve[i]
    if (!prev || !next) break
    if (rpm <= next.rpm) {
      const span = next.rpm - prev.rpm
      const t = span === 0 ? 0 : (rpm - prev.rpm) / span
      return prev.torque + (next.torque - prev.torque) * t
    }
  }

  return curve[curve.length - 1]?.torque ?? 0
}

/**
 * Advance the gearbox one step, mutating `state`.
 *
 * At most one shift per step, and none at all while a shift is in progress —
 * that timer is what stops the box from walking up three gears in three frames
 * when the revs spike.
 */
export function updateGearbox(
  state: GearboxState,
  forwardSpeed: number,
  throttle: number,
  dtSeconds: number,
  setup: CarSetup,
): void {
  const { gearbox: gb, engine } = setup
  state.gear = clamp(Math.round(state.gear), 1, gb.ratios.length)

  if (state.shiftTimer > 0) {
    state.shiftTimer = Math.max(0, state.shiftTimer - dtSeconds)
  } else {
    const rpm = engineRpm(forwardSpeed, state.gear, setup)

    // Only upshift under power. Off-throttle the car should hold the gear and
    // use engine braking, which is what you want on corner entry.
    if (state.gear < gb.ratios.length && rpm >= gb.upshiftRpm && throttle > 0.1) {
      state.gear += 1
      state.shiftTimer = gb.shiftTime
    } else if (state.gear > 1 && rpm <= gb.downshiftRpm) {
      const afterDownshift = engineRpm(forwardSpeed, state.gear - 1, setup)
      if (afterDownshift < engine.limiterRpm * gb.downshiftSafety) {
        state.gear -= 1
        state.shiftTimer = gb.shiftTime
      }
    }
  }

  state.rpm = engineRpm(forwardSpeed, state.gear, setup)
}
