# Slipstream — Tech Stack

Every choice below is filtered through the same three constraints: **solo dev, ~50 hours,
must hit 60fps in Safari, must deploy as static files.** Anything that trades setup time
for scale we don't need loses.

---

## Language — TypeScript

Physics code is dense with vectors, angles, and unit-bearing scalars. Confusing radians
with degrees, or velocity in m/s with kph, produces bugs that look like _bad handling_
rather than _errors_ — you'll spend an evening tuning a tyre curve to compensate for a unit
mistake. Types catch that class of bug at the moment you write it.

`strict: true` from the start, including `noUncheckedIndexedAccess`. Retrofitting strict
mode onto an existing codebase is miserable; starting there costs nothing.

> **Alternative: plain JavaScript.** Pick it if you find yourself fighting the type system
> more than it's helping — genuinely possible in a codebase this small with one developer
> holding the whole thing in their head. The break-even is roughly when you're writing type
> gymnastics for Three.js generics instead of writing game code. You can also go halfway:
> JS with `// @ts-check` and JSDoc.

## Build tool — Vite

Native ESM dev server, sub-second HMR, one-line static build. For a game you'll iterate on
by _feel_, the edit→drive latency is the metric that matters, and Vite's is as low as it
gets. Also bundles Vitest's ecosystem, sharing one config for build and test.

> **Alternative: Parcel.** Pick it if you want genuinely zero config. Vite's config here is
> ~15 lines, so the saving is small, and Parcel's caching quirks cost more than that on a
> long project.

## Rendering — Three.js

The most-documented WebGL library in existence, which for a solo dev is the deciding
factor: every problem you hit at 11pm has a Stack Overflow answer. Gives you exactly what
this game needs — scene graph, camera, instanced meshes, `ExtrudeGeometry` for the track
ribbon — without an engine's opinions about your game loop. Critically, **Three.js does not
own the main loop**, so we can drive it from our own fixed-timestep accumulator (see
ARCHITECTURE.md). Engines that own the loop make that fight expensive.

Tree-shakes to ~150KB gzipped when importing only what's used.

> **Alternative: Babylon.js.** Pick it if you want a built-in inspector and scene debugger,
> which genuinely accelerate 3D debugging. It's a fuller engine with more built in — but
> more to learn, a heavier bundle, and stronger opinions about the loop. Worth it if you
> already know it.
>
> **Not React Three Fiber.** React's reconciler in a 60Hz render path is a performance and
> mental-model tax with no upside here — there's no component tree to manage, just a scene
> updated imperatively every frame.

## Physics — hand-rolled 2D bicycle model

**The most important choice in the stack, and the least obvious.**

A rigid-body engine (Rapier, Cannon, Ammo) simulates a car as a chassis with four wheel
constraints and solves the whole system generically. That's the right call for a
simulator. It's the wrong call here for four reasons:

1. **It fights the feel you asked for.** "Grippy but slidey, rewards trail braking" comes
   from a specific tyre-slip curve — grip rising to a peak slip angle, then falling off
   gently rather than snapping. In a hand-rolled model that curve is a function you edit
   directly. In a solver it's an emergent product of friction coefficients, solver
   iterations, and substeps — you tune indirectly and hope.
2. **Cost.** ~50 lines of integration versus a 500KB WASM blob and a constraint solver, for
   6 cars at 60Hz.
3. **Testability.** Pure functions over `{x, z}` step in Node instantly. Assert that
   trail braking rotates the car more than coasting in — an actual regression test on
   _feel_.
4. **Debuggability.** When the car does something odd you read your own 50 lines, not a
   solver's internals.

A bicycle model (front and rear axles as single tyres, lateral force from slip angle,
longitudinal from slip ratio, load transfer under braking/acceleration) is the standard
arcade-sim approach and is what most games of this feel actually use. Car-to-car contact is
handled separately as simple impulse-based circle collisions — cheap, and arcade racers
_want_ forgiving contact anyway.

> **Alternative: Rapier (Rust/WASM).** Pick it the moment you want true simulation —
> suspension travel, weight transfer in roll as an emergent property, cars that can be
> tipped or launched, or damage modelling. Also pick it if car-to-car collisions become a
> headline feature rather than an occasional bump. The signal to switch: you're adding a
> third ad-hoc special case to your own collision code.

## State management — plain mutable `World` + typed event bus

No library. Immutable state at 60Hz means allocating fresh objects for every car every
step; the resulting GC pressure surfaces as frame hitching — the one thing this game can't
afford. A single mutable `World` owned by `core/` with strict one-way data flow (see
ARCHITECTURE.md) gives the discipline without the allocation cost.

> **Alternative: Zustand.** Pick it _only for UI state_ — menus, settings, results screens
> — if that grows enough to be annoying (car selection, persisted settings, multi-screen
> navigation). Keep it strictly out of the simulation path. Below ~5 screens, plain DOM and
> a state enum is less code than the store.

## Audio — Web Audio API, synthesised engine

An engine note is a stack of sawtooth oscillators whose frequency tracks RPM, through a
lowpass whose cutoff tracks throttle. Synthesis is the right call because engine pitch must
vary _continuously_ — sample-based approaches need crossfading between pitch-shifted loops
to avoid audible stepping, which ends up more code than the synth. It's also zero asset
bytes and zero load time.

Web Audio is well-supported in both targets. **Safari requires a user gesture to start the
context** — hence a click-to-start screen (which you want anyway, for pointer lock).

> **Alternative: Howler.js with recorded samples.** Pick it if the synthesised engine still
> sounds like an angry wasp after one evening — a real recording is instantly more
> convincing, and Howler smooths over sprite handling and mobile unlock quirks. **This is a
> genuine timeboxed decision point in M6**, not a hypothetical; synthesis is a rabbit hole.
> A hybrid also works: synth for the engine, samples for one-shots (kerbs, collisions).

## Testing — Vitest, on logic only

Shares Vite's config and transform pipeline, so there's no second toolchain. Runs in Node
in milliseconds.

**Test only what's deterministic and worth breaking a build over:**

- `core/loop` — accumulator maths, clamping, interpolation alpha
- `physics/` — pure functions; tyre curve shape, integration sanity, no `NaN` under
  extreme inputs
- `game/` — lap counting and position sorting, including start/finish wraparound (the
  bug-prone part)
- `track/query` — distance-along-track correctness

**Don't test rendering.** Snapshot-testing a WebGL scene is high-maintenance and low-value;
you verify visuals by looking at them. Don't chase coverage — this is a game, and the real
test is driving it.

> **Alternative: Playwright.** Add one smoke test ("page loads, canvas exists, no console
> errors, FPS > 30 after 3 seconds") if the deploy pipeline ever ships something broken.
> Cheap insurance, but not worth setting up before it's needed.

## Deploy — GitHub Pages + GitHub Actions

The build is pure static files. Pages is free, needs no third-party account, lives beside
the code, and the workflow is ~20 lines. Set it up in M0 so deployment is never a week-four
surprise.

> **Alternative: Cloudflare Pages or Netlify.** Pick either if you want **per-branch
> preview URLs** — genuinely useful for sending "does this handling feel better?" builds to
> a friend without touching the main deploy. Both have better edge networks too, irrelevant
> at this scale. Migration is a 10-minute job later; not worth the extra account now.

---

## Summary

| Area      | Choice                      | Switch when                                               |
| --------- | --------------------------- | --------------------------------------------------------- |
| Language  | TypeScript (strict)         | Types cost more than they save → JS + JSDoc               |
| Build     | Vite                        | Want zero config → Parcel                                 |
| Rendering | Three.js                    | Want a built-in inspector → Babylon.js                    |
| Physics   | Custom 2D bicycle model     | Moving toward true sim → Rapier                           |
| State     | Mutable `World` + event bus | UI state grows past ~5 screens → Zustand (UI only)        |
| Audio     | Web Audio synthesis         | Engine note won't sound right → Howler + samples          |
| Testing   | Vitest on logic             | Deploy ships something broken → add Playwright smoke test |
| Deploy    | GitHub Pages                | Want preview URLs → Cloudflare/Netlify                    |

**Runtime dependencies: two.** Three.js, plus `lil-gui` for the live tuning panel — and
that one is behind a dynamic `import()`, so it ships as its own chunk that a player who
never presses `T` never downloads. Everything else is build-time. Keeping this list
short is deliberate: for a solo project, every dependency is a thing that can break at
11pm on a Tuesday.
