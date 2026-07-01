# Session kickoff prompts

One self-contained brief per work stream. To launch a stream: start a fresh Claude Code session in
this repo and paste the **Shared rules** block followed by that stream's **Prompt** block. Each is
written to be understood cold — a new session has none of this conversation's context.

Sequencing: **Wave 1** streams can run in parallel now. **Wave 2** streams depend on a trustworthy
physics core — start them once Physics core + the harness are stable. Physics core merges first each
cycle; everyone else rebases onto it.

---

## Shared rules (paste at the top of EVERY session)

```
You're joining a multi-session build of a browser-based MT-07 motorcycle suspension simulator
(2D real-time physics, no build step, classic global-scope scripts, hosted on WordPress via iframe).

READ FIRST: CLAUDE.md in the repo root — it's the single source of truth for conventions (SI units,
Y-down, the DOF list), the module/file-ownership map, the `P` parameter contract, and deploy steps.
Follow it; don't silently change a convention.

Ground rules for parallel work:
- Work ONLY in the files your stream owns (listed in your brief and in CLAUDE.md). If you believe you
  must change a shared file (core-config.js, index.html, css/styles.css) or another stream's file,
  STOP and flag it in your summary instead of editing — those are coordination points.
- The validation harness is the contract. Before you consider anything done, run it: open
  index.html?test=1 in the preview and confirm ALL checks pass (or call MotoValidate.run()). If your
  work legitimately changes expected behavior, update the relevant scenario in test/validate.js and
  explain why. Never merge with the harness red.
- Verify in the browser preview with the preview_* tools (drive the sim via simStep(0.016) + draw(),
  screenshot to confirm). Don't ask the user to check manually.
- Deploy each change: bump ?v=N across index.html (single find-replace), rebuild the zip
  (rm -f moto-sim-site.zip && zip -qr moto-sim-site.zip index.html css/styles.css js/*.js CLAUDE.md
  test/validate.js), commit (trailer: Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>),
  push to the working branch.
- Match the surrounding code style: dense "why" comments, SI units, the // ═══ banner sections.
```

---

## Wave 1

### 1 — Physics core
```
STREAM: Physics core. You own js/physics.js and the physics constants in js/core-params.js and
js/core-state.js. This is the coupled integrator — tires, suspension, and chassis are ONE loop, so
work them as sequential sub-tasks, not in parallel.

Context: sub-stepped explicit Euler (MAX_SUBSTEP 0.005s). DOFs: surge, heave, pitch, front fork
slide (forkSlide_f), rear swingarm rotation (swingAngle), wheel spins, engine. Rim bottoming is
resolved in resolveTireBottom — the rule (see CLAUDE.md) is that a bottoming tire must COMPRESS the
suspension DOF, never pin the chassis (pinning froze travel — the historical "lockout" bug class).

Likely goals (confirm priorities with the user): tune/validate tire carcass + rim model, fork and
shock damping realism against the damping-curve LUTs, load transfer and pitch behavior, landing
feel. Every change gated by the harness; add a new scenario whenever you fix a class of bug so it
can't regress.

Start by reading physics.js end to end and summarizing the force path (surge/heave/pitch assembly,
suspension force projection, contact resolution) back to the user before changing anything.
```

### 2 — Engine & drivetrain (+ audio)
```
STREAM: Engine, drivetrain, and audio. You own the engine/clutch/gearbox model (in js/physics.js's
drivetrain block + the engine constants in js/core-params.js) and js/audio.js. Coordinate with the
Physics-core stream on js/physics.js edits — keep your changes inside the drivetrain block; flag if
you need to touch the contact/suspension code.

Context: engineRPM crank model, 6-speed gearbox (GEAR_RATIOS, gears indexed 0–5 = 1st–6th, NO
neutral), clutch engages over CLUTCH_ENGAGE_TIME (releasing high revs onto the wheel = clutch-up
wheelie), bouncing rev limiter (RPM_LIMIT/LIMITER_BAND), idle creep + a lug-stall state machine,
reflected crank inertia. audio.js is a Web Audio parallel-twin note whose pitch tracks RPM.

Likely goals (confirm with the user): drivetrain realism (torque curve, gear feel, clutch slip),
stall/idle behavior, and richer engine/tire/stall sound. The harness already checks rev-limiter
bounce and idle/cruise-no-stall — keep them green and extend them.

Start by reading the drivetrain block + audio.js and summarizing the RPM→wheel-force path.
```

### 3 — Terrain & course designer
```
STREAM: Terrain and the custom-track course designer. You own js/core-track.js (custom-track data +
rebuildCustomTrack + value noise), js/core-terrain.js (groundY_m + calcNaturalWY_m), and the
track-builder editor in js/graphs.js (drawTerrainEditor + the feature palette/popup). The minimap
lives in js/render.js — coordinate with the Render stream if you need changes there.

Context: terrain is a single-valued heightfield groundY_m(x); TERRAINS lists the presets (index =
P.terrain), and Custom (index 7) composes an ordered list of feature segments that loops. Solid
features register colliders in trackWalls (crash-&-endo physics reads them in physics.js — don't
edit that; flag if the collider contract needs to change). GOTCHA: initPhysics settles on the
current P.terrain, so any reset must set P.terrain first.

Likely goals (confirm with the user): more/better terrain presets and shaping, richer course-builder
feature types + editor UX, saving/sharing tracks. Add harness scenarios for new terrain types
(no-NaN, wheels track the surface, rim stays out of the ground).

Start by reading core-track.js + core-terrain.js + the graphs.js editor and summarizing how a
feature list becomes groundY_m and trackWalls.
```

### 4 — UI & controls (mobile / desktop / gamepad)
```
STREAM: UI, layout, and input. You own js/ui.js, js/main.js (input bindings/buttons), the HTML cards
in index.html, and css/styles.css. index.html is shared — you're its primary owner, but other
streams may need to add a card; treat structural changes as coordination points.

Context: current inputs are keyboard (G gas, arrows brakes, B both, C clutch, A/D gear, R reset, P
pause, . step) and on-screen buttons; there's camera-pan drag and pinch. Desktop layout extends the
sim view; mobile is narrower. Setups (P + damping curves + customTrack) save/load via localStorage
in ui.js.

Goals: (a) a clean, responsive mobile touch layout AND desktop layout; (b) PS4/DualShock support on
desktop via the Gamepad API (map sticks/triggers/buttons to gas, front/rear brake, clutch, shift,
reset — poll in the rAF loop, add a small "controller connected" affordance). Keep all control paths
(keyboard, touch, gamepad) driving the same input globals (gasPressed/gasInput, brakeFrontHeld/
brakeRearHeld/brakeBothHeld, clutchPulled, gear, etc.) so physics is untouched.

The harness doesn't cover input UX — verify by driving the UI in the preview (preview_click/fill) and
screenshotting mobile + desktop widths (preview_resize). Don't regress the harness.

Start by reading ui.js + main.js and cataloguing every input path and control global.
```

### 5 — Render / art / camera
```
STREAM: Rendering, art, and camera. You own js/render.js (draw loop, camera, drawMinimap, bike/wheel
drawing) and js/background.js (Arizona parallax + scenery). Read-only elsewhere; flag if you need
physics or DOM changes.

Context: chassis CoM sits at a fixed screen X (COM_SX); vertical follows terrain with a deadzone
(camY_m). Horizontal accel-lead and vertical parallax are currently DISABLED (both were janky —
don't silently re-enable without a plan). The bike is drawn from the physics pose each frame.

Likely goals (confirm with the user): nicer bike/suspension rendering, richer/parallax scenery,
re-attempting camera polish (smoothing, lead) carefully, visual feedback for slip/bottoming. Purely
visual — must not change physics or the harness result. Verify with screenshots at several moments
(launch, mid-air, hard landing) and both viewport widths.

Start by reading render.js's draw() + camera code and background.js, and summarize the coordinate
pipeline (world meters → screen px) back to the user.
```

---

## Wave 2 (after the physics core is trustworthy)

### 6 — Embeddable comparison widget (the commercial core)
```
STREAM: The stock-vs-aftermarket comparison widget — the reason this sim exists. Goal: let a visitor
compare a STOCK MT-07 against one with the owner's aftermarket FORK parts installed, embedded on a
WordPress page via iframe.

The comparison is two P snapshots (see the parameter contract in CLAUDE.md): the aftermarket product
maps to the FRONT fields (k_f, damp_f + the front damping-curve LUTs, air_f, etc.). Design an A/B
mode — e.g. run two physics states over the same terrain/inputs and show the difference (side-by-side
or overlay), highlighting fork behavior (travel used, harshness, bottoming, pitch on braking).

CRITICAL: correctness rests on (a) the front-fork model fidelity and (b) reproducibility. Two facts
from CLAUDE.md you must honor: resetSim() must leave both bikes identical (it now zeroes the lagged
contact-force globals), and initPhysics settles on the current P.terrain so set each bike's P BEFORE
resetting it. If the two bikes ever diverge from identical inputs, stop and fix that first — a wrong
comparison is worse than none. Extend the harness with an A/B determinism check.

Also owns: a minified/embeddable build path and the iframe/WordPress integration. Do NOT start until
the Physics-core stream confirms the fork model is stable. Read CLAUDE.md's parameter contract and
the harness determinism scenario first.
```

### 7 — Educational / tutorial layer
```
STREAM: The "learn something" layer — the hook that makes people stay and come back. Goal: turn the
sim into a teaching tool. Ideas (shape with the user): guided scenarios ("feel too little rebound
damping", "why the front dives under braking"), on-screen annotations explaining what each setup
change does, before/after demos, a short interactive tutorial.

Mostly additive UI + copy on top of a stable sim; coordinate with the UI stream on index.html/CSS and
with Render for any overlays. Must not change physics or regress the harness. Lean on the existing
telemetry (force/velocity graphs, travel stats) to make the physics legible.

Start by reading CLAUDE.md + the parameter contract so the explanations are physically accurate, then
propose a small first lesson and build it end to end.
```
