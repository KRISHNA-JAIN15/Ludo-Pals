/**
 * All game audio is synthesized with the Web Audio API — no asset downloads.
 * Call `sound.unlock()` from a user gesture before the first sound (browser autoplay rules).
 */

export type Sfx =
  | 'click'
  | 'pop'
  | 'diceShake'
  | 'diceLand'
  | 'hop'
  | 'capture'
  | 'captured'
  | 'safe'
  | 'home'
  | 'six'
  | 'turn'
  | 'win'
  | 'lose'
  | 'tick'
  | 'noMove'
  | 'start'
  | 'coin'
  | 'error'
  | 'whoosh'
  | 'join';

interface ToneOpts {
  freq: number;
  to?: number;
  type?: OscillatorType;
  dur: number;
  vol?: number;
  delay?: number;
  attack?: number;
  vibrato?: number;
  filter?: number;
}

interface NoiseOpts {
  dur: number;
  vol?: number;
  delay?: number;
  freq?: number;
  q?: number;
  type?: BiquadFilterType;
}

const NOTE = (semi: number) => 440 * Math.pow(2, (semi - 9) / 12); // semitones from C4
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private musicWanted = false;
  sfxOn = true;
  musicOn = true;

  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.0;
      this.musicBus.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.musicWanted) this.startMusic();
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (on && this.musicWanted) this.startMusic();
    else this.stopMusic();
  }

  /** Screens declare whether they want background music. */
  wantMusic(want: boolean) {
    this.musicWanted = want;
    if (want && this.musicOn) this.startMusic();
    else this.stopMusic();
  }

  private tone({ freq, to, type = 'sine', dur, vol = 0.3, delay = 0, attack = 0.005, vibrato, filter }: ToneOpts, bus?: GainNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 6;
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      node = osc.connect(f);
    }
    node.connect(g).connect(bus ?? this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise({ dur, vol = 0.3, delay = 0, freq = 2000, q = 1, type = 'bandpass' }: NoiseOpts, bus?: GainNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src
      .connect(f)
      .connect(g)
      .connect(bus ?? this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  play(name: Sfx, opt: { step?: number; speed?: number } = {}) {
    if (!this.sfxOn || !this.ctx || this.ctx.state !== 'running') return;
    switch (name) {
      case 'click':
        this.tone({ freq: 620, to: 920, dur: 0.07, vol: 0.18 });
        this.noise({ dur: 0.02, vol: 0.08, freq: 4000 });
        break;
      case 'pop':
        this.tone({ freq: 700, to: 1500, dur: 0.09, vol: 0.2, type: 'triangle' });
        break;
      case 'diceShake': {
        const total = 0.62 * (opt.speed ?? 1);
        for (let i = 0; i < 9; i++) {
          const d = (i / 9) * total + Math.random() * 0.03;
          this.noise({ dur: 0.035, vol: 0.22 + Math.random() * 0.12, delay: d, freq: 2200 + Math.random() * 1800, q: 3 });
          this.tone({ freq: 240 + Math.random() * 120, dur: 0.04, vol: 0.06, delay: d, type: 'square', filter: 900 });
        }
        break;
      }
      case 'diceLand':
        this.tone({ freq: 190, to: 80, dur: 0.16, vol: 0.45 });
        this.noise({ dur: 0.06, vol: 0.25, freq: 1400, q: 2 });
        this.noise({ dur: 0.04, vol: 0.15, freq: 3000, q: 4, delay: 0.07 });
        break;
      case 'hop': {
        const s = opt.step ?? 0;
        const f = NOTE(12 + PENTA[s % PENTA.length]);
        this.tone({ freq: f, to: f * 1.06, dur: 0.11, vol: 0.2, type: 'triangle' });
        this.noise({ dur: 0.025, vol: 0.06, freq: 5000, q: 2 });
        break;
      }
      case 'capture':
        this.tone({ freq: 360, to: 70, dur: 0.28, vol: 0.4, type: 'square', filter: 1400 });
        this.noise({ dur: 0.22, vol: 0.35, freq: 600, q: 0.8, type: 'lowpass' });
        this.tone({ freq: 1800, to: 300, dur: 0.38, vol: 0.12, delay: 0.08 });
        this.tone({ freq: NOTE(19), dur: 0.12, vol: 0.12, delay: 0.3, type: 'triangle' });
        this.tone({ freq: NOTE(24), dur: 0.18, vol: 0.12, delay: 0.38, type: 'triangle' });
        break;
      case 'captured':
        [7, 6, 5].forEach((n, i) => this.tone({ freq: NOTE(n - 5), dur: 0.26, vol: 0.18, delay: i * 0.28, type: 'sawtooth', filter: 1100 }));
        this.tone({ freq: NOTE(4 - 5), to: NOTE(2 - 5), dur: 0.85, vol: 0.2, delay: 0.84, type: 'sawtooth', filter: 1000, vibrato: 7 });
        break;
      case 'safe':
        this.tone({ freq: NOTE(24), dur: 0.35, vol: 0.12 });
        this.tone({ freq: NOTE(31), dur: 0.45, vol: 0.08, delay: 0.06 });
        break;
      case 'home':
        [0, 4, 7, 12, 16].forEach((n, i) => this.tone({ freq: NOTE(12 + n), dur: 0.22, vol: 0.18, delay: i * 0.075, type: 'triangle' }));
        this.noise({ dur: 0.5, vol: 0.05, freq: 8000, q: 1, delay: 0.3 });
        break;
      case 'six':
        [24, 28, 31, 36].forEach((n, i) => this.tone({ freq: NOTE(n), dur: 0.16, vol: 0.12, delay: i * 0.055 }));
        break;
      case 'turn':
        this.tone({ freq: NOTE(19), dur: 0.22, vol: 0.2, type: 'triangle' });
        this.tone({ freq: NOTE(24), dur: 0.35, vol: 0.2, delay: 0.13, type: 'triangle' });
        break;
      case 'win': {
        const mel = [
          [7, 0.12],
          [12, 0.12],
          [16, 0.12],
          [19, 0.3],
          [16, 0.12],
          [19, 0.6],
        ];
        let t = 0;
        for (const [n, d] of mel) {
          this.tone({ freq: NOTE(n + 12), dur: d + 0.05, vol: 0.2, delay: t, type: 'square', filter: 3000 });
          this.tone({ freq: NOTE(n), dur: d + 0.05, vol: 0.14, delay: t, type: 'triangle' });
          t += d;
        }
        this.noise({ dur: 1.2, vol: 0.06, freq: 7000, delay: 0.6 });
        break;
      }
      case 'lose':
        [12, 11, 9, 7].forEach((n, i) => this.tone({ freq: NOTE(n), dur: 0.3, vol: 0.15, delay: i * 0.25, type: 'triangle' }));
        break;
      case 'tick':
        this.tone({ freq: 1400, dur: 0.035, vol: 0.12, type: 'square', filter: 3000 });
        break;
      case 'noMove':
        this.tone({ freq: 260, to: 150, dur: 0.32, vol: 0.22, type: 'triangle' });
        break;
      case 'start':
        [0, 4, 7].forEach((n, i) => this.tone({ freq: NOTE(12 + n), dur: 0.15, vol: 0.18, delay: i * 0.12, type: 'triangle' }));
        this.tone({ freq: NOTE(24), dur: 0.4, vol: 0.2, delay: 0.38, type: 'square', filter: 2500 });
        break;
      case 'coin':
        this.tone({ freq: 988, dur: 0.08, vol: 0.14, type: 'square', filter: 4000 });
        this.tone({ freq: 1319, dur: 0.35, vol: 0.14, delay: 0.08, type: 'square', filter: 4000 });
        break;
      case 'error':
        this.tone({ freq: 140, dur: 0.18, vol: 0.2, type: 'sawtooth', filter: 600 });
        break;
      case 'whoosh':
        this.noise({ dur: 0.3, vol: 0.12, freq: 900, q: 0.7 });
        break;
      case 'join':
        this.tone({ freq: NOTE(16), dur: 0.12, vol: 0.15, type: 'triangle' });
        this.tone({ freq: NOTE(23), dur: 0.2, vol: 0.15, delay: 0.1, type: 'triangle' });
        break;
    }
  }

  // --- Background music: a gentle, bouncy pentatonic loop -------------------

  private startMusic() {
    if (!this.ctx || this.musicTimer || !this.musicOn) return;
    const ctx = this.ctx;
    this.musicBus.gain.cancelScheduledValues(ctx.currentTime);
    this.musicBus.gain.setTargetAtTime(0.5, ctx.currentTime, 0.6);
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 40);
  }

  private stopMusic() {
    if (!this.ctx || !this.musicTimer) return;
    clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  private scheduleMusic() {
    const ctx = this.ctx!;
    const beat = 60 / 108 / 2; // eighth notes at 108 bpm
    // 4 bars of chords (C, Am, F, G) with a playful melody
    const chords = [
      [0, 4, 7],
      [-3, 0, 4],
      [-7, -3, 0],
      [-5, -1, 2],
    ];
    const melody = [12, -1, 16, 19, -1, 16, 14, -1, 12, -1, 9, 12, -1, 16, 14, -1, 9, -1, 12, 14, -1, 12, 9, -1, 7, -1, 11, 14, 12, -1, -1, -1];
    // Browsers throttle timers in background tabs; skip the notes we missed instead of
    // firing them all at once when the tab wakes up.
    if (this.nextNoteTime < ctx.currentTime) this.nextNoteTime = ctx.currentTime + 0.05;
    if (typeof document !== 'undefined' && document.hidden) return;
    while (this.nextNoteTime < ctx.currentTime + 0.25) {
      const t = this.nextNoteTime - ctx.currentTime;
      const s = this.step % 32;
      const chord = chords[Math.floor(s / 8)];
      if (s % 4 === 0) this.tone({ freq: NOTE(chord[0] - 12), dur: beat * 1.6, vol: 0.13, delay: t, type: 'triangle' }, this.musicBus);
      if (s % 4 === 2) this.tone({ freq: NOTE(chord[0] - 5), dur: beat * 0.9, vol: 0.06, delay: t, type: 'triangle' }, this.musicBus);
      if (s % 8 === 0)
        chord.forEach((n) =>
          this.tone({ freq: NOTE(n + 12), dur: beat * 3.5, vol: 0.025, delay: t, type: 'sawtooth', attack: 0.08, filter: 900 }, this.musicBus),
        );
      if (s % 2 === 1) this.noise({ dur: 0.03, vol: 0.025, delay: t, freq: 8000, q: 1.5 }, this.musicBus);
      const m = melody[s];
      if (m >= 0 && this.step % 64 >= 32) this.tone({ freq: NOTE(m + 12), dur: beat * 0.9, vol: 0.05, delay: t, type: 'sine' }, this.musicBus);
      this.nextNoteTime += beat;
      this.step++;
    }
  }
}

export const sound = new SoundEngine();

export function haptic(pattern: number | number[]) {
  try {
    // Browsers block vibration until the user has interacted with the page.
    const active = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
    if (hapticsOn && active && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}

let hapticsOn = true;
export function setHaptics(on: boolean) {
  hapticsOn = on;
}
