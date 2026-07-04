'use strict';
// ═══════════════════════════════════════════════════════════
//  (split from core.js — see CLAUDE.md ownership map; classic global scope,
//   loaded in original order so top-level execution is unchanged)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  PARAMETERS
// ═══════════════════════════════════════════════════════════
// Tire pressure → tire spring rate mapping: slider in psi, physics in N/m
// [28, 52] psi → [280 000, 340 000] N/m (36 psi = 300 000 N/m = original K_TIRE). The range is
// deliberately NARROW: a jump off a ramp is mostly ballistic, so the launch should be roughly
// pressure-independent. A wide spring range made low psi too soft to launch (bike "stuck") and
// high psi a stiff trampoline (bike "flew"). Pressure still meaningfully changes GRIP
// (gripPressure), ride harshness, carcass damping and bottoming — just not jump height.
const PSI_MIN = 28, PSI_MAX = 52;
const KTIRE_MIN = 280000, KTIRE_MAX = 340000;
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
// Tire carcass damping coefficient (N·s/m). A low-pressure tire flexes more and dissipates more
// energy (hysteresis). Scales inversely with stiffness: 1500 at nominal 36 psi; with the narrow
// spring range it now stays a mild ~1320–1610 across the pressure range (no longer dominates
// launches). Still clamped [600, 5000] for safety.
const C_TIRE_BASE = 1500;
// Rear tire runs MORE carcass damping than the front (front stays at the stable baseline). The
// rear gets damped harder (up to the explicit-stability cap) so small bumps don't set it
// oscillating down the road; the front is left alone.
const REAR_TIRE_DAMP_MULT = 1.75;
// Load-scaled rear regrip: a spinning rear wheel that lands or hits a bump (big |f_tire_R| normal
// load) bites and snaps back to rolling instead of spinning on forever. (1/s per N of load.)
const REGRIP_LOAD_K = 0.008;
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
function tireForce(pen, v, k_tire, m_unsprung, dt, travel, dampScale) {
  if (pen <= 0) return 0;
  const bottomed = pen > travel;
  let Fup = k_tire * Math.min(pen, travel);       // spring capped at the rim limit
  // Carcass hysteresis damping; DEAD (max stable) once bottomed (resists both directions).
  // dampScale (default 1) lets one tire run more carcass damping than the other (rear > front).
  const C = Math.min(bottomed ? Infinity : tireDampCoef(k_tire) * (dampScale || 1), 0.9 * m_unsprung / dt);
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
const TERRAINS = ['Bumps','Whoops','Step drop','Kicker','Rollers','Mountain Pass','Flat','Custom'];

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
// Bouncing rev limiter: a fuel cut with hysteresis. Cuts at RPM_LIMIT, stays cut until revs
// fall LIMITER_BAND below it, then fires again → the revs bounce off the top (seen + heard).
const LIMITER_BAND      = 350;   // RPM hysteresis band (bounce depth)
const LIMITER_DROP_RATE = 16000; // RPM/s the (free) revs fall while the fuel is cut
// Calibrated so the Gas-rate slider spans the REAL MT-07 product range: default 7 → 49 N·m
// peak ≈ the A2-restricted MT-07 (35 kW version), slider max 9.5 → 66.5 N·m ≈ the full-power
// bike's 68 N·m (giving ~220 km/h terminal in 6th vs the old 157). Was 5 (35 N·m — half a real
// CP2, which made 0–100 take 8+ s and capped top speed at 157 km/h).
const ENGINE_K     = 7;       // N·m of crank torque per unit of the Gas-rate slider (= PEAK torque)
const I_ENGINE     = 0.35;    // kg·m²  crank + clutch-basket inertia (engine side, clutch-slip feel)
// Engine ROTATIONAL inertia reflected to the wheel when the clutch is locked: spinning the crank
// up costs torque, so it adds effective mass = I_ENGINE_REFLECT·ratio²/R² to the surge. Felt in
// low gears (high ratio) and ~nil in top gear — tuned subtle so accel/wheelie feel is preserved.
const I_ENGINE_REFLECT = 0.011; // kg·m²  (separate, small — the force model isn't a true torque model)
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
// Engine ROTATIONAL inertia for the rev dynamics (free-rev AND airborne-in-gear). dω/dt = T/I,
// so the crank spins up/down at a flywheel-limited rate. Realistic effective value (the 0.35
// I_ENGINE is a clutch-slip lump, far too high for honest rev rates). Idle→redline ~1.3 s.
const I_ENGINE_REV = 0.045;      // kg·m²
const REV_FRIC     = 26;         // N·m  crank pumping/friction at redline (sets off-throttle decay)
const CLUTCH_PULL_TIME   = 0.06; // s  to disengage (pull in)
const CLUTCH_ENGAGE_TIME = 0.25; // s  to engage smoothly (release / dump) — not binary
const CLUTCH_MAX_TORQUE  = 85;   // N·m  max torque the clutch can transmit (engine side)
const K_CLUTCH_SLIP      = 0.02; // N·m per RPM of clutch slip
const ENGINE_BRAKE_K     = 20;   // N·m crank-side engine-braking torque at redline (off-throttle)
// ── Gear-shift mechanics ─────────────────────────────────────────────────────
// A shift isn't free: drive torque is interrupted while the dogs swap, and the crank
// must match the new ratio. The drivetrain block watches `gear` for changes and runs
// this cut; during it the crank is unloaded and SLEWS toward the new locked speed —
// falling on an upshift, BLIPPING up on a downshift — then the clutch re-locks with
// (near-)matched revs instead of a one-frame RPM snap. The slew rate is roughly what
// an unloaded CP2 crank can do (T/I_ENGINE_REV ≈ 20k RPM/s), so a big multi-gear drop
// audibly takes longer to match than a single street shift.
const SHIFT_CUT_TIME   = 0.16;   // s  drive interruption per shift (street-shift dog swap)
const SHIFT_MATCH_RATE = 22000;  // RPM/s crank slew toward the new locked speed during the cut
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

// ── Custom terrain editor (periodic profile + scale sliders) ────────────────
// terrainPts: one repeating period, x∈[0,1] (phase), y∈[0,1] (height). The two ENDPOINTS are
// locked to the same Y so the profile tiles seamlessly (last point == first point). The Length
// slider sets the period in meters; Height scales how tall the bumps draw. Used by terrain "Custom".
let terrainPts = [ { x:0, y:0.5 }, { x:0.5, y:0.85 }, { x:1, y:0.5 } ];
let terrainLUT = null;            // built once buildCurveLUT() is defined (below)
let TERRAIN_WAVELEN = 8;          // m  — period length (Length slider)
let TERRAIN_HEIGHT  = 0.30;       // m  — vertical bump scale (Height slider)
// Length is LOGARITHMIC: the 0–1000 slider maps to 2 m … 500 m as wl = 2·250^(v/1000), so equal
// slider travel is an equal RATIO change — fine control at the short end, and the top end stretches
// to very long tracks with little movement.
bind('custlen',    'lcustlen',    v => {
  TERRAIN_WAVELEN = 2 * Math.pow(250, (+v) / 1000);
  return TERRAIN_WAVELEN.toFixed(TERRAIN_WAVELEN < 20 ? 1 : 0) + ' m';
});
bind('custheight', 'lcustheight', v => { TERRAIN_HEIGHT  = +v/100; return v + ' cm'; });

