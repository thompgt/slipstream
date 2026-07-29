/**
 * Composition root.
 *
 * The only file that knows the full module graph. It wires modules together and
 * owns nothing else — every module below depends strictly downward
 * (ARCHITECTURE.md).
 */

import { createLoop } from './core/loop'
import { createWorld, createCar } from './core/world'
import { createInputSampler } from './input'
import { stepCar } from './physics/car'
import { createRenderer } from './render/renderer'
import { createDebugOverlay } from './ui/debugOverlay'

const debugElement = document.getElementById('debug')
if (!debugElement) throw new Error('#debug element missing from index.html')

const world = createWorld()
world.cars.push(createCar(0, true))

const input = createInputSampler()
const renderer = createRenderer(document.body)
const overlay = createDebugOverlay(debugElement)

const loop = createLoop({
  step(dt) {
    const player = world.cars[0]
    if (player) {
      player.input = input.sample()
      stepCar(player, dt)
    }
    world.time += dt
  },

  render(alpha) {
    renderer.draw(world, alpha)
  },

  onFrame(stats) {
    const player = world.cars[0]
    if (player) {
      const speed = Math.hypot(player.velocity.x, player.velocity.z)
      overlay.set('speed', `${(speed * 3.6).toFixed(0)} kph`)
      overlay.set('heading', `${((player.heading * 180) / Math.PI).toFixed(0)}°`)
      overlay.set('steer', player.input.steer.toFixed(2))
    }
    overlay.update(stats)
  },
})

window.addEventListener('resize', renderer.resize)
window.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') overlay.toggle()
})

loop.start()
