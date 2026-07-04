'use strict';
// ═══════════════════════════════════════════════════════════
//  (split from core.js — see CLAUDE.md ownership map; classic global scope,
//   loaded in original order so top-level execution is unchanged)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  PHYSICS STATE  (SI units, positive Y down)
// ═══════════════════════════════════════════════════════════
let chassisY_m    = 0;
let vChassis      = 0;
let vChassisX     = 0;   // m/s, longitudinal (surge) velocity of the whole vehicle
let pitchAngle    = 0;   // rad, positive = nose down
let pitchRate     = 0;

// Front fork: primary DOF is slide distance along the fork axis (chassis-relative).
// The fork axis direction is always RAKE_RAD - pitchAngle from world vertical — locked to chassis.
// frontWheelY_m / frontWheelX_m are DERIVED each step from forkSlide_f + chassis pose.
let forkSlide_f   = 0;   // m, fork displacement from natural length: negative = compressed
let vForkSlide_f  = 0;   // m/s, rate of change of forkSlide_f (positive = extending/rebound)

// Derived wheel world positions (recomputed every physics step, NOT integrated)
let frontWheelX_m = 0;
let frontWheelY_m = 0;
let prevFrontWheelY_m = null;   // UNUSED — front tire-damping velocity is now analytic (see
                                // physics.js). Kept only because resetSim() in main.js still
                                // writes it (strict mode); delete both together.

// Rear suspension: primary DOF is the SWINGARM ANGLE (chassis-relative rotation).
// The wheel is a point mass at the swingarm tip; it follows an arc about the pivot.
// rearWheelX_m / rearWheelY_m are DERIVED each step from swingAngle + chassis pose.
let rearWheelY_m     = 0;   // derived each sub-step from swingAngle + chassis pose
let rearWheelX_m     = 0;
let swingAngle       = 0;   // rad, swingarm angle below chassis x-axis (larger = extended)
let swingRate        = 0;   // rad/s, d(swingAngle)/dt (positive = extending/rebound)
// Cached rear-suspension scalars for display/history (set each sub-step)
let shockLen_cur     = 0;   // m, current shock length
let shockTravel_r    = 0;   // m, shock compression from rest (positive = compressed)
let wheelTravel_r    = 0;   // m, wheel vertical travel from topped-out (positive = compressed)
let rearSuspVel      = 0;   // m/s, wheel-vertical suspension velocity (graph/history; old vSuspR)

let worldX_m      = 0;
let lastTs        = null;
let initialized   = false;

// Drivetrain state
let gear          = 0;          // 0…NUM_GEARS-1  (1st…6th)
let engineRPM     = RPM_IDLE;   // crank speed
let revLimiterCut = false;      // true while the rev limiter is cutting fuel (bouncing the revs)
// ── Idle creep + stall ──────────────────────────────────────────────────────
let engineRunning = true;       // false = stalled (no torque; START ENGINE button shows)
let stallLugTimer = 0;          // s the engine has been lugged near-stop in gear (→ stall)
let startGrace    = 0;          // s after a start/reset during which stall is disabled
let engineStalledEvt = false;   // one-shot: set the frame the engine stalls (for the clatter sound)
const STALL_SPEED       = 0.6;  // m/s — below this, clutch-out + in-gear + no-gas = lugging
const STALL_DELAY       = 0.45; // s of lugging before it actually stalls
const STALL_START_GRACE = 1.4;  // s grace after start/reset so it doesn't insta-stall
const ENGINE_STALL_DECAY= 7000; // RPM/s the crank spins down to 0 once stalled
const IDLE_CRANK_TORQUE = 6;    // N·m idle drive torque → creep force (× gear ratio / wheel R)
const IDLE_CREEP_SPEED  = 2.6;  // m/s creep settles here (idle pulls until this, then eases off)
let clutchEngage  = 1;          // 0 = clutch fully IN (open), 1 = fully OUT (locked)
let clutchPulled  = false;      // input: true while the clutch button/key is held
// ── Gear-shift mechanics ────────────────────────────────────────────────────
// The UI writes `gear` directly (ui.js shiftGear); the drivetrain block in physics.js
// watches it for changes and runs a short torque cut + rev-match. Self-heals across
// reset/rewind: while startGrace > 0 the detector resyncs silently (no phantom cut).
let gearPrev   = 0;             // last gear value the drivetrain block saw
let shiftTimer = 0;             // s remaining in the shift torque cut (0 = not shifting)

// Playback controls
let paused        = false;  // true → physics frozen, rendering continues
let stepRequested = false;  // one-shot: advance a single fixed step while paused
const FRAME_STEP  = 0.016;  // s  fixed dt used for a manual frame-step

// Rewind recorder — ring buffer of full-state snapshots for scrub/playback.
// Capped by ELAPSED TIME (not frame count) so ≥REWIND_SECONDS is captured at any
// framerate. A hard length cap bounds memory on pathological high-fps displays.
const REWIND_SECONDS = 12;
const REWIND_MAX_LEN = 6000;
const recorder       = [];      // snapshots, oldest first
let   recordedTime   = 0;       // sum of recorder[i].dt, kept in sync on push/shift
let   rewindMode     = false;   // true → rendering a recorded frame, physics frozen
let   rewindIndex    = 0;       // scrub position into recorder

// Longitudinal acceleration (gas / brake input), m/s²  positive = forward
let a_long        = 0;
let gasPressed    = false;
// Independent brakes. Three intent flags from the inputs: front (↓ key), rear (← key), and
// "both" (the B key / on-screen BRAKE button). The physics derives want-front / want-rear from
// these each frame (wantF = front || both), so multiple sources can't fight over one flag.
let brakeFrontHeld = false;
let brakeRearHeld  = false;
let brakeBothHeld  = false;
// gasPhase/brakePhase are UNUSED — the smootherstep-phase ramp scheme they served was
// replaced by the ease-out integrators in _physicsStep (rampUp/rampDown act directly on
// gasInput/brakeInput*). Kept only because resetSim() in main.js still writes them
// (strict mode); delete all together.
let gasPhase      = 0;
let brakePhase    = 0;
// Smoothed inputs (0→1) — what the physics uses.
let gasInput      = 0;
let brakeInputF   = 0;   // ramped FRONT brake input (0→1)
let brakeInputR   = 0;   // ramped REAR  brake input (0→1)
let brakeInput    = 0;   // derived = max(front, rear); used for "any brake" conditions + display
const GAS_RAMP_UP    = 0.85;  // s  throttle press → full (slow climb so it doesn't snap to WOT)
const GAS_RAMP_DOWN  = 0.50;  // s  throttle release → zero (gentle drop for consistent wheelies)
const BRAKE_RAMP_UP  = 0.85;  // s  brake press → full (same ease-out feel as the throttle)
const BRAKE_RAMP_DOWN = 0.50; // s  brake release → zero
// (H_COM is declared up with the geometry constants — it's a live Bike Geometry slider.)

// Wheel rotation angles (radians, positive = clockwise = forward rolling)
let wheelAngle_f  = 0;
let wheelAngle_r  = 0;
// Wheel angular velocities (rad/s) — dynamic, so they can differ from rolling speed
// when airborne (engine/brake spin them) and drive the torque-reaction pitch effect.
let omega_f       = 0;
let omega_r       = 0;
// Contact slip speed (m/s) — |wheel surface speed − ground speed|. >0 when a wheel is locked
// (braking skid) or spinning (wheelspin); 0 when rolling true. Drives the tire-slip sound.
let frontSlipV    = 0;
let rearSlipV     = 0;

// Cached forces for display
let f_spring_F=0, f_damp_F=0, f_spring_R=0, f_damp_R=0;
let f_tire_F=0, f_tire_R=0;
let disp_f=0, disp_r=0;
// Wheel contact state — tracked by hard floor, used for AIR indicator & landing logic
let rearContact = false;  // true when rear wheel is on the ground

// ═══════════════════════════════════════════════════════════
//  FORCE HISTORY  (300 samples = ~5 s at 60fps)
// ═══════════════════════════════════════════════════════════
const HIST_MAX = 300;
const hist = { fs:[], fd:[], rs:[], rd:[], fv:[], rv:[] };
['fs','fd','rs','rd','fv','rv'].forEach(k => { for(let i=0;i<HIST_MAX;i++) hist[k].push(0); });

// ═══════════════════════════════════════════════════════════
//  REWIND: STATE CAPTURE / RESTORE
// ═══════════════════════════════════════════════════════════
// captureState() snapshots every dynamic var the physics integrates AND every
// derived scalar the renderer reads, so a recorded frame can be re-rendered
// faithfully without re-running physics. dt is stored for an accurate timeline.
function captureState(dt) {
  return {
    dt,
    chassisY_m, vChassis, vChassisX, pitchAngle, pitchRate,
    forkSlide_f, vForkSlide_f, swingAngle, swingRate,
    worldX_m, wheelAngle_f, wheelAngle_r, omega_f, omega_r, gear, engineRPM, clutchEngage, gearPrev, shiftTimer, camY_m, camPanX_m,
    frontWheelX_m, frontWheelY_m, rearWheelX_m, rearWheelY_m,
    shockLen_cur, shockTravel_r, wheelTravel_r, rearSuspVel,
    disp_f, disp_r,
    f_spring_F, f_damp_F, f_spring_R, f_damp_R, f_tire_F, f_tire_R,
    rearContact, speed: P.speed
  };
}
function applyState(s) {
  chassisY_m=s.chassisY_m; vChassis=s.vChassis; vChassisX=s.vChassisX||0; pitchAngle=s.pitchAngle; pitchRate=s.pitchRate;
  forkSlide_f=s.forkSlide_f; vForkSlide_f=s.vForkSlide_f; swingAngle=s.swingAngle; swingRate=s.swingRate;
  worldX_m=s.worldX_m; wheelAngle_f=s.wheelAngle_f; wheelAngle_r=s.wheelAngle_r;
  omega_f=s.omega_f||0; omega_r=s.omega_r||0; camY_m=s.camY_m; camPanX_m=s.camPanX_m;
  if(s.gear!=null) gear=s.gear; if(s.engineRPM!=null) engineRPM=s.engineRPM; if(s.clutchEngage!=null) clutchEngage=s.clutchEngage;
  if(s.gearPrev!=null) gearPrev=s.gearPrev; if(s.shiftTimer!=null) shiftTimer=s.shiftTimer;
  frontWheelX_m=s.frontWheelX_m; frontWheelY_m=s.frontWheelY_m; rearWheelX_m=s.rearWheelX_m; rearWheelY_m=s.rearWheelY_m;
  shockLen_cur=s.shockLen_cur; shockTravel_r=s.shockTravel_r; wheelTravel_r=s.wheelTravel_r; rearSuspVel=s.rearSuspVel;
  disp_f=s.disp_f; disp_r=s.disp_r;
  f_spring_F=s.f_spring_F; f_damp_F=s.f_damp_F; f_spring_R=s.f_spring_R; f_damp_R=s.f_damp_R; f_tire_F=s.f_tire_F; f_tire_R=s.f_tire_R;
  rearContact=s.rearContact; P.speed=s.speed;
}
function recordFrame(dt) {
  recorder.push(captureState(dt));
  recordedTime += dt;
  // Drop oldest frames once we hold more than REWIND_SECONDS of history.
  while (recorder.length > 1 && (recordedTime - recorder[0].dt) > REWIND_SECONDS) {
    recordedTime -= recorder.shift().dt;
  }
  while (recorder.length > REWIND_MAX_LEN) recordedTime -= recorder.shift().dt;
}
function clearRecorder() {
  recorder.length = 0; recordedTime = 0; rewindMode = false; rewindIndex = 0;
  const bar = document.getElementById('rewind-bar');
  if (bar) bar.style.display = 'none';
}
// Rebuild the six graph series from the recorded window ending at idx.
function rebuildHistAt(idx) {
  ['fs','fd','rs','rd','fv','rv'].forEach(k => hist[k].fill(0));
  const start = Math.max(0, idx - HIST_MAX + 1);
  let pos = HIST_MAX - (idx - start + 1);
  for (let i = start; i <= idx; i++, pos++) {
    const s = recorder[i];
    hist.fs[pos]=s.f_spring_F; hist.fd[pos]=s.f_damp_F;
    hist.rs[pos]=s.f_spring_R; hist.rd[pos]=s.f_damp_R;
    hist.fv[pos]=s.vForkSlide_f; hist.rv[pos]=s.rearSuspVel;
  }
}

// Per-series visibility for the force/velocity graph legends (click to toggle).
const seriesVisible = { fs:true, fd:true, rs:true, rd:true, fv:true, rv:true };

