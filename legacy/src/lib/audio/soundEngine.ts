'use client';

/**
 * LiftItUp — Web Audio API Procedural Sound Synth & Synchronized Haptics
 * Zero external MP3/WAV dependencies; works 100% offline in iPhone PWA & Desktop.
 * Follows `apple-design` Rule #4: fire visual, audio, and haptic feedback on the exact same frame.
 */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!sharedAudioCtx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        sharedAudioCtx = new AudioCtx();
      }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

function triggerHaptic(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore on unsupported devices (e.g. desktop / iOS Safari without vibrate)
    }
  }
}

/**
 * Crisp 18ms mechanical woody tap for steppers, day pills, and button presses.
 */
export function playMechanicalClick(enabled = true): void {
  triggerHaptic(8);
  if (!enabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.018);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.02);
  } catch {
    // Ignore audio context errors
  }
}

/**
 * Satisfying two-note ascending chime (C5 -> G5) + 25ms haptic pulse on set completion.
 */
export function playSetComplete(enabled = true): void {
  triggerHaptic(25);
  if (!enabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [
      { freq: 523.25, start: 0, duration: 0.09 }, // C5
      { freq: 783.99, start: 0.075, duration: 0.16 }, // G5
    ];

    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.freq, now + n.start);

      gain.gain.setValueAtTime(0.001, now + n.start);
      gain.gain.linearRampToValueAtTime(0.22, now + n.start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + n.start);
      osc.stop(now + n.start + n.duration + 0.01);
    }
  } catch {
    // Ignore audio context errors
  }
}

/**
 * 4-note arcade brass chord fanfare (C5 -> E5 -> G5 -> C6) + celebratory haptic pattern
 * for PR unlocks, Boss Milestones, and Workout Completion.
 */
export function playPrFanfare(enabled = true): void {
  triggerHaptic([40, 30, 80]);
  if (!enabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [
      { freq: 523.25, start: 0, duration: 0.11 }, // C5
      { freq: 659.25, start: 0.09, duration: 0.11 }, // E5
      { freq: 783.99, start: 0.18, duration: 0.12 }, // G5
      { freq: 1046.5, start: 0.28, duration: 0.34 }, // C6
    ];

    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(n.freq, now + n.start);

      gain.gain.setValueAtTime(0.001, now + n.start);
      gain.gain.linearRampToValueAtTime(0.16, now + n.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + n.start);
      osc.stop(now + n.start + n.duration + 0.015);
    }
  } catch {
    // Ignore audio context errors
  }
}

/**
 * Distinct double-bell alert (A5 -> A5) + triple haptic pulse when the rest timer hits 00:00.
 */
export function playRestTimerDone(enabled = true): void {
  triggerHaptic([60, 40, 60]);
  if (!enabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const rings = [
      { freq: 880, start: 0, duration: 0.14 },
      { freq: 880, start: 0.18, duration: 0.24 },
    ];

    for (const r of rings) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(r.freq, now + r.start);

      gain.gain.setValueAtTime(0.001, now + r.start);
      gain.gain.linearRampToValueAtTime(0.26, now + r.start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + r.start + r.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + r.start);
      osc.stop(now + r.start + r.duration + 0.01);
    }
  } catch {
    // Ignore audio context errors
  }
}
