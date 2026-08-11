/**
 * Three.js renderer.
 *
 * Reads world state and draws it. Never writes to the world — if rendering could
 * mutate simulation state, the sim would depend on framerate, which is exactly
 * what the fixed timestep exists to prevent. The camera state below is the one
 * exception, and it is render-local: nothing in the sim can observe it.
 *
 * Given a track, the ground is the circuit. Without one it falls back to an
 * infinite-feeling grid: a finite plane that snaps along with the car in whole
 * grid squares. That fallback is not dead code — it is what `npm run dev` shows
 * while a circuit is being changed, and reference lines matter more than they
 * sound like they should. On a featureless plane you cannot see yaw, and a car
 * that is sliding beautifully looks like it is driving straight.
 */

import * as THREE from 'three'
import { lerp, lerpAngle } from '../core/math'
import type { World } from '../core/world'
import type { TrackData } from '../track/spline'
import { buildCarMesh, CAR } from './carMesh'
import { cameraSetup, type CameraSetup } from './cameraSetup'
import { approach, bodyAttitude, carMotion, wheelAngles } from './carMotion'
import {
  cameraPose,
  cameraUp,
  fovFor,
  nextView,
  rigFor,
  shakeAmount,
  shakeOffset,
  type CameraRig,
  type CameraView,
} from './cameras'
import { buildSky, sunDirection, SKY, SUN } from './sky'
import { buildTrackMesh, trackBounds } from './trackMesh'
import { buildTrackside } from './trackside'

export interface Renderer {
  /** @param alpha 0..1 interpolation between the previous and current physics state. */
  draw: (world: World, alpha: number) => void
  resize: () => void
  /** Switch to the next broadcast camera and report which one it is. */
  cycleView: () => CameraView
  /** Which camera is live, for the overlay. */
  view: () => CameraRig
  dispose: () => void
}

export interface RendererOptions {
  /** The circuit to draw. Without one, the grid fallback is used. */
  track?: TrackData
  tuning?: CameraSetup
}

const GRID_SIZE = 400
const GRID_DIVISIONS = 80
const GRID_SPACING = GRID_SIZE / GRID_DIVISIONS

/**
 * Half-width of the sun's shadow box, m.
 *
 * The one shadow map covers a square this size centred a little ahead of the
 * car, and nothing outside it casts. 45m is about two car lengths behind and
 * four ahead at the resolution below, which is everything the chase camera can
 * actually see a shadow on. Widening it to cover the circuit would spread 2048
 * texels over five kilometres and the car's own shadow would be a smudge.
 */
const SHADOW_EXTENT = 45
const SHADOW_MAP_SIZE = 2048

export function createRenderer(canvasParent: HTMLElement, options: RendererOptions = {}): Renderer {
  const { track } = options
  const tuning = options.tuning ?? cameraSetup

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  // Cap at 2: retina laptops otherwise render 4x the pixels for little gain, and
  // Safari's WebGL driver is where the 60fps budget is tightest.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  // Filmic response instead of clipping to white. Sunlit carbon and a shadowed
  // sidepod differ by a lot more than the 0..1 a linear pipeline can hold, and
  // clamping that range is most of what makes untonemapped WebGL look like a
  // toy — highlights go flat white and the midtones all crowd together.
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.95
  // One map, not a cascade: the perf budget in CLAUDE.md rules cascades out, and
  // a single box that follows the car buys the thing that actually matters —
  // the car sitting *on* the road rather than hovering over it.
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  canvasParent.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  // Fog is the horizon colour so the far end of the circuit dissolves into the
  // sky rather than ending against it. Held well back: braking references you
  // cannot see until 240m out are references you brake too late for.
  scene.fog = new THREE.Fog(SKY.horizon, track ? 400 : 120, track ? 1500 : 240)

  // The far plane has to sit beyond the fog, or the circuit is clipped away
  // while still visible — a hard edge sweeping down the main straight.
  const camera = new THREE.PerspectiveCamera(
    tuning.baseFov,
    window.innerWidth / window.innerHeight,
    0.1,
    track ? 2600 : 600,
  )

  const sky = buildSky()
  scene.add(sky)

  // Sky bounce and ground bounce. Low, because it is fill: at the intensity the
  // old rig used it washed out the sun entirely and every surface faced the
  // same way, which is why nothing had a lit side and a dark side.
  scene.add(new THREE.HemisphereLight(SKY.horizon, 0x4a4232, SUN.ambientIntensity))

  const sun = new THREE.DirectionalLight(SUN.colour, SUN.intensity)
  const sunOffset = sunDirection().multiplyScalar(120)
  sun.position.copy(sunOffset)
  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  sun.shadow.camera.left = -SHADOW_EXTENT
  sun.shadow.camera.right = SHADOW_EXTENT
  sun.shadow.camera.top = SHADOW_EXTENT
  sun.shadow.camera.bottom = -SHADOW_EXTENT
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 400
  // Slope-scaled bias rather than a flat one: the road is very nearly
  // perpendicular to nothing and a constant bias that stops acne on the flat
  // detaches the shadow from the tyres.
  sun.shadow.bias = -0.0002
  sun.shadow.normalBias = 0.03
  scene.add(sun)
  scene.add(sun.target)

  // Terrain: a plane that covers the whole circuit when there is one, or a
  // moving patch under the car when there is not.
  const bounds = track ? trackBounds(track) : null
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(
      bounds ? bounds.size : GRID_SIZE * 3,
      bounds ? bounds.size : GRID_SIZE * 3,
    ),
    // Real albedo, not a swatch: dry late-summer grass sits around 0.14-0.18
    // reflectance, which is this — much darker than it looks written down, and
    // the reason the old 0x23331d read as painted cardboard once the sun landed
    // on it.
    new THREE.MeshStandardMaterial({ color: track ? 0x4a5535 : 0x1c2129, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  // Below the run-off, so the terrain never z-fights the circuit it surrounds.
  ground.position.y = -0.15
  if (bounds) ground.position.set(bounds.centreX, -0.15, bounds.centreZ)
  ground.receiveShadow = true
  scene.add(ground)

  const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, 0x35414f, 0x252d38)
  grid.position.y = 0.01
  // The kerbs and the white lines are the reference now, and a grid over the
  // top of them reads as a debug overlay nobody asked for.
  if (!track) scene.add(grid)

  const trackMesh = track ? buildTrackMesh(track) : null
  if (trackMesh) {
    trackMesh.receiveShadow = true
    scene.add(trackMesh)
  }

  // Barriers, boards, tyre stacks, the treeline and a grandstand. Only with a
  // circuit: the grid fallback is for looking at the car, and furniture around
  // an empty plane would be furniture around nothing.
  const trackside = track ? buildTrackside(track) : null
  if (trackside) for (const object of trackside.objects) scene.add(object)

  const carMesh = buildCarMesh()
  const car = carMesh.group
  car.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true
      // Bodywork shadows itself: the underside of the floor, the inside of the
      // sidepods and the cockpit are all dark because something above them is
      // in the way, and without this they are lit as if nothing were.
      object.receiveShadow = true
    }
  })
  scene.add(car)

  // Camera state, render-side only. Starts behind the car's spawn pose.
  const cameraTarget = new THREE.Vector3()
  const lookTarget = new THREE.Vector3()
  const cameraShake = new THREE.Vector3()
  let cameraInitialised = false
  let lastFrameTime = performance.now()

  let view: CameraView = 'chase'
  // Reused, not rebuilt each frame: a fresh object per frame at 60Hz is the GC
  // pressure `World` is kept plain and mutable to avoid.
  const carPose = { x: 0, z: 0, heading: 0, pitch: 0, roll: 0 }
  /**
   * Render clock, seconds. Drives the shake only.
   *
   * Accumulated from frame deltas rather than read off `world.time`, because the
   * shake is cosmetic and must not be tied to the physics clock — and because
   * `performance.now()` is a large number whose sines lose precision.
   */
  let elapsed = 0

  // Body attitude, smoothed across frames rather than snapped to the solver's
  // latest accelerations, which step visibly when a tyre lets go.
  let pitch = 0
  let roll = 0

  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }

  return {
    draw(world, alpha) {
      const player = world.cars[0]
      if (player) {
        const now = performance.now()
        // Render-side dt, clamped. Every smoothing and animation below is
        // cosmetic and must not depend on the physics clock — the two run at
        // different rates, and coupling them would put framerate into the sim.
        const dt = Math.min((now - lastFrameTime) / 1000, 0.1)
        lastFrameTime = now

        // Interpolate between the last two physics states rather than snapping to
        // the latest — steps and refreshes drift, and snapping reads as stutter.
        const x = lerp(player.previousPosition.x, player.position.x, alpha)
        const z = lerp(player.previousPosition.z, player.position.z, alpha)
        const heading = lerpAngle(player.previousHeading, player.heading, alpha)

        car.position.set(x, 0, z)
        // A y-rotation of `heading` maps the mesh's local +z onto (sin h, cos h),
        // which is exactly the forward vector the physics uses.
        car.rotation.y = heading

        // Walk the shadow box along with the car, keeping the sun's direction
        // fixed. Both the light and its target move by the same offset, so the
        // shadows never swing as the car drives — only what is inside the box
        // changes.
        sun.target.position.set(x, 0, z)
        sun.position.set(x + sunOffset.x, sunOffset.y, z + sunOffset.z)

        // Steering, wheel rotation, and the body leaning on its springs. The
        // wheels hang off the car group and the bodywork off `body`, so the
        // attitude below leans the car without tilting the tyres off the road.
        const telemetry = player.telemetry
        const wheels = wheelAngles(player.input.steer, telemetry.speed, dt, {
          front: CAR.frontTyreRadius,
          rear: CAR.rearTyreRadius,
        })
        for (const steered of carMesh.steering) steered.rotation.y = wheels.steer
        for (const [i, spin] of carMesh.spinning.entries()) {
          spin.rotation.x += i < 2 ? wheels.frontSpin : wheels.rearSpin
        }

        const attitude = bodyAttitude(telemetry.longitudinalG, telemetry.lateralG)
        pitch = approach(pitch, attitude.pitch, carMotion.attitudeStiffness, dt)
        roll = approach(roll, attitude.roll, carMotion.attitudeStiffness, dt)
        carMesh.body.rotation.set(pitch, 0, roll)

        if (!track) {
          // Snap the grid in whole squares so the reference lines never appear
          // to slide under the car, which would read as the car standing still.
          grid.position.x = Math.round(x / GRID_SPACING) * GRID_SPACING
          grid.position.z = Math.round(z / GRID_SPACING) * GRID_SPACING
          ground.position.x = grid.position.x
          ground.position.z = grid.position.z
        }

        const rig = rigFor(view, tuning)
        // The onboard rigs ride the body, so they get the smoothed lean the
        // bodywork is already using rather than the solver's raw accelerations.
        carPose.x = x
        carPose.z = z
        carPose.heading = heading
        carPose.pitch = pitch
        carPose.roll = roll
        cameraPose(rig, carPose, cameraTarget, lookTarget)
        // Set before `lookAt`, which reads it to build the view matrix.
        cameraUp(rig, carPose, camera.up)

        const speed = Math.hypot(player.velocity.x, player.velocity.z)

        if (!cameraInitialised || rig.stiffness === null) {
          // Bolted to the car: no spring, or the shot slides around inside the
          // tub. Also the first frame of any view, so switching cameras cuts
          // rather than sweeping across the circuit.
          camera.position.copy(cameraTarget)
          cameraInitialised = true
        } else {
          // Exponential smoothing, framerate-independent. The lag is the point:
          // a rigidly-attached camera reads as "no speed" and gets misdiagnosed
          // as a physics problem (PLAN.md, M1).
          const t = 1 - Math.exp(-rig.stiffness * dt)
          camera.position.lerp(cameraTarget, t)
        }

        // Vibration from what is under the tyres, added *after* the spring: a
        // 6/s spring is a low-pass filter, and a 6Hz wobble fed through it as a
        // target comes out the far side as almost nothing. Eye and look-at move
        // together, so the camera is shaken rather than aimed somewhere else —
        // repointing it at 60Hz reads as a fault, not as a kerb.
        elapsed += dt
        shakeOffset(shakeAmount(rig, speed, player.surface.grip), elapsed, cameraShake)
        camera.position.add(cameraShake)
        lookTarget.add(cameraShake)

        camera.lookAt(lookTarget)

        // FOV widens with speed. Cheap, and it does more for the sensation of
        // pace than any amount of extra geometry.
        const fov = fovFor(rig, speed)
        if (Math.abs(camera.fov - fov) > 0.01) {
          camera.fov = fov
          camera.updateProjectionMatrix()
        }
      }

      // The dome rides the camera, so it is always the same distance away and
      // can never be driven out of. Done after the camera has been moved for
      // this frame, or the sky lags the view by one frame at the horizon.
      sky.position.copy(camera.position)

      renderer.render(scene, camera)
    },
    resize,
    cycleView() {
      view = nextView(view)
      // Cut, don't sweep: letting the chase spring travel from the roll hoop to
      // nine metres behind the car turns a camera change into a fly-by.
      cameraInitialised = false
      return view
    },
    view: () => rigFor(view, tuning),
    dispose() {
      // The circuit is the one large allocation here — a few megabytes of
      // buffers that the GPU keeps until it is told otherwise.
      if (trackMesh) {
        trackMesh.geometry.dispose()
        ;(trackMesh.material as THREE.Material).dispose()
      }
      sky.geometry.dispose()
      ;(sky.material as THREE.Material).dispose()
      carMesh.dispose()
      trackside?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
