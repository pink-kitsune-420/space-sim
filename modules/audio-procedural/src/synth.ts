import type { AudioCue, AudioOutput, AudioProvider } from '@space-sim/game-api';

const CUES: readonly AudioCue[] = ['confirm', 'pause', 'resume', 'warp', 'land', 'crash', 'splash'];
const clamp = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Original sample-free synth. Noise and each short cue are rendered once; engine nodes are
 * reused for the output's lifetime. Only bounded notification/contact voices allocate on demand. */
export class ProceduralAudio implements AudioOutput {
  private context?: AudioContext;
  private master?: GainNode;
  private engine?: GainNode;
  private filter?: BiquadFilterNode;
  private rumble?: OscillatorNode;
  private noise?: AudioBuffer;
  private readonly cues = new Map<AudioCue, AudioBuffer>();
  private readonly continuous: AudioScheduledSourceNode[] = [];
  private readonly voices = new Set<AudioScheduledSourceNode>();
  private volume = .4;
  private thrust = 0;
  private lastCue = -Infinity;
  private disposed = false;

  async resume(): Promise<void> {
    if (this.disposed) return;
    if (!this.context) this.initialize();
    if (this.context!.state !== 'running') await this.context!.resume();
  }
  suspend(): void {
    this.setThrust(0);
    for (const voice of this.voices) voice.stop();
    this.voices.clear();
    if (this.context && this.context.state !== 'closed') void this.context.suspend().catch(() => {});
  }
  setVolume(level: number): void {
    this.volume = clamp(level);
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, .02);
  }
  setThrust(level: number): void {
    const next = clamp(level);
    if (next === this.thrust) return;
    this.thrust = next;
    const context = this.context;
    if (!context || !this.engine || !this.filter || !this.rumble) return;
    const now = context.currentTime;
    this.engine.gain.setTargetAtTime(Math.sqrt(next) * .6, now, next > 0 ? .055 : .04);
    this.filter.frequency.setTargetAtTime(180 + next * 1050, now, .08);
    this.rumble.frequency.setTargetAtTime(38 + next * 30, now, .08);
  }
  play(cue: AudioCue): void {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.master || this.voices.size >= 8) return;
    const now = context.currentTime;
    if (now - this.lastCue < .06) return;
    this.lastCue = now;
    const source = context.createBufferSource();
    source.buffer = this.cue(cue);
    source.connect(this.master);
    this.voices.add(source);
    source.onended = () => { source.disconnect(); this.voices.delete(source); };
    source.start();
  }
  /** Render a cue's envelope, sweep and lowpass once (the former per-voice node graph). */
  private cue(cue: AudioCue): AudioBuffer {
    const cached = this.cues.get(cue);
    if (cached) return cached;
    const context = this.context!, rate = context.sampleRate;
    const impact = cue === 'crash' || cue === 'land' || cue === 'splash';
    const noisy = cue === 'crash' || cue === 'splash';
    const duration = cue === 'crash' ? .5 : cue === 'splash' ? .32 : impact ? .55 : .12;
    const peak = cue === 'land' ? .9 : impact ? .45 : .16;
    const falling = cue === 'pause';
    const pitch = cue === 'land' ? 125 : cue === 'warp' ? 270 : falling ? 520 : 390;
    const pitchEnd = cue === 'land' ? 55 : cue === 'warp' ? 650 : falling ? 330 : 560, sweep = cue === 'land' ? .18 : duration;
    const cutoff = cue === 'splash' || !noisy ? 1800 : 650, cutoffEnd = noisy ? 90 : cutoff;
    const buffer = context.createBuffer(1, Math.ceil(rate * (duration + .02)), rate);
    const out = buffer.getChannelData(0), noise = this.noise!.getChannelData(0);
    // Linear attack, then exponential fades; touchdown keeps an audible body first. Sweeps
    // and fades step by constant ratios, keeping a render well under a millisecond.
    const attack = .008 * rate, end = duration * rate, sweepEnd = sweep * rate;
    const body = cue === 'land' ? .45 : .0001, bodyEnd = (cue === 'land' ? .12 : duration) * rate;
    const fade = (body / peak) ** (1 / (bodyEnd - attack)), tail = bodyEnd < end ? (.0001 / body) ** (1 / (end - bodyEnd)) : 1;
    const pitchStep = (pitchEnd / pitch) ** (1 / sweepEnd), cutoffStep = (cutoffEnd / cutoff) ** (1 / end);
    // Web Audio's lowpass biquad with its default Q of 1 dB; the corner glides slowly
    // enough to refresh coefficients every 32 samples.
    const resonance = 2 * 10 ** (1 / 20);
    let frequency = pitch, corner = cutoff, level = peak / fade, phase = 0;
    let b0 = 0, b1 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      if ((i & 31) === 0) {
        const w = 2 * Math.PI * corner / rate, cos = Math.cos(w), alpha = Math.sin(w) / resonance, a0 = 1 + alpha;
        b0 = (1 - cos) / 2 / a0; b1 = (1 - cos) / a0; a1 = 2 * cos / a0; a2 = (1 - alpha) / a0;
      }
      const input = noisy ? noise[i]! : Math.sin(phase);
      if (!noisy) { phase += 2 * Math.PI * frequency / rate; if (i < sweepEnd) frequency *= pitchStep; }
      if (i < end) corner *= cutoffStep;
      const y = b0 * (input + x2) + b1 * x1 + a1 * y1 - a2 * y2;
      x2 = x1; x1 = input; y2 = y1; y1 = y;
      out[i] = y * (i < attack ? peak * i / attack : (level *= i < bodyEnd ? fade : i < end ? tail : 1));
    }
    this.cues.set(cue, buffer);
    return buffer;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of this.continuous) { source.stop(); source.disconnect(); }
    for (const source of this.voices) { source.stop(); source.disconnect(); }
    this.voices.clear(); this.continuous.length = 0; this.cues.clear();
    this.master?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = undefined;
  }
  private initialize(): void {
    const context = this.context = new AudioContext();
    const master = this.master = context.createGain();
    master.gain.value = this.volume;
    master.connect(context.destination);
    const noise = this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 2), context.sampleRate);
    const samples = noise.getChannelData(0);
    let seed = 0x51ac3b27;
    for (let i = 0; i < samples.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      samples[i] = (seed >>> 0) / 0x80000000 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = noise; source.loop = true;
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass'; highpass.frequency.value = 25;
    const filter = this.filter = context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 180;
    const engine = this.engine = context.createGain();
    engine.gain.value = 0;
    source.connect(highpass).connect(filter).connect(engine).connect(master);
    const rumble = this.rumble = context.createOscillator();
    rumble.type = 'sine'; rumble.frequency.value = 38;
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = .16;
    rumble.connect(rumbleGain).connect(engine);
    this.continuous.push(source, rumble);
    source.start(); rumble.start();
    for (const cue of CUES) this.cue(cue);
    const thrust = this.thrust;
    this.thrust = -1;
    this.setThrust(thrust);
  }
}

export const PROCEDURAL_AUDIO: AudioProvider = Object.freeze({
  id: 'builtin.audio', version: '0.1.0', label: 'Procedural sound',
  create: () => new ProceduralAudio(),
});
