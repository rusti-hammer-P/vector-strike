// Web Audio API Procedural Synthesizer for BLIND RADAR SHOT
// Zero external audio assets; implements all 8 tactical SE families from design.md Section 6
// Safe try/catch guards ensure headless browser / Node.js tests never fail on audio calls.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.muted = false;

    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('blind_radar_shot_muted');
        if (saved === 'true') this.muted = true;
      }
    } catch (_) {}
  }

  ensureContext() {
    if (typeof window === 'undefined') return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0.0 : 0.35;
        this.masterGain.connect(this.ctx.destination);
        this.createNoiseBuffer();
      } catch (_) {
        return false;
      }
    }

    if (this.ctx.state === 'suspended') {
      try {
        const p = this.ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
    }
    return true;
  }

  createNoiseBuffer() {
    if (!this.ctx) return;
    try {
      const sampleRate = this.ctx.sampleRate;
      const length = sampleRate * 1.0;
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    } catch (_) {}
  }

  setMuted(muted) {
    this.muted = !!muted;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('blind_radar_shot_muted', String(this.muted));
      }
    } catch (_) {}
    try {
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(
          this.muted ? 0.0 : 0.35,
          this.ctx.currentTime
        );
      }
    } catch (_) {}
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // Round start / quick retry confirmation beep
  // Finite assault -> reinforcements ended -> safe. No loop persists into rest.
  playEndlessPhase(phase) {
    if (this.muted || !this.ensureContext()) return;
    try {
      const t = this.ctx.currentTime;
      const notes = phase === 'ASSAULT' ? [330, 440]
        : phase === 'CLEANUP' ? [330, 247] : [262, 330, 392, 523];
      notes.forEach((frequency, i) => {
        const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        const start = t + i * 0.13;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.09, start);
        const duration = phase === 'REST' ? 0.42 : 0.22;
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gain); gain.connect(this.masterGain);
        osc.start(start); osc.stop(start + duration + 0.02);
      });
    } catch (_) {}
  }

  playBootBeep() {
    if (this.muted || !this.ensureContext()) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1320, t + 0.06);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.08);
    } catch (_) {}
  }

  // 1. playSweepPass() — Subtle CIC low-frequency pulse when sweep passes North (12 o'clock)
  playSweepPass() {
    if (this.muted || !this.ensureContext()) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(95, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.15);
    } catch (_) {}
  }

  // 2. playSonarPing(distanceRatio, isDecoy = false) — Distance-dependent sonar ping
  // distanceRatio = clamp(r / RADAR_RADIUS, 0, 1). Closer target -> higher pitch & sharper overtones.
  playSonarPing(distanceRatio = 0.5, isDecoy = false) {
    if (this.muted || !this.ensureContext()) return;
    try {
      const t = this.ctx.currentTime;
      const dNorm = Math.max(0.0, Math.min(1.0, Number(distanceRatio) || 0.5));
      const p = 1.0 - dNorm; // Proximity (0 = far, 1 = core)
      const fPing = 520 * Math.pow(2.6, Math.pow(p, 1.25));

      if (!isDecoy) {
        // Real Target: Pure metallic sonar droplet ping
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(fPing * 1.02, t);
        osc1.frequency.exponentialRampToValueAtTime(fPing, t + 0.02);
        gain1.gain.setValueAtTime(0.30, t);
        gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc1.connect(gain1);
        gain1.connect(this.masterGain);
        osc1.start(t);
        osc1.stop(t + 0.29);

        // Overtone echo (stronger when closer)
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(fPing * 2.0, t);
        gain2.gain.setValueAtTime(0.04 + 0.12 * p, t);
        gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc2.connect(gain2);
        gain2.connect(this.masterGain);
        osc2.start(t);
        osc2.stop(t + 0.17);
      } else {
        // Round 5 Decoy: Slightly detuned + tritone overtone + subtle bandpass glitch noise
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(fPing * 0.97, t);
        gain1.gain.setValueAtTime(0.26, t);
        gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
        osc1.connect(gain1);
        gain1.connect(this.masterGain);
        osc1.start(t);
        osc1.stop(t + 0.25);

        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(fPing * 1.414, t);
        gain2.gain.setValueAtTime(0.10, t);
        gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc2.connect(gain2);
        gain2.connect(this.masterGain);
        osc2.start(t);
        osc2.stop(t + 0.19);

        if (this.noiseBuffer) {
          const noise = this.ctx.createBufferSource();
          noise.buffer = this.noiseBuffer;
          const bp = this.ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(2200, t);
          bp.Q.setValueAtTime(8.0, t);
          const nGain = this.ctx.createGain();
          nGain.gain.setValueAtTime(0.06, t);
          nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
          noise.connect(bp);
          bp.connect(nGain);
          nGain.connect(this.masterGain);
          noise.start(t);
          noise.stop(t + 0.095);
        }
      }
    } catch (_) {}
  }

  // 3. playDangerHeartbeat() — Double-pulse proximity alert when enemy is inside DANGER_RADIUS (120px)
  playDangerHeartbeat() {
    if (this.muted || !this.ensureContext()) return;
    try {
      const t = this.ctx.currentTime;
      const pulses = [
        { freq: 440.0, start: 0.0, dur: 0.06 },
        { freq: 587.33, start: 0.08, dur: 0.07 }
      ];
      pulses.forEach(p => {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(p.freq, t + p.start);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900, t + p.start);
        gain.gain.setValueAtTime(0.16, t + p.start);
        gain.gain.exponentialRampToValueAtTime(0.001, t + p.start + p.dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t + p.start);
        osc.stop(t + p.start + p.dur + 0.01);
      });
    } catch (_) {}
  }

  // 4. playTacticalPulse() — High-output active sonar wave chirp + sub-bass ripple
  playTacticalPulse() {
    if (this.muted || !this.ensureContext()) return;
    try {
      const t = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(320, t);
      osc1.frequency.exponentialRampToValueAtTime(1480, t + 0.18);
      osc1.frequency.exponentialRampToValueAtTime(960, t + 0.35);
      gain1.gain.setValueAtTime(0.26, t);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      osc1.start(t);
      osc1.stop(t + 0.37);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(140, t);
      osc2.frequency.exponentialRampToValueAtTime(60, t + 0.25);
      gain2.gain.setValueAtTime(0.22, t);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      osc2.start(t);
      osc2.stop(t + 0.27);
    } catch (_) {}
  }

  // 5. playRailgunShot() — Heavy 3-layer electromagnetic railgun discharge
  playRailgunShot() {
    if (this.muted || !this.ensureContext()) return;
    try {
      const t = this.ctx.currentTime;

      // Layer 1: Sub-bass electromagnetic kick
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'square';
      osc1.frequency.setValueAtTime(180, t);
      osc1.frequency.exponentialRampToValueAtTime(32, t + 0.22);
      gain1.gain.setValueAtTime(0.40, t);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      osc1.start(t);
      osc1.stop(t + 0.25);

      // Layer 2: High-frequency plasma discharge chirp
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(2400, t);
      osc2.frequency.exponentialRampToValueAtTime(280, t + 0.12);
      gain2.gain.setValueAtTime(0.28, t);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      osc2.start(t);
      osc2.stop(t + 0.14);

      // Layer 3: Muzzle blast noise burst
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1600, t);
        bp.frequency.exponentialRampToValueAtTime(400, t + 0.18);
        bp.Q.setValueAtTime(1.8, t);
        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.35, t);
        nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        noise.connect(bp);
        bp.connect(nGain);
        nGain.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.19);
      }
    } catch (_) {}
  }

  // 6. playTargetHit(isBullseye = false) — Armor shatter + tactical victory arpeggio
  playTargetHit(isBullseye = false) {
    if (this.muted || !this.ensureContext()) return;
    try {
      const t = this.ctx.currentTime;

      // Layer 1: Sub-bass crash
      const sub = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      sub.type = 'square';
      sub.frequency.setValueAtTime(120, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + 0.38);
      subGain.gain.setValueAtTime(0.38, t);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.40);
      sub.connect(subGain);
      subGain.connect(this.masterGain);
      sub.start(t);
      sub.stop(t + 0.41);

      // Layer 2: 3-burst shatter noise
      if (this.noiseBuffer) {
        const bursts = [
          { offset: 0.0, freq: 1600 },
          { offset: 0.045, freq: 2200 },
          { offset: 0.095, freq: 3000 }
        ];
        bursts.forEach(b => {
          const noise = this.ctx.createBufferSource();
          noise.buffer = this.noiseBuffer;
          const bp = this.ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(b.freq, t + b.offset);
          bp.Q.setValueAtTime(3.0, t + b.offset);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.28, t + b.offset);
          g.gain.exponentialRampToValueAtTime(0.001, t + b.offset + 0.09);
          noise.connect(bp);
          bp.connect(g);
          g.connect(this.masterGain);
          noise.start(t + b.offset);
          noise.stop(t + b.offset + 0.095);
        });
      }

      // Layer 3: Victory confirmation arpeggio (D5 -> A5 -> D6 -> A6 [-> D7])
      const notes = isBullseye
        ? [587.33, 880.0, 1174.66, 1760.0, 2349.32]
        : [587.33, 880.0, 1174.66, 1760.0];
      notes.forEach((freq, idx) => {
        const start = t + 0.06 + idx * 0.045;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.24, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(start);
        osc.stop(start + 0.23);
      });
    } catch (_) {}
  }

  // 7. playTargetMiss() — Descending 2-note failure tone
  playTargetMiss() {
    if (this.muted || !this.ensureContext()) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(650, t);

      osc.frequency.setValueAtTime(311.13, t); // D#4
      osc.frequency.setValueAtTime(233.08, t + 0.14); // A#3
      osc.frequency.linearRampToValueAtTime(215.0, t + 0.38);

      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.40);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.41);
    } catch (_) {}
  }

  // 8. playPlayerHit() — Core breached heavy crash & tritone alarm (C4 + F#4)
  playPlayerHit() {
    if (this.muted || !this.ensureContext()) return;
    try {
      const t = this.ctx.currentTime;

      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(500, t);
        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.38, t);
        nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
        noise.connect(lp);
        lp.connect(nGain);
        nGain.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.31);
      }

      [261.63, 369.99].forEach(freq => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.linearRampToValueAtTime(freq * 0.92, t + 0.32);
        gain.gain.setValueAtTime(0.20, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.33);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.34);
      });
    } catch (_) {}
  }
}
