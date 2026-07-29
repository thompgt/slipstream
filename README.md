# Slipstream

An F1-style arcade-sim racer that runs in the browser. Grippy but slidey — rewarding
trail braking and smooth throttle, not a full simulator.

TypeScript · Vite · Three.js · custom 2D vehicle physics · no install, static deploy.

> **Status: M0 — scaffold.** The toolchain, fixed-timestep loop, and debug overlay are in
> place. Vehicle physics, tracks, AI, and race rules are next. See [PLAN.md](PLAN.md).

## Quick start

```bash
npm install
npm run dev
```

Then open the printed URL. Drive with **WASD** or the **arrow keys**; **`** toggles the
debug overlay.

## Commands

| Command           | Purpose                            |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Dev server with hot reload         |
| `npm run check`   | Typecheck + lint + test            |
| `npm run test`    | Unit tests (Vitest)                |
| `npm run build`   | Production build to `dist/`        |
| `npm run preview` | Serve the production build locally |
| `npm run format`  | Format with Prettier               |

## Documentation

- **[PLAN.md](PLAN.md)** — milestones, definitions of done, risks, effort. Includes a
  reality check on the four-week scope.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — module boundaries, data flow, state ownership,
  and why the game loop is separate from the render loop.
- **[STACK.md](STACK.md)** — every tech choice with a credible alternative and the signal
  that should make you switch.
- **[CLAUDE.md](CLAUDE.md)** — conventions and rules, condensed.

## Design in one paragraph

Physics runs at a fixed 60Hz in slices of identical length, decoupled from rendering,
which interpolates between the two most recent simulation states. That keeps the car
feeling identical on a 60Hz laptop and a 144Hz monitor, stops a backgrounded tab from
exploding the simulation, and lets the whole sim run headlessly in Node under test. The
vehicle model is a hand-rolled 2D bicycle model rather than a rigid-body engine —
cheaper, testable, and it puts the tyre-grip curve directly under your fingers, which is
where the handling feel actually comes from.

## Licence

MIT
