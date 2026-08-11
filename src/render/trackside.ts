/**
 * Everything beside the road.
 *
 * CLAUDE.md puts the reason plainly: "an empty ribbon of tarmac reads as slow no
 * matter how fast the car is going." That is not a figure of speech. Perceived
 * speed comes almost entirely from optical flow — things sweeping past the edges
 * of the vision — and a circuit surrounded by nothing supplies none of it. The
 * car can be doing 340kph and feel like 90. Barriers, boards, tyre stacks and
 * trees are the cheapest possible fix, because they only ever need to be
 * convincing at a closing speed of ninety metres a second.
 *
 * ## Everything here is derived from the track samples
 *
 * Same table the road mesh and the physics read. Nothing is hand-placed, which
 * means circuit two gets its trackside for free — the same argument PLAN.md
 * makes for investing in the pipeline rather than in the tracks. It also means
 * the barriers cannot drift away from the road, because they are measured from
 * it rather than positioned beside it.
 *
 * ## Budget
 *
 * The whole of this file is 7 draw calls and 25k triangles, against a scene
 * budget of 150 and 120k — measured, not estimated, by `budget.test.ts`, which
 * checks the figure against a six-car grid rather than against today's single
 * car. Three things keep it there:
 *
 *   - **Continuous furniture is one mesh.** Barriers and sponsor boards are
 *     ribbons, built exactly like the road, with vertex colours for the
 *     hoardings. Not one object per panel.
 *   - **Repeated furniture is instanced.** Trees, tyre stacks and marshal posts
 *     are one `InstancedMesh` each, so five hundred of something costs one call.
 *   - **Stride.** Furniture is generated every eighth sample, not every one. A
 *     barrier does not need 2m resolution; the road does, because you drive on
 *     it.
 *
 * Instanced meshes are culled as a unit, so every tree is submitted every frame
 * whether it is behind the camera or not. That is the reason the tree count is a
 * few hundred and not a few thousand, and it is why they are placed only where
 * they would really be — the park at Monza — rather than scattered everywhere.
 */

import * as THREE from 'three'
import type { TrackData, TrackSample } from '../track/spline'
import { KERB_WIDTH, RUNOFF_WIDTH } from './trackMesh'

/** Real dimensions, m. CLAUDE.md asks for these not to be eyeballed either. */
const BARRIER = {
  /** Distance from the centreline out to the face of the boards. */
  offset: KERB_WIDTH + RUNOFF_WIDTH + 1.5,
  /** Advertising hoarding: chest high, and the thing you actually see. */
  boardHeight: 1.05,
  /** Guardrail above the boards. */
  railHeight: 0.3,
  /** Sponsor panels are about this long. */
  panelLength: 9,
  /** One segment per this many centreline samples. */
  stride: 8,
} as const

/**
 * Hoarding colours.
 *
 * Deliberately desaturated. Real trackside advertising is loud, but loud
 * saturated colour under a tone-mapped sun is the single fastest way to make a
 * scene look like a toy — and CLAUDE.md rules out flat primaries by name. These
 * read as printed vinyl at 300kph, which is the only distance they are seen at.
 */
const PANELS = [0x9c2b2b, 0x1f3f6b, 0xb9b3a6, 0x2f5b3a, 0x2a2d33, 0xa8762c]
const RAIL = 0xb4b8bd

/**
 * A deterministic pseudo-random source.
 *
 * `Math.random` would put the trees somewhere different on every reload, which
 * makes "is that tree clipping the barrier?" unanswerable and any regression
 * test impossible. A seeded LCG costs one line and makes the scenery a property
 * of the circuit rather than of the page load.
 */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Right of the direction of travel, matching `pointAt` in `track/spline`. */
const rightOf = (sample: TrackSample): [number, number] => [
  Math.cos(sample.heading),
  -Math.sin(sample.heading),
]

/** A point `lateral` metres to the right of the centreline at this sample. */
const offsetPoint = (sample: TrackSample, lateral: number): [number, number] => {
  const [rx, rz] = rightOf(sample)
  return [sample.x + rx * lateral, sample.z + rz * lateral]
}

/**
 * The barriers and the boards on them, both sides, as one mesh.
 *
 * Two stacked ribbons sharing a vertex buffer: the hoarding from the ground to
 * `boardHeight` in alternating panel colours, and the guardrail above it in
 * grey. Double-sided, because the back of a barrier is visible across the
 * infield at Monza and a one-sided one vanishes when you look at it from there.
 */
function buildBarriers(track: TrackData): THREE.Mesh {
  const samples = track.samples
  const stride = BARRIER.stride
  const steps = Math.floor(samples.length / stride)

  const positions: number[] = []
  const colours: number[] = []
  const indices: number[] = []
  const colour = new THREE.Color()

  const push = (x: number, y: number, z: number, hex: number): number => {
    const index = positions.length / 3
    positions.push(x, y, z)
    colour.setHex(hex)
    colours.push(colour.r, colour.g, colour.b)
    return index
  }

  for (const side of [-1, 1]) {
    for (let step = 0; step < steps; step++) {
      const here = samples[(step * stride) % samples.length]!
      const next = samples[((step + 1) * stride) % samples.length]!

      const lateral = side * (here.width + BARRIER.offset)
      const lateralNext = side * (next.width + BARRIER.offset)
      const [x0, z0] = offsetPoint(here, lateral)
      const [x1, z1] = offsetPoint(next, lateralNext)

      // Panels advance by real distance, so the pattern keeps its size wherever
      // the sampling lands — the same reasoning as the kerb blocks.
      const panel = PANELS[Math.floor(here.distance / BARRIER.panelLength) % PANELS.length]!
      const board = BARRIER.boardHeight
      const top = board + BARRIER.railHeight

      // Hoarding, then rail. Winding is irrelevant here — the material is
      // double-sided — so this is the readable order rather than a careful one.
      const a = push(x0, 0, z0, panel)
      const b = push(x1, 0, z1, panel)
      const c = push(x0, board, z0, panel)
      const d = push(x1, board, z1, panel)
      const e = push(x0, top, z0, RAIL)
      const f = push(x1, top, z1, RAIL)

      indices.push(a, b, c, c, b, d)
      indices.push(c, d, e, e, d, f)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
    }),
  )
  mesh.name = 'barriers'
  mesh.receiveShadow = true
  // Ringing the whole circuit, so the camera is always inside its bounds and a
  // per-frame cull can only ever cost time — the same call as the road mesh.
  mesh.frustumCulled = false
  return mesh
}

/**
 * Tyre stacks, on the outside of the quick corners.
 *
 * Placed by curvature rather than by hand, which puts them where they are in
 * real life: at Rettifilo and Ascari and on the exit of Parabolica, and nowhere
 * along the main straight.
 *
 * Each tyre is a plain cylinder, not a torus. A torus at this size is 200
 * triangles for a hole nobody can resolve past about fifteen metres, and there
 * are two hundred of them.
 */
function buildTyreStacks(track: TrackData): THREE.InstancedMesh | null {
  const samples = track.samples
  const spots: { x: number; z: number; side: number }[] = []

  // Corners tighter than this get stacks. 1/220m is a fast sweeper; the
  // chicanes are an order of magnitude tighter than that.
  const threshold = 1 / 220
  for (let i = 0; i < samples.length; i += 18) {
    const sample = samples[i]!
    if (Math.abs(sample.curvature) < threshold) continue
    // Outside of the corner: curvature is positive turning right, and the
    // outside of a right-hander is the left.
    const side = sample.curvature > 0 ? -1 : 1
    const [x, z] = offsetPoint(sample, side * (sample.width + BARRIER.offset - 0.9))
    spots.push({ x, z, side })
  }
  if (spots.length === 0) return null

  const tyreRadius = 0.34
  const tyreHeight = 0.26
  // Eight sides, not twelve. These are never nearer than the width of a
  // run-off, and the silhouette of a stack is what reads, not the tyre.
  const geometry = new THREE.CylinderGeometry(tyreRadius, tyreRadius, tyreHeight, 8, 1)
  const material = new THREE.MeshStandardMaterial({
    color: 0x141518,
    roughness: 0.95,
    metalness: 0,
  })

  const rows = 2
  const height = 3
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length * rows * height)
  const matrix = new THREE.Matrix4()
  const dice = random(0x5eed)

  let instance = 0
  for (const spot of spots) {
    for (let row = 0; row < rows; row++) {
      for (let level = 0; level < height; level++) {
        matrix.makeTranslation(
          spot.x + (row - 0.5) * tyreRadius * 2.05,
          tyreHeight / 2 + level * tyreHeight * 0.98,
          spot.z + (dice() - 0.5) * 0.1,
        )
        mesh.setMatrixAt(instance++, matrix)
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.name = 'tyreStacks'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  return mesh
}

/**
 * The park. Monza is in one, and it is the circuit's whole visual identity.
 *
 * Trunk and canopy are two instanced meshes rather than one, because they are
 * different materials and merging them would mean a texture atlas to tell them
 * apart — a lot of machinery for two draw calls.
 *
 * Trees go only behind grass run-off. Behind a gravel trap or a wall there is
 * something else in real life, and a tree growing out of a tarmac escape road is
 * the kind of detail that undoes all the others.
 */
function buildTrees(track: TrackData): THREE.InstancedMesh[] {
  const samples = track.samples
  const dice = random(0xb17e)
  const placements: { x: number; z: number; scale: number }[] = []

  for (let i = 0; i < samples.length; i += 14) {
    const sample = samples[i]!
    for (const side of [-1, 1]) {
      const runoff = side < 0 ? sample.runoffLeft : sample.runoffRight
      if (runoff !== 'grass') continue
      if (dice() > 0.5) continue

      // Back from the barrier by a random depth, so the treeline has a depth to
      // it rather than being a hedge at a fixed distance.
      const depth = 8 + dice() * 46
      const [x, z] = offsetPoint(sample, side * (sample.width + BARRIER.offset + depth))
      placements.push({ x, z, scale: 0.75 + dice() * 0.65 })
    }
  }

  // Open-ended: the caps are underground and under the canopy respectively,
  // and at five hundred instances twelve triangles each is worth having back.
  const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.26, 3.2, 6, 1, true)
  trunkGeometry.translate(0, 1.6, 0)
  const canopyGeometry = new THREE.IcosahedronGeometry(2.6, 1)
  canopyGeometry.scale(1, 1.25, 1)
  canopyGeometry.translate(0, 5.2, 0)

  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.95 }),
    placements.length,
  )
  const canopies = new THREE.InstancedMesh(
    canopyGeometry,
    // Deciduous green in late summer, which is far more olive than the green a
    // colour picker offers.
    new THREE.MeshStandardMaterial({ color: 0x3d5230, roughness: 0.9, flatShading: true }),
    placements.length,
  )

  const matrix = new THREE.Matrix4()
  const scale = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const translation = new THREE.Vector3()

  placements.forEach((tree, i) => {
    translation.set(tree.x, 0, tree.z)
    // Spun about the vertical, so a low-poly canopy does not repeat visibly
    // down a treeline.
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dice() * Math.PI * 2)
    scale.setScalar(tree.scale)
    matrix.compose(translation, rotation, scale)
    trunks.setMatrixAt(i, matrix)
    canopies.setMatrixAt(i, matrix)
  })
  trunks.instanceMatrix.needsUpdate = true
  canopies.instanceMatrix.needsUpdate = true

  trunks.name = 'treeTrunks'
  canopies.name = 'treeCanopies'
  for (const mesh of [trunks, canopies]) {
    mesh.castShadow = true
    mesh.frustumCulled = false
  }
  return [trunks, canopies]
}

/**
 * Marshal posts, every 300m or so.
 *
 * Small, and worth the draw call for one reason: they are the only trackside
 * object at a regular spacing, so they are what the eye uses to count off
 * distance. Random scenery gives you speed; regular scenery gives you *rate*.
 */
function buildMarshalPosts(track: TrackData): THREE.InstancedMesh | null {
  const samples = track.samples
  const spacing = 300
  const count = Math.max(1, Math.floor(track.length / spacing))

  const post = new THREE.BoxGeometry(1.6, 2.2, 1.2)
  post.translate(0, 1.1, 0)
  const roof = new THREE.BoxGeometry(2.0, 0.14, 1.5)
  roof.translate(0, 2.27, 0)
  const geometry = mergeBoxes([post, roof])

  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xc8c4bb, roughness: 0.85 }),
    count,
  )
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const translation = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)

  for (let i = 0; i < count; i++) {
    const index = Math.floor(((i * spacing) / track.spacing) % samples.length)
    const sample = samples[index]!
    // Alternating sides, as they are at a real circuit — a marshal post covers
    // the stretch opposite the last one.
    const side = i % 2 === 0 ? -1 : 1
    const [x, z] = offsetPoint(sample, side * (sample.width + BARRIER.offset + 3.2))
    translation.set(x, 0, z)
    rotation.setFromAxisAngle(up, sample.heading)
    matrix.compose(translation, rotation, one)
    mesh.setMatrixAt(i, matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.name = 'marshalPosts'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  return mesh
}

/** Boxes only, so the attributes always line up and the merge cannot fail. */
function mergeBoxes(boxes: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry()
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  for (const box of boxes) {
    const flat = box.index ? box.toNonIndexed() : box
    positions.push(...Array.from(flat.getAttribute('position').array))
    normals.push(...Array.from(flat.getAttribute('normal').array))
    uvs.push(...Array.from(flat.getAttribute('uv').array))
    if (flat !== box) flat.dispose()
    box.dispose()
  }

  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return merged
}

/**
 * A grandstand on the pit straight.
 *
 * One structure, at the one place on the lap where the player is guaranteed to
 * be looking at something other than the next braking point. It is the only
 * object in the scene bigger than the car by an order of magnitude, and scale
 * needs at least one of those to be legible at all.
 */
function buildGrandstand(track: TrackData): THREE.Group {
  const group = new THREE.Group()
  const sample = track.samples[Math.floor(track.samples.length * 0.02)]!
  const [x, z] = offsetPoint(sample, -(sample.width + BARRIER.offset + 9))

  const structure = new THREE.Mesh(
    new THREE.BoxGeometry(11, 9, 120),
    new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.9 }),
  )
  // Raked back away from the circuit, like every grandstand ever built.
  structure.rotation.z = -0.24
  structure.position.set(x, 4.5, z)
  structure.rotation.y = sample.heading

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.4, 124),
    new THREE.MeshStandardMaterial({ color: 0x2f3237, roughness: 0.7, metalness: 0.4 }),
  )
  roof.position.set(x, 11.5, z)
  roof.rotation.y = sample.heading

  for (const mesh of [structure, roof]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  group.name = 'grandstand'
  return group
}

export interface Trackside {
  /** Add each of these to the scene. */
  objects: THREE.Object3D[]
  dispose: () => void
}

export function buildTrackside(track: TrackData): Trackside {
  const objects: THREE.Object3D[] = [buildBarriers(track), ...buildTrees(track)]

  const stacks = buildTyreStacks(track)
  if (stacks) objects.push(stacks)
  const posts = buildMarshalPosts(track)
  if (posts) objects.push(posts)
  objects.push(buildGrandstand(track))

  return {
    objects,
    dispose() {
      for (const object of objects) {
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            const material = child.material
            if (Array.isArray(material)) for (const m of material) m.dispose()
            else material.dispose()
          }
        })
      }
    },
  }
}
