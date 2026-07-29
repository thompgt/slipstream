/**
 * Track pipeline. Implemented in M2.
 *
 * A circuit is authored as a centreline spline with per-node width and banking,
 * then extruded into road, kerb, and run-off geometry at load time. Investing here
 * is what makes circuits 2 and 3 cost ~3 hours each instead of ~15 (PLAN.md).
 *
 * `query.ts` will expose the distance-along-track lookup that lap counting,
 * standings, AI, respawn, and rubber-banding all depend on.
 */

export {}
