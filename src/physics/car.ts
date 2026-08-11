/**
 * The 2D bicycle model.
 *
 * Pure functions over plain numbers — no Three.js, no DOM. That constraint is
 * what lets this run in Node under Vitest, and it is deliberate: importing a
 * rendering type here is a bug, not a shortcut.
 *
 * Structure of a step:
 *
 *   1. resolve steering angle (speed-sensitive lock)
 *   2. gearbox + engine  -> longitudinal force at the rear axle
 *   3. weight transfer   -> vertical load per axle
 *   4. friction ellipse  -> how much lateral grip each axle has left
 *   5. slip angles       -> tyre curve -> lateral force per axle
 *   6. integrate body-frame velocity and yaw, then convert back to world
 *
 * Nothing in here scripts understeer or oversteer. They fall out of step 5: if
 * the front axle runs out of grip first the car pushes wide, if the rear does it
 * rotates. Which happens depends on load, which depends on what the driver did
 * with the pedals — which is why braking into a corner rotates the car and
 * getting on the throttle mid-corner straightens it, with no special cases.
 *
 * Axes: x is world right, z is world forward at heading 0. In the body frame `u`
 * is forward, `v` is rightward, and yaw rate `r` is positive turning right, so
 * positive steering input, positive steering angle, and positive yaw all agree.
 */

import { clamp } from '../core/math'
import { createTelemetry, type Car, type WallQuery } from '../core/world'
import { carSetup, type CarSetup } from './carSetup'
import { resolveWalls } from './collision'
import { engineTorque, totalRatio, updateGearbox } from './gearbox'
import { createWheelLoads, FL, FR, RL, RR, wheelLoads, type AxleLoads } from './suspension'
import { axleGrip, tyreForce } from './tyre'

/** Scratch, reused every step for every car — see the note in `suspension`. */
const wheels = createWheelLoads()
const loads: AxleLoads = { front: 0, rear: 0 }

/**
 * Advance one car by exactly `dt` ms.
 *
 * `dt` is always FIXED_DT. Never scale behaviour by a variable frame delta —
 * integration of tyre slip is not linear in dt, so that would make the car feel
 * different on different machines.
 *
 * `walls` is optional and the tests mostly omit it: with no query the car drives
 * on an infinite plane, which is the right model for a tyre or gearbox test and
 * is what keeps this runnable with no circuit at all. Unlike `car.surface`, it is
 * passed in rather than read off the car, because a wall is the one thing that
 * cannot tolerate the one-step lag the surface accepts — at 90m/s, 16ms of stale
 * position is a metre and a half of bodywork already inside the barrier.
 */
export function stepCar(
  car: Car,
  dt: number,
  setup: CarSetup = carSetup,
  walls?: WallQuery,
): void {
  // Snapshot the pose the renderer will interpolate from.
  car.previousPosition.x = car.position.x
  car.previousPosition.z = car.position.z
  car.previousHeading = car.heading

  const s = dt / 1000
  const { chassis, engine, gearbox, brakes, tyres, aero, steering } = setup

  // CG to each axle. Front load bias of 0.45 means the CG sits 0.45 of the
  // wheelbase ahead of the rear axle — closer to the rear, as it should be.
  const distanceToFront = chassis.wheelbase * (1 - chassis.frontWeightBias)
  const distanceToRear = chassis.wheelbase * chassis.frontWeightBias

  // --- world velocity -> body frame -------------------------------------------
  const sinH = Math.sin(car.heading)
  const cosH = Math.cos(car.heading)
  let u = car.velocity.x * sinH + car.velocity.z * cosH
  let v = car.velocity.x * cosH - car.velocity.z * sinH
  let r = car.yawRate
  const speed = Math.hypot(u, v)

  const { throttle, brake, handbrake } = car.input

  // --- 1. steering -------------------------------------------------------------
  // Lock shrinks with speed. Without this, full lock at 300kph asks for a corner
  // radius the tyres cannot produce, and the car simply spins.
  const speedFactor = Math.min(speed / steering.falloffSpeed, 1)
  const lock = steering.maxAngle * (1 + (steering.highSpeedFactor - 1) * speedFactor)
  const delta = clamp(car.input.steer, -1, 1) * lock

  // --- 2. drivetrain -----------------------------------------------------------
  updateGearbox(car, u, throttle, s, setup)

  const ratio = totalRatio(car.gear, setup)
  const shifting = car.shiftTimer > 0
  const crankTorque = shifting ? 0 : engineTorque(car.rpm, setup) * throttle
  // Engine braking is proportional to revs, so it bites hardest in a low gear at
  // high rpm — exactly when you want it, on corner entry after a downshift.
  const brakingTorque = engine.engineBraking * (1 - throttle) * (car.rpm / engine.limiterRpm)
  let driveForce =
    ((crankTorque - brakingTorque) * ratio * gearbox.efficiency) / chassis.wheelRadius

  // Reverse: at a crawl with no throttle, the brake becomes reverse. Cheap, and
  // it means a spin doesn't end the run.
  const reversing = throttle === 0 && brake > 0 && u < 0.5
  if (reversing) driveForce = -brakes.reverseForce * brake

  // --- 3. weight transfer ------------------------------------------------------
  // Solved per wheel, then summed back to axles for the tyre model below, which
  // is still per axle. The sum is exactly what the old per-axle solve produced,
  // because lateral transfer is antisymmetric within an axle — so this step
  // changes nothing today. It is the scaffolding the per-wheel tyre model needs,
  // and doing it first means the migration can be verified rather than felt.
  wheelLoads(car.longitudinalAccel, car.lateralAccel, speed, setup, wheels)
  loads.front = wheels[FL] + wheels[FR]
  loads.rear = wheels[RL] + wheels[RR]

  // --- 4. friction ellipse -----------------------------------------------------
  // Grip is summed from the two wheels of each axle rather than taken from the
  // axle total. Identical while `loadSensitivity` is zero; once it is not, an
  // axle with its load piled onto one wheel has less grip than one carrying the
  // same total evenly, which is what makes bar rates and roll centres matter.
  //
  // Surface scales both axles equally: with a 2D model the car is a point, so
  // "two wheels on the grass" is not something this can express yet. It is the
  // per-wheel tyre model that makes putting one side in the dirt different from
  // putting all four there, and until then a shared multiplier is the honest
  // approximation rather than a fudge.
  const surface = car.surface.grip
  const gripFront = axleGrip(wheels[FL], wheels[FR], tyres.peakGripFront, tyres) * surface
  const gripRear =
    axleGrip(wheels[RL], wheels[RR], tyres.peakGripRear, tyres) *
    surface *
    (handbrake ? tyres.handbrakeGrip : 1)

  // Direction of travel, for forces that oppose motion. Zeroed near a standstill
  // so brakes and rolling resistance don't buzz the car back and forth.
  const dir = u > 0.05 ? 1 : u < -0.05 ? -1 : 0

  const brakeTotal = reversing ? 0 : brake * brakes.maxForce
  const brakeFront = brakeTotal * brakes.biasFront
  const brakeRear = brakeTotal * (1 - brakes.biasFront) + (handbrake ? brakes.handbrakeForce : 0)

  // Clamp longitudinal force to what the tyre can actually put down. This is what
  // makes a first-gear launch traction-limited rather than a rocket, and what
  // makes locking the brakes cost you grip rather than stopping distance.
  const fxFront = clamp(-dir * brakeFront, -gripFront, gripFront)
  const fxRear = clamp(driveForce - dir * brakeRear, -gripRear, gripRear)

  // Whatever the friction circle has left after longitudinal use. Braking hard in
  // a straight line leaves nothing for turning; easing off returns it gradually —
  // this term and the load transfer above are jointly what trail braking is.
  const lateralFront = Math.sqrt(Math.max(0, gripFront * gripFront - fxFront * fxFront))
  const lateralRear = Math.sqrt(Math.max(0, gripRear * gripRear - fxRear * fxRear))

  // --- 5. slip angles and tyre forces -----------------------------------------
  // Softened denominator: the true expression divides by forward speed, which is
  // singular at rest. Below the threshold the low-speed damping below takes over.
  const forward = Math.max(Math.abs(u), chassis.lowSpeedThreshold)
  const slipFront = Math.atan2(v + distanceToFront * r, forward) - delta
  const slipRear = Math.atan2(v - distanceToRear * r, forward)

  // Negated: the tyre pushes back against its own slip.
  const tyreFront = -tyreForce(slipFront, tyres) * lateralFront
  const tyreRear = -tyreForce(slipRear, tyres) * lateralRear

  // Front forces are in the steered wheel's frame; rotate them into the body's.
  const sinD = Math.sin(delta)
  const cosD = Math.cos(delta)
  const bodyFxFront = fxFront * cosD - tyreFront * sinD
  const bodyFyFront = fxFront * sinD + tyreFront * cosD

  // --- resistances -------------------------------------------------------------
  const drag = aero.drag * speed
  // Rolling resistance is what makes gravel a trap. Grip alone would let a car
  // carry speed through a run-off and rejoin having lost only a little time;
  // scrubbing speed is what actually ends the lap, which is why the surface has
  // two numbers rather than one.
  const rolling = dir * chassis.rollingResistance * car.surface.drag * (loads.front + loads.rear)

  const forceX = bodyFxFront + fxRear - drag * u - rolling
  const forceY = bodyFyFront + tyreRear - drag * v
  const moment = distanceToFront * bodyFyFront - distanceToRear * tyreRear - chassis.yawDamping * r

  // --- 6. integrate ------------------------------------------------------------
  const accelX = forceX / chassis.mass
  const accelY = forceY / chassis.mass

  // Weight transfer responds to tyre and aero forces, not to the rotating-frame
  // terms below, so record the force-derived values.
  car.longitudinalAccel = accelX
  car.lateralAccel = accelY

  // `v*r` and `-u*r` are the rotating-frame terms: in a steady corner they are
  // the centripetal acceleration. Dropping them is a common bug that makes the
  // car understeer more the faster it goes, for no reason a tuner can find.
  u += (accelX + v * r) * s
  v += (accelY - u * r) * s
  r += (moment / chassis.yawInertia) * s

  // Brakes stop the car; they don't reverse it.
  if (!reversing && dir !== 0 && Math.sign(u) !== dir && brake > 0 && throttle === 0) u = 0

  // Near a standstill the slip-angle maths is meaningless, so bleed off sideways
  // motion instead of letting it ring. Exponential so it's timestep-independent.
  if (speed < chassis.lowSpeedThreshold) {
    const decay = Math.exp(-chassis.lowSpeedDamping * s)
    v *= decay
    r *= decay
  }

  // --- back to world -----------------------------------------------------------
  car.heading += r * s
  car.yawRate = r

  const sinH2 = Math.sin(car.heading)
  const cosH2 = Math.cos(car.heading)
  car.velocity.x = u * sinH2 + v * cosH2
  car.velocity.z = u * cosH2 - v * sinH2

  car.position.x += car.velocity.x * s
  car.position.z += car.velocity.z * s

  // A NaN anywhere above poisons the car permanently and looks like a freeze.
  // Cheap insurance while the model is still being tuned.
  if (!Number.isFinite(car.position.x) || !Number.isFinite(car.position.z)) {
    resetCar(car)
    return
  }

  // Last, on the position the car actually reached. Telemetry below therefore
  // reports the speed the car had a moment before the barrier took it away —
  // one frame of lag on a number nobody reads mid-impact, in exchange for
  // resolving the contact against a current position rather than a stale one.
  if (walls) resolveWalls(car, dt, walls, setup)

  writeTelemetry(car, {
    speed: Math.hypot(u, v),
    slipFront,
    slipRear,
    loads,
    gripFront,
    gripRear,
    lateralFront: tyreFront,
    lateralRear: tyreRear,
    fxFront,
    fxRear,
    accelX,
    accelY,
    downforce: aero.downforce * speed * speed,
  })
}

/**
 * Put a car back on its feet after a NaN, or on request.
 *
 * Telemetry is cleared along with the state it describes. The NaN path returns
 * from `stepCar` before `writeTelemetry`, so without this the overlay would sit
 * frozen on the numbers from the step that poisoned the car — which reads as the
 * game having hung rather than as a car that reset.
 *
 * Lap and distance go too: R teleports the car to the origin, and leaving it
 * carrying half a lap of progress is how a reset turns into a phantom lap once
 * `game/` starts believing those fields.
 */
export function resetCar(car: Car): void {
  car.position.x = 0
  car.position.z = 0
  car.previousPosition.x = 0
  car.previousPosition.z = 0
  car.heading = 0
  car.previousHeading = 0
  car.velocity.x = 0
  car.velocity.z = 0
  car.yawRate = 0
  car.gear = 1
  car.rpm = 0
  car.shiftTimer = 0
  car.longitudinalAccel = 0
  car.lateralAccel = 0
  car.lap = 0
  car.distanceAlongTrack = 0
  // R puts the car back on the start line, which is asphalt. Keeping the grip of
  // whatever it was reset out of would make the first step after a trip through
  // the gravel behave as though it were still in it.
  car.surface.grip = 1
  car.surface.drag = 1
  // Otherwise R out of a barrier and the camera keeps shaking on the start line.
  car.impact = 0
  // Off the hot path — only a NaN or a keypress gets here — so rebuilding from
  // the factory is worth it to keep this from drifting as fields are added.
  Object.assign(car.telemetry, createTelemetry())
}

interface TelemetryInput {
  speed: number
  slipFront: number
  slipRear: number
  loads: AxleLoads
  gripFront: number
  gripRear: number
  lateralFront: number
  lateralRear: number
  fxFront: number
  fxRear: number
  accelX: number
  accelY: number
  downforce: number
}

function writeTelemetry(car: Car, t: TelemetryInput): void {
  const out = car.telemetry
  out.speed = t.speed
  out.rpm = car.rpm
  out.gear = car.gear
  out.slipAngleFront = t.slipFront
  out.slipAngleRear = t.slipRear
  out.loadFront = t.loads.front
  out.loadRear = t.loads.rear
  out.downforce = t.downforce
  out.longitudinalG = t.accelX / 9.81
  out.lateralG = t.accelY / 9.81
  out.gripUsageFront = t.gripFront > 0 ? Math.hypot(t.fxFront, t.lateralFront) / t.gripFront : 0
  out.gripUsageRear = t.gripRear > 0 ? Math.hypot(t.fxRear, t.lateralRear) / t.gripRear : 0
  out.driveForce = t.fxRear
}
