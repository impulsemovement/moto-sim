# Stream coordination

Mainline branch: `rigid-body-and-ui-features` (this folder is the integration copy — don't do stream
work here). Each stream lives in its own git worktree + branch. **Physics core merges first each
cycle; every other stream rebases onto the updated mainline before merging.** A merge is allowed only
when `index.html?test=1` passes on the merged result.

## Streams

| Stream | Branch | Worktree folder | Owns (see CLAUDE.md) | Wave |
|---|---|---|---|---|
| Physics core | `physics-core` | `../moto-sim-physics-core` | physics.js, core-params.js, core-state.js | 1 |
| Engine & drivetrain (+audio) | `engine-drivetrain` | `../moto-sim-engine` | drivetrain block in physics.js, engine consts in core-params.js, audio.js | 1 |
| Terrain & course designer | `terrain-designer` | `../moto-sim-terrain` | core-track.js, core-terrain.js, track editor in graphs.js | 1 |
| UI & controls (mobile/desktop/PS4) | `ui-controls` | `../moto-sim-ui` | ui.js, main.js, index.html cards, styles.css | 1 |
| Render / art / camera | `render-art` | `../moto-sim-render` | render.js, background.js | 1 |
| Comparison widget | _(not started)_ | — | A/B mode + embeddable build | 2 |
| Educational layer | _(not started)_ | — | tutorial/annotations | 2 |

> Note: Physics core and Engine both touch `physics.js`. Engine stays inside the drivetrain block;
> Physics core owns the contact/suspension code. Coordinate before either edits the other's region.

## Merge log

_(append one line per landed merge: date · branch · short summary · harness pass ✓)_

- 2026-07-01 · (mainline) · Wave 0 foundation: CLAUDE.md + harness + core.js split · ✓ 31/31
- 2026-07-01 · physics-core · analytic front-tire damper velocity, high-speed damper extension, dead-code cleanup; +hard-landing f_tire_F regression scenario · ✓ (validated in-session, FF merge) · now v=70
- 2026-07-01 · (mainline) · fix launch.json: worktree-agnostic, auto port (was hardcoded to a worktree path + port 8080)
- 2026-07-01 · **Wave 1 integration** — all four streams merged, versions normalized to v=76 · ✓ **57/57 harness**, no console errors
  - `engine-drivetrain` · gear-shift torque cut + rev-match, MT-07 torque calibration (ENGINE_K 5→7 ≈ real CP2), richer audio · +gearPrev/shiftTimer (wired into rewind capture/restore)
  - `terrain-designer` · seamless `shape` tiling, noise-free wall aprons, custom-track harness coverage
  - `ui-controls` · mobile control bar, independent front/rear brake buttons, pointer input layer, pinch/wheel zoom
  - `render-art` · bodywork + rider + brake discs, contact shadows, dust, atmospheric depth, scenery anchored to dirt
  - Conflicts were `index.html` `?v=` lines only (expected); UI's structural changes auto-merged.

## Known follow-ups (not merge blockers)
- **Static sag is soft**: fork 43%, rear 50% of travel at rest (street norm ≈ 25–35%). Pre-existing —
  no stream changed `P` defaults/springs/mass. Belongs to Physics core, ideally calibrated against
  real MT-07 figures the way Engine just calibrated `ENGINE_K`.
- `resetSim()` (main.js, UI-owned) does not reset Engine's `gearPrev`/`shiftTimer`. Engine self-heals
  via the `startGrace` resync and determinism passes — but if either stream touches this, revisit.
