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
