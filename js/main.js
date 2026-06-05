'use strict';
// ═══════════════════════════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════════════════════════
requestAnimationFrame(resizeCurveCanvas);
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
  wheelAngle_f = 0; wheelAngle_r = 0; omega_f = 0; omega_r = 0;
  disp_f = 0; disp_r = 0;
  a_long = 0; gasInput = 0; brakeInput = 0; gasPhase = 0; brakePhase = 0;
  gear = 0; engineRPM = RPM_IDLE; clutchEngage = 1; clutchPulled = false;
  gasPressed = false; brakePressed = false;
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
//  FULLSCREEN  (takes the sim over the whole screen — escapes the page/header when embedded)
// ═══════════════════════════════════════════════════════════
{
  const fsBtn = document.getElementById('btn-fullscreen');
  const root  = document.documentElement;
  const reqFS  = root.requestFullscreen || root.webkitRequestFullscreen || root.mozRequestFullScreen || root.msRequestFullscreen;
  const exitFS = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  const fsEl   = () => document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
  if (fsBtn && reqFS) {
    fsBtn.addEventListener('click', () => {
      if (fsEl()) { exitFS.call(document); } else { reqFS.call(root); }
    });
    const sync = () => { fsBtn.textContent = fsEl() ? '🗗' : '⛶'; };
    ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange'].forEach(ev => document.addEventListener(ev, sync));
  } else if (fsBtn) {
    fsBtn.style.display = 'none';   // no Fullscreen API (e.g. iOS Safari) — hide the button
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
//  ZOOM BUTTONS
// ═══════════════════════════════════════════════════════════
(function() {
  const ZOOM_MIN = 0.25, ZOOM_MAX = 4.0, ZOOM_STEP = 1.25;
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    userZoom = Math.min(ZOOM_MAX, userZoom * ZOOM_STEP);
    PM = PM_base * userZoom;
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    userZoom = Math.max(ZOOM_MIN, userZoom / ZOOM_STEP);
    PM = PM_base * userZoom;
  });
})();

// Re-run after layout fully settles so flex heights are computed
setTimeout(() => { resizeCurveCanvas(); resizeFG(); resizeVG(); }, 100);

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

  // Touch support
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      dragging = true;
      dragStartX = e.touches[0].clientX;
      dragStartPan = camPanX_m;
      e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    if (!dragging || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - dragStartX;
    camPanX_m = dragStartPan - dx / PM;
  });

  window.addEventListener('touchend', () => { dragging = false; });

  // Double-click to re-center camera on bike
  canvas.addEventListener('dblclick', () => {
    camPanX_m = 0;
  });
})();
