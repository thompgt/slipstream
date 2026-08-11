# Slipstream

A Formula 1 simulator that runs in the browser, built out in the open. The aim is the
weight and feel of a real car, and — eventually — the component damage model the big F1
games never quite commit to. What exists today is a car with a hand-rolled tyre model and
a lap of Monza to drive it round. Damage is the destination, not a feature you can drive
yet.

TypeScript · Vite · Three.js · custom vehicle physics · no install, static deploy.

## Tech Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white)
![WebGL](https://img.shields.io/badge/WebGL-990000?style=for-the-badge&logo=webgl&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white)

> **Status: M2 done — you can drive Monza.**
>
> **The car (M1).** A Pacejka tyre curve, per-axle friction ellipse, load solved per wheel,
> aero, and an 8-speed gearbox. You can provoke a slide and catch it, and trail braking
> rotates the car — asserted as a regression test, not just claimed.
>
> **The circuit (M2).** Monza is authored as straights and arcs, splined into an
> evenly-sampled centreline, and queried in constant time for distance-along-lap, lateral
> offset and surface. That one sample table feeds all three of: the road you see, the laps
> you are credited with, and the grip under your tyres — so running wide onto the grass
> costs you the car, and putting it in the gravel costs you the lap.
>
> **The look.** ACES-tone-mapped, lit by a sun at a real time of day with soft shadows
> under the car. The car itself is built to 2026 regulations — 5.6m long, 2.0m wide, 0.97m
> tall on 18-inch wheels — with lofted bodywork, cambered wings, a halo and wishbones at
> each corner. Barriers, sponsor boards, tyre stacks, marshal posts and the Monza treeline
> are generated from the same sample table as the road, because an empty ribbon of tarmac
> reads as slow however fast you are actually going.
>
> **The shots.** Three cameras on **C**: a sprung chase that lags on purpose, the T-cam on
> the roll hoop, and the halo cam at the driver's eyeline. The onboard pair are bolted to
> the bodywork, so the horizon tilts when the car does, and both pick up a vibration that
> scales with speed and with how rough what you are driving on is.
>
> **Not there yet.** The barriers are scenery, not collision — you can still drive off into
> the trees and back. No other cars, no flags, no sectors on screen. AI and race rules are
> next; see [PLAN.md](PLAN.md).

Play it: **<https://thompgt.github.io/slipstream/>**

## Quick start

```bash
npm install
npm run dev
```

Then open the printed URL. You start on the line at Monza, pointing up the main straight.
Drive with **WASD** or the **arrow keys**, **space** for the handbrake, or plug in a
gamepad. **C** cycles the cameras — chase, the T-cam on the roll hoop, and the halo cam at
the driver's eyeline; the two onboard shots lean with the car and pick up the kerbs.
**`** toggles the telemetry overlay — lap, current, last and best, plus how far
round you are and what you are standing on. **R** puts you back on the line, and **T**
opens the live tuning panel, where every slider changes the car on the next physics step.

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
lifted inside wheel already mean something. Per-wheel slip is the next step. The circuit
reaches the physics as exactly two numbers — a grip multiplier and a drag multiplier — so
the vehicle model still runs in Node with no track at all, which is what keeps it testable.

## Licence

MIT
