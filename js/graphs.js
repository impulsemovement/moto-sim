'use strict';
// ═══════════════════════════════════════════════════════════
//  FORCE HISTORY GRAPH
// ═══════════════════════════════════════════════════════════
const fg    = document.getElementById('fgraph');
const fgctx = fg.getContext('2d');

function resizeFG() { if (fg.clientWidth) fg.width = fg.clientWidth; }
window.addEventListener('resize', resizeFG);

function drawForceGraph() {
  const W=fg.width, H=fg.height;
  if (!W||!H) return;
  const fgScale = document.getElementById('fgraph-scale');
  const YF_MAX = 8000 * (fgScale ? fgScale.value / 100 : 1);

  fgctx.fillStyle='#0a0a0a'; fgctx.fillRect(0,0,W,H);

  // Grid
  fgctx.strokeStyle='#1a1a1a'; fgctx.lineWidth=1;
  for (let i=0; i<=4; i++) {
    const y=H*i/4;
    fgctx.beginPath(); fgctx.moveTo(0,y); fgctx.lineTo(W,y); fgctx.stroke();
  }
  // Zero line — thicker and brighter so it reads against the dark background
  const zy=H*0.5;
  fgctx.strokeStyle='#484848'; fgctx.lineWidth=2;
  fgctx.beginPath(); fgctx.moveTo(0,zy); fgctx.lineTo(W,zy); fgctx.stroke();

  // Y axis labels (inverted: compression is positive up on screen)
  fgctx.fillStyle='#555'; fgctx.font='9px sans-serif'; fgctx.textAlign='left';
  const fLabel = YF_MAX>=1000 ? `${(YF_MAX/1000).toFixed(1)}kN` : `${Math.round(YF_MAX)}N`;
  fgctx.fillText(`-${fLabel}`,2,10);
  fgctx.fillText('0',2,zy-2);
  fgctx.fillText(`+${fLabel}`,2,H-3);

  // Plot lines — values inverted so compression (negative) reads upward
  const lines = [
    { data: hist.fs, color: '#e11d48', key:'fs' },
    { data: hist.fd, color: '#ff8800', key:'fd' },
    { data: hist.rs, color: '#3b82f6', key:'rs' },
    { data: hist.rd, color: '#22c55e', key:'rd' }
  ];

  lines.forEach(({ data, color, key }) => {
    if (!seriesVisible[key]) return;
    fgctx.beginPath();
    fgctx.strokeStyle=color; fgctx.lineWidth=1.5;
    data.forEach((v,i) => {
      const x = i/(HIST_MAX-1)*W;
      const y = zy + (v/YF_MAX)*(H*0.5);   // inverted: positive force → down on screen
      i===0 ? fgctx.moveTo(x,y) : fgctx.lineTo(x,y);
    });
    fgctx.stroke();
  });
}

// ═══════════════════════════════════════════════════════════
//  SUSPENSION VELOCITY GRAPH
// ═══════════════════════════════════════════════════════════
const vg    = document.getElementById('vgraph');
const vgctx = vg.getContext('2d');

function resizeVG() { if (vg.clientWidth) vg.width = vg.clientWidth; }
window.addEventListener('resize', resizeVG);

function drawVelocityGraph() {
  const W=vg.width, H=vg.height;
  if (!W||!H) return;
  const vgScale = document.getElementById('vgraph-scale');
  const V_MAX = V_MAX_SIM * (vgScale ? vgScale.value / 100 : 1);

  vgctx.fillStyle='#0a0a0a'; vgctx.fillRect(0,0,W,H);

  // Grid
  vgctx.strokeStyle='#1a1a1a'; vgctx.lineWidth=1;
  for (let i=0; i<=4; i++) {
    const y=H*i/4;
    vgctx.beginPath(); vgctx.moveTo(0,y); vgctx.lineTo(W,y); vgctx.stroke();
  }
  // Zero line
  const zy=H*0.5;
  vgctx.strokeStyle='#484848'; vgctx.lineWidth=2;
  vgctx.beginPath(); vgctx.moveTo(0,zy); vgctx.lineTo(W,zy); vgctx.stroke();

  // Y axis labels — compression (negative = extending fork) shown upward
  vgctx.fillStyle='#555'; vgctx.font='9px sans-serif'; vgctx.textAlign='left';
  vgctx.fillText(`-${V_MAX.toFixed(2)}m/s`,2,10);
  vgctx.fillText('0',2,zy-2);
  vgctx.fillText(`+${V_MAX.toFixed(2)}m/s`,2,H-3);

  // Plot lines — front fork and rear suspension travel velocities
  const lines = [
    { data: hist.fv, color: '#ff8800', key:'fv' },
    { data: hist.rv, color: '#22c55e', key:'rv' }
  ];

  lines.forEach(({ data, color, key }) => {
    if (!seriesVisible[key]) return;
    vgctx.beginPath();
    vgctx.strokeStyle=color; vgctx.lineWidth=1.5;
    data.forEach((v,i) => {
      const x = i/(HIST_MAX-1)*W;
      const y = zy + (v/V_MAX)*(H*0.5);
      i===0 ? vgctx.moveTo(x,y) : vgctx.lineTo(x,y);
    });
    vgctx.stroke();
  });
}

// ═══════════════════════════════════════════════════════════
//  CURVE EDITOR
// ═══════════════════════════════════════════════════════════
const cc   = document.getElementById('curve-canvas');
const cctx = cc.getContext('2d');
const GP   = { l:48, r:16, t:12, b:34 };

let curveMode = 'comp';

// Per-curve Y-axis scale (percentage of base F_MAX, 10–200)
const curveScaleVals = { compF: 100, rebF: 100, compR: 100, rebR: 100 };

function curveScaleKey() {
  return (curveMode === 'comp' ? 'comp' : 'reb') + (wheelMode === 'front' ? 'F' : 'R');
}

function getCurveScale() { return curveScaleVals[curveScaleKey()] / 100; }

function syncCurveScaleSlider() {
  const sl = document.getElementById('curve-scale');
  const lb = document.getElementById('lcurve-scale');
  if (sl) { sl.value = curveScaleVals[curveScaleKey()]; }
  if (lb) lb.textContent = curveScaleVals[curveScaleKey()] + '%';
}

document.getElementById('curve-scale').addEventListener('input', function() {
  curveScaleVals[curveScaleKey()] = +this.value;
  const lb = document.getElementById('lcurve-scale');
  if (lb) lb.textContent = this.value + '%';
  drawCurveEditor();
});

function resizeCurveCanvas() {
  cc.width  = cc.clientWidth;
  cc.height = cc.clientHeight || 220;
  drawCurveEditor();
}
window.addEventListener('resize', resizeCurveCanvas);

function ptToScreen(nx, ny) {
  const gw=cc.width-GP.l-GP.r, gh=cc.height-GP.t-GP.b;
  return { sx: GP.l+nx*gw, sy: GP.t+(1-ny)*gh };
}
function screenToPt(sx, sy) {
  const gw=cc.width-GP.l-GP.r, gh=cc.height-GP.t-GP.b;
  return { nx:(sx-GP.l)/gw, ny:1-(sy-GP.t)/gh };
}

function getActivePts() {
  if (wheelMode==='front') return curveMode==='comp' ? compPts_F : rebPts_F;
  return curveMode==='comp' ? compPts_R : rebPts_R;
}
function getActiveLUT() {
  if (wheelMode==='front') return curveMode==='comp' ? compLUT_F : rebLUT_F;
  return curveMode==='comp' ? compLUT_R : rebLUT_R;
}
function rebuildActiveLUT() {
  const pts = getActivePts();
  const lut = buildCurveLUT(pts);
  if (wheelMode==='front') {
    if (curveMode==='comp') compLUT_F=lut; else rebLUT_F=lut;
  } else {
    if (curveMode==='comp') compLUT_R=lut; else rebLUT_R=lut;
  }
}

function drawCurveEditor() {
  const W=cc.width, H=cc.height;
  if (!W||!H) return;
  const gw=W-GP.l-GP.r, gh=H-GP.t-GP.b;

  cctx.clearRect(0,0,W,H);
  cctx.fillStyle='#0f0f0f'; cctx.fillRect(0,0,W,H);
  cctx.fillStyle='#0a0a0a'; cctx.fillRect(GP.l,GP.t,gw,gh);

  // Grid
  cctx.strokeStyle='#1f1f1f'; cctx.lineWidth=1;
  for (let i=0; i<=4; i++) {
    cctx.beginPath(); cctx.moveTo(GP.l+(i/4)*gw, GP.t); cctx.lineTo(GP.l+(i/4)*gw, GP.t+gh); cctx.stroke();
    cctx.beginPath(); cctx.moveTo(GP.l, GP.t+(i/4)*gh); cctx.lineTo(GP.l+gw, GP.t+(i/4)*gh); cctx.stroke();
  }

  // X axis labels (0–3 m/s)
  cctx.fillStyle='#555'; cctx.font='10px sans-serif'; cctx.textAlign='center';
  for (let i=0; i<=4; i++) {
    cctx.fillText((i*V_MAX_SIM/4).toFixed(1), GP.l+(i/4)*gw, GP.t+gh+20);
  }
  cctx.fillStyle='#444'; cctx.fillText('m/s', GP.l+gw/2, GP.t+gh+30);

  // Y axis labels
  const F_MAX_LABEL = (curveMode === 'comp'
    ? (wheelMode === 'front' ? F_MAX_F_COMP : F_MAX_R_COMP)
    : (wheelMode === 'front' ? F_MAX_F_REB  : F_MAX_R_REB)) * getCurveScale();
  cctx.textAlign='right';
  for (let i=0; i<=4; i++) {
    cctx.fillStyle='#555';
    cctx.fillText(Math.round(i*F_MAX_LABEL/4)+'N', GP.l-4, GP.t+(1-i/4)*gh+4);
  }
  cctx.save();
  cctx.translate(10, GP.t+gh/2); cctx.rotate(-Math.PI/2);
  cctx.textAlign='center'; cctx.fillStyle='#444'; cctx.font='10px sans-serif';
  cctx.fillText('N', 0, 0);
  cctx.restore();

  // Draw both comp/reb curves for current wheel
  const pairs = [
    { ptsKey: wheelMode==='front'?'compPts_F':'compPts_R', mode:'comp', color:'#e11d48', label:'Comp' },
    { ptsKey: wheelMode==='front'?'rebPts_F':'rebPts_R',  mode:'reb',  color:'#aaaaaa', label:'Reb' }
  ];
  const ptsMap = { compPts_F, rebPts_F, compPts_R, rebPts_R };
  const lutMap = { compPts_F:compLUT_F, rebPts_F:rebLUT_F, compPts_R:compLUT_R, rebPts_R:rebLUT_R };

  pairs.forEach(({ ptsKey, mode, color, label }) => {
    const pts    = ptsMap[ptsKey];
    const lut    = lutMap[ptsKey];
    const active = mode===curveMode;
    cctx.globalAlpha = active ? 1.0 : 0.20;

    // Build a draw path that extends to the graph edges (x=0 and x=1) by
    // extrapolating past the first/last control points (clipped to the plot rect).
    const drawPts = [{ x:0, y:evalCurveLUT(lut,0) }];
    lut.forEach(p => { if (p.x>0 && p.x<1) drawPts.push(p); });
    drawPts.push({ x:1, y:evalCurveLUT(lut,1) });
    cctx.save();
    cctx.beginPath(); cctx.rect(GP.l, GP.t, gw, gh); cctx.clip();
    cctx.beginPath();
    drawPts.forEach((p,i) => {
      const s=ptToScreen(p.x,p.y);
      i===0 ? cctx.moveTo(s.sx,s.sy) : cctx.lineTo(s.sx,s.sy);
    });
    cctx.strokeStyle=color; cctx.lineWidth=active?2.5:1.5; cctx.stroke();
    cctx.restore();

    if (lut.length) {
      const last=ptToScreen(lut[lut.length-1].x, lut[lut.length-1].y);
      cctx.fillStyle=color; cctx.font='bold 9px sans-serif'; cctx.textAlign='left';
      cctx.fillText(label, last.sx+4, last.sy+4);
    }
    if (active) {
      pts.forEach((p,i) => {
        const s=ptToScreen(p.x,p.y);
        cctx.beginPath(); cctx.arc(s.sx,s.sy,7,0,Math.PI*2);
        cctx.fillStyle=i===0?'#222':color; cctx.fill();
        cctx.strokeStyle='#f0f0f0'; cctx.lineWidth=1.5; cctx.stroke();
      });
    }
    cctx.globalAlpha=1.0;
  });

  // Border
  cctx.strokeStyle='#1f1f1f'; cctx.lineWidth=1;
  cctx.strokeRect(GP.l, GP.t, gw, gh);
}

// Drag & click
let dragIdx=-1;

function getPos(e) {
  const r=cc.getBoundingClientRect();
  const cx=e.touches?e.touches[0].clientX:e.clientX;
  const cy=e.touches?e.touches[0].clientY:e.clientY;
  return { sx:(cx-r.left)*(cc.width/r.width), sy:(cy-r.top)*(cc.height/r.height) };
}

function findHit(sx, sy) {
  const pts=getActivePts();
  // Include endpoints (i=0 and last) so they can be dragged too.
  for (let i=0; i<pts.length; i++) {
    const s=ptToScreen(pts[i].x, pts[i].y);
    if (Math.hypot(s.sx-sx, s.sy-sy)<15) return i;
  }
  return -1;
}

function doDrag(sx, sy) {
  if (dragIdx<0) return;
  const pts=getActivePts();
  const {nx,ny}=screenToPt(sx,sy);
  const i=dragIdx;
  let newX;
  if (i===0)                  newX=Math.max(0, Math.min(pts[1].x-0.02, nx));
  else if (i===pts.length-1)  newX=Math.max(pts[i-1].x+0.02, Math.min(1, nx));
  else                        newX=Math.max(pts[i-1].x+0.02, Math.min(pts[i+1].x-0.02, nx));
  // Endpoints are now Y-movable too (no longer pinned to y=0 / the graph edges).
  const newY=Math.max(0, Math.min(1, ny));
  pts[i]={x:newX, y:newY};
  rebuildActiveLUT();
  drawCurveEditor();
}

cc.addEventListener('mousedown', e => {
  if (e.button!==0) return;
  const p=getPos(e);
  const hit=findHit(p.sx,p.sy);
  if (hit>=0) { dragIdx=hit; return; }
  const pts=getActivePts();
  const {nx,ny}=screenToPt(p.sx,p.sy);
  if (nx>0.02&&nx<0.98&&ny>=0&&ny<=1.02) {
    if (!pts.some(pt=>Math.abs(pt.x-nx)<0.05)) {
      pts.push({x:Math.max(0.02,Math.min(0.98,nx)), y:Math.max(0,Math.min(1,ny))});
      pts.sort((a,b)=>a.x-b.x);
      rebuildActiveLUT();
      drawCurveEditor();
    }
  }
});
cc.addEventListener('mousemove',  e=>{ const p=getPos(e); doDrag(p.sx,p.sy); });
cc.addEventListener('mouseup',    ()=>{ dragIdx=-1; });
cc.addEventListener('mouseleave', ()=>{ dragIdx=-1; });
cc.addEventListener('contextmenu', e=>{
  e.preventDefault();
  const p=getPos(e);
  const pts=getActivePts();
  if (pts.length<=3) return;
  const hit=findHit(p.sx,p.sy);
  if (hit>0 && hit<pts.length-1) { pts.splice(hit,1); rebuildActiveLUT(); drawCurveEditor(); }
});
cc.addEventListener('touchstart', e=>{ e.preventDefault(); const p=getPos(e); dragIdx=findHit(p.sx,p.sy); },{passive:false});
cc.addEventListener('touchmove',  e=>{ e.preventDefault(); const p=getPos(e); doDrag(p.sx,p.sy); },{passive:false});
cc.addEventListener('touchend',   ()=>{ dragIdx=-1; });

function setCurveMode(mode) {
  curveMode=mode;
  document.getElementById('btn-comp').classList.toggle('active', mode==='comp');
  document.getElementById('btn-reb').classList.toggle('active',  mode==='reb');
  syncCurveScaleSlider();
  drawCurveEditor();
}

function applyPreset(name) {
  const src=PRESETS[name];
  const pts=getActivePts();
  pts.length=0;
  src.forEach(p=>pts.push({...p}));
  rebuildActiveLUT();
  drawCurveEditor();
}



// ═══════════════════════════════════════════════════════════
//  CUSTOM TRACK BUILDER — editor (feature sequence + icon palette)
// ═══════════════════════════════════════════════════════════
const tcv = document.getElementById('terrain-canvas');
const tcx = tcv ? tcv.getContext('2d') : null;
const TGP = { l:8, r:8, t:10, b:6 };
let selFeature = -1;

// Palette: type, label, default params, and a stylized SVG icon (viewBox 0 0 36 26).
const FEATURE_PALETTE = [
  { type:'jump',     label:'Jump',      def:{len:5,   height:0.9},
    icon:'<path d="M3 23 L26 5 L26 23 Z" fill="#d6a93a"/>' },
  { type:'rhythm',   label:'Whoops',    def:{len:9,   height:0.28, count:5},
    icon:'<path d="M2 23 Q5 12 8 23 Q11 12 14 23 Q17 12 20 23 Q23 12 26 23 Q29 12 32 23 Z" fill="#d6a93a"/>' },
  { type:'table',    label:'Table',     def:{len:7,   height:1.0},
    icon:'<path d="M3 23 L11 7 L25 7 L33 23 Z" fill="#d6a93a"/>' },
  { type:'stepup',   label:'Step up',   def:{len:4,   height:0.6},
    icon:'<path d="M3 23 L3 16 L13 16 L13 8 L33 8 L33 23 Z" fill="#d6a93a"/>' },
  { type:'stepdown', label:'Step down', def:{len:4,   height:0.6},
    icon:'<path d="M3 8 L13 8 L13 16 L23 16 L23 23 L3 23 Z" fill="#d6a93a"/>' },
  { type:'wall',     label:'Wall',      def:{len:2.5, height:0.9},
    icon:'<path d="M2 23 L34 23" stroke="#d6a93a" stroke-width="2.5"/><rect x="14" y="4" width="8" height="19" fill="#c0392b"/>' },
  { type:'flat',     label:'Flat / gap',def:{len:6},
    icon:'<path d="M2 21 L34 21" stroke="#d6a93a" stroke-width="3"/>' },
];
const FEAT_ICON = {}; FEATURE_PALETTE.forEach(p => FEAT_ICON[p.type] = p.icon);

function resizeTerrainCanvas() {
  if (!tcv) return;
  tcv.width  = tcv.clientWidth;
  tcv.height = tcv.clientHeight || 150;
  drawTerrainEditor();
}
window.addEventListener('resize', resizeTerrainCanvas);

function drawTerrainEditor() {
  if (!tcv || !tcx) return;
  const W = tcv.width, H = tcv.height; if (!W || !H) return;
  const gw = W - TGP.l - TGP.r, gh = H - TGP.t - TGP.b;
  tcx.clearRect(0, 0, W, H);
  tcx.fillStyle = '#0b0f15'; tcx.fillRect(0, 0, W, H);

  const total = trackTotalLen || 1;
  let lo = 0, hi = 0;
  for (let i = 0; i <= 240; i++) { const y = customGroundAt(i / 240 * total); if (y < lo) lo = y; if (y > hi) hi = y; }
  for (const w of trackWalls) if (-w.top < lo) lo = -w.top;
  const pad = (hi - lo) * 0.15 + 0.3; lo -= pad; hi += pad; const rng = (hi - lo) || 1;
  const X = x => TGP.l + (x / total) * gw;
  const Y = y => TGP.t + ((y - lo) / rng) * gh;

  // selection highlight + segment dividers
  customTrack.forEach((f, i) => {
    const x0 = X(f._x0), x1 = X(f._x0 + f.len);
    if (i === selFeature) { tcx.fillStyle = 'rgba(225,29,72,0.13)'; tcx.fillRect(x0, TGP.t, x1 - x0, gh); }
    tcx.strokeStyle = '#181818'; tcx.lineWidth = 1;
    tcx.beginPath(); tcx.moveTo(x1, TGP.t); tcx.lineTo(x1, TGP.t + gh); tcx.stroke();
  });

  // ground fill + line
  const line = () => { tcx.beginPath();
    for (let px = 0; px <= gw; px += 2) { const y = customGroundAt(px / gw * total); const sx = TGP.l + px, sy = Y(y); px === 0 ? tcx.moveTo(sx, sy) : tcx.lineTo(sx, sy); } };
  line(); tcx.lineTo(TGP.l + gw, TGP.t + gh); tcx.lineTo(TGP.l, TGP.t + gh); tcx.closePath();
  tcx.fillStyle = 'rgba(139,105,20,0.5)'; tcx.fill();
  line(); tcx.strokeStyle = '#d6a93a'; tcx.lineWidth = 2; tcx.stroke();

  // walls as solid red blocks
  for (const w of trackWalls) { const bx = X(w.x0), bw = Math.max(2, X(w.x1) - X(w.x0)); const bt = Y(-w.top), bb = Y(0);
    tcx.fillStyle = '#c0392b'; tcx.fillRect(bx, bt, bw, bb - bt); }

  // labels
  tcx.font = '9px sans-serif'; tcx.textAlign = 'center'; tcx.textBaseline = 'top';
  customTrack.forEach((f, i) => { tcx.fillStyle = i === selFeature ? '#e11d48' : '#9a9a9a';
    tcx.fillText(f.type, X(f._x0 + f.len / 2), TGP.t + 2); });

  tcx.strokeStyle = '#1f1f1f'; tcx.lineWidth = 1; tcx.strokeRect(TGP.l, TGP.t, gw, gh);
}

if (tcv) {
  const popup = document.getElementById('feature-popup');
  const ctrls = document.getElementById('feature-controls');
  const elLen = document.getElementById('featlen'),   lLen = document.getElementById('lfeatlen');
  const elHei = document.getElementById('feathei'),   lHei = document.getElementById('lfeathei');
  const elCnt = document.getElementById('featcount'), lCnt = document.getElementById('lfeatcount');
  const typeLabel = document.getElementById('feat-type-label');
  const heiWrap = document.getElementById('feathei-wrap'), cntWrap = document.getElementById('featcount-wrap');

  function commit() { rebuildCustomTrack(); drawTerrainEditor(); if (typeof drawMinimap === 'function') drawMinimap(); }

  function syncControls() {
    const f = customTrack[selFeature];
    if (!f) { ctrls.classList.remove('show'); return; }
    ctrls.classList.add('show');
    typeLabel.textContent = f.type.toUpperCase();
    elLen.value = f.len; lLen.textContent = (+f.len).toFixed(f.len < 10 ? 1 : 0) + ' m';
    const hasH = f.type !== 'flat';
    heiWrap.style.display = hasH ? '' : 'none';
    if (hasH) { elHei.value = Math.round((f.height || 0) * 100); lHei.textContent = Math.round((f.height || 0) * 100) + ' cm'; }
    const hasC = f.type === 'rhythm';
    cntWrap.style.display = hasC ? '' : 'none';
    if (hasC) { elCnt.value = f.count || 5; lCnt.textContent = (f.count || 5); }
  }
  function selectFeature(i) { selFeature = i; syncControls(); drawTerrainEditor(); }

  // Build the Add-feature popup icons
  if (popup) {
    FEATURE_PALETTE.forEach(p => {
      const b = document.createElement('button');
      b.innerHTML = '<svg viewBox="0 0 36 26" aria-hidden="true">' + p.icon + '</svg><span>' + p.label + '</span>';
      b.addEventListener('click', () => {
        const f = Object.assign({ type: p.type }, p.def);
        const at = selFeature >= 0 ? selFeature + 1 : customTrack.length;
        customTrack.splice(at, 0, f);
        rebuildCustomTrack();
        popup.classList.remove('open');
        selectFeature(at);
        commit();
      });
      popup.appendChild(b);
    });
  }
  const addBtn = document.getElementById('btn-add-feature');
  if (addBtn) addBtn.addEventListener('click', e => { e.stopPropagation(); popup.classList.toggle('open'); });
  document.addEventListener('click', e => { if (popup && !popup.contains(e.target) && e.target !== addBtn) popup.classList.remove('open'); });

  // Per-feature sliders
  elLen.addEventListener('input', () => { const f = customTrack[selFeature]; if (!f) return; f.len = +elLen.value; lLen.textContent = (+f.len).toFixed(f.len < 10 ? 1 : 0) + ' m'; commit(); });
  elHei.addEventListener('input', () => { const f = customTrack[selFeature]; if (!f) return; f.height = (+elHei.value) / 100; lHei.textContent = elHei.value + ' cm'; commit(); });
  elCnt.addEventListener('input', () => { const f = customTrack[selFeature]; if (!f) return; f.count = +elCnt.value; lCnt.textContent = elCnt.value; commit(); });

  // Move / delete
  document.getElementById('btn-feat-left').addEventListener('click',  () => { if (selFeature > 0) { const t = customTrack; [t[selFeature-1], t[selFeature]] = [t[selFeature], t[selFeature-1]]; selFeature--; commit(); syncControls(); } });
  document.getElementById('btn-feat-right').addEventListener('click', () => { if (selFeature >= 0 && selFeature < customTrack.length-1) { const t = customTrack; [t[selFeature+1], t[selFeature]] = [t[selFeature], t[selFeature+1]]; selFeature++; commit(); syncControls(); } });
  document.getElementById('btn-feat-del').addEventListener('click',   () => { if (selFeature >= 0 && customTrack.length > 1) { customTrack.splice(selFeature, 1); selFeature = Math.min(selFeature, customTrack.length-1); commit(); syncControls(); } });

  // Canvas: click a feature to select it
  tcv.addEventListener('click', e => {
    const r = tcv.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (tcv.width / r.width);
    const gw = tcv.width - TGP.l - TGP.r;
    const x = Math.max(0, Math.min(1, (sx - TGP.l) / gw)) * (trackTotalLen || 1);
    for (let i = 0; i < customTrack.length; i++) { const f = customTrack[i]; if (x >= f._x0 && x < f._x0 + f.len) { selectFeature(i); return; } }
  });
}
