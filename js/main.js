'use strict';
// ═══════════════════════════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════════════════════════
requestAnimationFrame(resizeCurveCanvas);
requestAnimationFrame(resizeTerrainCanvas);
requestAnimationFrame(resizeFG);
requestAnimationFrame(resizeVG);
requestAnimationFrame(draw);
// ═══════════════════════════════════════════════════════════
//  RESET BUTTON
// ═══════════════════════════════════════════════════════════
function resetSim() {
  // Reset all dynamic physics state, keep P (parameters) intact
  chassisY_m   = 0; vChassis    = 0; vChassisX   = 0;
  pitchAngle   = 0; pitchRate   = 0;
  forkSlide_f  = 0; vForkSlide_f = 0;
  frontWheelX_m = 0; frontWheelY_m = 0; prevFrontWheelY_m = null;
  rearWheelX_m  = 0; rearWheelY_m  = 0;
  swingAngle   = 0; swingRate   = 0;
  shockLen_cur = 0; shockTravel_r = 0; wheelTravel_r = 0; rearSuspVel = 0;
  worldX_m     = 0;
  wheelAngle_f = 0; wheelAngle_r = 0; omega_f = 0; omega_r = 0; frontSlipV = 0; rearSlipV = 0;
  disp_f = 0; disp_r = 0;
  // Tire contact forces are read with a 1-step lag (the airborne/ground check at the top of
  // _physicsStep uses the PREVIOUS sub-step's value). Zero them so a fresh sim is reproducible —
  // otherwise the first step inherits the last run's contact state (breaks A/B compare & rewind).
  f_tire_F = 0; f_tire_R = 0;
  f_spring_F = 0; f_damp_F = 0; f_spring_R = 0; f_damp_R = 0;
  a_long = 0; gasInput = 0; brakeInputF = 0; brakeInputR = 0; brakeInput = 0; gasPhase = 0; brakePhase = 0;
  gear = 0; engineRPM = RPM_IDLE; clutchEngage = 1; clutchPulled = false; revLimiterCut = false;
  engineRunning = true; stallLugTimer = 0; startGrace = STALL_START_GRACE; engineStalledEvt = false;
  gasPressed = false; brakeFrontHeld = false; brakeRearHeld = false; brakeBothHeld = false;
  // Drop the input layer's holder sets alongside the intent globals it owns (see ui.js), so a
  // control still physically held across a reset can re-assert itself on its next press.
  if (typeof clearHolds === 'function') clearHolds();
  rearContact  = false;
  camY_m       = 0;
  camPanX_m    = 0;
  lastTs       = null;
  initialized  = false;
  // Clear force/velocity history
  ['fs','fd','rs','rd','fv','rv'].forEach(k => { for(let i=0;i<HIST_MAX;i++) hist[k][i]=0; });
  clearRecorder();
  // Re-solve static equilibrium with current parameters
  initPhysics();
}
document.getElementById('btn-reset').addEventListener('click', resetSim);

// ═══════════════════════════════════════════════════════════
//  MUTE / ENGINE SOUND TOGGLE
// ═══════════════════════════════════════════════════════════
{
  const mb = document.getElementById('btn-mute');
  if (mb) {
    const sync = () => { mb.classList.toggle('muted', soundMuted); };
    sync();   // reflect the saved preference (dim + slash when muted)
    mb.addEventListener('click', () => { initAudio(); setMuted(!soundMuted); sync(); });
  }
}

// ═══════════════════════════════════════════════════════════
//  START ENGINE (after a stall)
// ═══════════════════════════════════════════════════════════
function startEngine() {
  engineRunning = true;
  engineRPM     = RPM_IDLE;
  stallLugTimer = 0;
  startGrace    = STALL_START_GRACE;   // brief grace so it doesn't immediately re-stall
  engineStalledEvt = false;
}
{
  const sb = document.getElementById('btn-start-engine');
  if (sb) {
    sb.addEventListener('click', () => { initAudio(); startEngine(); });
    // Per-frame: show the button while stalled, fade it out once the engine is running.
    (function syncStartBtn() {
      sb.classList.toggle('show', !engineRunning);
      requestAnimationFrame(syncStartBtn);
    })();
  }
}

// ═══════════════════════════════════════════════════════════
//  PAUSE / PLAY + FRAME-STEP
// ═══════════════════════════════════════════════════════════
function setPaused(on) {
  paused = on;
  const pb = document.getElementById('btn-pause');
  const sb = document.getElementById('btn-step');
  if (pb) { pb.textContent = paused ? '▶' : '⏸'; pb.title = (paused ? 'Play' : 'Pause') + ' (P)'; }
  if (sb) sb.style.display = paused ? '' : 'none';
}
function togglePause() { setPaused(!paused); }
function stepFrame()  { if (!paused) setPaused(true); stepRequested = true; }

document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-step').addEventListener('click', stepFrame);

// ── Key legend dismiss (persisted) ──────────────────────────
(function() {
  const legend = document.getElementById('key-legend');
  if (!legend) return;
  if (localStorage.getItem('motosim-hidelegend') === '1') legend.style.display = 'none';
  document.getElementById('key-legend-x').addEventListener('click', () => {
    legend.style.display = 'none';
    try { localStorage.setItem('motosim-hidelegend', '1'); } catch {}
  });
})();

// ── Rewind / scrub ──────────────────────────────────────────
const rewindBar  = document.getElementById('rewind-bar');
const rewindScr  = document.getElementById('rewind-scrub');
const rewindTime = document.getElementById('rewind-time');

function fmtRewindTime(idx) {
  // Seconds from idx to the live end (negative offset into the past).
  let t = 0;
  for (let i = idx + 1; i < recorder.length; i++) t += recorder[i].dt;
  return (t > 0 ? '-' : '') + t.toFixed(1) + 's';
}
function enterRewind() {
  if (recorder.length === 0) return;
  rewindMode  = true;
  rewindIndex = recorder.length - 1;
  rewindScr.min = 0;
  rewindScr.max = recorder.length - 1;
  rewindScr.value = rewindIndex;
  rewindTime.textContent = fmtRewindTime(rewindIndex);
  rewindBar.style.display = 'flex';
}
function resumeFromRewind() {
  if (!rewindMode) return;
  // Drop everything after the chosen frame and continue live from here.
  recorder.length = rewindIndex + 1;
  recordedTime = recorder.reduce((t, s) => t + s.dt, 0);
  rewindMode = false;
  rewindBar.style.display = 'none';
  setPaused(false);
  lastTs = null;   // avoid a large dt spike on the first live frame
}
document.getElementById('btn-rewind').addEventListener('click', () => {
  rewindMode ? resumeFromRewind() : enterRewind();
});
document.getElementById('btn-resume').addEventListener('click', resumeFromRewind);
rewindScr.addEventListener('input', () => {
  rewindIndex = Math.min(recorder.length - 1, Math.max(0, +rewindScr.value));
  rewindTime.textContent = fmtRewindTime(rewindIndex);
});

window.addEventListener('keydown', e => {
  if (isTextEntry(e.target)) return;   // only the setup-name text box swallows shortcuts
  if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePause(); }
  else if (e.key === '.')             { e.preventDefault(); stepFrame(); }
});

// ═══════════════════════════════════════════════════════════
//  ZOOM  (buttons · wheel · pinch)
// ═══════════════════════════════════════════════════════════
const ZOOM_MIN = 0.25, ZOOM_MAX = 4.0, ZOOM_STEP = 1.25;
// PM (pixels per meter) is the render scale; PM_base is set per breakpoint by resizeMain().
function setZoom(z) {
  userZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  PM = PM_base * userZoom;
}
document.getElementById('btn-zoom-in') .addEventListener('click', () => setZoom(userZoom * ZOOM_STEP));
document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(userZoom / ZOOM_STEP));

// Wheel zoom on the sim canvas. Non-passive so the page doesn't scroll under the cursor.
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  setZoom(userZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

// Re-run after layout fully settles so flex heights are computed
setTimeout(() => { resizeCurveCanvas(); resizeTerrainCanvas(); resizeFG(); resizeVG(); }, 100);

// ═══════════════════════════════════════════════════════════
//  CAMERA PAN  (click-drag on main canvas)
// ═══════════════════════════════════════════════════════════
(function() {
  let dragging = false;
  let dragStartX = 0;
  let dragStartPan = 0;

  canvas.style.cursor = 'grab';

  canvas.addEventListener('mousedown', e => {
    dragging = true;
    dragStartX = e.clientX;
    dragStartPan = camPanX_m;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    // Drag right = world moves right = camera looks left (standard "grab world" UX)
    camPanX_m = dragStartPan - dx / PM;
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = 'grab';
  });

  // Touch: one finger pans, two fingers pinch-zoom. A second finger landing ends the pan
  // (rather than letting the pan chase the midpoint), and lifting back to one finger does NOT
  // resume it — otherwise the pan would jump by however far that finger travelled while pinching.
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  const touchDist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      dragging = true;
      dragStartX = e.touches[0].clientX;
      dragStartPan = camPanX_m;
      e.preventDefault();
    } else if (e.touches.length === 2) {
      dragging = false;
      pinchStartDist = touchDist(e.touches);
      pinchStartZoom = userZoom;
      e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      setZoom(pinchStartZoom * (touchDist(e.touches) / pinchStartDist));
    } else if (dragging && e.touches.length === 1) {
      const dx = e.touches[0].clientX - dragStartX;
      camPanX_m = dragStartPan - dx / PM;
    }
  }, { passive: false });

  window.addEventListener('touchend', e => {
    dragging = false;
    if (e.touches.length < 2) pinchStartDist = 0;
  });

  // Double-click to re-center camera on bike
  canvas.addEventListener('dblclick', () => {
    camPanX_m = 0;
  });
})();
