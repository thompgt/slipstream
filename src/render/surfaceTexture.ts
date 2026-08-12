/**
 * Grain for the ground.
 *
 * The circuit is drawn as bands of flat vertex colour, which is the right way to
 * build it — one mesh, one draw call, kerbs and lines exactly where the physics
 * says they are. It is also why the road still reads as painted card: real
 * asphalt is aggregate, and aggregate is a texture. At 300kph down the main
 * straight a perfectly uniform grey ribbon gives the eye nothing to measure
 * speed against, which is the same failure as a rigidly-attached chase camera
 * and gets misdiagnosed the same way.
 *
 * A tiling noise map fixes it for nothing: no extra draw calls, no extra
 * triangles, one texture shared by the road and the terrain. It multiplies the
 * vertex colours, so the kerbs stay red-and-white and the lines stay white —
 * they just stop being flat.
 *
 * Built as a `DataTexture` from a typed array rather than drawn on a canvas.
 * That is not a stylistic preference: `render/` is exercised by the budget test
 * in Node, where there is no `document`, and a canvas here would mean either a
 * DOM shim in the test or a module the test cannot import.
 */

import * as THREE from 'three'

/** Pixels per side. 256 is ~1.6cm per texel at the repeat below. */
const SIZE = 256

/** Metres of ground one tile covers. Keep the repeat off round numbers. */
export const TILE_METRES = 4.3

/**
 * Deterministic hash, 0..1.
 *
 * The usual sin-fract trick. Not a good random number generator, and it does not
 * need to be — it needs to give the same speckle on every machine and every
 * reload, which `Math.random` explicitly does not.
 */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

const smooth = (t: number): number => t * t * (3 - 2 * t)

/** Value noise: bilinear between lattice points, smoothed. Wraps on `period`. */
function valueNoise(x: number, y: number, period: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)

  // Modulo at the lattice, so the texture tiles seamlessly at any octave.
  const wrap = (v: number): number => ((v % period) + period) % period
  const xa = wrap(x0)
  const xb = wrap(x0 + 1)
  const ya = wrap(y0)
  const yb = wrap(y0 + 1)

  const top = hash(xa, ya) * (1 - fx) + hash(xb, ya) * fx
  const bottom = hash(xa, yb) * (1 - fx) + hash(xb, yb) * fx
  return top * (1 - fy) + bottom * fy
}

/**
 * How far the grain swings either side of neutral.
 *
 * Small on purpose. This multiplies colours that are already correct — a strong
 * map would drag the asphalt's albedo away from the value it was chosen for and
 * turn the white lines grey. What it has to do is break up the flat, not restate
 * the paint.
 */
const CONTRAST = 0.17

let cached: THREE.DataTexture | null = null

/**
 * The grain map. Built once and shared: it is the same aggregate everywhere, and
 * three of these would be three uploads of the same 256KB.
 */
export function surfaceGrain(): THREE.DataTexture {
  if (cached) return cached

  const data = new Uint8Array(SIZE * SIZE * 4)

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Three octaves: coarse patching, aggregate, and the fine speckle that
      // stops the middle octave looking like a cloud texture.
      let value = 0
      let amplitude = 1
      let total = 0
      for (const period of [8, 32, 128]) {
        const scale = period / SIZE
        value += valueNoise(x * scale, y * scale, period) * amplitude
        total += amplitude
        amplitude *= 0.55
      }
      value /= total

      const level = Math.round(255 * Math.min(Math.max(1 - CONTRAST + value * CONTRAST * 2, 0), 1))
      const at = (y * SIZE + x) * 4
      data[at] = level
      data[at + 1] = level
      data[at + 2] = level
      data[at + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  // Greyscale detail multiplying an already-correct albedo, so it belongs in
  // linear space. Tagging it sRGB would double-apply the transfer curve and
  // darken every surface in the scene.
  texture.colorSpace = THREE.NoColorSpace
  texture.name = 'surface-grain'
  texture.needsUpdate = true

  cached = texture
  return texture
}

/** Metres of terrain one tile covers. Coarser than the road, and off-round. */
const GROUND_TILE_METRES = 11.7

let groundCached: THREE.DataTexture | null = null

/**
 * The same grain for the terrain plane, tiled to suit it.
 *
 * A clone rather than the shared texture, because `repeat` is a property of the
 * texture and not of the material: setting it for a plane hundreds of metres
 * across would set it for the road as well and turn the asphalt into a shimmer.
 * The clone shares the pixel data, so the cost is one more upload of 256KB and
 * no more generation.
 *
 * @param size Width of the terrain plane in metres.
 */
export function groundGrain(size: number): THREE.DataTexture {
  if (!groundCached) {
    groundCached = surfaceGrain().clone()
    groundCached.name = 'ground-grain'
    groundCached.needsUpdate = true
  }
  // The plane's own UVs run 0..1 corner to corner, so the repeat carries all of
  // the scaling.
  const tiles = Math.max(1, Math.round(size / GROUND_TILE_METRES))
  groundCached.repeat.set(tiles, tiles)
  return groundCached
}

/**
 * Sharpen the grain at grazing angles.
 *
 * The single biggest thing you can do for a road you are looking along. Without
 * it, mipmapping blurs the far tarmac to a flat smear about thirty metres out —
 * which is precisely the distance the grain was added to give you. Needs the
 * renderer, because the maximum is a driver capability, hence a separate call
 * rather than something the builder can do for itself.
 */
export function sharpenGrain(renderer: THREE.WebGLRenderer): void {
  // Capped at 8 rather than taken at the maximum. Anisotropic filtering is per
  // fragment and the road fills most of the frame; 16x on Safari's driver is
  // measurable and the difference from 8x on a 256px map is not.
  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8)
  for (const texture of [cached, groundCached]) {
    if (!texture) continue
    texture.anisotropy = anisotropy
    texture.needsUpdate = true
  }
}

/** Drops the shared textures. Only the renderer's `dispose` should call this. */
export function disposeGrain(): void {
  cached?.dispose()
  groundCached?.dispose()
  cached = null
  groundCached = null
}
