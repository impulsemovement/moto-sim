'use strict';
// ═══════════════════════════════════════════════════════════
//  CONSTANTS  (SI units throughout)
// ═══════════════════════════════════════════════════════════
let PM           = 200;          // pixels per meter — updated by resizeMain()
let PM_base      = 200;          // base PM before user zoom
let userZoom     = 1.0;          // zoom multiplier from +/- buttons
let groundBaseY  = 291;          // screen Y of the ground line (set in resizeMain)
let camPanX_m    = 0;            // camera pan offset (meters, +ve = look right/ahead)
const g          = 9.81;         // m/s²
let RAKE_RAD     = 24.83 * Math.PI / 180;   // fork rake (live — Bike Geometry slider)

// Swingarm geometry (all in meters, chassis-frame offsets from CoM)
// Pivot is behind and below CoM; SWINGARM_L chosen so rear axle lands at B_REAR_M behind CoM
const SW_PIV_X_FROM_COM = -0.207;   // m behind CoM — MT-07 class pivot position
const SW_PIV_Y_FROM_COM = +0.262;   // m below CoM  — gives ~12° swingarm angle from horizontal
const SWINGARM_L        =  0.490;   // m
// Swingarm angle convention: phi = angle of the (pivot→axle) vector below the chassis
//   x-axis, measured in the chassis frame (rad). Axle in chassis frame:
//     axle_x = SW_PIV_X − L·cos(phi)   (rearward = −x)
//     axle_y = SW_PIV_Y + L·sin(phi)   (downward = +y)
//   Larger phi ⇒ wheel lower ⇒ suspension MORE EXTENDED.
//   Smaller phi ⇒ wheel higher ⇒ suspension COMPRESSED.

// ── Rear shock frame mount (chassis frame, m from CoM) ──────────────────────
// The shock spans this fixed frame mount to the rocker (see the LK linkage block
// below). Because every body in the linkage is chassis-attached and the only
// relative freedom is the swingarm rotation, the shock LENGTH is a pure function
// of phi (independent of chassis pose) — so shockLen(phi) and its derivative fully
// drive the spring/damper via virtual work.
const SHOCK_UP_X     = -0.360;       // m  shock frame mount X (behind CoM, on subframe)
const SHOCK_UP_Y     = -0.160;       // m  shock frame mount Y (above CoM)
const I_SWINGARM     = 0.6;          // kg·m²  swingarm's own rotational inertia about pivot
// Visual-only shock frame mount. The physics shock spans the rocker point C → SHOCK_UP
// (which, with this linkage, happens to LENGTHEN on compression — physically sign-consistent
// but reads backwards on screen). For the ANIMATION we mount the coil-over from the same
// real rocker point C to this alternate frame point, chosen so the drawn shock SHORTENS as
// the suspension compresses (like a conventional shock). Drawing-only; never used in physics.
const SHOCK_VIS_X    =  9/200;       // m  visual shock frame mount X — vertex J "gearbox bottom-left"
const SHOCK_VIS_Y    = 57/200;       // m  visual shock frame mount Y
// Front fork hydraulic bump stop — engages in the last BS_ZONE of compression travel.
const BS_ZONE        = 0.10;         // last 10% of travel
const BS_STIFF       = 9;            // bump-stop spring stiffness multiplier on K_F
const BS_DAMP        = 9000;         // N·s/m  hydraulic bump-stop damping at full engagement
// Hard bottom-out impact handling. The unsprung wheel's inbound momentum is redirected
// mostly into ROTATION about the CoM (pitch) with only a small vertical (heave) component,
// and the impact is INELASTIC (the rest is dissipated) — so a bottom-out kicks the bike's
// nose/tail rather than launching the whole bike up into an infinite vertical bounce.
// Kept small so the kick doesn't set up a front↔rear porpoising oscillation; the actual
// transmitted impulse is further scaled per wheel by the tire-pressure factor below.
const BOTTOM_ROT     = 0.30;         // pitch-impulse gain from a bottom-out impact
const BOTTOM_HEAVE   = 0.05;         // fraction of impact momentum left as vertical heave
const BOTTOM_BOUNCE  = 0.60;         // chassis up-launch gain per unit restitution (bounce slider)

const WHEEL_R_F  = 0.300;        // m  front tyre radius → 60 px
const WHEEL_R_R  = 0.315;        // m  rear  tyre radius → 63 px

// ── Wheel rotational dynamics & engine/brake torque-reaction on pitch ────────
// Wheels carry angular momentum. Engine torque (gas, rear only) and brake torque spin
// them up/down; tire grip resyncs spin to the rolling speed on the ground. By
// conservation of angular momentum the chassis feels the OPPOSITE of the wheels'
// angular acceleration: spinning a wheel up pitches the nose UP (wheelie / air blip),
// braking a spinning wheel pitches it DOWN — even airborne.
const I_WHEEL_F     = 0.50;      // kg·m²  front wheel+tire rotational inertia
const I_WHEEL_R     = 0.75;      // kg·m²  rear  wheel+tire rotational inertia
const ENG_TORQUE_R  = 290;       // N·m   engine torque available to spin the free rear wheel (gas)
const BRAKE_TORQUE_F = 150;      // N·m   front brake torque on a spinning wheel
const BRAKE_TORQUE_R = 120;      // N·m   rear  brake torque on a spinning wheel
const REAR_BRAKE_LEVER = 0.22;   // m   effective lever for the rear-brake anti-wheelie nose-down moment
const OMEGA_MAX     = 220;       // rad/s  rev-limit for a free-spinning driven wheel
const GRIP_LAMBDA   = 300;       // 1/s   tire-grip relaxation of wheel spin → rolling speed
const TAU_REACT_MAX = 300;       // N·m   clamp on the chassis reaction torque (tames landing resync)
let WHEELBASE    = 1.400;        // m  (live — Bike Geometry slider; front axle moves, rear fixed)
const B_REAR_M   = 0.686;        // m  CoM from rear axle (fixed — anchors the swingarm geometry)
let A_FRONT_M    = WHEELBASE - B_REAR_M;  // m  CoM from front axle (= 0.714 at default 1.40 wheelbase)

let I_YY         = 90;           // kg·m²  pitch inertia (live — Bike Geometry slider)
let H_COM        = 0.65;         // m  CoM height above ground (live — Bike Geometry slider)
// Digressive pitch-moment response: a suspension force contributes to the pitch moment
// near-linearly when small, but saturates as it grows, so big wheel forces (bumps,
// landings) don't deliver a harsh pitch jolt. MOMENT_FCHAR is the characteristic force —
// the moment ≈ lever·F below it and rolls toward lever·MOMENT_FCHAR above it. Pitch only;
// the vertical/heave response uses the full force.
const MOMENT_FCHAR = 3000;       // N
function digMoment(F) { return MOMENT_FCHAR * Math.tanh(F / MOMENT_FCHAR); }

// ── Chassis body VISUAL offset (chassis-local px, PM=200) ───────────────────
// Shifts only the DRAWN frame body (and its collision points) relative to the CoM/wheels,
// without touching the physics CoM. Negative X = rearward; positive Y = down.
const CHASSIS_VIS_DX_PX = -25;   // move frame body back so the fork sits at its front edge
const CHASSIS_VIS_DY_PX = 10;    // drop frame body ~50 mm (it sat too high)

// ── Chassis body ground-contact points ───────────────────────────────────────
// Collision points are the actual frame SILHOUETTE tips (same outline you see), shifted
// by the visual offset above, so the box matches the drawing and only the real pointy
// chassis tips can touch the ground — no invisible point sticking out behind/below it.
// Contact is INELASTIC (dead, no-bounce) when the bike flips/endos onto its body.
const CHASSIS_CONTACTS = [
  [-137, -86],   // A: rear tail tip
  [  92,-104],   // F: tank / bar top
  [ 119, -90],   // G: head-tube upper
  [ 143, -40],   // H: nose / fork crown
  [  95,  57],   // I: gearbox bottom (front)
  [   9,  57],   // J: gearbox bottom (rear)
].map(([x, y]) => [ (x + CHASSIS_VIS_DX_PX) / 200, (y + CHASSIS_VIS_DY_PX) / 200 ]);
const BODY_RESTITUTION = 0.0;   // 0 = fully dead, no bounce
const BODY_FRICTION    = 0.6;   // Coulomb-ish ground friction at the contact patch
const BODY_POS_CORRECT = 0.8;   // Baumgarte penetration push-out fraction
const BODY_TANGENT_DV  = 0.35;  // m/s  max surge change per contact resolution — stops a fast
                                //       tip-clip from instantly arresting the bike (no fling)

// Unsprung masses and tire spring rates are runtime parameters (P.m_unsprung_f etc.)
// Default values live in the P object below.

const REST_F_M   = 0.45;         // m  front fork natural length
const REST_R_M   = 0.30;         // m  rear shock natural length

const V_MAX_SIM  = 3.0;          // m/s  maps to right edge of curve graph
const F_MAX_F_COMP = 6000;       // N  front compression base
const F_MAX_F_REB  = 12000;      // N  front rebound base (2× comp)
const F_MAX_R_COMP = 6000;       // N  rear  compression base
const F_MAX_R_REB  = 12000;      // N  rear  rebound base  (2× comp)
// Legacy aliases used by graph labels when no comp/reb distinction needed
const F_MAX_F = F_MAX_F_COMP;
const F_MAX_R = F_MAX_R_COMP;

const TRAVEL_MAX = 0.130;        // m  max travel
const TRAVEL_EXT = 0.010;        // m  extension limit

// ── Derived rear-swingarm constants (depend on B_REAR_M / TRAVEL_* above) ───
// Nominal static-sag swingarm angle: chosen so the axle lands B_REAR_M behind CoM.
const SW_PHI_SAG = Math.acos((B_REAR_M + SW_PIV_X_FROM_COM) / SWINGARM_L); // ≈0.212 rad
// Swingarm-angle travel limits (mechanical stops) and rest reference, derived from
// the wheel-travel figures via the arc relation wheelΔy = L·Δ(sinφ), anchored at the
// nominal 33 mm sag. FIXED geometry; the actual settle angle is solved in initPhysics.
const _SAG_NOM       = 0.033;                                                       // m  nominal sag
const PHI_REST       = Math.asin(Math.sin(SW_PHI_SAG) + _SAG_NOM / SWINGARM_L);             // unloaded
const PHI_FULL_DROOP = Math.asin(Math.sin(SW_PHI_SAG) + (_SAG_NOM + TRAVEL_EXT) / SWINGARM_L); // topped
const PHI_FULL_BUMP  = Math.asin(Math.sin(SW_PHI_SAG) - (TRAVEL_MAX - _SAG_NOM) / SWINGARM_L); // bottomed
// Rear wheel travel (m) at full droop, relative to PHI_REST — the gauge's zero reference so it
// reads 0 at full extension and never goes negative.
const WT_DROOP = SWINGARM_L * (Math.sin(PHI_REST) - Math.sin(PHI_FULL_DROOP));   // <0
// ── Rising-rate rocker linkage (Pro-Link / Monocross style) ─────────────────
// Force path: swingarm → tie-rod → rocker (bell crank on the frame) → shock → frame.
// All points in the chassis frame (m from CoM). The linkage makes shock travel a
// progressive (rising-rate) function of swingarm rotation. The physics consumes only
// shockLength(phi) and its derivative, so the linkage is a drop-in for the direct shock.
//   • Tie-rod attaches to the swingarm LK_SW_ARM_D from the pivot.
//   • Rocker pivots on the frame at (pivX,pivY); its tie-rod point B and shock point C
//     are rigid (fixed radii/angles), captured from their chosen rest positions.
//   • Shock spans rocker point C → frame mount D (= SHOCK_UP).
const LK = (() => {
  const pivX = -0.260, pivY = 0.140;     // rocker pivot on frame
  const swArmD = 0.140;                  // tie-rod attach on swingarm, dist from sw pivot
  const Brx = -0.30698, Bry = 0.15710;   // rocker tie-rod point, REST position
  const Crx = -0.24980, Cry = 0.02340;   // rocker shock  point, REST position
  const Dx = SHOCK_UP_X, Dy = SHOCK_UP_Y;// shock frame mount
  const Rb = Math.hypot(Brx - pivX, Bry - pivY), angB0 = Math.atan2(Bry - pivY, Brx - pivX);
  const Rc = Math.hypot(Crx - pivX, Cry - pivY), angC0 = Math.atan2(Cry - pivY, Crx - pivX);
  // Tie-rod length, fixed from the rest pose.
  const aRx = SW_PIV_X_FROM_COM - swArmD * Math.cos(PHI_REST);
  const aRy = SW_PIV_Y_FROM_COM + swArmD * Math.sin(PHI_REST);
  const tie = Math.hypot(aRx - Brx, aRy - Bry);
  // Determine which circle-circle root matches the rest B (so we pick it consistently).
  const dx = aRx - pivX, dy = aRy - pivY, d = Math.hypot(dx, dy);
  const a = (d * d + Rb * Rb - tie * tie) / (2 * d);
  const h = Math.sqrt(Math.max(0, Rb * Rb - a * a));
  const mx = pivX + a * dx / d, my = pivY + a * dy / d;
  const ox = -dy / d * h, oy = dx / d * h;
  const rootSign = ((mx + ox - Brx) ** 2 + (my + oy - Bry) ** 2)
                 < ((mx - ox - Brx) ** 2 + (my - oy - Bry) ** 2) ? +1 : -1;
  return { pivX, pivY, swArmD, Rb, angB0, Rc, angC0, Dx, Dy, tie, rootSign, Brx, Bry, Crx, Cry };
})();

// Solve the 4-bar for a given swingarm angle. Returns all joint positions + shock length.
function lkSolve(phi) {
  const Ax = SW_PIV_X_FROM_COM - LK.swArmD * Math.cos(phi);   // tie-rod point on swingarm
  const Ay = SW_PIV_Y_FROM_COM + LK.swArmD * Math.sin(phi);
  // B = intersection of circle(pivot, Rb) and circle(A, tie); pick the rest-consistent root.
  const dx = Ax - LK.pivX, dy = Ay - LK.pivY;
  const d  = Math.hypot(dx, dy) || 1e-9;
  const a  = (d * d + LK.Rb * LK.Rb - LK.tie * LK.tie) / (2 * d);
  const h  = Math.sqrt(Math.max(0, LK.Rb * LK.Rb - a * a));   // 0 if (near-)binding
  const mx = LK.pivX + a * dx / d, my = LK.pivY + a * dy / d;
  const Bx = mx + LK.rootSign * (-dy / d * h), By = my + LK.rootSign * (dx / d * h);
  // Rocker rotation, then C rotates rigidly with it.
  const dTheta = Math.atan2(By - LK.pivY, Bx - LK.pivX) - LK.angB0;
  const angC   = LK.angC0 + dTheta;
  const Cx = LK.pivX + LK.Rc * Math.cos(angC), Cy = LK.pivY + LK.Rc * Math.sin(angC);
  return { Ax, Ay, Bx, By, Cx, Cy, shockLen: Math.hypot(Cx - LK.Dx, Cy - LK.Dy) };
}

// Shock natural (unloaded) length: zero spring force at PHI_REST.
const SHOCK_REST_LEN = lkSolve(PHI_REST).shockLen;
// Motion ratio at sag = wheel-travel / shock-travel = (L·cosφ) / (d shockLen/dφ).
// Calibrates the shock spring rate so the WHEEL rate at sag equals the P.k_r slider,
// and converts wheel-mm preload to shock-mm. Geometry-only constant.
const SW_MR_SAG = (() => {
  const hh = 1e-4;
  const dShock = (lkSolve(SW_PHI_SAG + hh).shockLen - lkSolve(SW_PHI_SAG - hh).shockLen) / (2 * hh);
  return (SWINGARM_L * Math.cos(SW_PHI_SAG)) / dShock;
})();

// Screen geometry — chassis CoM at fixed screen X; all wheel/ground positions derive from it
const COM_SX = () => canvas.width * 0.40;       // chassis CoM screen X

// ═══════════════════════════════════════════════════════════
//  CANVAS SETUP
// ═══════════════════════════════════════════════════════════
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');

// Real browser viewport height. When embedded in a SAME-ORIGIN iframe — especially an
// auto-height embed that inflates our own innerHeight to the full content height — read the
// parent page's viewport instead, so the canvas still fits the actual screen (e.g. a phone in
// landscape). Falls back to our own window when standalone or cross-origin.
function viewportHeight() {
  try {
    if (window.parent && window.parent !== window) {
      const ph = window.parent.innerHeight;
      if (ph) return ph;
    }
  } catch (e) { /* cross-origin — fall through */ }
  return window.innerHeight;
}

function resizeMain() {
  const mobile  = window.innerWidth < 641;
  const pad     = mobile ? 4 : 20;
  canvas.width  = window.innerWidth - pad;
  // Target height: compact on mobile, +25% sky on desktop. But NEVER taller than the viewport,
  // so the whole sim window (RESET at top + bike at bottom) fits without scrolling — important
  // in landscape on a phone, which is WIDE (so not "mobile" by width) yet SHORT.
  const target  = mobile ? 260 : 520;
  canvas.height = Math.round(Math.max(200, Math.min(target, viewportHeight() - 24)));
  // Ground sits a fixed distance from the bottom; shrink that offset if the canvas got capped
  // short so the bike still has room above the ground line.
  const groundOffset = Math.min(mobile ? 78 : 125, canvas.height * 0.34);
  groundBaseY   = canvas.height - groundOffset;
  PM_base       = mobile ? 100 : 200;
  PM            = PM_base * userZoom;
}
resizeMain();
window.addEventListener('resize', resizeMain);

// ═══════════════════════════════════════════════════════════
//  PARAMETERS
// ═══════════════════════════════════════════════════════════
// Tire pressure → tire spring rate mapping: slider in psi, physics in N/m
// [28, 52] psi → [200 000, 500 000] N/m (36 psi = 300 000 N/m = original K_TIRE)
const PSI_MIN = 28, PSI_MAX = 52;
const KTIRE_MIN = 200000, KTIRE_MAX = 500000;
function psiToKtire(psi) {
  // Linear in the 28–52 psi design range; floored so low slider values (down to 10 psi)
  // stay a soft-but-POSITIVE spring instead of going negative (which broke the tire model).
  return Math.max(60000, KTIRE_MIN + (psi - PSI_MIN) / (PSI_MAX - PSI_MIN) * (KTIRE_MAX - KTIRE_MIN));
}
const KTIRE_NOMINAL = psiToKtire(36);   // 300 000 N/m reference (36 psi)
// Grip vs. tire pressure: a lower-pressure tire deforms into a bigger contact patch and
// grips more (to a point); a hard tire grips less. Gentle, clamped, ref = 36 psi.
function gripPressure(psi) { return Math.max(0.8, Math.min(1.25, 1 + (36 - psi) * 0.006)); }
// Per-wheel bottom-out transmission factor: a soft (low-psi) tire deforms and ABSORBS
// the bottoming impact (heavily damped, small chassis kick); a hard (high-psi) tire is
// rigid and transmits more of it. 1.0 at the nominal 36 psi.
function bottomOutFactor(k_tire) {
  return Math.max(0.15, Math.min(1.6, k_tire / KTIRE_NOMINAL));
}
// Tire carcass damping coefficient (N·s/m). A low-pressure tire flexes far more and
// dissipates much more energy (hysteresis) — so it compresses further AND rebounds
// slowly/deadly, instead of springing back. Scales inversely with pressure: ~1500 at
// nominal 36 psi, up to ~5000 when soft, down to ~900 when hard.
const C_TIRE_BASE = 1500;
function tireDampCoef(k_tire) {
  return Math.max(600, Math.min(5000, C_TIRE_BASE * KTIRE_NOMINAL / Math.max(k_tire, 1)));
}

// ── Tire travel limit (rim-on-ground bottoming) ─────────────────────────────
// The carcass can only deflect so far before the rim hits the ground. Up to TIRE_TRAVEL
// it's the normal soft tire rate; past it a much stiffer "rim" rate stops the wheel
// sinking underground, and the contact goes DEAD (max-stable damping, no rebound) — a
// rigid rim slamming dirt, not a trampoline.
const TIRE_TRAVEL_F  = 0.040;  // m  front tire deflection before the rim contacts the ground
const TIRE_TRAVEL_R  = 0.045;  // m  rear
const TIRE_FORCE_MAX = 30000;  // N  hard ceiling on the carcass spring force (safety)

// Tire normal force (N, negative = pushing the wheel up out of the ground).
// The carcass SPRING saturates at the travel limit (it can't push harder once the rim is
// down — the rigid rim stop is handled inelastically in resolveTireBottom). pen = tire
// deflection (m); v = wheel velocity into the ground (m/s, + = compressing).
function tireForce(pen, v, k_tire, m_unsprung, dt, travel) {
  if (pen <= 0) return 0;
  const bottomed = pen > travel;
  let Fup = k_tire * Math.min(pen, travel);       // spring capped at the rim limit
  // Carcass hysteresis damping; DEAD (max stable) once bottomed (resists both directions).
  const C = Math.min(bottomed ? Infinity : tireDampCoef(k_tire), 0.9 * m_unsprung / dt);
  Fup += C * v;
  Fup = Math.max(0, Math.min(TIRE_FORCE_MAX, Fup));
  return -Fup;                                    // negative = upward
}

let P = {
  k_f:18, pre_f:0, damp_f:0.5, air_f:0.15,
  k_tire_f: psiToKtire(36), m_unsprung_f: 13, psi_f: 36,   // front tire / wheel (psi kept for grip)
  k_r:18, pre_r:0, damp_r:0.5,
  k_tire_r: psiToKtire(36), m_unsprung_r: 17, psi_r: 36,   // rear  tire / wheel
  mass:75,
  terrain:0, amp:0.4, freq:1.0, rough:0, duty:0.30,
  timeScale:1.0, speed:30,
  pitchMoment:0.70,  // 0–1 scale on bump-induced pitch (suspension-force moment + bottom-out kick)
  drivePitch:1.0,    // scale on the throttle/brake load-transfer pitch moment (wheelie/dive tendency)
  tireGrip:1.0,      // 0–1+ surface grip (1 = asphalt, lower = dirt/loose); friction-limits drive/brake
  bottomBounceF:3.5, bottomBounceR:2.0   // bottom-out restitution (0 = dead … up to 10× super-elastic)
};
const TERRAINS = ['Bumps','Whoops','Step drop','Kicker','Flat'];

// True only for genuine text-entry targets (e.g. the setup-name box). Used so global
// key shortcuts keep firing while a range slider / dropdown is focused.
function isTextEntry(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return /^(text|search|number|email|url|password)$/.test(el.type);
  return false;
}

// Gas / brake rates — declared here so bind() callbacks (called immediately) can access them
let GAS_ACCEL   = 7;    // m/s²  → tractive force target (× total mass) at low speed (slider, max 9.5)
let BRAKE_DECEL = 7;    // m/s²  → braking force target (× total mass) (slider, max 9.5)

// Longitudinal-dynamics constants (3-DOF rigid body: surge + heave + pitch).
// Speed emerges from these forces; the speed slider is the cruise-control TARGET.
const RHO_CDA   = 0.30;  // ½·ρ·Cd·A lumped aero drag (N per (m/s)²)
const C_RR      = 0.015; // rolling-resistance coefficient
const SLOPE_CLAMP = 1.5; // max |wheel-path slope| used for the terrain-normal force (~56°)
let TERRAIN_BITE  = 1.0; // slider gain: terrain-normal horizontal force → SPEED (scrub/launch)
let TERRAIN_PITCH = 0.5; // slider gain: terrain-normal horizontal force → PITCH (nose kick)
const SPIN_I_FRAC = 0.1; // fraction of engine-reflected inertia resisting wheelspin. The rigid
                         // (1.0) value makes the drivetrain too "heavy" to break loose in low
                         // gears; 0.1 (clutch compliance / slip) gives visible, graded wheelspin.
const TERRAIN_PITCH_CAP = 450; // N·m  cap on the terrain pitch moment (anti-resonance on bumps)
const DRIVE_V0  = 12;    // m/s  below this the drive force is flat; above it is power-limited (∝1/v)
const K_CRUISE  = 400;   // N per (m/s) — cruise controller gain toward the speed-slider target

// ── Drivetrain: engine + clutch + 6-speed gearbox ───────────────────────────
// The engine spins at engineRPM. With the clutch OUT (engaged) the engine is geared to
// the rear wheel (engineRPM = wheelω · effRatio). With the clutch IN (pulled) the engine
// is free — gas revs it toward redline. Releasing the clutch with the revs higher than
// the wheel speed dumps a big slip torque → clutch-up wheelie. Lower gears multiply
// torque (and cap speed sooner); higher gears pull gently with a high top speed.
const GEAR_RATIOS  = [2.75, 1.95, 1.50, 1.20, 1.00, 0.85]; // gearbox, 1st…6th
const FINAL_DRIVE  = 7.0;                                  // primary × final-drive (lumped)
const NUM_GEARS    = GEAR_RATIOS.length;
const GEAR_REF     = 2;                                    // ratio that ≈ matches the old flat accel
const RPM_IDLE     = 1500;
const RPM_REDLINE  = 10000;
const RPM_LIMIT    = 10800;   // hard rev limiter
const ENGINE_K     = 5;       // N·m of crank torque per unit of the Gas-rate slider (= PEAK torque)
const I_ENGINE     = 0.35;    // kg·m²  crank + clutch-basket inertia (engine side)
// Normalized MT-07 (CP2 689 cc) crank-torque curve vs RPM. 1.0 = peak (~68 N·m near 6 000).
// Modeled on published dyno sheets: strong low-end, broad flat plateau 4 000–7 500, gentle
// taper to redline, dropping off hard into the limiter. F_throttle = PEAK·this(rpm).
const MT07_TORQUE = [ // [rpm, factor]
  [1500,0.74],[2500,0.82],[3500,0.90],[4500,0.96],[5500,0.99],[6000,1.00],
  [6500,1.00],[7000,0.98],[7500,0.95],[8000,0.92],[9000,0.85],[10000,0.73],[10800,0.55],
];
function engTorqueFac(rpm) {
  const T = MT07_TORQUE, n = T.length;
  if (rpm <= T[0][0])   return T[0][1];
  if (rpm >= T[n-1][0]) return T[n-1][1];
  for (let i = 1; i < n; i++) if (rpm <= T[i][0]) {
    const a = T[i-1], b = T[i];
    return a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]);
  }
  return 1;
}
const ENGINE_REV_RATE   = 12000; // RPM/s free-rev spin-up at full gas (clutch in)
const ENGINE_DECAY_RATE = 8000;  // RPM/s decay toward idle off-gas (clutch in)
const CLUTCH_PULL_TIME   = 0.06; // s  to disengage (pull in)
const CLUTCH_ENGAGE_TIME = 0.13; // s  to engage (release / dump)
const CLUTCH_MAX_TORQUE  = 85;   // N·m  max torque the clutch can transmit (engine side)
const K_CLUTCH_SLIP      = 0.02; // N·m per RPM of clutch slip
const ENGINE_BRAKE_K     = 20;   // N·m crank-side engine-braking torque at redline (off-throttle)
const GRIP_LONG_K  = 2500;  // N per m/s of contact longitudinal slip (capped by friction)
const GRIP_MU      = 0.5;   // longitudinal grip coefficient (× tire normal force)
const MU_BASE      = 1.3;   // peak longitudinal grip coeff at 100% grip slider / 36 psi (asphalt)
const GRIP_CURVE   = 1.6;   // expands the usable dirt range across the slider (load transfer
                            // otherwise keeps the μ·N cap above demand until grip is very low)
const ANTI_SQUAT_SCALE   = 0.4;  // how much the rear longitudinal (drive/brake) force torques the
                                 // swingarm via geometry (anti-squat / clutch-up suspension load)
const RPM2RADS = 2 * Math.PI / 60;   // RPM → rad/s
const RADS2RPM = 60 / (2 * Math.PI); // rad/s → RPM
function effRatio(g) { return GEAR_RATIOS[g] * FINAL_DRIVE; }

function bind(id, lblId, fn) {
  const el  = document.getElementById(id);
  const lbl = document.getElementById(lblId);
  if (!el || !lbl) return;
  const update = () => { lbl.textContent = fn(+el.value); };
  el.addEventListener('input', update);
  update();
}

bind('k_f',       'lk_f',       v => { P.k_f    = v;       return v + ' N/mm'; });
bind('air_f',     'lair_f',     v => { P.air_f   = v/100;   return v + '%'; });
bind('pre_f',     'lpre_f',     v => { P.pre_f   = v/1000;  return v + ' mm'; });
bind('damp_f',    'ldamp_f',    v => { P.damp_f  = v/100;   return (v/100).toFixed(2)+'×'; });

bind('k_r',       'lk_r',       v => { P.k_r    = v;       return v + ' N/mm'; });
bind('pre_r',     'lpre_r',     v => { P.pre_r   = v/1000;  return v + ' mm'; });
bind('damp_r',    'ldamp_r',    v => { P.damp_r  = v/100;   return (v/100).toFixed(2)+'×'; });

bind('ktire_f',   'lktire_f',   v => { P.k_tire_f = psiToKtire(+v); P.psi_f = +v; return v + ' psi'; });
bind('munsp_f',   'lmunsp_f',   v => { P.m_unsprung_f = +v;          return v + ' kg'; });
bind('ktire_r',   'lktire_r',   v => { P.k_tire_r = psiToKtire(+v); P.psi_r = +v; return v + ' psi'; });
bind('munsp_r',   'lmunsp_r',   v => { P.m_unsprung_r = +v;          return v + ' kg'; });

bind('mass',      'lmass',      v => { P.mass    = v;       return v + ' kg'; });
bind('pitchmom',  'lpitchmom',  v => { P.pitchMoment = v/100; return v + '%'; });
bind('drivepitch','ldrivepitch', v => { P.drivePitch = v/100; return v + '%'; });
bind('tiregrip',  'ltiregrip',  v => { P.tireGrip = v/100; return v + '%'; });
bind('terrainbite','lterrainbite', v => { TERRAIN_BITE = v/100; return v + '%'; });
bind('terrainpitch','lterrainpitch', v => { TERRAIN_PITCH = v/100; return v + '%'; });
bind('bounceF',   'lbounceF',   v => { P.bottomBounceF = v/10; return v + '%'; });   // 100% = 10× restitution
bind('bounceR',   'lbounceR',   v => { P.bottomBounceR = v/10; return v + '%'; });
bind('speed',     'lspeed',     v => { P.speed = v; return v+' km/h'; });   // launch/target speed (seeds vChassisX on reset)
// Dragging the speed slider while running sets the speed directly (replaces the old cruise
// hold). Separate listener so it only runs on user input — never during init (avoids TDZ).
document.getElementById('speed').addEventListener('input', () => {
  if (initialized) { vChassisX = P.speed / 3.6; omega_f = vChassisX / WHEEL_R_F; omega_r = vChassisX / WHEEL_R_R; }
});
bind('timescale', 'ltimescale', v => { P.timeScale = v/100; return (v/100).toFixed(2)+'×'; });
bind('gasrate',   'lgasrate',   v => { GAS_ACCEL   = +v; return v + ' m/s²'; });
bind('brakerate', 'lbrakerate', v => { BRAKE_DECEL = +v; return v + ' m/s²'; });
bind('terrain',   'lterrain',   v => { P.terrain = +v;      return TERRAINS[+v]; });
bind('amp',       'lamp',       v => { P.amp     = v/100;   return (v/100).toFixed(2)+'×'; });
bind('freq',      'lfreq',      v => { P.freq    = v/100;   return (v/100).toFixed(2)+'×'; });
bind('rough',     'lrough',     v => { P.rough   = v/100;   return v+'%'; });
bind('duty',      'lduty',      v => { P.duty    = v/100;   return v+'%'; });

// ── Bike geometry (live) ────────────────────────────────────────────────────
bind('comheight',    'lcomheight',    v => { H_COM    = v/100;          return (v/100).toFixed(2)+' m'; });
bind('pitchinertia', 'lpitchinertia', v => { I_YY     = +v;             return v+' kg·m²'; });
bind('rake',         'lrake',         v => { RAKE_RAD = +v*Math.PI/180; return (+v).toFixed(1)+'°'; });
bind('wheelbase',    'lwheelbase',    v => { WHEELBASE = v/100; A_FRONT_M = WHEELBASE - B_REAR_M; return (v/100).toFixed(2)+' m'; });

// Wheel toggle
let wheelMode = 'front';
function setWheelMode(m) {
  wheelMode = m;
  document.getElementById('btn-front').classList.toggle('active', m==='front');
  document.getElementById('btn-rear').classList.toggle('active',  m==='rear');
  document.getElementById('susp-front').style.display = m==='front' ? '' : 'none';
  document.getElementById('susp-rear').style.display  = m==='rear'  ? '' : 'none';
  document.getElementById('curve-label').textContent = m.toUpperCase();
  syncCurveScaleSlider();
  drawCurveEditor();
}

// ═══════════════════════════════════════════════════════════
//  VALUE NOISE
// ═══════════════════════════════════════════════════════════
function valueNoise(x) {
  const i  = Math.floor(x);
  const f  = x - i;
  const u  = f*f*(3-2*f);
  const h0 = Math.sin(i     *127.1+311.7)*43758.5453;
  const h1 = Math.sin((i+1) *127.1+311.7)*43758.5453;
  return (h0-Math.floor(h0) + ((h1-Math.floor(h1))-(h0-Math.floor(h0)))*u)*2-1;
}

// ═══════════════════════════════════════════════════════════
//  CATMULL-ROM LUT
// ═══════════════════════════════════════════════════════════
const CURVE_SAMPLES = 256;

function buildCurveLUT(pts) {
  const n    = pts.length;
  const segs = n - 1;
  const sps  = Math.ceil(CURVE_SAMPLES / segs);
  const ext  = [
    { x:2*pts[0].x-pts[1].x,     y:2*pts[0].y-pts[1].y },
    ...pts,
    { x:2*pts[n-1].x-pts[n-2].x, y:2*pts[n-1].y-pts[n-2].y }
  ];
  const lut  = [];
  for (let s=0; s<segs; s++) {
    const p0=ext[s], p1=ext[s+1], p2=ext[s+2], p3=ext[s+3];
    const endI = (s===segs-1) ? sps : sps-1;
    for (let i=0; i<=endI; i++) {
      const t=i/sps, t2=t*t, t3=t2*t;
      const c0=-0.5*t3+    t2-0.5*t;
      const c1= 1.5*t3-2.5*t2     +1;
      const c2=-1.5*t3+2.0*t2+0.5*t;
      const c3= 0.5*t3-0.5*t2;
      lut.push({
        x: Math.max(0, Math.min(1,   c0*p0.x+c1*p1.x+c2*p2.x+c3*p3.x)),
        y: Math.max(0, Math.min(1.5, c0*p0.y+c1*p1.y+c2*p2.y+c3*p3.y))
      });
    }
  }
  lut.sort((a,b)=>a.x-b.x);
  lut[0]            = {x:pts[0].x,     y:pts[0].y};
  lut[lut.length-1] = {x:pts[n-1].x,   y:pts[n-1].y};
  return lut;
}

function evalCurveLUT(lut, x) {
  x = Math.max(0, Math.min(1, x));
  const n = lut.length;
  // Beyond the first/last control point, EXTRAPOLATE along the end segment's slope
  // (instead of clamping flat) so the curve "continues past" the movable endpoints.
  if (x<=lut[0].x) {
    const a=lut[0], b=lut[1];
    const slope=(b.y-a.y)/((b.x-a.x)||1e-6);
    return Math.max(0, a.y + slope*(x-a.x));
  }
  if (x>=lut[n-1].x) {
    const a=lut[n-2], b=lut[n-1];
    const slope=(b.y-a.y)/((b.x-a.x)||1e-6);
    return Math.max(0, b.y + slope*(x-b.x));
  }
  let lo=0, hi=lut.length-1;
  while (hi-lo>1) { const m=(lo+hi)>>1; if (lut[m].x<=x) lo=m; else hi=m; }
  const t=(x-lut[lo].x)/(lut[hi].x-lut[lo].x);
  return lut[lo].y+t*(lut[hi].y-lut[lo].y);
}

// ═══════════════════════════════════════════════════════════
//  DAMPING CURVE PRESETS & STATE  (4 LUT sets)
// ═══════════════════════════════════════════════════════════
const PRESETS = {
  linear:      [{x:0,y:0},{x:0.33,y:0.33},{x:0.67,y:0.67},{x:1,y:1}],
  progressive: [{x:0,y:0},{x:0.33,y:0.12},{x:0.67,y:0.52},{x:1,y:1}],
  digressive:  [{x:0,y:0},{x:0.33,y:0.62},{x:0.67,y:0.88},{x:1,y:1}],
  quadratic:   [{x:0,y:0},{x:0.33,y:0.11},{x:0.67,y:0.44},{x:1,y:1}]
};

let compPts_F = PRESETS.linear.map(p=>({...p}));
let rebPts_F  = PRESETS.linear.map(p=>({...p}));
let compPts_R = PRESETS.linear.map(p=>({...p}));
let rebPts_R  = PRESETS.linear.map(p=>({...p}));

let compLUT_F = buildCurveLUT(compPts_F);
let rebLUT_F  = buildCurveLUT(rebPts_F);
let compLUT_R = buildCurveLUT(compPts_R);
let rebLUT_R  = buildCurveLUT(rebPts_R);

// ═══════════════════════════════════════════════════════════
//  TERRAIN  (SI — returns meters, positive Y = down)
// ═══════════════════════════════════════════════════════════
function groundY_m(wx_m) {
  const amp  = P.amp;
  const freq = P.freq;
  // Quadratic scaling: gentle at low %, progressively larger toward 100%
  // (0→3mm at 25%, ~15mm at 50%, ~34mm at 75%, 60mm at 100%)
  const noise = P.rough>0 ? valueNoise(wx_m*5)*0.06*P.rough*P.rough : 0;
  switch (P.terrain) {
    case 0: // Bumps
      return Math.sin(wx_m*Math.PI*freq)*0.08*amp
           + Math.sin(wx_m*Math.PI*2*freq)*0.03*amp + noise;
    case 1: { // Whoops
      const wl = 1.5/freq;
      const ph = (((wx_m%wl)+wl)%wl)/wl;
      return (ph<0.5 ? Math.sin(ph*Math.PI*2)*0.18*amp : 0) + noise;
    }
    case 2: { // Step drop with duty cycle
      const cycle   = 6.0;          // m
      const dropH   = 0.15*amp;
      const edgeW   = Math.max(0.05, 0.3/freq);
      const zone    = (((wx_m%cycle)+cycle)%cycle);
      const dStart  = 2.0;
      const dEnd    = dStart+edgeW;
      const downLen = P.duty*(cycle-dEnd);
      const rStart  = dEnd+downLen;
      const rEnd    = rStart+edgeW;
      let t=0;
      if (zone>=dStart && zone<dEnd)       { t=(zone-dStart)/edgeW; t=(1-Math.cos(t*Math.PI))/2; }
      else if (zone>=dEnd && zone<rStart)   { t=1; }
      else if (zone>=rStart && zone<rEnd)   { t=(zone-rStart)/edgeW; t=(1+Math.cos(t*Math.PI))/2; }
      return t*dropH + noise;
    }
    case 3: { // Kicker — smooth hump
      const cycle = 5.0/freq;
      const zone  = (((wx_m%cycle)+cycle)%cycle)/cycle;
      const dur   = 0.22;
      if (zone<dur) { const rt=zone/dur; return -Math.sin(rt*Math.PI)*0.12*amp + noise; }
      return noise;
    }
    case 4: // Flat — gentle long-wavelength
      return Math.sin(wx_m*0.5*freq)*0.025*amp + noise;
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════
//  WHEEL GROUND CONTACT  (world position in meters)
// ═══════════════════════════════════════════════════════════
const WHEEL_STEPS = 24;

function calcNaturalWY_m(wx_m, r_m) {
  // Find the highest wheel-centre Y (most restrictive = smallest Y value in Y-down coords)
  // such that the wheel circle is tangent to or above the terrain at every point.
  // For each horizontal sample dx, the wheel centre must satisfy:
  //   centre_Y ≤ groundY(wx+dx) - sqrt(r²-dx²)
  // The minimum of all these upper bounds is the equilibrium centre height.
  let wy = Infinity;
  for (let i=0; i<=WHEEL_STEPS; i++) {
    const dx  = ((i/WHEEL_STEPS)-0.5)*2*r_m;
    const cl  = Math.sqrt(Math.max(0, r_m*r_m - dx*dx));
    const gnd = groundY_m(wx_m+dx);
    wy = Math.min(wy, gnd - cl);
  }
  return wy;
}

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
let prevFrontWheelY_m = null;   // previous-substep front-wheel Y, for tire-damping velocity

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
let clutchEngage  = 1;          // 0 = clutch fully IN (open), 1 = fully OUT (locked)
let clutchPulled  = false;      // input: true while the clutch button/key is held

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
let brakePressed  = false;
// Ramp PHASE (linear in time, 0→1) and the smoothed INPUT (smootherstep of phase, 0→1).
// smootherstep has zero slope at both ends → gentle onset (doesn't come on hard) and a
// gentle, non-abrupt release. The output gasInput/brakeInput are what the physics uses.
let gasPhase      = 0;
let brakePhase    = 0;
let gasInput      = 0;
let brakeInput    = 0;
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
    worldX_m, wheelAngle_f, wheelAngle_r, omega_f, omega_r, gear, engineRPM, clutchEngage, camY_m, camPanX_m,
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

