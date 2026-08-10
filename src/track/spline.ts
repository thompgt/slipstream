/**
 * Circuits as a centreline spline, sampled once at load into a flat table.
 *
 * The authoring format is a handful of control points with a width, a banking
 * angle, and what lies either side. Everything else — the road surface, the
 * kerbs, the barriers, the racing line, lap distance, where a car is — is
 * derived from that. PLAN.md is blunt about why: a 3D racer with custom physics
 * and AI will eat most of its budget before a second circuit exists, so the
 * thing worth investing in is the pipeline, not the tracks. Circuit two should
 * cost an evening of dragging points, not a week of modelling.
 *
 * Catmull-Rom rather than Bezier because it passes *through* its control points.
 * When you drag a node to fix the apex of a corner, the corner moves to where
 * you put it. Bezier handles give finer control and cost far more authoring
 * time, which is the resource actually in short supply.
 *
 * Sampling at load, into an array indexed by distance, is what makes the runtime
 * queries cheap. Nothing here runs per frame; `query.ts` does, and it only ever
 * reads this table.
 */

import type { Vec2 } from '../core/math'

/** What a car is driving on. Each has its own grip and drag in the physics step. */
export type SurfaceType = 'asphalt' | 'kerb' | 'gravel' | 'grass' | 'concrete'

/** What sits beyond the white line on one side of the road. */
export type RunoffKind = 'gravel' | 'grass' | 'tarmac' | 'wall'

/**
 * One authored control point.
 *
 * Positions are metres in world space, `y` is elevation. Everything else
 * describes the road *at* that point and is interpolated between nodes.
 */
export interface TrackNode {
  x: number
  z: number
  /** Elevation, m. */
  y?: number
  /** Half-width of the racing surface, m. Real circuits run 4.5m to 8m a side. */
  width: number
  /** Banking, radians. Positive banks the road up to the left. */
  banking?: number
  kerbLeft?: boolean
  kerbRight?: boolean
  runoffLeft?: RunoffKind
  runoffRight?: RunoffKind
  /** Optional corner name, for the HUD and for readable circuit files. */
  name?: string
}

/**
 * One sampled point along the centreline.
 *
 * Deliberately fat and precomputed. These are built once and read constantly —
 * by lap timing, standings, AI, respawn, surface lookup, and the mesh builder —
 * so anything derivable is derived here rather than at 60Hz.
 */
export interface TrackSample {
  x: number
  z: number
  y: number
  /** Distance from the start/finish line along the centreline, m. */
  distance: number
  /** Tangent direction, radians, in the same convention as `Car.heading`. */
  heading: number
  /**
   * Signed curvature, 1/m. Positive curves right. The AI's entire speed profile
   * comes from this: cornering speed is `sqrt(mu * g / |curvature|)`.
   */
  curvature: number
  width: number
  banking: number
  kerbLeft: boolean
  kerbRight: boolean
  runoffLeft: RunoffKind
  runoffRight: RunoffKind
}

export interface TrackData {
  name: string
  samples: TrackSample[]
  /** Total centreline length, m. */
  length: number
  /** Distance between samples, m. Constant, which is what makes lookup O(1). */
  spacing: number
  /** Sector boundaries as distances along the lap. Always three sectors. */
  sectors: [number, number, number]
}

export interface TrackOptions {
  name: string
  /**
   * Target distance between samples, m. 2m is a good trade: fine enough that
   * curvature is smooth through a hairpin, coarse enough that Monza is a few
   * thousand samples rather than a hundred thousand.
   */
  spacing?: number
  /** Sector boundaries as fractions of a lap. Defaults to even thirds. */
  sectorFractions?: [number, number]
}

const DEFAULT_SPACING = 2

/**
 * Catmull-Rom interpolation between `p1` and `p2`, with `p0` and `p3` setting
 * the tangents. Uniform parameterisation — nodes should be spaced roughly
 * evenly, which the editor makes easy and which keeps the maths cheap.
 */
const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/** Index into a closed loop, wrapping both ways. */
const wrap = (index: number, count: number): number => ((index % count) + count) % count

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Sample a closed circuit into an evenly-spaced table.
 *
 * Two passes. The first walks the spline at fine resolution to measure its true
 * arc length, because a spline's parameter is not its distance — segments
 * through tight corners cover far less ground per unit of `t` than straights do,
 * and treating the two as the same makes lap distance lie. The second pass
 * resamples at even distance, which is what every downstream query assumes.
 */
export function buildTrack(nodes: TrackNode[], options: TrackOptions): TrackData {
  if (nodes.length < 4) {
    throw new Error(`A circuit needs at least 4 nodes to spline; "${options.name}" has ${nodes.length}`)
  }

  const spacing = options.spacing ?? DEFAULT_SPACING
  const count = nodes.length

  // --- pass 1: walk finely and record arc length --------------------------------
  const SUBDIVISIONS = 64
  const fine: Array<{ x: number; y: number; z: number; segment: number; t: number; distance: number }> = []
  let total = 0

  for (let segment = 0; segment < count; segment++) {
    const p0 = nodes[wrap(segment - 1, count)]!
    const p1 = nodes[segment]!
    const p2 = nodes[wrap(segment + 1, count)]!
    const p3 = nodes[wrap(segment + 2, count)]!

    for (let step = 0; step < SUBDIVISIONS; step++) {
      const t = step / SUBDIVISIONS
      const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t)
      const z = catmullRom(p0.z, p1.z, p2.z, p3.z, t)
      const y = catmullRom(p0.y ?? 0, p1.y ?? 0, p2.y ?? 0, p3.y ?? 0, t)

      const previous = fine[fine.length - 1]
      if (previous) total += Math.hypot(x - previous.x, z - previous.z)
      fine.push({ x, y, z, segment, t, distance: total })
    }
  }

  // Close the loop back onto the first point.
  const first = fine[0]!
  const last = fine[fine.length - 1]!
  total += Math.hypot(first.x - last.x, first.z - last.z)

  // --- pass 2: resample at even distance ----------------------------------------
  const sampleCount = Math.max(8, Math.round(total / spacing))
  const actualSpacing = total / sampleCount
  const samples: TrackSample[] = []

  let cursor = 0
  for (let i = 0; i < sampleCount; i++) {
    const distance = i * actualSpacing

    while (cursor < fine.length - 1 && fine[cursor + 1]!.distance < distance) cursor++

    const a = fine[cursor]!
    const b = fine[cursor + 1] ?? first
    const span = (b.distance || total) - a.distance
    const t = span > 0 ? (distance - a.distance) / span : 0

    const x = lerp(a.x, b.x, t)
    const y = lerp(a.y, b.y, t)
    const z = lerp(a.z, b.z, t)

    // Road properties come from the authored nodes, interpolated along the
    // segment the sample landed in. Flags are nearest-node rather than blended:
    // a kerb either is there or is not.
    const n1 = nodes[a.segment]!
    const n2 = nodes[wrap(a.segment + 1, count)]!
    const blend = a.t
    const nearest = blend < 0.5 ? n1 : n2

    samples.push({
      x,
      y,
      z,
      distance,
      heading: 0,
      curvature: 0,
      width: lerp(n1.width, n2.width, blend),
      banking: lerp(n1.banking ?? 0, n2.banking ?? 0, blend),
      kerbLeft: nearest.kerbLeft ?? false,
      kerbRight: nearest.kerbRight ?? false,
      runoffLeft: nearest.runoffLeft ?? 'grass',
      runoffRight: nearest.runoffRight ?? 'grass',
    })
  }

  computeHeadingAndCurvature(samples)

  const [s1, s2] = options.sectorFractions ?? [1 / 3, 2 / 3]

  return {
    name: options.name,
    samples,
    length: total,
    spacing: actualSpacing,
    sectors: [0, total * s1, total * s2],
  }
}

/**
 * Fill in tangent direction and curvature by central difference.
 *
 * Central rather than forward difference because a forward difference biases
 * every value half a sample downstream, which puts the AI's braking points
 * consistently late — a bug that presents as "the AI runs wide in slow corners"
 * and is thoroughly unpleasant to track down from that symptom.
 */
function computeHeadingAndCurvature(samples: TrackSample[]): void {
  const count = samples.length

  for (let i = 0; i < count; i++) {
    const previous = samples[wrap(i - 1, count)]!
    const current = samples[i]!
    const next = samples[wrap(i + 1, count)]!

    const dx = next.x - previous.x
    const dz = next.z - previous.z
    // Same convention as `Car.heading`: 0 faces +z, positive turns toward +x.
    current.heading = Math.atan2(dx, dz)

    // Menger curvature — the reciprocal of the radius of the circle through the
    // three points. Cheaper and better behaved on sampled data than
    // differentiating the spline twice, which amplifies sampling noise into
    // curvature spikes the AI would try to brake for.
    const ax = current.x - previous.x
    const az = current.z - previous.z
    const bx = next.x - current.x
    const bz = next.z - current.z

    const cross = ax * bz - az * bx
    const lengthA = Math.hypot(ax, az)
    const lengthB = Math.hypot(bx, bz)
    const lengthC = Math.hypot(next.x - previous.x, next.z - previous.z)
    const denominator = lengthA * lengthB * lengthC

    // Negated so that positive curvature means turning right, matching the sign
    // of yaw rate and steering input everywhere else in the codebase.
    current.curvature = denominator > 1e-9 ? (-2 * cross) / denominator : 0
  }
}

/** Point on the centreline at a distance around the lap, wrapping past the line. */
export function sampleAt(track: TrackData, distance: number): TrackSample {
  const count = track.samples.length
  const index = wrap(Math.round(distance / track.spacing), count)
  return track.samples[index]!
}

/** World position `lateral` metres to the right of the centreline at `distance`. */
export function pointAt(track: TrackData, distance: number, lateral: number, out: Vec2): Vec2 {
  const sample = sampleAt(track, distance)
  // Right of the direction of travel. With heading measured from +z toward +x,
  // the forward vector is (sin h, cos h) and its right normal is (cos h, -sin h).
  out.x = sample.x + Math.cos(sample.heading) * lateral
  out.z = sample.z - Math.sin(sample.heading) * lateral
  return out
}
