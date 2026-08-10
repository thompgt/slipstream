# Slipstream

Browser F1 **simulator**. TypeScript + Vite + Three.js, deployed static.
Design docs: `PLAN.md` (milestones), `ARCHITECTURE.md` (detail), `STACK.md` (choices).

## Direction: simulation, not arcade

**This is the single most important thing to know before changing anything.**

The project began as an arcade-sim and the early commits reflect that. It is not
that any more. The target is a modern Codemasters-style F1 game — the look, the feel,
and the weight of a real Formula 1 car — and the one place it should beat those games
is damage, which they model far too forgivingly.

When a decision is between "reads well immediately" and "behaves like the real thing",
choose the real thing. Anything that exists purely to flatter the player is wrong here.

### What that means visually

The current build looks like a prototype: flat lighting, untextured boxes, a wireframe
grid, one hardcoded red car. Everything below is the direction to move in, not a
description of what exists.

- **Photographic, not stylised.** Physically-based materials, real-world albedo values,
  an sRGB/ACES tone-mapped pipeline, correct exposure. No flat-shaded primaries, no
  neon, no cel shading, no fantasy skies.
- **Light like a broadcast.** Sun angle and colour temperature belong to a real time of
  day at a real circuit. Soft shadows under the cars, ambient occlusion in the cockpit
  and around bodywork, sharp speculars off carbon and paint.
- **Real proportions.** A 2026 car is ~5.6m long, ~2.0m wide, ~0.97m tall on 18-inch
  wheels. Track width, kerb height, barrier height, run-off distances, marshal post and
  bridge spacing are all real dimensions, not eyeballed.
- **The trackside sells the speed.** Kerbs, white lines, sponsor boards, tyre stacks,
  catch fencing, grandstands, trees. An empty ribbon of tarmac reads as slow no matter
  how fast the car is going.
- **Motion and camera are broadcast-grade.** Chase, T-cam and cockpit views matching
  real camera positions; subtle shake that scales with kerb and impact; speed-dependent
  FOV; motion blur and heat haze where there is budget for them.
- **Damage is visible.** Wings that bend and detach, scarred bodywork, punctures that
  deflate, sparks off the plank, debris that stays on track. If the physics models a
  failure, the player must be able to see it.

### What that means in feel

- Weight and inertia — the car should feel like 800kg, never like a go-kart.
- No hidden assists. Understeer, oversteer, snap, and lockup emerge from the model.
- Tyres, fuel, brakes and damage all degrade, and the player should feel it happening.
- Assists exist for accessibility and are explicit, off by default, and shown in the UI.

### The tension to respect

`PLAN.md` and `STACK.md` were written under an arcade-sim brief and a 50-hour budget,
and some of their reasoning no longer applies — the four-wheel physics model already
supersedes the "2D bicycle model" they describe. Where those docs conflict with this
section, **this section wins**, but say so explicitly in the commit rather than leaving
the contradiction for someone to trip over.

The performance budget below is the one thing that does not bend. Simulation quality
that drops the game under 60fps is not a win.

## Commands

| Command                       | Purpose                                           |
| ----------------------------- | ------------------------------------------------- |
| `npm run dev`                 | Vite dev server with HMR                          |
| `npm run check`               | typecheck + lint + test — run before every commit |
| `npm run test` / `test:watch` | Vitest                                            |
| `npm run build` / `preview`   | Production build / serve it locally               |
| `npm run format`              | Prettier write                                    |

## Module boundaries

Enforced by dependency direction — a module may import only from its "may import" list.

| Module     | Responsibility                            | May import      |
| ---------- | ----------------------------------------- | --------------- |
| `core/`    | loop, `World`, event bus, math, input feel | nothing        |
| `physics/` | vehicle model, tyres, suspension, damage  | `core`          |
| `track/`   | spline → mesh, surface + distance queries | `core`          |
| `input/`   | keyboard/gamepad → `InputState`           | `core`          |
| `ai/`      | racing line → `InputState`                | `core`, `track` |
| `game/`    | race rules, laps, positions               | `core`, `track` |
| `render/`  | Three.js scene, chase camera              | `core`, `track` |
| `ui/`      | HUD, debug overlay (DOM)                  | `core` + types  |
| `audio/`   | Web Audio graph                           | `core`          |

`src/main.ts` is the composition root and the only file that sees the whole graph.

The one sanctioned exception is `ui/tuningPanel.ts`, a dev-only lazy chunk that tunes
the car, the input feel, and the camera at once. It imports **types** from all three
and is handed the live objects, so nothing in the simulation path gains a dependency
from it existing.

**`physics/` importing Three.js is a bug** — it must stay pure so it runs in Node.
`render/`, `ui/`, and `audio/` **read world state and never write it**; if they could,
the simulation would depend on framerate.

## The fixed-timestep rule

Physics advances **only** in slices of exactly `FIXED_DT` (`core/loop.ts`, 60Hz), never
by a variable frame delta — tyre-slip integration is not linear in `dt`, so variable
steps make the car feel different on different machines. Frame deltas are clamped to
`MAX_FRAME_DELTA` (250ms) so a backgrounded tab can't run hundreds of steps at once;
the sim loses time instead, which is always the right trade.

Rendering is decoupled: it draws **interpolated** state between the two most recent
physics steps using `alpha`. Hence `previousPosition` / `previousHeading` on `Car` —
snapshot them at the top of each step. Never render the raw latest state; it stutters.

**Game timing reads `world.time`** (accumulated sim time), never `performance.now()`.

## Conventions

- TS strict, incl. `noUncheckedIndexedAccess` — array access is `T | undefined`, guard it.
- `import type` for type-only imports (lint-enforced).
- No semicolons, single quotes, 100 cols, trailing commas. Prettier owns formatting.
- Factory functions returning interfaces (`createLoop`, `createRenderer`); no classes.
- `World` is plain and mutable by design — no immutable state libs in the sim path;
  60Hz allocation causes GC hitching.
- Tuning numbers live with the module they belong to, one file each:
  `physics/carSetup.ts` (the car), `core/feel.ts` (how it's driven),
  `render/cameraSetup.ts` (how it's watched). Splitting them this way is what keeps
  `input/` and `render/` from importing `physics/`.
- Test logic only (loop, physics, laps, track queries). Never snapshot-test rendering.
- Comments explain _why_, especially non-obvious tradeoffs. Don't narrate the obvious.
- Perf budget: ≤150 draw calls, ≤120k triangles, no shadow cascades. Safari is the
  tightest target — check there, not just Chrome.
- Commit small and often, push each logical unit.
