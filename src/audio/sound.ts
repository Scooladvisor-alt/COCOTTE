// Effets sonores synthétisés (aucun fichier externe) : discrets et cohérents.
type Kind =
  | 'cluck'
  | 'pop'
  | 'coin'
  | 'build'
  | 'click'
  | 'error'
  | 'level'
  | 'buy'
  | 'water'
  | 'grain'
  | 'egg'
  | 'shot'
  | 'shotFar'
  | 'yelp'
  | 'screech'
  | 'squawk'
  | 'alarm'
  | 'murmur'
  | 'sweep'
  | 'bark'
  | 'crow'
  | 'peep';

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;
  private last: Record<string, number> = {};

  private ensure() {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Contexte audio partagé avec la musique (créé au premier geste de l'utilisateur). */
  context() {
    return this.ensure();
  }

  unlock() {
    const c = this.ensure();
    if (c && c.state === 'suspended') void c.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slide = 0) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, when = 0) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
  }

  /**
   * Un « bok » de poule : voix nasillarde (dent de scie filtrée par deux formants),
   * attaque sèche, hauteur qui retombe, petite part de souffle.
   */
  private bok(when: number, freq: number, dur: number, vol: number, out: AudioNode) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq * 1.12, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.25);
    o.frequency.exponentialRampToValueAtTime(freq * 0.82, t + dur);
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = freq * 1.9;
    f1.Q.value = 3.5;
    const f2 = c.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 2600;
    f2.Q.value = 5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(vol * 0.5, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain();
    g2.gain.value = 0.35;
    o.connect(f1).connect(g);
    o.connect(f2).connect(g2).connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
    // souffle
    const len = Math.floor(c.sampleRate * dur * 0.6);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-i / len) * 5);
    const n = c.createBufferSource();
    n.buffer = buf;
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1800;
    nf.Q.value = 1;
    const ng = c.createGain();
    ng.gain.value = vol * 0.4;
    n.connect(nf).connect(ng).connect(out);
    n.start(t);
  }

  /** Syllabe de chant du coq : voix rauque (dents de scie) passée dans deux formants, glissement de hauteur. */
  private crowNote(when: number, f0: number, f1: number, dur: number, vol: number, out: AudioNode, vibrato = 0) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur * 0.8);
    o.frequency.linearRampToValueAtTime(f1 * 0.86, t + dur);
    if (vibrato) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 7;
      const lg = c.createGain();
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [f, q, k] of [
      [f0 * 2.1, 4, 1],
      [2500, 6, 0.45],
    ] as const) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const kg = c.createGain();
      kg.gain.value = k;
      o.connect(bp).connect(kg).connect(g);
    }
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Sortie spatialisée (gauche/droite) pour l'ambiance de la basse-cour. */
  private panned(pan: number) {
    const c = this.ctx!;
    if (!c.createStereoPanner) return this.master!;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master!);
    return p;
  }

  /** Détonation : bruit filtré à décroissance exponentielle + coup sourd. */
  private bang(vol: number, cutoff: number, dur: number, when = 0) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-i / len) * 7);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.25), t + dur);
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    this.tone(95, dur * 0.7, 'sine', vol * 0.8, when, -50);
  }

  play(kind: Kind) {
    if (!this.enabled) return;
    const c = this.ensure();
    if (!c || c.state !== 'running') return;
    const now = performance.now();
    const minGap = kind === 'cluck' ? 350 : kind === 'murmur' ? 600 : kind === 'sweep' ? 250 : kind === 'bark' ? 700 : kind === 'crow' ? 4000 : kind === 'peep' ? 500 : kind === 'coin' ? 90 : kind === 'squawk' ? 500 : kind === 'screech' || kind === 'alarm' ? 900 : 40;
    if (now - (this.last[kind] ?? 0) < minGap) return;
    this.last[kind] = now;
    switch (kind) {
      case 'cluck': {
        // « bok… bok… bok-bok… bo-KAAAK »
        const out = this.panned(Math.random() * 1.2 - 0.6);
        const base = 330 + Math.random() * 90;
        const n = 2 + Math.floor(Math.random() * 3);
        let at = 0;
        for (let i = 0; i < n; i++) {
          this.bok(at, base * (0.95 + Math.random() * 0.1), 0.07 + Math.random() * 0.03, 0.09, out);
          at += 0.14 + Math.random() * 0.12;
        }
        if (Math.random() < 0.55) {
          this.bok(at, base * 1.05, 0.06, 0.08, out);
          this.bok(at + 0.08, base * 1.55, 0.32, 0.1, out);
        }
        break;
      }
      case 'crow': {
        // « co-co-ri-coooo » : trois syllabes montantes puis une longue note tenue qui retombe
        const out = this.panned(Math.random() * 1.0 - 0.5);
        const k = 0.9 + Math.random() * 0.2;
        this.crowNote(0, 430 * k, 520 * k, 0.16, 0.13, out);
        this.crowNote(0.2, 520 * k, 600 * k, 0.15, 0.14, out);
        this.crowNote(0.39, 600 * k, 700 * k, 0.17, 0.15, out);
        this.crowNote(0.6, 700 * k, 640 * k, 0.85, 0.16, out, 9);
        break;
      }
      case 'peep': {
        // « piou piou » de poussin : petites notes aiguës qui montent puis retombent
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const at = i * (0.13 + Math.random() * 0.06);
          const f = 3300 + Math.random() * 600;
          this.tone(f, 0.08, 'sine', 0.035, at, 700);
          this.tone(f * 1.2, 0.05, 'sine', 0.025, at + 0.06, -900);
        }
        break;
      }
      case 'bark': {
        // « wouf wouf » : voix grave filtrée, attaque sèche
        for (const at of [0, 0.22]) {
          this.bok(at, 170 + Math.random() * 30, 0.13, 0.16, this.master!);
          this.noise(0.08, 0.08, 900, at);
        }
        break;
      }
      case 'murmur': {
        // caquètement tranquille de fond : quelques « took » doux et graves
        const out = this.panned(Math.random() * 1.6 - 0.8);
        const base = 260 + Math.random() * 80;
        const n = 2 + Math.floor(Math.random() * 4);
        let at = 0;
        for (let i = 0; i < n; i++) {
          this.bok(at, base * (0.92 + Math.random() * 0.16), 0.06 + Math.random() * 0.04, 0.035 + Math.random() * 0.02, out);
          at += 0.12 + Math.random() * 0.2;
        }
        break;
      }
      case 'sweep': {
        // coup de balai de paille : frottement filtré qui glisse
        const c = this.ctx!;
        const t = c.currentTime;
        const len = Math.floor(c.sampleRate * 0.32);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          const k = i / len;
          d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k * 0.6);
        }
        const src = c.createBufferSource();
        src.buffer = buf;
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(2400, t);
        f.frequency.linearRampToValueAtTime(4200, t + 0.3);
        f.Q.value = 0.8;
        const g = c.createGain();
        g.gain.value = 0.07;
        src.connect(f).connect(g).connect(this.master!);
        src.start(t);
        break;
      }
      case 'pop':
        this.tone(660, 0.09, 'sine', 0.12, 0, 520);
        break;
      case 'egg':
        this.tone(880, 0.08, 'sine', 0.08, 0, 300);
        this.tone(1320, 0.08, 'sine', 0.05, 0.06);
        break;
      case 'coin':
        this.tone(1318, 0.09, 'square', 0.035);
        this.tone(1976, 0.16, 'square', 0.03, 0.07);
        break;
      case 'buy':
        this.tone(880, 0.08, 'sine', 0.08);
        this.tone(1175, 0.12, 'sine', 0.07, 0.07);
        break;
      case 'build':
        this.tone(160, 0.18, 'triangle', 0.16, 0, -80);
        this.noise(0.15, 0.12, 800);
        this.tone(220, 0.14, 'triangle', 0.1, 0.12, -60);
        break;
      case 'click':
        this.tone(1400, 0.03, 'sine', 0.05);
        break;
      case 'error':
        this.tone(220, 0.14, 'sawtooth', 0.045, 0, -60);
        break;
      case 'water':
        this.noise(0.25, 0.08, 1800);
        this.tone(500, 0.18, 'sine', 0.05, 0.02, 400);
        break;
      case 'grain':
        this.noise(0.22, 0.1, 3500);
        break;
      case 'level':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.09, i * 0.1));
        break;
      case 'shot':
        // tir du joueur : « PAN ! » sec et puissant
        this.bang(0.95, 2600, 0.45);
        this.noise(0.05, 0.35, 3800);
        break;
      case 'shotFar':
        // fusil d'un salarié : plus étouffé, avec un léger écho
        this.bang(0.5, 1300, 0.38);
        this.bang(0.12, 800, 0.3, 0.14);
        break;
      case 'yelp':
        this.tone(1150, 0.12, 'triangle', 0.08, 0, -500);
        this.tone(980, 0.16, 'triangle', 0.07, 0.13, -450);
        break;
      case 'screech': {
        // cri de la buse : « kiii-ah » descendant
        const c = this.ctx!;
        const t = c.currentTime;
        const o = c.createOscillator();
        const lfo = c.createOscillator();
        const lg = c.createGain();
        const g = c.createGain();
        const f = c.createBiquadFilter();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(2300, t);
        o.frequency.exponentialRampToValueAtTime(1500, t + 0.6);
        lfo.frequency.value = 28;
        lg.gain.value = 60;
        lfo.connect(lg).connect(o.frequency);
        f.type = 'bandpass';
        f.frequency.value = 2200;
        f.Q.value = 2;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.07, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
        o.connect(f).connect(g).connect(this.master!);
        o.start(t);
        lfo.start(t);
        o.stop(t + 0.65);
        lfo.stop(t + 0.65);
        break;
      }
      case 'squawk':
        for (let i = 0; i < 5; i++) this.tone(760 + Math.random() * 260, 0.06, 'triangle', 0.06, i * 0.075, -260);
        break;
      case 'alarm':
        this.tone(330, 0.16, 'square', 0.045);
        this.tone(247, 0.24, 'square', 0.045, 0.18);
        break;
    }
  }
}

export const sound = new Sound();
