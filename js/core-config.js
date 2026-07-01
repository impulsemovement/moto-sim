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
const REAR_BRAKE_FRAC = 0.65;    // rear brake is weaker than the front (smaller demand); combined
                                 // with the rear losing grip under load transfer, it locks easily
const REAR_BRAKE_LEVER = 0.22;   // m   effective lever for the rear-brake anti-wheelie nose-down moment
const OMEGA_MAX     = 220;       // rad/s  rev-limit for a free-spinning driven wheel
const GRIP_LAMBDA   = 300;       // 1/s   tire-grip relaxation of wheel spin → rolling speed
const WHEEL_LOCK_RATE = 11;      // 1/s   how fast a wheel spins DOWN to a skid when the brake
                                 // overpowers grip (lockup); ~0.2-0.3 s to lock from speed
// Solid track-wall collision (crash & endo). A wheel that can't clear a wall's top hits its face:
// a stiff horizontal barrier (spring on the overlap + damping) decelerates the bike, capped so it's
// a hard-but-bounded stop, and the force acting below the CoM pitches the bike over the bars (endo).
const WALL_K    = 70000;  // N/m  horizontal barrier stiffness against the wheel's frontal overlap
const WALL_C    = 3500;   // N·s/m barrier damping (kills bounce — inelastic stop)
const WALL_FMAX = 22000;  // N    clamp on the wall force
// Endo on impact: the stopping force below the CoM pitches the bike over the bars. The torque is
// driven by the APPROACH SPEED (so it fades as the bike stops → finite nose-over, not an endless
// spin) and a strong pitch damping is applied while jammed so the rotation settles.
const WALL_ENDO_K     = 1600;  // N·m per (m/s) of speed into the wall
const WALL_ENDO_CAP   = 14000; // N·m clamp on the endo torque
const WALL_PITCH_DAMP = 1100;  // N·m·s/rad pitch damping while jammed against a wall (no spin)
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
const minimap   = document.getElementById('minimap');
const minimapCtx = minimap ? minimap.getContext('2d') : null;
const MAP_SPAN  = 240;   // m of terrain shown across the minimap (window centered on the bike)
// Horizontal camera accel-lead: how far the view leads ahead/behind per m/s² of longitudinal accel,
// and the clamp. Gives a sense of acceleration/braking by sliding the bike back/forward in frame.
const LEAD_GAIN  = 0.0275; // m of look-ahead per m/s² of accel (subtle — ¼ of the first pass)
const LEAD_MAX_M = 0.21;   // m  max look-ahead (clamp)

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
  const target  = mobile ? 260 : 624;   // desktop extended +20% upward (was 520) — extra sky on top
  canvas.height = Math.round(Math.max(200, Math.min(target, viewportHeight() - 24)));
  // Ground sits a fixed distance from the bottom; shrink that offset if the canvas got capped
  // short so the bike still has room above the ground line.
  const groundOffset = Math.min(mobile ? 78 : 125, canvas.height * 0.34);
  groundBaseY   = canvas.height - groundOffset;
  PM_base       = mobile ? 100 : 200;
  PM            = PM_base * userZoom;
  if (minimap) { minimap.width = canvas.width; minimap.height = mobile ? 48 : 64; }
}
resizeMain();
window.addEventListener('resize', resizeMain);

