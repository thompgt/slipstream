# Slipstream

A Formula 1 simulator that runs in the browser, built out in the open. The aim is the
weight and feel of a real car, and — eventually — the component damage model the big F1
games never quite commit to. What exists today is the first half of that: the car and the
track pipeline. Damage is the destination, not a feature you can drive yet.

TypeScript · Vite · Three.js · custom vehicle physics · no install, static deploy.

## Tech Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white)
![WebGL](https://img.shields.io/badge/WebGL-990000?style=for-the-badge&logo=webgl&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white)

> **Status: M2 — the track pipeline.**
>
> **The car (M1, done).** A Pacejka tyre curve, per-axle friction ellipse, load solved per
> wheel, aero, and an 8-speed gearbox. You can provoke a slide and catch it, and trail
> braking rotates the car — asserted as a regression test, not just claimed.
>
> **The track (M2, built, not yet wired to the game).** Circuits are authored as straights
> and arcs, splined into an evenly-sampled centreline, and queried in constant time for
> distance-along-lap, lateral offset and surface. Monza is in, and tested. What is missing
> is the last step: `World.track` is still `null`, nothing extrudes the road into geometry,
> and the physics does not yet read surface grip. **So the live build is still the M1 car on
> an empty plane** — the circuit exists in the code and the tests, not under the wheels.
>
> AI, laps and race rules are next. See [PLAN.md](PLAN.md).

Play it: **<https://thompgt.github.io/slipstream/>**

## Quick start

```bash
npm install
npm run dev
```

Then open the printed URL. Drive with **WASD** or the **arrow keys**, **space** for the
handbrake, or plug in a gamepad. **`** toggles the telemetry overlay, **R** resets the
car, and **T** opens the live tuning panel — every slider changes the car on the next
physics step.

## Commands

| Command             | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Dev server with hot reload                    |
| `npm run check`     | Typecheck + lint + test — run before a commit |
| `npm run typecheck` | `tsc --noEmit`                                |
| `npm run lint`      | ESLint, including the module-boundary rules   |
| `npm run test`      | Unit tests (Vitest)                           |
| `npm run build`     | Production build to `dist/`                   |
| `npm run preview`   | Serve the production build locally            |
| `npm run format`    | Format with Prettier                          |

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
vehicle model is hand-rolled rather than a rigid-body engine — cheaper, testable, and it
puts the tyre-grip curve directly under your fingers, which is where the handling feel
actually comes from. It began as a 2D bicycle model, which is still how the tyre forces are
evaluated; vertical load is now solved per wheel, so anti-roll bars, roll centres and a
lifted inside wheel already mean something. Per-wheel slip is the next step.

## Licence

MIT
