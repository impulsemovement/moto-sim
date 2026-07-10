# Session kickoff prompts

One self-contained brief per work stream. To launch a stream: start a fresh session **in that
stream's worktree folder** (see `MERGES.md` for the map) and paste the **Shared rules** block
followed by that stream's **Prompt** block. Each is written to be understood cold.

Physics core merges first each cycle; everyone else rebases onto it. Wave 2 waits for a trustworthy
physics core.

---

## Shared rules (paste at the top of EVERY session)

```
You're joining a multi-session build of a browser-based MT-07 motorcycle suspension simulator
(2D real-time physics, no build step, classic global-scope scripts, hosted on WordPress via iframe).

READ FIRST: CLAUDE.md in the repo root. It is law. Pay special attention to "Parallel-work protocol
— HARD RULES". Summary of the rules that get broken most:

1. FILE OWNERSHIP IS ABSOLUTE. Only edit the files your stream owns (listed in your brief and in
   CLAUDE.md). If your work needs a change in someone else's file, STOP — do not edit it. Write the
   exact change you need in your final summary; the integration session applies it.
2. NEVER bump `?v=` in index.html. Integration does one consolidated bump at merge. (Version bumps
   are the #1 merge conflict.)
3. NEVER commit .claude/launch.json (it's gitignored — it holds machine-specific paths/ports).
4. test/validate.js is APPEND-ONLY: add your regression scenario as a new named function at the end
   of the `scenarios` array. Never modify an existing scenario or a shared helper.
5. New integrated physics state needs THREE homes: declared in core-state.js, added to
   captureState()/applyState(), AND reset in resetSim() (main.js — UI's file, so FLAG it).
6. GREEN HARNESS OR IT DOESN'T LAND. Run index.html?test=1 (or MotoValidate.run()) and confirm every
   check passes before you commit. Never weaken a threshold to make it pass. If your change
   legitimately alters expected behavior, update the scenario and explain why.
7. Don't merge to mainline yourself. Commit to your branch; the integration session merges and logs it.

Gotchas: initPhysics() settles on the current P.terrain, so set P BEFORE resetSim(). Y is DOWN.
Gears are 0–5 = 1st–6th, there is no neutral. Rim bottoming must compress the suspension DOF, never
pin the chassis. The rAF loop steps physics — set paused=true before driving simStep() in evals.

Verify in the browser preview (drive via simStep(0.016)+draw(), screenshot). Don't ask me to check
manually. Commit with trailer: Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Match the surrounding code style: dense "why" comments, SI units, // ═══ banner sections.
```

---

## Wave 1

### 1 — Physics core
```
STREAM: Physics core.

YOU OWN:    js/physics.js (contact, suspension, chassis — everything except the drivetrain block)
            js/core-state.js
            physics constants in js/core-params.js (NOT the engine constants)
NEVER TOUCH: the drivetrain block in physics.js (Engine's), audio.js, core-track.js, core-terrain.js,
            core-curves.js, core-config.js, ui.js, main.js, render.js, background.js, graphs.js,
            index.html, styles.css
ESCALATE:   need a resetSim() line (main.js is UI's) → write it in your summary, don't edit.

This is the coupled integrator — tires, suspension, and chassis are ONE loop. Work them as sequential
sub-tasks, never in parallel. Sub-stepped explicit Euler (MAX_SUBSTEP 0.005s). DOFs: surge, heave,
pitch, fork slide (forkSlide_f), swingarm rotation (swingAngle), wheel spins, engine.

Rule that keeps getting re-broken: rim bottoming (resolveTireBottom) must COMPRESS the suspension DOF,
never pin the chassis — pinning freezes travel (the historical "lockout" bug class).

KNOWN NEXT TASK: static sag is too soft — fork sits at 43% and rear at 50% of travel at rest; street
norm is 25–35%. No stream changed P defaults/springs/mass, so this is a genuine calibration gap.
Calibrate the suspension against real MT-07 figures (the way Engine calibrated ENGINE_K to the real
CP2's ~68 N·m), and ADD a harness scenario asserting static sag stays in the street range. This is on
the critical path for the Wave 2 comparison widget — the stock bike must be right before we overlay
the aftermarket fork.

Start by reading physics.js end to end and summarizing the force path back to me before changing it.
```

### 2 — Engine & drivetrain (+ audio)
```
STREAM: Engine, drivetrain, and audio.

YOU OWN:    the drivetrain block inside js/physics.js (engine RPM / clutch / gearbox → wheel force)
            engine constants in js/core-params.js
            js/audio.js
NEVER TOUCH: contact/suspension/chassis code in physics.js (Physics core's), core-state.js beyond
            declaring engine state, core-track.js, core-terrain.js, core-curves.js, core-config.js,
            ui.js, main.js, render.js, background.js, graphs.js, index.html, styles.css
ESCALATE:   new integrated state (like shiftTimer) needs a resetSim() line in main.js (UI's) — declare
            it in core-state.js, wire captureState()/applyState(), and FLAG the resetSim line.

Context: engineRPM crank model, 6-speed gearbox (GEAR_RATIOS; gears 0–5 = 1st–6th, NO neutral),
clutch engages over CLUTCH_ENGAGE_TIME (releasing high revs = clutch-up wheelie), bouncing rev limiter
(RPM_LIMIT/LIMITER_BAND), idle creep + lug-stall state machine, reflected crank inertia, shift torque
cut + rev-match (SHIFT_CUT_TIME / SHIFT_MATCH_RATE). ENGINE_K is calibrated to the real CP2 (~68 N·m
at slider max). audio.js is a Web Audio parallel-twin note whose pitch tracks RPM.

The harness already covers rev-limiter bounce, idle/cruise-no-stall, and gear-shift mechanics. Keep
them green; append new scenarios for anything you fix.
```

### 3 — Terrain & course designer
```
STREAM: Terrain and the custom-track course designer.

YOU OWN:    js/core-track.js (custom-track data, rebuildCustomTrack, value noise)
            js/core-terrain.js (groundY_m, calcNaturalWY_m)
            the track-builder editor in js/graphs.js (drawTerrainEditor + feature palette/popup)
NEVER TOUCH: physics.js, core-state.js, core-params.js, core-curves.js, core-config.js, ui.js,
            main.js, render.js, background.js, index.html, styles.css
ESCALATE:   the minimap lives in render.js (Render's); the wall-collider contract is read by
            physics.js (Physics core's). Need either changed? Flag it, don't edit.

Context: terrain is a single-valued heightfield groundY_m(x); TERRAINS lists the presets (index =
P.terrain); Custom (index 7) composes an ordered list of feature segments that LOOPS. Solid features
register colliders in trackWalls, which physics.js reads for crash-&-endo.

GOTCHA: initPhysics() settles on the current P.terrain, so any reset must set P.terrain FIRST.

Append harness scenarios for any new terrain/feature type: no-NaN, wheels track the surface, rim stays
out of the ground, and the profile is continuous where it tiles.
```

### 4 — UI & controls (mobile / desktop / gamepad)
```
STREAM: UI, layout, and input.

YOU OWN:    js/ui.js, js/main.js, the HTML cards in index.html, css/styles.css
NEVER TOUCH: physics.js, core-state.js, core-params.js, core-track.js, core-terrain.js,
            core-curves.js, core-config.js, render.js, background.js, audio.js
SPECIAL:    You own resetSim() (in main.js). Other streams will ask you, via the integration session,
            to add reset lines for new integrated state (e.g. gearPrev/shiftTimer). Honour those —
            a missing reset silently breaks reproducibility and the A/B comparison.
REMINDER:   Do NOT bump ?v= in index.html, even though you own the file.

Context: inputs are keyboard (G gas, arrows brakes, B both, C clutch, A/D gear, R reset, P pause,
. step), on-screen buttons, a pointer input layer, pinch/wheel zoom, camera-pan drag. Setups (P +
damping curves + customTrack) save/load via localStorage in ui.js.

Remaining goal: PS4/DualShock support on desktop via the Gamepad API — map sticks/triggers/buttons to
gas, front/rear brake, clutch, shift, reset; poll in the rAF loop; add a "controller connected"
affordance. All control paths (keyboard, touch, gamepad) must drive the SAME input globals
(gasPressed/gasInput, brakeFrontHeld/brakeRearHeld/brakeBothHeld, clutchPulled, gear) so physics is
untouched.

The harness doesn't cover input UX — verify by driving the UI in the preview (preview_click/fill) and
screenshotting mobile + desktop widths (preview_resize). Don't regress the harness.
```

### 5 — Render / art / camera
```
STREAM: Rendering, art, and camera.

YOU OWN:    js/render.js (draw loop, camera, drawMinimap, bike/wheel drawing)
            js/background.js (parallax, scenery)
NEVER TOUCH: physics.js, core-*.js, ui.js, main.js, graphs.js, audio.js, index.html, styles.css
ESCALATE:   need a DOM element or a CSS class? Flag it — index.html/styles.css are UI's.

Context: chassis CoM sits at a fixed screen X (COM_SX); vertical follows terrain with a deadzone
(camY_m). Horizontal accel-lead and vertical parallax are DISABLED on purpose — both were janky.
Don't silently re-enable them; propose a plan first.

Purely visual — must not change physics, and the harness result must be identical before and after.
Verify with screenshots at several moments (launch, mid-air, hard landing) and both viewport widths.
```

---

## Wave 2 (after the physics core is trustworthy)

### 6 — Embeddable comparison widget (the commercial core)
```
STREAM: The stock-vs-aftermarket comparison widget — the reason this sim exists.

Goal: let a visitor compare a STOCK MT-07 against one with the owner's aftermarket FORK parts,
embedded on a WordPress page via iframe. The comparison is two P snapshots (see the parameter contract
in CLAUDE.md): the product maps to the FRONT fields (k_f, damp_f + the front damping-curve LUTs,
air_f). Design an A/B mode — run two physics states over the same terrain/inputs and show the
difference, highlighting fork behavior (travel used, harshness, bottoming, pitch under braking).

CRITICAL — correctness rests on reproducibility. Two facts from CLAUDE.md you must honor:
  • resetSim() must leave both bikes identical (it zeroes the lagged contact-force globals).
  • initPhysics() settles on the current P.terrain → set each bike's P BEFORE resetting it.
If the two bikes ever diverge from identical inputs, STOP and fix that first. A wrong comparison is
worse than none. Append an A/B determinism scenario to the harness.

Do NOT start until Physics core confirms the fork model and the static-sag calibration are stable.
Also owns: the minified/embeddable build path and the iframe/WordPress integration.
```

### 7 — Educational / tutorial layer
```
STREAM: The "learn something" layer — the hook that makes people stay and come back.

Goal: turn the sim into a teaching tool — guided scenarios ("feel too little rebound damping", "why
the front dives under braking"), on-screen annotations explaining what each setup change does,
before/after demos, a short interactive tutorial.

Mostly additive UI + copy on a stable sim. index.html/styles.css are UI's and overlays touch render.js
— coordinate through the integration session rather than editing them. Must not change physics or
regress the harness. Lean on existing telemetry (force/velocity graphs, travel stats) to make the
physics legible.

Read CLAUDE.md's parameter contract first so every explanation is physically accurate, then propose a
small first lesson and build it end to end.
```
