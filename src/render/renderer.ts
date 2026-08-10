/**
 * Three.js renderer.
 *
 * Reads world state and draws it. Never writes to the world — if rendering could
 * mutate simulation state, the sim would depend on framerate, which is exactly
 * what the fixed timestep exists to prevent. The camera state below is the one
 * exception, and it is render-local: nothing in the sim can observe it.
 *
 * There is no track yet, so the ground is an infinite-feeling grid: a finite
 * plane that snaps along with the car in whole grid squares. Reference lines
 * matter more than they sound like they should — on a featureless plane you
 * cannot see yaw, and a car that is sliding beautifully looks like it is
 * driving straight.
 */

import * as THREE from 'three'
import { lerp, lerpAngle } from '../core/math'
import type { World } from '../core/world'
import { carSetup, type CarSetup } from '../physics/carSetup'

export interface Renderer {
  /** @param alpha 0..1 interpolation between the previous and current physics state. */
  draw: (world: World, alpha: number) => void
  resize: () => void
  dispose: () => void
}

const GRID_SIZE = 400
const GRID_DIVISIONS = 80
const GRID_SPACING = GRID_SIZE / GRID_DIVISIONS

export function createRenderer(canvasParent: HTMLElement, setup: CarSetup = carSetup): Renderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  // Cap at 2: retina laptops otherwise render 4x the pixels for little gain, and
  // Safari's WebGL driver is where the 60fps budget is tightest.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  canvasParent.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0d10)
  scene.fog = new THREE.Fog(0x0b0d10, 70, 240)

  const camera = new THREE.PerspectiveCamera(
    setup.camera.baseFov,
    window.innerWidth / window.innerHeight,
    0.1,
    600,
  )

  scene.add(new THREE.HemisphereLight(0x9fc4e8, 0x1b2029, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(30, 50, 20)
  scene.add(sun)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_SIZE * 3, GRID_SIZE * 3),
    new THREE.MeshStandardMaterial({ color: 0x1c2129, roughness: 0.95 }),
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, 0x35414f, 0x252d38)
  grid.position.y = 0.01
  scene.add(grid)

  const car = buildCar()
  scene.add(car)

  // Camera state, render-side only. Starts behind the car's spawn pose.
  const cameraTarget = new THREE.Vector3()
  const lookTarget = new THREE.Vector3()
  let cameraInitialised = false
  let lastFrameTime = performance.now()

  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }

  return {
    draw(world, alpha) {
      const player = world.cars[0]
      if (player) {
        // Interpolate between the last two physics states rather than snapping to
        // the latest — steps and refreshes drift, and snapping reads as stutter.
        const x = lerp(player.previousPosition.x, player.position.x, alpha)
        const z = lerp(player.previousPosition.z, player.position.z, alpha)
        const heading = lerpAngle(player.previousHeading, player.heading, alpha)

        car.position.set(x, 0, z)
        // A y-rotation of `heading` maps the mesh's local +z onto (sin h, cos h),
        // which is exactly the forward vector the physics uses.
        car.rotation.y = heading

        // Snap the grid in whole squares so the reference lines never appear to
        // slide under the car, which would read as the car standing still.
        grid.position.x = Math.round(x / GRID_SPACING) * GRID_SPACING
        grid.position.z = Math.round(z / GRID_SPACING) * GRID_SPACING
        ground.position.x = grid.position.x
        ground.position.z = grid.position.z

        const cam = setup.camera
        const forwardX = Math.sin(heading)
        const forwardZ = Math.cos(heading)

        cameraTarget.set(
          x - forwardX * cam.distance,
          cam.height,
          z - forwardZ * cam.distance,
        )
        lookTarget.set(x + forwardX * cam.lookAhead, 0.8, z + forwardZ * cam.lookAhead)

        const now = performance.now()
        // Render-side dt, clamped. This smoothing is cosmetic and must not
        // depend on the physics clock — the two run at different rates.
        const dt = Math.min((now - lastFrameTime) / 1000, 0.1)
        lastFrameTime = now

        if (!cameraInitialised) {
          camera.position.copy(cameraTarget)
          cameraInitialised = true
        } else {
          // Exponential smoothing, framerate-independent. The lag is the point:
          // a rigidly-attached camera reads as "no speed" and gets misdiagnosed
          // as a physics problem (PLAN.md, M1).
          const t = 1 - Math.exp(-cam.stiffness * dt)
          camera.position.lerp(cameraTarget, t)
        }
        camera.lookAt(lookTarget)

        // FOV widens with speed. Cheap, and it does more for the sensation of
        // pace than any amount of extra geometry.
        const speed = Math.hypot(player.velocity.x, player.velocity.z)
        const fov = cam.baseFov + cam.fovGain * Math.min(speed / cam.fovSpeed, 1)
        if (Math.abs(camera.fov - fov) > 0.01) {
          camera.fov = fov
          camera.updateProjectionMatrix()
        }
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

/**
 * A crude open-wheeler silhouette. Five boxes, one draw call each — well inside
 * the 150-call budget, and enough shape to read yaw at a glance, which is all a
 * placeholder needs to do.
 */
function buildCar(): THREE.Group {
  const group = new THREE.Group()

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xe23636,
    roughness: 0.35,
    metalness: 0.15,
  })
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.8 })

  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 3.6), bodyMaterial)
  tub.position.y = 0.45
  group.add(tub)

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 1.6), bodyMaterial)
  nose.position.set(0, 0.35, 2.4)
  group.add(nose)

  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.5), darkMaterial)
  frontWing.position.set(0, 0.18, 3.05)
  group.add(frontWing)

  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.25), darkMaterial)
  rearWing.position.set(0, 1.0, -1.9)
  group.add(rearWing)

  const wheelGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.38, 14)
  wheelGeometry.rotateZ(Math.PI / 2)
  for (const [x, z] of [
    [-0.85, 1.6],
    [0.85, 1.6],
    [-0.85, -1.5],
    [0.85, -1.5],
  ] as const) {
    const wheel = new THREE.Mesh(wheelGeometry, darkMaterial)
    wheel.position.set(x, 0.36, z)
    group.add(wheel)
  }

  return group
}
