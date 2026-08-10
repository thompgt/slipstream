/**
 * Live tuning panel (lil-gui), bound directly to the `carSetup` object.
 *
 * Deliberately loaded on demand: `lil-gui` is a development tool, and Slipstream
 * ships one runtime dependency (STACK.md). Behind a dynamic `import()` Vite puts
 * it in its own chunk, so a player who never opens the panel never downloads it.
 *
 * Every slider writes straight into the live setup object — `physics/` reads
 * those fields fresh each step, so a drag changes the car within 16ms. That
 * immediacy is the point: tuning by feel means adjusting mid-corner and noticing
 * the difference on the same lap, not reloading between guesses.
 */

import type { CarSetup } from '../physics/carSetup'

export interface TuningPanel {
  toggle: () => void
  dispose: () => void
}

const noop: TuningPanel = { toggle: () => {}, dispose: () => {} }

export async function createTuningPanel(
  setup: CarSetup,
  onReset: () => void,
): Promise<TuningPanel> {
  // Panel is optional; the game must still run if the chunk fails to load.
  const module = await import('lil-gui').catch(() => null)
  if (!module) return noop

  const gui = new module.default({ title: 'Slipstream — car setup', width: 320 })
  gui.close()

  const grip = gui.addFolder('Tyres — grip and slide')
  grip.add(setup.tyres, 'peakGripFront', 0.6, 2.5, 0.01).name('peak grip front')
  grip.add(setup.tyres, 'peakGripRear', 0.6, 2.5, 0.01).name('peak grip rear')
  grip.add(setup.tyres, 'stiffness', 3, 20, 0.1).name('stiffness (B)')
  grip.add(setup.tyres, 'shape', 1.1, 2.2, 0.01).name('shape (C)')
  grip.add(setup.tyres, 'curvature', 0, 1.2, 0.01).name('fall-off (E)')
  grip.add(setup.tyres, 'handbrakeGrip', 0.1, 1, 0.01).name('handbrake rear grip')
  grip.open()

  const chassis = gui.addFolder('Chassis')
  chassis.add(setup.chassis, 'mass', 500, 1400, 5)
  chassis.add(setup.chassis, 'yawInertia', 300, 2500, 10).name('yaw inertia')
  chassis.add(setup.chassis, 'yawDamping', 0, 3000, 10).name('yaw damping')
  chassis.add(setup.chassis, 'wheelbase', 2.2, 4.5, 0.05)
  chassis.add(setup.chassis, 'frontWeightBias', 0.3, 0.7, 0.01).name('front weight bias')
  chassis.add(setup.chassis, 'cgHeight', 0.1, 0.8, 0.01).name('CG height')
  chassis.add(setup.chassis, 'rollingResistance', 0, 0.05, 0.001).name('rolling resistance')

  const brakes = gui.addFolder('Brakes')
  brakes.add(setup.brakes, 'maxForce', 5000, 45000, 100).name('max force (N)')
  brakes.add(setup.brakes, 'biasFront', 0.3, 0.9, 0.01).name('front bias')
  brakes.add(setup.brakes, 'handbrakeForce', 0, 25000, 100).name('handbrake force')

  const aero = gui.addFolder('Aero')
  aero.add(setup.aero, 'downforce', 0, 4, 0.05).name('downforce (N per (m/s)^2)')
  aero.add(setup.aero, 'balanceFront', 0.2, 0.8, 0.01).name('front balance')
  aero.add(setup.aero, 'drag', 0, 3, 0.02).name('drag')

  const drivetrain = gui.addFolder('Engine & gearbox')
  drivetrain.add(setup.engine, 'limiterRpm', 6000, 20000, 100).name('limiter rpm')
  drivetrain.add(setup.engine, 'engineBraking', 0, 200, 1).name('engine braking (Nm)')
  drivetrain.add(setup.gearbox, 'finalDrive', 2, 10, 0.05).name('final drive')
  drivetrain.add(setup.gearbox, 'upshiftRpm', 5000, 20000, 100).name('upshift rpm')
  drivetrain.add(setup.gearbox, 'downshiftRpm', 2000, 15000, 100).name('downshift rpm')
  drivetrain.add(setup.gearbox, 'shiftTime', 0, 0.4, 0.005).name('shift time (s)')
  const ratios = drivetrain.addFolder('Gear ratios')
  // lil-gui binds by property name; an array's indices are property names too,
  // but its types only admit `keyof` string members, hence the widening cast.
  const ratioTarget = setup.gearbox.ratios as unknown as Record<string, number>
  setup.gearbox.ratios.forEach((_, i) => {
    ratios.add(ratioTarget, String(i), 0.5, 5, 0.01).name(`gear ${i + 1}`)
  })
  ratios.close()

  const steering = gui.addFolder('Steering feel')
  steering.add(setup.steering, 'maxAngle', 0.1, 0.9, 0.01).name('max lock (rad)')
  steering.add(setup.steering, 'highSpeedFactor', 0.05, 1, 0.01).name('lock at speed')
  steering.add(setup.steering, 'falloffSpeed', 20, 120, 1).name('fall-off speed (m/s)')
  steering.add(setup.steering, 'rate', 0.5, 10, 0.1).name('keyboard rate')
  steering.add(setup.steering, 'rateAtSpeed', 0.2, 6, 0.1).name('keyboard rate at speed')
  steering.add(setup.steering, 'returnRate', 0.5, 12, 0.1).name('return rate')
  steering.add(setup.steering, 'pedalRate', 1, 20, 0.5).name('pedal rate')
  steering.add(setup.steering, 'deadzone', 0, 0.4, 0.01).name('gamepad deadzone')

  const camera = gui.addFolder('Camera')
  camera.add(setup.camera, 'distance', 3, 20, 0.1)
  camera.add(setup.camera, 'height', 0.5, 10, 0.1)
  camera.add(setup.camera, 'lookAhead', 0, 25, 0.5).name('look ahead')
  camera.add(setup.camera, 'stiffness', 1, 25, 0.1).name('spring stiffness')
  camera.add(setup.camera, 'baseFov', 40, 100, 1).name('base FOV')
  camera.add(setup.camera, 'fovGain', 0, 40, 1).name('FOV gain')
  camera.close()

  gui.add({ reset: onReset }, 'reset').name('Reset car (R)')

  let hidden = false
  return {
    toggle() {
      hidden = !hidden
      gui.show(!hidden)
    },
    dispose() {
      gui.destroy()
    },
  }
}
