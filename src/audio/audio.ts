import type { SoundCue } from '../game/sim';

/**
 * All sound is made on the fly with the Web Audio API: no sound files, no extra packages.
 * - Music: a calm, endlessly varying lo-fi loop (chords, bass, a wandering melody).
 * - Ambience: soft city hum, louder by day.
 * - Effects: cash register, elevator bell, fanfare, fire alarm, trains and so on.
 */

export type Sfx = SoundCue | 'build' | 'demolish' | 'click' | 'error';

const MIN_GAP: Partial<Record<Sfx, number>> = {
  cash: 0.12,
  ding: 0.7,
  train: 4,
  alarm: 2.5,
  moveIn: 0.5,
};

/** Note number to frequency (A4 = 69 = 440 Hz). */
const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Chord progression (MIDI notes); one chord per bar. */
const DAY_CHORDS = [
  [60, 64, 67, 71], // Cmaj7
  [57, 60, 64, 67], // Am7
  [53, 57, 60, 64], // Fmaj7
  [55, 59, 62, 65], // G7
];
const NIGHT_CHORDS = [
  [57, 60, 64, 67], // Am7
  [53, 57, 60, 64], // Fmaj7
  [48, 52, 55, 59], // Cmaj7 (low)
  [52, 55, 59, 62], // Em7
];
const PENTATONIC = [72, 74, 76, 79, 81, 84, 86];

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambience!: GainNode;
  private echo!: DelayNode;
  private noise!: AudioBuffer;
  private lastPlayed = new Map<Sfx, number>();
  private nextBeat = 0;
  private beat = 0;
  private melodyNote = 76;
  private night = false;
  musicOn = true;
  soundOn = true;

  constructor() {
    try {
      this.musicOn = localStorage.getItem('simnext.music') !== 'off';
      this.soundOn = localStorage.getItem('simnext.sound') !== 'off';
    } catch {
      // Keep the defaults when storage is blocked.
    }
  }

  /** Browsers only allow sound after a user action, so this runs on the first click or key. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.5 : 0;
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.soundOn ? 0.9 : 0;
    this.sfxBus.connect(this.master);

    // A soft echo for the melody.
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.39;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.35;
    this.echo.connect(feedback).connect(this.echo);
    this.echo.connect(echoOut).connect(this.musicBus);

    // Two seconds of noise, reused for hats, whooshes and city hum.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // Slightly "brown" noise sounds softer than white noise.
      last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
      data[i] = last * 3.5;
    }
    const hum = ctx.createBufferSource();
    hum.buffer = this.noise;
    hum.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0;
    hum.connect(lp).connect(this.ambience).connect(this.sfxBus);
    hum.start();

    this.nextBeat = ctx.currentTime + 0.2;
    window.setInterval(() => this.scheduleMusic(), 60);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    this.store('simnext.music', on);
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.2);
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    this.store('simnext.sound', on);
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.1);
  }

  private store(key: string, on: boolean): void {
    try {
      localStorage.setItem(key, on ? 'on' : 'off');
    } catch {
      // Not saved; that's fine.
    }
  }

  /** Called every frame with the time of day and the simulation's sound requests. */
  update(hour: number, cues: SoundCue[], paused: boolean): void {
    const queued = cues.splice(0);
    if (!this.ctx) return;
    this.night = hour < 6.5 || hour >= 20;
    const day = hour >= 7 && hour < 20;
    this.ambience.gain.setTargetAtTime(paused ? 0.004 : day ? 0.035 : 0.014, this.ctx.currentTime, 0.8);
    if (paused) return;
    for (const c of queued) this.play(c);
  }

  play(sfx: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[sfx] ?? 0.08;
    if (now - (this.lastPlayed.get(sfx) ?? -10) < gap) return;
    this.lastPlayed.set(sfx, now);
    const out = this.sfxBus;
    switch (sfx) {
      case 'cash':
        this.tone(hz(88), now, 0.09, 'triangle', 0.05, out);
        this.tone(hz(93), now + 0.06, 0.16, 'triangle', 0.05, out);
        break;
      case 'ding':
        this.tone(hz(81), now, 1.1, 'sine', 0.035, out, 0.005);
        this.tone(hz(88), now, 0.8, 'sine', 0.015, out, 0.005);
        break;
      case 'star':
        [72, 76, 79, 84].forEach((n, i) => this.tone(hz(n), now + i * 0.11, 0.35, 'triangle', 0.08, out));
        [72, 76, 79, 84].forEach((n) => this.tone(hz(n), now + 0.5, 1.2, 'sawtooth', 0.025, out, 0.02, 2200));
        break;
      case 'alarm':
        for (let i = 0; i < 4; i++) this.tone(i % 2 ? 660 : 880, now + i * 0.38, 0.36, 'square', 0.03, out, 0.01, 2500);
        break;
      case 'event':
        [79, 84, 88].forEach((n, i) => this.tone(hz(n), now + i * 0.14, 0.6, 'sine', 0.06, out));
        break;
      case 'good':
        this.tone(hz(76), now, 0.2, 'triangle', 0.06, out);
        this.tone(hz(83), now + 0.12, 0.4, 'triangle', 0.06, out);
        break;
      case 'bad':
        this.sweep(260, 140, now, 0.5, 'sawtooth', 0.04, out, 900);
        break;
      case 'train':
        this.whoosh(now, 2.4, 0.05);
        this.tone(hz(64), now + 0.3, 0.5, 'sine', 0.02, out);
        this.tone(hz(68), now + 0.3, 0.5, 'sine', 0.02, out);
        break;
      case 'moveIn':
        this.tone(hz(79), now, 0.25, 'triangle', 0.035, out);
        break;
      case 'build':
        this.sweep(170, 60, now, 0.18, 'sine', 0.14, out);
        this.noiseBurst(now, 0.08, 0.06, 1800);
        break;
      case 'demolish':
        this.noiseBurst(now, 0.9, 0.12, 700);
        this.sweep(110, 40, now, 0.5, 'sine', 0.15, out);
        break;
      case 'click':
        this.tone(1400, now, 0.03, 'square', 0.015, out, 0.001, 3000);
        break;
      case 'error':
        this.tone(196, now, 0.09, 'square', 0.03, out, 0.005, 1200);
        this.tone(165, now + 0.11, 0.12, 'square', 0.03, out, 0.005, 1200);
        break;
    }
  }

  // ---- Music --------------------------------------------------------------

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn) {
      if (ctx) this.nextBeat = Math.max(this.nextBeat, ctx.currentTime + 0.1);
      return;
    }
    const spb = 60 / (this.night ? 66 : 76) / 2; // seconds per eighth note
    while (this.nextBeat < ctx.currentTime + 0.25) {
      this.playEighth(this.beat, this.nextBeat, spb);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  private playEighth(beat: number, t: number, spb: number): void {
    const chords = this.night ? NIGHT_CHORDS : DAY_CHORDS;
    const bar = Math.floor(beat / 8) % chords.length;
    const chord = chords[bar];
    const step = beat % 8;
    const bus = this.musicBus;
    if (step === 0) {
      // Pad: the whole chord, slow attack, warm filter.
      for (const n of chord) this.tone(hz(n), t, spb * 8, 'triangle', 0.018, bus, spb * 2, this.night ? 900 : 1400);
    }
    if (step === 0 || step === 4) this.tone(hz(chord[0] - 24), t, spb * 3.5, 'sine', 0.07, bus, 0.02);
    if (step % 2 === 1) this.noiseBurst(t, 0.04, 0.012, 6000, bus);
    // Melody: a gentle random walk over the pentatonic scale.
    const chance = this.night ? 0.22 : 0.38;
    if (Math.random() < chance) {
      const i = PENTATONIC.indexOf(this.melodyNote);
      const next = Math.max(0, Math.min(PENTATONIC.length - 1, i + Math.floor(Math.random() * 5) - 2));
      this.melodyNote = PENTATONIC[next];
      const len = spb * (Math.random() < 0.3 ? 3 : 1.5);
      this.tone(hz(this.melodyNote - (this.night ? 12 : 0)), t, len, 'sine', 0.035, bus, 0.01);
      this.tone(hz(this.melodyNote - (this.night ? 12 : 0)), t, len, 'sine', 0.02, this.echo, 0.01);
    }
  }

  // ---- Synth helpers ----------------------------------------------------

  private tone(freq: number, t: number, dur: number, type: OscillatorType, gain: number, dest: AudioNode, attack = 0.01, cutoff?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.02, dur));
    let node: AudioNode = osc;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      node = osc.connect(f);
    }
    node.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private sweep(from: number, to: number, t: number, dur: number, type: OscillatorType, gain: number, dest: AudioNode, cutoff?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      node = osc.connect(f);
    }
    node.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noiseBurst(t: number, dur: number, gain: number, cutoff: number, dest: AudioNode = this.sfxBus): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = cutoff > 3000 ? 'highpass' : 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private whoosh(t: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(200, t);
    f.frequency.linearRampToValueAtTime(900, t + dur * 0.4);
    f.frequency.linearRampToValueAtTime(250, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }
}

/** The one audio engine for the whole game. */
export const audio = new AudioEngine();
