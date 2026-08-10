/**
 * Input sampling: keyboard and gamepad -> a normalised `InputState`.
 *
 * `ai/` produces the same struct, so `physics/` never knows which drove a car.
 * That symmetry is what makes ghost laps and headless AI tests free (ARCHITECTURE.md).
 *
 * The interesting part is making a keyboard feel analogue. A key is on or off,
 * but a steering wheel is not, so held keys ramp toward full lock at a rate that
 * *drops as speed rises*. At 40kph you get lock almost instantly; at 300kph the
 * same key press feeds in over most of a second. Without that, high-speed
 * corrections are all-or-nothing and every slide ends in a spin — the car gets
 * blamed for what is really an input problem.
 *
 * Returning to centre uses a separate, faster rate. Catching a slide means
 * unwinding lock quickly, and a symmetric ramp makes that impossible.
 *
 * A gamepad stick is already analogue, so it maps straight through; the
 * speed-sensitive steering *lock* in `physics/car.ts` does the equivalent job
 * there. Rate-limiting a stick on top of that just adds lag.
 */

import { inputFeel, type InputFeel } from '../core/feel'
import { createInputState, type InputState } from '../core/world'

export interface InputSampler {
  /**
   * Current driver intent. Mutated in place; do not retain the reference.
   *
   * @param dtSeconds Fixed physics timestep, so ramps are framerate-independent.
   * @param speed Car speed in m/s — steering rate falls off as this rises.
   */
  sample: (dtSeconds: number, speed: number) => InputState
  /** True if a gamepad supplied this frame's input. For the debug overlay. */
  readonly usingGamepad: boolean
  dispose: () => void
}

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  handbrake: ['Space'],
} as const

/** Standard Gamepad mapping. */
const PAD = { steerAxis: 0, brakeButton: 6, throttleButton: 7, handbrakeButton: 0 } as const

const clampUnit = (value: number): number => (value < -1 ? -1 : value > 1 ? 1 : value)

const moveToward = (current: number, target: number, maxStep: number): number => {
  const delta = target - current
  if (Math.abs(delta) <= maxStep) return target
  return current + Math.sign(delta) * maxStep
}

const applyDeadzone = (value: number, deadzone: number): number => {
  if (Math.abs(value) < deadzone) return 0
  // Rescale so the stick still reaches full travel past the deadzone, rather
  // than topping out at 1 - deadzone.
  return Math.sign(value) * ((Math.abs(value) - deadzone) / (1 - deadzone))
}

export function createInputSampler(
  target: Window = window,
  feel: InputFeel = inputFeel,
): InputSampler {
  const held = new Set<string>()
  const state = createInputState()
  let usingGamepad = false

  const onDown = (e: KeyboardEvent): void => {
    held.add(e.code)
    // Stop Space and the arrows from scrolling the page mid-corner.
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
  }
  const onUp = (e: KeyboardEvent): void => {
    held.delete(e.code)
  }
  // Keys held when focus is lost never fire keyup, which would stick the throttle on.
  const onBlur = (): void => held.clear()

  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)

  const anyHeld = (codes: readonly string[]): boolean => codes.some((code) => held.has(code))

  const readPad = (): Gamepad | null => {
    const pads = target.navigator?.getGamepads?.() ?? []
    for (const pad of pads) {
      if (pad?.connected) return pad
    }
    return null
  }

  return {
    sample(dtSeconds, speed) {
      const pad = readPad()

      let padSteer = 0
      let padThrottle = 0
      let padBrake = 0
      let padHandbrake = false

      if (pad) {
        padSteer = applyDeadzone(pad.axes[PAD.steerAxis] ?? 0, feel.deadzone)
        padThrottle = pad.buttons[PAD.throttleButton]?.value ?? 0
        padBrake = pad.buttons[PAD.brakeButton]?.value ?? 0
        padHandbrake = pad.buttons[PAD.handbrakeButton]?.pressed ?? false
      }

      // Whichever device the driver actually touched this frame wins, so a
      // connected-but-idle pad doesn't lock out the keyboard.
      usingGamepad =
        padSteer !== 0 || padThrottle > 0.02 || padBrake > 0.02 || padHandbrake

      if (usingGamepad) {
        state.steer = clampUnit(padSteer)
        state.throttle = clampUnit(padThrottle)
        state.brake = clampUnit(padBrake)
        state.handbrake = padHandbrake
        return state
      }

      const targetSteer = (anyHeld(KEYS.right) ? 1 : 0) - (anyHeld(KEYS.left) ? 1 : 0)

      const speedFactor = Math.min(speed / feel.fullRateSpeed, 1)
      const outRate = feel.rate + (feel.rateAtSpeed - feel.rate) * speedFactor
      // Unwinding — including steering through centre to opposite lock — always
      // uses the fast rate.
      const unwinding = targetSteer === 0 || Math.sign(targetSteer) !== Math.sign(state.steer)
      const rate = unwinding ? feel.returnRate : outRate
      state.steer = moveToward(state.steer, targetSteer, rate * dtSeconds)

      const pedalStep = feel.pedalRate * dtSeconds
      state.throttle = moveToward(state.throttle, anyHeld(KEYS.throttle) ? 1 : 0, pedalStep)
      state.brake = moveToward(state.brake, anyHeld(KEYS.brake) ? 1 : 0, pedalStep)
      state.handbrake = anyHeld(KEYS.handbrake)

      return state
    },
    get usingGamepad() {
      return usingGamepad
    },
    dispose() {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}
