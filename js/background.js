'use strict';
// ═══════════════════════════════════════════════════════════
//  ARIZONA PARALLAX BACKGROUND
// ═══════════════════════════════════════════════════════════

let bgGroundY_m = 0;   // smoothed terrain elevation under the bike — anchors the background horizon
                       // to the REAL ground so big jumps don't tear (horizon stays with the ground)

// Deterministic hash (slot index n → 0..1 float)
function bgH(n, sub) {
  let h = Math.imul((n * 2654435761 + (sub||0) * 2246822519) | 0, 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Draw a saguaro cactus — classic tall Arizona cactus with 1–2 arms
function drawSaguaro(cx, baseY, h) {
  const tw = h * 0.19;         // trunk half-width
  const armH1 = h * 0.42;     // first arm branch height
  const armH2 = h * 0.55;
  const armLen = h * 0.38;
  const aw = tw * 0.72;

  // helper: rounded-top capsule column
  function column(x, y0, width, height, col) {
    const r = width / 2;
    ctx.beginPath();
    ctx.moveTo(x - r, y0);
    ctx.lineTo(x - r, y0 - height + r);
    ctx.arc(x, y0 - height + r, r, Math.PI, 0, false);
    ctx.lineTo(x + r, y0);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
  }

  // Left arm (curves up then vertical)
  const lax = cx - tw * 0.6 - armLen;
  ctx.beginPath();
  ctx.moveTo(cx - tw * 0.5, baseY - armH1 + aw);
  ctx.lineTo(cx - tw * 0.5, baseY - armH1);
  ctx.quadraticCurveTo(cx - tw * 0.5, baseY - armH1 - aw * 1.5, lax + aw, baseY - armH1 - aw * 1.0);
  ctx.lineTo(lax + aw * 0.8, baseY - armH1 - armLen);
  ctx.arc(lax, baseY - armH1 - armLen, aw * 0.8, 0, Math.PI, true);
  ctx.lineTo(lax - aw * 0.8, baseY - armH1 - aw * 0.4);
  ctx.quadraticCurveTo(cx - tw * 0.8, baseY - armH1 + aw, cx - tw * 0.5, baseY - armH1 + aw);
  ctx.fillStyle = '#3a7a1e'; ctx.fill();

  // Right arm
  const rax = cx + tw * 0.6 + armLen * 0.9;
  ctx.beginPath();
  ctx.moveTo(cx + tw * 0.5, baseY - armH2 + aw);
  ctx.lineTo(cx + tw * 0.5, baseY - armH2);
  ctx.quadraticCurveTo(cx + tw * 0.5, baseY - armH2 - aw * 1.2, rax - aw, baseY - armH2 - aw);
  ctx.lineTo(rax - aw * 0.8, baseY - armH2 - armLen * 0.85);
  ctx.arc(rax, baseY - armH2 - armLen * 0.85, aw * 0.8, Math.PI, 0, true);
  ctx.lineTo(rax + aw * 0.8, baseY - armH2 + aw * 0.4);
  ctx.quadraticCurveTo(cx + tw * 0.8, baseY - armH2 + aw, cx + tw * 0.5, baseY - armH2 + aw);
  ctx.fillStyle = '#3a7a1e'; ctx.fill();

  // Main trunk
  column(cx, baseY, tw * 2, h, '#3a7a1e');

  // Highlight stripe
  column(cx - tw * 0.15, baseY, tw * 0.5, h * 0.95, '#4d9428');

  // Spine dots
  ctx.fillStyle = '#1e4a0a';
  for (let i = 0; i < 6; i++) {
    const sy = baseY - h * (0.15 + i * 0.13);
    ctx.beginPath(); ctx.arc(cx - tw * 0.5, sy, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + tw * 0.5, sy, 1.2, 0, Math.PI * 2); ctx.fill();
  }
}

// Prickly pear — stacked oval pads
function drawPricklyPear(cx, baseY, scale) {
  const S = scale;
  function pad(px, py, w, h, angle) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3d8a1a'; ctx.fill();
    ctx.strokeStyle = '#2a5a12'; ctx.lineWidth = 0.8; ctx.stroke();
    // Areoles (dots)
    ctx.fillStyle = '#c8d830';
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;
      ctx.beginPath(); ctx.arc(i * w * 0.3, j * h * 0.3, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  pad(cx,           baseY - S * 18, S * 18, S * 22, 0.1);
  pad(cx - S * 16,  baseY - S * 28, S * 16, S * 20, -0.5);
  pad(cx + S * 16,  baseY - S * 26, S * 16, S * 20, 0.5);
  pad(cx - S * 8,   baseY - S * 44, S * 14, S * 18, -0.2);
  pad(cx + S * 12,  baseY - S * 42, S * 14, S * 18, 0.3);
  pad(cx,           baseY - S * 58, S * 13, S * 16, 0.0);
}

// Barrel cactus — round ribbed ball
function drawBarrel(cx, baseY, r) {
  // Base globe
  ctx.beginPath();
  ctx.arc(cx, baseY - r, r, 0, Math.PI * 2);
  ctx.fillStyle = '#3a7a20'; ctx.fill();
  // Ribs (radial lines)
  ctx.strokeStyle = '#2a5a14'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, baseY - r);
    ctx.lineTo(cx + Math.cos(a) * r, baseY - r + Math.sin(a) * r);
    ctx.stroke();
  }
  // Yellow spines at top
  ctx.fillStyle = '#d4c040';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 0.85, baseY - r + Math.sin(a) * r * 0.85, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Agave — rosette of thick pointed leaves
function drawAgave(cx, baseY, scale) {
  const S = scale;
  ctx.fillStyle = '#2e6a3a';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 - Math.PI * 0.5;
    const lx = cx + Math.cos(a) * S * 28;
    const ly = baseY - Math.abs(Math.sin(a)) * S * 12 - S * 4;
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.rotate(a + Math.PI * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-S * 5, -S * 12, -S * 4, -S * 26, 0, -S * 32);
    ctx.bezierCurveTo(S * 4, -S * 26, S * 5, -S * 12, 0, 0);
    ctx.fillStyle = i % 2 === 0 ? '#3d8040' : '#2e6a34';
    ctx.fill();
    ctx.restore();
  }
  // Center bud
  ctx.beginPath(); ctx.arc(cx, baseY - S * 4, S * 4, 0, Math.PI * 2);
  ctx.fillStyle = '#4a9040'; ctx.fill();
}

// Ocotillo — cluster of tall thin spiky stalks with red tips
function drawOcotillo(cx, baseY, h) {
  const count = 5 + Math.round(bgH(cx | 0, 99) * 3);
  for (let i = 0; i < count; i++) {
    const off = (i - count / 2) * h * 0.08;
    const tilt = (bgH(i, 3) - 0.5) * 0.4;
    const ht = h * (0.7 + bgH(i, 7) * 0.4);
    ctx.beginPath();
    ctx.moveTo(cx + off, baseY);
    ctx.quadraticCurveTo(cx + off + Math.sin(tilt) * ht * 0.3, baseY - ht * 0.5,
                         cx + off + Math.sin(tilt) * ht * 0.6, baseY - ht);
    ctx.strokeStyle = '#3a6020'; ctx.lineWidth = 2.5; ctx.stroke();
    // Red flower tip
    ctx.beginPath();
    ctx.arc(cx + off + Math.sin(tilt) * ht * 0.6, baseY - ht - 4, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#c0301a'; ctx.fill();
  }
}

// Desert shrub / creosote bush
function drawShrub(cx, baseY, r) {
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const br = r * (0.6 + bgH(i, 11) * 0.5);
    const bx = cx + Math.cos(a) * br;
    const by = baseY - Math.abs(Math.sin(a)) * r * 0.6 - r * 0.2;
    i === 0 ? ctx.moveTo(bx, by) : ctx.lineTo(bx, by);
  }
  ctx.closePath();
  ctx.fillStyle = '#5a8040'; ctx.fill();
}

// ── Small desert rock (deterministic faceted boulder) ───────
function drawRock(cx, baseY, r) {
  ctx.beginPath();
  ctx.moveTo(cx - r, baseY);
  ctx.lineTo(cx - r * 0.72, baseY - r * 0.82);
  ctx.lineTo(cx - r * 0.10, baseY - r * 1.05);
  ctx.lineTo(cx + r * 0.62, baseY - r * 0.72);
  ctx.lineTo(cx + r,        baseY);
  ctx.closePath();
  ctx.fillStyle = '#6b6258'; ctx.fill();                 // shaded body
  ctx.beginPath();                                        // lit top facet
  ctx.moveTo(cx - r * 0.10, baseY - r * 1.05);
  ctx.lineTo(cx + r * 0.62, baseY - r * 0.72);
  ctx.lineTo(cx + r * 0.18, baseY - r * 0.55);
  ctx.closePath();
  ctx.fillStyle = '#857c70'; ctx.fill();
}

// ── Mesa / butte formation ──────────────────────────────────
// n = stable slot index used for deterministic shape (NOT screen X)
function drawMesa(n, x, baseY, w, h, col1, col2) {
  const topW = w * (0.25 + bgH(n, 1) * 0.35);
  const lx = x - topW / 2;
  const rx = x + topW / 2;
  // Build jagged silhouette
  const pts = [];
  pts.push([x - w / 2, baseY]);
  // left climbing wall
  const steps = 4 + Math.floor(bgH(n, 2) * 3);
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / (steps + 1);
    const ix = x - w / 2 + t * (x - topW / 2 - (x - w / 2));
    const iy = baseY - t * h + (bgH(n, i + 10) - 0.5) * h * 0.12;
    pts.push([ix, iy]);
  }
  // top — flat with slight notch variation
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push([lx + t * topW, baseY - h + (bgH(n, i + 20) - 0.5) * h * 0.04]);
  }
  // right descending wall
  for (let i = steps - 1; i >= 0; i--) {
    const t = (i + 1) / (steps + 1);
    const ix = x + topW / 2 + t * (w / 2 - topW / 2);
    const iy = baseY - t * h + (bgH(n, i + 30) - 0.5) * h * 0.12;
    pts.push([ix, iy]);
  }
  pts.push([x + w / 2, baseY]);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = col1; ctx.fill();
  // lit face (right side highlight)
  ctx.beginPath();
  ctx.moveTo(rx, baseY - h);
  ctx.lineTo(x + w / 2, baseY);
  ctx.lineTo(rx, baseY);
  ctx.closePath();
  ctx.fillStyle = col2; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
}

// ── Far purple mountain silhouette (tiling polygon band) ──
function drawFarMountains(W, H, horizY, scrollOff) {
  const tileW = W * 2.5;
  const tileOff = ((scrollOff % tileW) + tileW) % tileW;

  for (let t = -1; t <= 1; t++) {
    const ox = t * tileW - tileOff;
    const pts = [
      [0, horizY], [0.05, 0.72], [0.12, 0.60], [0.18, 0.70],
      [0.25, 0.52], [0.30, 0.65], [0.38, 0.45], [0.44, 0.60],
      [0.52, 0.48], [0.58, 0.58], [0.65, 0.42], [0.72, 0.56],
      [0.80, 0.50], [0.85, 0.62], [0.92, 0.47], [0.97, 0.60],
      [1.0, horizY]
    ].map(([tx, ty]) => [ox + tx * tileW, ty < 1 ? ty * horizY : ty]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(ox + tileW, horizY); ctx.lineTo(ox, horizY); ctx.closePath();
    const g = ctx.createLinearGradient(0, horizY * 0.45, 0, horizY);
    g.addColorStop(0, '#7068a8'); g.addColorStop(1, '#9080b0');
    ctx.fillStyle = g; ctx.fill();
  }
}

// ── Main draw function ──────────────────────────────────────
function drawParallaxBackground(W, H) {
  // Anchor the horizon to the REAL ground under the bike (smoothed), projected through the camera.
  // Normal riding: ≈ groundBaseY. Big jump: the camera rises with the bike, so the ground (and the
  // whole desert scene) slides DOWN and stays connected to the dirt — no gap/tear, and you see the
  // ground rushing below you. Mountain pass: tracks the climb. Smoothed so bumps don't jitter it.
  const bikeGround = (typeof groundY_m === 'function') ? groundY_m(worldX_m - A_FRONT_M) : 0;
  bgGroundY_m += (bikeGround - bgGroundY_m) * 0.12;
  const horizY = (typeof screenY === 'function') ? screenY(bgGroundY_m) : groundBaseY;
  const comX = COM_SX();

  // Scene-element scale = world scale × zoom response. The world scale (PM_base 100 mobile /
  // 200 desktop) makes the scenery shrink WITH the bike on a small canvas; without it the
  // cacti/mesas stayed full-size and looked oversized next to the half-scale bike. The zoom
  // response is full for foreground and damped for distant/mesas to give parallax depth.
  const base = PM_base / 200;             // 0.5 on mobile, 1.0 on desktop
  const zoom = PM / PM_base;              // user-zoom factor (1.0 by default)
  const pz  = base * zoom;                // foreground plants  (full zoom scale)
  const pzD = base * Math.sqrt(zoom);     // distant plants     (half-power zoom)
  const pzM = base * Math.pow(zoom, 0.25);// mesas              (gentle zoom)

  // Pan offset in screen pixels — applied uniformly to all layers (camera pan + accel look-ahead)
  const panPx = (camPanX_m + (typeof camLeadX_m === 'number' ? camLeadX_m : 0)) * PM;

  // Helper: world slot → screen X, accounting for parallax speed and camera pan
  function slotScreenX(slot, spacing, speed) {
    return (comX - panPx) + (slot * spacing - worldX_m * speed) * PM;
  }
  // Helper: iterate slots that are currently on screen
  function eachSlot(spacing, speed, margin, fn) {
    // Pan shifts the visible window in layer-coordinate space
    const worldLeft  = worldX_m * speed - (comX + margin - panPx) / PM;
    const worldRight = worldX_m * speed + (W - comX + margin + panPx) / PM;
    const n0 = Math.floor(worldLeft / spacing);
    const n1 = Math.ceil(worldRight / spacing);
    for (let n = n0; n <= n1; n++) fn(n, slotScreenX(n, spacing, speed));
  }

  // ── Sky gradient ─────────────────────────────────────────
  const skyG = ctx.createLinearGradient(0, 0, 0, horizY);
  skyG.addColorStop(0,   '#1a5fa0');
  skyG.addColorStop(0.5, '#4a9fd4');
  skyG.addColorStop(1,   '#aad8f0');
  ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, horizY);
  // Fill EVERYTHING below the horizon with a sand base, so on big jumps (horizon high above the
  // dirt line) there's never an unpainted/torn band — the real dirt is drawn on top by render.js.
  if (horizY < H) { ctx.fillStyle = '#a88048'; ctx.fillRect(0, horizY, W, H - horizY); }

  // ── Clouds (speed 0.025) ─────────────────────────────────
  function drawCloud(cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.9, cy - r * 0.2, r * 0.8, 0, Math.PI * 2);
    ctx.arc(cx - r * 0.7, cy - r * 0.1, r * 0.75, 0, Math.PI * 2);
    ctx.arc(cx + r * 1.7, cy + r * 0.1, r * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fill();
  }
  eachSlot(3.0, 0.025, 2.5, (n, sx) => {
    const cy = horizY * (0.15 + bgH(n, 5) * 0.30);
    const r  = (18 + bgH(n, 6) * 28) * pzD;
    drawCloud(sx + bgH(n, 7) * 40, cy, r);
  });

  // ── Far purple mountains — use PM_base scroll so zoom doesn't jump position ──
  drawFarMountains(W, H, horizY, worldX_m * 0.05 * PM_base + panPx);

  // ── Distant red-rock mesas (speed 0.10) — size scales gently with zoom ───────
  eachSlot(4.0, 0.10, 3.0, (n, sx) => {
    const w = (160 + bgH(n, 1) * 140) * pzM;
    const h = horizY * (0.18 + bgH(n, 2) * 0.20);
    const by = horizY + 5;
    drawMesa(n, sx + bgH(n, 8) * 60, by, w, h, '#7a4028', '#a05835');
  });

  // ── Mid red-rock mesas (speed 0.17) ──────────────────────
  eachSlot(5.0, 0.17, 3.0, (n, sx) => {
    const w = (180 + bgH(n, 3) * 200) * pzM;
    const h = horizY * (0.28 + bgH(n, 4) * 0.28);
    const by = horizY + 8;
    drawMesa(n, sx + bgH(n, 9) * 70, by, w, h, '#9a4828', '#c86038');
  });

  // ── Sandy desert mid-ground strip ────────────────────────
  const dg = ctx.createLinearGradient(0, horizY * 0.88, 0, horizY + 20);
  dg.addColorStop(0, '#c8a060'); dg.addColorStop(1, '#a88048');
  ctx.fillStyle = dg; ctx.fillRect(0, horizY * 0.88, W, horizY * 0.15);

  // ── Distant small plants (speed 0.25) — scale at √zoom ───
  eachSlot(0.7, 0.25, 1.0, (n, sx) => {
    const by = horizY;
    const type = bgH(n, 16) < 0.5 ? 'shrub' : 'small-saguaro';
    ctx.save(); ctx.globalAlpha = 0.55;
    if (type === 'shrub') {
      drawShrub(sx, by, (10 + bgH(n, 17) * 10) * pzD);
    } else {
      drawSaguaro(sx, by, (28 + bgH(n, 18) * 20) * pzD);
    }
    ctx.restore();
  });

  // ── Foreground plants (speed 0.42) — scale with zoom like bike ───
  eachSlot(1.2, 0.42, 1.5, (n, sx) => {
    const by = horizY;
    const roll = bgH(n, 20);
    if (roll < 0.28) {
      drawSaguaro(sx, by, (60 + bgH(n, 21) * 50) * pz);
    } else if (roll < 0.50) {
      drawPricklyPear(sx, by, (1.2 + bgH(n, 22) * 0.8) * pz);
    } else if (roll < 0.65) {
      drawAgave(sx, by, (1.0 + bgH(n, 23) * 0.6) * pz);
    } else if (roll < 0.78) {
      drawBarrel(sx, by, (14 + bgH(n, 24) * 12) * pz);
    } else {
      drawShrub(sx, by, (18 + bgH(n, 26) * 14) * pz);
    }
  });

  // ── Near foreground: small rocks & bushes (speed 0.6) — the CLOSEST layer, reads as the ground
  // rushing by; the extra depth is especially visible on big jumps when more ground is in frame. ──
  eachSlot(0.9, 0.6, 1.6, (n, sx) => {
    const by = horizY;
    const roll = bgH(n, 30);
    if (roll < 0.42) {
      drawRock(sx, by, (10 + bgH(n, 31) * 14) * pz);
    } else if (roll < 0.78) {
      drawShrub(sx, by, (12 + bgH(n, 32) * 12) * pz);
    } else {
      drawRock(sx, by, (5 + bgH(n, 33) * 5) * pz);          // small pebble
    }
  });

}


