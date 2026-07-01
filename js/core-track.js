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
let trackWalls    = [];   // [{x0,x1,top}] solid colliders (world X within one lap)

const FEATURE_TYPES = ['flat','jump','rhythm','table','stepup','stepdown','wall','shape'];

// Local profile HEIGHT (m, +up) of a feature at distance u∈[0,len]. Baseline 0 at both ends so
// features butt together cleanly. groundY (Y-down) uses −height.
function featureHeight(f, u) {
  const L = f.len || 1, p = Math.max(0, Math.min(1, u / L)), h = f.height || 0;
  const ss = t => { t = Math.max(0, Math.min(1, t)); return t*t*(3 - 2*t); };  // smoothstep
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
      return (evalCurveLUT(terrainLUT, p) - terrainLUT[0].y) * h;
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
  const x = (((wx % trackTotalLen) + trackTotalLen) % trackTotalLen);
  for (let i = 0; i < customTrack.length; i++) {
    const seg = customTrack[i];
    if (x >= seg._x0 && x < seg._x0 + seg.len) return -featureHeight(seg, x - seg._x0);
  }
  return 0;
}

// Recompute cached segment offsets, total length and the wall colliders. Call after any edit.
function rebuildCustomTrack() {
  let off = 0; trackWalls = [];
  for (const f of customTrack) {
    f._x0 = off;
    if (f.type === 'wall') trackWalls.push({ x0: off + f.len*0.4, x1: off + f.len*0.6, top: (f.height || 0.9) });
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

