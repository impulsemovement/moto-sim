'use strict';
// ═══════════════════════════════════════════════════════════
//  (split from core.js — see CLAUDE.md ownership map; classic global scope,
//   loaded in original order so top-level execution is unchanged)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  TERRAIN  (SI — returns meters, positive Y = down)
// ═══════════════════════════════════════════════════════════
function groundY_m(wx_m) {
  const amp  = P.amp;
  const freq = P.freq;
  // Quadratic scaling: gentle at low %, progressively larger toward 100%
  // (0→3mm at 25%, ~15mm at 50%, ~34mm at 75%, 60mm at 100%)
  const noise = P.rough>0 ? valueNoise(wx_m*5)*0.06*P.rough*P.rough : 0;
  switch (P.terrain) {
    case 0: // Bumps
      return Math.sin(wx_m*Math.PI*freq)*0.08*amp
           + Math.sin(wx_m*Math.PI*2*freq)*0.03*amp + noise;
    case 1: { // Whoops
      const wl = 1.5/freq;
      const ph = (((wx_m%wl)+wl)%wl)/wl;
      return (ph<0.5 ? Math.sin(ph*Math.PI*2)*0.18*amp : 0) + noise;
    }
    case 2: { // Step drop with duty cycle
      const cycle   = 6.0;          // m
      const dropH   = 0.15*amp;
      const edgeW   = Math.max(0.05, 0.3/freq);
      const zone    = (((wx_m%cycle)+cycle)%cycle);
      const dStart  = 2.0;
      const dEnd    = dStart+edgeW;
      const downLen = P.duty*(cycle-dEnd);
      const rStart  = dEnd+downLen;
      const rEnd    = rStart+edgeW;
      let t=0;
      if (zone>=dStart && zone<dEnd)       { t=(zone-dStart)/edgeW; t=(1-Math.cos(t*Math.PI))/2; }
      else if (zone>=dEnd && zone<rStart)   { t=1; }
      else if (zone>=rStart && zone<rEnd)   { t=(zone-rStart)/edgeW; t=(1+Math.cos(t*Math.PI))/2; }
      return t*dropH + noise;
    }
    case 3: { // Kicker — a launch RAMP: steep takeoff face that ends at a lip (kicks you airborne),
              // then a long flat landing/run-up before the next one. Distinct from the rounded whoops.
      const cycle = 11.0/freq;
      const zone  = (((wx_m%cycle)+cycle)%cycle);
      const rampW = 2.4;                 // m, length of the launch face
      if (zone < rampW) {
        const rt = zone / rampW;         // 0 at base → 1 at the lip
        return -(rt*rt)*0.42*amp + noise; // quadratic ramp up (up = negative Y); abrupt lip at the top
      }
      return noise;                       // flat run between kickers
    }
    case 4: { // Rollers — big SMOOTH rolling hills (pump-track), long wavelength, gentle faces
      const wl = 7.0/freq;
      return Math.sin(wx_m/wl*Math.PI*2)*0.35*amp + noise;
    }
    case 5: { // Mountain Pass — sustained CLIMBS & DESCENTS gaining/losing hundreds of feet. A few
              // layered long sines so the grade varies (a climb, a crest, a descent) rather than one
              // repeating hill. ELEV amplitude scales with the Amplitude slider; gentle road texture.
              // (Crank Amplitude up for a bigger pass; grade stays rideable at long wavelengths.)
      const ELEV = 30 * amp;             // m of elevation swing per layer (amp 1 → ~45 m total ≈ 150 ft)
      const k    = 0.0065 * freq;        // long spatial frequency (≈ 1 km wavelength at freq 1)
      const elev = -(ELEV * Math.sin(wx_m * k) + 0.5 * ELEV * Math.sin(wx_m * k * 0.37 + 1.3));
      const road = Math.sin(wx_m * 0.11 * freq) * 0.04 * amp;  // smooth long-wavelength pavement sway
      return elev + road + noise;                              // (short bumps would launch the bike)
    }
    case 6: // Flat — gentle long-wavelength
      return Math.sin(wx_m*0.5*freq)*0.025*amp + noise;
    case 7: // Custom — the composed feature track (Track Builder), looped.
            // Noise is suppressed under solid walls so their colliders stay on the datum they
            // were measured from (see customNoiseScaleAt).
      return customGroundAt(wx_m) + (noise !== 0 ? noise * customNoiseScaleAt(wx_m) : 0);
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════
//  WHEEL GROUND CONTACT  (world position in meters)
// ═══════════════════════════════════════════════════════════
const WHEEL_STEPS = 24;

function calcNaturalWY_m(wx_m, r_m) {
  // Find the highest wheel-centre Y (most restrictive = smallest Y value in Y-down coords)
  // such that the wheel circle is tangent to or above the terrain at every point.
  // For each horizontal sample dx, the wheel centre must satisfy:
  //   centre_Y ≤ groundY(wx+dx) - sqrt(r²-dx²)
  // The minimum of all these upper bounds is the equilibrium centre height.
  let wy = Infinity;
  for (let i=0; i<=WHEEL_STEPS; i++) {
    const dx  = ((i/WHEEL_STEPS)-0.5)*2*r_m;
    const cl  = Math.sqrt(Math.max(0, r_m*r_m - dx*dx));
    const gnd = groundY_m(wx_m+dx);
    wy = Math.min(wy, gnd - cl);
  }
  return wy;
}

