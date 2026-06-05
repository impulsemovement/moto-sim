'use strict';
// ═══════════════════════════════════════════════════════════
//  ENGINE SOUND  (Web Audio — pitch tracks RPM so you can hear the rev range)
// ═══════════════════════════════════════════════════════════
// Deep, throaty parallel-twin note rather than a bright buzz:
//  • two oscillators on a custom harmonic profile (strong low harmonics, rolled off — not the
//    bright 1/n of a raw sawtooth), slightly detuned for an engine "beat";
//  • a sub-oscillator an octave down for low-end body;
//  • a fairly LOW low-pass cutoff so the high whine is removed (throaty, not mosquito).
// Pitch rises with engineRPM; volume = idle hum + throttle, and dips hard while the rev limiter
// cuts fuel (the bra-ba-bap stutter). Built on the first user gesture (autoplay policy).

let audioCtx = null, engGain = null, oscA = null, oscB = null, oscSub = null, subGain = null, engLPF = null;
let soundMuted = false;
try { soundMuted = (localStorage.getItem('motosim-muted') === '1'); } catch (e) {}

function initAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { audioCtx = new AC(); } catch (e) { return; }

  engGain = audioCtx.createGain();
  engGain.gain.value = 0;

  engLPF = audioCtx.createBiquadFilter();
  engLPF.type = 'lowpass';
  engLPF.frequency.value = 400;
  engLPF.Q.value = 0.7;

  // Engine timbre: fundamental + a few harmonics that roll off quickly (throaty, not buzzy).
  const real = new Float32Array([0, 1.0, 0.75, 0.5, 0.3, 0.17, 0.09, 0.05]);
  const imag = new Float32Array(real.length);
  const engWave = audioCtx.createPeriodicWave(real, imag, { disableNormalization: false });

  oscA = audioCtx.createOscillator(); oscA.setPeriodicWave(engWave);
  oscB = audioCtx.createOscillator(); oscB.setPeriodicWave(engWave); oscB.detune.value = -11;
  oscA.frequency.value = 70; oscB.frequency.value = 70;
  oscA.connect(engLPF); oscB.connect(engLPF);

  // Sub-octave sine for deep body.
  oscSub = audioCtx.createOscillator(); oscSub.type = 'sine'; oscSub.frequency.value = 35;
  subGain = audioCtx.createGain(); subGain.gain.value = 0.55;
  oscSub.connect(subGain); subGain.connect(engLPF);

  engLPF.connect(engGain);
  engGain.connect(audioCtx.destination);
  oscA.start(); oscB.start(); oscSub.start();
}

// Called every frame with the live engine rpm and throttle (0..1).
function updateEngineSound(rpm, throttle) {
  if (!audioCtx || !oscA) return;
  const t = audioCtx.currentTime;
  // Deep fundamental: ~70 Hz idle → ~320 Hz redline (with harmonics + sub for body).
  const f = 30 + (rpm / 60) * 1.62;
  oscA.frequency.setTargetAtTime(f, t, 0.03);
  oscB.frequency.setTargetAtTime(f, t, 0.03);
  oscSub.frequency.setTargetAtTime(f * 0.5, t, 0.03);
  // Brightness opens with revs + throttle but stays LOW so it never whines.
  const cutoff = 220 + (rpm / 10800) * 700 + throttle * 380;
  engLPF.frequency.setTargetAtTime(cutoff, t, 0.05);
  // Volume: quiet idle hum + throttle + a touch with revs. Drops hard while the rev limiter is
  // cutting fuel → the "bra-ba-ba-bap" stutter off the limiter. Muted → silent.
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
