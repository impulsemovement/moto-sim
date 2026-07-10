'use strict';
// ═══════════════════════════════════════════════════════════
//  SAVE / LOAD SETUPS  (localStorage)
// ═══════════════════════════════════════════════════════════
const SETUP_KEY = 'motosim-setups';
// Every parameter slider id — saved/restored by raw slider value so we reuse the
// existing bind() callbacks (dispatch 'input') instead of inverting each mapping.
const SETUP_SLIDERS = [
  'k_f','air_f','pre_f','damp_f','ktire_f','munsp_f',
  'k_r','pre_r','damp_r','ktire_r','munsp_r',
  'mass','speed','timescale','gasrate','brakerate',
  'terrain','amp','freq','rough','duty','pitchmom','drivepitch','tiregrip','terrainbite','terrainpitch','bounceF','bounceR',
  'comheight','pitchinertia','rake','wheelbase','custlen','custheight'
];

function loadSetups() {
  try { return JSON.parse(localStorage.getItem(SETUP_KEY)) || {}; }
  catch { return {}; }
}
function persistSetups(obj) {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(obj)); } catch {}
}
function captureSetup() {
  const sliders = {};
  SETUP_SLIDERS.forEach(id => {
    const el = document.getElementById(id);
    if (el) sliders[id] = el.value;
  });
  const clone = a => a.map(p => ({ x:p.x, y:p.y }));
  return {
    sliders,
    curves: { compPts_F: clone(compPts_F), rebPts_F: clone(rebPts_F),
              compPts_R: clone(compPts_R), rebPts_R: clone(rebPts_R) },
    terrainPts: clone(terrainPts),
    customTrack: customTrack.map(f => { const { _x0, ...rest } = f; return { ...rest }; }),
    scales: { ...curveScaleVals },
    wheelMode, curveMode
  };
}
function applySetupToControls(s) {
  // 1) Sliders: set value + fire 'input' so labels and P/GAS/BRAKE update via bind().
  if (s.sliders) {
    Object.entries(s.sliders).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) { el.value = val; el.dispatchEvent(new Event('input')); }
    });
  }
  // 2) Damping curves + per-curve scales.
  if (s.curves) {
    const cl = a => (a || []).map(p => ({ x:p.x, y:p.y }));
    if (s.curves.compPts_F) compPts_F = cl(s.curves.compPts_F);
    if (s.curves.rebPts_F)  rebPts_F  = cl(s.curves.rebPts_F);
    if (s.curves.compPts_R) compPts_R = cl(s.curves.compPts_R);
    if (s.curves.rebPts_R)  rebPts_R  = cl(s.curves.rebPts_R);
    compLUT_F = buildCurveLUT(compPts_F); rebLUT_F = buildCurveLUT(rebPts_F);
    compLUT_R = buildCurveLUT(compPts_R); rebLUT_R = buildCurveLUT(rebPts_R);
  }
  if (s.terrainPts) {
    terrainPts = (s.terrainPts || []).map(p => ({ x:p.x, y:p.y }));
    terrainLUT = buildCurveLUT(terrainPts);
  }
  if (Array.isArray(s.customTrack) && s.customTrack.length) {
    customTrack = s.customTrack.map(f => ({ ...f }));
    rebuildCustomTrack();
  }
  if (typeof drawTerrainEditor === 'function') drawTerrainEditor();
  if (s.scales) Object.assign(curveScaleVals, s.scales);
  // 3) Active toggles + redraw.
  setWheelMode(s.wheelMode || 'front');
  setCurveMode(s.curveMode || 'comp');
  syncCurveScaleSlider();
  drawCurveEditor();
  // 4) Re-solve equilibrium with the restored parameters.
  resetSim();
}
function refreshSetupDropdown(selectName) {
  const sel = document.getElementById('setup-select');
  if (!sel) return;
  const setups = loadSetups();
  const names = Object.keys(setups).sort();
  sel.innerHTML = '';
  if (names.length === 0) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '(none saved)'; o.disabled = true;
    sel.appendChild(o);
  } else {
    names.forEach(n => {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    });
    if (selectName && names.includes(selectName)) sel.value = selectName;
  }
}
function setSetupStatus(msg) {
  const el = document.getElementById('lsetup-status');
  if (!el) return;
  el.textContent = msg ? '· ' + msg : '';
  if (msg) setTimeout(() => { if (el.textContent === '· ' + msg) el.textContent = ''; }, 1800);
}
(function wireSetups() {
  refreshSetupDropdown();
  document.getElementById('btn-setup-save').addEventListener('click', () => {
    const nameEl = document.getElementById('setup-name');
    const name = (nameEl.value || '').trim();
    if (!name) { setSetupStatus('enter a name'); nameEl.focus(); return; }
    const setups = loadSetups();
    setups[name] = captureSetup();
    persistSetups(setups);
    refreshSetupDropdown(name);
    setSetupStatus('saved "' + name + '"');
  });
  document.getElementById('btn-setup-load').addEventListener('click', () => {
    const sel = document.getElementById('setup-select');
    const name = sel.value;
    if (!name) { setSetupStatus('nothing to load'); return; }
    const setups = loadSetups();
    if (setups[name]) { applySetupToControls(setups[name]); setSetupStatus('loaded "' + name + '"'); }
  });
  document.getElementById('btn-setup-del').addEventListener('click', () => {
    const sel = document.getElementById('setup-select');
    const name = sel.value;
    if (!name) return;
    const setups = loadSetups();
    delete setups[name];
    persistSetups(setups);
    refreshSetupDropdown();
    setSetupStatus('deleted "' + name + '"');
  });
})();

// ═══════════════════════════════════════════════════════════
//  RIDER INPUT LAYER  (pointer / keyboard — gamepad plugs in here)
// ═══════════════════════════════════════════════════════════
// Physics reads five boolean "intent" globals (gasPressed, brakeFrontHeld, brakeRearHeld,
// brakeBothHeld, clutchPulled) and ramps them into gasInput/brakeInputF/brakeInputR itself
// (physics.js). Several input paths can hold the same control at once — a finger on GAS while
// G is down — so each control counts its HOLDERS by source name rather than storing a bare
// bool. Releasing one source must not release the control if another still holds it, which is
// exactly the bug a plain `gasPressed = false` on mouseup produced.
const HOLD_SRC = { gas: new Set(), brakeF: new Set(), brakeR: new Set(), brakeBoth: new Set(), clutch: new Set() };

function refreshHoldGlow() {
  const glow = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('held', on); };
  // Derive glow from the physics-facing globals, not from one control's holders: the B key
  // sets brakeBoth, which must light BOTH brake buttons without disturbing their own state.
  glow('btn-gas',     gasPressed);
  glow('btn-clutch',  clutchPulled);
  glow('btn-brake-f', brakeFrontHeld || brakeBothHeld);
  glow('btn-brake-r', brakeRearHeld  || brakeBothHeld);
}
function applyHold(ctl, on) {
  switch (ctl) {
    case 'gas':       gasPressed     = on; break;
    case 'brakeF':    brakeFrontHeld = on; break;
    case 'brakeR':    brakeRearHeld  = on; break;
    case 'brakeBoth': brakeBothHeld  = on; break;
    case 'clutch':    clutchPulled   = on; break;
  }
  refreshHoldGlow();
}
// src is an arbitrary tag ('key', a pointerId, later 'pad'); the control is held while ≥1 holds it.
function setHold(ctl, src, on) {
  const holders = HOLD_SRC[ctl];
  if (on) holders.add(src); else holders.delete(src);
  applyHold(ctl, holders.size > 0);
}
// resetSim() zeroes the intent globals directly, so the holder sets must be emptied with them
// or a control the user is still physically holding would never re-fire its "on" transition.
function clearHolds() {
  Object.values(HOLD_SRC).forEach(s => s.clear());
  refreshHoldGlow();
}

function shiftGear(dir) {
  gear = Math.max(0, Math.min(NUM_GEARS - 1, gear + dir));
}

(function() {
  // ── Hold buttons (pointer events: one path for mouse, touch and pen) ──────
  // Pointer capture routes the release to this element even if the finger slides off it, so a
  // button can no longer get stuck "on" — the failure mode of the old mousedown/touchend pairs.
  function bindHold(id, ctl) {
    const el = document.getElementById(id);
    if (!el) return;
    const release = e => setHold(ctl, e.pointerId, false);
    el.addEventListener('pointerdown', e => {
      e.preventDefault();                    // no focus ring, no synthesized click
      try { el.setPointerCapture(e.pointerId); } catch {}
      setHold(ctl, e.pointerId, true);
    });
    el.addEventListener('pointerup',     release);
    el.addEventListener('pointercancel', release);   // OS stole the gesture (call, notification…)
  }
  bindHold('btn-gas',     'gas');
  bindHold('btn-clutch',  'clutch');
  bindHold('btn-brake-f', 'brakeF');
  bindHold('btn-brake-r', 'brakeR');

  // ── Shift buttons (fire once per press, on the way down) ──────────────────
  function bindTap(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
  }
  bindTap('btn-shift-up', () => shiftGear(+1));
  bindTap('btn-shift-dn', () => shiftGear(-1));

  // ── Keyboard: G/→ gas, ↓ FRONT brake, ← REAR brake, B BOTH, C/Space clutch (hold),
  // A downshift, D upshift, R reset. Only a TEXT-entry field (the setup-name box) swallows
  // shortcuts — range sliders, dropdowns, etc. do NOT, so controls work with a slider focused.
  const KEY_HOLD = {
    g: 'gas', arrowright: 'gas',
    arrowdown: 'brakeF',
    arrowleft: 'brakeR',
    b: 'brakeBoth',
    c: 'clutch', ' ': 'clutch',
  };
  window.addEventListener('keydown', e => {
    if (isTextEntry(e.target)) return;
    const ctl = KEY_HOLD[e.key.toLowerCase()];
    if (ctl) { e.preventDefault(); setHold(ctl, 'key', true); }
    if (!e.repeat && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); shiftGear(+1); }
    if (!e.repeat && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); shiftGear(-1); }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetSim(); }
  });
  window.addEventListener('keyup', e => {
    const ctl = KEY_HOLD[e.key.toLowerCase()];
    if (ctl) setHold(ctl, 'key', false);
  });
  // Keys have no "cancel" event: alt-tabbing away while holding G leaves the throttle pinned.
  window.addEventListener('blur', () => {
    Object.keys(HOLD_SRC).forEach(ctl => setHold(ctl, 'key', false));
  });

  // ── Mobile touch legend (dismissible, persisted) ──────────────────────────
  const tl = document.getElementById('touch-legend');
  if (tl) {
    if (localStorage.getItem('motosim-hidetouchlegend') === '1') tl.style.display = 'none';
    document.getElementById('touch-legend-x').addEventListener('click', () => {
      tl.style.display = 'none';
      try { localStorage.setItem('motosim-hidetouchlegend', '1'); } catch {}
    });
  }
})();

// ═══════════════════════════════════════════════════════════
//  GRAPH LEGEND TOGGLES  (click a label to show/hide its line)
// ═══════════════════════════════════════════════════════════
function applyLegendStyle() {
  document.querySelectorAll('.leg').forEach(el => {
    el.style.opacity = seriesVisible[el.dataset.key] ? '1' : '0.3';
  });
}
document.querySelectorAll('.leg').forEach(el => {
  el.addEventListener('click', () => {
    const k = el.dataset.key;
    seriesVisible[k] = !seriesVisible[k];
    applyLegendStyle();
  });
});
applyLegendStyle();

// ═══════════════════════════════════════════════════════════
//  COLLAPSIBLE CARDS
// ═══════════════════════════════════════════════════════════
function toggleCard(titleEl) {
  const body = titleEl.nextElementSibling;
  const arrow = titleEl.querySelector('.card-arrow');
  const collapsed = body.classList.toggle('collapsed');
  arrow.textContent = collapsed ? '◀' : '▼';
  // For curve card, toggle flex layout so the card shrinks when collapsed
  const card = titleEl.closest('.card');
  if (card && card.id === 'curve-card') {
    card.classList.toggle('collapsed-curve', collapsed);
  }
}

// Wire the card/toggle/preset controls (was inline onclick=, which doesn't work in module
// scope — these are bound here instead).
document.querySelectorAll('.card-title').forEach(t => t.addEventListener('click', () => toggleCard(t)));
document.getElementById('btn-front').addEventListener('click', () => setWheelMode('front'));
document.getElementById('btn-rear') .addEventListener('click', () => setWheelMode('rear'));
document.getElementById('btn-comp') .addEventListener('click', () => setCurveMode('comp'));
document.getElementById('btn-reb')  .addEventListener('click', () => setCurveMode('reb'));
document.querySelectorAll('.preset-btn').forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.preset)));

