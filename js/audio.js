'use strict';
// ═══════════════════════════════════════════════════════════
//  ENGINE SOUND  (Web Audio — pitch tracks RPM so you can hear the rev range)
// ═══════════════════════════════════════════════════════════
// Two detuned sawtooth oscillators (engine "beat") through a low-pass filter whose
// cutoff opens with revs/throttle for brightness. Frequency rises with engineRPM, so the
// note climbs as you rev — a clear cue for where you are in the range. Volume = idle hum +
// throttle. Created lazily on the first user gesture (browser autoplay policy).

let audioCtx = null, engGain = null, oscA = null, oscB = null, engLPF = null;
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
  engLPF.frequency.value = 600;

  oscA = audioCtx.createOscillator(); oscA.type = 'sawtooth';
  oscB = audioCtx.createOscillator(); oscB.type = 'sawtooth'; oscB.detune.value = -14;
  oscA.frequency.value = 90; oscB.frequency.value = 90;

  oscA.connect(engLPF); oscB.connect(engLPF);
  engLPF.connect(engGain);
  engGain.connect(audioCtx.destination);
  oscA.start(); oscB.start();
}

// Called every frame with the live engine rpm and throttle (0..1).
function updateEngineSound(rpm, throttle) {
  if (!audioCtx || !oscA) return;
  const t = audioCtx.currentTime;
  // Fundamental rises with rpm; mapped into a pleasant audible band (~108 Hz idle → ~560 Hz redline).
  const f = 28 + (rpm / 60) * 3.2;
  oscA.frequency.setTargetAtTime(f, t, 0.03);
  oscB.frequency.setTargetAtTime(f, t, 0.03);
  // Brightness opens with revs + throttle.
  const cutoff = 300 + (rpm / 10800) * 2600 + throttle * 1500;
  engLPF.frequency.setTargetAtTime(cutoff, t, 0.05);
  // Volume: quiet idle hum + throttle + a touch with revs. Muted → silent.
  const vol = soundMuted ? 0 : (0.035 + throttle * 0.10 + (rpm / 10800) * 0.045);
  engGain.gain.setTargetAtTime(vol, t, 0.05);
}

function setMuted(m) {
  soundMuted = !!m;
  try { localStorage.setItem('motosim-muted', soundMuted ? '1' : '0'); } catch (e) {}
  if (engGain && audioCtx && soundMuted) engGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.04);
}

// Start the audio engine on the first user interaction (required by autoplay policies).
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  window.addEventListener(ev, initAudio, { passive: true }));
