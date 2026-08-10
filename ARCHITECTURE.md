# Slipstream — Architecture

## Guiding constraints

1. **Physics must be deterministic and framerate-independent.** The car must feel identical
   on a 60Hz laptop and a 144Hz monitor.
2. **The simulation must run without a browser.** Unit tests, and later AI tuning, need to
   step the world headlessly.
3. **Data flows one way.** Render and audio read simulation state; they never write it.

Everything below follows from these three.

---

## Why the game loop is separated from the render loop

This is the load-bearing decision in the codebase.

**The problem.** The naive loop steps physics by whatever `dt` the last frame took. That
breaks three ways:

- **Non-determinism.** Numerical integration of tyre slip is _not_ linear in `dt`. Stepping
  once at 33ms gives a different result than twice at 16.5ms — the car understeers slightly
  differently on a slow machine. For a game whose entire appeal is feel, this is fatal.
- **The tab-switch explosion.** Switch tabs for 10 seconds, come back, and `dt` is 10000ms.
  The car teleports through the track wall, or a `NaN` propagates through the state and
  everything vanishes. Every browser game hits this.
- **Untestability.** A loop coupled to `requestAnimationFrame` can't be stepped in Node.

**The solution — a fixed-timestep accumulator.**

```
frameDelta = min(now - lastTime, MAX_FRAME_DELTA)   // clamp: 250ms
accumulator += frameDelta

while (accumulator >= FIXED_DT) {                   // FIXED_DT = 1000/60
  previousState = currentState                      // snapshot for interpolation
  step(world, FIXED_DT)
  accumulator -= FIXED_DT
}

alpha = accumulator / FIXED_DT
render(lerp(previousState, currentState, alpha))
```

Physics always advances in identical 16.667ms slices. Rendering happens whenever the
display is ready, drawing an interpolated pose **between** the two most recent physics
states.

**Why interpolate rather than render the latest state?** Physics steps and display refresh
drift against each other. Without interpolation, some frames show a state 0.1ms old and
others 16ms old — visible as micro-stutter at speed, exactly where you'd notice it.
Interpolation costs a `lerp` per visible object and removes it entirely.

**Why clamp `MAX_FRAME_DELTA`?** After a tab switch the accumulator would otherwise hold
seconds of backlog and the `while` loop would run hundreds of steps in one frame — freezing
the page, then possibly needing more than a frame's worth again, spiralling. Clamping means
the simulation silently loses time instead. **Losing time is always the right trade:** the
alternative is a frozen tab or a car through a wall.

**What we deliberately give up:** simulation time can drift behind wall-clock. Anything
timing-sensitive (lap times) reads _accumulated simulation time_, never `performance.now()`.

Rendering at 60Hz and simulating at 60Hz doesn't make this machinery pointless — it's what
keeps 144Hz monitors, 30fps thermal throttling, and background tabs from each producing a
different car.

---

## Modules

Boundaries are enforced by dependency direction, and the rule is checked rather than
remembered: `eslint.config.js` encodes this table as `no-restricted-imports` zones, so a
crossing fails `npm run lint`. **A module may only import from modules listed in its "may
import" row.**

| Module     | Responsibility                                                            | May import      |
| ---------- | ------------------------------------------------------------------------- | --------------- |
| `core/`    | Fixed-timestep loop, `World` state container, event bus, math, input feel | — (nothing)     |
| `physics/` | Tyre curve, per-wheel load, drivetrain, integration                       | `core`          |
| `track/`   | Circuit authoring, spline sampling, surface and distance queries          | `core`          |
| `input/`   | Keyboard + gamepad → normalised `InputState`                              | `core`          |
| `ai/`      | Racing line following → `InputState`                                      | `core`, `track` |
| `game/`    | Race rules, laps, positions, flags, state machine                         | `core`, `track` |
| `render/`  | Three.js scene, meshes, chase camera, interpolation                       | `core`, `track` |
| `ui/`      | HUD, menus, debug overlay (DOM, not canvas)                               | `core`          |
| `audio/`   | Web Audio graph, engine synthesis, event sounds                           | `core`          |

Collision response and car-to-car contact are not yet written; when they land they belong
in `physics/`. There is no `assets/` module: circuits are authored in TypeScript under
`track/circuits/` rather than loaded as data, which is what lets the closure of a layout be
a unit test instead of a runtime surprise.

**The one sanctioned exception** is `ui/tuningPanel.ts`, a dev-only lazy chunk that tunes
the car, the input feel and the camera at once. It imports _types_ from `physics/` and
`render/` and is handed the live objects, so nothing on the simulation path gains a
dependency from it existing. The lint rule allows type-only imports out of `ui/` for
exactly this reason.

**`physics/` importing Three.js is a bug.** It uses plain `{x, z}` vectors and pure
functions. That's what makes it testable in Node and is the main reason the module boundary
exists at all.

**Tuning constants belong to the module they describe, not to the car.** Input ramp rates
live in `core/feel.ts` and camera tuning in `render/cameraSetup.ts`, because bundling them
into `physics/carSetup.ts` is what made `input/` and `render/` import `physics/` — the
table above was quietly violated for exactly one evening's convenience. If a constant makes
a module import upward, it is in the wrong file.

---

## The two contracts that matter

### 1. AI emits the same struct as the human

```ts
interface InputState {
  steer: number // -1 (full left) .. 1 (full right)
  throttle: number // 0 .. 1
  brake: number // 0 .. 1
  handbrake: boolean
}
```

`input/` produces one of these per frame. `ai/` produces one _per AI car_. `physics/`
doesn't know or care which it got.

This buys three things for free:

- Any car can be swapped human ↔ AI at runtime
- Recording a stream of `InputState` and replaying it gives you **ghost laps and benchmark
  opponents at zero extra cost** (deterministic physics is what makes replay exact)
- AI is testable headlessly — run 3 laps in Node, assert the lap time is in range

### 2. Render reads, never writes

`render/` receives an interpolated read-only view. If rendering could mutate the world,
simulation would depend on framerate — the exact thing the fixed timestep exists to
prevent. Same rule for `ui/` and `audio/`.

### 3. The track reaches the physics as two numbers

```ts
interface SurfaceContact {
  grip: number // multiplies available tyre grip
  drag: number // multiplies rolling resistance
}
```

`game/` locates each car and writes this onto it; `physics/` reads it and never learns what
a circuit is. Same shape of contract as `InputState`, for the same reason — two modules that
must not import each other meeting on a struct in `core/`.

Two numbers rather than one because they fail differently. Grass takes away your ability to
point the car but not your speed; gravel leaves you able to steer perfectly well while
going nowhere. A single "off-track penalty" cannot express either, and the version that
tries ends up being tuned until it is wrong about both.

The car reads the surface found under it at the end of the *previous* step. Locating a car
needs its new position, and the physics needs the surface before it moves — 16ms of lag at
the moment two wheels cross a white line, which no driver can perceive.

---

## Where state lives

A single mutable `World` object owned by `core/`:

```ts
interface World {
  time: number // accumulated simulation time, ms — the only clock
  cars: Car[] // pose, velocity, per-wheel state, lap, surface
  race: RaceState // phase, lap counts, positions
}
```

**The circuit is deliberately not in here.** `World` carried a `track: null` placeholder
for a while, and it was the one place the module table bit: `core/` imports nothing, so it
cannot name a type that lives in `track/`. The choice was to move the track types down into
`core/` or to hand the circuit to the systems that need it — and the second turned out to
cost one line in `main.ts`, because nothing ever actually asked `World` for the track:

```ts
const track = monza()
const race = createRaceDirector(buildTrackIndex(track)) // laps, standings, surface
const renderer = createRenderer(document.body, { track }) // the road you can see
```

What the cars carry is the track's *answer*, not the track: `distanceAlongTrack`, `lap`,
and `surface` — a pair of multipliers for grip and rolling resistance. Those are numbers
`core/` can name, and they are the whole of the circuit's influence on the physics, which
is what keeps `physics/` runnable in Node with no circuit at all.

**Mutable and plain, by design.** A 60Hz simulation touching every car's state each step is
precisely the workload immutable state management is worst at — allocating fresh objects
60×/sec produces GC pressure that shows up as frame hitching. There is no Redux, no
Zustand, no signals in the simulation path.

`ui/` reads a **throttled 10Hz snapshot** instead of subscribing to the world: the HUD
doesn't need 60Hz updates, and DOM writes are expensive. Only the interpolated car pose
needs per-frame fidelity, and that's `render/`'s job.

Cross-module communication that isn't state-reading goes through the **event bus** in
`core/`: physics emits `collision`, `wheel-lock`, `surface-change`; audio and render
subscribe. This keeps `physics/` from importing `audio/`.

---

## Folder structure

What exists today. Modules still to be filled in (`ai/`, `audio/`) hold a single documented
placeholder each rather than a speculative file list — the shape they will take is
described in the module table above, and inventing filenames here ages badly.

```
slipstream/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js           # ← the module table below, enforced
├── PLAN.md · ARCHITECTURE.md · STACK.md · CLAUDE.md
├── .github/workflows/ci.yml · deploy.yml
└── src/
    ├── main.ts                 # composition root — wires modules, owns nothing
    ├── core/
    │   ├── loop.ts             # fixed-timestep accumulator
    │   ├── loop.test.ts
    │   ├── world.ts            # World type + factory
    │   ├── events.ts           # typed event bus
    │   ├── feel.ts             # ← input ramp rates. Not the car.
    │   └── math.ts             # lerp, clamp, vec2 helpers
    ├── physics/
    │   ├── car.ts              # the step: steering, drivetrain, ellipse, integrate
    │   ├── tyre.ts             # slip curve, load sensitivity, axle grip
    │   ├── suspension.ts       # vertical load per wheel, roll
    │   ├── gearbox.ts          # torque curve + shift logic
    │   ├── regression.test.ts  # ← the frozen handling envelope
    │   ├── stability.test.ts   # ← it must never explode, and must be deterministic
    │   ├── surface.test.ts     # ← what grass and gravel each cost you
    │   └── carSetup.ts         # ← the car's tuning file. One place.
    ├── track/
    │   ├── author.ts           # circuits as straights and arcs
    │   ├── spline.ts           # → evenly-sampled centreline
    │   ├── query.ts            # position → distance, offset, surface. O(1).
    │   ├── track.test.ts
    │   └── circuits/monza.ts
    ├── input/
    │   └── index.ts            # keyboard + gamepad → InputState
    ├── ai/driver.ts            # placeholder — M4
    ├── game/
    │   ├── race.ts             # ← locate, laps, lap times, standings, surface
    │   └── race.test.ts        # ← the start/finish wraparound, mostly
    ├── audio/engine.ts         # placeholder — M6
    ├── render/
    │   ├── renderer.ts · cameraSetup.ts
    │   └── trackMesh.ts        # ← the road, from the same samples physics reads
    └── ui/
        └── debugOverlay.ts · tuningPanel.ts
```

---

## Frame walkthrough

```
requestAnimationFrame
  └─ loop.tick()
       ├─ clamp frame delta, add to accumulator
       ├─ while (accumulator >= FIXED_DT):
       │    ├─ input.sample()        → InputState (human)
       │    ├─ ai.update(world)      → InputState per AI car
       │    ├─ physics.step(world)   → integrate, emit events
       │    ├─ game.update(world)    → laps, positions, flags
       │    └─ accumulator -= FIXED_DT
       ├─ render.draw(world, alpha)  ← interpolated, read-only
       ├─ audio.update(world)        ← read-only
       └─ ui.update(world)           ← throttled to 10Hz
```

`main.ts` is the only file that knows the full module graph. Everything else depends
downward through the table above.
