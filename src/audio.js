// EVERCRAFT - fully synthesized audio (WebAudio). No sample files.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = true;
    this.volume = 0.7;
    this.musicVolume = 0.35;
    this._ambientNodes = null;
    this._musicTimer = 0;
    this._lastStep = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);
    this._buildNoise();
    this._startAmbient();
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusicVolume(v) { this.musicVolume = v; if (this.musicGain) this.musicGain.gain.value = v; }

  _buildNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // brown noise for wind
    const b2 = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d2 = b2.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d2[i] = last * 3.5; }
    this.brownBuf = b2;
  }

  _noiseSrc(brown) {
    const s = this.ctx.createBufferSource();
    s.buffer = brown ? this.brownBuf : this.noiseBuf;
    s.loop = true;
    return s;
  }

  // --------------------------------------------------------------- ambience
  _startAmbient() {
    const c = this.ctx;
    const wind = this._noiseSrc(true);
    const wf = c.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 420;
    const wg = c.createGain(); wg.gain.value = 0.0;
    wind.connect(wf).connect(wg).connect(this.master);
    wind.start();

    const cave = this._noiseSrc(true);
    const cf = c.createBiquadFilter();
    cf.type = 'bandpass'; cf.frequency.value = 120; cf.Q.value = 1.2;
    const cg = c.createGain(); cg.gain.value = 0;
    cave.connect(cf).connect(cg).connect(this.master);
    cave.start();

    this._ambientNodes = { windGain: wg, windFilter: wf, caveGain: cg };
  }

  /** t: 0..1 day fraction, underground: bool, biomeWind 0..1 */
  updateAmbient(dayT, underground, windAmt, dt) {
    if (!this.ctx || !this._ambientNodes) return;
    const n = this._ambientNodes;
    const target = underground ? 0.0 : 0.020 + windAmt * 0.045;
    n.windGain.gain.value += (target - n.windGain.gain.value) * Math.min(1, dt * 0.6);
    const ct = underground ? 0.030 : 0.0;
    n.caveGain.gain.value += (ct - n.caveGain.gain.value) * Math.min(1, dt * 0.5);
    n.windFilter.frequency.value = 300 + windAmt * 400;
  }

  // ------------------------------------------------------------------- sfx
  _env(g, t0, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  tone(freq, dur = 0.12, type = 'sine', vol = 0.25, slide = 0, delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    const g = c.createGain();
    this._env(g, t0, 0.008, dur, vol);
    o.connect(g).connect(this.sfxGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  noiseBurst(dur = 0.1, freq = 900, q = 1, vol = 0.3, type = 'bandpass', delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    this._env(g, t0, 0.006, dur, vol);
    s.connect(f).connect(g).connect(this.sfxGain);
    s.start(t0); s.stop(t0 + dur + 0.06);
  }

  /** material-flavoured mining tick */
  dig(material, progress = 0) {
    const p = 1 + progress * 0.4;
    switch (material) {
      case 'stone': this.noiseBurst(0.055, 1100 * p, 3.5, 0.16); this.tone(150 * p, 0.04, 'square', 0.05); break;
      case 'wood': this.noiseBurst(0.06, 480 * p, 2.2, 0.16); this.tone(190 * p, 0.05, 'triangle', 0.07); break;
      case 'dirt': this.noiseBurst(0.07, 320 * p, 1.1, 0.15); break;
      case 'sand': this.noiseBurst(0.075, 2600 * p, 0.8, 0.10, 'highpass'); break;
      case 'grass': this.noiseBurst(0.06, 1600 * p, 0.9, 0.11, 'highpass'); break;
      case 'metal': this.noiseBurst(0.05, 2200 * p, 6, 0.12); this.tone(620 * p, 0.06, 'square', 0.06); break;
      case 'glass': this.tone(1800 * p, 0.05, 'sine', 0.10); break;
      case 'wool': this.noiseBurst(0.07, 700, 0.8, 0.08, 'lowpass'); break;
      default: this.noiseBurst(0.05, 900 * p, 2, 0.12);
    }
  }

  break_(material) {
    switch (material) {
      case 'stone': this.noiseBurst(0.22, 900, 1.6, 0.34); this.tone(110, 0.16, 'square', 0.10, -50); break;
      case 'wood': this.noiseBurst(0.20, 420, 1.4, 0.32); this.tone(150, 0.16, 'triangle', 0.13, -60); break;
      case 'glass': for (let i = 0; i < 5; i++) this.tone(1400 + Math.random() * 1800, 0.09, 'sine', 0.10, -300, i * 0.02); break;
      case 'sand': this.noiseBurst(0.22, 2200, 0.7, 0.24, 'highpass'); break;
      case 'grass': this.noiseBurst(0.18, 1300, 0.8, 0.24, 'highpass'); break;
      case 'metal': this.noiseBurst(0.18, 1800, 4, 0.24); this.tone(420, 0.18, 'square', 0.10, -180); break;
      case 'wool': this.noiseBurst(0.16, 600, 0.7, 0.18, 'lowpass'); break;
      default: this.noiseBurst(0.18, 800, 1.5, 0.28);
    }
  }

  place(material) {
    this.break_(material === 'glass' ? 'stone' : material);
    this.tone(material === 'stone' ? 220 : 300, 0.07, 'triangle', 0.10, 40);
  }

  step(material) {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (now - this._lastStep < 0.16) return;
    this._lastStep = now;
    const v = 0.10;
    switch (material) {
      case 'stone': this.noiseBurst(0.05, 700 + Math.random() * 200, 2, v); break;
      case 'wood': this.noiseBurst(0.06, 380, 1.6, v); break;
      case 'sand': this.noiseBurst(0.07, 2400, 0.7, v * 0.8, 'highpass'); break;
      case 'snow': this.noiseBurst(0.06, 3000, 0.6, v * 0.7, 'highpass'); break;
      case 'water': this.noiseBurst(0.11, 900, 0.8, v * 0.9, 'lowpass'); break;
      default: this.noiseBurst(0.055, 260 + Math.random() * 120, 1.2, v);
    }
  }

  jump() { this.tone(320, 0.08, 'sine', 0.07, 90); }
  land(material) { this.step(material); this.tone(120, 0.1, 'sine', 0.10, -40); }
  hurt() {
    this.tone(240, 0.16, 'sawtooth', 0.20, -110);
    this.noiseBurst(0.12, 420, 1.2, 0.16);
  }
  heal() { [520, 660, 790].forEach((f, i) => this.tone(f, 0.14, 'sine', 0.10, 0, i * 0.06)); }
  pickup() { this.tone(720, 0.07, 'triangle', 0.11, 260); this.tone(980, 0.06, 'sine', 0.07, 180, 0.05); }
  craft() { [420, 560, 700, 880].forEach((f, i) => this.tone(f, 0.11, 'triangle', 0.11, 0, i * 0.045)); }
  smelt() { this.noiseBurst(0.5, 260, 0.6, 0.09, 'lowpass'); }
  open() { this.tone(380, 0.1, 'triangle', 0.12, -80); this.noiseBurst(0.09, 520, 1.4, 0.10); }
  close() { this.tone(300, 0.1, 'triangle', 0.12, -60); this.noiseBurst(0.08, 400, 1.4, 0.10); }
  /** Chest lid: a wooden creak with an iron latch tick. */
  chest(open) {
    // latch
    this.noiseBurst(0.05, open ? 2600 : 2200, 1.6, 0.09, 'highpass');
    // hinge creak sweeping up when opening, down when closing
    this.tone(open ? 210 : 260, 0.26, 'sawtooth', 0.055, open ? 90 : -80, 0.02);
    this.tone(open ? 330 : 300, 0.18, 'triangle', 0.045, open ? 70 : -60, 0.03);
    // dull wooden body thump
    this.noiseBurst(0.16, open ? 420 : 340, 1.1, 0.11, 'lowpass', 0.04);
  }

  door(open) {
    this.noiseBurst(0.22, open ? 700 : 500, 1.1, 0.14);
    this.tone(open ? 260 : 200, 0.2, 'sawtooth', 0.06, open ? 60 : -50);
  }
  hitEntity() { this.noiseBurst(0.09, 500, 1.2, 0.24); this.tone(180, 0.1, 'square', 0.12, -70); }
  splash() { this.noiseBurst(0.35, 1200, 0.5, 0.24, 'lowpass'); this.noiseBurst(0.2, 2600, 0.6, 0.10, 'highpass', 0.03); }
  fizz() { this.noiseBurst(0.6, 1800, 0.4, 0.16, 'highpass'); }
  eat() { for (let i = 0; i < 3; i++) this.noiseBurst(0.08, 300, 1.6, 0.13, 'lowpass', i * 0.13); }
  error() { this.tone(180, 0.14, 'square', 0.12, -40); }
  click() { this.tone(660, 0.035, 'square', 0.06); }

  // creature voices
  crit(kind) {
    switch (kind) {
      case 'hopper': this.tone(700 + Math.random() * 120, 0.1, 'triangle', 0.10, 180); break;
      case 'woolback': this.tone(300, 0.3, 'sawtooth', 0.09, -60); break;
      case 'tusker': this.tone(150, 0.35, 'sawtooth', 0.12, -40); break;
      case 'plume': this.tone(1100, 0.07, 'sine', 0.07, 320); this.tone(1400, 0.06, 'sine', 0.05, 200, 0.07); break;
      case 'husk': this.tone(110, 0.5, 'sawtooth', 0.11, -30); this.noiseBurst(0.4, 200, 0.9, 0.08); break;
      case 'creeplet': this.noiseBurst(0.5, 1600, 0.5, 0.10, 'highpass'); break;
      case 'shardling': this.tone(880, 0.2, 'square', 0.07, -300); break;
      case 'gloom': this.noiseBurst(0.7, 300, 0.5, 0.10, 'bandpass'); this.tone(90, 0.6, 'sine', 0.08, -20); break;
    }
  }
  explode() {
    this.noiseBurst(0.7, 180, 0.5, 0.5, 'lowpass');
    this.noiseBurst(0.4, 900, 0.6, 0.3);
    this.tone(70, 0.6, 'sine', 0.3, -30);
  }

  /** Gentle music-box lullaby for the sleep cinematic. */
  sleep() {
    if (!this.ctx || !this.enabled) return;
    const notes = [523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 392.0];
    const t0 = this.ctx.currentTime + 0.08;
    notes.forEach((f, i) => {
      this.tone(f, 0.9, 'sine', 0.05, 0, 0.25 + i * 0.34);
      this.tone(f * 2, 0.5, 'sine', 0.022, 0, 0.25 + i * 0.34);
    });
    // deep sleep drone underneath
    this.tone(98, 6.5, 'sine', 0.028, -6, 0.15);
  }

  /** Slow, solemn descent for the death cinematic. */
  death() {
    if (!this.ctx || !this.enabled) return;
    this.tone(220, 1.1, 'sine', 0.14, -90);
    this.tone(110, 1.6, 'sine', 0.12, -40, 0.12);
    this.noiseBurst(1.4, 140, 0.5, 0.10, 'lowpass', 0.1);
    // distant bell
    this.tone(440, 2.2, 'sine', 0.05, -4, 0.5);
    this.tone(659.25, 2.4, 'sine', 0.035, -5, 0.72);
  }

  /** Soft chime for a level-up (extends the old single arpeggio). */
  levelUp() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.26, 'triangle', 0.12, 0, i * 0.085)); }

  /**
   * Title-screen theme: a slow, hopeful motif that loops while the menu sits
   * over the flyover. `warm` (0..1) blends the arpeggio register.
   */
  menuTick(bar) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime;
    const root = 261.63;                       // C4
    const prog = [[0, 4, 7, 12], [5, 9, 12, 17], [3, 7, 10, 15], [4, 9, 12, 16]];
    const chord = prog[bar % 4];
    const semi = n => Math.pow(2, n / 12);
    // warm pad
    chord.forEach((d, i) => {
      this.tone(root * semi(d) * 0.5, 3.4, 'sine', 0.024, 0, 0);
      this.tone(root * semi(d) * 0.5, 3.4, 'sine', 0.02, 0, 0.02);
    });
    // gentle arpeggio on the off-beats
    const offs = [0.5, 1.0, 1.5, 2.5, 3.0];
    offs.forEach((o, i) => {
      const d = chord[i % chord.length];
      this.tone(root * semi(d) * 2, 0.8, 'triangle', 0.034, 0, o);
    });
  }

  // ------------------------------------------------------------------ music
  /**
   * Generative ambient score.
   *
   * Rather than firing unrelated random notes, this builds real music: a
   * looping chord progression drives a warm pad, a soft bass root, and a
   * melody that is constrained to the current chord's tones so it always
   * sounds consonant. Phrases are scheduled a bar at a time on the WebAudio
   * clock (not setTimeout) so timing stays rock-steady, and the mood shifts
   * between day / night / danger by swapping progression, register and timbre.
   */
  _musicInit() {
    if (this._musicBus) return;
    const c = this.ctx;
    // shared reverb-ish send: a short feedback delay gives the pads air
    const send = c.createGain(); send.gain.value = 0.34;
    const dly = c.createDelay(1.2); dly.delayTime.value = 0.38;
    const fb = c.createGain(); fb.gain.value = 0.36;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 2200;
    send.connect(dly); dly.connect(fb); fb.connect(dly);
    dly.connect(tone); tone.connect(this.musicGain);
    this._musicBus = { send };
    this._nextBar = 0;
    this._barIndex = 0;
    this._prevMood = null;
  }

  /** one voice: osc -> filter -> env -> (dry + send) */
  _voice(t0, freq, dur, opts = {}) {
    const c = this.ctx;
    const {
      type = 'triangle', peak = 0.08, attack = 0.06, release = null,
      cutoff = 1800, detune = 0, wet = 0.5, glide = 0,
    } = opts;
    const o = c.createOscillator();
    o.type = type;
    o.detune.value = detune;
    if (glide) {
      o.frequency.setValueAtTime(freq * glide, t0);
      o.frequency.exponentialRampToValueAtTime(freq, t0 + 0.12);
    } else {
      o.frequency.setValueAtTime(freq, t0);
    }
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(cutoff, t0);
    flt.Q.value = 0.6;
    const g = c.createGain();
    const rel = release ?? dur * 0.7;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + rel);
    o.connect(flt).connect(g);
    g.connect(this.musicGain);
    if (this._musicBus && wet > 0) {
      const w = c.createGain(); w.gain.value = wet;
      g.connect(w).connect(this._musicBus.send);
    }
    o.start(t0);
    o.stop(t0 + dur + rel + 0.05);
    return o;
  }

  /**
   * Schedule music one bar ahead. Call every frame; it self-throttles.
   * @param dayT 0..1 through the day
   * @param danger truthy when hostiles are near
   */
  updateMusic(dt, dayT, danger) {
    if (!this.ctx || !this.enabled || !this.musicGain) return;
    this._musicInit();
    const c = this.ctx;
    const now = c.currentTime;

    const night = dayT > 0.76 || dayT < 0.20;
    const mood = danger ? 'danger' : night ? 'night' : 'day';

    // --- mood definitions: root, chord degrees, tempo, timbre
    const MOODS = {
      day: {
        root: 130.81,                       // C3
        prog: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [2, 5, 9]],  // I  IV  V  ii
        bpm: 68, padType: 'triangle', leadType: 'sine',
        leadChance: 0.72, cutoff: 2400, peak: 0.055,
      },
      night: {
        root: 110.0,                        // A2
        prog: [[0, 3, 7], [-2, 3, 8], [5, 8, 12], [-4, 3, 7]],  // i  VI  iv  VII
        bpm: 52, padType: 'sine', leadType: 'sine',
        leadChance: 0.55, cutoff: 1500, peak: 0.05,
      },
      danger: {
        root: 98.0,                         // G2
        prog: [[0, 3, 6], [0, 1, 6], [-2, 3, 6], [0, 3, 7]],    // dim / tritone colour
        bpm: 84, padType: 'sawtooth', leadType: 'triangle',
        leadChance: 0.38, cutoff: 1100, peak: 0.045,
      },
    };
    const M = MOODS[mood];
    const beat = 60 / M.bpm;
    const bar = beat * 4;

    // mood switch: restart the phrase cleanly on the next bar
    if (mood !== this._prevMood) {
      this._prevMood = mood;
      this._barIndex = 0;
      if (this._nextBar < now) this._nextBar = now + 0.12;
    }
    if (this._nextBar === 0) this._nextBar = now + 0.15;
    // only schedule when the next bar is close (keeps the queue shallow)
    if (this._nextBar > now + bar * 0.75) return;

    const t0 = Math.max(this._nextBar, now + 0.05);
    const semi = n => Math.pow(2, n / 12);
    const chord = M.prog[this._barIndex % M.prog.length];
    const nextChord = M.prog[(this._barIndex + 1) % M.prog.length];

    // ---- bass: root on beat 1, fifth on beat 3 (skipped when tense)
    this._voice(t0, M.root * semi(chord[0]) * 0.5, beat * 1.6, {
      type: 'sine', peak: 0.085, attack: 0.02, cutoff: 520, wet: 0.18,
    });
    if (mood !== 'danger') {
      this._voice(t0 + beat * 2, M.root * semi(chord[2]) * 0.5, beat * 1.2, {
        type: 'sine', peak: 0.055, attack: 0.03, cutoff: 480, wet: 0.18,
      });
    }

    // ---- pad: the full chord, slow swell, slightly detuned for width
    for (let i = 0; i < chord.length; i++) {
      const f = M.root * semi(chord[i]);
      this._voice(t0, f, bar * 0.72, {
        type: M.padType, peak: M.peak, attack: bar * 0.22,
        cutoff: M.cutoff, detune: (i - 1) * 5, wet: 0.75,
      });
    }

    // ---- melody: 0-3 notes drawn from the chord (plus the 9th for colour),
    // placed on off-beats so it breathes against the pad
    if (Math.random() < M.leadChance) {
      const tones = [...chord, chord[0] + 12, chord[1] + 12, chord[0] + 14];
      const slots = [1, 1.5, 2, 2.5, 3, 3.5];
      const count = 1 + ((Math.random() * 3) | 0);
      const used = new Set();
      for (let i = 0; i < count; i++) {
        const sl = slots[(Math.random() * slots.length) | 0];
        if (used.has(sl)) continue;
        used.add(sl);
        const deg = tones[(Math.random() * tones.length) | 0];
        const f = M.root * semi(deg) * 2;
        this._voice(t0 + sl * beat, f, beat * (0.5 + Math.random() * 0.6), {
          type: M.leadType, peak: 0.05, attack: 0.05,
          cutoff: M.cutoff + 700, wet: 0.85,
        });
      }
    }

    // ---- a soft leading tone into the next chord on the last eighth
    if (Math.random() < 0.4) {
      this._voice(t0 + beat * 3.5, M.root * semi(nextChord[0]) * 2, beat * 0.45, {
        type: 'sine', peak: 0.03, attack: 0.04, cutoff: 2000, wet: 0.9,
      });
    }

    this._nextBar = t0 + bar;
    this._barIndex++;
  }
}
