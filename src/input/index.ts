/**
 * Input sampling: keyboard and gamepad -> a normalised `InputState`.
 *
 * `ai/` produces the same struct, so `physics/` never knows which drove a car.
 * That symmetry is what makes ghost laps and headless AI tests free (ARCHITECTURE.md).
 *
 * M0 implements keyboard only, with no ramping. Analogue ramps on digital keys
 * and gamepad support land in M1, where the feel work happens.
 */

import { createInputState, type InputState } from '../core/world'

export interface InputSampler {
  /** Current driver intent. Mutated in place; do not retain the reference. */
  sample: () => InputState
  dispose: () => void
}

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  handbrake: ['Space'],
} as const

export function createInputSampler(target: Window = window): InputSampler {
  const held = new Set<string>()
  const state = createInputState()

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

  return {
    sample() {
      state.steer = (anyHeld(KEYS.right) ? 1 : 0) - (anyHeld(KEYS.left) ? 1 : 0)
      state.throttle = anyHeld(KEYS.throttle) ? 1 : 0
      state.brake = anyHeld(KEYS.brake) ? 1 : 0
      state.handbrake = anyHeld(KEYS.handbrake)
      return state
    },
    dispose() {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}
