/**
 * The grain map.
 *
 * Procedural textures fail quietly. A seam at the tile edge, a map that is
 * secretly flat, a contrast that swallows the albedo underneath it — none of
 * those throw, and all of them are arithmetic with a right answer. Worth
 * asserting for the same reason the car's geometry is.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { groundGrain, surfaceGrain, TILE_METRES } from './surfaceTexture'

const texture = surfaceGrain()
const data = texture.image.data as Uint8Array
const size = texture.image.width

const at = (x: number, y: number): number => data[(y * size + x) * 4] ?? -1

describe('surfaceGrain', () => {
  it('is greyscale and opaque', () => {
    // Scanned into a count rather than asserted per texel: 65k `expect` calls
    // takes longer than the whole rest of the suite.
    let offColour = 0
    let transparent = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 1] !== data[i] || data[i + 2] !== data[i]) offColour++
      if (data[i + 3] !== 255) transparent++
    }
    expect(offColour).toBe(0)
    expect(transparent).toBe(0)
  })

  it('varies, but not enough to repaint the surface underneath', () => {
    let min = 255
    let max = 0
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i] ?? 0
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    // Flat would mean the whole file is a no-op that still costs an upload.
    expect(max - min).toBeGreaterThan(30)
    // And this multiplies colours that were chosen for their real albedo. Drag
    // them too far and the asphalt is no longer the value it was picked to be
    // and the white lines go grey.
    expect(min).toBeGreaterThan(255 * 0.7)
    expect(max).toBeLessThanOrEqual(255)
  })

  it('tiles without a seam', () => {
    // The opposite edges of the tile sit next to each other on the road. If they
    // do not match, the seam is a line across the circuit every few metres —
    // and it will read as a crack in the tarmac, not as a bug.
    let worstColumn = 0
    let worstRow = 0
    for (let i = 0; i < size; i++) {
      worstColumn = Math.max(worstColumn, Math.abs(at(0, i) - at(size - 1, i)))
      worstRow = Math.max(worstRow, Math.abs(at(i, 0) - at(i, size - 1)))
    }
    // Adjacent texels, not identical ones: one step of noise apart is what two
    // neighbouring pixels should be.
    expect(worstColumn).toBeLessThan(12)
    expect(worstRow).toBeLessThan(12)
  })

  it('is the same texture every time it is asked for', () => {
    // Shared, not rebuilt: three copies is three uploads of identical pixels.
    expect(surfaceGrain()).toBe(texture)
  })

  it('repeats, and stays out of sRGB', () => {
    expect(texture.wrapS).toBe(THREE.RepeatWrapping)
    expect(texture.wrapT).toBe(THREE.RepeatWrapping)
    // Detail multiplying an albedo is linear data. Tagging it sRGB applies the
    // transfer curve twice and darkens every surface in the scene.
    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
  })

  it('grains the road at a scale a driver could see', () => {
    // Somewhere between "aggregate" and "camouflage". A tile of 40m is a
    // pattern; a tile of 40cm is a shimmer at any speed worth reaching.
    expect(TILE_METRES).toBeGreaterThan(1)
    expect(TILE_METRES).toBeLessThan(10)
  })
})

describe('groundGrain', () => {
  it('shares the pixels but not the tiling', () => {
    const ground = groundGrain(600)
    expect(ground).not.toBe(surfaceGrain())
    expect(ground.image.data).toBe(data)
    expect(surfaceGrain().repeat.x).toBe(1)
  })

  it('tiles a bigger plane more times', () => {
    // Same clone each call — the repeat is set on it, so the larger request must
    // be read after the smaller one to mean anything.
    expect(groundGrain(200).repeat.x).toBeLessThan(groundGrain(2000).repeat.x)
  })
})
