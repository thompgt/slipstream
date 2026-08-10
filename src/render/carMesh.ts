/**
 * The car, at the size a Formula 1 car actually is.
 *
 * What this replaces was five boxes, and its own comment said so: "a crude
 * open-wheeler silhouette ... enough shape to read yaw at a glance, which is all
 * a placeholder needs to do". That was the right call while the question being
 * answered was whether the handling was any good. It is the wrong thing to ship
 * to someone who was promised a Formula 1 car.
 *
 * ## Proportions are not eyeballed
 *
 * Every number in `CAR` below is a real 2026-regulation dimension, and CLAUDE.md
 * asks for exactly that. This matters more than it sounds like it should: the
 * single strongest cue that something is a real racing car rather than a toy is
 * that it is *long and low* — 5.6m long and 0.97m tall is a ratio of nearly six
 * to one, and a placeholder built by eye is never that extreme, because it looks
 * wrong in isolation and only looks right next to a road and a driver.
 *
 * ## How the shapes are made
 *
 * Bodywork is **lofted**, not assembled from primitives. A loft takes a series of
 * cross-sections along the car's length and skins them, which is roughly how the
 * real thing is designed and is the only cheap way to get the two curves that
 * matter: the nose tapering to a point, and the "coke bottle" where the bodywork
 * pulls in behind the sidepods to feed the rear wing. Boxes cannot express
 * either, and their absence is most of why a primitive car reads as a brick.
 *
 * Each section is a **superellipse** rather than a circle or a rectangle. One
 * exponent takes it continuously from an ellipse to a rounded rectangle, so the
 * round nose, the squared-off sidepod and the flat-bottomed floor are all the
 * same code with a different number.
 *
 * Wings are extruded cambered aerofoils — thick at the leading edge, sharp at the
 * trailing edge, bowed downward because they make downforce. A flat plate at an
 * angle would be cheaper and reads as cardboard from any angle but side-on.
 *
 * ## Draw calls
 *
 * The perf budget in CLAUDE.md (≤150 draw calls) is the one thing that does not
 * bend, and a car assembled part-by-part would spend forty of them on its own.
 * So the bodywork is built as loose geometries, bucketed by material, and merged
 * into one mesh per material — four for the whole body. Only the wheels stay
 * separate, because they have to steer and spin independently. That is 12 draw
 * calls per car, which leaves room for a full grid later.
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * 2026 Formula 1 regulations, in metres.
 *
 * The numbers that define the silhouette are fixed by the rules and are worth
 * having in one place: change `WHEELBASE` and the suspension, the sidepods and
 * the floor all have to move with it, and they do, because they are all
 * expressed relative to these.
 */
export const CAR = {
  length: 5.6,
  width: 2.0,
  /** To the top of the airbox, the tallest point. */
  height: 0.97,
  wheelbase: 3.4,

  /** z of the front and rear axle lines. Their gap is the wheelbase. */
  frontAxle: 1.55,
  rearAxle: -1.85,
  /** z of the very tip of the nose, and of the rear wing's trailing edge. */
  noseTip: 3.3,
  tail: -2.3,

  /** 18-inch wheels: the rim is 0.4572m across, the tyre is built around it. */
  rimRadius: 0.2286,
  frontTyreRadius: 0.36,
  rearTyreRadius: 0.3625,
  frontTyreWidth: 0.305,
  rearTyreWidth: 0.405,
} as const

/** Wheel centres, x. Overall width is measured across the tyres, so these follow. */
const FRONT_TRACK = (CAR.width - CAR.frontTyreWidth) / 2
const REAR_TRACK = (CAR.width - CAR.rearTyreWidth) / 2

// --- materials ---------------------------------------------------------------

/**
 * Albedo values are real reflectances, which is why they read as too dark
 * written down. A tone-mapped pipeline lit by a real sun brings them up; a
 * "looks right in the editor" colour blows out the moment the sun hits it.
 */
const MATERIALS = {
  /** Team livery. Clearcoat is what separates painted bodywork from plastic. */
  paint: new THREE.MeshPhysicalMaterial({
    color: 0x9b1223,
    roughness: 0.28,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
  }),
  /** Exposed weave: nearly black, but glossy enough to catch the sky. */
  carbon: new THREE.MeshPhysicalMaterial({
    color: 0x15171b,
    roughness: 0.34,
    metalness: 0.1,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
  }),
  /** Suspension links, uprights, exhaust. */
  metal: new THREE.MeshStandardMaterial({
    color: 0x8d9299,
    roughness: 0.34,
    metalness: 1.0,
  }),
  /** Radiator mouths, cockpit interior, visor — things light falls into. */
  shadowed: new THREE.MeshStandardMaterial({
    color: 0x07080a,
    roughness: 0.95,
    metalness: 0.0,
  }),
  /** Slicks are matte and very dark, and almost never actually black. */
  rubber: new THREE.MeshStandardMaterial({
    color: 0x121316,
    roughness: 0.93,
    metalness: 0.0,
  }),
  helmet: new THREE.MeshPhysicalMaterial({
    color: 0xd8d3c8,
    roughness: 0.22,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  }),
} as const

type MaterialName = keyof typeof MATERIALS

/** Geometries waiting to be merged, grouped by the material they will wear. */
type Bucket = Partial<Record<MaterialName, THREE.BufferGeometry[]>>

const add = (bucket: Bucket, material: MaterialName, geometry: THREE.BufferGeometry): void => {
  // Extrude and lathe geometries arrive with material groups that would survive
  // the merge and re-split the mesh into several draw calls — exactly what the
  // merge exists to avoid.
  geometry.clearGroups()

  // Everything is flattened to non-indexed before it goes in the bucket.
  // `mergeGeometries` refuses to mix indexed and non-indexed inputs, and the
  // bodywork is both: lofts and primitives are indexed, `ExtrudeGeometry` is
  // not. It signals that refusal by returning null, which — before this — meant
  // the entire carbon bucket silently vanished, taking the floor, both wings,
  // the halo and the diffuser with it. Normalising here costs some duplicated
  // vertices once, at load, and removes the whole class of failure.
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  if (flat !== geometry) geometry.dispose()
  ;(bucket[material] ??= []).push(flat)
}

/** One mesh per material. */
function meshesFrom(bucket: Bucket): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  for (const [name, geometries] of Object.entries(bucket) as [
    MaterialName,
    THREE.BufferGeometry[],
  ][]) {
    const merged = mergeGeometries(geometries, false)
    // Loud rather than invisible. A failed merge drops every part wearing that
    // material, and the car comes up missing a third of itself with nothing in
    // the console to say why.
    if (!merged) throw new Error(`carMesh: could not merge the '${name}' geometries`)
    for (const geometry of geometries) geometry.dispose()
    const mesh = new THREE.Mesh(merged, MATERIALS[name])
    mesh.name = name
    meshes.push(mesh)
  }
  return meshes
}

// --- lofting -----------------------------------------------------------------

/**
 * One cross-section of the bodywork, in the plane at `z`.
 *
 * Described by a box and a roundness rather than by a list of points, because
 * every shape on a racing car is somewhere on the line between an ellipse and a
 * rectangle, and interpolating a single exponent between sections is what makes
 * the nose blend smoothly into the tub.
 */
export interface Section {
  z: number
  /** Lateral centre. Non-zero only for the sidepods, which are built off-axis. */
  centreX?: number
  halfWidth: number
  /** Lower and upper surface heights, m. */
  bottom: number
  top: number
  /**
   * 2 is a true ellipse; 8 is very nearly a rounded rectangle. The nose is
   * round, the floor is flat, the sidepod is in between.
   */
  squareness: number
}

const RADIAL = 20

/**
 * Skin a series of sections into a closed shell.
 *
 * Sections must run front to back (decreasing z). Both ends are capped, so the
 * result is watertight and can cast a shadow without light leaking through it.
 *
 * The winding is the part worth being careful about: get it backwards and every
 * face is back-facing, which does not error — the bodywork simply turns
 * inside-out and you see the inside of the far side of the car. `carMesh.test.ts`
 * asserts the normals point away from the body's axis for exactly this reason,
 * which is also why this is exported: winding is worth checking against a shell
 * whose axis is known, rather than against merged bodywork made of four parts
 * that each have a different one.
 */
export function loft(sections: Section[]): THREE.BufferGeometry {
  const count = sections.length
  const ring = RADIAL
  // One extra column repeating the seam, so the u coordinate can run 0..1
  // without the last quad mapping backwards across the whole texture.
  const columns = ring + 1
  const shellVertices = count * columns
  // Two cap centres, plus a ring of rim vertices for each so the caps can carry
  // their own flat normals instead of averaging into the shell.
  const vertexCount = shellVertices + 2 * (ring + 1)

  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices: number[] = []

  const point = (section: Section, k: number): [number, number] => {
    const theta = (k % ring) * ((Math.PI * 2) / ring)
    const cx = section.centreX ?? 0
    const cy = (section.bottom + section.top) / 2
    const halfHeight = (section.top - section.bottom) / 2
    const exponent = 2 / section.squareness

    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    return [
      cx + section.halfWidth * Math.sign(cos) * Math.abs(cos) ** exponent,
      cy + halfHeight * Math.sign(sin) * Math.abs(sin) ** exponent,
    ]
  }

  for (let i = 0; i < count; i++) {
    const section = sections[i]!
    for (let k = 0; k < columns; k++) {
      const [x, y] = point(section, k)
      const v = (i * columns + k) * 3
      positions[v] = x
      positions[v + 1] = y
      positions[v + 2] = section.z
      uvs[(i * columns + k) * 2] = k / ring
      uvs[(i * columns + k) * 2 + 1] = i / (count - 1)
    }
  }

  // Shell quads. `a`->`b` runs backwards along the car and `a`->`c` runs around
  // the section, and that order is what puts the normal on the outside.
  for (let i = 0; i < count - 1; i++) {
    for (let k = 0; k < ring; k++) {
      const a = i * columns + k
      const b = (i + 1) * columns + k
      const c = i * columns + k + 1
      const d = (i + 1) * columns + k + 1
      indices.push(a, b, c, c, b, d)
    }
  }

  // Caps: a fan around a centre vertex at each end.
  const capStart = shellVertices
  const front = sections[0]!
  const back = sections[count - 1]!

  for (const [capIndex, section] of [front, back].entries()) {
    const base = capStart + capIndex * (ring + 1)
    const centreY = (section.bottom + section.top) / 2
    positions[base * 3] = section.centreX ?? 0
    positions[base * 3 + 1] = centreY
    positions[base * 3 + 2] = section.z
    uvs[base * 2] = 0.5
    uvs[base * 2 + 1] = 0.5

    for (let k = 0; k < ring; k++) {
      const [x, y] = point(section, k)
      const v = base + 1 + k
      positions[v * 3] = x
      positions[v * 3 + 1] = y
      positions[v * 3 + 2] = section.z
      uvs[v * 2] = 0.5 + Math.cos((k / ring) * Math.PI * 2) * 0.5
      uvs[v * 2 + 1] = 0.5 + Math.sin((k / ring) * Math.PI * 2) * 0.5
    }

    for (let k = 0; k < ring; k++) {
      const here = base + 1 + k
      const next = base + 1 + ((k + 1) % ring)
      // Front cap faces +z, back cap faces -z, so they wind opposite ways.
      if (capIndex === 0) indices.push(base, here, next)
      else indices.push(base, next, here)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// --- aerofoils ---------------------------------------------------------------

/**
 * A wing element: a cambered section swept across the span.
 *
 * Camber is negative — the section bows downward — because these make downforce.
 * It is visible from the side of the car and from any chase camera angle looking
 * down at the front wing, which is most of them.
 */
function wing(options: {
  span: number
  chord: number
  thickness: number
  camber: number
  /** Radians, nose-down positive. */
  angle: number
  position: [number, number, number]
}): THREE.BufferGeometry {
  const { span, chord, thickness, camber, angle, position } = options
  const steps = 14

  const shape = new THREE.Shape()
  const upper: THREE.Vector2[] = []
  const lower: THREE.Vector2[] = []

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = t * chord
    // Parabolic camber line, and a thickness that tapers to a point at the
    // trailing edge — a wing with a blunt trailing edge reads as a plank.
    const mean = -camber * 4 * t * (1 - t) * chord
    const half = (thickness * chord * Math.sin(Math.PI * t ** 0.7) * (1 - t * 0.85)) / 2
    upper.push(new THREE.Vector2(x, mean + half))
    lower.push(new THREE.Vector2(x, mean - half))
  }

  shape.moveTo(upper[0]!.x, upper[0]!.y)
  for (const p of upper.slice(1)) shape.lineTo(p.x, p.y)
  for (const p of lower.reverse()) shape.lineTo(p.x, p.y)
  shape.closePath()

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: span,
    bevelEnabled: false,
    curveSegments: 1,
  })

  // The shape is drawn chordwise in x and extruded in z; the car needs chord in
  // z and span in x. Rotate to that, set the incidence about the span axis, then
  // centre and place — `center()` last, so `position` means the middle of the
  // element regardless of how the rotations moved it off the origin.
  geometry.rotateY(-Math.PI / 2)
  geometry.rotateX(angle)
  geometry.center()
  geometry.translate(position[0], position[1], position[2])
  return geometry
}

// --- small parts -------------------------------------------------------------

/** A cylinder between two points — suspension links, pylons, roll bars. */
function strut(
  from: [number, number, number],
  to: [number, number, number],
  radius: number,
): THREE.BufferGeometry {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const length = a.distanceTo(b)
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1)
  // Cylinders are born along +y; point this one down the a->b axis.
  const orientation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    b.clone().sub(a).normalize(),
  )
  geometry.applyQuaternion(orientation)
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return geometry
}

/**
 * A box, optionally cambered, placed at `position`.
 *
 * `roll` is applied *before* the translation, and that ordering is the whole
 * reason it is a parameter rather than something the caller does afterwards.
 * `BufferGeometry.rotateZ` turns the geometry about the world origin, not about
 * itself — so rotating an already-placed endplate swings it bodily outward on a
 * 1m lever arm. It pushed the car 34mm over the regulation width and put the
 * bottom corner 20mm under the road, both of which `carMesh.test.ts` caught.
 */
const plate = (
  width: number,
  height: number,
  depth: number,
  position: [number, number, number],
  roll = 0,
): THREE.BufferGeometry => {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  if (roll !== 0) geometry.rotateZ(roll)
  geometry.translate(...position)
  return geometry
}

// --- assemblies --------------------------------------------------------------

/** Monocoque and nose: one continuous surface from the tip to the gearbox. */
const TUB: Section[] = [
  { z: CAR.noseTip, halfWidth: 0.075, bottom: 0.14, top: 0.26, squareness: 3.0 },
  { z: 2.9, halfWidth: 0.105, bottom: 0.13, top: 0.31, squareness: 3.0 },
  { z: 2.3, halfWidth: 0.15, bottom: 0.12, top: 0.38, squareness: 3.2 },
  { z: 1.7, halfWidth: 0.215, bottom: 0.1, top: 0.46, squareness: 3.4 },
  { z: 1.1, halfWidth: 0.3, bottom: 0.08, top: 0.52, squareness: 3.6 },
  { z: 0.55, halfWidth: 0.36, bottom: 0.06, top: 0.58, squareness: 4.0 },
  { z: 0.0, halfWidth: 0.42, bottom: 0.05, top: 0.62, squareness: 4.2 },
  { z: -0.55, halfWidth: 0.47, bottom: 0.05, top: 0.68, squareness: 4.4 },
  { z: -1.1, halfWidth: 0.43, bottom: 0.05, top: 0.66, squareness: 4.2 },
  { z: -1.6, halfWidth: 0.3, bottom: 0.06, top: 0.58, squareness: 3.8 },
  { z: -2.0, halfWidth: 0.19, bottom: 0.08, top: 0.46, squareness: 3.4 },
  { z: -2.1, halfWidth: 0.15, bottom: 0.1, top: 0.4, squareness: 3.2 },
]

/**
 * One sidepod, on the +x side, mirrored for the other.
 *
 * The widest point of the body and the reason the car has a waist: it swells to
 * the radiator mouth just behind the cockpit and is gone by the rear axle.
 */
const SIDEPOD: Section[] = [
  { z: 0.45, centreX: 0.52, halfWidth: 0.1, bottom: 0.16, top: 0.3, squareness: 3.0 },
  { z: 0.2, centreX: 0.6, halfWidth: 0.24, bottom: 0.13, top: 0.5, squareness: 3.2 },
  { z: -0.2, centreX: 0.6, halfWidth: 0.3, bottom: 0.1, top: 0.52, squareness: 4.0 },
  { z: -0.7, centreX: 0.56, halfWidth: 0.28, bottom: 0.09, top: 0.48, squareness: 4.0 },
  { z: -1.2, centreX: 0.46, halfWidth: 0.2, bottom: 0.09, top: 0.38, squareness: 3.6 },
  { z: -1.6, centreX: 0.34, halfWidth: 0.1, bottom: 0.1, top: 0.26, squareness: 3.0 },
  { z: -1.85, centreX: 0.26, halfWidth: 0.03, bottom: 0.12, top: 0.2, squareness: 3.0 },
]

/** Engine cover, over the tub, peaking at the airbox above the driver's head. */
const ENGINE_COVER: Section[] = [
  { z: -0.28, halfWidth: 0.16, bottom: 0.6, top: 0.72, squareness: 3.0 },
  { z: -0.5, halfWidth: 0.22, bottom: 0.58, top: CAR.height, squareness: 2.6 },
  { z: -0.8, halfWidth: 0.22, bottom: 0.56, top: 0.92, squareness: 2.8 },
  { z: -1.3, halfWidth: 0.17, bottom: 0.5, top: 0.76, squareness: 3.0 },
  { z: -1.8, halfWidth: 0.11, bottom: 0.44, top: 0.6, squareness: 3.0 },
  { z: -2.05, halfWidth: 0.07, bottom: 0.4, top: 0.5, squareness: 3.0 },
]

/** The floor, ending in the diffuser ramp. Nearly rectangular in section. */
const FLOOR: Section[] = [
  { z: 1.55, halfWidth: 0.42, bottom: 0.03, top: 0.06, squareness: 8 },
  { z: 0.8, halfWidth: 0.7, bottom: 0.028, top: 0.058, squareness: 8 },
  { z: 0.0, halfWidth: 0.82, bottom: 0.026, top: 0.056, squareness: 8 },
  { z: -0.9, halfWidth: 0.82, bottom: 0.026, top: 0.056, squareness: 8 },
  { z: -1.55, halfWidth: 0.72, bottom: 0.03, top: 0.062, squareness: 8 },
  { z: -1.9, halfWidth: 0.6, bottom: 0.075, top: 0.11, squareness: 8 },
  { z: -2.2, halfWidth: 0.52, bottom: 0.18, top: 0.215, squareness: 8 },
]

function buildBodywork(bucket: Bucket): void {
  add(bucket, 'paint', loft(TUB))
  add(bucket, 'paint', loft(ENGINE_COVER))
  add(bucket, 'paint', loft(SIDEPOD))
  add(
    bucket,
    'paint',
    (() => {
      const mirrored = loft(SIDEPOD)
      mirrored.scale(-1, 1, 1)
      // Mirroring reverses the winding, so every face would be inside-out
      // without flipping the index buffer back.
      const index = mirrored.getIndex()!
      for (let i = 0; i < index.count; i += 3) {
        const b = index.getX(i + 1)
        index.setX(i + 1, index.getX(i + 2))
        index.setX(i + 2, b)
      }
      mirrored.computeVertexNormals()
      return mirrored
    })(),
  )

  add(bucket, 'carbon', loft(FLOOR))

  // Radiator mouths, set into the front of each sidepod. Dark because they are
  // holes, and a hole that is the same colour as the bodywork is not a hole.
  for (const side of [-1, 1]) {
    add(bucket, 'shadowed', plate(0.34, 0.3, 0.06, [side * 0.6, 0.32, 0.3]))
  }
  // Airbox intake above the roll hoop, same reasoning.
  add(bucket, 'shadowed', plate(0.26, 0.16, 0.06, [0, 0.86, -0.44]))

  // Cockpit opening: a recessed dark well the driver sits in.
  add(bucket, 'shadowed', plate(0.5, 0.16, 0.9, [0, 0.52, 0.28]))
}

function buildWings(bucket: Bucket): void {
  // --- front wing -----------------------------------------------------------
  // Full car width, and almost on the ground. Both facts are regulation and both
  // are load-bearing for the silhouette.
  add(
    bucket,
    'carbon',
    wing({
      span: CAR.width,
      chord: 0.34,
      thickness: 0.1,
      camber: 0.1,
      angle: -0.08,
      position: [0, 0.09, 3.06],
    }),
  )
  add(
    bucket,
    'carbon',
    wing({
      span: 1.86,
      chord: 0.24,
      thickness: 0.09,
      camber: 0.14,
      angle: -0.32,
      position: [0, 0.24, 2.93],
    }),
  )
  for (const side of [-1, 1]) {
    // Canted outward at the top, as real endplates are. Placed just inside the
    // span so the widest thing on the car stays the tyres.
    add(bucket, 'carbon', plate(0.022, 0.32, 0.52, [side * 0.978, 0.19, 3.04], side * -0.05))
  }
  // Pylons hanging the wing off the underside of the nose.
  for (const side of [-1, 1]) {
    add(bucket, 'carbon', strut([side * 0.08, 0.18, 3.02], [side * 0.11, 0.3, 2.86], 0.018))
  }

  // --- rear wing ------------------------------------------------------------
  add(
    bucket,
    'carbon',
    wing({
      span: 1.0,
      chord: 0.28,
      thickness: 0.11,
      camber: 0.12,
      angle: -0.18,
      position: [0, 0.72, -2.1],
    }),
  )
  add(
    bucket,
    'carbon',
    wing({
      span: 1.0,
      chord: 0.2,
      thickness: 0.1,
      camber: 0.16,
      angle: -0.5,
      position: [0, 0.89, -2.2],
    }),
  )
  for (const side of [-1, 1]) {
    add(bucket, 'carbon', plate(0.024, 0.44, 0.42, [side * 0.5, 0.76, -2.09]))
  }
  // Beam wing, low between the endplates, and the pylon that carries the lot.
  add(
    bucket,
    'carbon',
    wing({
      span: 0.72,
      chord: 0.18,
      thickness: 0.11,
      camber: 0.14,
      angle: -0.3,
      position: [0, 0.4, -2.1],
    }),
  )
  add(bucket, 'carbon', strut([0, 0.42, -2.08], [0, 0.72, -2.1], 0.032))

  // --- diffuser strakes -----------------------------------------------------
  for (const x of [-0.42, -0.16, 0.16, 0.42]) {
    add(bucket, 'carbon', plate(0.016, 0.13, 0.42, [x, 0.11, -2.02]))
  }
}

/**
 * The halo, and the driver under it.
 *
 * Both earn their place for the same reason: they are the only things in the
 * scene at human scale, and without something human-sized on it the car has no
 * size at all. The helmet in particular is what makes the cockpit read as a
 * cockpit rather than a dip in the bodywork.
 */
function buildCockpit(bucket: Bucket): void {
  const hoop = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, 0.82, 0.74),
      new THREE.Vector3(0.4, 0.87, 0.3),
      new THREE.Vector3(0.43, 0.9, -0.3),
      new THREE.Vector3(0, 0.92, -0.42),
      new THREE.Vector3(-0.43, 0.9, -0.3),
      new THREE.Vector3(-0.4, 0.87, 0.3),
    ],
    true,
    'catmullrom',
    0.5,
  )
  add(bucket, 'carbon', new THREE.TubeGeometry(hoop, 48, 0.032, 8, true))
  // The single front pillar, straight down the centreline into the tub.
  add(bucket, 'carbon', strut([0, 0.56, 0.78], [0, 0.82, 0.74], 0.03))

  // Roll hoop behind the driver, inside the airbox.
  add(bucket, 'carbon', strut([0, 0.6, -0.42], [0, 0.9, -0.46], 0.045))

  const helmet = new THREE.SphereGeometry(0.135, 16, 12)
  helmet.scale(1, 1.05, 1.12)
  helmet.translate(0, 0.72, 0.02)
  add(bucket, 'helmet', helmet)
  // Visor: a band around the front of the helmet, not a decal on it.
  const visor = new THREE.SphereGeometry(0.138, 16, 12, Math.PI * 0.62, Math.PI * 0.76, 1.0, 0.58)
  visor.scale(1, 1.05, 1.12)
  visor.translate(0, 0.72, 0.02)
  add(bucket, 'shadowed', visor)
}

/**
 * Wishbones, pushrods and track rods.
 *
 * Four thin links per corner. They cost almost nothing and they are the
 * difference between wheels attached to a car and wheels floating beside one —
 * the gap between the tub and the tyre is the most conspicuous empty space on an
 * open-wheeler, and leaving it empty is what makes a model look unfinished.
 */
function buildSuspension(bucket: Bucket): void {
  const corners = [
    { z: CAR.frontAxle, x: FRONT_TRACK, hubY: 0.34, inner: 0.3 },
    { z: CAR.rearAxle, x: REAR_TRACK, hubY: 0.34, inner: 0.26 },
  ]

  for (const corner of corners) {
    for (const side of [-1, 1]) {
      const hub: [number, number, number] = [side * (corner.x - 0.06), corner.hubY, corner.z]
      const upper = 0.44
      const lower = 0.15

      // Upper and lower wishbones: two legs each, splayed fore and aft.
      for (const spread of [0.26, -0.26]) {
        add(bucket, 'metal', strut([side * corner.inner, upper, corner.z + spread], hub, 0.021))
        add(
          bucket,
          'metal',
          strut([side * corner.inner, lower, corner.z + spread], [hub[0], 0.19, hub[2]], 0.023),
        )
      }
      // Track rod / toe link, offset from the axle line so it is visible.
      add(
        bucket,
        'metal',
        strut([side * corner.inner, 0.3, corner.z - 0.2], [hub[0], 0.3, hub[2] - 0.14], 0.017),
      )
      // Upright, joining the two wishbones behind the wheel.
      add(bucket, 'metal', strut([hub[0], 0.19, hub[2]], [hub[0], upper, hub[2]], 0.03))
    }
  }
}

// --- wheels ------------------------------------------------------------------

/**
 * A tyre as a lathed profile rather than a cylinder.
 *
 * A cylinder has a hard 90-degree edge where the tread meets the sidewall, and
 * that edge catches the sun as a bright ring which reads, unmistakably, as
 * plastic. Real tyres have a shouldered crown; three extra points in the profile
 * buy it.
 */
function tyreGeometry(radius: number, width: number): THREE.BufferGeometry {
  const half = width / 2
  const shoulder = radius * 0.055
  const profile = [
    new THREE.Vector2(CAR.rimRadius * 0.98, -half + 0.01),
    new THREE.Vector2(radius * 0.82, -half),
    new THREE.Vector2(radius - shoulder, -half),
    new THREE.Vector2(radius, -half + shoulder * 1.4),
    new THREE.Vector2(radius, half - shoulder * 1.4),
    new THREE.Vector2(radius - shoulder, half),
    new THREE.Vector2(radius * 0.82, half),
    new THREE.Vector2(CAR.rimRadius * 0.98, half - 0.01),
  ]
  const geometry = new THREE.LatheGeometry(profile, 28)
  // Lathes spin around +y; a wheel spins around the car's x.
  geometry.rotateZ(Math.PI / 2)
  return geometry
}

/**
 * One wheel, as two nested groups.
 *
 * The outer group steers (y) and the inner one spins (x). Nesting them this way
 * is what keeps a steered wheel spinning about its own axle rather than about
 * the car's — rotate a single object on both axes and the second rotation is
 * applied in the wrong frame, and the wheel wobbles like a supermarket castor.
 */
function buildWheel(radius: number, width: number): { steer: THREE.Group; spin: THREE.Group } {
  const steer = new THREE.Group()
  const spin = new THREE.Group()
  steer.add(spin)

  const tyre = new THREE.Mesh(tyreGeometry(radius, width), MATERIALS.rubber)
  spin.add(tyre)

  // Rim, brake disc and caliper merged: they never move relative to each other,
  // so they have no business being three draw calls.
  const rim = new THREE.CylinderGeometry(CAR.rimRadius, CAR.rimRadius, width * 0.86, 20, 1)
  rim.rotateZ(Math.PI / 2)
  const disc = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 0.2, 20, 1)
  disc.rotateZ(Math.PI / 2)
  const spokes: THREE.BufferGeometry[] = [rim, disc]
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2
    const spoke = new THREE.BoxGeometry(width * 0.5, CAR.rimRadius * 1.7, 0.028)
    spoke.rotateX(angle)
    spokes.push(spoke)
  }
  const merged = mergeGeometries(spokes, false)
  if (merged) {
    for (const geometry of spokes) geometry.dispose()
    spin.add(new THREE.Mesh(merged, MATERIALS.metal))
  }

  return { steer, spin }
}

// --- the car -----------------------------------------------------------------

export interface CarMesh {
  /** Add this to the scene. Positioned and rotated by the renderer. */
  group: THREE.Group
  /**
   * Everything that is not a wheel, as one child.
   *
   * Pitch and roll are applied here rather than to `group`, so the body leans on
   * its suspension while the wheels stay flat on the road — which is what
   * actually happens, and what makes braking and cornering readable from behind.
   */
  body: THREE.Group
  /** Front-left, front-right: these steer. */
  steering: THREE.Group[]
  /** All four spin groups, in the order FL, FR, RL, RR. */
  spinning: THREE.Group[]
  dispose: () => void
}

export function buildCarMesh(): CarMesh {
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)

  const bucket: Bucket = {}
  buildBodywork(bucket)
  buildWings(bucket)
  buildCockpit(bucket)
  buildSuspension(bucket)

  const meshes = meshesFrom(bucket)
  for (const mesh of meshes) body.add(mesh)

  const steering: THREE.Group[] = []
  const spinning: THREE.Group[] = []

  const corners = [
    { z: CAR.frontAxle, x: -FRONT_TRACK, r: CAR.frontTyreRadius, w: CAR.frontTyreWidth, s: true },
    { z: CAR.frontAxle, x: FRONT_TRACK, r: CAR.frontTyreRadius, w: CAR.frontTyreWidth, s: true },
    { z: CAR.rearAxle, x: -REAR_TRACK, r: CAR.rearTyreRadius, w: CAR.rearTyreWidth, s: false },
    { z: CAR.rearAxle, x: REAR_TRACK, r: CAR.rearTyreRadius, w: CAR.rearTyreWidth, s: false },
  ]

  for (const corner of corners) {
    const { steer, spin } = buildWheel(corner.r, corner.w)
    steer.position.set(corner.x, corner.r, corner.z)
    // Wheels hang off `group`, not `body`: the body leans, the wheels do not.
    group.add(steer)
    if (corner.s) steering.push(steer)
    spinning.push(spin)
  }

  return {
    group,
    body,
    steering,
    spinning,
    dispose() {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
      for (const material of Object.values(MATERIALS)) material.dispose()
    },
  }
}
