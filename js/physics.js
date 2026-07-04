'use strict';
// ═══════════════════════════════════════════════════════════
//  STATIC EQUILIBRIUM INIT
// ═══════════════════════════════════════════════════════════
function getMsprung() {
  return (184 + P.mass) - P.m_unsprung_f - P.m_unsprung_r;
}

function initPhysics() {
  const K_F = P.k_f * 1000;
  const K_R = P.k_r * 1000;
  const Ms  = getMsprung();
  const W   = Ms * g;   // total sprung weight

  // Static spring compressions at equilibrium (clamped to 95% of max travel)
  const sagF = Math.min(W * 0.49 / K_F, TRAVEL_MAX * 0.95);
  const sagR = Math.min(W * 0.51 / K_R, TRAVEL_MAX * 0.95);

  // Wheel ground contact (natural position = wheel just touching terrain)
  const nat_f = calcNaturalWY_m(worldX_m,            WHEEL_R_F);
  const nat_r = calcNaturalWY_m(worldX_m - WHEELBASE, WHEEL_R_R);

  // At equilibrium each wheel penetrates the tire spring by exactly enough to
  // support its share of the unsprung + suspended load.
  const pen_f = (K_F * sagF + P.m_unsprung_f * g) / P.k_tire_f;
  const pen_r = (K_R * sagR + P.m_unsprung_r * g) / P.k_tire_r;

  // Front fork: set compression DOF directly (negative = compressed)
  forkSlide_f  = -sagF;
  vForkSlide_f = 0;

  // Rear suspension: seed the swingarm at the nominal sag angle. The 500-step
  // settle loop below relaxes it to the true equilibrium for the current spring.
  swingAngle = SW_PHI_SAG;
  swingRate  = 0;
  rearWheelY_m = nat_r + pen_r;          // seed: rear wheel on terrain
  rearWheelX_m = worldX_m - WHEELBASE;   // approximate, updated by physics after settle

  // Solve 2-eq system for equilibrium pitch and chassis CoM height.
  // Front: steerHead_Y = chassisY + A_FRONT·pitch = nat_f + pen_f − (REST_F − sagF)·cosRake
  // Rear:  rear axle world Y = chassisY + ax_c·pitch + ay_c = nat_r + pen_r   (small-angle)
  //        where (ax_c, ay_c) is the axle position in the chassis frame at the sag angle.
  const cosRake = Math.cos(RAKE_RAD);
  const ax_c  = SW_PIV_X_FROM_COM - SWINGARM_L * Math.cos(swingAngle);  // chassis-frame axle X
  const ay_c  = SW_PIV_Y_FROM_COM + SWINGARM_L * Math.sin(swingAngle);  // chassis-frame axle Y
  const eq_f  = (nat_f + pen_f) - (REST_F_M - sagF) * cosRake;          // steerHead_Y
  const eq_r2 = (nat_r + pen_r) - ay_c;                                  // chassisY + ax_c·pitch target
  pitchAngle = (eq_f - eq_r2) / (A_FRONT_M - ax_c);                      // A_FRONT − ax_c ≈ wheelbase
  chassisY_m = eq_f - pitchAngle * A_FRONT_M;

  // Seed derived front wheel world position from initial chassis pose
  {
    const φ0 = RAKE_RAD - pitchAngle;
    const steerY0 = chassisY_m + A_FRONT_M * pitchAngle;
    frontWheelX_m = worldX_m + (REST_F_M + forkSlide_f) * Math.sin(φ0);
    frontWheelY_m = steerY0   + (REST_F_M + forkSlide_f) * Math.cos(φ0);
  }

  vChassis = 0; pitchRate = 0; vForkSlide_f = 0; swingRate = 0;
  vChassisX = 0;   // hold the bike stationary during the settle loop
  rearContact = false;

  // Settle with terrain FROZEN (speed=0) so bumps don't create transients
  // that overwhelm the initial equilibrium estimate.
  const savedSpeed = P.speed;
  P.speed = 0;
  for (let i = 0; i < 500; i++) simStep(0.005);
  P.speed = savedSpeed;
  vChassis = 0; vForkSlide_f = 0; swingRate = 0; pitchRate = 0;
  vChassisX = savedSpeed / 3.6;   // launch at the slider's target speed
  omega_f = vChassisX / WHEEL_R_F; omega_r = vChassisX / WHEEL_R_R;   // wheels rolling at speed
  rearContact = false;
  initialized = true;
}

// ═══════════════════════════════════════════════════════════
//  DAMPING FORCE  (using per-wheel LUTs)
// ═══════════════════════════════════════════════════════════
function dampForce(rv, isComp, isRear) {
  // Single "damping gain / oil viscosity" per wheel scales BOTH comp and reb
  // (like changing the oil viscosity affects the whole damper).
  const gain    = isRear ? P.damp_r : P.damp_f;
  const lut     = isComp
    ? (isRear ? compLUT_R : compLUT_F)
    : (isRear ? rebLUT_R  : rebLUT_F);
  const baseMax = isComp
    ? (isRear ? F_MAX_R_COMP : F_MAX_F_COMP)
    : (isRear ? F_MAX_R_REB  : F_MAX_F_REB);
  const scaleKey = (isComp ? 'comp' : 'reb') + (isRear ? 'R' : 'F');
  const F_MAX   = baseMax * (curveScaleVals[scaleKey] / 100);
  const normV   = Math.abs(rv) / V_MAX_SIM;
  // Above the curve window (|rv| > V_MAX_SIM) a real damper keeps building force through
  // its high-speed region — it does not saturate flat. evalCurveLUT clamps its input to
  // [0,1], so extend past the window LINEARLY along the curve's end slope. Capped so a
  // pathological hit can't command unbounded force, and the effective c (force/velocity)
  // never exceeds what the sub-step integrator already sees inside the window.
  let frac;
  if (normV <= 1) {
    frac = evalCurveLUT(lut, normV);
  } else {
    const yEnd  = evalCurveLUT(lut, 1);
    const slope = (yEnd - evalCurveLUT(lut, 1 - 1 / 32)) * 32;   // end slope of the curve
    frac = Math.min(3.0, yEnd + Math.max(0, slope) * (normV - 1));
  }
  return gain * frac * F_MAX;
}

// ═══════════════════════════════════════════════════════════
//  REAR SWINGARM KINEMATICS  (chassis frame)
// ═══════════════════════════════════════════════════════════
// All positions here are in the chassis frame (m, relative to CoM, +x fwd, +y down).
// The swingarm rotates about the pivot by `phi`; the chassis pose is applied later
// only when converting to world/screen coordinates.

// Axle position (chassis frame) for a given swingarm angle.
function swAxleChassis(phi) {
  return {
    x: SW_PIV_X_FROM_COM - SWINGARM_L * Math.cos(phi),
    y: SW_PIV_Y_FROM_COM + SWINGARM_L * Math.sin(phi),
  };
}

// Shock length for a given swingarm angle — via the rocker linkage (lkSolve).
// The EOM consumes only shockLen(phi) and its derivative, so routing the shock
// through the linkage automatically yields the progressive (rising) rate.
function shockLength(phi) {
  return lkSolve(phi).shockLen;
}

// d(shockLength)/d(phi), central finite difference (rad).
function dShockLength(phi) {
  const h = 1e-4;
  return (shockLength(phi + h) - shockLength(phi - h)) / (2 * h);
}

// d(axle_y in CHASSIS frame)/d(phi) = L·cos(phi)  — chassis-frame vertical wheel rate.
function dAxleYchassis(phi) {
  return SWINGARM_L * Math.cos(phi);
}

// ═══════════════════════════════════════════════════════════
//  CHASSIS BODY ↔ GROUND CONTACT  (inelastic "dead block" landing)
// ═══════════════════════════════════════════════════════════
// Resolves collisions between the rigid chassis body points and the terrain when the
// bike wheelie-flips or endos. Uses sequential velocity impulses with ZERO restitution
// (no bounce) plus a Baumgarte position push-out, so the body lands dead and stays put —
// the heavy "steel block on dirt" feel. Each penetrating point also gets a strong
// tangential friction impulse so the bike doesn't skate along the ground after impact.
function resolveChassisGroundContacts(Ms, M_total) {
  const comX_m = worldX_m - A_FRONT_M;
  // Resolve a few sequential passes so multiple simultaneous contacts settle (pins the body).
  for (let pass = 0; pass < 3; pass++) {
    const cP = Math.cos(pitchAngle), sP = Math.sin(pitchAngle);
    let any = false;
    for (const [px, py] of CHASSIS_CONTACTS) {
      const armX = px * cP - py * sP;             // world horizontal offset of point from CoM
      const wy   = chassisY_m + (px * sP + py * cP);
      const gy   = groundY_m(comX_m + armX);
      const pen  = wy - gy;                        // >0 → point is below the surface (penetrating)
      if (pen <= 0) continue;
      any = true;
      const w = 1 / Ms + (armX * armX) / I_YY;     // generalized inverse mass for a vertical impulse here

      // Velocity impulse: cancel the downward (into-ground) velocity of the point.
      const vptY = vChassis + pitchRate * armX;    // vertical velocity of the contact point
      if (vptY > 0) {
        const Jn = -(1 + BODY_RESTITUTION) * vptY / w;   // momentum impulse (N·s), negative = upward
        vChassis  += Jn / Ms;
        pitchRate += Jn * armX / I_YY;
        // Tangential (horizontal) friction on the whole-vehicle surge DOF. Limited both by
        // Coulomb's μ·|Jn| AND by a per-resolution surge-change cap, so a fast tip-clip
        // (large Jn from high pitch-rate) can't yank the bike to a stop in one step.
        const maxJt = Math.min(BODY_FRICTION * Math.abs(Jn), BODY_TANGENT_DV * M_total);
        let Jt = -vChassisX * M_total;
        Jt = Math.max(-maxJt, Math.min(maxJt, Jt));
        vChassisX += Jt / M_total;
      }
      // Position correction: push the point out of the ground (prevents sinking under
      // gravity). Capped per pass so a fast-spinning, partially-buried body can't be
      // catapulted by large penetrations — it just stops dead instead.
      const corr = Math.min(BODY_POS_CORRECT * pen, 0.02);
      chassisY_m += -corr * (1 / Ms) / w;
      pitchAngle += -corr * (armX / I_YY) / w;
    }
    if (!any) break;
  }
}

// ── Tire bottoming (rim on the ground) — inelastic dead stop ────────────────
// When a tire is compressed past its travel limit the rim is on the dirt: a rigid stop.
// The carcass spring (routed through the light unsprung mass) can't arrest a hard landing
// without either sinking underground (force capped) or launching (stiff spring). So we
// resolve it as an inelastic contact through the chassis heave+pitch DOFs — which carry
// the mass — killing the inbound velocity (restitution 0) and pushing the rim back to the
// limit. Result: the bike stops DEAD at the rim, no deep sink, no rebound launch.
function resolveTireBottom(Ms) {
  const comX_m = worldX_m - A_FRONT_M;
  const wheels = [
    [frontWheelX_m, frontWheelY_m, WHEEL_R_F, TIRE_TRAVEL_F, false],
    [rearWheelX_m,  rearWheelY_m,  WHEEL_R_R, TIRE_TRAVEL_R, true],
  ];
  for (const [wx, wy, r, travel, isRear] of wheels) {
    const excess = (wy - calcNaturalWY_m(wx, r)) - travel;   // how far past the rim limit
    if (excess <= 0) continue;
    const armX = wx - comX_m;                                // horizontal offset from CoM
    // REAR: the wheel rides on the SWINGARM, so the rim bottoming must compress the swingarm
    // (rotate it toward bump), NOT dead-stop the chassis. The old chassis dead-stop pinned the
    // chassis at the rear wheel and FROZE the swingarm at partial travel — the bug where big drops
    // "locked" the rear short of full travel. The swingarm's own bump clamp (PHI_FULL_BUMP) remains
    // the true full-travel stop; only once it's there does the rim become a rigid dead-stop.
    if (isRear) {
      const lever = SWINGARM_L * Math.cos(swingAngle - pitchAngle);   // world-vertical swing lever
      if (lever > 0.05 && swingAngle > PHI_FULL_BUMP + 1e-3) {
        swingAngle = Math.max(PHI_FULL_BUMP, swingAngle - excess / lever);  // take up the rim excess
        const vptY = vChassis + pitchRate * armX;            // inbound velocity at the contact
        if (vptY > 0) swingRate = -vptY / lever;             // keep STROKING (compress), don't pin
        continue;
      }
      // swingarm fully compressed (bottomed) → fall through to the rigid chassis dead-stop
    } else {
      // FRONT: the wheel rides on the FORK, so the rim bottoming must COMPRESS THE FORK along its
      // axis (not dead-stop the chassis, which froze the fork at partial travel — the same lockout
      // bug the rear had: a hard bump bottoms the tire and the fork "walks out" short of full
      // travel). Take up the vertical rim excess as fork-axis travel (excess / cosφ); the fork's
      // own bottom-out clamp (−TRAVEL_MAX) is the true full-travel stop, only then a rigid dead-stop.
      const cphi = Math.cos(RAKE_RAD - pitchAngle);          // fork-axis vertical projection
      const room = forkSlide_f + TRAVEL_MAX;                 // remaining fork compression travel (≥0)
      if (cphi > 0.2 && room > 1e-4) {
        const want = excess / cphi;                          // fork-axis travel to absorb the rim excess
        if (want <= room) {
          forkSlide_f -= want;                               // fork absorbs it ALL — no lockout
          const vptY = vChassis + pitchRate * armX;          // inbound velocity at the contact
          if (vptY > 0) {
            vForkSlide_f = -vptY / cphi;                     // descent → fork STROKE (the fork absorbs it)
            // ARREST the chassis descent (its momentum is now in the fork). Without this the chassis
            // free-falls through the whole absorb phase and piles up penetration that the dead-stop
            // then ejects all at once → a chassis "pop" on hard landings. Bleeding it off here keeps
            // the wheel out of the ground AND the chassis settle smooth.
            const wInv = 1 / Ms + (armX * armX) / I_YY;
            const Jn = -vptY / wInv;
            vChassis  += Jn / Ms;
            pitchRate += Jn * armX / I_YY;
          }
          continue;
        }
        forkSlide_f = -TRAVEL_MAX;                            // fork takes what it can, then bottoms
      }
      // fork bottomed → the residual rim excess is rigid: fall through to the chassis dead-stop so
      // the chassis is ARRESTED (otherwise a hard descent keeps punching the wheel through the floor).
    }
    const wInv = 1 / Ms + (armX * armX) / I_YY;
    const vptY = vChassis + pitchRate * armX;                // chassis-borne wheel vertical vel
    if (vptY > 0) {                                          // arrest the descent (dead, restitution 0)
      const Jn = -vptY / wInv;
      vChassis  += Jn / Ms;
      pitchRate += Jn * armX / I_YY;
    }
    // A rebounding/extending fork (vForkSlide_f > 0) drives the wheel DOWN past the bottomed rim — the
    // ground stops it, so kill that extension; otherwise the fork punches the wheel through the floor.
    if (!isRear && vForkSlide_f > 0) vForkSlide_f = 0;
    // FULLY eject the penetration this substep (the suspension is bottomed = a rigid column, and the
    // descent velocity is already killed above, so there is no catapult). Eject as a pure vertical
    // translation — coupling the position fix through pitch (armX/I_YY) kicks the nose and bounces the
    // bike into a harder re-landing, which is exactly what made a capped/lever push-out let hard hits
    // sink in for ~0.2 s. Clamp to a sane max to ignore pathological terrain spikes.
    chassisY_m -= Math.min(excess, 0.5);
  }
}

// ═══════════════════════════════════════════════════════════
//  SIMULATION STEP  (sub-stepped for numerical stability)
// ═══════════════════════════════════════════════════════════
// Default tire spring ~300000 N/m, unsprung ~13kg → ω≈152 rad/s → Euler stable for dt<0.013s.
// Cap each sub-step at 0.005s → safe 2.6× margin.
const MAX_SUBSTEP = 0.005;  // seconds

function _physicsStep(dt_s) {
  const Ms  = getMsprung();
  const K_F = P.k_f * 1000;  // N/m
  const K_R = P.k_r * 1000;
  // Shock spring rate (N/m) calibrated so the WHEEL rate at sag equals K_R:
  //   wheel_rate = K_SHOCK / MR_sag²  ⇒  K_SHOCK = K_R · MR_sag².
  const K_SHOCK = K_R * SW_MR_SAG * SW_MR_SAG;

  const M_total = 184 + P.mass;   // total vehicle mass (sprung + unsprung)

  // ── Longitudinal (surge) DOF — real tire contact forces, speed emerges ──────
  // gasInput / brakeInput ramp 0→1 then back, giving progressive throttle/brake.
  // Net longitudinal force = tractive (rear) + braking + aero drag + rolling
  // resistance + cruise assist. Integrating it gives vChassisX; the speed slider
  // is the cruise-control TARGET, and the displayed speed is the emergent vChassisX.
  {
    // GAS & BRAKE use the SAME direction-dependent ease-out integrator, so both behave
    // identically: press → fast off the bottom then slows into full; release → snaps down
    // from a high level then eases to zero. (rate ∝ remaining^0.6 reproduces a 1−(1−t)^2.5
    // curve over the ramp time.) This makes the brake progressive instead of grabby.
    const rampUp   = (x, T) => Math.min(1, x + (2.5 / T) * Math.pow(1 - x, 0.6) * dt_s);
    const rampDown = (x, T) => Math.max(0, x - (2.5 / T) * Math.pow(x,     0.6) * dt_s);
    // Throttle and brake are INDEPENDENT — you can hold both (brake-torque / burnout / slide).
    // The wheel responds to net torque (engine drive vs brake + friction), so whichever wins
    // wins; the brake never disables the throttle.
    gasInput   = gasPressed   ? rampUp(gasInput,   GAS_RAMP_UP)   : rampDown(gasInput,   GAS_RAMP_DOWN);
    // Independent front/rear brakes — "both" (B / button) drives each. Ramp each separately so
    // the front and rear can be at different levels (e.g. trail the rear while hard on the front).
    const wantF = brakeFrontHeld || brakeBothHeld;
    const wantR = brakeRearHeld  || brakeBothHeld;
    brakeInputF = wantF ? rampUp(brakeInputF, BRAKE_RAMP_UP) : rampDown(brakeInputF, BRAKE_RAMP_DOWN);
    brakeInputR = wantR ? rampUp(brakeInputR, BRAKE_RAMP_UP) : rampDown(brakeInputR, BRAKE_RAMP_DOWN);
    brakeInput  = Math.max(brakeInputF, brakeInputR);   // derived: "any brake" + display
  }

  // Traction requires ground contact: a wheel in the air makes no drive/brake force
  // (and no pitch torque). Without this an airborne wheelie keeps being spun up by the
  // throttle like a flywheel. Uses the previous sub-step's contact flags (1-step lag).
  const onGroundRear  = rearContact;
  const onGroundFront = f_tire_F !== 0;
  const anyGround     = onGroundRear || onGroundFront;

  // ── Drivetrain: engine RPM, clutch, gearbox → rear-wheel drive force ────────
  const ratio    = effRatio(gear);
  const lockedRPM = Math.max(RPM_IDLE, omega_r * ratio * RADS2RPM);  // engine RPM if clutch locked
  // Clutch engagement ramps toward target (pulled → 0 open, released → 1 locked).
  {
    const ceTarget = clutchPulled ? 0 : 1;
    const ceStep   = dt_s / (clutchPulled ? CLUTCH_PULL_TIME : CLUTCH_ENGAGE_TIME);
    clutchEngage  += Math.sign(ceTarget - clutchEngage) * Math.min(Math.abs(ceTarget - clutchEngage), ceStep);
    clutchEngage   = Math.max(0, Math.min(1, clutchEngage));
  }
  // ── Gear-shift detection: torque cut + rev-match ────────────────────────────
  // The UI writes `gear` directly (ui.js shiftGear); detect the change HERE so shift
  // mechanics live entirely in the drivetrain. A clutchless (clutch-out) shift
  // interrupts drive while the dogs swap (shiftTimer) and rev-matches the crank to the
  // new ratio (RPM regime below). A shift with the clutch pulled needs no cut — the
  // clutch is already open and the existing slip model handles re-engagement. While
  // startGrace > 0 a reset/restart just re-seeded state (incl. gear): resync silently
  // so there's no phantom cut on reset, rewind-restore, or scenario setup.
  if (startGrace > 0) shiftTimer = 0;
  if (gear !== gearPrev) {
    if (startGrace <= 0 && engineRunning && clutchEngage > 0.5) shiftTimer = SHIFT_CUT_TIME;
    gearPrev = gear;
  }
  shiftTimer = Math.max(0, shiftTimer - dt_s);
  const shiftCut = shiftTimer > 0;
  // ── Stall state machine ─────────────────────────────────────────────────────
  // Lugging the engine — clutch OUT (engaged), in gear, crawling/stopped, no throttle — stalls
  // it after a short delay. The idle creep below keeps it alive when free to roll; holding the
  // brake (or never pulling the clutch at a stop) loads it down and kills it. A grace window
  // after a start/reset prevents an instant spawn-stall.
  if (initialized && startGrace > 0) startGrace -= dt_s;
  if (initialized && engineRunning) {
    // Lugging = clutch out, in gear, no throttle, crawling/stopped, AND the brake is holding it
    // (engine fighting the brake → bogs and stalls). With NO brake the idle creep below pulls it
    // forward and it survives; hold the brake at a stop without pulling the clutch and it stalls.
    // Disabled during the init settle loop (initialized=false).
    const lugging = clutchEngage > 0.6 && gasInput < 0.1 && brakeInput > 0.25
                    && Math.abs(vChassisX) < STALL_SPEED && startGrace <= 0;
    stallLugTimer = lugging ? stallLugTimer + dt_s : 0;
    if (stallLugTimer > STALL_DELAY) { engineRunning = false; engineStalledEvt = true; stallLugTimer = 0; }
  }
  // Engine RPM: 0 (spinning down) when stalled; else locked to the wheel when fully engaged,
  // otherwise free (gas revs it). While the rev limiter is cutting (set last frame) the free
  // revs FALL — so held at WOT the engine bounces RPM_LIMIT↔RPM_LIMIT−LIMITER_BAND.
  if (!engineRunning) {
    engineRPM = Math.max(0, engineRPM - ENGINE_STALL_DECAY * dt_s);
  } else if (shiftCut && clutchEngage > 0.5) {
    // Mid-shift: the box is between gears, the crank is unloaded. Slew toward the NEW
    // ratio's locked speed at the free-crank rate — revs FALL on an upshift, BLIP UP on
    // a downshift — so the relock at the end of the cut is near-seamless instead of a
    // one-frame RPM snap (which looked and sounded like teleporting revs).
    const d = lockedRPM - engineRPM;
    engineRPM += Math.sign(d) * Math.min(Math.abs(d), SHIFT_MATCH_RATE * dt_s);
    engineRPM  = Math.max(RPM_IDLE, Math.min(RPM_LIMIT, engineRPM));
  } else if (clutchEngage > 0.98 && onGroundRear) {
    // Clutch locked ON THE GROUND: the bike's speed dictates the revs (idle floor).
    engineRPM = Math.min(RPM_LIMIT, Math.max(RPM_IDLE, lockedRPM));
  } else {
    // Engine on its OWN inertia: clutch in (free-rev), slipping, or AIRBORNE in gear (the engine
    // drags the rear wheel). dω/dt = (T_combustion − T_friction)/I, where I is the crank/flywheel
    // inertia PLUS — when the clutch is engaged airborne — the rear wheel's inertia reflected
    // through the gear. So the revs climb at the flywheel-limited rate (no light-wheel skyrocket),
    // and a heavier rear wheel or a taller gear slows the climb. Off-throttle, pumping friction
    // brings it back toward idle.
    const T_comb  = revLimiterCut ? 0 : (GAS_ACCEL * ENGINE_K) * gasInput * engTorqueFac(engineRPM);
    const revFrac = Math.max(0, (engineRPM - RPM_IDLE) / (RPM_REDLINE - RPM_IDLE));
    const T_fric  = REV_FRIC * (0.15 + 0.85 * revFrac) * (1 - 0.7 * gasInput);
    const I_rev   = I_ENGINE_REV + clutchEngage * (onGroundRear ? 0 : I_WHEEL_R / (ratio * ratio));
    let   dRPM    = (T_comb - T_fric) / I_rev * RADS2RPM;
    if (revLimiterCut) dRPM = -LIMITER_DROP_RATE;   // fuel cut → revs fall fast (limiter bounce)
    engineRPM = Math.max(RPM_IDLE, Math.min(RPM_LIMIT, engineRPM + dRPM * dt_s));
  }
  const engOn = engineRunning ? 1 : 0;   // gates all engine-produced forces
  // Rev-limiter hysteresis: cut at the ceiling, release once revs drop a band below it. Use the
  // UNCLAMPED locked rpm when engaged (engineRPM is pinned to RPM_LIMIT) so the cut still fires
  // and bounces the bike at top speed in gear too.
  const rpmForLimiter = (clutchEngage >= 0.999) ? lockedRPM : engineRPM;
  if (rpmForLimiter >= RPM_LIMIT)                     revLimiterCut = true;
  else if (rpmForLimiter <= RPM_LIMIT - LIMITER_BAND) revLimiterCut = false;
  // Engine crank torque follows the MT-07 dyno curve → wheel torque via the gear. The limiter is
  // a hard fuel cut: zero drive while cutting, so the bike can't push past it (and bounces).
  const T_eng_peak  = GAS_ACCEL * ENGINE_K;
  const torqueFac   = engTorqueFac(engineRPM);
  const F_throttle  = (revLimiterCut || !engineRunning || shiftCut) ? 0 : (T_eng_peak * gasInput * torqueFac * ratio / WHEEL_R_R * clutchEngage);
  // Idle creep: a running engine in gear with the clutch out pulls the bike forward at idle
  // (so it crawls from a stop instead of sitting dead). Idle crank torque through the gear,
  // eased off as it reaches the creep speed; scales with the ratio (1st crawls, 6th barely).
  const F_idle = (engineRunning && !shiftCut && clutchEngage > 0.5 && gasInput < 0.1 && vChassisX < IDLE_CREEP_SPEED)
    ? IDLE_CRANK_TORQUE * ratio / WHEEL_R_R * clutchEngage * Math.max(0, 1 - vChassisX / IDLE_CREEP_SPEED)
    : 0;
  // Clutch slip: engine spinning faster than the wheel transmits a big torque while the
  // clutch is engaging — this is the clutch-up wheelie. It also sheds engine RPM.
  let F_clutch = 0;
  const slipRPM = engineRPM - lockedRPM;
  if (engineRunning && !shiftCut && slipRPM > 0 && clutchEngage > 0.02 && clutchEngage < 0.999) {
    const clutchT = Math.min(CLUTCH_MAX_TORQUE, K_CLUTCH_SLIP * slipRPM) * clutchEngage; // N·m engine-side
    F_clutch  = clutchT * ratio / WHEEL_R_R;                       // extra wheel drive force
    engineRPM = Math.max(lockedRPM, engineRPM - (clutchT / I_ENGINE) * RADS2RPM * dt_s);
  }
  // Engine braking: closed-throttle pumping/friction torque at the crank, sent through the
  // gear to the wheel — strong in low gears (high ratio), weak in high. Scales from ZERO at
  // idle up to full near redline (more aggressive the higher the revs), so releasing the
  // clutch at idle with the wheel speed matched produces no braking force (no pitch).
  const offThr     = Math.max(0, 1 - gasInput / 0.15);   // 1 fully off-throttle, 0 above ~15%
  const revFrac    = Math.max(0, (engineRPM - RPM_IDLE) / (RPM_REDLINE - RPM_IDLE)); // 0 idle → 1 redline
  // Zero during a shift cut: the box is between gears, so nothing brakes the wheel either.
  const engBrakeT  = ENGINE_BRAKE_K * revFrac * offThr * clutchEngage * engOn * (shiftCut ? 0 : 1);
  const F_engbrake = (vChassisX > 0.1) ? engBrakeT * ratio / WHEEL_R_R : 0;
  // ── Tire friction limit (grip slider × pressure × normal load) ──────────────
  // Each tire can only transmit so much longitudinal force before it slides: μ·N, where
  // N is the (previous-frame) tire normal load and μ scales with the surface (grip slider)
  // and tire pressure. Low grip = dirt: weak drive (rear spins), long braking, no big wheelie.
  const gripCurve = Math.pow(Math.max(0, P.tireGrip), GRIP_CURVE);
  const muRear   = MU_BASE * gripCurve * gripPressure(P.psi_r);
  const muFront  = MU_BASE * gripCurve * gripPressure(P.psi_f);
  const capRear  = muRear  * Math.abs(f_tire_R);   // max rear  longitudinal force (N)
  const capFront = muFront * Math.abs(f_tire_F);   // max front longitudinal force (N)
  const F_drive_raw  = onGroundRear ? (F_throttle + F_clutch - F_engbrake + F_idle) : 0;
  const F_drive_term = Math.max(-capRear, Math.min(capRear, F_drive_raw));   // rear traction-limited
  // Braking opposes forward motion only (no reversing once stopped). Each brake acts at ITS OWN
  // contact and is limited by THAT tire's grip (capFront / capRear). Under braking weight shifts
  // forward, so capFront grows (front does most of the stopping) while capRear shrinks (the rear
  // locks/skids easily) — all emergent. The rear demand is weaker (REAR_BRAKE_FRAC). Both forces
  // feed the surge decel and, via a_long below, the nose-dive load transfer.
  const brakeDir     = (vChassisX > 0 ? 1 : 0);
  const F_brakeF_raw = onGroundFront ? -(M_total * BRAKE_DECEL)                  * brakeInputF * brakeDir : 0;
  const F_brakeR_raw = onGroundRear  ? -(M_total * BRAKE_DECEL * REAR_BRAKE_FRAC) * brakeInputR * brakeDir : 0;
  const F_brakeF     = Math.max(-capFront, Math.min(capFront, F_brakeF_raw));   // front traction-limited
  const F_brakeR     = Math.max(-capRear,  Math.min(capRear,  F_brakeR_raw));   // rear  traction-limited
  const F_brake_term = F_brakeF + F_brakeR;
  // No cruise/auto-speed-hold: the bike is ridden manually with throttle, clutch, gears and
  // engine braking. (A cruise assist would either fight engine braking or — when gated to
  // clutch-in — wrongly accelerate the bike with the clutch pulled.) The speed slider sets
  // the speed directly (see its bind) and seeds the launch speed on reset.
  // Resistive forces. Aero drag acts always; rolling resistance only when a wheel is down.
  const F_drag = -RHO_CDA * vChassisX * Math.abs(vChassisX);
  const F_rr   = (anyGround && Math.abs(vChassisX) > 0.05) ? -Math.sign(vChassisX) * C_RR * M_total * g : 0;

  // ── Terrain-normal horizontal contact force ─────────────────────────────────
  // The tire contact force points along the local ground NORMAL, not straight up. On a slope
  // or bump face the normal tilts, so it has a horizontal component: scrubs speed climbing a
  // face, adds speed down the back, and loads the bike on grades. Uses the smoothed wheel-PATH
  // slope (calcNaturalWY_m is already rounded by the wheel radius) so sharp edges don't spike;
  // the slope is clamped. Prev-frame tire loads/positions (1-step lag, like the friction caps).
  // F_x = −F_y·slope with F_y = f_tire (negative = up), slope = d(pathY)/dx (Y-down: +=downhill
  // ahead). This RAW force feeds two independent sliders below: TERRAIN_BITE → speed (here) and
  // TERRAIN_PITCH → pitch moment (in the pitch EOM), so the contact below the CoM kicks the nose.
  let F_x_terrain = 0;
  {
    // Wheel-scale finite difference (≈0.8·wheel radius): the tire bridges texture finer than
    // itself, so the contact normal follows the MACRO slope (ramps, whoop faces) — a small step
    // would amplify cm-scale texture/noise into spurious, constant speed-scrub.
    const ds = 0.25;
    const slopeAt = (x, r) => {
      const s = (calcNaturalWY_m(x + ds, r) - calcNaturalWY_m(x - ds, r)) / (2 * ds);
      return Math.max(-SLOPE_CLAMP, Math.min(SLOPE_CLAMP, s));
    };
    if (onGroundFront) F_x_terrain += -f_tire_F * slopeAt(frontWheelX_m, WHEEL_R_F);
    if (onGroundRear)  F_x_terrain += -f_tire_R * slopeAt(rearWheelX_m,  WHEEL_R_R);
  }

  // Tractive/brake forces act at the contact patches (≈H_COM below CoM) → they
  // also produce the dive/squat pitch moment (computed in the pitch EOM below).
  const F_contact_long = F_drive_term + F_brake_term;
  // Engine ROTATIONAL inertia: when the clutch is locked, accelerating the bike must also spin
  // the crank up, which reflects to the wheel as added effective mass (I·ratio²/R²). Big in low
  // gears, ~nil in top — so the engine's spin-up inertia is now felt in the acceleration.
  const mEngReflect = (engineRunning && !shiftCut && clutchEngage > 0.9 && onGroundRear)
    ? I_ENGINE_REFLECT * ratio * ratio / (WHEEL_R_R * WHEEL_R_R) : 0;
  const a_x = (F_contact_long + F_drag + F_rr) / (M_total + mEngReflect);
  a_long = a_x;                       // load-transfer pitch source (terrain pitch handled separately)
  vChassisX += (a_x + F_x_terrain * TERRAIN_BITE / M_total) * dt_s;
  if (vChassisX < -1) vChassisX = -1;   // allow a small backward roll (e.g. rear falling from a stoppie)

  // While the rider is actively on gas/brake, the cruise TARGET follows the actual
  // speed — so releasing holds the speed you reached instead of the cruise controller
  // dragging the bike back to the old slider value. The slider UI is synced in draw().
  if (gasInput > 0.02 || brakeInput > 0.02) {
    P.speed = Math.max(0, Math.min(160, vChassisX * 3.6));
  }

  // ── Advance world X BEFORE computing wheel positions ─────────────────────
  // Driven by the integrated surge velocity (not the slider). Keeps worldX_m and
  // frontWheelX_m/rearWheelX_m on the same frame so w2sx() stays correct.
  worldX_m += vChassisX * dt_s;

  // ── Wheel spin dynamics + engine/brake torque reaction on pitch ──────────────
  // On the ground, tire grip relaxes each wheel's spin to the rolling speed (no slip).
  // In the air, engine torque (gas, rear only) spins the rear wheel up to a rev limit
  // and the brakes slow both wheels. The chassis feels MINUS the wheels' angular
  // acceleration (conservation of angular momentum): wheels speeding up ⇒ nose up;
  // wheels braking ⇒ nose down — works airborne, which is how riders adjust attitude.
  let tau_react = 0;
  {
    const og_f = omega_f, og_r = omega_r;
    const gripK = Math.min(1, GRIP_LAMBDA * dt_s);
    // Rear wheel
    const I_eff_r = I_WHEEL_R + I_ENGINE * ratio * ratio * SPIN_I_FRAC;  // wheel + engine reflected
    const T_brake_r = BRAKE_TORQUE_R * brakeInputR * Math.tanh(omega_r / 3);  // ≥0, REAR brake opposes spin
    if (onGroundRear) {
      const omega_roll = vChassisX / WHEEL_R_R;
      // Traction is force-limited (capRear = μ·|tire normal load|). If the engine demands more
      // than the tyre can hold, the SURPLUS torque spins the wheel faster than rolling — it
      // breaks loose and the revs climb. When NOT over-driven, kinetic friction PLUS the brake
      // and engine braking pull the spinning wheel back down to rolling (so it doesn't spin on
      // forever and the brake actually slows it). The clutch is locked, so the wheel + engine
      // co-rotate (combined reflected inertia).
      const surplus = F_drive_raw - capRear;        // N at the contact; >0 = tyre can't hold
      const rearLocking = brakeInputR > 0.05 && Math.abs(F_brakeR_raw) > capRear && omega_roll > 0.5;
      if (surplus > 0) {
        omega_r += (surplus * WHEEL_R_R - T_brake_r) / I_eff_r * dt_s;  // wheelspin up (brake fights it)
        if (omega_r < omega_roll) omega_r = omega_roll;
      } else if (rearLocking) {
        // Rear brake overpowers grip → the wheel SKIDS/LOCKS (omega_r → 0) and slides.
        omega_r += (0 - omega_r) * Math.min(1, WHEEL_LOCK_RATE * dt_s);
      } else if (omega_r > omega_roll + 1e-3) {
        // Spinning but no longer over-driven (off-throttle / braking): kinetic friction + brake
        // pull it back toward rolling. The regrip rate scales with the tire NORMAL LOAD, so a
        // wheel that lands or hits a bump (load spike, big |f_tire_R|) bites hard and snaps back
        // to rolling instead of spinning on forever; brake regrips hard too.
        const regrip = (6 + 30 * brakeInputR + REGRIP_LOAD_K * Math.abs(f_tire_R)) * dt_s;
        omega_r += (omega_roll - omega_r) * Math.min(1, regrip);
      } else {
        omega_r += (omega_roll - omega_r) * gripK;            // within grip → locked to rolling
      }
    } else {
      // Airborne. Clutch ENGAGED → the rear wheel is dragged by the engine, so it tracks engine
      // speed through the gear (the engine's flywheel inertia limits the spin-up — handled in the
      // RPM block above — so the revs no longer skyrocket on the light wheel). Clutch OPEN → the
      // wheel is free; the rear brake plus a little engine-braking slow it.
      if (clutchEngage > 0.5) {
        omega_r = engineRPM / (ratio * RADS2RPM);
      } else {
        const engBrakeAir = ENGINE_BRAKE_K * 8 * (1 - gasInput) * clutchEngage * Math.tanh(omega_r / 3);
        const tau = -T_brake_r - engBrakeAir;
        omega_r = Math.max(0, omega_r + (tau / I_WHEEL_R) * dt_s);
      }
    }
    // Front wheel (no drive). The front brake can overpower grip: when the DEMANDED front brake
    // force exceeds the front grip cap (|F_brakeF_raw| > capFront — easy on dirt/gravel, or with
    // full brake on tarmac), the wheel SKIDS/LOCKS (omega_f → 0) instead of rolling at vehicle
    // speed. This detection works during deceleration (it's force-vs-grip, not omega-vs-rolling).
    // Ease off the brake and it regrips.
    if (onGroundFront) {
      const omega_roll_f = vChassisX / WHEEL_R_F;
      const frontLocking = brakeInputF > 0.05 && Math.abs(F_brakeF_raw) > capFront && omega_roll_f > 0.5;
      if (frontLocking) omega_f += (0 - omega_f) * Math.min(1, WHEEL_LOCK_RATE * dt_s);   // skid
      else              omega_f += (omega_roll_f - omega_f) * gripK;                       // rolls
    } else {
      const tau = -BRAKE_TORQUE_F * brakeInputF * Math.tanh(omega_f / 3);
      omega_f = Math.max(0, omega_f + (tau / I_WHEEL_F) * dt_s);
    }
    // Reaction torque on the chassis = −d(wheel angular momentum)/dt. Clamped so a
    // big landing resync (sudden grip) can't deliver a violent one-step kick.
    const dLf = I_WHEEL_F * (omega_f - og_f) / dt_s;
    const dLr = I_WHEEL_R * (omega_r - og_r) / dt_s;
    tau_react = Math.max(-TAU_REACT_MAX, Math.min(TAU_REACT_MAX, -(dLf + dLr)));
    wheelAngle_f += omega_f * dt_s;
    wheelAngle_r += omega_r * dt_s;
    // Contact slip speed (m/s) for the tire-slip sound: how fast the tread is sliding over the
    // ground. >0 when locked (skid) or spinning (wheelspin); ~0 when rolling true. Only counts
    // when the wheel is on the ground.
    frontSlipV = onGroundFront ? Math.abs(omega_f * WHEEL_R_F - vChassisX) : 0;
    rearSlipV  = onGroundRear  ? Math.abs(omega_r * WHEEL_R_R - vChassisX) : 0;
  }

  // ── Fork geometry: axis locked to chassis ─────────────────────────────────
  // Fork axis = RAKE_RAD - pitchAngle from world vertical, always.
  // Proper 2D rotation: chassis-frame fork vector (sin RAKE, cos RAKE) rotated by pitchAngle
  // gives world direction (sin(RAKE-pitch), cos(RAKE-pitch)).
  const φ_f  = RAKE_RAD - pitchAngle;
  const cosφ = Math.cos(φ_f);
  const sinφ = Math.sin(φ_f);
  const s_f  = REST_F_M + forkSlide_f;          // current fork length along axis
  // Projection of the (world-vertical) contact/gravity force onto the fork axis = the
  // fraction that loads the SPRING (the rest is reacted by the fork structure → chassis).
  // True value is cos(φ_f); it's kept exact up to the rest rake (so the static stance and
  // heavy stoppie loading are unchanged), then falls off LINEARLY to zero as the fork-to-
  // vertical angle approaches 90° — so as the contact patch nears perpendicular to the fork
  // the spring is progressively (proportionally) unloaded, reaching zero at 90°.
  const forkProj = (() => {
    const a = Math.abs(φ_f);
    if (a <= RAKE_RAD) return Math.cos(a);                      // ≤ rest rake: true cos
    const t = (a - RAKE_RAD) / (Math.PI / 2 - RAKE_RAD);        // 0 at rake → 1 at 90°
    return Math.max(0, Math.cos(RAKE_RAD) * (1 - t));           // linear cos(RAKE) → 0
  })();

  // Steer head: full 2D rotation of chassis axis from CoM
  const cosP   = Math.cos(pitchAngle), sinP = Math.sin(pitchAngle);
  const comX_m = worldX_m - A_FRONT_M;
  const steerX = comX_m + A_FRONT_M * cosP;     // full cos for X
  const steerY = chassisY_m + A_FRONT_M * sinP; // full sin for Y
  frontWheelX_m = steerX + s_f * sinφ;          // wheel world X (derived, not integrated)
  frontWheelY_m = steerY + s_f * cosφ;          // wheel world Y (derived, not integrated)

  // ── Rear swingarm: wheel position from swingAngle (chassis-frame arc) ──────
  // The wheel is a point mass at the swingarm tip, rotating about the pivot.
  // Axle in chassis frame, then full 2-D rotation by pitch into world coords.
  const axle_xc = SW_PIV_X_FROM_COM - SWINGARM_L * Math.cos(swingAngle);  // chassis-frame X
  const axle_yc = SW_PIV_Y_FROM_COM + SWINGARM_L * Math.sin(swingAngle);  // chassis-frame Y
  rearWheelX_m = comX_m     + axle_xc * cosP - axle_yc * sinP;
  rearWheelY_m = chassisY_m + axle_xc * sinP + axle_yc * cosP;

  // ── Solid track-wall collision (Custom track only) — crash & endo ──────────────────────────
  // A wheel that can't clear a wall's top, when its leading edge overlaps the wall face, gets a
  // stiff horizontal barrier force (spring on the overlap + damping, capped). The force acts at
  // contact height (≈H_COM below the CoM), so it also pitches the bike forward over the bars.
  // A front hit additionally compresses the fork (horizontal force projected onto the fork axis).
  let tau_wall = 0;
  if (P.terrain === 7 && trackWalls.length) {
    const lap = trackTotalLen;
    const vx0 = vChassisX;                                // approach speed (before this block)
    const wheels = [
      { x: frontWheelX_m, y: frontWheelY_m, R: WHEEL_R_F, front: true },
      { x: rearWheelX_m,  y: rearWheelY_m,  R: WHEEL_R_R, front: false },
    ];
    let inContact = false, endoSum = 0;
    for (const w of trackWalls) {
      for (const wh of wheels) {
        const wx = (((wh.x % lap) + lap) % lap);
        const wheelBottomAbove = -wh.y - wh.R;            // wheel-bottom height above ground (m)
        if (wheelBottomAbove >= w.top - 0.02) continue;   // wheel clears the wall top → rides over
        let overlap, dir;
        if (vx0 >= 0) { overlap = (wx + wh.R) - w.x0; dir = 1; }   // hitting the left face
        else          { overlap = w.x1 - (wx - wh.R); dir = -1; }  // backing into the right face
        if (overlap <= 0 || overlap > wh.R + (w.x1 - w.x0) + 0.6) continue;
        inContact = true;
        const into  = dir > 0 ? Math.max(0, vx0) : Math.max(0, -vx0);  // speed INTO the wall
        const Fmag  = Math.min(WALL_FMAX, WALL_K * overlap + WALL_C * into);
        const Fwall = -dir * Fmag;
        vChassisX += (Fwall / M_total) * dt_s;            // decelerate / stop at the wall
        endoSum   += dir * Math.min(WALL_ENDO_CAP, WALL_ENDO_K * into);  // nose-over, fades as it stops
        if (wh.front) vForkSlide_f += (Fwall * sinφ / P.m_unsprung_f) * dt_s;  // fork compresses
      }
    }
    if (inContact) {
      // endo torque + heavy pitch damping while jammed → the bike pitches over the bars and SETTLES
      // (instead of spinning) and the chassis-body collision catches it on the ground.
      tau_wall = endoSum - WALL_PITCH_DAMP * pitchRate;
      if (vChassisX < -1) vChassisX = -1;
    }
  }

  // ── Front fork spring & damper (along fork axis) ──────────────────────────
  // forkSlide_f < 0 → compressed → spring pushes wheel out (extends fork)
  const df   = forkSlide_f - P.pre_f;            // spring displacement; preload offsets the curve
  const rv_f = vForkSlide_f;                      // relative velocity along fork axis
  // NOTE: mechanical travel is limited on the PHYSICAL forkSlide_f DOF (see the fork-limit
  // block below), NOT on df. So preload only shifts ride height / sag and the force curve — it
  // does NOT change how far the fork can compress or extend.

  // Linear coil rate.
  let f_spring_lin = K_F * df;                   // neg = compressed → pushes wheel out
  // Air-spring progression: deeper compression ramps up the effective rate (like an
  // air gap / progressive spring). 0% = pure linear; 100% = strong rising rate near bottom.
  // Based on PHYSICAL compression so it ramps near the real bottom regardless of preload.
  if (forkSlide_f < 0 && P.air_f > 0) {
    const xn = -forkSlide_f / TRAVEL_MAX;         // 0..1 physical compression fraction
    f_spring_lin += -K_F * P.air_f * TRAVEL_MAX * 2.0 * (xn * xn * xn);
  }
  f_spring_F = f_spring_lin;

  const comp_f   = rv_f < 0;
  const fd_mag_f = rv_f !== 0 ? dampForce(rv_f, comp_f, false) : 0;
  f_damp_F = Math.sign(rv_f) * fd_mag_f;

  // ── Hydraulic bump stop (last BS_ZONE of compression travel) ───────────────
  // A stiff progressive spring plus velocity-dependent hydraulic damping that only
  // resists further compression — models the fork's end-stroke hydraulic lock.
  {
    const comp   = -forkSlide_f;                   // PHYSICAL compression (m), >0
    const thresh = TRAVEL_MAX * (1 - BS_ZONE);
    if (comp > thresh) {
      const e = (comp - thresh) / (TRAVEL_MAX * BS_ZONE);  // 0..1 engagement
      f_spring_F += -K_F * BS_STIFF * (e * e) * (TRAVEL_MAX * BS_ZONE);  // push out
      if (rv_f < 0) f_damp_F += BS_DAMP * (e * e) * rv_f;                // resist compression
    }
  }
  const fsusp_f  = f_spring_F + f_damp_F;        // force along fork axis (neg = compressed)

  // ── Rear shock spring & damper (swingarm rotational DOF) ────────────────
  // The shock connects a fixed chassis mount to a swingarm-borne mount; its
  // length is a pure function of swingAngle, so spring/damper are driven via
  // virtual work. BOTH the spring AND the damper act in the shock and therefore
  // pass through the linkage's motion ratio, so both are progressive (rising rate):
  // their effective wheel-rate scales as 1/MR². The user sliders are calibrated to
  // mean the wheel-rate value AT SAG; the linkage adds the progression around that.
  //
  // Shock kinematics:
  shockLen_cur        = shockLength(swingAngle);
  const dShock        = dShockLength(swingAngle);          // m/rad, >0 (compression shortens shock)
  const wheelLeverY   = dAxleYchassis(swingAngle);         // = L·cosφ, chassis-frame wheel-vertical lever
  // World-frame vertical lever of the rear contact about the pivot: ∂(wheel world Y)/∂φ =
  // L·cos(φ − pitch). As the chassis pitches into a wheelie the contact-patch (world-vertical)
  // force gets a SMALLER lever on the swingarm, so the spring unloads and the load transfers
  // straight to the chassis through the pivot. The falloff is shaped to be more PROPORTIONAL
  // to the pitch angle (so the spring sheds load gradually as the angle is approached rather
  // than staying full then dumping near vertical), and clamped ≥0 so past the point where the
  // contact force lines up through the pivot it just goes fully unloaded — it does not flip
  // sign and fling the swingarm out. Used for the world-vertical gravity & tire forces; the
  // chassis-frame shock force keeps wheelLeverY.
  const leverAng = swingAngle - pitchAngle;
  // cos gives the true torque arm but is flat near 0 (load barely sheds early); blend it
  // mostly toward a linear-in-angle falloff so the spring sheds load roughly PROPORTIONALLY
  // to the pitch/contact angle (reaching ~0 by ~80°) instead of staying full then dumping.
  const leverCos  = Math.max(0, Math.cos(leverAng));
  const leverLin  = Math.max(0, 1 - Math.abs(leverAng) / 1.40);   // 1 at 0°, 0 at ~80°
  const wheelLeverYw = SWINGARM_L * (0.25 * leverCos + 0.75 * leverLin);
  // Shock spring: K_shock is calibrated (initPhysics) so wheel rate at sag = P.k_r.
  // Preload P.pre_r is a wheel-mm offset; convert to an effective shock-length offset.
  const MR_sag        = SW_MR_SAG;                          // wheel-travel / shock-travel at sag
  const preShockLen   = P.pre_r / MR_sag;                    // m of extra shock compression from preload
  shockTravel_r       = (SHOCK_REST_LEN - shockLen_cur) + preShockLen;  // + = compressed
  const F_shock_sprg  = K_SHOCK * shockTravel_r;            // N along shock, + = compressed (pushes out)
  // Spring force referred to the wheel (chassis +y = down): compressed pushes wheel DOWN.
  const F_spring_wheel = F_shock_sprg * dShock / wheelLeverY;   // N, + = pushes wheel down (extends)

  // Damper — PROGRESSIVE, via the same motion ratio as the spring.
  // The damper is a shock element, so it responds to SHOCK velocity and its force
  // is referred back to the wheel through the linkage. Calibrating the user curve to
  // the wheel rate at sag, the physically correct transform is:
  //   F_damp_wheel = (MR_sag/MR) · curve( wheelVertRate · MR_sag/MR )
  // For a linear damper this makes the effective wheel-damping coefficient scale as
  // (MR_sag/MR)² — exactly like the spring rate — so the rear damps harder as it
  // compresses (MR drops toward bump) and softer toward droop. At sag MR=MR_sag ⇒
  // ratio 1 ⇒ identical to the old wheel-referenced behavior.
  const wheelVertRate = wheelLeverY * swingRate;            // m/s, chassis-rel wheel vel (+ = extend)
  rearSuspVel         = wheelVertRate;                       // expose for the velocity graph
  const MR_cur        = wheelLeverY / dShock;               // signed current motion ratio
  let   dampRatio     = MR_sag / MR_cur;                    // = MR_sag/MR (>0; signs cancel)
  dampRatio           = Math.max(0.3, Math.min(3.0, dampRatio)); // guard against extremes
  const v_eff         = wheelVertRate * dampRatio;          // shock-referenced damper velocity
  const comp_r        = v_eff < 0;                          // compressing = wheel moving up
  const fd_mag_r      = v_eff !== 0 ? dampForce(v_eff, comp_r, true) : 0;
  // Damper force on the wheel (+y down) opposes wheel motion, scaled by the ratio.
  const F_damp_wheel  = -Math.sign(v_eff) * fd_mag_r * dampRatio;

  // Net suspension force on the WHEEL (+y down); chassis feels the opposite.
  const F_wheel_susp  = F_spring_wheel + F_damp_wheel;
  // fsusp_r matches the OLD chassis convention (negative when compressed → supports chassis).
  const fsusp_r       = -F_wheel_susp;
  // Display copies (wheel-rate, same sign convention as before: negative = compressed/supporting).
  f_spring_R = -F_spring_wheel;
  f_damp_R   = -F_damp_wheel;

  // ── Tire springs ──────────────────────────────────────────────────────────
  const nat_f = calcNaturalWY_m(frontWheelX_m, WHEEL_R_F);
  const nat_r = calcNaturalWY_m(rearWheelX_m,  WHEEL_R_R);

  // Front tire: spring + carcass damping. No penetration cap — full spring force drives
  // fork compression, which the compression damper needs to see a velocity and respond.
  // Carcass damping (pressure-dependent) keeps a soft tire from springing back — it
  // resists both compression and rebound. The wheel's vertical velocity is ANALYTIC —
  // d/dt of the wheel-Y derivation above: heave + pitch sweep of the steer head + fork
  // slide, all projected to world-vertical. It was a finite difference of wheel Y, but
  // the POSITION corrections applied after integration (resolveTireBottom's vertical
  // ejection, the chassis-contact push-out) landed in the diff as one-substep teleport
  // velocities → spurious carcass-damper spikes/dropouts in f_tire_F on hard landings.
  // The velocity states are impulse-corrected consistently, so this sees only real motion.
  const pen_f = Math.max(0, frontWheelY_m - nat_f);
  const v_tire_f = vChassis + (A_FRONT_M * cosP + s_f * sinφ) * pitchRate + vForkSlide_f * cosφ;
  f_tire_F = tireForce(pen_f, v_tire_f, P.k_tire_f, P.m_unsprung_f, dt_s, TIRE_TRAVEL_F);

  // Rear tire spring — now safe to include in a_susp_r (see EOM below).
  // In the new chassis-relative DOF architecture, rv_r = vSuspR (not derived from
  // vRearWheel - v_rear_attach), so the tire spring force no longer contaminates
  // the damper velocity with pitchRate or vChassis jumps.
  // The tire spring is REQUIRED for suspension equilibrium: without it, a_susp_r
  // has a large extension bias (gravity + compressed spring both extend), which
  // fights the hard-floor constraint and causes chassis velocity build-up.
  {
    const pen_r = Math.max(0, rearWheelY_m - nat_r);
    const v_pen_r = wheelLeverYw * swingRate;  // world-vertical contact velocity (+ve = compressing)
    f_tire_R = tireForce(pen_r, v_pen_r, P.k_tire_r, P.m_unsprung_r, dt_s, TIRE_TRAVEL_R, REAR_TIRE_DAMP_MULT);
  }

  // ── Chassis heave EOM ─────────────────────────────────────────────────────
  // Fork force on chassis: the fork is tilted, so only the Y component acts on
  // chassis heave (the X component is part of the whole-vehicle surge DOF above).
  const fsusp_f_y  = fsusp_f * cosφ;            // Y component of fork force on chassis

  // Longitudinal LOAD TRANSFER: weight shifts because the whole bike ACCELERATES, so the
  // moment is M·a·H (net longitudinal accel × CoM height), NOT the raw drive force. This
  // matters at terminal speed: at redline the engine still makes torque (F_drive ≠ 0) but
  // drag cancels it (a ≈ 0), so a force-based moment would wrongly hold the nose up forever.
  // Using net accel, steady speed → no pitch; only real accel lifts and real decel dives.
  //   forward accel → nose lifts (negative pitch torque); braking/decel → nose dives.
  // Load transfer needs a contact patch to transfer through — zero it when fully airborne, else
  // aero-drag deceleration spuriously pitches the nose DOWN in free flight (it stays active on the
  // ground and in wheelies/stoppies, where a wheel is down so anyGround is true).
  const tau_long   = (anyGround ? 1 : 0) * -M_total * a_long * H_COM * P.drivePitch;

  // Rigid "through-the-pivot" path at the wheelie balance point. As the swingarm approaches
  // vertical (world) its lever cos(θ)→0: the wheel is geometrically locked to the chassis
  // vertically, so a bump can't be absorbed by the swingarm and must drive the chassis
  // directly. Blend the rear chassis force from the shock (normal riding) toward the tire
  // force acting DIRECTLY on the chassis (rigid) as the swingarm stands up — so bumps pop the
  // bike at balance (rigid-unicycle feel) instead of the force being lost. ~0 in normal riding.
  const thetaSwWorld = swingAngle - pitchAngle;
  // Gate on pitch so it only engages in the wheelie/balance regime (~15°→40°); normal riding
  // keeps the usual shock-isolated behaviour, the steep wheelie gets the rigid coupling.
  const pivotGate    = Math.max(0, Math.min(1, (Math.abs(pitchAngle) - 0.26) / (0.70 - 0.26)));
  const pivotFrac    = Math.sin(thetaSwWorld) ** 2 * pivotGate;   // 0 normal → toward 1 at balance
  const fsusp_r_eff  = fsusp_r * (1 - pivotFrac) + f_tire_R * pivotFrac;

  // Same rigid coupling on the FRONT for a stoppie: balanced nose-down on the front wheel, a
  // bump should pop the bike rather than be soaked by the fork. Gated on nose-DOWN pitch, so
  // it engages in the stoppie regime and is ~0 in normal riding/wheelies (front airborne).
  const frontPivotFrac = Math.max(0, Math.min(1, (pitchAngle - 0.26) / (0.70 - 0.26)));
  const fsusp_f_y_eff  = fsusp_f_y * (1 - frontPivotFrac) + f_tire_F * frontPivotFrac;

  const a_chassis   = g + (fsusp_f_y_eff + fsusp_r_eff) / Ms;

  // ── Pitch EOM ─────────────────────────────────────────────────────────────
  // Suspension pitch moment: each wheel's vertical force × its moment arm from CoM.
  // Front suspension acts at A_FRONT_M ahead of CoM; rear at B_REAR_M behind CoM.
  // Positive tau_susp = nose-up (front pushes chassis up relative to rear). Each force's
  // contribution is passed through digMoment() so large wheel forces apply a digressively
  // smaller moment (softer pitch jolt) while small forces stay near-linear.
  // The moment ARM of each (world-vertical) support force is the EXACT world-horizontal distance
  // from the CoM to that wheel's contact (using the live wheel positions, not an approximation).
  // So the restoring moment shrinks to zero precisely when the CoM is over the contact (true
  // top-dead-centre balance) and REVERSES past it — the bike tips over a wheelie/stoppie only
  // once the CoM has actually crossed the contact, and near balance the (small) arm makes the
  // tip gentle rather than snapping over early.
  const comX_arm   = worldX_m - A_FRONT_M;               // CoM world X
  const leverFront = frontWheelX_m - comX_arm;           // +ve = front contact ahead of CoM
  const leverRear  = rearWheelX_m  - comX_arm;           // -ve = rear contact behind CoM
  const tau_susp  = leverFront * digMoment(fsusp_f_y_eff) + leverRear * digMoment(fsusp_r_eff);
  // Residual pitch damping. With load transfer now emergent (tau_long from real
  // contact forces) and the suspension dampers contributing through tau_susp, the
  // old inflated 100 N·m·s/rad fudge is no longer needed; a modest residual keeps
  // numerics calm and stands in for unmodeled structural/tire-carcass damping.
  const C_PITCH_DRAG = 40; // N·m·s/rad
  const AIR_PITCH_DAMP = 33; // N·m·s/rad extra pitch damping while fully airborne (light self-leveling)
  // When FULLY airborne the bike holds its attitude (conservation of angular momentum) and only
  // the wheel torque-reaction (tau_react) should change pitch. The drooped/topped suspension would
  // otherwise apply a spurious pitch moment to a free-flying bike, so zero tau_susp here. On the
  // ground or one wheel down (wheelie/stoppie) it's normal.
  const fullyAir = !onGroundFront && !onGroundRear;
  // P.pitchMoment (slider) scales how much the suspension forces pitch the chassis;
  // 0 = bumps cause no pitch (heave only), 1 = full effect.
  const tau_susp_eff = (fullyAir ? 0 : tau_susp) * P.pitchMoment;
  // ── Longitudinal tire grip (planted-contact rolling) ──────────────────────
  // Pitching the chassis moves a contact patch horizontally (≈ -pitchRate·H_COM). A planted
  // tire's static friction resists that slip, turning pitch-about-a-planted-wheel into ROLLING:
  // so when a stoppie's rear falls (or a wheelie's front drops) the bike rolls instead of the
  // contact sliding, and at a stop the rear falling back rolls the bike rearward a little.
  // Gated to the balance regime (pitch >~15°) AND to LOW SPEED (<~2 m/s) — it's only for the
  // come-to-a-stop case (don't-slide / roll-back). At speed it must NOT act, or it couples
  // pitch↔roll and acts like a balance assist (over-restoring the wheelie/stoppie).
  {
    const pitchGate = Math.max(0, Math.min(1, (Math.abs(pitchAngle) - 0.26) / (0.70 - 0.26)));
    const speedGate = Math.max(0, 1 - Math.abs(vChassisX) / 2);   // 1 at a stop → 0 by 2 m/s
    const gripGate  = pitchGate * speedGate;
    if (gripGate > 0) {
      const contactSlip = -pitchRate * H_COM;     // horizontal velocity of a contact from pitch
      const want = -GRIP_LONG_K * contactSlip * gripGate;
      let F_grip = 0;
      if (onGroundFront) { const cap = GRIP_MU * P.tireGrip * Math.abs(f_tire_F); F_grip += Math.max(-cap, Math.min(cap, want)); }
      if (onGroundRear)  { const cap = GRIP_MU * P.tireGrip * Math.abs(f_tire_R); F_grip += Math.max(-cap, Math.min(cap, want)); }
      vChassisX += (F_grip / M_total) * dt_s;       // grip rolls the bike (no reaction pitch moment —
      if (vChassisX < -1) vChassisX = -1;           // it would hold the bike pitched up). Small reverse roll.
    }
  }

  // Rear-brake anti-wheelie: the rear brake is very effective at bringing a wheelie down (it
  // doesn't depend on forward speed like the load-transfer dive does). Apply a nose-down pitch
  // moment when braking with the rear planted during a wheelie. Gated to nose-up pitch so it
  // doesn't add to normal braking dive. Scales with the brake-rate slider.
  const wheelieAmt = Math.max(0, Math.min(1, (-pitchAngle - 0.15) / 0.35));   // 0 at ~8.5° up → 1 at ~28° up
  const tau_rearbrake = (onGroundRear ? 1 : 0) * REAR_BRAKE_LEVER * M_total * BRAKE_DECEL * brakeInputR * wheelieAmt;

  // Terrain-normal PITCH (pass 2): the horizontal terrain force acts at the contact ≈H_COM
  // below the CoM, so it pitches the bike — front into a bump face kicks the nose DOWN (endo
  // over the bars), the back of a bump/ramp pitches it UP. Same lever form as tau_long
  // (height × horizontal force); independent slider so it's tunable apart from the speed scrub.
  // CLAMPED: f_tire spikes on impact would otherwise let it pump the pitch into resonance over
  // repeated bumps (30°+ swings). The cap keeps single kicks bounded so the slider stays sane.
  const tau_terrain = Math.max(-TERRAIN_PITCH_CAP, Math.min(TERRAIN_PITCH_CAP,
                               -F_x_terrain * TERRAIN_PITCH * H_COM));

  // tau_react: engine/brake wheel angular-momentum reaction (nose-up on spin-up, nose-down
  // on braking) — the only pitch source that works airborne (air throttle blip / brake tap).
  // Airborne pitch damping: jumps impart a forward launch rotation; with strict angular-momentum
  // hold the bike noses over and lands front-first with the rear unloaded ("rear won't travel").
  // A modest air damping lets it self-level toward a flatter landing (so both wheels work) while
  // still allowing intentional rotation — it bleeds the RATE, it doesn't pull toward any attitude.
  const pitchDampC = C_PITCH_DRAG + (fullyAir ? AIR_PITCH_DAMP : 0);
  const alpha_pitch = (tau_susp_eff + tau_long + tau_react + tau_rearbrake + tau_terrain + tau_wall - pitchDampC * pitchRate) / I_YY;

  // ── Fork slide EOM (chassis-relative DOF along fork axis) ─────────────────
  // Forces along fork axis on the unsprung wheel mass:
  //   gravity component: M_UNSPRUNG_F * g * cosφ  (extends fork)
  //   spring+damper:    -fsusp_f                   (compressed → pushes wheel out)
  //   tire projection:   f_tire_F * cosφ           (upward tire force, projected)
  // Fork EOM: unsprung wheel mass along fork axis (chassis-relative DOF).
  // Use simple uncoupled form — the chassis inertial coupling term caused the
  // fork to appear to rotate opposite the chassis during pitch events.
  const a_fork = g * forkProj
               - fsusp_f / P.m_unsprung_f
               + f_tire_F * forkProj / P.m_unsprung_f;

  // ── Rear swingarm rotational EOM (about the pivot) ──────────────────────
  // The wheel is a point mass at the swingarm tip. We sum generalized forces
  // (torques) about the pivot for the swingAngle DOF:
  //   I_sw·α = Q_grav_eff + Q_tire + Q_susp
  // Each vertical force on the wheel maps to a torque via the wheel lever
  // (L·cosφ = dAxleY/dφ in the chassis frame).
  //
  // EFFECTIVE GRAVITY (g − a_chassis): the pivot accelerates with the chassis,
  // so in the chassis (non-inertial) frame the wheel feels gravity reduced by the
  // chassis vertical acceleration. Airborne, a_chassis ≈ g ⇒ effective gravity ≈ 0
  // ⇒ the swingarm does NOT droop in free-fall (both masses fall together). On the
  // ground, a_chassis ≈ 0 ⇒ full gravity. This physically replaces the old
  // "airborne reduced-mass" hack and prevents the g-driven velocity buildup that
  // caused the landing spike. a_chassis is already computed above (feed-forward,
  // no circular dependency since it depends on fsusp_r, not on α_sw).
  const I_sw   = P.m_unsprung_r * SWINGARM_L * SWINGARM_L + I_SWINGARM;
  // World-vertical forces (gravity, tire contact) use the WORLD lever so chassis pitch
  // changes their leverage on the swingarm; the chassis-frame shock force uses wheelLeverY.
  const Q_grav = P.m_unsprung_r * (g - a_chassis) * wheelLeverYw; // + = droop (extend)
  const Q_tire = f_tire_R * wheelLeverYw;                         // f_tire_R<0 (up) ⇒ compress
  const Q_susp = F_wheel_susp * wheelLeverY;                      // + = extend (compressed shock)
  // Longitudinal (drive/brake) force at the rear contact also torques the swingarm through
  // the geometry: generalized lever ∂(wheel world X)/∂φ = L·sin(φ − pitch). The lever grows
  // as the bike pitches up, so near a vertical wheelie the drive/brake (and the clutch
  // engaging) push/pull the bike right through the swingarm — gas extends it (anti-squat /
  // lifts), brake & engine-braking compress it (pitch the nose down). The front friction
  // brake doesn't act here; the rear gets all of it only when the front wheel is airborne.
  const rearBrakeFrac = (f_tire_F !== 0) ? 0.4 : 1.0;
  const F_rear_long = F_drive_term + F_brake_term * rearBrakeFrac; // N, + = forward
  // Gate the effect to the steep wheelie/stoppie regime. At low pitch (normal riding/whoops)
  // this swingarm coupling can pump into a pitch↔suspension feedback, so fade it in from
  // ~25° to ~45° of pitch — exactly where the rider wants the drive/brake/clutch to push the
  // bike through the geometry (e.g. holding a wheelie at balance).
  const pitchGate = Math.max(0, Math.min(1, (Math.abs(pitchAngle) - 0.44) / (0.79 - 0.44)));
  const Q_long = ANTI_SQUAT_SCALE * pitchGate * F_rear_long * SWINGARM_L * Math.sin(swingAngle - pitchAngle);
  const alpha_sw = (Q_grav + Q_tire + Q_susp + Q_long) / I_sw;   // rad/s²

  // ── Integrate (explicit Euler) ────────────────────────────────────────────
  vChassis     += a_chassis   * dt_s;
  pitchRate    += alpha_pitch * dt_s;
  chassisY_m   += vChassis    * dt_s;
  pitchAngle   += pitchRate   * dt_s;


  vForkSlide_f += a_fork      * dt_s;
  forkSlide_f  += vForkSlide_f * dt_s;

  // Swingarm EOM — integrate unconditionally (same as the front fork).
  // The tire spring Q_tire is the contact force; it prevents ground penetration
  // and naturally allows the wheel to bounce off bumps. Gating to airborne only
  // (the old approach) bypassed the unsprung-mass dynamics and glued the wheel
  // kinematically to the terrain, killing the wheel-mass behaviour the user sees.
  swingRate  += alpha_sw * dt_s;
  swingAngle += swingRate * dt_s;

  // ── Fork travel limits (direct DOF clamp — no positional correction needed) ─
  if (forkSlide_f > TRAVEL_EXT) {
    forkSlide_f = TRAVEL_EXT;
    if (vForkSlide_f > 0) vForkSlide_f = 0;
  } else if (forkSlide_f < -TRAVEL_MAX) {
    forkSlide_f = -TRAVEL_MAX;
    if (vForkSlide_f < 0) {
      // Front bottom-out: redirect the wheel's inbound vertical momentum mostly into a
      // nose-UP rotation about the CoM (impact at A_FRONT_M ahead), with only a small
      // residual heave. Inelastic — the rest of the energy is dissipated, so the bike
      // pitches off the stop instead of launching into an endless vertical bounce.
      // Bounce slider: 0 = dead (redirect all momentum into pitch, no rebound), higher =
      // the chassis pops up off the stop. Rebounding the fork itself just slams it into
      // the top-out and dies internally — so the bounce launches the *chassis* upward
      // (that's what the rider feels). Scales up to 10× (super-elastic) for a hard pop.
      const eF     = P.bottomBounceF;   // 0 = dead … up to 10× (super-elastic) rebound
      const pf     = bottomOutFactor(P.k_tire_f);              // soft front tire absorbs more
      const p_raw  = P.m_unsprung_f * (-vForkSlide_f) * cosφ;  // inbound impact momentum (>0)
      const p_dead = p_raw * Math.max(0, 1 - eF);              // dead-block redirect (fades out by 1×)
      pitchRate -= BOTTOM_ROT    * pf * P.pitchMoment * p_dead * A_FRONT_M / I_YY;  // nose up (negative pitch)
      vChassis  -= BOTTOM_HEAVE  * pf * p_dead / Ms;            // small dead-block heave
      vChassis  -= eF * BOTTOM_BOUNCE * pf * p_raw / Ms;        // bounce: launch chassis up
      vForkSlide_f = 0;                                         // fork stops at the stop (no internal rebound)
    }
  }

  // ── Swingarm angle mechanical limits ────────────────────────────────────
  if (swingAngle > PHI_FULL_DROOP) {
    // Top-out (full droop / rebound stop). Clamp the angle but DO NOT zero
    // swingRate: the (now extended) shock spring pulls the swingarm back over a
    // few ms, giving a smooth velocity curve instead of an instantaneous step —
    // the rotational analog of the liftoff-spike fix.
    swingAngle = PHI_FULL_DROOP;
  } else if (swingAngle < PHI_FULL_BUMP) {
    // Bottom-out (hard bump stop). Redirect the rear wheel's inbound vertical momentum
    // mostly into a nose-DOWN rotation about the CoM (impact at B_REAR_M behind), with
    // only a small residual heave. Inelastic — the rest is dissipated, so the rear kicks
    // the tail up instead of bouncing the whole bike vertically forever.
    swingAngle = PHI_FULL_BUMP;
    if (swingRate < 0) {
      const eR     = P.bottomBounceR;   // 0 = dead … up to 10× (super-elastic) rebound
      const pf     = bottomOutFactor(P.k_tire_r);                    // soft rear tire absorbs more
      const p_raw  = P.m_unsprung_r * (-(wheelLeverY * swingRate));  // inbound impact momentum (>0)
      const p_dead = p_raw * Math.max(0, 1 - eR);                    // dead-block redirect (fades out by 1×)
      pitchRate += BOTTOM_ROT    * pf * P.pitchMoment * p_dead * B_REAR_M / I_YY;     // nose down (positive pitch)
      vChassis  -= BOTTOM_HEAVE  * pf * p_dead / Ms;                 // small dead-block heave
      vChassis  -= eR * BOTTOM_BOUNCE * pf * p_raw / Ms;             // bounce: launch chassis up
      swingRate = 0;                                                 // swingarm stops at the stop
    }
  }

  // ── Chassis body ↔ ground (inelastic) — after the pose integrates, before it's
  // used to derive wheel positions, so a flipped/landed body reads correctly. ──
  resolveChassisGroundContacts(Ms, M_total);

  // Wheel vertical travel from the unloaded rest angle (+ = compressed).
  wheelTravel_r = SWINGARM_L * (Math.sin(PHI_REST) - Math.sin(swingAngle));

  // Save display travel (negative = compressed). Use the PHYSICAL fork position (not the
  // preload-offset spring displacement) so the gauge/bars read true travel and the full
  // range is fixed regardless of preload (preload only moves the resting sag within it).
  disp_f = forkSlide_f;
  disp_r = -wheelTravel_r;   // negative = compressed (same display convention as before)

  // ── Recompute derived front wheel world position after all corrections ─────
  // No hard-floor snap here: the tire spring drives fork compression naturally,
  // which produces vForkSlide_f < 0 and activates the compression damper.
  // A hard floor would bypass that velocity, making the comp damper invisible.
  {
    const φ2   = RAKE_RAD - pitchAngle;
    const cP2  = Math.cos(pitchAngle), sP2 = Math.sin(pitchAngle);
    const stX2 = (worldX_m - A_FRONT_M) + A_FRONT_M * cP2;
    const stY2 = chassisY_m + A_FRONT_M * sP2;
    frontWheelX_m = stX2 + (REST_F_M + forkSlide_f) * Math.sin(φ2);
    frontWheelY_m = stY2 + (REST_F_M + forkSlide_f) * Math.cos(φ2);
  }

  // ── Rear wheel world position from swingAngle (physics-driven, no snap) ────
  // Like the front fork, contact is handled entirely by the tire spring (f_tire_R
  // above), which was computed from the PREVIOUS sub-step's wheel position.  No
  // position snap or kinematic rate assignment: those approaches overrode the EOM
  // and erased the unsprung-mass dynamics. rearContact is used only for the AIR
  // indicator and effective-gravity term in the next sub-step.
  {
    const _cosP2 = Math.cos(pitchAngle), _sinP2 = Math.sin(pitchAngle);
    const _comX  = worldX_m - A_FRONT_M;
    const ax_c   = SW_PIV_X_FROM_COM - SWINGARM_L * Math.cos(swingAngle);
    const ay_c   = SW_PIV_Y_FROM_COM + SWINGARM_L * Math.sin(swingAngle);
    rearWheelX_m = _comX      + ax_c * _cosP2 - ay_c * _sinP2;
    rearWheelY_m = chassisY_m + ax_c * _sinP2 + ay_c * _cosP2;
    // Contact flag: wheel centre is within 5 mm of the natural ground contact point.
    const nat_r2 = calcNaturalWY_m(rearWheelX_m, WHEEL_R_R);
    rearContact  = rearWheelY_m >= nat_r2 - 0.005;
  }

  // ── Tire bottoming (rim) — inelastic dead stop, then re-derive wheel positions ──
  resolveTireBottom(Ms);
  {
    const φ3   = RAKE_RAD - pitchAngle;
    const cP3  = Math.cos(pitchAngle), sP3 = Math.sin(pitchAngle);
    const stX3 = (worldX_m - A_FRONT_M) + A_FRONT_M * cP3;
    const stY3 = chassisY_m + A_FRONT_M * sP3;
    frontWheelX_m = stX3 + (REST_F_M + forkSlide_f) * Math.sin(φ3);
    frontWheelY_m = stY3 + (REST_F_M + forkSlide_f) * Math.cos(φ3);
    const _comX = worldX_m - A_FRONT_M;
    const ax_c  = SW_PIV_X_FROM_COM - SWINGARM_L * Math.cos(swingAngle);
    const ay_c  = SW_PIV_Y_FROM_COM + SWINGARM_L * Math.sin(swingAngle);
    rearWheelX_m = _comX      + ax_c * cP3 - ay_c * sP3;
    rearWheelY_m = chassisY_m + ax_c * sP3 + ay_c * cP3;
  }

  // Gas / brake: update speed and resolve a_long
}

function simStep(dt_s) {
  // Split frame dt into sub-steps small enough for Euler stability
  const n   = Math.max(1, Math.ceil(dt_s / MAX_SUBSTEP));
  const sub = dt_s / n;
  for (let i = 0; i < n; i++) _physicsStep(sub);
}

