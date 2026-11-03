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
- 2026-10-22 · **render round-2 integrated** (resync pass) · `render-art` fast-forwarded in: rider body
  rework + one-piece seat over a visible rear-subframe truss (tail cowl). render.js-only, no conflicts.
  Also: untracked `.DS_Store`, normalized to v=77. · ✓ **57/57 harness**, no console errors. All six
  worktrees resynced — everything back on one track.

- 2026-11-01 · **Presentation pass integrated** (reskin + buy CTA + new bike) · merged `ui-controls`
  (apple-style reskin to the Impulse design system; Donate → red "Shop Prime" CTA at the Prime product
  URL, opens in a new tab) and `render-art` (suspension-focused bike: kept the solid chassis, removed
  rider/tank/seat, fork + shock as the brand-red hero with a PRIME fork tag). Normalized to v=78.
  Buy URL confirmed by the WordPress coordinating session. · harness: pending re-verify on merge.

- 2026-11-02 · **Shop Prime UTM + static-sag calibration** · (1) buy button → …/prime-series-emulator/
  ?utm_source=motosim&utm_medium=sim&utm_campaign=shop-btn#buy (v=79). (2) Sprung the stock bike to
  realistic street sag: `k_f` 18→23 (front **35%**, proper 25–35%), `k_r` 18→26 (rear **38%**, down
  from 50%). Default slider values in index.html updated to match (authoritative on load). Added a
  static-sag harness scenario. v=83. · ✓ **59/59 harness**. The calibration surfaced a contact bug
  (next item) that caps how firm the rear can go.

## Known follow-ups (not merge blockers)
- **Rear-contact robustness (blocks a firmer rear sag):** stiffening the springs for sag revealed an
  *erratic* `resolveTireBottom` instability — on hard kicker landings the REAR rim tunnels through the
  ground (e.g. `k_r` 49mm at one setting, ~500mm one step stiffer), and a stiffer front (`k_f`≥24)
  trips the `f_tire_F` force dropout. Non-monotonic in spring rate, so it's a genuine contact bug, not
  just tuning. Because of it the rear sag is held plush (~38%, `k_r`=26) instead of a true 30–35%.
  **Physics core:** make the contact robust across the spring-slider range, then firm `k_r` up and
  tighten the rear-sag harness band back to 25–35%. This also hardens the Prime toggle (users move the
  sliders). The front (35%) is already correct, so the comparison's key end is calibrated.
- **Cross-marketing build-out (proposed, not built):** stock-fork ⇄ Prime toggle (the Wave 2
  comparison widget, branded), end-of-run results card, clickable PRIME fork tag, UTM + carried
  bike/setup params on outbound links. Needs real stock-vs-Prime fork specs from the website side and
  the static-sag calibration first. See the proposal sent to the WordPress session.
- **graphs.js data-viz palette still off-brand:** the force/velocity graph series + damping-curve
  editor line (and their legend swatches in index.html ~L247–250/264–265) still use crimson/blue.
  Rebrand the series + swatches together when graphs.js's owner is in.
- `resetSim()` (main.js, UI-owned) does not reset Engine's `gearPrev`/`shiftTimer`. Engine self-heals
  via the `startGrace` resync and determinism passes — but if either stream touches this, revisit.
