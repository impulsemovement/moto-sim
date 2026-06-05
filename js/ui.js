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
  'comheight','pitchinertia','rake'
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
//  GAS / BRAKE BUTTONS
// ═══════════════════════════════════════════════════════════
(function() {
  function setGas(on) {
    gasPressed = on;
    document.getElementById('btn-gas').classList.toggle('held', on);
  }
  function setBrake(on) {
    brakePressed = on;
    document.getElementById('btn-brake').classList.toggle('held', on);
  }
  function setClutch(on) {
    clutchPulled = on;
    document.getElementById('btn-clutch').classList.toggle('held', on);
  }
  function shiftGear(dir) {
    gear = Math.max(0, Math.min(NUM_GEARS - 1, gear + dir));
  }

  const gasBtn    = document.getElementById('btn-gas');
  const brakeBtn  = document.getElementById('btn-brake');
  const clutchBtn = document.getElementById('btn-clutch');

  // Mouse
  gasBtn.addEventListener('mousedown',   () => setGas(true));
  brakeBtn.addEventListener('mousedown', () => setBrake(true));
  clutchBtn.addEventListener('mousedown',() => setClutch(true));
  window.addEventListener('mouseup',     () => { setGas(false); setBrake(false); setClutch(false); });

  // Touch (prevent scroll while holding)
  gasBtn.addEventListener('touchstart',    e => { e.preventDefault(); setGas(true); },    {passive:false});
  gasBtn.addEventListener('touchend',      e => { e.preventDefault(); setGas(false); },   {passive:false});
  brakeBtn.addEventListener('touchstart',  e => { e.preventDefault(); setBrake(true); },  {passive:false});
  brakeBtn.addEventListener('touchend',    e => { e.preventDefault(); setBrake(false); }, {passive:false});
  clutchBtn.addEventListener('touchstart', e => { e.preventDefault(); setClutch(true); }, {passive:false});
  clutchBtn.addEventListener('touchend',   e => { e.preventDefault(); setClutch(false); },{passive:false});

  // Shift buttons (mobile-friendly gear change). Click for desktop; touchstart + preventDefault
  // for touch (which also suppresses the synthesized click, so each tap shifts exactly once).
  const shiftUpBtn = document.getElementById('btn-shift-up');
  const shiftDnBtn = document.getElementById('btn-shift-dn');
  shiftUpBtn.addEventListener('click', () => shiftGear(+1));
  shiftDnBtn.addEventListener('click', () => shiftGear(-1));
  shiftUpBtn.addEventListener('touchstart', e => { e.preventDefault(); shiftGear(+1); }, {passive:false});
  shiftDnBtn.addEventListener('touchstart', e => { e.preventDefault(); shiftGear(-1); }, {passive:false});

  // Keyboard: G/→ gas, B/← brake, C clutch (hold), A downshift, D upshift, R reset.
  // Only a TEXT-entry field (the setup-name box) swallows shortcuts — range sliders,
  // dropdowns, etc. do NOT, so the controls always work even with a slider focused.
  window.addEventListener('keydown', e => {
    if (isTextEntry(e.target)) return;
    if (e.key === 'g' || e.key === 'G' || e.key === 'ArrowRight') { e.preventDefault(); setGas(true); }
    if (e.key === 'b' || e.key === 'B' || e.key === 'ArrowLeft')  { e.preventDefault(); setBrake(true); }
    if (e.key === 'c' || e.key === 'C' || e.key === ' ' || e.code === 'Space') { e.preventDefault(); setClutch(true); }
    if (!e.repeat && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); shiftGear(+1); }
    if (!e.repeat && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); shiftGear(-1); }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetSim(); }
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'g' || e.key === 'G' || e.key === 'ArrowRight') setGas(false);
    if (e.key === 'b' || e.key === 'B' || e.key === 'ArrowLeft')  setBrake(false);
    if (e.key === 'c' || e.key === 'C' || e.key === ' ' || e.code === 'Space') setClutch(false);
  });
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

