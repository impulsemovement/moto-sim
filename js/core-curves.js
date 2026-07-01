'use strict';
// ═══════════════════════════════════════════════════════════
//  (split from core.js — see CLAUDE.md ownership map; classic global scope,
//   loaded in original order so top-level execution is unchanged)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  CATMULL-ROM LUT
// ═══════════════════════════════════════════════════════════
const CURVE_SAMPLES = 256;

function buildCurveLUT(pts) {
  const n    = pts.length;
  const segs = n - 1;
  const sps  = Math.ceil(CURVE_SAMPLES / segs);
  const ext  = [
    { x:2*pts[0].x-pts[1].x,     y:2*pts[0].y-pts[1].y },
    ...pts,
    { x:2*pts[n-1].x-pts[n-2].x, y:2*pts[n-1].y-pts[n-2].y }
  ];
  const lut  = [];
  for (let s=0; s<segs; s++) {
    const p0=ext[s], p1=ext[s+1], p2=ext[s+2], p3=ext[s+3];
    const endI = (s===segs-1) ? sps : sps-1;
    for (let i=0; i<=endI; i++) {
      const t=i/sps, t2=t*t, t3=t2*t;
      const c0=-0.5*t3+    t2-0.5*t;
      const c1= 1.5*t3-2.5*t2     +1;
      const c2=-1.5*t3+2.0*t2+0.5*t;
      const c3= 0.5*t3-0.5*t2;
      lut.push({
        x: Math.max(0, Math.min(1,   c0*p0.x+c1*p1.x+c2*p2.x+c3*p3.x)),
        y: Math.max(0, Math.min(1.5, c0*p0.y+c1*p1.y+c2*p2.y+c3*p3.y))
      });
    }
  }
  lut.sort((a,b)=>a.x-b.x);
  lut[0]            = {x:pts[0].x,     y:pts[0].y};
  lut[lut.length-1] = {x:pts[n-1].x,   y:pts[n-1].y};
  return lut;
}

function evalCurveLUT(lut, x) {
  x = Math.max(0, Math.min(1, x));
  const n = lut.length;
  // Beyond the first/last control point, EXTRAPOLATE along the end segment's slope
  // (instead of clamping flat) so the curve "continues past" the movable endpoints.
  if (x<=lut[0].x) {
    const a=lut[0], b=lut[1];
    const slope=(b.y-a.y)/((b.x-a.x)||1e-6);
    return Math.max(0, a.y + slope*(x-a.x));
  }
  if (x>=lut[n-1].x) {
    const a=lut[n-2], b=lut[n-1];
    const slope=(b.y-a.y)/((b.x-a.x)||1e-6);
    return Math.max(0, b.y + slope*(x-b.x));
  }
  let lo=0, hi=lut.length-1;
  while (hi-lo>1) { const m=(lo+hi)>>1; if (lut[m].x<=x) lo=m; else hi=m; }
  const t=(x-lut[lo].x)/(lut[hi].x-lut[lo].x);
  return lut[lo].y+t*(lut[hi].y-lut[lo].y);
}

// ═══════════════════════════════════════════════════════════
//  DAMPING CURVE PRESETS & STATE  (4 LUT sets)
// ═══════════════════════════════════════════════════════════
const PRESETS = {
  linear:      [{x:0,y:0},{x:0.33,y:0.33},{x:0.67,y:0.67},{x:1,y:1}],
  progressive: [{x:0,y:0},{x:0.33,y:0.12},{x:0.67,y:0.52},{x:1,y:1}],
  digressive:  [{x:0,y:0},{x:0.33,y:0.62},{x:0.67,y:0.88},{x:1,y:1}],
  quadratic:   [{x:0,y:0},{x:0.33,y:0.11},{x:0.67,y:0.44},{x:1,y:1}]
};

let compPts_F = PRESETS.linear.map(p=>({...p}));
let rebPts_F  = PRESETS.linear.map(p=>({...p}));
let compPts_R = PRESETS.linear.map(p=>({...p}));
let rebPts_R  = PRESETS.linear.map(p=>({...p}));

let compLUT_F = buildCurveLUT(compPts_F);
let rebLUT_F  = buildCurveLUT(rebPts_F);
let compLUT_R = buildCurveLUT(compPts_R);
let rebLUT_R  = buildCurveLUT(rebPts_R);
terrainLUT    = buildCurveLUT(terrainPts);   // custom-terrain profile LUT (declared above the binds)
rebuildCustomTrack();                        // compose the custom track + wall colliders

