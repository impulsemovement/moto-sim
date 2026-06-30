# MT-07 Suspension Simulator — project contract

A browser-based 2D real-time motorcycle suspension simulator. **No build step.** Classic
(non-module) scripts in global scope, hand-written SI-unit physics, hosted on a WordPress site via
an `<iframe>`. The commercial goal: let riders compare a **stock MT-07** against one with the
owner's **aftermarket fork parts** installed, and learn how suspension setup changes behaviour.

This file is the **single source of truth** for conventions, the module/ownership map, the
parameter contract, and the validation harness. Parallel work sessions must observe it. If you
change a convention here, that is a deliberate cross-cutting decision — call it out.

---

## Run / preview / deploy

- **Run locally:** open `index.html` in a browser, or serve the folder and open it. No bundler.
- **Validation harness:** open `index.html?test=1` → the harness auto-runs and prints a PASS/FAIL
  table to the console (and an on-page overlay). See "Validation harness" below. It is **not**
  loaded in normal (`?test` absent) page loads, so production is unaffected.
- **Cache-busting:** every `<script>`/`<link>` in `index.html` carries `?v=N`. **Bump `N` on every
  deploy** (single find-replace across `index.html`), or the WordPress/iframe cache serves stale JS.
- **Deploy:**
  ```sh
  rm -f moto-sim-site.zip && zip -qr moto-sim-site.zip index.html css/styles.css js/*.js
  ```
  then commit and push. Working branch: `rigid-body-and-ui-features`.
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Architecture & load order

Scripts load in this order (declared in `index.html`); later files depend on globals from earlier:

```
core.js → physics.js → render.js → graphs.js → ui.js → background.js → audio.js → main.js
```

| File | Owns | Notes |
|---|---|---|
| `js/core.js` (956 ln) | constants, the `P` parameter object, **all physics state globals**, `groundY_m`, `calcNaturalWY_m`, custom-track data + `rebuildCustomTrack`, terrain, value-noise, Catmull-Rom curve LUTs, rewind capture/restore | **CROSS-CUTTING — the #1 collision file.** Splitting it is the next foundational task (see ownership map). |
| `js/physics.js` (1058 ln) | `simStep`/`_physicsStep` integrator, `initPhysics` (static equilibrium), contact resolution (`resolveTireBottom`, chassis-body contacts), swingarm kinematics, damping force | The coupled core. **One owner at a time.** |
| `js/render.js` (629 ln) | `draw` loop, screen-coordinate helpers, camera (`camY_m`, pan), `drawMinimap`, wheel/bike drawing | |
| `js/graphs.js` (493 ln) | force/velocity history graphs, damping-curve editor, **custom-track builder editor** | |
| `js/ui.js` (247 ln) | save/load setups (localStorage), gas/brake buttons, legend toggles, collapsible cards | |
| `js/background.js` (406 ln) | Arizona parallax background, scenery (cacti, rocks, mesas, mountains) | Vertical parallax is intentionally **disabled**. |
| `js/audio.js` (138 ln) | Web Audio engine note, tire-slip / stall sounds | |
| `js/main.js` (220 ln) | startup, reset/pause/step/rewind/zoom buttons, camera-pan drag, key bindings | |
| `index.html` + `css/styles.css` | DOM cards + layout | **CROSS-CUTTING** — every feature adds a card here. |

### Public API surface (globals used to drive / inspect the sim)
- `simStep(dt_s)` — advance physics by `dt_s` (internally sub-stepped at ≤5 ms).
- `draw(ts)` — render one frame (the rAF loop; calls `simStep` unless `paused`).
- `resetSim()` — reset all dynamic state, keep `P`, re-solve equilibrium via `initPhysics()`.
- `initPhysics()` — solve static sag for current `P`. **Gotcha:** it runs a 500-step settle on the
  CURRENT `P.terrain`, so set `P` (terrain, springs, etc.) **before** calling `resetSim()` — otherwise
  the bike settles on the previous profile. The A/B comparison must apply each bike's `P` *before*
  resetting it.
- `paused` (bool), `stepRequested` (bool) — frame control.
- `P` — the parameter object (below). `TERRAINS` — terrain-name list (index = `P.terrain`).

---

## Physics conventions — DO NOT violate silently

- **Units: SI throughout** (m, kg, s, N, rad). `_m` suffix = meters.
- **Y is DOWN.** Positive Y / positive velocity = downward. A wheel "penetrating" the ground has
  `wheelY > groundY`. Lifting the chassis = *decreasing* `chassisY_m`.
- **Terrain is a single-valued heightfield** `groundY_m(x)` — wheels roll over whatever it returns
  (`calcNaturalWY_m` rolls a wheel of radius `r` over it). There are no overhangs; steep faces
  launch the bike unless they are registered `trackWalls` (solid features).
- **Degrees of freedom:** surge (`vChassisX`), heave (`chassisY_m`/`vChassis`), pitch
  (`pitchAngle`/`pitchRate`), **front fork slide** (`forkSlide_f`, negative = compressed),
  **rear swingarm rotation** (`swingAngle`), plus wheel spins (`omega_f`, `omega_r`) and the engine.
- **Front fork** is telescopic along the fork axis `φ_f = RAKE_RAD − pitchAngle`. Damping acts along
  that axis. `forkSlide_f ∈ [−TRAVEL_MAX, +TRAVEL_EXT]`; `−TRAVEL_MAX` is the hard bottom.
- **Rear** is swingarm rotation about a chassis-frame pivot through a rising-rate rocker linkage
  (`lkSolve`). Larger `swingAngle` (φ) ⇒ wheel lower ⇒ MORE extended; `PHI_FULL_BUMP` = bottomed,
  `PHI_REST` = unloaded, `PHI_FULL_DROOP` = topped.
- **Rim bottoming** (`resolveTireBottom`): the tire carcass deflects up to `TIRE_TRAVEL_F/R`; past
  that the rim hits dirt. Resolution is **inelastic** and must **compress the suspension DOF** (fork
  / swingarm), NOT pin the chassis — pinning froze the suspension short of full travel (the
  "lockout" class of bugs). Once the suspension is fully bottomed it becomes a rigid dead-stop that
  arrests the chassis and ejects the penetration vertically. **This is fragile, regression-prone
  code — always run the harness after touching it.**
- **Integration:** explicit Euler, sub-stepped at `MAX_SUBSTEP = 0.005 s` for stability (tire
  spring ~300 kN/m, unsprung ~13 kg ⇒ ω≈152 rad/s).
- **Camera:** chassis CoM sits at a fixed screen X (`COM_SX`); vertical follows terrain with a
  deadzone (`camY_m`). Horizontal accel-lead and vertical parallax are currently **disabled**.

---

## Parameter contract (`P`) — the comparison feature depends on this

`P` holds everything a setup can change. The stock-vs-aftermarket comparison is two `P` snapshots.
**The fork-parts product maps to the FRONT fields** — keep these physically meaningful and isolated
so a stock/aftermarket A/B is a clean parameter swap:

| Field | Meaning | Notes |
|---|---|---|
| `k_f`, `k_r` | spring rate (N/mm in slider; ×1000 → N/m) | front / rear |
| `pre_f`, `pre_r` | preload (mm) | |
| `damp_f`, `damp_r` | damping gain (× the curve-editor LUT) | **the fork parts' headline change** |
| `air_f` | front air gap / progression (0–1) | front-only progression |
| `k_tire_f/r`, `psi_f/r`, `m_unsprung_f/r` | tire spring (from psi), pressure, unsprung mass | `psiToKtire`, narrow 280–340 kN/m by design |
| `mass` | rider+luggage added mass | total = `184 + P.mass` |
| `terrain`,`amp`,`freq`,`rough`,`duty` | terrain selection + shape | index into `TERRAINS` |
| `timeScale`,`speed` | sim time scale, cruise-target speed | `speed` is a TARGET, not set directly |
| `pitchMoment`,`drivePitch`,`tireGrip` | bump→pitch scale, load-transfer pitch, surface grip | |
| `bottomBounceF/R` | bottom-out restitution | 0 = dead |

Damping curves (the per-wheel comp/rebound LUTs in `graphs.js`) are **part of a setup** alongside
`P` and `customTrack`; serialize them together (see `ui.js`).

---

## Validation harness — the contract that makes parallel work safe

`test/validate.js` runs a battery of scenarios against the live globals and asserts thresholds.
**Any session that touches physics, terrain, or the parameter model must keep `?test=1` green
before merging.** It checks, among others:

- No `NaN` in any state var, per scenario and across a long mixed-input sweep.
- Front/rear tire penetration into the ground stays under threshold on hard landings.
- Fork **and** rear reach full travel on hard hits (no lockout) but use only partial travel on
  gentle bumps (not stuck bottomed).
- Flat-drop landings settle with no chassis "teleport".
- Rev limiter bounces below its ceiling; neutral idle does not stall; the engine revs up.
- **Determinism:** identical inputs ⇒ identical final state (guards against accidental nondeterminism).

Run it: `index.html?test=1`, read the console table, or call `MotoValidate.run()` in the console.
Add a scenario when you fix a class of bug so it can't regress.

---

## Ownership map for parallel sessions

Work is split along **file seams**, not physics sub-systems (tires/suspension/chassis are one
coupled loop — they cannot be edited in parallel). Sequencing:

**Wave 0 — Foundation (do first; unblocks the rest).** This file + the harness (done). Remaining:
split `core.js` into per-domain files (geometry/constants, `P`+params, physics-state, terrain,
curves) and component-ize the HTML cards, so the streams below stop colliding.

**Wave 1 — parallelizable after Wave 0:**
- **Physics core** — `physics.js` + physics constants. *One owner.* Tire/suspension/chassis are
  sequential sub-tasks here, each gated by the harness.
- **Engine & drivetrain (+ audio)** — engine/clutch/gearbox model + `audio.js`.
- **Terrain & course designer** — `groundY_m`, custom-track data, `graphs.js` editor.
- **UI & controls** — `ui.js`, HTML cards, `styles.css`, input layer; mobile touch + desktop +
  **PS4 gamepad** (Gamepad API).
- **Render / art / camera** — `render.js`, `background.js`.

**Wave 2 — depends on a trustworthy core:**
- **Embeddable comparison widget** (stock vs. aftermarket fork) — A/B mode + minified build +
  WordPress/iframe integration. Credibility rests on front-fork model fidelity + the harness.
- **Educational / tutorial layer** — annotations and guided "learn something" scenarios.

**Coordination:** branch per stream; the harness must pass before merge; **physics core merges
first each cycle** and everyone rebases onto it; this file is law.

---

## Coding conventions

- Match the surrounding code: dense, explanatory comments that say *why* (the physics rationale),
  SI units, the `// ═══` banner style for sections.
- Classic scripts, global scope, `'use strict'`. No imports/exports, no framework.
- Keep new state in `resetSim()` and the rewind capture/restore lists in sync with any new
  integrated variable, or rewind/reset will desync.
