'use strict';
// ═══════════════════════════════════════════════════════════
//  WHEEL DRAWING
// ═══════════════════════════════════════════════════════════
// calAng: screen-space angle (rad) at which the brake caliper sits, measured from the wheel
// centre. Omit for no caliper. The disc spins with the wheel; the caliper does NOT — it's
// bolted to the fork leg / swingarm, so it stays put while the disc turns inside it.
function drawWheel(cx, cy, r_px, rotAngle, calAng) {
  const TAU = Math.PI * 2;
  // Fat tire section ≈ 38% of total radius — reads as a chunky motorcycle tire (with
  // the open rim, the older 27% band looked like a thin bicycle tire).
  const rimR = r_px - Math.round(r_px * 0.38);

  // Draw order is back→front: SPOKES first, then the TIRE on top, so the tire (and its
  // inner edge) sits in front of the wheel and tucks the spoke ends under it.

  // Spokes (behind) — thick, high-contrast pink (matches the fork spring & rear shock).
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotAngle || 0);
  ctx.strokeStyle = '#e11d48';
  ctx.lineWidth = Math.max(2, r_px * 0.255);   // scales with wheel size (no fixed-px floor)
  ctx.lineCap = 'round';
  const spokeInner = r_px * 0.10;              // spoke start radius — scales with the wheel
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * spokeInner, Math.sin(a) * spokeInner);
    ctx.lineTo(Math.cos(a) * rimR, Math.sin(a) * rimR);
    ctx.stroke();
  }
  ctx.restore();

  // ── Brake disc (spins with the wheel, sits over the spoke roots) ──────────
  // ~60% of the rim, as on a real bike. Any bigger and it covers the crimson spokes, which
  // are what make the wheel read as spinning.
  const discR = rimR * 0.60;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotAngle || 0);
  ctx.beginPath(); ctx.arc(0, 0, discR, 0, TAU);
  ctx.fillStyle = '#6e6e74'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, discR * 0.42, 0, TAU);   // inner carrier
  ctx.fillStyle = '#4a4a4e'; ctx.fill();
  ctx.fillStyle = '#26262a';                               // drilled holes
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * discR * 0.72, Math.sin(a) * discR * 0.72, Math.max(0.7, r_px * 0.028), 0, TAU);
    ctx.fill();
  }
  ctx.beginPath(); ctx.arc(0, 0, discR, 0, TAU);
  ctx.strokeStyle = '#8e8e96'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();

  // ── Caliper (chassis-mounted — does not rotate) ───────────────────────────
  if (calAng !== undefined) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(calAng);
    ctx.fillStyle = '#31343a'; ctx.strokeStyle = '#5c616a'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(discR * 0.50, -r_px * 0.14, discR * 0.58, r_px * 0.28, 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Rim ring (open — scene shows through between the spokes).
  ctx.beginPath(); ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
  ctx.strokeStyle = '#888'; ctx.lineWidth = 2; ctx.stroke();

  // Tire donut ON TOP — outer contact edge at the full radius; inner cutout at rimR
  // covers the spoke ends so the tire reads in front of the wheel.
  ctx.beginPath();
  ctx.arc(cx, cy, r_px, 0, Math.PI * 2, false);   // outer circle CW
  ctx.arc(cx, cy, rimR, 0, Math.PI * 2, true);     // inner cutout CCW → donut
  ctx.fillStyle = '#1c1c1c';
  ctx.fill();
  // Tire sidewall highlight ring (outer) + inner tire edge
  ctx.beginPath(); ctx.arc(cx, cy, r_px, 0, Math.PI * 2);
  ctx.strokeStyle = '#b8b8b8'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1; ctx.stroke();

  // Tread blocks — short radial notches cut into the carcass. They rotate with the wheel, which
  // is what actually sells wheel SPIN: a smooth black donut looks static even at 100 km/h.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotAngle || 0);
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineWidth = Math.max(1, r_px * 0.05);
  const treadOut = r_px - r_px * 0.03, treadIn = rimR + r_px * 0.07;
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * TAU + (i % 2) * 0.06;        // slight stagger → a blockier, dirt-tire look
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * treadIn, Math.sin(a) * treadIn);
    ctx.lineTo(Math.cos(a) * treadOut, Math.sin(a) * treadOut);
    ctx.stroke();
  }
  ctx.restore();

  // Hub (center, on top) — scales with the wheel so it doesn't balloon on a small canvas.
  ctx.beginPath(); ctx.arc(cx, cy, r_px * 0.11, 0, Math.PI * 2);
  ctx.fillStyle = '#888'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r_px * 0.048, 0, Math.PI * 2);
  ctx.fillStyle = '#ccc'; ctx.fill();
}

// ═══════════════════════════════════════════════════════════
//  BODYWORK & RIDER
// ═══════════════════════════════════════════════════════════
// Both are authored in CHASSIS-LOCAL px (CoM = 0,0, +x = forward, +y = down, PM=200 basis) —
// the same space as the frame polygon `fv` in draw(). They are called from inside the chassis
// transform, so they pitch with the bike for free. Landmarks referenced below (D, E, F, H …)
// are the frame vertices; keeping the bodywork keyed to them means it can't drift off the frame.

// Fuel tank, seat, tail, radiator and exhaust — everything bolted to the frame.
function drawBodywork() {
  // ── Radiator: ahead of the engine block, behind the front downtube ────────
  ctx.fillStyle = '#23252b'; ctx.strokeStyle = '#3c3f47'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(72, -56, 20, 46, 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#161820'; ctx.lineWidth = 1;      // core fins
  for (let y = -52; y < -12; y += 4) {
    ctx.beginPath(); ctx.moveTo(74, y); ctx.lineTo(90, y); ctx.stroke();
  }

  // ── Exhaust: header off the front of the engine, sweeping under it to a stubby
  //    upswept can beneath the tail (MT-07 routes its can low on the right side).
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0e0e0e'; ctx.lineWidth = 8;      // dark outline under the pipe
  ctx.beginPath();
  ctx.moveTo(68, 2);
  ctx.quadraticCurveTo(80, 36, 40, 46);
  ctx.quadraticCurveTo(-6, 56, -46, 36);
  ctx.stroke();
  ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 4.5;    // chrome header
  ctx.beginPath();
  ctx.moveTo(68, 2);
  ctx.quadraticCurveTo(80, 36, 40, 46);
  ctx.quadraticCurveTo(-6, 56, -46, 36);
  ctx.stroke();
  // Muffler can (upswept, tucked under the tail)
  ctx.save();
  ctx.translate(-64, 26); ctx.rotate(-0.30);
  ctx.fillStyle = '#2b2d31'; ctx.strokeStyle = '#5a5e66'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.roundRect(-24, -9, 48, 18, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#141519';                            // outlet
  ctx.beginPath(); ctx.roundRect(-26, -7, 6, 14, 3); ctx.fill();
  ctx.restore();

  // ── Fuel tank: bottom edge rides the frame's upper spar (D→E→F); the top surface
  //    bulges above it. Without this the frame polygon read as a featureless slab.
  ctx.beginPath();
  ctx.moveTo(-14, -84);
  ctx.lineTo(5, -72);                                   // D  mid-frame
  ctx.lineTo(45, -99);                                  // E  upper spar peak
  ctx.lineTo(92, -105);                                 // F  head tube top
  ctx.quadraticCurveTo(97, -119, 62, -121);             // over the top of the tank
  ctx.quadraticCurveTo(28, -123, 3, -110);
  ctx.quadraticCurveTo(-9, -100, -14, -84);
  ctx.closePath();
  const tg = ctx.createLinearGradient(0, -122, 0, -72);
  tg.addColorStop(0,   '#e11d48');                      // crimson, matching the springs/spokes
  tg.addColorStop(0.55,'#b0173a');
  tg.addColorStop(1,   '#6d0f24');
  ctx.fillStyle = tg; ctx.fill();
  ctx.strokeStyle = '#f4517a'; ctx.lineWidth = 1; ctx.stroke();
  // Knee scallop — the shadowed dish the rider's knee tucks into.
  ctx.save();
  ctx.globalAlpha = 0.30; ctx.fillStyle = '#3a0a16';
  ctx.beginPath(); ctx.ellipse(34, -95, 24, 10, -0.30, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // Specular streak along the tank's crown.
  ctx.save();
  ctx.globalAlpha = 0.5; ctx.strokeStyle = '#ff9ab4'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(12, -108); ctx.quadraticCurveTo(50, -119, 84, -110); ctx.stroke();
  ctx.restore();

  // ── Seat + tail unit ─────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(-15, -83);
  ctx.lineTo(-33, -93);
  ctx.lineTo(-76, -97);
  ctx.lineTo(-107, -95);
  ctx.quadraticCurveTo(-124, -94, -133, -88);           // upswept tail
  ctx.lineTo(-118, -84);
  ctx.lineTo(-70, -82);
  ctx.lineTo(-19, -78);
  ctx.closePath();
  const sg = ctx.createLinearGradient(0, -97, 0, -78);
  sg.addColorStop(0, '#2a2a2e'); sg.addColorStop(1, '#111');
  ctx.fillStyle = sg; ctx.fill();
  ctx.strokeStyle = '#45454a'; ctx.lineWidth = 1; ctx.stroke();
  // Tail light
  ctx.fillStyle = '#e11d48';
  ctx.beginPath(); ctx.roundRect(-136, -91, 6, 5, 2); ctx.fill();

  // Side-cover badge (moved off the engine, where the rider's thigh now sits).
  ctx.fillStyle = '#e11d48'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('MT-07', -78, -70);
}

// Handlebars — frame-fixed in this 2D sim (there is no steering DOF).
function drawHandlebars() {
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#15161a'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(103, -101); ctx.lineTo(99, -120); ctx.lineTo(66, -127); ctx.stroke();
  ctx.strokeStyle = '#6a6e76'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(103, -101); ctx.lineTo(99, -120); ctx.lineTo(66, -127); ctx.stroke();
  ctx.strokeStyle = '#0c0c0c'; ctx.lineWidth = 6;       // grip
  ctx.beginPath(); ctx.moveTo(74, -126); ctx.lineTo(63, -128); ctx.stroke();
}

// Rider silhouette. Gives the bike its sense of scale — a bare frame reads as a toy. Static
// pose: this is a suspension sim, not a rider-model, so the rider is rigidly seated.
function drawRider() {
  const limb = (x0, y0, x1, y1, w, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  };
  const HIP = [-48, -97], KNEE = [8, -76], FOOT = [-12, 14];
  const SHO = [-6, -141], ELB = [30, -134], HAND = [66, -127];

  // Leg (behind the tank; the knee tucks into the scallop)
  limb(HIP[0], HIP[1], KNEE[0], KNEE[1], 15, '#23262d');   // thigh
  limb(KNEE[0], KNEE[1], FOOT[0], FOOT[1], 11, '#1b1e24'); // shin
  ctx.fillStyle = '#0d0e10';                                // boot
  ctx.beginPath(); ctx.roundRect(FOOT[0] - 9, FOOT[1] - 3, 20, 8, 2); ctx.fill();

  // Neck — without it the helmet reads as floating free of the body.
  limb(SHO[0] + 2, SHO[1] + 2, 10, -148, 9, '#2a2d34');

  // Torso: hip → shoulder, leaned forward over the tank. Kept a few steps lighter than the
  // seat and frame behind it, or the whole rider disappears into the black bike.
  ctx.beginPath();
  ctx.moveTo(HIP[0] - 11, HIP[1] + 3);
  ctx.lineTo(SHO[0] - 14, SHO[1] + 6);
  ctx.lineTo(SHO[0] + 13, SHO[1] - 4);
  ctx.lineTo(HIP[0] + 17, HIP[1] - 5);
  ctx.closePath();
  const jg = ctx.createLinearGradient(HIP[0], HIP[1], SHO[0], SHO[1]);
  jg.addColorStop(0, '#2c3038'); jg.addColorStop(1, '#4a505c');
  ctx.fillStyle = jg; ctx.fill();
  ctx.strokeStyle = '#586070'; ctx.lineWidth = 1; ctx.stroke();
  // Racing stripe
  ctx.save(); ctx.globalAlpha = 0.85;
  limb(HIP[0] + 2, HIP[1] - 2, SHO[0] + 2, SHO[1] + 1, 3, '#e11d48');
  ctx.restore();

  // Arm reaching to the grip
  limb(SHO[0], SHO[1], ELB[0], ELB[1], 10, '#3b414b');
  limb(ELB[0], ELB[1], HAND[0], HAND[1], 8, '#3b414b');
  ctx.fillStyle = '#101114';                                // glove
  ctx.beginPath(); ctx.arc(HAND[0], HAND[1], 5, 0, Math.PI * 2); ctx.fill();

  // Helmet, with a visor facing forward (+x)
  ctx.beginPath(); ctx.arc(14, -159, 17, 0, Math.PI * 2);
  ctx.fillStyle = '#d8d8dc'; ctx.fill();
  ctx.strokeStyle = '#8e8e96'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath();                                          // chin bar
  ctx.moveTo(14, -145); ctx.quadraticCurveTo(33, -146, 30, -157); ctx.lineTo(14, -157);
  ctx.closePath(); ctx.fillStyle = '#c2c2c8'; ctx.fill();
  ctx.beginPath();                                          // visor
  ctx.moveTo(16, -170); ctx.quadraticCurveTo(32, -168, 30, -156);
  ctx.quadraticCurveTo(20, -156, 16, -162); ctx.closePath();
  ctx.fillStyle = '#1d2733'; ctx.fill();
  ctx.save(); ctx.globalAlpha = 0.45; ctx.strokeStyle = '#9fd0ee'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(19, -167); ctx.lineTo(28, -163); ctx.stroke();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
//  SCREEN COORDINATE HELPERS
// ═══════════════════════════════════════════════════════════
let camY_m = 0;   // smoothed camera Y reference — follows terrain, not the bike's bounce
let camLeadX_m = 0;   // smoothed horizontal lead: the camera looks AHEAD when accelerating and
                      // BEHIND when braking, so the bike shifts back/forward in frame for a sense of g's

function screenY(y_m) {
  // Camera tracks X only; Y is fixed to camY_m so the bike's heave is visible on screen.
  // Ground reference sits a fixed distance from the BOTTOM (groundBaseY), so growing the
  // canvas height adds sky on top (extra headroom) while the bike stays put near the bottom.
  return (y_m - camY_m) * PM + groundBaseY;
}
function screenLen(d_m) { return d_m * PM; }

// ═══════════════════════════════════════════════════════════
//  GROUND-CONTACT FX  (shadows + dust)  — render-only, never touches physics
// ═══════════════════════════════════════════════════════════
// Everything here is a pure function of the physics state; no global the integrator reads is
// written, so the harness (and the A/B determinism check) is unaffected.

// ── Contact shadow ──────────────────────────────────────────────────────────
// A wheel with no shadow reads as floating. Project an ellipse onto the dirt directly beneath
// the tire; it widens and fades as the gap grows, which is the cheap monocular depth cue that
// tells you how high the bike actually is on a jump.
const SHADOW_FADE_M = 1.2;       // m of air over which the shadow fades to nothing
function drawContactShadow(wx_m, wy_m, r_m, w2sx) {
  const gy   = groundY_m(wx_m);
  const gap  = Math.max(0, gy - (wy_m + r_m));      // m of air under the tire (Y is DOWN)
  const t    = 1 - gap / SHADOW_FADE_M;
  if (t <= 0.02) return;
  const rx = r_m * PM * (0.95 + gap * 0.55);        // spreads out as the bike climbs away
  const ry = Math.max(2, r_m * PM * 0.20);
  ctx.save();
  ctx.globalAlpha = 0.42 * t * t;                   // squared → drops off fast, no muddy halo
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(w2sx(wx_m), screenY(gy) + 1, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ── Dust ────────────────────────────────────────────────────────────────────
// Particles live in WORLD metres, so they stay planted on the ground while the camera pans and
// the terrain scrolls. Slip (wheelspin / lockup) throws roost backwards; a bottom-out punches a
// puff straight out from the contact patch.
const dust = [];
const DUST_MAX  = 240;           // hard cap — oldest are dropped, so a long skid can't unbound
const DUST_DRAG = 2.4;           // 1/s  air drag on a particle
const DUST_RISE = 3.4;           // m/s² buoyancy (dust hangs and lifts rather than falling)

function emitDust(x_m, y_m, n, spread, backward) {
  for (let i = 0; i < n; i++) {
    if (dust.length >= DUST_MAX) dust.shift();
    const a = Math.random() * Math.PI * 2;
    dust.push({
      x: x_m + (Math.random() - 0.5) * 0.10,
      y: y_m - Math.random() * 0.05,
      vx: backward + Math.cos(a) * spread,
      vy: -Math.abs(Math.sin(a)) * spread * 0.7,   // biased upward (−y = up)
      life: 1,
      decay: 0.9 + Math.random() * 0.8,            // 1/s
      r: 0.035 + Math.random() * 0.055,            // m
    });
  }
}

function updateDust(dt) {
  for (let i = dust.length - 1; i >= 0; i--) {
    const p = dust[i];
    p.life -= p.decay * dt;
    if (p.life <= 0) { dust.splice(i, 1); continue; }
    const d = Math.max(0, 1 - DUST_DRAG * dt);
    p.vx *= d; p.vy = p.vy * d - DUST_RISE * dt;   // −y = up: dust rises as it slows
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.r += 0.28 * dt;                              // puffs bloom as they dissipate
  }
}

function drawDust(w2sx) {
  ctx.save();
  for (const p of dust) {
    ctx.globalAlpha = 0.52 * p.life * p.life;
    ctx.fillStyle = '#cfae82';
    ctx.beginPath(); ctx.arc(w2sx(p.x), screenY(p.y), Math.max(1, p.r * PM), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Edge-detect state for the bottom-out puff (fire once per bottoming, not every frame while held).
let wasBottomedF = false, wasBottomedR = false;
const BOTTOM_EPS = 0.002;        // m  slop on the travel limit

// ═══════════════════════════════════════════════════════════
//  MAIN DRAW LOOP
// ═══════════════════════════════════════════════════════════
function draw(ts) {
  requestAnimationFrame(draw);

  const W = canvas.width, H = canvas.height;
  let dt = 0;
  if (lastTs !== null) dt = Math.min((ts-lastTs)/1000, 0.025);
  lastTs = ts;

  if (!initialized) { initPhysics(); }

  if (rewindMode) {
    // Playback: render the recorded frame at the scrub position; physics frozen.
    const s = recorder[rewindIndex];
    if (s) { applyState(s); rebuildHistAt(rewindIndex); }
  } else {
    // Determine this frame's physics step: normal live stepping unless paused;
    // when paused, advance only if a single frame-step was requested.
    let dt_s = 0;
    if (!paused && dt > 0)      dt_s = dt * P.timeScale;
    else if (stepRequested)     { dt_s = FRAME_STEP * P.timeScale; stepRequested = false; }

    if (dt_s > 0) {
      simStep(dt_s);

      // Force history
      hist.fs.push(f_spring_F);   hist.fs.shift();
      hist.fd.push(f_damp_F);    hist.fd.shift();
      hist.rs.push(f_spring_R);   hist.rs.shift();
      hist.rd.push(f_damp_R);    hist.rd.shift();
      hist.fv.push(vForkSlide_f); hist.fv.shift();
      hist.rv.push(rearSuspVel);  hist.rv.shift();

      recordFrame(dt_s);
    }
  }

  // ── Stats ─────────────────────────────────────────────────
  // Travel used = compression amount (negative disp = compressed, show as positive mm)
  // Travel USED, measured from full extension (top-out / droop) so it reads 0 fully extended,
  // ~140mm fully compressed, and is never negative. disp_f = forkSlide_f, disp_r = -wheelTravel_r.
  const travF_mm = Math.round((TRAVEL_EXT - disp_f) * 1000);   // front: 0 at top-out
  const travR_mm = Math.round((-disp_r - WT_DROOP) * 1000);    // rear:  0 at full droop
  document.getElementById('st-ft').textContent    = travF_mm;
  document.getElementById('st-rt').textContent    = travR_mm;
  document.getElementById('st-pitch').textContent = (pitchAngle*180/Math.PI).toFixed(1);
  document.getElementById('st-speed').textContent = Math.round(vChassisX * 3.6);  // emergent speed
  // Keep the cruise-speed slider in step with the target while gas/brake is held
  // (the target follows actual speed; see the surge block), so it doesn't snap back.
  if (gasInput > 0.02 || brakeInput > 0.02) {
    const sl = document.getElementById('speed');
    const lb = document.getElementById('lspeed');
    if (sl) sl.value = Math.round(P.speed);
    if (lb) lb.textContent = Math.round(P.speed) + ' km/h';
  }
  document.getElementById('st-fspring').textContent = Math.round(Math.abs(f_spring_F));
  document.getElementById('st-fdamp').textContent   = Math.round(Math.abs(f_damp_F));

  // ── Gear / RPM indicator ──────────────────────────────────
  {
    const gn = document.getElementById('gear-num');
    const gr = document.getElementById('gear-rpm');
    if (gn) {
      gn.textContent = clutchPulled || clutchEngage < 0.5 ? 'N' : (gear + 1);
      const overRev = engineRPM > RPM_REDLINE * 0.97;
      gn.style.color = overRev ? '#e11d48' : '#f0f0f0';
    }
    if (gr) gr.textContent = Math.round(engineRPM) + ' rpm';
  }

  // Engine sound: pitch tracks the live RPM (throttle 0 when paused → just idle).
  if (typeof updateEngineSound === 'function') updateEngineSound(engineRPM, paused ? 0 : gasInput);
  // Tire-slip sound (lockup/wheelspin), surface-dependent; silent when paused.
  if (typeof updateTireSound === 'function') updateTireSound(paused ? 0 : Math.max(frontSlipV, rearSlipV), P.tireGrip);
  // One-shot mechanical clatter the moment the engine stalls.
  if (engineStalledEvt) { if (typeof playStallClatter === 'function') playStallClatter(); engineStalledEvt = false; }

  // ── Horizontal accel-lead DISABLED — the bike stays at a fixed screen X (no fore/aft camera
  // movement); only the vertical camera tracking remains. (camLeadX_m held at 0.)
  camLeadX_m = 0;

  // ── Clear & sky ───────────────────────────────────────────
  drawParallaxBackground(W, H);

  // ── Screen coordinate helpers ─────────────────────────────
  // Chassis CoM is at a fixed screen X; everything is rendered relative to it.
  const comSX       = COM_SX();                     // CoM fixed screen X
  const comX_m_d    = worldX_m - A_FRONT_M;         // CoM world X (physics, no pan)
  const comX_m_view = comX_m_d + camPanX_m + camLeadX_m;  // CoM world X shifted by pan + accel lead

  // World-X → screen-X (pan-aware)
  const w2sx = wx => comSX + (wx - comX_m_view) * PM;

  // ── Ground ────────────────────────────────────────────────
  ctx.beginPath();
  for (let px = 0; px <= W; px += 3) {
    const wx_m  = comX_m_view + (px - comSX) / PM;  // world X for this screen pixel
    const gy_m  = groundY_m(wx_m);
    const sy_px = screenY(gy_m);
    px === 0 ? ctx.moveTo(px, sy_px) : ctx.lineTo(px, sy_px);
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle='#8b6914'; ctx.fill();
  ctx.strokeStyle='#aaaaaa'; ctx.lineWidth=1.5; ctx.stroke();

  // ── Custom-track solid walls (drawn as blocks the bike crashes into) ─────────
  if (P.terrain === 7 && typeof trackWalls !== 'undefined' && trackWalls.length && trackTotalLen) {
    const lap = trackTotalLen;
    const xL = comX_m_view - comSX / PM, xR = comX_m_view + (W - comSX) / PM;  // visible world X
    for (const wll of trackWalls) {
      const nLo = Math.floor((xL - wll.x1) / lap), nHi = Math.ceil((xR - wll.x0) / lap);
      for (let n = nLo; n <= nHi; n++) {
        const bx0 = w2sx(wll.x0 + n*lap), bx1 = w2sx(wll.x1 + n*lap);
        if (bx1 < 0 || bx0 > W) continue;
        const top = screenY(-wll.top), base = screenY(0);
        ctx.fillStyle = '#7a2b22';   ctx.fillRect(bx0, top, bx1 - bx0, base - top);   // brick body
        ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.strokeRect(bx0, top, bx1 - bx0, base - top);
      }
    }
  }

  // ── Camera Y: deadzone follow — keep the bike inside a vertical comfort band ─────────
  // Small bumps don't move the camera (it bounces within the band), but a sustained climb or
  // descent (Mountain Pass, big Rollers) pulls the camera so the bike never rides out of frame.
  // Within the band, a very slow drift toward the terrain mean gently recenters.
  {
    const bikeSY = (chassisY_m - camY_m) * PM + groundBaseY;   // bike's current draw Y (px)
    const topLim = H * 0.34;   // tighter vertical band — the camera tracks the bike's height sooner
    const botLim = H * 0.60;
    let over = 0;
    if      (bikeSY < topLim) over = bikeSY - topLim;          // -ve: above the band (climbing)
    else if (bikeSY > botLim) over = bikeSY - botLim;          // +ve: below the band (descending)
    if (over !== 0) {
      // Follow proportionally, ramping the gain up the further the bike is outside the band —
      // a gentle climb tracks SMOOTHLY (low base gain), a hard launch/landing ramps the gain up so
      // the bike still never leaves frame.
      const gain = Math.min(1, 0.14 + Math.abs(over) / H * 1.1);
      camY_m += over / PM * gain;
    } else {
      camY_m += (groundY_m(comX_m_d) - camY_m) * 0.006;        // in band → very gentle recenter
    }
  }

  // ── Ground-contact FX: dust emission, then shadows under the wheels ───────────────────
  // Emission is driven purely by physics state (slip velocity, travel limits). FX time freezes
  // with the sim so a paused or scrubbing-rewind frame doesn't keep spitting dirt.
  const fxDt = (paused || rewindMode) ? 0 : dt;
  if (fxDt > 0) {
    // Roost: a spinning or locked tire sprays dirt. Rate and cone widen with slip speed; the
    // spray is thrown backwards relative to the bike's travel.
    //
    // Calibration: GRIP_LAMBDA (300 /s) resyncs a spinning wheel to road speed almost at once,
    // so WHEELSPIN only ever reaches ~1.6 m/s of slip here. A brake LOCKUP is the opposite —
    // slip runs all the way up to road speed (~17 m/s). Normalising against 3 m/s covers both:
    // wheelspin gives a light dusting, a locked wheel throws a full plume.
    const SLIP_MIN = 0.8;   // m/s of contact-patch slip before dirt starts flying
    const roost = v => Math.min(1, (v - SLIP_MIN) / 3);
    if (f_tire_F !== 0 && frontSlipV > SLIP_MIN) {
      const s = roost(frontSlipV);
      emitDust(frontWheelX_m, groundY_m(frontWheelX_m),
               1 + (Math.random() < s ? 1 : 0), 0.8 + s * 1.4, -vChassisX * 0.18);
    }
    if (rearContact && rearSlipV > SLIP_MIN) {
      const s = roost(rearSlipV);
      emitDust(rearWheelX_m, groundY_m(rearWheelX_m),
               1 + Math.round(s * 2), 0.9 + s * 1.8, -vChassisX * 0.22 - s * 1.2);
    }
    // Bottom-out: one puff on the TRANSITION into the hard stop, not every frame it's held there.
    const botF = -disp_f        >= TRAVEL_MAX - BOTTOM_EPS;
    const botR = wheelTravel_r  >= TRAVEL_MAX - BOTTOM_EPS;
    if (botF && !wasBottomedF && f_tire_F !== 0)
      emitDust(frontWheelX_m, groundY_m(frontWheelX_m), 10, 2.2, -vChassisX * 0.10);
    if (botR && !wasBottomedR && rearContact)
      emitDust(rearWheelX_m,  groundY_m(rearWheelX_m),  12, 2.4, -vChassisX * 0.10);
    wasBottomedF = botF; wasBottomedR = botR;
    updateDust(fxDt);
  }
  // Shadows go down before the bike so the wheels sit on top of them.
  drawContactShadow(rearWheelX_m,  rearWheelY_m,  WHEEL_R_R, w2sx);
  drawContactShadow(frontWheelX_m, frontWheelY_m, WHEEL_R_F, w2sx);

  // ── Kinematic screen positions (chassis-relative) ─────────
  // These use the X positions computed in the physics step from fork/swingarm geometry.

  // Chassis CoM screen Y — computed early so all body-fixed points can use it
  const comX    = comSX - (camPanX_m + camLeadX_m) * PM;   // pan + accel-lead shifted CoM screen X
                                                           // (MUST match w2sx's comX_m_view or the
                                                           // chassis desyncs from the wheels)
  const comY    = screenY(chassisY_m);

  // Chassis rotation (for all body-fixed point positions)
  const cosP_d = Math.cos(pitchAngle), sinP_d = Math.sin(pitchAngle);

  // Steering head: full 2D rotation of A_FRONT_M along chassis axis from CoM
  const steerX    = comX + A_FRONT_M * cosP_d * PM;
  const steerY_px = comY  + A_FRONT_M * sinP_d * PM;

  // Front wheel screen position (frontWheelX/Y already use full rotation from physics)
  const fwX_px = w2sx(frontWheelX_m);
  const fwY_px = screenY(frontWheelY_m);

  // Swingarm pivot: full 2D rotation of chassis-frame offset (SW_PIV_X, SW_PIV_Y) from CoM
  const swPivotX = comX + (SW_PIV_X_FROM_COM * cosP_d - SW_PIV_Y_FROM_COM * sinP_d) * PM;
  const swPivotY = comY  + (SW_PIV_X_FROM_COM * sinP_d + SW_PIV_Y_FROM_COM * cosP_d) * PM;

  // Rear wheel screen position (from kinematic rearWheelX_m)
  const rwX_px = w2sx(rearWheelX_m);
  const rwY_px = screenY(rearWheelY_m);

  // Chassis body
  const angle   = pitchAngle;

  // Scale factor so chassis vertices (sized for PM=200) render correctly at any PM
  const sc = PM / 200;

  // ── Rear wheel (behind swingarm and chassis) ─────────────
  // Caliper hangs off the swingarm, so it sits on the pivot side of the axle.
  const calR = Math.atan2(swPivotY - rwY_px, swPivotX - rwX_px) - 0.45;
  drawWheel(rwX_px, rwY_px, Math.round(WHEEL_R_R*PM), wheelAngle_r, calR);

  // ── Swingarm (in front of rear wheel) ────────────────────
  ctx.strokeStyle='#111'; ctx.lineWidth=11*sc; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(swPivotX, swPivotY); ctx.lineTo(rwX_px, rwY_px); ctx.stroke();
  ctx.strokeStyle='#484848'; ctx.lineWidth=7*sc;
  ctx.beginPath(); ctx.moveTo(swPivotX, swPivotY); ctx.lineTo(rwX_px, rwY_px); ctx.stroke();
  ctx.strokeStyle='#5a5a5a'; ctx.lineWidth=3*sc;
  ctx.beginPath(); ctx.moveTo(swPivotX, swPivotY); ctx.lineTo(rwX_px, rwY_px); ctx.stroke();

  // ── Final drive: chain between the countershaft (at the swingarm pivot, which is where a
  // real bike puts it so chain tension doesn't change with suspension travel) and the rear
  // sprocket. Two straight runs tangent to the sprocket pitch circles.
  {
    const cdx = rwX_px - swPivotX, cdy = rwY_px - swPivotY;
    const cl  = Math.hypot(cdx, cdy) || 1;
    const nx  = -cdy / cl, ny = cdx / cl;      // unit perpendicular to the swingarm
    const rF  = 9 * sc, rR = 20 * sc;          // countershaft / rear sprocket radii
    ctx.strokeStyle = '#6b6b70'; ctx.lineWidth = 2.2 * sc; ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(swPivotX + nx*rF, swPivotY + ny*rF); ctx.lineTo(rwX_px + nx*rR, rwY_px + ny*rR);
    ctx.moveTo(swPivotX - nx*rF, swPivotY - ny*rF); ctx.lineTo(rwX_px - nx*rR, rwY_px - ny*rR);
    ctx.stroke();
    ctx.save();                                 // rear sprocket, spins with the wheel
    ctx.translate(rwX_px, rwY_px); ctx.rotate(wheelAngle_r);
    ctx.strokeStyle = '#55555a'; ctx.lineWidth = 1.5 * sc;
    ctx.beginPath(); ctx.arc(0, 0, rR, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1 * sc;
    for (let i = 0; i < 16; i++) {              // teeth
      const a = i / 16 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rR, Math.sin(a) * rR);
      ctx.lineTo(Math.cos(a) * (rR + 2.2 * sc), Math.sin(a) * (rR + 2.2 * sc));
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Front wheel (behind fork so fork travel is visible) ───
  // Caliper is bolted to the fork slider → it points up the fork axis, offset off the leg.
  const calF = Math.atan2(steerY_px - fwY_px, steerX - fwX_px) + 0.55;
  drawWheel(fwX_px, fwY_px, Math.round(WHEEL_R_F*PM), wheelAngle_f, calF);

  // ── Front fender: bolted to the SLIDER, so it rides down with fork compression and the gap
  // to the tire stays constant — a fender pinned to the chassis would visibly clip the wheel.
  {
    const fa = Math.atan2(fwY_px - steerY_px, fwX_px - steerX) + Math.PI;   // up the fork axis
    const fr = WHEEL_R_F * PM * 1.16;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 7 * sc;
    ctx.beginPath(); ctx.arc(fwX_px, fwY_px, fr, fa - 0.80, fa + 0.62); ctx.stroke();
    ctx.strokeStyle = '#33353b'; ctx.lineWidth = 4 * sc;
    ctx.beginPath(); ctx.arc(fwX_px, fwY_px, fr, fa - 0.78, fa + 0.60); ctx.stroke();
  }

  // ── Chassis (motorcycle frame) pitched ───────────────────
  ctx.save();
  ctx.translate(comX, comY);
  ctx.rotate(angle);
  ctx.scale(sc, sc);   // chassis vertices are in PM=200 local-px; scale to current PM
  ctx.translate(CHASSIS_VIS_DX_PX, CHASSIS_VIS_DY_PX);   // visual offset (frame body only)

  // Frame vertices in chassis-local px (CoM=0,0, +x=forward/right, +y=down).
  // Derived from user SVG (viewBox 0 0 2194 1256).
  // Uniform scale 0.179. Mapping: SVG(179,218)→chassis(-137,-86), SVG(1745,474)→chassis(143,-40).
  // offset_x = svg_x*0.179 - chassis_x → 179*0.179+137 = 169.0
  // offset_y = svg_y*0.179 - chassis_y → 218*0.179+86 = 125.0
  // chassis_x = svg_x*0.179 - 169,  chassis_y = svg_y*0.179 - 125
  // Frame bottom (y=57) sits ~300 mm above tire contact.
  const fv = [
    [-137, -86],  // A: (179,218)   rear tail upper
    [ -78, -85],  // B: (508,225)   rear upper spar
    [ -57, -66],  // C: (626,331)   seat saddle / lower spar junction
    [   5, -71],  // D: (975,302)   mid-frame
    [  45, -99],  // E: (1199,144)  upper spar peak
    [  92,-104],  // F: (1456,115)  head tube top-left
    [ 119, -90],  // G: (1610,195)  head tube right
    [ 143, -40],  // H: (1745,474)  fork crown / steer-head lower (aligns with SHx)
    [  95,  57],  // I: (1474,1017) gearbox bottom right
    [   9,  57],  // J: (1001,1017) gearbox bottom left
    [   9,  27],  // K: (1001, 849) vertical section top
    [ -18,  -7],  // L: ( 849, 655) diagonal ↔ vertical transition
  ];

  // ── Frame body (filled polygon) ──────────────────────────────────────
  const fg = ctx.createLinearGradient(0, -104, 0, 57);
  fg.addColorStop(0,   '#404040');
  fg.addColorStop(0.4, '#2e2e2e');
  fg.addColorStop(1,   '#1a1a1a');

  ctx.beginPath();
  fv.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fg;
  ctx.fill();

  // Outer edge stroke
  ctx.strokeStyle = '#585858'; ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── Engine block (sits inside the frame polygon) ─────────────────────
  const eL = -18, eR = 70, eT = -55, eB = 15;
  ctx.fillStyle = '#0d0d1f'; ctx.strokeStyle = '#1e1e3a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(eL, eT, eR-eL, eB-eT, 4); ctx.fill(); ctx.stroke();
  // Cylinder fins
  ctx.strokeStyle = '#181832'; ctx.lineWidth = 1.5;
  for (let fy = eT+9; fy < eB-2; fy += 8) {
    ctx.beginPath(); ctx.moveTo(eL+3, fy); ctx.lineTo(eR-3, fy); ctx.stroke();
  }
  // Cylinder head face (right/front side)
  ctx.fillStyle = '#12122a';
  ctx.beginPath(); ctx.roundRect(eR-16, eT, 16, eB-eT, [0,4,4,0]); ctx.fill();

  // ── Edge highlights for depth ─────────────────────────────────────────
  ctx.lineCap = 'round';

  // Upper spar: rear tail → seat saddle → mid-frame → upper peak → head tube top
  ctx.strokeStyle = '#606060'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-137,-86); ctx.lineTo(-78,-85);
  ctx.lineTo(-57,-66);  ctx.lineTo(5,-71);
  ctx.lineTo(45,-99);   ctx.lineTo(92,-104);
  ctx.stroke();

  // Right face highlight: head tube top → head tube right → fork crown
  ctx.strokeStyle = '#4e4e4e'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(92,-104); ctx.lineTo(119,-90); ctx.lineTo(143,-40); ctx.stroke();

  // Lower surface: fork crown → gearbox bottom right → bottom left → vertical up → diagonal
  ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(143,-40); ctx.lineTo(95,57);
  ctx.lineTo(9,57);    ctx.lineTo(9,27); ctx.lineTo(-18,-7);
  ctx.stroke();

  // ── Head tube highlight (fork connects here) ──────────────────────────
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(92,-104); ctx.lineTo(119,-90); ctx.stroke();
  ctx.strokeStyle = '#aaa'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(92,-104); ctx.lineTo(119,-90); ctx.stroke();
  ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(92,-104); ctx.lineTo(119,-90); ctx.stroke();

  // ── Bodywork, rider, bars (all chassis-fixed → they pitch with the frame) ────
  // Order matters: tank/seat first, then the rider sitting on them, then the bars over
  // the rider's hands.
  drawBodywork();
  drawRider();
  drawHandlebars();

  ctx.restore();

  // ── Centre-of-mass marker ─────────────────────────────────────────────
  // Drawn at the physics CoM (comX, comY) — the point everything pitches about.
  {
    const r = Math.max(4, 6 * sc);
    ctx.save();
    ctx.beginPath(); ctx.arc(comX, comY, r, 0, Math.PI * 2);
    ctx.fillStyle = '#000'; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
    // checkered CoM symbol (two filled quadrants)
    ctx.beginPath(); ctx.moveTo(comX, comY); ctx.arc(comX, comY, r, -Math.PI/2, 0);            ctx.closePath();
    ctx.moveTo(comX, comY); ctx.arc(comX, comY, r,  Math.PI/2, Math.PI);                        ctx.closePath();
    ctx.fillStyle = '#ffd400'; ctx.fill();
    ctx.beginPath(); ctx.arc(comX, comY, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  // ── Rear linkage + coil-over shock (animated) ────────────────────────
  // Drawn after the chassis body so the whole assembly is visible. Renders the
  // full Pro-Link-style path: swingarm → tie-rod → rocker (bell crank) → shock →
  // frame. Joint positions come from the same lkSolve() the physics uses, so the
  // animation is exactly consistent with the rising-rate behavior.
  {
    // Chassis-frame → screen helper (same transform as the swingarm pivot).
    const c2s = (cx, cy) => [comX + (cx * cosP_d - cy * sinP_d) * PM,
                             comY  + (cx * sinP_d + cy * cosP_d) * PM];
    const lk = lkSolve(swingAngle);
    const [pX, pY] = c2s(LK.pivX, LK.pivY);     // rocker pivot
    const [aX, aY] = c2s(lk.Ax, lk.Ay);         // tie-rod ↔ swingarm
    const [bX2, bY2] = c2s(lk.Bx, lk.By);       // tie-rod ↔ rocker
    const [cX, cY] = c2s(lk.Cx, lk.Cy);         // rocker ↔ shock
    // Use the VISUAL frame mount so the drawn coil-over shortens on compression
    // (the physics mount, SHOCK_UP, lengthens on compression — see SHOCK_VIS note).
    const [dX, dY] = c2s(SHOCK_VIS_X, SHOCK_VIS_Y); // shock ↔ frame (visual)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // Tie-rod (swingarm A → rocker B): slim steel link.
    ctx.strokeStyle = '#0d0d0d'; ctx.lineWidth = 6 * sc;
    ctx.beginPath(); ctx.moveTo(aX, aY); ctx.lineTo(bX2, bY2); ctx.stroke();
    ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 2.5 * sc;
    ctx.beginPath(); ctx.moveTo(aX, aY); ctx.lineTo(bX2, bY2); ctx.stroke();

    // Rocker (bell crank): filled triangle pivot–B–C.
    ctx.beginPath(); ctx.moveTo(pX, pY); ctx.lineTo(bX2, bY2); ctx.lineTo(cX, cY); ctx.closePath();
    ctx.fillStyle = '#2c2c2c'; ctx.fill();
    ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 1.5 * sc; ctx.stroke();

    // Coil-over shock (rocker C → frame D): damper body near the frame, coil along
    // the lower portion. The coil bunches as the shock compresses (shockTravel_r).
    const dx = cX - dX, dy = cY - dY;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;          // unit along shock (frame→rocker)
    const ppx = -ny, ppy = nx;
    const bx0 = dX + nx * len * 0.36, by0 = dY + ny * len * 0.36;  // body end
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 9 * sc;
    ctx.beginPath(); ctx.moveTo(dX, dY); ctx.lineTo(bx0, by0); ctx.stroke();
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 4.5 * sc;
    ctx.beginPath(); ctx.moveTo(dX, dY); ctx.lineTo(bx0, by0); ctx.stroke();

    const coils = 6, amp = 5.5 * sc, segs = coils * 8;
    const tf = Math.max(0, Math.min(1, wheelTravel_r / TRAVEL_MAX));   // compression fraction
    ctx.strokeStyle = `hsl(${350 - tf * 20},${60 + tf * 40}%,${42 + tf * 13}%)`;
    ctx.lineWidth = 2.5 * sc;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
      const t  = i / segs;
      const bx = bx0 + nx * (len * 0.64) * t;
      const by = by0 + ny * (len * 0.64) * t;
      const off = Math.sin(t * Math.PI * 2 * coils) * amp;
      const sx = bx + ppx * off, sy = by + ppy * off;
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // Pivot + joint eyes.
    ctx.fillStyle = '#1a1a1a';
    for (const [jx, jy, r] of [[pX,pY,4.5],[aX,aY,3.5],[bX2,bY2,3.5],[cX,cY,3.5],[dX,dY,4]]) {
      ctx.beginPath(); ctx.arc(jx, jy, r * sc, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#666';
    ctx.beginPath(); ctx.arc(pX, pY, 2 * sc, 0, Math.PI * 2); ctx.fill();
  }

  // ── Fork tube (×2 length — stanchion extends above steer head) ──────
  // Fork direction from steer head toward wheel (screen coords)
  const forkDX  = fwX_px - steerX;
  const forkDY  = fwY_px - steerY_px;
  // Fixed-length stanchion above steer head (does not change with travel)
  const forkLen  = Math.sqrt(forkDX*forkDX + forkDY*forkDY);
  const fNX = forkDX/forkLen, fNY = forkDY/forkLen;   // unit vector along fork axis
  const stanchPx = Math.round(REST_F_M * PM);          // 90 px — constant
  const ufTopX   = steerX    - fNX * stanchPx;
  const ufTopY   = steerY_px - fNY * stanchPx;

  ctx.lineCap = 'round';

  // ── Upper stanchion (shiny chrome tube above triple clamp) ───────────
  // Outer shadow
  ctx.strokeStyle = '#111'; ctx.lineWidth = 16*sc;
  ctx.beginPath(); ctx.moveTo(ufTopX, ufTopY); ctx.lineTo(steerX, steerY_px); ctx.stroke();
  // Main chrome tube
  ctx.strokeStyle = '#888'; ctx.lineWidth = 10*sc;
  ctx.beginPath(); ctx.moveTo(ufTopX, ufTopY); ctx.lineTo(steerX, steerY_px); ctx.stroke();
  // Highlight stripe
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 3*sc;
  ctx.beginPath(); ctx.moveTo(ufTopX, ufTopY); ctx.lineTo(steerX, steerY_px); ctx.stroke();

  // ── Lower slider tube (darker alloy, from triple clamp to axle) ──────
  ctx.strokeStyle = '#111'; ctx.lineWidth = 16*sc;
  ctx.beginPath(); ctx.moveTo(steerX, steerY_px); ctx.lineTo(fwX_px, fwY_px); ctx.stroke();
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 10*sc;
  ctx.beginPath(); ctx.moveTo(steerX, steerY_px); ctx.lineTo(fwX_px, fwY_px); ctx.stroke();
  // Slider highlight
  ctx.strokeStyle = '#525252'; ctx.lineWidth = 4*sc;
  ctx.beginPath(); ctx.moveTo(steerX, steerY_px); ctx.lineTo(fwX_px, fwY_px); ctx.stroke();

  // ── Fork spring zigzag (on slider section, shows travel) ─────────────
  const nSegs = 14, sAmp = 6*sc;
  const sliderMidX = steerX + forkDX * 0.50;
  const sliderMidY = steerY_px + forkDY * 0.50;
  const travelFrac_F = Math.max(0, Math.min(1, (-disp_f + TRAVEL_MAX * 0.5) / TRAVEL_MAX));
  const springColor  = `hsl(${350 - travelFrac_F*20},${60+travelFrac_F*40}%,${30+travelFrac_F*20}%)`;
  ctx.strokeStyle = springColor; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= nSegs*4; i++) {
    const tt  = i / (nSegs*4);
    const py  = steerY_px + forkDY * tt;
    const px2 = steerX    + forkDX * tt + Math.sin(tt * Math.PI*2*nSegs) * sAmp;
    i === 0 ? ctx.moveTo(px2, py) : ctx.lineTo(px2, py);
  }
  ctx.stroke();

  // (Front wheel drawn before fork — see above)

  // ── Dust, on top of the bike (roost blows past the rider) ─────────────────
  drawDust(w2sx);

  // ── AIR indicators ────────────────────────────────────────
  ctx.font='bold 10px sans-serif';
  if (f_tire_F===0) {
    ctx.fillStyle='#e11d48'; ctx.textAlign='left';
    ctx.fillText('AIR', fwX_px+Math.round(WHEEL_R_F*PM)+5, fwY_px+4);
  }
  if (!rearContact) {
    ctx.fillStyle='#e11d48'; ctx.textAlign='right';
    ctx.fillText('AIR', rwX_px-Math.round(WHEEL_R_R*PM)-5, rwY_px+4);
  }

  // ── Travel bars (right edge, below reset button) ─────────
  // Fit the bars between the zoom buttons (top, ~78px) and the shift/ride buttons (bottom,
  // ~98px) so on a short (mobile) canvas they don't run into the −/+ or shift buttons.
  // On desktop this resolves to the original centred 50%-height bars.
  const bTop = Math.max(84, H * 0.25);
  const bBot = Math.min(H - 104, bTop + H * 0.50);
  const bHt  = bBot - bTop;
  const bx   = W - 22;

  // Color: white at midtravel, red at extremes
  function travelBarColor(frac) {
    const ext = Math.abs(frac - 0.5) * 2;
    return `rgb(255,${Math.round(255*(1-ext))},${Math.round(255*(1-ext))})`;
  }

  // Front travel bar — fills upward from bottom as suspension compresses
  const fFrac = Math.max(0, Math.min(1, (-disp_f+TRAVEL_EXT)/(TRAVEL_MAX+TRAVEL_EXT)));
  ctx.fillStyle='#1a1a1a';
  ctx.beginPath(); ctx.roundRect(bx, bTop, 12, bHt, 6); ctx.fill();
  const fFillH = fFrac * bHt;
  ctx.fillStyle = travelBarColor(fFrac);
  ctx.beginPath(); ctx.roundRect(bx, bBot - fFillH, 12, fFillH, 6); ctx.fill();
  ctx.fillStyle='#444'; ctx.font='9px sans-serif'; ctx.textAlign='center';
  ctx.fillText('F', bx+6, bTop-5);

  // Rear travel bar
  const bx2 = W-38;
  const rFrac = Math.max(0, Math.min(1, (-disp_r+TRAVEL_EXT)/(TRAVEL_MAX+TRAVEL_EXT)));
  ctx.fillStyle='#1a1a1a';
  ctx.beginPath(); ctx.roundRect(bx2, bTop, 12, bHt, 6); ctx.fill();
  const rFillH = rFrac * bHt;
  ctx.fillStyle = travelBarColor(rFrac);
  ctx.beginPath(); ctx.roundRect(bx2, bBot - rFillH, 12, rFillH, 6); ctx.fill();
  ctx.fillStyle='#444'; ctx.font='9px sans-serif'; ctx.textAlign='center';
  ctx.fillText('R', bx2+6, bTop-5);

  // ── Gas / brake input bars (far left, mirror of the travel bars) ─────────
  // Same track geometry as the right-side bars; fill from the bottom up by input level.
  function inputBar(x, frac, fillColor, label) {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.roundRect(x, bTop, 12, bHt, 6); ctx.fill();
    const h = Math.max(0, Math.min(1, frac)) * bHt;
    ctx.fillStyle = fillColor;
    ctx.beginPath(); ctx.roundRect(x, bBot - h, 12, h, 6); ctx.fill();
    ctx.fillStyle = '#444'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, x + 6, bTop - 5);
  }
  inputBar(10, brakeInputF, '#ef4444', 'Bf');  // far-left: FRONT brake (red)
  inputBar(26, brakeInputR, '#f97316', 'Br');  // REAR brake (orange — distinct from front)
  inputBar(42, gasInput,    '#22c55e', 'G');   // gas (green)
  // Engine RPM bar — fills with revs; color blends clutch-blue (idle) → redline-red, matching
  // the gear indicator. Above redline (limiter) it pins full/red.
  {
    const rpmFrac = Math.max(0, Math.min(1, engineRPM / RPM_REDLINE));
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const rpmColor = `rgb(${lerp(59,225,rpmFrac)},${lerp(130,29,rpmFrac)},${lerp(246,72,rpmFrac)})`;
    inputBar(58, rpmFrac, rpmColor, 'RPM');
  }

  drawForceGraph();
  drawVelocityGraph();
  drawMinimap();
}

// ── Minimap: a wide, zoomed-out view of the terrain with the bike's position ─────────
// A MAP_SPAN-metre window centred on the bike, vertical auto-scaled to the elevation in view —
// so you can see the track shape around the bike (and the distance travelled) while building maps.
function drawMinimap() {
  const mm = minimap, c2 = minimapCtx;
  if (!mm || !c2) return;
  const W = mm.width, H = mm.height;
  if (!W || !H) return;
  c2.clearRect(0, 0, W, H);
  c2.fillStyle = '#0b0f15'; c2.fillRect(0, 0, W, H);   // sky

  const cx   = worldX_m - A_FRONT_M;        // bike CoM world X (centre of the window)
  const span = MAP_SPAN;
  const x0   = cx - span / 2;

  // Sample the terrain across the window; track elevation range for the vertical auto-scale.
  const N = Math.min(W | 0, 400);
  const ys = [];
  let loY = Infinity, hiY = -Infinity;
  for (let i = 0; i <= N; i++) {
    const y = groundY_m(x0 + (i / N) * span);
    ys.push(y); if (y < loY) loY = y; if (y > hiY) hiY = y;
  }
  loY = Math.min(loY, chassisY_m); hiY = Math.max(hiY, chassisY_m);   // keep the bike in view
  const pad = (hiY - loY) * 0.25 + 0.4; loY -= pad; hiY += pad;
  const rng = (hiY - loY) || 1;
  const sy  = y => ((y - loY) / rng) * H;   // world Y-down → screen Y-down (peaks at top)

  // dirt fill + top line
  c2.beginPath();
  for (let i = 0; i <= N; i++) { const px = (i / N) * W, py = sy(ys[i]); i === 0 ? c2.moveTo(px, py) : c2.lineTo(px, py); }
  c2.lineTo(W, H); c2.lineTo(0, H); c2.closePath();
  c2.fillStyle = '#6b5418'; c2.fill();
  c2.beginPath();
  for (let i = 0; i <= N; i++) { const px = (i / N) * W, py = sy(ys[i]); i === 0 ? c2.moveTo(px, py) : c2.lineTo(px, py); }
  c2.strokeStyle = '#caa23a'; c2.lineWidth = 1.5; c2.stroke();

  // custom-track walls as solid red blocks (they don't show in the height profile)
  if (P.terrain === 7 && typeof trackWalls !== 'undefined' && trackWalls.length && trackTotalLen) {
    const lap = trackTotalLen;
    for (const wll of trackWalls) {
      const nLo = Math.floor((x0 - wll.x1) / lap), nHi = Math.ceil((x0 + span - wll.x0) / lap);
      for (let n = nLo; n <= nHi; n++) {
        const bx0 = ((wll.x0 + n*lap - x0) / span) * W, bx1 = ((wll.x1 + n*lap - x0) / span) * W;
        if (bx1 < 0 || bx0 > W) continue;
        c2.fillStyle = '#c0392b'; c2.fillRect(bx0, sy(-wll.top), Math.max(2, bx1 - bx0), sy(0) - sy(-wll.top));
      }
    }
  }

  // centre line + bike marker (the bike sits at the centre; terrain scrolls under it)
  c2.strokeStyle = 'rgba(255,255,255,0.10)'; c2.lineWidth = 1;
  c2.beginPath(); c2.moveTo(W / 2, 0); c2.lineTo(W / 2, H); c2.stroke();
  const by = sy(chassisY_m);
  c2.fillStyle = '#e11d48';
  c2.beginPath(); c2.arc(W / 2, by, 4, 0, Math.PI * 2); c2.fill();
  c2.strokeStyle = '#fff'; c2.lineWidth = 1; c2.stroke();

  // labels: distance at the marker + window span at the edges
  c2.font = '9px sans-serif'; c2.fillStyle = '#9a9a9a';
  c2.textAlign = 'center'; c2.fillText(Math.round(cx) + ' m', W / 2, 11);
  c2.textAlign = 'left';   c2.fillText('−' + (span / 2) + ' m', 4, H - 4);
  c2.textAlign = 'right';  c2.fillText('+' + (span / 2) + ' m', W - 4, H - 4);
  c2.strokeStyle = '#1f1f1f'; c2.lineWidth = 1; c2.strokeRect(0.5, 0.5, W - 1, H - 1);
}

