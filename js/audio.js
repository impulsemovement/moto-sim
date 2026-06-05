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

  oscA.start(); oscB.start(); oscSub.start(); noiseSrc.start();
}

// Called every frame with the live engine rpm and throttle (0..1).
function updateEngineSound(rpm, throttle) {
  if (!audioCtx || !oscA) return;
  const t = audioCtx.currentTime;
  const f = 30 + (rpm / 60) * 1.62;                 // ~70 Hz idle → ~300 Hz redline
  oscA.frequency.setTargetAtTime(f, t, 0.03);
  oscB.frequency.setTargetAtTime(f, t, 0.03);
  oscSub.frequency.setTargetAtTime(f * 0.5, t, 0.03);
  // Brightness opens with revs + throttle (kept low so it growls, not whines).
  engLPF.frequency.setTargetAtTime(250 + (rpm / 10800) * 1000 + throttle * 500, t, 0.05);
  // Noise rasp tracks the revs and grows with load.
  noiseBP.frequency.setTargetAtTime(f * 2.2, t, 0.04);
  noiseGain.gain.setTargetAtTime((0.018 + throttle * 0.05 + (rpm / 10800) * 0.03), t, 0.05);
  // Volume: idle hum + throttle + a touch with revs; dips hard while the limiter cuts fuel.
  const cutting = (typeof revLimiterCut !== 'undefined' && revLimiterCut);
  let vol = 0.05 + throttle * 0.11 + (rpm / 10800) * 0.05;
  if (cutting) vol *= 0.25;
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
