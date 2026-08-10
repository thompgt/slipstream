import { describe, expect, it } from 'vitest'
import { carSetup, type TyreSetup } from './carSetup'
import { peakSlipAngle, tyreForce } from './tyre'

const tyre: TyreSetup = carSetup.tyres

const sample = (from: number, to: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1))

describe('tyreForce', () => {
  it('produces no force at zero slip', () => {
    expect(tyreForce(0, tyre)).toBe(0)
  })

  it('is an odd function — slip either way gives equal, opposite force', () => {
    for (const angle of sample(0.01, 0.6, 20)) {
      expect(tyreForce(-angle, tyre)).toBeCloseTo(-tyreForce(angle, tyre), 12)
    }
  })

  it('is normalised — the peak is 1.0, so callers can scale by axle grip', () => {
    const peak = Math.max(...sample(0, 1.5, 400).map((a) => tyreForce(a, tyre)))
    expect(peak).toBeCloseTo(1, 3)
  })

  it('rises monotonically up to the peak slip angle', () => {
    const peak = peakSlipAngle(tyre)
    const angles = sample(0, peak, 60)
    for (let i = 1; i < angles.length; i++) {
      const previous = tyreForce(angles[i - 1] ?? 0, tyre)
      const current = tyreForce(angles[i] ?? 0, tyre)
      expect(current).toBeGreaterThan(previous)
    }
  })

  it('falls off past the peak rather than plateauing', () => {
    const peak = peakSlipAngle(tyre)
    expect(tyreForce(peak * 2, tyre)).toBeLessThan(tyreForce(peak, tyre))
    expect(tyreForce(peak * 4, tyre)).toBeLessThan(tyreForce(peak * 2, tyre))
  })

  /**
   * The load-bearing test for the whole brief. If grip collapsed past the peak
   * the car would snap into a spin with no window to catch it; the design calls
   * for a slide that keeps most of its grip and stays catchable.
   */
  it('keeps most of its grip well past the limit, so slides are catchable', () => {
    const peak = peakSlipAngle(tyre)
    const wellPast = tyreForce(peak * 3, tyre)
    expect(wellPast).toBeGreaterThan(0.7)
  })

  it('never exceeds the normalised peak, at any slip angle', () => {
    for (const angle of sample(-Math.PI / 2, Math.PI / 2, 500)) {
      expect(Math.abs(tyreForce(angle, tyre))).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('stays finite at absurd slip angles', () => {
    for (const angle of [-100, -10, 10, 100]) {
      expect(Number.isFinite(tyreForce(angle, tyre))).toBe(true)
    }
  })

  it('reaches the peak sooner with a stiffer carcass', () => {
    const soft = peakSlipAngle({ ...tyre, stiffness: 6 })
    const stiff = peakSlipAngle({ ...tyre, stiffness: 14 })
    expect(stiff).toBeLessThan(soft)
  })
})

describe('peakSlipAngle', () => {
  it('agrees with a brute-force search of the curve', () => {
    for (const stiffness of [5, 9, 15]) {
      for (const shape of [1.3, 1.6, 1.9]) {
        const t: TyreSetup = { ...tyre, stiffness, shape }
        const angles = sample(0, 1.2, 4000)
        let best = 0
        let bestForce = -Infinity
        for (const angle of angles) {
          const force = tyreForce(angle, t)
          if (force > bestForce) {
            bestForce = force
            best = angle
          }
        }
        expect(peakSlipAngle(t)).toBeCloseTo(best, 2)
      }
    }
  })

  it('lands in the 6-12 degree range a racing tyre should peak in', () => {
    const degrees = (peakSlipAngle(tyre) * 180) / Math.PI
    expect(degrees).toBeGreaterThan(6)
    expect(degrees).toBeLessThan(12)
  })
})
