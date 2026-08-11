/**
 * "Where is this car on the track?" — answered in constant time.
 *
 * This is the most-called function in the codebase after the physics step
 * itself: every car asks it every step, and lap counting, sector splits,
 * standings, surface grip, respawn, blue flags, and the whole of the AI are all
 * built on the answer. PLAN.md flags it as the thing M2 must get right, and it
 * is right about why — a linear scan over a few thousand samples per car per
 * step is 20 cars x 3000 samples x 60Hz, which is 3.6 million distance
 * calculations a second to answer a question that should be a lookup.
 *
 * So the samples are bucketed into a uniform grid at load. A query hashes the
 * car's position to a cell, tests only the samples in that cell and its
 * neighbours, and is done. Cell size is a few times the sample spacing so the
 * nine-cell neighbourhood always contains the true nearest sample.
 */

import { KERB_WIDTH } from './layout'
import type { TrackData, TrackSample, SurfaceType } from './spline'

/** Where a car is, relative to the road. */
export interface TrackPosition {
  /** Distance along the centreline from the start/finish line, m. */
  distanceAlong: number
  /**
   * Metres right of the centreline. Negative is left. Compare against `width`
   * to know whether the car is on the road.
   */
  lateralOffset: number
  /** Direction the road points here, radians — the reference for "facing the wrong way". */
  heading: number
  /** Signed curvature, 1/m. Positive curves right. */
  curvature: number
  /** Half-width of the racing surface here, m. */
  width: number
  surface: SurfaceType
  /** Index of the nearest sample, for callers that want the sample itself. */
  sampleIndex: number
}

export const createTrackPosition = (): TrackPosition => ({
  distanceAlong: 0,
  lateralOffset: 0,
  heading: 0,
  curvature: 0,
  width: 0,
  surface: 'asphalt',
  sampleIndex: 0,
})

/**
 * How far the neighbourhood search will widen before giving up and scanning
 * everything. Four rings covers a car most of a straight's width off the road;
 * beyond that the linear fallback is both correct and rare enough not to matter.
 */
const MAX_SEARCH_RINGS = 4

export interface TrackIndex {
  track: TrackData
  cellSize: number
  /** Cell key -> sample indices. Built once at load. */
  cells: Map<number, number[]>
  minX: number
  minZ: number
  columns: number
}

/**
 * Bucket every sample into a uniform grid.
 *
 * Keys are packed into a single integer rather than a `"x,z"` string: string
 * keys allocate on every lookup, and this is on the 60Hz path.
 */
export function buildTrackIndex(track: TrackData): TrackIndex {
  // Large enough that a car is always within one cell of its true nearest
  // sample, small enough that cells hold a handful of samples rather than
  // hundreds. Track width is the natural scale.
  const cellSize = Math.max(10, track.spacing * 8)

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

  // Pad so cars that run wide still hash into a valid cell.
  const padding = cellSize * 4
  minX -= padding
  minZ -= padding
  const columns = Math.ceil((maxX + padding - minX) / cellSize) + 1

  const index: TrackIndex = { track, cellSize, cells: new Map(), minX, minZ, columns }

  for (let i = 0; i < track.samples.length; i++) {
    const sample = track.samples[i]!
    const key = cellKey(index, sample.x, sample.z)
    const bucket = index.cells.get(key)
    if (bucket) bucket.push(i)
    else index.cells.set(key, [i])
  }

  return index
}

const cellKey = (index: TrackIndex, x: number, z: number): number => {
  const column = Math.floor((x - index.minX) / index.cellSize)
  const row = Math.floor((z - index.minZ) / index.cellSize)
  return row * index.columns + column
}

/**
 * Locate a world position on the track.
 *
 * @param out Mutated and returned — called for every car every step.
 */
export function locate(index: TrackIndex, x: number, z: number, out: TrackPosition): TrackPosition {
  const { track, cellSize } = index

  let bestIndex = 0
  let bestDistanceSquared = Infinity

  const column = Math.floor((x - index.minX) / cellSize)
  const row = Math.floor((z - index.minZ) / cellSize)

  // Grow the search outward until the best hit is provably the nearest.
  //
  // One ring is not enough on its own: any sample outside a radius-`ring` block
  // is at least `ring * cellSize` away, so a hit further away than that could
  // still be beaten by something just outside the block. On track — which is
  // every car, almost always — the first ring satisfies the bound immediately
  // and this costs one comparison. It only iterates for cars well off the road,
  // where being right matters more than being fast.
  for (let ring = 1; ring <= MAX_SEARCH_RINGS; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        // Skip the interior — already scanned on a previous ring.
        if (ring > 1 && Math.abs(dr) !== ring && Math.abs(dc) !== ring) continue

        const bucket = index.cells.get((row + dr) * index.columns + (column + dc))
        if (!bucket) continue

        for (const i of bucket) {
          const sample = track.samples[i]!
          const dx = sample.x - x
          const dz = sample.z - z
          const distanceSquared = dx * dx + dz * dz
          if (distanceSquared < bestDistanceSquared) {
            bestDistanceSquared = distanceSquared
            bestIndex = i
          }
        }
      }
    }

    const guaranteed = ring * cellSize
    if (bestDistanceSquared <= guaranteed * guaranteed) return describe(index, bestIndex, x, z, out)
  }

  // Far enough out that even the widened search cannot prove an answer — through
  // a barrier, or teleported by a bug. Fall back to a linear scan rather than
  // returning a confident wrong one, because standings and lap counting believe
  // this number.
  {
    for (let i = 0; i < track.samples.length; i++) {
      const sample = track.samples[i]!
      const dx = sample.x - x
      const dz = sample.z - z
      const distanceSquared = dx * dx + dz * dz
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared
        bestIndex = i
      }
    }
  }

  return describe(index, bestIndex, x, z, out)
}

/**
 * Turn a nearest-sample hit into a position, refined along the centreline.
 *
 * Without the refinement, `distanceAlong` would step in whole samples — 2m
 * jumps, which makes sector timing granular and standings between two closely
 * matched cars flicker. Projecting onto the local tangent costs a dot product
 * and makes it continuous.
 */
function describe(
  index: TrackIndex,
  sampleIndex: number,
  x: number,
  z: number,
  out: TrackPosition,
): TrackPosition {
  const { track } = index
  const sample = track.samples[sampleIndex]!

  const forwardX = Math.sin(sample.heading)
  const forwardZ = Math.cos(sample.heading)
  const rightX = Math.cos(sample.heading)
  const rightZ = -Math.sin(sample.heading)

  const dx = x - sample.x
  const dz = z - sample.z

  const along = dx * forwardX + dz * forwardZ
  const lateral = dx * rightX + dz * rightZ

  let distance = sample.distance + along
  // Wrap, so a car sitting just before the line reads as almost a full lap
  // rather than a small negative number.
  if (distance < 0) distance += track.length
  else if (distance >= track.length) distance -= track.length

  out.distanceAlong = distance
  out.lateralOffset = lateral
  out.heading = sample.heading
  out.curvature = sample.curvature
  out.width = sample.width
  out.sampleIndex = sampleIndex
  out.surface = surfaceFor(sample, lateral)

  return out
}

/** Which surface a given lateral offset lands on. */
function surfaceFor(sample: TrackSample, lateral: number): SurfaceType {
  const distance = Math.abs(lateral)
  if (distance <= sample.width) return 'asphalt'

  const onLeft = lateral < 0
  const kerbed = onLeft ? sample.kerbLeft : sample.kerbRight
  if (kerbed && distance <= sample.width + KERB_WIDTH) return 'kerb'

  const runoff = onLeft ? sample.runoffLeft : sample.runoffRight
  // A wall has no surface of its own — you are on whatever the run-off is until
  // you hit it, and collision handles the rest.
  if (runoff === 'tarmac' || runoff === 'wall') return 'concrete'
  return runoff === 'gravel' ? 'gravel' : 'grass'
}

/**
 * Grip multiplier for a surface.
 *
 * Gravel is deliberately punishing but not absolute: it should end your lap, not
 * teleport you. Grass is slipperier than it looks, which is what makes running
 * two wheels wide on exit a real mistake rather than a free track extension.
 */
export function surfaceGrip(surface: SurfaceType): number {
  switch (surface) {
    case 'asphalt':
      return 1
    case 'concrete':
      return 0.92
    case 'kerb':
      // Kerbs give up little grip; what makes them costly is the ride, which
      // arrives with the suspension model.
      return 0.85
    case 'grass':
      return 0.45
    case 'gravel':
      return 0.38
  }
}

/**
 * Rolling drag multiplier for a surface. Gravel is a trap because it *scrubs
 * speed*, not because it has no grip.
 */
export function surfaceDrag(surface: SurfaceType): number {
  switch (surface) {
    case 'gravel':
      return 12
    case 'grass':
      return 4
    default:
      return 1
  }
}

/**
 * Signed distance travelled from `previous` to `current` around a closed lap.
 *
 * The start/finish wraparound is the classic bug here: a car crossing the line
 * goes from `length - 1` to `1`, which looks like driving a whole lap backwards.
 * PLAN.md calls this out for standings and it is the same maths for lap counting
 * and sector splits, so it lives in one place.
 */
export function lapDelta(previous: number, current: number, length: number): number {
  let delta = current - previous
  if (delta > length / 2) delta -= length
  else if (delta < -length / 2) delta += length
  return delta
}
