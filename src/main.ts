/**
 * Composition root.
 *
 * The only file that knows the full module graph. It wires modules together and
 * owns nothing else — every module below depends strictly downward
 * (ARCHITECTURE.md).
 */

import { inputFeel } from './core/feel'
import { createLoop } from './core/loop'
import { createWorld, createCar } from './core/world'
import { createRaceDirector } from './game/race'
import { createInputSampler } from './input'
import { resetCar, stepCar } from './physics/car'
import { carSetup } from './physics/carSetup'
import { peakSlipAngle } from './physics/tyre'
import { createWallQuery } from './track/barriers'
import { monza } from './track/circuits/monza'
import { buildTrackIndex } from './track/query'
import { cameraSetup } from './render/cameraSetup'
import { createRenderer } from './render/renderer'
import { createDebugOverlay } from './ui/debugOverlay'
import { createTuningPanel, type TuningPanel } from './ui/tuningPanel'

const debugElement = document.getElementById('debug')
if (!debugElement) throw new Error('#debug element missing from index.html')

const world = createWorld()
const player = createCar(0, true)
world.cars.push(player)

// Built once, at load. The circuit is handed to the two systems that need it
// rather than parked on `World`: `core/` imports nothing, so it cannot name a
// type that lives in `track/`, and passing it here costs one line while keeping
// the module table honest. See ARCHITECTURE.md.
const track = monza()
const trackIndex = buildTrackIndex(track)
const race = createRaceDirector(trackIndex)
// The barriers stop being scenery. Handed to the physics rather than read off
// the car, because a wall cannot tolerate a step of lag — see `stepCar`.
const walls = createWallQuery(trackIndex)

const input = createInputSampler(window)
const renderer = createRenderer(document.body, { track })
const overlay = createDebugOverlay(debugElement)

const degrees = (radians: number): string => `${((radians * 180) / Math.PI).toFixed(1)}°`

/** m:ss.mmm, or a dash before there is anything to show. */
const lapTime = (ms: number | null): string => {
  if (ms === null) return '—'
  const minutes = Math.floor(ms / 60_000)
  const seconds = (ms % 60_000) / 1000
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`
}

const loop = createLoop({
  step(dt) {
    const speed = Math.hypot(player.velocity.x, player.velocity.z)
    player.input = input.sample(dt / 1000, speed)
    stepCar(player, dt, carSetup, walls)
    world.time += dt
    // After the car has moved, and before the next step reads the surface it
    // ended up on: laps, standings, and what is under the wheels.
    race.update(world)
  },

  render(alpha) {
    renderer.draw(world, alpha)
  },

  onFrame(stats) {
    const t = player.telemetry
    // Slip shown as a fraction of the tyre's peak: 1.0 is exactly at the limit,
    // above 1.0 the axle is past the peak and sliding. Far easier to read at a
    // glance mid-corner than raw degrees.
    const peak = peakSlipAngle(carSetup.tyres)

    overlay.set('speed', `${(t.speed * 3.6).toFixed(0)} kph`)
    overlay.set('gear', `${t.gear}   ${t.rpm.toFixed(0)} rpm`)
    overlay.set('slip F/R', `${degrees(t.slipAngleFront)} / ${degrees(t.slipAngleRear)}`)
    overlay.set(
      'limit F/R',
      `${(Math.abs(t.slipAngleFront) / peak).toFixed(2)} / ${(
        Math.abs(t.slipAngleRear) / peak
      ).toFixed(2)}`,
    )
    overlay.set('grip F/R', `${t.gripUsageFront.toFixed(2)} / ${t.gripUsageRear.toFixed(2)}`)
    overlay.set(
      'load F/R',
      `${(t.loadFront / 1000).toFixed(1)} / ${(t.loadRear / 1000).toFixed(1)} kN`,
    )
    overlay.set('g long/lat', `${t.longitudinalG.toFixed(2)} / ${t.lateralG.toFixed(2)}`)
    overlay.set('downforce', `${(t.downforce / 1000).toFixed(1)} kN`)
    overlay.set('input', input.usingGamepad ? 'gamepad' : 'keyboard')
    overlay.set('camera', `${renderer.view().label}   (C)`)

    const timing = race.timing(player.id)
    const where = race.positionOf(player.id)
    overlay.set('lap', `${player.lap}   ${lapTime(timing?.current ?? null)}`)
    overlay.set(
      'last / best',
      `${lapTime(timing?.last ?? null)} / ${lapTime(timing?.best ?? null)}`,
    )
    if (where) {
      overlay.set('track', `${(where.distanceAlong / 1000).toFixed(2)} km   ${where.surface}`)
      // Signed, because which side you ran wide on is the useful half of it.
      overlay.set('offset', `${where.lateralOffset.toFixed(1)} m of ${where.width.toFixed(1)}`)
    }

    overlay.update(stats)
  },
})

window.addEventListener('resize', renderer.resize)

/**
 * Back to the start line, with no lap credited for the trip.
 *
 * `resetCar` clears the car's own lap and distance; the director has to be told
 * separately, or the reset reads as having driven backwards from wherever the
 * car was to the line — which on the far side of the circuit is a lap taken off
 * you for pressing R.
 */
const restart = (): void => {
  resetCar(player)
  race.restart(player, world)
}

/**
 * The tuning panel is a dev chunk, imported on the first `T` rather than at
 * startup.
 *
 * STACK.md counts `lil-gui` as a runtime dependency "a player who never presses
 * T never downloads" — which was only true of the `import()` inside the panel,
 * not of the call site. Constructing it eagerly requested the chunk on every
 * page load and put the whole GUI on screen before anyone asked for it, so `T`
 * hid the panel rather than opening it, as the README says it should.
 */
let panel: Promise<TuningPanel> | null = null
const toggleTuningPanel = (): void => {
  panel ??= createTuningPanel({ setup: carSetup, feel: inputFeel, camera: cameraSetup }, restart)
  void panel.then((p) => p.toggle())
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return
  if (e.code === 'Backquote') overlay.toggle()
  if (e.code === 'KeyR') restart()
  if (e.code === 'KeyT') toggleTuningPanel()
  if (e.code === 'KeyC') renderer.cycleView()
})

// A known pose before the first frame is drawn. Deliberately no priming
// `stepCar` here: the loop owns the clock, and a step outside it advanced the
// car without advancing `world.time` — 16ms of simulation the game's only clock
// never saw, which is precisely the drift the fixed timestep exists to prevent.
restart()

loop.start()
