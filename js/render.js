'use strict';
// ═══════════════════════════════════════════════════════════
//  WHEEL DRAWING
// ═══════════════════════════════════════════════════════════
function drawWheel(cx, cy, r_px, rotAngle) {
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

  // Hub (center, on top) — scales with the wheel so it doesn't balloon on a small canvas.
  ctx.beginPath(); ctx.arc(cx, cy, r_px * 0.11, 0, Math.PI * 2);
  ctx.fillStyle = '#888'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r_px * 0.048, 0, Math.PI * 2);
  ctx.fillStyle = '#ccc'; ctx.fill();
}

// ═══════════════════════════════════════════════════════════
//  SCREEN COORDINATE HELPERS
// ═══════════════════════════════════════════════════════════
let camY_m = 0;   // smoothed camera Y reference — follows terrain, not the bike's bounce

function screenY(y_m) {
  // Camera tracks X only; Y is fixed to camY_m so the bike's heave is visible on screen.
  // Ground reference sits a fixed distance from the BOTTOM (groundBaseY), so growing the
  // canvas height adds sky on top (extra headroom) while the bike stays put near the bottom.
  return (y_m - camY_m) * PM + groundBaseY;
}
function screenLen(d_m) { return d_m * PM; }

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

  // ── Clear & sky ───────────────────────────────────────────
  drawParallaxBackground(W, H);

  // ── Screen coordinate helpers ─────────────────────────────
  // Chassis CoM is at a fixed screen X; everything is rendered relative to it.
  const comSX       = COM_SX();                     // CoM fixed screen X
  const comX_m_d    = worldX_m - A_FRONT_M;         // CoM world X (physics, no pan)
  const comX_m_view = comX_m_d + camPanX_m;         // CoM world X shifted by camera pan

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

  // ── Camera Y: deadzone follow — keep the bike inside a vertical comfort band ─────────
  // Small bumps don't move the camera (it bounces within the band), but a sustained climb or
  // descent (Mountain Pass, big Rollers) pulls the camera so the bike never rides out of frame.
  // Within the band, a very slow drift toward the terrain mean gently recenters.
  {
    const bikeSY = (chassisY_m - camY_m) * PM + groundBaseY;   // bike's current draw Y (px)
    const topLim = H * 0.22;   // don't let the bike climb above the top ~22% of the canvas
    const botLim = H * 0.72;   // or sink below ~72%
    let over = 0;
    if      (bikeSY < topLim) over = bikeSY - topLim;          // -ve: above the band (climbing)
    else if (bikeSY > botLim) over = bikeSY - botLim;          // +ve: below the band (descending)
    if (over !== 0) {
      // Follow proportionally, but ramp the gain up the further the bike is outside the band —
      // a gentle climb tracks smoothly (~0.25), while a hard launch/landing snaps the camera so
      // the bike can never ride off-screen.
      const gain = Math.min(1, 0.25 + Math.abs(over) / H * 1.2);
      camY_m += over / PM * gain;
    } else {
      camY_m += (groundY_m(comX_m_d) - camY_m) * 0.003;        // in band → slow recenter
    }
  }

  // ── Kinematic screen positions (chassis-relative) ─────────
  // These use the X positions computed in the physics step from fork/swingarm geometry.

  // Chassis CoM screen Y — computed early so all body-fixed points can use it
  const comX    = comSX - camPanX_m * PM;   // pan-shifted CoM screen X
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
  drawWheel(rwX_px, rwY_px, Math.round(WHEEL_R_R*PM), wheelAngle_r);

  // ── Swingarm (in front of rear wheel) ────────────────────
  ctx.strokeStyle='#111'; ctx.lineWidth=11*sc; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(swPivotX, swPivotY); ctx.lineTo(rwX_px, rwY_px); ctx.stroke();
  ctx.strokeStyle='#484848'; ctx.lineWidth=7*sc;
  ctx.beginPath(); ctx.moveTo(swPivotX, swPivotY); ctx.lineTo(rwX_px, rwY_px); ctx.stroke();
  ctx.strokeStyle='#5a5a5a'; ctx.lineWidth=3*sc;
  ctx.beginPath(); ctx.moveTo(swPivotX, swPivotY); ctx.lineTo(rwX_px, rwY_px); ctx.stroke();

  // ── Front wheel (behind fork so fork travel is visible) ───
  drawWheel(fwX_px, fwY_px, Math.round(WHEEL_R_F*PM), wheelAngle_f);

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

  // ── MT-07 label ───────────────────────────────────────────────────────
  ctx.fillStyle = '#e11d48'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('MT-07', -40, -40);

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
}

