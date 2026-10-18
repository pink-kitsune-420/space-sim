import type { AudioCue, AudioOutput, AudioProvider } from '@space-sim/game-api';

const clamp = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Original sample-free synth. Noise is generated once; engine nodes are reused for the
 * output's lifetime. Only bounded, short notification/contact voices allocate on demand. */
export class ProceduralAudio implements AudioOutput {
  private context?: AudioContext;
  private master?: GainNode;
  private engine?: GainNode;
  private filter?: BiquadFilterNode;
  private rumble?: OscillatorNode;
  private noise?: AudioBuffer;
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
    const impact = cue === 'crash' || cue === 'land' || cue === 'splash';
    const source = cue === 'crash' || cue === 'splash' ? context.createBufferSource() : context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const duration = cue === 'crash' ? .5 : cue === 'splash' ? .32 : impact ? .55 : .12;
    if (source instanceof AudioBufferSourceNode) {
      source.buffer = this.noise!;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cue === 'splash' ? 1800 : 650, now);
      filter.frequency.exponentialRampToValueAtTime(90, now + duration);
    } else {
      source.type = 'sine';
      const falling = cue === 'pause';
      source.frequency.setValueAtTime(cue === 'land' ? 125 : cue === 'warp' ? 270 : falling ? 520 : 390, now);
      source.frequency.exponentialRampToValueAtTime(cue === 'land' ? 55 : cue === 'warp' ? 650 : falling ? 330 : 560,
        now + (cue === 'land' ? .18 : duration));
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(cue === 'land' ? .9 : impact ? .45 : .16, now + .008);
    // Give touchdown an audible body before its tail fades away.
    if (cue === 'land') gain.gain.exponentialRampToValueAtTime(.45, now + .12);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    this.voices.add(source);
    source.onended = () => {
      source.disconnect(); filter.disconnect(); gain.disconnect(); this.voices.delete(source);
    };
    source.start(now);
    source.stop(now + duration + .02);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of this.continuous) { source.stop(); source.disconnect(); }
    for (const source of this.voices) { source.stop(); source.disconnect(); }
    this.voices.clear(); this.continuous.length = 0;
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
    // Apply the latest target if activation happened after a flight update.
    const thrust = this.thrust;
    this.thrust = -1;
    this.setThrust(thrust);
  }
}

export const PROCEDURAL_AUDIO: AudioProvider = Object.freeze({
  id: 'builtin.audio', version: '0.1.0', label: 'Procedural sound',
  create: () => new ProceduralAudio(),
});
