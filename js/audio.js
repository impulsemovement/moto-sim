'use strict';
// ═══════════════════════════════════════════════════════════
//  ENGINE SOUND  (Web Audio — pitch tracks RPM so you can hear the rev range)
// ═══════════════════════════════════════════════════════════
// A raspy parallel-twin note rather than a pure tone:
//  • two detuned oscillators on a custom harmonic profile, run through a WAVESHAPER (soft-clip
//    distortion) for harmonic grit/rasp;
//  • a SUB-octave sine for low-end body;
//  • a NOISE layer through a rev-tracking band-pass — the broadband combustion "rasp"/air that
//    stops it sounding like a clean sine from a tin can;
//  • a low-pass that opens with revs/throttle (kept fairly low so it growls, never whines).
// Pitch rises with engineRPM; volume = idle hum + throttle, dipping hard while the rev limiter
// cuts fuel. Built on the first user gesture (autoplay policy).

let audioCtx = null, engGain = null, engLPF = null;
let oscA = null, oscB = null, oscSub = null, subGain = null;
let shaper = null, noiseSrc = null, noiseBP = null, noiseGain = null;
let slipNoiseSrc = null, slipBP = null, slipGain = null;   // tire-slip (lockup/spin) sound
let lopeOsc = null, lopeGain = null;                       // idle-lope LFO (270° twin lumpy idle)
let soundMuted = false;
try { soundMuted = (localStorage.getItem('motosim-muted') === '1'); } catch (e) {}

function makeNoiseBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function makeDriveCurve(amount) {
  const n = 1024, curve = new Float32Array(n), k = amount;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); }
  return curve;
}

function initAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { audioCtx = new AC(); } catch (e) { return; }

  engGain = audioCtx.createGain(); engGain.gain.value = 0;
  engLPF  = audioCtx.createBiquadFilter(); engLPF.type = 'lowpass'; engLPF.frequency.value = 500; engLPF.Q.value = 0.6;
  engLPF.connect(engGain); engGain.connect(audioCtx.destination);

  // Oscillator pair → waveshaper (grit) → filter.
  const real = new Float32Array([0, 1.0, 0.8, 0.6, 0.42, 0.28, 0.18, 0.11, 0.06]);
  const engWave = audioCtx.createPeriodicWave(real, new Float32Array(real.length));
  shaper = audioCtx.createWaveShaper(); shaper.curve = makeDriveCurve(2.4); shaper.oversample = '2x';
  shaper.connect(engLPF);
  oscA = audioCtx.createOscillator(); oscA.setPeriodicWave(engWave);
  oscB = audioCtx.createOscillator(); oscB.setPeriodicWave(engWave); oscB.detune.value = -13;
  oscA.frequency.value = 70; oscB.frequency.value = 70;
  oscA.connect(shaper); oscB.connect(shaper);

  // Sub-octave sine for body (clean, straight to the filter).
  oscSub = audioCtx.createOscillator(); oscSub.type = 'sine'; oscSub.frequency.value = 35;
  subGain = audioCtx.createGain(); subGain.gain.value = 0.5;
  oscSub.connect(subGain); subGain.connect(engLPF);

  // Noise rasp — broadband grit through a rev-tracking band-pass.
  noiseSrc = audioCtx.createBufferSource(); noiseSrc.buffer = makeNoiseBuffer(audioCtx); noiseSrc.loop = true;
  noiseBP = audioCtx.createBiquadFilter(); noiseBP.type = 'bandpass'; noiseBP.frequency.value = 220; noiseBP.Q.value = 1.2;
  noiseGain = audioCtx.createGain(); noiseGain.gain.value = 0;
  noiseSrc.connect(noiseBP); noiseBP.connect(noiseGain); noiseGain.connect(engGain);

  // Tire-slip layer — looping noise through a band-pass we retune per surface (asphalt screech
  // vs dirt scrabble). Gain is driven by how hard the tire is sliding (lockup or wheelspin).
  slipNoiseSrc = audioCtx.createBufferSource(); slipNoiseSrc.buffer = makeNoiseBuffer(audioCtx); slipNoiseSrc.loop = true;
  slipBP = audioCtx.createBiquadFilter(); slipBP.type = 'bandpass'; slipBP.frequency.value = 500; slipBP.Q.value = 1;
  slipGain = audioCtx.createGain(); slipGain.gain.value = 0;
  slipNoiseSrc.connect(slipBP); slipBP.connect(slipGain); slipGain.connect(audioCtx.destination);

  // Idle lope — a 270° parallel twin idles with a lumpy, uneven beat (the two cylinders
  // fire 270°/450° apart). An LFO riding on the engine gain wobbles the volume; the wobble
  // frequency tracks the firing rate and the DEPTH fades out with revs and throttle (a
  // pulled-up engine smooths out), set per-frame in updateEngineSound.
  lopeOsc  = audioCtx.createOscillator(); lopeOsc.type = 'sine'; lopeOsc.frequency.value = 12;
  lopeGain = audioCtx.createGain(); lopeGain.gain.value = 0;
  lopeOsc.connect(lopeGain); lopeGain.connect(engGain.gain);

  oscA.start(); oscB.start(); oscSub.start(); noiseSrc.start(); slipNoiseSrc.start(); lopeOsc.start();
}

// Tire-slip sound. slipV = contact slip speed (m/s); grip = the tire-grip slider (0..1+).
// Two distinct timbres: ≥65% grip → a high, tonal asphalt SCREECH (very tight band-pass); below
// that → a low, broadband DIRT/gravel scrabble. Volume ramps in above a small slip threshold.
function updateTireSound(slipV, grip) {
  if (!audioCtx || !slipGain) return;
  const t = audioCtx.currentTime;
  const dirt = grip < 0.65;
  if (dirt) { slipBP.frequency.setTargetAtTime(340, t, 0.05); slipBP.Q.setTargetAtTime(1.1, t, 0.05); }
  else      { slipBP.frequency.setTargetAtTime(1750 + Math.min(slipV, 12) * 30, t, 0.04); slipBP.Q.setTargetAtTime(14, t, 0.05); }
  let vol = Math.max(0, Math.min(1, (slipV - 1.5) / 7));   // fade in past ~1.5 m/s slip
  vol *= dirt ? 0.40 : 0.34;   // ~2× louder than before
  slipGain.gain.setTargetAtTime(soundMuted ? 0 : vol, t, 0.05);
}

// One-shot deep mechanical clatter when the engine stalls (engine dies + descending thud).
function playStallClatter() {
  if (!audioCtx || soundMuted) return;
  const t = audioCtx.currentTime;
  const src = audioCtx.createBufferSource(); src.buffer = makeNoiseBuffer(audioCtx);
  const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 4;
  const g  = audioCtx.createGain(); g.gain.setValueAtTime(0.0001, t);
  src.connect(lp); lp.connect(g); g.connect(audioCtx.destination);
  // lumpy "clack-clack-clk" decay
  [[0.01,0.55],[0.06,0.12],[0.10,0.42],[0.16,0.08],[0.21,0.26],[0.30,0.05],[0.42,0.0001]]
    .forEach(([dt,v]) => g.gain.linearRampToValueAtTime(v, t + dt));
  // low descending thud underneath (the crank dying)
  const osc = audioCtx.createOscillator(); osc.type = 'triangle';
  osc.frequency.setValueAtTime(95, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.42);
  const og = audioCtx.createGain(); og.gain.setValueAtTime(0.0001, t);
  og.gain.linearRampToValueAtTime(0.32, t + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  osc.connect(og); og.connect(audioCtx.destination);
  src.start(t); src.stop(t + 0.45); osc.start(t); osc.stop(t + 0.46);
}

// Called every frame with the live engine rpm and throttle (0..1).
function updateEngineSound(rpm, throttle) {
  if (!audioCtx || !oscA) return;
  const t = audioCtx.currentTime;
  // Fuel state from the physics globals: the limiter and the gear-shift torque cut both
  // kill combustion (heard as the rev-limiter "brap" and the upshift "vvv-RIP-vum"), and a
  // stalled engine makes no throttle noise at all — the player may still be holding gas.
  const running  = (typeof engineRunning === 'undefined') || engineRunning;
  const shifting = (typeof shiftTimer !== 'undefined' && shiftTimer > 0);
  const cutting  = (typeof revLimiterCut !== 'undefined' && revLimiterCut);
  const load     = (running && !shifting && !cutting) ? throttle : 0;
  const f = 30 + (rpm / 60) * 1.62;                 // ~70 Hz idle → ~300 Hz redline
  oscA.frequency.setTargetAtTime(f, t, 0.03);
  oscB.frequency.setTargetAtTime(f, t, 0.03);
  oscSub.frequency.setTargetAtTime(f * 0.5, t, 0.03);
  // Brightness opens with revs + LOAD (kept low so it growls, not whines); the shift cut
  // closes it like a throttle chop even though the player's gas is still pinned.
  engLPF.frequency.setTargetAtTime(250 + (rpm / 10800) * 1000 + load * 500, t, 0.05);
  // Noise rasp tracks the revs and grows with load.
  noiseBP.frequency.setTargetAtTime(f * 2.2, t, 0.04);
  noiseGain.gain.setTargetAtTime((0.018 + load * 0.05 + (rpm / 10800) * 0.03), t, 0.05);
  // Off-throttle decel burble: unburnt mixture popping in the exhaust. Brief random noise
  // spikes, more likely at higher revs; the per-frame base retarget above settles each one.
  if (running && load < 0.08 && rpm > 4200 && Math.random() < 0.08 + (rpm / 10800) * 0.12) {
    noiseGain.gain.setTargetAtTime(0.09 + Math.random() * 0.09, t, 0.008);
  }
  // Idle lope: wobble frequency ≈ per-cylinder firing rate (every other rev), depth dies
  // out by ~2700 RPM and under load — a revving/pulling twin smooths right out.
  if (lopeOsc) {
    lopeOsc.frequency.setTargetAtTime(Math.max(6, (rpm / 60) * 0.5), t, 0.05);
    const lopeDepth = Math.max(0, 1 - (rpm - 1500) / 1200) * (1 - Math.min(1, load * 3));
    lopeGain.gain.setTargetAtTime(soundMuted || !running ? 0 : 0.028 * lopeDepth, t, 0.05);
  }
  // Volume: idle hum + throttle + a touch with revs; dips hard while the limiter cuts
  // fuel, dips (less hard) through a shift cut, and FADES OUT with the dying crank on a
  // stall (rpm → 0) instead of droning on at 30 Hz.
  let vol = 0.05 + load * 0.11 + (rpm / 10800) * 0.05;
  if (cutting)  vol *= 0.25;
  if (shifting) vol *= 0.35;
  if (!running) vol *= Math.max(0, Math.min(1, rpm / 1500));
  engGain.gain.setTargetAtTime(soundMuted ? 0 : vol, t, 0.012);
}

function setMuted(m) {
  soundMuted = !!m;
  try { localStorage.setItem('motosim-muted', soundMuted ? '1' : '0'); } catch (e) {}
  if (engGain && audioCtx && soundMuted) engGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.04);
}

// Start the audio engine on the first user interaction (required by autoplay policies).
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  window.addEventListener(ev, initAudio, { passive: true }));
