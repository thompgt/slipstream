/**
 * Three.js renderer.
 *
 * Reads world state and draws it. Never writes to the world — if rendering could
 * mutate simulation state, the sim would depend on framerate, which is exactly
 * what the fixed timestep exists to prevent.
 *
 * M0 draws a placeholder box on a ground plane to prove the pipeline. The real
 * car mesh and chase camera land in M1.
 */

import * as THREE from 'three'
import { lerp } from '../core/math'
import type { World } from '../core/world'

export interface Renderer {
  /** @param alpha 0..1 interpolation between the previous and current physics state. */
  draw: (world: World, alpha: number) => void
  resize: () => void
  dispose: () => void
}

export function createRenderer(canvasParent: HTMLElement): Renderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  // Cap at 2: retina laptops otherwise render 4x the pixels for little gain, and
  // Safari's WebGL driver is where the 60fps budget is tightest.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  canvasParent.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0d10)
  scene.fog = new THREE.Fog(0x0b0d10, 60, 220)

  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500)
  camera.position.set(0, 6, -11)
  camera.lookAt(0, 1, 0)

  scene.add(new THREE.HemisphereLight(0x9fc4e8, 0x1b2029, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(30, 50, 20)
  scene.add(sun)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x1c2129, roughness: 0.95 }),
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  const grid = new THREE.GridHelper(400, 100, 0x35414f, 0x252d38)
  grid.position.y = 0.01
  scene.add(grid)

  // Placeholder for the player car — replaced by a real mesh in M1.
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1, 4),
    new THREE.MeshStandardMaterial({ color: 0xe23636, roughness: 0.4, metalness: 0.1 }),
  )
  box.position.y = 0.5
  scene.add(box)

  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }

  return {
    draw(world, alpha) {
      const car = world.cars[0]
      if (car) {
        // Interpolate between the last two physics states rather than snapping to
        // the latest — steps and refreshes drift, and snapping reads as stutter.
        box.position.x = lerp(car.previousPosition.x, car.position.x, alpha)
        box.position.z = lerp(car.previousPosition.z, car.position.z, alpha)
      }
      renderer.render(scene, camera)
    },
    resize,
    dispose() {
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
