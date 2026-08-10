/**
 * Fixed-timestep game loop, decoupled from rendering.
 *
 * See ARCHITECTURE.md for the full rationale. In short: physics advances in
 * identical slices so the car behaves the same on every machine, while rendering
 * happens whenever the display is ready and interpolates between the two most
 * recent physics states.
 */

/** Simulation rate. Physics advances only in slices of exactly this length. */
export const FIXED_DT = 1000 / 60

/**
 * Longest frame delta we will honour, in ms.
 *
 * After a tab switch the real delta can be many seconds. Feeding that to the
 * accumulator would run hundreds of steps in one frame, freezing the page and
 * possibly spiralling. We clamp instead, which means the simulation silently
 * loses time — always the right trade against a frozen tab or a car through a wall.
 */
export const MAX_FRAME_DELTA = 250

export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` ms. Called 0..n times per frame. */
  step: (dt: number) => void
  /**
   * Draw the world. Called at most once per frame.
   * @param alpha 0..1 progress between the previous and current physics state.
   */
  render: (alpha: number) => void
  /** Optional per-frame stats hook, for the debug overlay. */
  onFrame?: (stats: FrameStats) => void
}

export interface FrameStats {
  /** Clamped frame delta in ms. */
  frameDelta: number
  /** Physics steps executed this frame (0 when the display outruns the sim). */
  steps: number
  /** Wall-clock ms spent inside `step` this frame. */
  stepMs: number
  /** Wall-clock ms spent inside `render` this frame. */
  renderMs: number
  /** Total simulated time in ms — the authoritative clock for lap times. */
  simTime: number
}

export interface Loop {
  start: () => void
  stop: () => void
  /** Accumulated simulation time in ms. Never read `performance.now()` for game timing. */
  readonly simTime: number
  readonly running: boolean
}

/** Injectable clock + scheduler so the loop is testable headlessly. */
export interface LoopEnvironment {
  now: () => number
  requestFrame: (cb: (time: number) => void) => number
  cancelFrame: (handle: number) => void
}

const browserEnvironment: LoopEnvironment = {
  now: () => performance.now(),
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
}

export function createLoop(
  callbacks: LoopCallbacks,
  env: LoopEnvironment = browserEnvironment,
): Loop {
  const { step, render, onFrame } = callbacks

  let accumulator = 0
  let simTime = 0
  let lastTime = 0
  let handle: number | null = null
  let running = false

  const tick = (time: number): void => {
    if (!running) return
    handle = env.requestFrame(tick)

    const rawDelta = time - lastTime
    lastTime = time

    // Clamp before accumulating — see MAX_FRAME_DELTA. The lower bound is not
    // paranoia: `start()` seeds `lastTime` from `now()`, while the first frame
    // is stamped with the rAF timestamp of a frame that may already have begun,
    // so the very first delta can be negative. Left unclamped it banks negative
    // time, and the accumulator produces an alpha below zero — the renderer then
    // extrapolates backwards past the previous physics state.
    const frameDelta = Math.max(0, Math.min(rawDelta, MAX_FRAME_DELTA))
    accumulator += frameDelta

    let steps = 0
    const stepStart = env.now()
    while (accumulator >= FIXED_DT) {
      step(FIXED_DT)
      accumulator -= FIXED_DT
      simTime += FIXED_DT
      steps++
    }
    const stepMs = env.now() - stepStart

    // Leftover time as a fraction of one step: how far "past" the latest physics
    // state we are. Rendering at exactly the sim state instead of interpolating
    // shows micro-stutter, since steps and refreshes drift against each other.
    const alpha = accumulator / FIXED_DT

    const renderStart = env.now()
    render(alpha)
    const renderMs = env.now() - renderStart

    onFrame?.({ frameDelta, steps, stepMs, renderMs, simTime })
  }

  return {
    start(): void {
      if (running) return
      running = true
      accumulator = 0
      lastTime = env.now()
      handle = env.requestFrame(tick)
    },
    stop(): void {
      running = false
      if (handle !== null) {
        env.cancelFrame(handle)
        handle = null
      }
    },
    get simTime(): number {
      return simTime
    },
    get running(): boolean {
      return running
    },
  }
}
