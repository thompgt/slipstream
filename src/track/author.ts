/**
 * Authoring circuits as straights and arcs rather than raw coordinates.
 *
 * PLAN.md warns that hand-editing spline control points is miserable and will
 * silently eat evenings. It is right, and the reason is that coordinates are the
 * wrong unit: nobody knows a corner as "(412, -180)", they know it as "a 90
 * degree right at about 80 metres radius, onto a short straight". This module
 * lets a circuit be written the way it is remembered, and computes the points.
 *
 * It also makes circuits *editable*. Lengthen a straight in a coordinate list
 * and every subsequent point is wrong; lengthen it here and the rest of the lap
 * follows along.
 *
 * The catch is closure: a lap has to come back to where it started, in both
 * position and heading. Heading closes when the turns sum to a full circle,
 * which is easy to check by eye. Position does not close for free, so
 * `closureError` reports the gap and circuits assert on it in tests — a metre or
 * two is invisible once the spline bridges it, and fifty metres is a circuit
 * with a kink in the main straight.
 */

import type { RunoffKind, TrackNode } from './spline'

/** Road properties that persist until changed, so a circuit file stays readable. */
export interface RoadStyle {
  /** Half-width of the racing surface, m. */
  width?: number
  banking?: number
  kerbLeft?: boolean
  kerbRight?: boolean
  runoffLeft?: RunoffKind
  runoffRight?: RunoffKind
}

export interface PathBuilder {
  /** Continue straight ahead for `length` metres. */
  straight: (length: number, style?: RoadStyle) => PathBuilder
  /**
   * Turn through `degrees` at a constant radius. Positive turns right, matching
   * the curvature and yaw sign convention used everywhere else.
   */
  arc: (radius: number, degrees: number, style?: RoadStyle & { name?: string }) => PathBuilder
  /** Change the road style without moving. */
  style: (style: RoadStyle) => PathBuilder
  /** Distance, m, between the last node and the first. */
  closureError: () => number
  /** Total turn, degrees. Should be +/-360 for a lap that closes. */
  totalTurn: () => number
  nodes: () => TrackNode[]
}

export interface PathStart {
  x?: number
  z?: number
  /** Initial heading, radians, in the `Car.heading` convention: 0 faces +z. */
  heading?: number
  style?: RoadStyle
}

/**
 * Roughly how far apart to place control points, m.
 *
 * Control points are not samples — the spline is resampled far more finely at
 * load. These only need to be dense enough to describe the shape, and spacing
 * them evenly keeps the uniform Catmull-Rom parameterisation well behaved.
 */
const NODE_SPACING = 25

export function path(start: PathStart = {}): PathBuilder {
  let x = start.x ?? 0
  let z = start.z ?? 0
  let heading = start.heading ?? 0
  let turn = 0

  let current: Required<RoadStyle> = {
    width: 6,
    banking: 0,
    kerbLeft: false,
    kerbRight: false,
    runoffLeft: 'grass',
    runoffRight: 'grass',
    ...start.style,
  }

  const nodes: TrackNode[] = []

  const push = (name?: string): void => {
    nodes.push({
      x,
      z,
      width: current.width,
      banking: current.banking,
      kerbLeft: current.kerbLeft,
      kerbRight: current.kerbRight,
      runoffLeft: current.runoffLeft,
      runoffRight: current.runoffRight,
      ...(name === undefined ? {} : { name }),
    })
  }

  const apply = (style?: RoadStyle): void => {
    if (style) current = { ...current, ...style }
  }

  push()

  const builder: PathBuilder = {
    straight(length, style) {
      apply(style)
      const steps = Math.max(1, Math.round(length / NODE_SPACING))
      const step = length / steps
      for (let i = 0; i < steps; i++) {
        x += Math.sin(heading) * step
        z += Math.cos(heading) * step
        push()
      }
      return builder
    },

    arc(radius, degrees, style) {
      const { name, ...road } = style ?? {}
      apply(road)

      const radians = (degrees * Math.PI) / 180
      turn += degrees

      const arcLength = Math.abs(radians) * radius
      const steps = Math.max(2, Math.round(arcLength / NODE_SPACING))
      const stepAngle = radians / steps
      const stepLength = arcLength / steps

      for (let i = 0; i < steps; i++) {
        // Turn half a step, move, then turn the other half. Rotating the whole
        // step before moving would consistently cut the corner and shorten the
        // arc; splitting it is a midpoint rule and lands on the true circle.
        heading += stepAngle / 2
        x += Math.sin(heading) * stepLength
        z += Math.cos(heading) * stepLength
        heading += stepAngle / 2
        push(i === 0 ? name : undefined)
      }
      return builder
    },

    style(next) {
      apply(next)
      return builder
    },

    closureError() {
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (!first || !last) return 0
      return Math.hypot(last.x - first.x, last.z - first.z)
    },

    totalTurn: () => turn,

    nodes() {
      // The final node sits on top of the first once the lap closes; keeping
      // both would give the spline a zero-length segment and a curvature spike.
      const closed = [...nodes]
      const first = closed[0]
      const last = closed[closed.length - 1]
      if (first && last && Math.hypot(last.x - first.x, last.z - first.z) < NODE_SPACING * 0.5) {
        closed.pop()
      }
      return closed
    },
  }

  return builder
}
