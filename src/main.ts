/**
 * Composition root.
 *
 * The only file that knows the full module graph. It wires modules together and
 * owns nothing else — every module below depends strictly downward
 * (ARCHITECTURE.md).
 */

import { inputFeel } from './core/feel'
import { createLoop, FIXED_DT } from './core/loop'
import { createWorld, createCar } from './core/world'
import { createInputSampler } from './input'
import { resetCar, stepCar } from './physics/car'
import { carSetup } from './physics/carSetup'
import { peakSlipAngle } from './physics/tyre'
import { cameraSetup } from './render/cameraSetup'
import { createRenderer } from './render/renderer'
import { createDebugOverlay } from './ui/debugOverlay'
import { createTuningPanel } from './ui/tuningPanel'

const debugElement = document.getElementById('debug')
if (!debugElement) throw new Error('#debug element missing from index.html')

const world = createWorld()
const player = createCar(0, true)
world.cars.push(player)

const input = createInputSampler(window)
const renderer = createRenderer(document.body)
const overlay = createDebugOverlay(debugElement)

const degrees = (radians: number): string => `${((radians * 180) / Math.PI).toFixed(1)}°`

const loop = createLoop({
  step(dt) {
    const speed = Math.hypot(player.velocity.x, player.velocity.z)
    player.input = input.sample(dt / 1000, speed)
    stepCar(player, dt, carSetup)
    world.time += dt
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
    overlay.set('load F/R', `${(t.loadFront / 1000).toFixed(1)} / ${(t.loadRear / 1000).toFixed(1)} kN`)
    overlay.set('g long/lat', `${t.longitudinalG.toFixed(2)} / ${t.lateralG.toFixed(2)}`)
    overlay.set('downforce', `${(t.downforce / 1000).toFixed(1)} kN`)
    overlay.set('input', input.usingGamepad ? 'gamepad' : 'keyboard')

    overlay.update(stats)
  },
})

window.addEventListener('resize', renderer.resize)

// The panel is a lazily-loaded dev chunk; the game runs whether or not it arrives.
const panel = createTuningPanel({ setup: carSetup, feel: inputFeel, camera: cameraSetup }, () =>
  resetCar(player),
)

window.addEventListener('keydown', (e) => {
  if (e.repeat) return
  if (e.code === 'Backquote') overlay.toggle()
  if (e.code === 'KeyR') resetCar(player)
  if (e.code === 'KeyT') void panel.then((p) => p.toggle())
})

// Physics owns the clock, so a car spawned mid-frame still starts from a known
// pose rather than whatever the previous step left behind.
resetCar(player)
stepCar(player, FIXED_DT, carSetup)

loop.start()
