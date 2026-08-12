/**
 * Where the walls are, as far as the physics is concerned.
 *
 * The barriers you can see are built in `render/trackside.ts` and this file
 * never looks at them. Both measure from `layout.barrierLateral`, which is the
 * whole reason that constant moved into `track/` — a wall drawn in one place and
 * solved in another is a wall you hit two metres early, and nothing about that
 * failure looks like a bug in either file.
 *
 * The reduction is deliberate: this hands `physics/` a single plane — a depth
 * and an outward normal — and nothing else. The barrier is really a ring that
 * curves with the circuit, but across the ~2m a car can penetrate in one 16ms
 * step the local tangent is indistinguishable from it, and a plane is something
 * the collision solver can resolve in closed form against a flat test wall in
 * Node.
 *
 * Note there is no gap anywhere. Real circuits have pit entries and marshal
 * gates; Monza as authored does not, and inventing openings the renderer does
 * not draw would give the car somewhere to escape that the player cannot see.
 */

import type { WallContact, WallQuery } from '../core/world'
import { barrierLateral } from './layout'
import { createTrackPosition, locate, type TrackIndex } from './query'

/**
 * Build the barrier query for a circuit.
 *
 * The returned function is called from inside the physics step, once per car per
 * step, so it allocates nothing: the `TrackPosition` it needs is captured in the
 * closure and overwritten, and `out` belongs to the caller.
 */
export function createWallQuery(index: TrackIndex): WallQuery {
  const where = createTrackPosition()

  return (x: number, z: number, radius: number, out: WallContact): boolean => {
    locate(index, x, z, where)

    const limit = barrierLateral(where.width)
    const depth = Math.abs(where.lateralOffset) + radius - limit
    if (depth <= 0) return false

    // Which wall. Zero counts as the right-hand one, which is arbitrary and
    // unreachable — a car exactly on the centreline is not 15m past a barrier.
    const side = where.lateralOffset < 0 ? -1 : 1

    // Right of the road is (cos h, -sin h), matching `rightOf` in the mesh
    // builders. The outward normal points back across the track, so it is the
    // inward one: negate the side.
    out.depth = depth
    out.normalX = -side * Math.cos(where.heading)
    out.normalZ = side * Math.sin(where.heading)
    return true
  }
}
