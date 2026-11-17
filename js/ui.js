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
    wheelMode, curveMode,
    // Prime fitted? The curves above already ARE the Prime curves in that case; the stash is the
    // fork's own curves to go back to when it is switched off (see "PRIME EMULATOR" below).
    prime: primeOn,
    primeStash: primeStash && { comp: clone(primeStash.comp), reb: clone(primeStash.reb) }
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
  // Prime flag follows the setup. The curves were restored above, so this only sets the STATE
  // (no curve swap). A setup saved before the switch existed has no flag → treated as stock.
  restorePrimeState(!!s.prime, s.primeStash);
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
      fitTunePanel();   // the sheet below just gained this row's height
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
//  SLIDER PAINT  (red fill · stock-value tick · "changed" flag)
// ═══════════════════════════════════════════════════════════
// styles.css draws each slider's rail, fill and tick as background layers positioned by three
// 0–1 custom properties; this keeps them current. Sliders are moved from three directions — the
// user (an 'input' event), setup load (value + dispatched 'input'), and code that assigns .value
// with NO event (render.js walks the Speed slider while the throttle is held; graphs.js loads a
// track feature's numbers into the Length/Height sliders). To catch the silent ones each slider
// gets an own-property `value` accessor that forwards to the native one and then repaints.
const RANGE_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
function rangeFrac(el, v) {
  const min = el.min === '' ? 0 : +el.min, max = el.max === '' ? 100 : +el.max;
  return Math.max(0, Math.min(1, (v - min) / ((max - min) || 1)));
}
function paintRange(el) {
  const raw = RANGE_VALUE.get.call(el);
  const key = raw + '|' + el.min + '|' + el.max;
  if (el._painted === key) return;            // Speed is re-assigned every frame under throttle
  el._painted = key;
  const p = rangeFrac(el, +raw);
  // A range that straddles zero (preload ±30 mm, amplitude ±2×) fills from zero, not from the
  // left end — so "no preload" reads as an empty rail rather than a half-full one.
  const z = (+el.min < 0 && +el.max > 0) ? rangeFrac(el, 0) : 0;
  el.style.setProperty('--lo', Math.min(p, z));
  el.style.setProperty('--hi', Math.max(p, z));
  const row = el.closest('.ctl');
  if (row && !row.classList.contains('ctx')) row.classList.toggle('changed', +raw !== +el.defaultValue);
}
document.querySelectorAll('input[type=range]').forEach(el => {
  el.style.setProperty('--d', rangeFrac(el, +el.defaultValue));   // where the stock tick sits
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() { return RANGE_VALUE.get.call(this); },
    set(v) { RANGE_VALUE.set.call(this, v); paintRange(this); }
  });
  el.addEventListener('input', () => paintRange(el));
  paintRange(el);
});

// ═══════════════════════════════════════════════════════════
//  TUNE PANEL  (in-player settings · Standard / Advanced)
// ═══════════════════════════════════════════════════════════
// Markup + the Standard/Advanced filtering rules are documented in index.html and styles.css.
// This block only owns STATE (open, mode, tab, wide — persisted) and the two side effects a
// visibility change needs: re-fitting the mobile sheet and re-sizing the editor canvases.
const TUNE_KEY = 'motosim-tune';
const tuneEl   = document.getElementById('tune');
const TUNE_TABS = Array.from(tuneEl.querySelectorAll('.tune-tab')).map(b => b.dataset.tab);
const tuneState = (() => {
  const s = { open: null, mode: 'std', tab: 'susp', wide: false };
  try { Object.assign(s, JSON.parse(localStorage.getItem(TUNE_KEY)) || {}); } catch {}
  if (s.mode !== 'adv') s.mode = 'std';
  if (!TUNE_TABS.includes(s.tab)) s.tab = TUNE_TABS[0];
  // First visit: open wherever the panel has room that costs nothing — the mobile sheet sits
  // below the bike, and from 980 px up the drawer clears the front wheel. In between it would
  // land on the fork, so it waits behind the TUNE button.
  if (typeof s.open !== 'boolean') s.open = window.innerWidth <= 640 || window.innerWidth >= 980;
  return s;
})();

// Mobile only: cap the sheet at the screen height left under the ride controls, so canvas +
// controls + sheet are one screenful. viewportHeight() (core-config.js) sees through the
// WordPress iframe to the real window height, the same way resizeMain() sizes the canvas.
function fitTunePanel() {
  if (window.innerWidth > 640 || tuneEl.classList.contains('is-closed')) return;
  const top = tuneEl.getBoundingClientRect().top + window.scrollY;
  const h = Math.max(240, Math.min(560, viewportHeight() - top - 6));
  tuneEl.style.setProperty('--tune-h', Math.round(h) + 'px');
}
// graphs.js sizes each canvas's backing store from its on-screen box, which is 0×0 while its
// pane (or the whole panel) is hidden — so every time something becomes visible, size it again.
// The second pass lands after the wide/narrow width transition (0.18 s) has finished.
function refreshTuneCanvases() {
  const go = () => {
    if (typeof resizeCurveCanvas   === 'function') resizeCurveCanvas();
    if (typeof resizeTerrainCanvas === 'function') resizeTerrainCanvas();
    if (typeof resizeFG === 'function') resizeFG();
    if (typeof resizeVG === 'function') resizeVG();
  };
  requestAnimationFrame(go);
  setTimeout(go, 240);
}
function applyTune() {
  const s = tuneState;
  tuneEl.classList.toggle('is-closed', !s.open);
  tuneEl.classList.toggle('wide', !!s.wide);
  tuneEl.dataset.mode = s.mode;
  tuneEl.dataset.tab  = s.tab;
  document.getElementById('btn-tune').setAttribute('aria-expanded', String(s.open));
  tuneEl.querySelectorAll('#tune-mode .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === s.mode));
  tuneEl.querySelectorAll('.tune-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === s.tab));
  tuneEl.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === s.tab));
  try { localStorage.setItem(TUNE_KEY, JSON.stringify(s)); } catch {}
  fitTunePanel();
  refreshTuneCanvases();
}
function setTuneOpen(on)  { tuneState.open = !!on; applyTune(); }
function setTuneWide(on)  { tuneState.wide = !!on; applyTune(); }
function setTuneMode(m)   { tuneState.mode = m === 'adv' ? 'adv' : 'std'; applyTune(); document.getElementById('tune-body').scrollTop = 0; }
function setTuneTab(t)    { if (TUNE_TABS.includes(t)) { tuneState.tab = t; applyTune(); document.getElementById('tune-body').scrollTop = 0; } }

document.getElementById('btn-tune')  .addEventListener('click', () => setTuneOpen(!tuneState.open));
document.getElementById('tune-close').addEventListener('click', () => setTuneOpen(false));
document.getElementById('tune-wide') .addEventListener('click', () => setTuneWide(!tuneState.wide));
tuneEl.querySelectorAll('#tune-mode .toggle-btn').forEach(b => b.addEventListener('click', () => setTuneMode(b.dataset.mode)));
tuneEl.querySelectorAll('.tune-tab').forEach(b => b.addEventListener('click', () => setTuneTab(b.dataset.tab)));
window.addEventListener('resize', fitTunePanel);
window.addEventListener('keydown', e => {
  if (isTextEntry(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 't' || e.key === 'T') { e.preventDefault(); setTuneOpen(!tuneState.open); }
  else if (e.key === 'Escape' && tuneState.open && window.innerWidth > 640) setTuneOpen(false);
});

// Double-click a control's NAME to put it back to its stock value (the tick on its rail).
tuneEl.addEventListener('dblclick', e => {
  const lab = e.target.closest('.ctl:not(.ctx) > label');
  const inp = lab && lab.parentElement.querySelector('input[type=range]');
  if (!inp) return;
  inp.value = inp.defaultValue;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});

// ── Terrain chips ───────────────────────────────────────────
// One chip per TERRAINS entry (core-params.js), so a terrain added there shows up here as long
// as the hidden #terrain range's max covers it. The range stays the source of truth: a chip
// only sets its value and fires the same 'input' that bind() and saved setups already rely on.
(function() {
  const sl  = document.getElementById('terrain');
  const box = document.getElementById('terrain-chips');
  for (let i = +sl.min; i <= +sl.max && i < TERRAINS.length; i++) {
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.dataset.v = i; b.textContent = TERRAINS[i];
    b.addEventListener('click', () => { sl.value = i; sl.dispatchEvent(new Event('input', { bubbles: true })); });
    box.appendChild(b);
  }
  function sync() {
    const v = +sl.value;
    box.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', +c.dataset.v === v));
    // The track builder is only on screen for the Custom terrain; it was display:none until
    // now, so its canvas needs sizing the moment it appears.
    const custom = /custom/i.test(TERRAINS[v] || '');
    if (custom !== tuneEl.hasAttribute('data-custom')) {
      tuneEl.toggleAttribute('data-custom', custom);
      if (custom) refreshTuneCanvases();
    }
  }
  sl.addEventListener('input', sync);
  sync();
})();

// ═══════════════════════════════════════════════════════════
//  PRIME EMULATOR  (the product: stock fork ⇄ Prime Series emulator)
// ═══════════════════════════════════════════════════════════
// The Prime emulator is a valve that threads onto the stock fork spring of a damper-rod fork and
// adds compression + rebound valving. In this sim that is exactly "the front fork's two damping
// curves", so the switch is a curve swap — no physics change, the same mechanism as loading a
// setup (CLAUDE.md parameter contract: the fork product maps to the FRONT damping LUTs).
//
// WHERE THE NUMBERS COME FROM. The curves are the stock (linear) curve multiplied by the effect
// the product page publishes for its Medium / Sport preset, vs the stock fork:
//     compression   +63% at 0.1 m/s   (low-speed circuit: brake dive, mid-corner support)
//                   +16% at 0.3 m/s,  +28% at 0.75 m/s   (bias / high-speed screws)
//                   ≈ +1–2% at 1.5 m/s and on sharp hits  (the valve blows open — no added harshness)
//     rebound       +127% at 0.05 m/s (rebound collar: "no pogo after a bump")
// The page quotes those one adjuster at a time; folding them into ONE curve per direction is this
// file's interpretation, and the rebound taper above 0.1 m/s is assumed (the page gives a single
// rebound point). When measured force–velocity data exists, replace PRIME_KIT — nothing else
// depends on the shape. Curve x = fork speed / V_MAX_SIM (3 m/s); y = fraction of the base force.
//   NOT modelled: the ~16 mm of spring preload the part adds (the page's optional spacer trim
//   restores stock ride height, which is what OFF ⇄ ON assumes here).
const PRIME_KIT = {
  //        0 m/s        0.1 m/s ×1.63          0.3 m/s ×1.40      0.75 m/s ×1.28     1.5 m/s ×1.02     3 m/s ×1.00
  comp: [ {x:0, y:0}, {x:0.0333, y:0.0543}, {x:0.10, y:0.140}, {x:0.25, y:0.320}, {x:0.50, y:0.510}, {x:1, y:1} ],
  //        0 m/s        0.1 m/s ×2.00          0.3 m/s ×1.50      0.75 m/s ×1.16     1.5 m/s ×1.00     3 m/s ×1.00
  // (×2.00 at 0.1 m/s is what puts the spline on the published ×2.27 at 0.05 m/s — the curve
  //  bows above the chord between its first two points; the harness checks the 0.05 m/s figure.)
  reb:  [ {x:0, y:0}, {x:0.0333, y:0.0667}, {x:0.10, y:0.150}, {x:0.25, y:0.290}, {x:0.50, y:0.500}, {x:1, y:1} ],
};
// The sim is a sales tool for this part and the page copy reads "Love how it rides?", so a
// visitor starts ON the emulator and switches it off to feel what stock is like.
const PRIME_DEFAULT_ON = true;

let primeOn    = false;   // read by render.js (fork tag) and captureSetup()
// While Prime is fitted: the fork's OWN front curves (stock, or whatever the user had drawn),
// kept so OFF puts back exactly what was there rather than a factory default.
let primeStash = null;

const clonePts = a => a.map(p => ({ x: p.x, y: p.y }));
function syncPrimeUI() {
  const b = document.getElementById('btn-prime');
  if (b) { b.setAttribute('aria-checked', String(primeOn)); b.setAttribute('aria-label', 'Prime emulator ' + (primeOn ? 'on' : 'off')); }
  const st = document.getElementById('prime-state'); if (st) st.textContent = primeOn ? 'ON' : 'OFF';
  const kit = document.getElementById('fork-kit');
  if (kit) { kit.textContent = primeOn ? 'Prime emulator' : 'Stock'; kit.classList.toggle('on', primeOn); }
}
// Fit / remove the emulator. Live — no reset — so flipping it mid-ride is felt immediately.
function setPrime(on) {
  on = !!on;
  if (on !== primeOn) {
    if (on) {
      primeStash = { comp: clonePts(compPts_F), reb: clonePts(rebPts_F) };
      compPts_F = clonePts(PRIME_KIT.comp);
      rebPts_F  = clonePts(PRIME_KIT.reb);
    } else {
      const own = primeStash || { comp: PRESETS.linear, reb: PRESETS.linear };
      compPts_F = clonePts(own.comp);
      rebPts_F  = clonePts(own.reb);
      primeStash = null;
    }
    compLUT_F = buildCurveLUT(compPts_F);
    rebLUT_F  = buildCurveLUT(rebPts_F);
    primeOn = on;
    drawCurveEditor();    // the Damping tab shows the fitted curves straight away
  }
  syncPrimeUI();
}
// Setup load: curves already restored by the caller; just adopt the saved state.
function restorePrimeState(on, stash) {
  primeOn = !!on;
  primeStash = primeOn && stash && stash.comp && stash.reb
    ? { comp: clonePts(stash.comp), reb: clonePts(stash.reb) } : null;
  syncPrimeUI();
}
document.getElementById('btn-prime').addEventListener('click', () => setPrime(!primeOn));
// The validation harness (?test) measures the STOCK baseline every scenario was calibrated on,
// so it starts with the emulator off; its own primeToggle scenario covers the ON state.
setPrime(PRIME_DEFAULT_ON && !/[?&]test/.test(location.search));

// Mobile parks the switch over the dirt at the bottom of the canvas (styles.css); tell the CSS
// how tall the canvas currently is. core-config.js's resize listener runs before this one.
function syncCanvasHeightVar() {
  document.getElementById('sim-wrap').style.setProperty('--canvas-h', canvas.height + 'px');
}
window.addEventListener('resize', syncCanvasHeightVar);
syncCanvasHeightVar();

// ── Curve-editor switches ───────────────────────────────────
document.getElementById('btn-front').addEventListener('click', () => setWheelMode('front'));
document.getElementById('btn-rear') .addEventListener('click', () => setWheelMode('rear'));
document.getElementById('btn-comp') .addEventListener('click', () => setCurveMode('comp'));
document.getElementById('btn-reb')  .addEventListener('click', () => setCurveMode('reb'));
// Only buttons that NAME a preset. This used to bind every `.preset-btn` — which is also the
// class on Save / Load / Del / Resume / Add feature — so each of those called
// applyPreset(undefined), which empties the active curve's control points and then throws.
document.querySelectorAll('.preset-btn[data-preset]').forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.preset)));

applyTune();
