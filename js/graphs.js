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

