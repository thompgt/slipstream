/**
 * Debug overlay: FPS, physics step cost, and arbitrary key/value telemetry.
 *
 * The telemetry slots exist because tuning the tyre model in M1 is guesswork
 * without seeing slip angle and per-axle load live. Toggle with backquote.
 */

import type { FrameStats } from '../core/loop'

/** Updates are throttled — DOM writes are expensive and the eye can't read 60Hz. */
const UPDATE_INTERVAL_MS = 100
/** Frames averaged for the FPS readout, so it doesn't jitter. */
const SAMPLE_SIZE = 30

export interface DebugOverlay {
  /** Call once per frame with the loop's stats. */
  update: (stats: FrameStats) => void
  /** Add or replace a telemetry row. Rendered in insertion order. */
  set: (key: string, value: string | number) => void
  remove: (key: string) => void
  toggle: () => void
}

export function createDebugOverlay(element: HTMLElement): DebugOverlay {
  const frameSamples: number[] = []
  const telemetry = new Map<string, string>()
  let lastPaint = 0
  let visible = true
  let elapsed = 0

  const format = (value: number, digits = 1): string => value.toFixed(digits)

  const paint = (stats: FrameStats): void => {
    const avgFrame = frameSamples.reduce((a, b) => a + b, 0) / (frameSamples.length || 1)
    const fps = avgFrame > 0 ? 1000 / avgFrame : 0

    const lines = [
      `fps       ${format(fps)}`,
      `frame     ${format(avgFrame, 2)} ms`,
      `step      ${format(stats.stepMs, 2)} ms  x${stats.steps}`,
      `render    ${format(stats.renderMs, 2)} ms`,
      `sim time  ${format(stats.simTime / 1000, 2)} s`,
    ]

    if (telemetry.size > 0) {
      lines.push('')
      const width = Math.max(...[...telemetry.keys()].map((k) => k.length))
      for (const [key, value] of telemetry) {
        lines.push(`${key.padEnd(width)}  ${value}`)
      }
    }

    element.textContent = lines.join('\n')
  }

  return {
    update(stats) {
      frameSamples.push(stats.frameDelta)
      if (frameSamples.length > SAMPLE_SIZE) frameSamples.shift()

      elapsed += stats.frameDelta
      if (!visible || elapsed - lastPaint < UPDATE_INTERVAL_MS) return
      lastPaint = elapsed
      paint(stats)
    },
    set(key, value) {
      telemetry.set(key, String(value))
    },
    remove(key) {
      telemetry.delete(key)
    },
    toggle() {
      visible = !visible
      element.hidden = !visible
    },
  }
}
