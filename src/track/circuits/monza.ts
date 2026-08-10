/**
 * Autodromo Nazionale di Monza — the Temple of Speed.
 *
 * Character over survey accuracy, which is the stated brief. What has to be true
 * for Monza to feel like Monza:
 *
 *   - Two enormous straights, so top speed and drag matter more than anywhere
 *     else and slipstreaming is the whole race.
 *   - Two brutal stop-and-go chicanes bracketing them, so braking stability and
 *     kerb-riding decide lap time.
 *   - The Lesmos, quick and blind and unforgiving, where the car has to be
 *     settled before turn-in.
 *   - Parabolica, a long constant-radius right where a mistake costs you the
 *     entire main straight.
 *
 * Written as straights and arcs rather than coordinates, so the layout can be
 * adjusted by the numbers a driver would actually quote. See `author.ts`.
 *
 * Lap length comes out near the real 5.79km. The gap between the last node and
 * the first is asserted in tests: the spline bridges a small one invisibly, and
 * a large one is a kink in the main straight.
 */

import { path } from '../author'
import { buildTrack, type TrackData } from '../spline'
import type { PathBuilder } from '../author'

/**
 * Straight lengths, m.
 *
 * `SERRAGLIO` and `TO_PARABOLICA` are not free choices: with every corner angle
 * fixed, closure of the lap is two linear equations, and these two straights are
 * the pair that solves them while staying the right shape. Change a corner and
 * these have to be re-solved — the test that asserts closure is what tells you.
 */
const MAIN_STRAIGHT = 1000
const SERRAGLIO = 936
const TO_PARABOLICA = 1296
const PIT_STRAIGHT = 340

/** The layout on its own, so tests can assert it closes. */
export function monzaLayout(): PathBuilder {
  return path({
    // Start/finish, pointing up the main straight.
    heading: 0,
    style: { width: 6, runoffLeft: 'grass', runoffRight: 'grass' },
  })
    // --- main straight ---------------------------------------------------------
    .straight(MAIN_STRAIGHT)

    // --- Variante del Rettifilo: first chicane, right then left ----------------
    // Approached at over 340kph and taken at barely 80. The kerbs here are
    // savage and everyone uses them anyway. It nets left, which is why the run
    // to Curva Grande points away from the pit straight.
    .arc(30, 55, { name: 'Rettifilo', kerbLeft: true, kerbRight: true, runoffRight: 'tarmac' })
    .straight(30)
    .arc(30, -75, { kerbLeft: true, kerbRight: true })
    .straight(140, { kerbLeft: false, kerbRight: false, runoffRight: 'grass' })

    // --- Curva Grande ----------------------------------------------------------
    // Flat out, and long enough that the tyres are working hard by the exit.
    .arc(420, 95, { name: 'Curva Grande', width: 6.5, runoffLeft: 'gravel' })
    .straight(330, { runoffLeft: 'grass' })

    // --- Variante della Roggia: left-right ------------------------------------
    .arc(34, -55, { name: 'Roggia', kerbLeft: true, kerbRight: true })
    .straight(40)
    .arc(34, 25, { kerbLeft: true, kerbRight: true })
    .straight(190, { kerbLeft: false, kerbRight: false })

    // --- the Lesmos ------------------------------------------------------------
    .arc(90, 90, { name: 'Lesmo 1', kerbRight: true, runoffLeft: 'gravel' })
    .straight(120, { kerbRight: false, runoffLeft: 'grass' })
    .arc(100, 85, { name: 'Lesmo 2', kerbRight: true, runoffLeft: 'gravel' })

    // --- Serraglio, under the old banking, onto the back straight -------------
    .straight(SERRAGLIO, { kerbRight: false, runoffLeft: 'grass' })

    // --- Variante Ascari: left, right, left ------------------------------------
    // The best corner on the lap. Committing to the first part before you can
    // see the exit is what separates a good lap from a tidy one.
    .arc(48, -55, { name: 'Ascari', kerbLeft: true, kerbRight: true })
    .arc(52, 95, { kerbLeft: true, kerbRight: true })
    .arc(48, -80, { kerbLeft: true, kerbRight: true })

    // --- the run down to Parabolica -------------------------------------------
    .straight(TO_PARABOLICA, { kerbLeft: false, kerbRight: false })

    // --- Parabolica ------------------------------------------------------------
    // Long, constant, and it feeds the main straight, so a tenth lost here is
    // paid for all the way to the first chicane.
    .arc(155, 180, { name: 'Parabolica', width: 6.5, kerbRight: true, runoffLeft: 'gravel' })
    .straight(PIT_STRAIGHT, { kerbRight: false, runoffLeft: 'grass' })
}

export function monza(): TrackData {
  return buildTrack(monzaLayout().nodes(), {
    name: 'Monza',
    // Roughly matching the real timing loops: sector 1 ends after the Roggia,
    // sector 2 after Ascari.
    sectorFractions: [0.36, 0.72],
    // The real lap. The layout above is authored in the proportions the corners
    // are remembered in and scaled to fit, rather than fudged to length.
    targetLength: 5793,
  })
}
