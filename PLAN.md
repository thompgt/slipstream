# Slipstream — Build Plan

An F1-style arcade-sim racer for the browser. Solo dev, ~4 weeks of evenings.

An "evening" below means **~2 focused hours**. Four weeks of evenings is realistically
**40–60 hours** total, and that number is the constraint everything else bends around.

---

## Reality check on the goals

Read this before the milestones. Four things in the brief need adjusting.

### 1. Three circuits is the wrong thing to protect

A 3D chase-cam racer with custom physics, AI, and race structure will consume most of 50
hours before a second track exists. The fix is not to work faster, it's to **invest in the
track pipeline instead of the tracks**: author circuits as centreline splines that extrude
into geometry at load time, so circuit #2 costs ~3 hours of curve-dragging rather than
~15 hours of modelling.

Plan for **one excellent circuit shipped**, circuits 2–3 as stretch (M7). One circuit that
feels superb beats three that feel mushy — which matches the priority you picked.

### 2. "Rewards trail braking" is a tuning outcome, not a task

There is no ticket you close that makes trail braking feel good. It emerges from the
interaction of weight transfer, the tyre-slip curve, and how brake force is distributed
front/rear. You will get it wrong, drive it, and adjust — many times.

Budget **6–8 hours of pure tuning spread across the whole project**, not a task at the
end. This is the single most under-budgeted item in solo racing games. M1 exists to front-
load it.

### 3. Safari is the 60fps risk, not the laptop

Safari's WebGL driver is materially slower than Chrome's, and its audio autoplay policy is
stricter (Web Audio contexts start suspended until a user gesture — plan for a click-to-
start). Test in Safari **from M0**, not at the end.

Hard performance budget, set now:

- ≤ 150 draw calls per frame
- ≤ 120k triangles visible
- No real-time shadow cascades — one blob/projected shadow per car
- No post-processing until M6, and only if there's headroom

### 4. Do not use a rigid-body physics engine

Rapier and Cannon are excellent, and they are the wrong tool here. A general constraint
solver will fight you on exactly the controlled-slide behaviour you're asking for, and
you'd spend your time tuning solver parameters instead of tyre curves.

A hand-rolled **2D bicycle model** is cheaper to write, ~10× cheaper to run, trivially
unit-testable, and gives you direct control over the feel. Revisit only if the game moves
toward true simulation. See STACK.md.

---

## Milestone ordering

Ordered so there is something playable by **evening ~4**, and so the riskiest thing
(does the car feel good?) is answered first rather than last.

---

### M0 — Scaffold & deploy pipeline

**Effort: 1 evening**

Vite + TypeScript + Three.js boots. Fixed-timestep loop running. Debug overlay showing
FPS and step time. Vitest, ESLint, Prettier wired. GitHub Actions deploying to Pages.

**Done looks like:** a live public URL showing a ground plane and a box at a steady 60fps,
and `npm run check` passing.

**What could go wrong:** almost nothing — which is why it's first. Getting deploy working
on day one means it's never a nasty surprise in week four.

---

### M1 — Car in a void

**Effort: 3–4 evenings** ← _the important one_

The bicycle model: longitudinal and lateral forces, a tyre-slip curve, weight transfer
under braking and acceleration. Keyboard and gamepad input with analogue-feeling ramps on
digital keys. Chase camera with spring lag and speed-dependent FOV.

**Done looks like:** **driving around an empty plane is fun.** You can provoke a slide,
catch it, and feel the front end bite when you trail the brake into a turn. No track
needed — cones or nothing at all.

**What could go wrong:** this is the project's core risk. If the handling isn't fun here,
no amount of track detail rescues it. Two specific traps: (a) tuning the tyre curve
without a telemetry readout — use the debug overlay's key/value slots for slip angle, slip
ratio, and per-axle load from day one; (b) a camera that's too stiff, which reads as "no
speed" and gets misdiagnosed as a physics problem.

**Do not move to M2 until M1 is fun.** If it takes 6 evenings instead of 4, take them and
cut a circuit. That's the trade you already chose.

---

### M2 — Track pipeline

**Effort: 3 evenings**

Circuit stored as a centreline spline with per-node width and banking. At load: extrude
into a road ribbon mesh, generate kerbs and run-off, and build a lookup structure mapping
world position → surface type, distance-along-track, and lateral offset.

**Done looks like:** one closed circuit you can drive, with a real grip penalty for going
off, and a query that answers "where is this car on the track?" in constant time.

**What could go wrong:** spline authoring ergonomics. Hand-editing control points in JSON
is miserable and will silently eat evenings. Build a crude in-browser editor (drag points,
press S to dump JSON) — half an evening that pays for itself immediately.

That distance-along-track lookup is not just for lap counting: **AI, standings, respawn,
and rubber-banding all depend on it.** Get it right here.

---

### M3 — It's a game

**Effort: 2 evenings**

Checkpoints, lap timing, sector splits, best/last lap, restart-to-grid, a real HUD.

**Done looks like:** you can set a lap time, then try to beat it — and want to. **First
genuinely shareable build.** Send it to someone.

**What could go wrong:** checkpoint validation that lets you cut the track, or that
false-negatives on a wide racing line. Validate with distance-along-track monotonicity
rather than trigger volumes.

---

### M4 — AI opponents

**Effort: 4 evenings**

A racing line (offset spline, hand-tuned), a target speed profile derived from local
curvature and the car's own grip limit, a controller converting that to the **same input
struct a human produces**, plus overtaking, avoidance, and rubber-banding.

**Done looks like:** five AI cars run a clean, believable 3-lap race, finish within a few
seconds of each other, and don't rear-end you under braking.

**What could go wrong:** the classic failure is AI that's either metronomically perfect or
crashes constantly. Rubber-banding reads better than genuinely fast AI and is far cheaper
— tune the band so you're always racing _someone_. Second trap: AI that follows the racing
line so rigidly it drives through you. Lateral offset for avoidance, blended by proximity,
is the cheap fix.

Because AI emits the same struct as the human input layer, you can **record a good lap of
your own and replay it as a benchmark opponent** — a free sanity check on AI pace.

---

### M5 — Race structure

**Effort: 2 evenings**

Starting grid, countdown lights, live position calculation, lap counter, blue/chequered
flags, results screen with gaps.

**Done looks like:** a complete 3-lap race from lights out to classification.

**What could go wrong:** position calculation is subtler than it looks — it's
`(laps × trackLength) + distanceAlongTrack`, sorted, with care at the start/finish
wraparound. Get this wrong and standings flicker every lap.

---

### M6 — Audio & feel polish

**Effort: 3 evenings**

Synthesised engine note driven by RPM, tyre scrub tied to slip magnitude, wind, kerb
rumble. Particles for dust and lock-ups, skid marks, camera shake, speed-dependent FOV
tightening.

**Done looks like:** it feels fast at 140kph, not just at 240.

**What could go wrong:** engine synthesis is a rabbit hole. Timebox it to one evening; if
it still sounds like a wasp in a jar, switch to layered looping samples (see STACK.md).
Polish work also expands to fill available time — timebox it hard, because it competes
directly with M7.

---

### M7 — Circuits 2 and 3 — _stretch_

**Effort: 2–3 evenings**

Only if M1–M6 landed clean. If the pipeline in M2 was built well, this is spline authoring
plus a palette swap. If M2 was rushed, this milestone silently becomes 8 evenings — which
is exactly why it's last and optional.

---

### Continuous — tuning

**Effort: 6–8 hours, spread throughout**

Not a milestone. Every session, drive for five minutes before you start and note what felt
wrong. Keep tuning constants in one file so a pass is fast.

---

## Rough schedule

| Week | Milestones           | Playable state at end of week     |
| ---- | -------------------- | --------------------------------- |
| 1    | M0, M1               | Car that's fun to drive in a void |
| 2    | M2, M3               | Time-attack on one real circuit   |
| 3    | M4, M5               | Full race vs AI                   |
| 4    | M6, then M7 if clear | Polished single-circuit racer     |

**If you're behind at end of week 3:** cut M7 entirely, keep M6. A polished one-circuit
racer is a finished game. A rough three-circuit one is a prototype.
