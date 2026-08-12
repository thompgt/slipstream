/**
 * The circuit, extruded into something you can see.
 *
 * The track pipeline already produces an evenly-spaced table of centreline
 * samples carrying width, banking, kerbs and what lies either side. This turns
 * that table into geometry, and it is deliberately the *same* table the physics
 * queries: if the road you can see and the road you can grip ever came from two
 * sources, they would drift, and the bug reads as "the kerbs are in the wrong
 * place" long after the cause is cold.
 *
 * One mesh, one material, one draw call. The road is a ribbon of parallel bands
 * — run-off, kerb, white line, asphalt, and back out again — and each band gets
 * its own pair of vertices per sample so its colour stays crisp instead of
 * smearing into its neighbour. That costs seven quads per sample rather than
 * one, which at Monza's 2m spacing is around 40k triangles: a third of the
 * budget in ARCHITECTURE.md, for the entire circuit.
 *
 * Bands sit at slightly different heights — kerbs proud of the asphalt, grass
 * below it — because a flat ribbon of adjacent colours reads as paint on a car
 * park. The steps are a few centimetres and are cosmetic only; the physics is
 * still 2D and knows nothing about them.
 */

import * as THREE from 'three'
import { KERB_WIDTH, RUNOFF_WIDTH } from '../track/layout'
import type { SurfaceType, TrackData, TrackSample } from '../track/spline'
import { surfaceGrain, TILE_METRES } from './surfaceTexture'

/** Painted line width, m. */
const LINE_WIDTH = 0.15
/** Length of one red or white kerb block, m. */
const KERB_BLOCK = 1.5

const COLOURS: Record<SurfaceType | 'line' | 'kerbRed' | 'kerbWhite', number> = {
  asphalt: 0x30343a,
  concrete: 0x4a4e54,
  kerb: 0xb03428,
  grass: 0x2c4426,
  gravel: 0x8d7f61,
  line: 0xd8dade,
  kerbRed: 0xb03428,
  kerbWhite: 0xcfd2d6,
}

/** Vertical offsets, m. Small enough to be a texture substitute, not a ramp. */
const LIFT = {
  kerb: 0.05,
  grass: -0.08,
  gravel: -0.06,
  concrete: -0.02,
}

interface Band {
  /** Lateral offsets, m, left edge then right edge. */
  from: number
  to: number
  colour: number
  lift: number
}

const runoffColour = (kind: TrackSample['runoffLeft']): number => {
  switch (kind) {
    case 'gravel':
      return COLOURS.gravel
    case 'tarmac':
      return COLOURS.concrete
    // A wall is not a surface. Until barriers exist as geometry, the strip in
    // front of one is concrete, which is what it is at a real circuit anyway.
    case 'wall':
      return COLOURS.concrete
    default:
      return COLOURS.grass
  }
}

const runoffLift = (kind: TrackSample['runoffLeft']): number =>
  kind === 'gravel' ? LIFT.gravel : kind === 'grass' ? LIFT.grass : LIFT.concrete

/**
 * The seven bands across the road at one sample, left to right.
 *
 * Always seven, even where there is no kerb — a constant stride is what lets the
 * index buffer be built by arithmetic rather than bookkeeping, and a kerb-less
 * sample simply paints its kerb band the colour of the run-off behind it.
 */
function bandsAt(sample: TrackSample, startLine: boolean, bands: Band[]): Band[] {
  const w = sample.width
  const outer = w + KERB_WIDTH

  const leftRunoff = runoffColour(sample.runoffLeft)
  const rightRunoff = runoffColour(sample.runoffRight)
  // Alternating blocks by distance along the lap rather than by sample index, so
  // the pattern keeps its real-world size wherever the sampling lands.
  const block = Math.floor(sample.distance / KERB_BLOCK) % 2 === 0
  const kerb = block ? COLOURS.kerbRed : COLOURS.kerbWhite

  // The start/finish line is painted, not built: the asphalt bands go white for
  // the couple of metres before the line rather than earning geometry of their
  // own.
  const road = startLine ? COLOURS.line : COLOURS.asphalt
  const line = COLOURS.line

  bands[0] = {
    from: -(outer + RUNOFF_WIDTH),
    to: -outer,
    colour: leftRunoff,
    lift: runoffLift(sample.runoffLeft),
  }
  bands[1] = sample.kerbLeft
    ? { from: -outer, to: -w, colour: kerb, lift: LIFT.kerb }
    : { from: -outer, to: -w, colour: leftRunoff, lift: runoffLift(sample.runoffLeft) }
  bands[2] = { from: -w, to: -w + LINE_WIDTH, colour: line, lift: 0 }
  bands[3] = { from: -w + LINE_WIDTH, to: w - LINE_WIDTH, colour: road, lift: 0 }
  bands[4] = { from: w - LINE_WIDTH, to: w, colour: line, lift: 0 }
  bands[5] = sample.kerbRight
    ? { from: w, to: outer, colour: kerb, lift: LIFT.kerb }
    : { from: w, to: outer, colour: rightRunoff, lift: runoffLift(sample.runoffRight) }
  bands[6] = {
    from: outer,
    to: outer + RUNOFF_WIDTH,
    colour: rightRunoff,
    lift: runoffLift(sample.runoffRight),
  }

  return bands
}

const BANDS = 7
const VERTICES_PER_SAMPLE = BANDS * 2

export function buildTrackMesh(track: TrackData): THREE.Mesh {
  const samples = track.samples
  const count = samples.length

  /**
   * One more row of vertices than there are samples.
   *
   * The circuit closes, and the obvious way to close it is to index the last
   * segment back to row zero. That works for position and colour, which are
   * identical at both ends — and breaks the grain UV, which is not: v runs from
   * zero to a few hundred and the wrap segment would interpolate all of it
   * backwards inside a single two-metre quad, painting a compressed smear of the
   * whole texture across the start line. The duplicate row costs fourteen
   * vertices and no triangles.
   */
  const rows = count + 1

  const positions = new Float32Array(rows * VERTICES_PER_SAMPLE * 3)
  const colours = new Float32Array(rows * VERTICES_PER_SAMPLE * 3)
  // Grain UVs, in tiles. Laid out in real metres — lateral offset across,
  // distance along the lap up — rather than per-band, so the aggregate runs
  // continuously across the white line instead of restarting at every edge.
  const uvs = new Float32Array(rows * VERTICES_PER_SAMPLE * 2)
  // The loop closes, so there are exactly as many segments as samples.
  const indices = new Uint32Array(count * BANDS * 6)

  const bands: Band[] = []
  const colour = new THREE.Color()

  // Stretch the tile very slightly so a whole number of them fits the lap. The
  // circuit closes, so a v of `distance / TILE_METRES` jumps from 1300-and-a-bit
  // back to zero across the start line and leaves one squeezed band of texture
  // right where every lap begins. A percent of scale is invisible; the seam is
  // not.
  const tilesPerLap = Math.max(1, Math.round(track.length / TILE_METRES))
  const tileAlong = track.length / tilesPerLap

  for (let i = 0; i < rows; i++) {
    // The closing row is sample zero again, so position, colour and the kerb
    // block pattern all come from there; only how far round the lap it is
    // differs, and that is the whole reason the row exists.
    const sample = samples[i % count]!
    const along = i === count ? track.length : sample.distance
    // Right of the direction of travel, matching `pointAt` in `track/spline`.
    const rightX = Math.cos(sample.heading)
    const rightZ = -Math.sin(sample.heading)
    // Banking raises the left side, so a point to the right of the centreline
    // drops. Zero everywhere on Monza; free to be right about anyway.
    const tilt = Math.sin(sample.banking)

    bandsAt(sample, i === 0 || i >= count - 1, bands)

    for (let b = 0; b < BANDS; b++) {
      const band = bands[b]!
      colour.setHex(band.colour)

      for (let edge = 0; edge < 2; edge++) {
        const lateral = edge === 0 ? band.from : band.to
        const vertex = (i * VERTICES_PER_SAMPLE + b * 2 + edge) * 3

        positions[vertex] = sample.x + rightX * lateral
        positions[vertex + 1] = sample.y - lateral * tilt + band.lift
        positions[vertex + 2] = sample.z + rightZ * lateral

        colours[vertex] = colour.r
        colours[vertex + 1] = colour.g
        colours[vertex + 2] = colour.b

        const uv = (i * VERTICES_PER_SAMPLE + b * 2 + edge) * 2
        uvs[uv] = lateral / TILE_METRES
        uvs[uv + 1] = along / tileAlong
      }
    }
  }

  for (let i = 0; i < count; i++) {
    // No modulo: `rows` already carries the duplicate that closes the lap.
    const next = i + 1
    for (let b = 0; b < BANDS; b++) {
      const leftHere = i * VERTICES_PER_SAMPLE + b * 2
      const rightHere = leftHere + 1
      const leftNext = next * VERTICES_PER_SAMPLE + b * 2
      const rightNext = leftNext + 1

      // Wound so the face normal points up: with x right and z forward,
      // (forward x right) is +y, so left-here, left-next, right-here it is.
      const at = (i * BANDS + b) * 6
      indices[at] = leftHere
      indices[at + 1] = leftNext
      indices[at + 2] = rightHere
      indices[at + 3] = rightHere
      indices[at + 4] = leftNext
      indices[at + 5] = rightNext
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()

  const grain = surfaceGrain()
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    // Multiplies the band colours rather than replacing them: kerbs stay red and
    // white and the lines stay painted, they just stop being flat.
    map: grain,
    // The same map on roughness, so the aggregate catches the sun unevenly.
    // Tarmac that reflects perfectly uniformly is tarmac that looks like felt.
    roughnessMap: grain,
    roughness: 0.98,
    metalness: 0,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = track.name
  // Static geometry the camera is always inside: culling it per frame costs more
  // than it saves, and a false cull would blink the whole circuit out.
  mesh.frustumCulled = false
  return mesh
}

/** Axis-aligned bounds of the sampled centreline, for sizing the terrain. */
export function trackBounds(track: TrackData): {
  centreX: number
  centreZ: number
  size: number
} {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const sample of track.samples) {
    if (sample.x < minX) minX = sample.x
    if (sample.z < minZ) minZ = sample.z
    if (sample.x > maxX) maxX = sample.x
    if (sample.z > maxZ) maxZ = sample.z
  }
  return {
    centreX: (minX + maxX) / 2,
    centreZ: (minZ + maxZ) / 2,
    size: Math.max(maxX - minX, maxZ - minZ) + RUNOFF_WIDTH * 8,
  }
}
