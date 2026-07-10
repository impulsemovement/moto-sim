'use strict';
// ═══════════════════════════════════════════════════════════
//  (split from core.js — see CLAUDE.md ownership map; classic global scope,
//   loaded in original order so top-level execution is unchanged)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  CUSTOM TRACK BUILDER  (Custom terrain = an ordered list of feature segments)
// ═══════════════════════════════════════════════════════════
// Each feature occupies `len` metres laid end-to-end; the whole sequence LOOPS. Bump-type
// features start and end at baseline 0 so the track tiles seamlessly. Solid features (wall)
// don't change the ground height — they register a collider in trackWalls and the physics
// stops the bike there (crash + endo). The hand-drawn profile is kept as the 'shape' feature.
let customTrack = [
  { type:'flat',   len:6 },
  { type:'jump',   len:5,  height:0.9 },
  { type:'flat',   len:5 },
  { type:'rhythm', len:9,  height:0.28, count:5 },
  { type:'flat',   len:4 },
  { type:'table',  len:7,  height:1.0 },
  { type:'flat',   len:4 },
  { type:'wall',   len:2.5, height:0.9 },
  { type:'flat',   len:7 },
];
let trackTotalLen = 0;
let trackWalls    = [];   // [{x0,x1,top,sx0,sx1}] solid colliders (world X within one lap)

const smoothstep = t => { t = Math.max(0, Math.min(1, t)); return t*t*(3 - 2*t); };

// Wrap a world X into one lap, [0, trackTotalLen).
function lapX(wx) { return (((wx % trackTotalLen) + trackTotalLen) % trackTotalLen); }

// Local profile HEIGHT (m, +up) of a feature at distance u∈[0,len]. Baseline 0 at both ends so
// features butt together cleanly. groundY (Y-down) uses −height.
function featureHeight(f, u) {
  const L = f.len || 1, p = Math.max(0, Math.min(1, u / L)), h = f.height || 0;
  const ss = smoothstep;
  switch (f.type) {
    case 'jump':                                   // launch ramp → lip near the end → short backside
      return p < 0.82 ? h * (p/0.82)*(p/0.82) : h * Math.max(0, 1 - (p-0.82)/0.18);
    case 'rhythm': {                               // `count` rounded whoops, 0 at both ends
      const s = Math.sin(Math.PI * (f.count || 4) * p); return h * s*s;
    }
    case 'table':                                  // ramp up → flat top → ramp down
      return p < 0.28 ? h*ss(p/0.28) : p > 0.72 ? h*ss((1-p)/0.28) : h;
    case 'stepup':                                 // raised ledge (up & back over the segment)
      return p < 0.4 ? h*ss(p/0.4) : p > 0.85 ? h*ss((1-p)/0.15) : h;
    case 'stepdown':                               // a dip / ditch (height = depth)
      return -h * (p < 0.15 ? ss(p/0.15) : p > 0.6 ? ss((1-p)/0.4) : 1);
    case 'shape': {                                // freeform hand-drawn profile, scaled by height
      if (!terrainLUT) return 0;
      // Must read 0 at BOTH ends or the segment seam becomes a step — and on a single-valued
      // heightfield a step is a launch (or an invisible wall). terrainPts' endpoints are supposed
      // to be locked to the same Y, but a loaded setup (ui.js rebuilds the LUT from saved points)
      // can violate that, so subtract the endpoint ramp instead of just the start value.
      const n = terrainLUT.length, y0 = terrainLUT[0].y, y1 = terrainLUT[n-1].y;
      return (evalCurveLUT(terrainLUT, p) - (y0 + (y1 - y0) * p)) * h;
    }
    case 'wall':                                   // solid — ground stays flat (collider handles it)
    case 'flat':
    default: return 0;
  }
}

// Custom-track ground height (Y-down, no terrain noise) at a world X — used by groundY_m case 7
// AND by the track editor / minimap so they can draw the track regardless of the active terrain.
function customGroundAt(wx) {
  if (!trackTotalLen) rebuildCustomTrack();
  const x = lapX(wx);
  for (let i = 0; i < customTrack.length; i++) {
    const seg = customTrack[i];
    if (x >= seg._x0 && x < seg._x0 + seg.len) return -featureHeight(seg, x - seg._x0);
  }
  return 0;
}

// How much terrain noise applies at a world X (1 = full, 0 = none).
//
// A wall is a BUILT structure standing on flat ground, and its collider's `top` is measured from
// the datum (height 0) — physics.js compares the wheel-bottom height above 0 against w.top. Terrain
// noise under the wall moves the visible ground off that datum (±6 cm at rough = 1) without moving
// the collider, so the ride-over-vs-crash test drifts and the wall base floats or sinks in the dirt.
// Fade the noise to zero across the wall segment. The fade reaches 0 well before the collider face
// and returns to 1 exactly at the segment seams, so no step is introduced at either end.
function customNoiseScaleAt(wx) {
  if (!trackWalls.length) return 1;
  if (!trackTotalLen) rebuildCustomTrack();
  const x = lapX(wx);
  for (const w of trackWalls) {
    if (x < w.sx0 || x >= w.sx1) continue;
    const p = (x - w.sx0) / ((w.sx1 - w.sx0) || 1);
    return 1 - smoothstep(Math.min(p, 1 - p) / 0.25);   // 1 at the seams → 0 by 25% in
  }
  return 1;
}

// Recompute cached segment offsets, total length and the wall colliders. Call after any edit.
function rebuildCustomTrack() {
  let off = 0; trackWalls = [];
  for (const f of customTrack) {
    f._x0 = off;
    // x0/x1 = the solid face physics collides with; sx0/sx1 = the whole segment, i.e. the flat
    // noise-free apron the wall stands on (see customNoiseScaleAt).
    if (f.type === 'wall') trackWalls.push({
      x0: off + f.len*0.4, x1: off + f.len*0.6, top: (f.height || 0.9),
      sx0: off, sx1: off + f.len,
    });
    off += f.len;
  }
  trackTotalLen = Math.max(1, off);
}

// ── Bike geometry (live) ────────────────────────────────────────────────────
bind('comheight',    'lcomheight',    v => { H_COM    = v/100;          return (v/100).toFixed(2)+' m'; });
bind('pitchinertia', 'lpitchinertia', v => { I_YY     = +v;             return v+' kg·m²'; });
bind('rake',         'lrake',         v => { RAKE_RAD = +v*Math.PI/180; return (+v).toFixed(1)+'°'; });
bind('wheelbase',    'lwheelbase',    v => { WHEELBASE = v/100; A_FRONT_M = WHEELBASE - B_REAR_M; return (v/100).toFixed(2)+' m'; });

// Wheel toggle
let wheelMode = 'front';
function setWheelMode(m) {
  wheelMode = m;
  document.getElementById('btn-front').classList.toggle('active', m==='front');
  document.getElementById('btn-rear').classList.toggle('active',  m==='rear');
  document.getElementById('susp-front').style.display = m==='front' ? '' : 'none';
  document.getElementById('susp-rear').style.display  = m==='rear'  ? '' : 'none';
  document.getElementById('curve-label').textContent = m.toUpperCase();
  syncCurveScaleSlider();
  drawCurveEditor();
}

// ═══════════════════════════════════════════════════════════
//  VALUE NOISE
// ═══════════════════════════════════════════════════════════
function valueNoise(x) {
  const i  = Math.floor(x);
  const f  = x - i;
  const u  = f*f*(3-2*f);
  const h0 = Math.sin(i     *127.1+311.7)*43758.5453;
  const h1 = Math.sin((i+1) *127.1+311.7)*43758.5453;
  return (h0-Math.floor(h0) + ((h1-Math.floor(h1))-(h0-Math.floor(h0)))*u)*2-1;
}

