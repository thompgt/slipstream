import { describe, it, expect } from 'vitest'
import { createLoop, FIXED_DT, MAX_FRAME_DELTA, type LoopEnvironment } from './loop'

/**
 * Drives the loop manually: `advance(ms)` delivers exactly one frame after that
 * much wall-clock time, so tests are deterministic and instant.
 */
function harness() {
  let clock = 0
  let pending: ((time: number) => void) | null = null

  const env: LoopEnvironment = {
    now: () => clock,
    requestFrame: (cb) => {
      pending = cb
      return 1
    },
    cancelFrame: () => {
      pending = null
    },
  }

  return {
    env,
    advance(ms: number): void {
      clock += ms
      const cb = pending
      pending = null
      cb?.(clock)
    },
  }
}

describe('createLoop', () => {
  it('runs exactly one step when a frame matches the fixed timestep', () => {
    const h = harness()
    const steps: number[] = []
    const loop = createLoop({ step: (dt) => steps.push(dt), render: () => {} }, h.env)

    loop.start()
    h.advance(FIXED_DT)

    expect(steps).toEqual([FIXED_DT])
  })

  it('always steps by exactly FIXED_DT regardless of frame length', () => {
    const h = harness()
    const steps: number[] = []
    const loop = createLoop({ step: (dt) => steps.push(dt), render: () => {} }, h.env)

    loop.start()
    h.advance(40)
    h.advance(9)
    h.advance(23)

    expect(steps.every((dt) => dt === FIXED_DT)).toBe(true)
  })

  it('skips stepping when the display outruns the simulation', () => {
    const h = harness()
    let steps = 0
    const loop = createLoop({ step: () => steps++, render: () => {} }, h.env)

    loop.start()
    h.advance(FIXED_DT / 3) // a 180Hz-ish frame: not enough time banked yet

    expect(steps).toBe(0)
  })

  it('carries leftover time across frames rather than dropping it', () => {
    const h = harness()
    let steps = 0
    const loop = createLoop({ step: () => steps++, render: () => {} }, h.env)

    loop.start()
    h.advance(10) // banked, no step
    h.advance(10) // 20ms total -> one step, 3.33ms carried

    expect(steps).toBe(1)
  })

  it('clamps huge deltas so a backgrounded tab cannot explode the sim', () => {
    const h = harness()
    let steps = 0
    const loop = createLoop({ step: () => steps++, render: () => {} }, h.env)

    loop.start()
    h.advance(10_000) // 10s in a background tab

    // Without clamping this would be ~600 steps in a single frame, freezing the
    // page. We should see only as many steps as MAX_FRAME_DELTA can pay for.
    expect(steps).toBeLessThanOrEqual(Math.ceil(MAX_FRAME_DELTA / FIXED_DT))
    expect(steps).toBeGreaterThan(0)
    // Sim time therefore falls behind wall clock — the deliberate trade.
    expect(loop.simTime).toBeLessThanOrEqual(MAX_FRAME_DELTA)
  })

  it('ignores a negative frame delta rather than banking negative time', () => {
    // `start()` seeds `lastTime` from `now()`, but the first frame carries the
    // rAF timestamp of a frame that may already have begun — so delta one can be
    // negative. Unclamped, that drives alpha below zero and the renderer
    // extrapolates backwards past the previous physics state.
    const h = harness()
    const alphas: number[] = []
    const loop = createLoop({ step: () => {}, render: (a) => alphas.push(a) }, h.env)

    loop.start()
    h.advance(-8)
    h.advance(FIXED_DT / 2)

    expect(loop.simTime).toBe(0)
    for (const alpha of alphas) expect(alpha).toBeGreaterThanOrEqual(0)
  })

  it('reports an interpolation alpha in [0, 1)', () => {
    const h = harness()
    const alphas: number[] = []
    const loop = createLoop({ step: () => {}, render: (a) => alphas.push(a) }, h.env)

    loop.start()
    h.advance(FIXED_DT * 1.5)
    h.advance(FIXED_DT * 0.25)

    expect(alphas.length).toBe(2)
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0)
      expect(alpha).toBeLessThan(1)
    }
  })

  it('advances simTime only in whole steps', () => {
    const h = harness()
    const loop = createLoop({ step: () => {}, render: () => {} }, h.env)

    loop.start()
    h.advance(FIXED_DT * 2.7)

    // 2 steps' worth of time; the 0.7 remainder is still in the accumulator.
    expect(loop.simTime).toBeCloseTo(FIXED_DT * 2, 6)
  })

  it('stops stepping after stop()', () => {
    const h = harness()
    let steps = 0
    const loop = createLoop({ step: () => steps++, render: () => {} }, h.env)

    loop.start()
    h.advance(FIXED_DT)
    loop.stop()
    h.advance(FIXED_DT * 5)

    expect(steps).toBe(1)
    expect(loop.running).toBe(false)
  })
})
