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
