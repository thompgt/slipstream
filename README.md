# Slipstream

A Formula 1 simulator that runs in the browser. Four-wheel vehicle physics, real
circuits, and the component damage model the big F1 games never quite commit to.

TypeScript · Vite · Three.js · custom vehicle physics · no install, static deploy.

## Tech Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white)
![WebGL](https://img.shields.io/badge/WebGL-990000?style=for-the-badge&logo=webgl&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white)

> **Status: M1 — the car.** A 2D bicycle model with a Pacejka tyre curve, per-axle
> friction ellipse, weight transfer, aero, and an 8-speed gearbox. You can provoke a
> slide and catch it, and trail braking rotates the car. Tracks, AI, and race rules are
> next. See [PLAN.md](PLAN.md).

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
