/**
 * The cross-section of the road, in metres out from the centreline.
 *
 * These numbers were living in two places at once. `render/trackMesh.ts` painted
 * the kerb 1.2m wide and `track/query.ts` declared, separately, that a car was
 * on a kerb for 1.2m past the white line. Two constants that must agree, with
 * nothing making them, and the failure is silent both ways: change the paint and
 * the grip boundary stays put, change the grip and the kerb you can see stops
 * being the kerb you can feel.
 *
 * They belong to `track/` rather than `render/` because they are dimensions of
 * the circuit, not of the picture. The road mesh, the surface query, the
 * trackside furniture and the barrier collision now all measure from here, which
 * is what makes "the wall is where it looks like it is" true by construction
 * rather than by two people remembering the same number.
 *
 * Real values, per CLAUDE.md: run-off at a modern circuit is tens of metres and
 * the barrier sits a little back from the edge of it, not against the paint.
 */

/** Width of the kerb strip outside the white line, m. */
export const KERB_WIDTH = 1.2

/** How far the graded run-off extends beyond the kerb, m. */
export const RUNOFF_WIDTH = 14

/**
 * Distance from the outer edge of the run-off to the face of the barrier, m.
 *
 * Small on purpose. Everything beyond the run-off is dressing, and putting the
 * wall a long way back from it would mean a car that has already lost the corner
 * gets several more seconds to do nothing before anything happens to it.
 */
const BARRIER_STANDOFF = 1.5

/** Centreline to the face of the barrier, at a point where the road is `width` wide. */
export const BARRIER_OFFSET = KERB_WIDTH + RUNOFF_WIDTH + BARRIER_STANDOFF

/**
 * How far from the centreline the barrier face sits where the road's half-width
 * is `roadHalfWidth`.
 *
 * Unsigned — it is the same on both sides, and callers apply their own sign.
 * Taking the width rather than a sample lets the collision solver use the number
 * the position query already handed it, instead of going back to the table.
 */
export function barrierLateral(roadHalfWidth: number): number {
  return roadHalfWidth + BARRIER_OFFSET
}
