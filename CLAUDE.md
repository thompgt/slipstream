# Slipstream

Browser F1-style arcade-sim racer. TypeScript + Vite + Three.js, deployed static.
Design docs: `PLAN.md` (milestones), `ARCHITECTURE.md` (detail), `STACK.md` (choices).

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
| `physics/` | bicycle model, tyres, integration         | `core`          |
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
