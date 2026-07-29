/**
 * Race rules and state machine. Implemented in M3 and M5.
 *
 * Laps, sector splits, grid, countdown, flags, results.
 *
 * Position is `(lap * trackLength) + distanceAlongTrack`, sorted descending, with
 * care at the start/finish wraparound — get that wrong and standings flicker every
 * lap. All timing reads `world.time` (accumulated simulation time), never
 * `performance.now()`: the loop can silently drop wall-clock time after a tab
 * switch, and lap times must not notice.
 */

export {}
