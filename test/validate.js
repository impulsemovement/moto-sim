'use strict';
// ═══════════════════════════════════════════════════════════
//  VALIDATION HARNESS  (committed physics regression suite)
// ═══════════════════════════════════════════════════════════
// The contract that makes parallel work safe (see CLAUDE.md). Runs a battery of scenarios against
// the live globals (resetSim / simStep / P / state vars) and asserts thresholds. Loaded ONLY when
// the page URL contains `?test` — production is unaffected.
//
//   • Open index.html?test=1  → auto-runs, prints a PASS/FAIL table + an on-page overlay.
//   • Or call MotoValidate.run() in the console any time.
//
// When you fix a class of bug, ADD a scenario so it can't silently regress.

const MotoValidate = (() => {
  // ── small helpers ─────────────────────────────────────────
  const FINITE_VARS = () => [chassisY_m, vChassis, vChassisX, pitchAngle, pitchRate,
    forkSlide_f, vForkSlide_f, swingAngle, swingRate, worldX_m, omega_f, omega_r, engineRPM];
  const allFinite = () => FINITE_VARS().every(Number.isFinite);

  const forkPct = () => (-forkSlide_f) / TRAVEL_MAX * 100;                 // 100 = bottomed
  const rearPct = () => (PHI_REST - swingAngle) / (PHI_REST - PHI_FULL_BUMP) * 100; // 100 = bottomed
  const frontPenMM = () =>
    ((frontWheelY_m - calcNaturalWY_m(frontWheelX_m, WHEEL_R_F)) - TIRE_TRAVEL_F) * 1000;
  const rearPenMM = () =>
    ((rearWheelY_m - calcNaturalWY_m(rearWheelX_m, WHEEL_R_R)) - TIRE_TRAVEL_R) * 1000;

  // Drive the bike at a fixed terrain/speed and report worst-case metrics over the run.
  function ride(opts) {
    const { terrain, amp = 0.4, freq = 1.0, speedKmh = 0, gearN = 4,
            gas = 0, brake = false, clutch = false, settle = 40, steps = 480 } = opts;
    // Set terrain BEFORE resetSim: initPhysics() settles the static equilibrium on the CURRENT
    // P.terrain, so the terrain must be chosen first or the bike settles on the wrong profile.
    P.terrain = terrain; P.amp = amp; P.freq = freq;
    resetSim();
    if (speedKmh > 0) {
      gear = gearN; vChassisX = speedKmh / 3.6;
      omega_f = vChassisX / WHEEL_R_F; omega_r = vChassisX / WHEEL_R_R;
    }
    for (let i = 0; i < settle; i++) simStep(0.016);   // settle past the spawn transient
    let pf = 0, pr = 0, fork = 0, rear = 0, nan = false;
    let revMax = 0, revMinLate = Infinity, prevY = chassisY_m, teleport = 0;
    for (let i = 0; i < steps; i++) {
      gasPressed = gas > 0; gasInput = gas; clutchPulled = clutch; brakeBothHeld = brake;
      simStep(0.016);
      pf = Math.max(pf, frontPenMM()); pr = Math.max(pr, rearPenMM());
      fork = Math.max(fork, forkPct()); rear = Math.max(rear, rearPct());
      revMax = Math.max(revMax, engineRPM);
      if (i > steps - 120) revMinLate = Math.min(revMinLate, engineRPM);
      // position jump NOT explained by velocity = teleport (only meaningful on flat ground)
      teleport = Math.max(teleport, Math.abs((chassisY_m - prevY) - vChassis * 0.016));
      prevY = chassisY_m;
      if (!allFinite()) { nan = true; break; }
    }
    gasPressed = clutchPulled = brakeBothHeld = false; gasInput = 0;
    return { frontPenMM: pf, rearPenMM: pr, forkPct: fork, rearPct: rear,
             revMax, revMinLate, teleportMM: teleport * 1000, nan };
  }

  // ── scenario battery ──────────────────────────────────────
  // Each returns an array of [label, passBool, detail] checks.
  const scenarios = [
    function frontNoPunchThrough() {
      const out = [];
      for (const [amp, kmh] of [[1.8, 100], [1.8, 120], [2.5, 130]]) {
        const r = ride({ terrain: 3, amp, freq: 1.0, speedKmh: kmh, gas: 0.5 });
        const tag = `kicker amp${amp}@${kmh}`;
        out.push([`${tag}: no NaN`, !r.nan, r]);
        out.push([`${tag}: front rim out of ground (<30mm)`, r.frontPenMM < 30, `${r.frontPenMM|0}mm`]);
        out.push([`${tag}: rear rim out of ground (<90mm)`, r.rearPenMM < 90, `${r.rearPenMM|0}mm`]);
        out.push([`${tag}: fork reaches full travel (>=95%)`, r.forkPct >= 95, `${r.forkPct|0}%`]);
      }
      return out;
    },
    function bigDropRearFullTravel() {
      const r = ride({ terrain: 3, amp: 2.2, freq: 0.8, speedKmh: 110, gas: 0.4 });
      return [
        ['bigdrop: no NaN', !r.nan, r],
        ['bigdrop: rear reaches full travel (>=95%)', r.rearPct >= 95, `${r.rearPct|0}%`],
        ['bigdrop: front reaches full travel (>=95%)', r.forkPct >= 95, `${r.forkPct|0}%`],
      ];
    },
    function gentleBumpsPartialTravel() {
      const r = ride({ terrain: 0, amp: 0.4, freq: 1.0, speedKmh: 45, gas: 0.3 });
      return [
        ['bumps@45: no NaN', !r.nan, r],
        ['bumps@45: front rim stays out of ground', r.frontPenMM < 20, `${r.frontPenMM|0}mm`],
        ['bumps@45: fork engages (>15%) but not slammed flat all run', r.forkPct > 15, `${r.forkPct|0}%`],
      ];
    },
    function whoops() {
      const r = ride({ terrain: 1, amp: 1.5, freq: 1.0, speedKmh: 90, gas: 0.4 });
      return [
        ['whoops@90: no NaN', !r.nan, r],
        ['whoops@90: front rim out of ground', r.frontPenMM < 30, `${r.frontPenMM|0}mm`],
        ['whoops@90: rear rim out of ground', r.rearPenMM < 30, `${r.rearPenMM|0}mm`],
      ];
    },
    function mountainPass() {
      const r = ride({ terrain: 5, amp: 1.2, freq: 1.0, speedKmh: 80, gas: 0.5 });
      return [
        ['mtnpass@80: no NaN', !r.nan, r],
        ['mtnpass@80: front rim out of ground', r.frontPenMM < 30, `${r.frontPenMM|0}mm`],
      ];
    },
    function idleNoStall() {
      // (a) Stopped with the clutch IN (pulled) → engine free-idles, must NOT stall. (There is no
      //     neutral gear: gear 0–5 = 1st–6th; clutch-in is how you idle at a stop.)
      P.speed = 0; P.terrain = 6; resetSim(); gear = 0;
      for (let i = 0; i < 240; i++) { gasPressed = false; clutchPulled = true; simStep(0.016); }
      const idleOk = engineRunning && engineRPM > 1200 && engineRPM < 1900 && allFinite();
      // (b) Light cruise in gear must keep the engine running (not bog/stall).
      P.speed = 30; P.terrain = 6; resetSim(); gear = 3;
      for (let i = 0; i < 240; i++) { gasPressed = true; gasInput = 0.25; clutchPulled = false; simStep(0.016); }
      const cruiseOk = engineRunning && engineRPM > 1400 && allFinite();
      gasPressed = clutchPulled = false; gasInput = 0;
      return [
        ['idle at a stop (clutch in): holds idle, no stall', idleOk, `RPM ${engineRPM|0}`],
        ['light cruise in gear: engine stays running', cruiseOk, `running ${engineRunning}`],
      ];
    },
    function revLimiter() {
      P.terrain = 6; resetSim(); gear = 0;
      let revMax = 0, lateMin = Infinity, nan = false;
      for (let i = 0; i < 300; i++) {
        clutchPulled = true; gasPressed = true; gasInput = 1;  // free-rev to the limiter
        simStep(0.016);
        revMax = Math.max(revMax, engineRPM);
        if (i > 180) lateMin = Math.min(lateMin, engineRPM);
        if (!allFinite()) { nan = true; break; }
      }
      gasPressed = clutchPulled = false; gasInput = 0;
      return [
        ['rev limiter: no NaN', !nan, ''],
        ['rev limiter: revs up to the limiter', revMax > RPM_REDLINE, `max ${revMax|0}`],
        ['rev limiter: stays at/below ceiling (<limit+150)', revMax < RPM_LIMIT + 150, `max ${revMax|0}`],
        ['rev limiter: BOUNCES (late min dips below ceiling)', lateMin < RPM_LIMIT - 100, `min ${lateMin|0}`],
      ];
    },
    function gearShiftMechanics() {
      // Shift torque cut + rev-match (drivetrain block): an upshift at speed must NOT
      // snap the revs in one frame (the crank slews to the new ratio during the cut),
      // the revs must end matched to the new gear with drive resumed, and a downshift
      // must BLIP the revs UP. Guards the "instant gearbox" class of bugs (one-frame
      // RPM teleports, a shift cut that never ends, phantom cuts on reset).
      P.terrain = 6; P.speed = 0; resetSim(); gear = 1;            // flat ground, 2nd
      vChassisX = 50 / 3.6; omega_f = vChassisX / WHEEL_R_F; omega_r = vChassisX / WHEEL_R_R;
      for (let i = 0; i < 100; i++) { gasPressed = true; gasInput = 0.5; clutchPulled = false; simStep(0.016); }
      const rpm0 = engineRPM, v0 = vChassisX;
      gear = 2;                                                    // upshift 2nd→3rd
      simStep(0.016);
      const oneFrameDrop = rpm0 - engineRPM;
      for (let i = 0; i < 30; i++) simStep(0.016);                 // ride out the cut + relock
      const lockedUp  = omega_r * effRatio(gear) * RADS2RPM;
      const rpmAfterUp = engineRPM;                              // sample NOW — the downshift below moves engineRPM
      const matched   = Math.abs(rpmAfterUp - lockedUp) < 300;
      const resumed   = vChassisX > v0;
      const rpmD0 = engineRPM;
      gear = 1;                                                    // downshift 3rd→2nd
      let rpmPeak = 0;
      for (let i = 0; i < 20; i++) { simStep(0.016); rpmPeak = Math.max(rpmPeak, engineRPM); }
      const nan = !allFinite();
      gasPressed = false; gasInput = 0;
      return [
        ['shift: no NaN', !nan, ''],
        ['upshift: no one-frame RPM snap (<600)', oneFrameDrop < 600 && oneFrameDrop > -100, `${oneFrameDrop|0} RPM in 16ms`],
        ['upshift: revs matched to new gear after cut', matched, `rpm ${rpmAfterUp|0} vs locked ${lockedUp|0}`],
        ['upshift: drive resumes after the cut', resumed, `${(vChassisX*3.6)|0} vs ${(v0*3.6)|0} km/h`],
        ['downshift: revs blip UP toward the shorter gear', rpmPeak > rpmD0 + 400, `${rpmD0|0} → peak ${rpmPeak|0}`],
        ['shift: engine still running', engineRunning, ''],
      ];
    },
    function longMixedSweep() {
      P.terrain = 1; P.amp = 1.2; P.freq = 1.0; resetSim(); gear = 4; vChassisX = 80 / 3.6;
      omega_f = vChassisX / WHEEL_R_F; omega_r = vChassisX / WHEEL_R_R;
      let nan = false;
      for (let i = 0; i < 3000; i++) {
        gasPressed = (i % 200 < 130); gasInput = gasPressed ? 0.9 : 0;
        brakeBothHeld = (i % 200 >= 170); clutchPulled = (i % 300 > 280);
        if (i % 600 === 0) { vChassisX = Math.max(vChassisX, 70 / 3.6); omega_r = vChassisX / WHEEL_R_R; }
        simStep(0.016);
        if (!allFinite()) { nan = true; break; }
      }
      gasPressed = brakeBothHeld = clutchPulled = false; gasInput = 0;
      return [['3000-step mixed-input sweep: no NaN', !nan, '']];
    },
    function frontTireForceNoDropout() {
      // Regression guard: the front carcass-damper velocity used to be a finite difference of
      // wheel Y, so resolveTireBottom's vertical position ejection (and the chassis-contact
      // push-out) read as one-substep teleport velocities → f_tire_F spuriously dropped to 0
      // (or spiked) while the tire was deeply compressed on hard landings. Now analytic.
      // A deeply compressed tire (pen > 25mm) still descending (vChassis > 0.5) must carry force.
      P.terrain = 3; P.amp = 1.8; P.freq = 1.0; resetSim();
      gear = 4; vChassisX = 120 / 3.6; omega_f = vChassisX / WHEEL_R_F; omega_r = vChassisX / WHEEL_R_R;
      let dropouts = 0, nan = false;
      for (let i = 0; i < 900; i++) {
        gasPressed = true; gasInput = 0.5;
        simStep(0.016);
        const pen = frontWheelY_m - calcNaturalWY_m(frontWheelX_m, WHEEL_R_F);
        if (pen > 0.025 && f_tire_F === 0 && vChassis > 0.5) dropouts++;
        if (!allFinite()) { nan = true; break; }
      }
      gasPressed = false; gasInput = 0;
      return [
        ['hard-landing f_tire_F: no NaN', !nan, ''],
        ['hard-landing f_tire_F: no teleport force dropouts', dropouts === 0, `${dropouts} frames`],
      ];
    },
    function customTrackFeatures() {
      // Terrain 7 (Custom) had NO coverage: the whole feature-list → heightfield path was untested.
      // Ride a track holding every bump-type feature, and assert the tiling contract that the whole
      // design rests on — each feature reads baseline 0 at BOTH ends, so segments butt together and
      // the lap loops without a step. (On a single-valued heightfield a step is a launch or a wall.)
      const saved = customTrack.map(f => ({ ...f }));
      try {
        customTrack = [
          { type:'flat', len:6 },   { type:'jump',   len:5, height:0.9 },
          { type:'flat', len:5 },   { type:'rhythm', len:9, height:0.28, count:5 },
          { type:'flat', len:4 },   { type:'table',  len:7, height:1.0 },
          { type:'flat', len:4 },   { type:'stepup', len:4, height:0.6 },
          { type:'stepdown', len:4, height:0.6 }, { type:'flat', len:7 },
        ];
        rebuildCustomTrack();
        P.rough = 0;
        const r = ride({ terrain: 7, amp: 1.0, freq: 1.0, speedKmh: 55, gas: 0.35, steps: 700 });
        let worstEnd = 0;
        for (const f of customTrack)
          worstEnd = Math.max(worstEnd, Math.abs(featureHeight(f, 0)), Math.abs(featureHeight(f, f.len)));
        return [
          ['custom@55: no NaN', !r.nan, r],
          ['custom@55: front rim out of ground (<30mm)', r.frontPenMM < 30, `${r.frontPenMM|0}mm`],
          ['custom@55: rear rim out of ground (<30mm)', r.rearPenMM < 30, `${r.rearPenMM|0}mm`],
          ['custom: every feature reads 0 at both ends (seamless tiling)', worstEnd < 1e-9, `${worstEnd}`],
        ];
      } finally { customTrack = saved; rebuildCustomTrack(); }
    },
    function shapeFeatureTiles() {
      // Regression: 'shape' subtracted only terrainLUT[0].y, so it returned to baseline only when the
      // saved terrainPts endpoints happened to share a Y. ui.js rebuilds the LUT from a loaded setup
      // and nothing enforces that lock — unequal endpoints meant a step at the seam. Now the endpoint
      // RAMP is subtracted, so the feature lands on baseline regardless of the control points.
      const savedPts = terrainPts.map(p => ({ ...p })), savedLUT = terrainLUT;
      try {
        terrainPts = [{ x:0, y:0.2 }, { x:0.5, y:0.9 }, { x:1, y:0.7 }];  // deliberately unequal ends
        terrainLUT = buildCurveLUT(terrainPts);
        const f = { type:'shape', len:6, height:1 };
        const a = featureHeight(f, 0), b = featureHeight(f, f.len), mid = featureHeight(f, 3);
        return [
          ['shape: starts on baseline 0', Math.abs(a) < 1e-9, `${a}`],
          ['shape: ends on baseline 0 despite unequal endpoints', Math.abs(b) < 1e-9, `${b}`],
          ['shape: still carries a profile between the ends', Math.abs(mid) > 0.05, `${mid.toFixed(3)}`],
        ];
      } finally { terrainPts = savedPts; terrainLUT = savedLUT; }
    },
    function wallCollider() {
      // The solid-feature path (trackWalls → the barrier/endo block in physics.js) was untested.
      const saved = customTrack.map(f => ({ ...f }));
      const savedRough = P.rough;
      try {
        customTrack = [{ type:'flat', len:20 }, { type:'wall', len:2.5, height:0.9 }, { type:'flat', len:20 }];
        rebuildCustomTrack();
        const w = trackWalls[0];
        const out = [];

        // A wall's collider `top` is measured from the datum (height 0); physics compares the wheel
        // bottom's height above 0 against it. Terrain noise under the wall would move the visible
        // ground off that datum (±6cm at rough=1) without moving the collider.
        P.terrain = 7; P.rough = 1.0;
        let noiseUnderWall = 0, seamStep = 0;
        for (let x = w.x0; x <= w.x1; x += 0.02)
          noiseUnderWall = Math.max(noiseUnderWall, Math.abs(groundY_m(x) - customGroundAt(x)));
        for (const sx of [w.sx0, w.sx1])
          seamStep = Math.max(seamStep, Math.abs(groundY_m(sx - 1e-4) - groundY_m(sx + 1e-4)));
        out.push(['wall: ground under the collider stays on the datum (noise suppressed)',
                  noiseUnderWall < 1e-9, `${(noiseUnderWall*1000).toFixed(3)}mm`]);
        out.push(['wall: the noise fade adds no step at the segment seams',
                  seamStep < 1e-3, `${(seamStep*1000).toFixed(2)}mm`]);
        P.rough = 0;

        for (const kmh of [40, 90, 130]) {
          P.terrain = 7; P.amp = 1.0; P.freq = 1.0; resetSim();
          gear = 4; vChassisX = kmh / 3.6;
          omega_f = vChassisX / WHEEL_R_F; omega_r = vChassisX / WHEEL_R_R;
          let nan = false, maxPitch = -Infinity, hit = false, minSpeedAfterHit = Infinity;
          for (let i = 0; i < 700; i++) {
            simStep(0.016);
            const lx = lapX(frontWheelX_m);
            if (-frontWheelY_m - WHEEL_R_F < w.top - 0.02 && lx + WHEEL_R_F > w.x0 && lx < w.x1) hit = true;
            if (hit) minSpeedAfterHit = Math.min(minSpeedAfterHit, Math.abs(vChassisX));
            maxPitch = Math.max(maxPitch, pitchAngle);
            if (!allFinite()) { nan = true; break; }
          }
          out.push([`wall@${kmh}: no NaN`, !nan, '']);
          out.push([`wall@${kmh}: the wall arrests the bike`, hit && minSpeedAfterHit < 0.5,
                    `${minSpeedAfterHit.toFixed(2)} m/s`]);
          out.push([`wall@${kmh}: hitting it pitches the bike over (endo)`,
                    maxPitch > 30 * Math.PI / 180, `${(maxPitch*180/Math.PI)|0}°`]);
        }
        return out;
      } finally { customTrack = saved; rebuildCustomTrack(); P.rough = savedRough; }
    },
    function determinism() {
      const snap = () => { P.terrain = 3; P.amp = 1.8; P.freq = 1.0; resetSim();  // P before reset (see ride)
        gear = 4; vChassisX = 100 / 3.6; omega_f = vChassisX / WHEEL_R_F; omega_r = vChassisX / WHEEL_R_R;
        for (let i = 0; i < 300; i++) { gasPressed = true; gasInput = 0.5; clutchPulled = false; simStep(0.016); }
        gasPressed = false; gasInput = 0;
        return [chassisY_m, vChassis, pitchAngle, forkSlide_f, swingAngle, worldX_m]; };
      const a = snap(), b = snap();
      const same = a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
      return [['determinism: identical inputs ⇒ identical state', same, same ? '' : `${a} vs ${b}`]];
    },
  ];

  function run() {
    // Snapshot the user's session so the suite leaves no trace.
    const savedP = JSON.parse(JSON.stringify(P));
    const wasPaused = paused;
    paused = true;   // freeze the rAF loop so it can't interleave with our stepping

    const results = [];
    for (const scn of scenarios) {
      let checks;
      try { checks = scn(); }
      catch (e) { checks = [[`${scn.name}: threw`, false, String(e)]]; }
      for (const [label, ok, detail] of checks) results.push({ label, pass: !!ok, detail });
    }

    // Restore session.
    Object.assign(P, savedP); resetSim(); paused = wasPaused;

    const failed = results.filter(r => !r.pass);
    const summary = { pass: failed.length === 0, total: results.length,
                      passed: results.length - failed.length, failed: failed.length };

    // Console report.
    console.log(`%c[MotoValidate] ${summary.pass ? 'PASS' : 'FAIL'} — ${summary.passed}/${summary.total}`,
      `font-weight:bold;color:${summary.pass ? '#3c3' : '#e44'}`);
    if (console.table) console.table(results.map(r => ({ check: r.label, result: r.pass ? '✓' : '✗',
      detail: typeof r.detail === 'object' ? JSON.stringify(r.detail) : r.detail })));
    failed.forEach(r => console.warn('  ✗', r.label, r.detail));

    renderOverlay(summary, results);
    return Object.assign(summary, { results });
  }

  // Minimal on-page PASS/FAIL overlay (only when run from the page).
  function renderOverlay(summary, results) {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('motovalidate-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'motovalidate-overlay';
      el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;' +
        'font:12px/1.4 monospace;max-height:80vh;overflow:auto;padding:10px 14px;border-radius:8px;' +
        'box-shadow:0 4px 20px rgba(0,0,0,.5);max-width:90vw;';
      document.body.appendChild(el);
    }
    const fails = results.filter(r => !r.pass);
    el.style.background = summary.pass ? '#0a3a16' : '#3a0a0a';
    el.style.color = summary.pass ? '#9f9' : '#f99';
    el.innerHTML = `<b>MotoValidate: ${summary.pass ? 'PASS' : 'FAIL'} — ` +
      `${summary.passed}/${summary.total}</b>` +
      (fails.length ? '<br>' + fails.map(r => '✗ ' + r.label + (r.detail ? ' — ' + r.detail : '')).join('<br>') : '') +
      '<br><span style="opacity:.6">click to dismiss</span>';
    el.onclick = () => el.remove();
  }

  // Auto-run when loaded via ?test (give the sim a beat to finish first-frame init).
  if (typeof location !== 'undefined' && /[?&]test/.test(location.search)) {
    if (document.readyState === 'complete') setTimeout(run, 300);
    else window.addEventListener('load', () => setTimeout(run, 300));
  }

  return { run, ride, scenarios };
})();
