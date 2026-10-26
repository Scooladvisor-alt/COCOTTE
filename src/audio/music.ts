// Musique d'ambiance « ferme » générée en temps réel (aucun fichier audio) :
// ballade champêtre en do majeur — banjo/ukulélé pincé (Karplus-Strong), basse alternée,
// sifflet mélodique et shaker. La nuit : version douce et grillons.
import { sound } from './sound';

const BPM = 100;
const EIGHTH = 60 / BPM / 2;
const SWING = 0.045;
const LOOKAHEAD = 0.3;

const midiFreq = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

type Chord = 'C' | 'F' | 'G';
const CHORDS: Record<Chord, { tones: number[]; root: number; fifth: number }> = {
  C: { tones: [60, 64, 67], root: 48, fifth: 43 },
  F: { tones: [60, 65, 69], root: 41, fifth: 48 },
  G: { tones: [59, 62, 67], root: 43, fifth: 50 },
};
const SECTION_A: Chord[] = ['C', 'C', 'F', 'C', 'C', 'G', 'C', 'C'];
const SECTION_B: Chord[] = ['F', 'C', 'G', 'C', 'F', 'C', 'G', 'C'];
const PROGRESSION = [...SECTION_A, ...SECTION_B];

// mélodie sifflée : [mesure, temps (en croches), note midi, durée (en croches)]
const MELODY: Array<[number, number, number, number]> = [
  [0, 0, 76, 2], [0, 2, 79, 2], [0, 4, 84, 3], [0, 7, 83, 1],
  [1, 0, 81, 2], [1, 2, 79, 2], [1, 4, 76, 4],
  [2, 0, 77, 2], [2, 2, 81, 2], [2, 4, 84, 2], [2, 6, 81, 2],
  [3, 0, 79, 4], [3, 4, 76, 2], [3, 6, 72, 2],
  [4, 0, 76, 1], [4, 1, 77, 1], [4, 2, 79, 2], [4, 4, 79, 2], [4, 6, 81, 2],
  [5, 0, 83, 2], [5, 2, 86, 2], [5, 4, 83, 2], [5, 6, 79, 2],
  [6, 0, 84, 2], [6, 2, 79, 2], [6, 4, 76, 2], [6, 6, 74, 2],
  [7, 0, 72, 6],
  [8, 0, 81, 3], [8, 3, 79, 1], [8, 4, 77, 2], [8, 6, 81, 2],
  [9, 0, 79, 2], [9, 2, 76, 2], [9, 4, 72, 4],
  [10, 0, 74, 2], [10, 2, 79, 2], [10, 4, 83, 2], [10, 6, 86, 2],
  [11, 0, 84, 6],
  [12, 0, 81, 2], [12, 2, 84, 2], [12, 4, 81, 2], [12, 6, 77, 2],
  [13, 0, 79, 2], [13, 2, 76, 2], [13, 4, 79, 2], [13, 6, 76, 2],
  [14, 0, 74, 2], [14, 2, 77, 2], [14, 4, 83, 2], [14, 6, 86, 1], [14, 7, 83, 1],
  [15, 0, 84, 4],
];

class Music {
  enabled = true;
  private volume = 0.5;
  private night = false;
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private slot = 0;
  private playing = false;
  private plucks = new Map<string, AudioBuffer>();
  private noise: AudioBuffer | null = null;
  private crickT = 0;

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyGain(0.3);
  }

  setNight(night: boolean) {
    if (night === this.night) return;
    this.night = night;
    this.applyGain(2.5);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.start();
    else this.stop();
  }

  private target() {
    return this.enabled && !document.hidden ? this.volume * 0.5 * (this.night ? 0.7 : 1) : 0;
  }

  private applyGain(fade: number) {
    if (!this.ctx || !this.bus) return;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(this.target(), t + fade);
  }

  /** À appeler depuis un geste de l'utilisateur (clic) : le navigateur l'exige pour le son. */
  start() {
    if (!this.enabled || this.playing) return;
    const ctx = sound.context();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    this.ctx = ctx;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = 0;
      // légère réverbération par délai pour adoucir
      const delay = ctx.createDelay();
      delay.delayTime.value = 0.23;
      const fb = ctx.createGain();
      fb.gain.value = 0.22;
      const wet = ctx.createGain();
      wet.gain.value = 0.18;
      this.bus.connect(ctx.destination);
      this.bus.connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(ctx.destination);
      document.addEventListener('visibilitychange', () => this.applyGain(0.4));
    }
    this.playing = true;
    this.nextTime = ctx.currentTime + 0.15;
    this.applyGain(2.5);
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.applyGain(0.6);
    const t = this.timer;
    this.timer = null;
    window.setTimeout(() => t !== null && window.clearInterval(t), 700);
  }

  // ---------------------------------------------------------------- Ordonnanceur ----
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    if (document.hidden) {
      this.nextTime = ctx.currentTime + 0.2;
      return;
    }
    // évite une rafale de notes après une longue pause
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playSlot(this.slot, this.nextTime + (this.slot % 2 ? SWING : 0));
      this.slot++;
      this.nextTime += EIGHTH;
    }
    if (this.night) {
      this.crickT -= 0.06;
      if (this.crickT <= 0) {
        this.crickT = 0.35 + Math.random() * 1.2;
        this.cricket(ctx.currentTime + 0.05);
      }
    }
  }

  private playSlot(slot: number, t: number) {
    const bars = PROGRESSION.length;
    const loop = Math.floor(slot / (bars * 8));
    const bar = Math.floor(slot / 8) % bars;
    const e = slot % 8;
    const chord = CHORDS[PROGRESSION[bar]];
    const night = this.night;

    // basse alternée racine / quinte (temps 1 et 3)
    if (!night && (e === 0 || e === 4)) this.bass(midiFreq(e === 0 ? chord.root : chord.fifth), t);
    // accords « chick » sur les temps 2 et 4
    if (!night && (e === 2 || e === 6)) chord.tones.forEach((n, i) => this.pluck(n, t + i * 0.012, 0.16, 'uke'));
    // picking : arpège de banjo (boucles instrumentales) ou arpège doux la nuit
    const instrumental = loop % 2 === 1;
    if (night) {
      if (e % 2 === 0) this.pluck(chord.tones[[0, 1, 2, 1][(e / 2) % 4]] + 12, t, 0.13, 'uke');
    } else if (instrumental) {
      const roll = [0, 1, 2, 1, 2, 0, 1, 2];
      this.pluck(chord.tones[roll[e]] + 12, t, e % 2 ? 0.09 : 0.13, 'banjo');
    } else if (e === 0 || e === 3 || e === 5) {
      this.pluck(chord.tones[e % 3] + 12, t, 0.07, 'banjo');
    }
    // shaker
    if (!night) this.shaker(t, e % 2 ? 0.05 : 0.025);
    // mélodie sifflée (une boucle sur deux)
    if (!night && !instrumental)
      for (const [mb, me, note, dur] of MELODY) if (mb === bar && me === e) this.whistle(midiFreq(note), t, dur * EIGHTH * 0.95);
  }

  // ----------------------------------------------------------------- Instruments ----
  private pluckBuffer(note: number, kind: 'uke' | 'banjo') {
    const key = `${kind}${note}`;
    let buf = this.plucks.get(key);
    if (buf) return buf;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const dur = kind === 'banjo' ? 0.9 : 1.3;
    const len = Math.floor(sr * dur);
    buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const n = Math.max(2, Math.round(sr / midiFreq(note)));
    const ring = new Float32Array(n);
    const bright = kind === 'banjo' ? 0.85 : 0.45;
    for (let i = 0; i < n; i++) ring[i] = Math.random() * 2 - 1;
    for (let i = 1; i < n; i++) ring[i] = ring[i] * bright + ring[i - 1] * (1 - bright);
    const decay = kind === 'banjo' ? 0.991 : 0.996;
    let idx = 0;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const a = ring[idx];
      const b = ring[(idx + 1) % n];
      d[i] = a;
      peak = Math.max(peak, Math.abs(a));
      ring[idx] = (a + b) * 0.5 * decay;
      idx = (idx + 1) % n;
    }
    if (peak > 0) for (let i = 0; i < len; i++) d[i] = (d[i] / peak) * 0.9;
    this.plucks.set(key, buf);
    return buf;
  }

  private pluck(note: number, t: number, vol: number, kind: 'uke' | 'banjo') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(note, kind);
    const g = ctx.createGain();
    g.gain.value = vol;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = kind === 'banjo' ? 5200 : 3200;
    src.connect(f).connect(g).connect(this.bus!);
    src.start(t);
  }

  private bass(freq: number, t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.32);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(f).connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.55);
  }

  private whistle(freq: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 0.985, t);
    o.frequency.linearRampToValueAtTime(freq, t + 0.05);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(freq * 0.007, t + Math.min(0.25, dur));
    lfo.connect(depth).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.05);
    g.gain.setValueAtTime(0.075, t + Math.max(0.06, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(g).connect(this.bus!);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
  }

  private noiseBuffer() {
    if (this.noise) return this.noise;
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 0.12);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    this.noise = b;
    return b;
  }

  private shaker(t: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.bus!);
    src.start(t);
  }

  private cricket(t: number) {
    const ctx = this.ctx!;
    const pulses = 2 + Math.floor(Math.random() * 3);
    const freq = 4300 + Math.random() * 500;
    for (let i = 0; i < pulses; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      const s = t + i * 0.045;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.03, s + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.03);
      o.connect(g).connect(this.bus!);
      o.start(s);
      o.stop(s + 0.04);
    }
  }
}

export const music = new Music();
