import type { AudioCue, AudioOutput, AudioProvider, FlightAudioOptions, State, WorldEvent } from '@space-sim/game-api';

const STORAGE_KEY = 'space-sim.audio/1';
/** Browser controls and device lifecycle. Flight code supplies observations only. */
export class FlightAudio {
  private provider?: AudioProvider;
  private output?: AudioOutput;
  private enabled = true;
  private volume = .4;
  private activated = false;
  private pending?: Promise<void>;
  private failed = false;
  private active = true;
  private thrust = 0;
  private lastContact = -Infinity;
  private readonly listeners = new AbortController();

  private readonly toggle: HTMLButtonElement;
  private readonly slider: HTMLInputElement;
  private readonly statusElement: HTMLElement;
  private readonly document: Document;
  private disposed = false;
  constructor(private readonly options: FlightAudioOptions) {
    this.volume=options.defaultVolume??.4;this.enabled=options.defaultEnabled??true;
    if(!Number.isFinite(this.volume)||this.volume<0||this.volume>1)throw new Error('Default audio volume must be in [0,1]');
    this.toggle = options.toggle; this.slider = options.slider; this.statusElement = options.status;
    const document = this.document = options.toggle.ownerDocument;
    const window = document.defaultView;
    if (!window) throw new Error('Audio controls need a browser document');
    try {
      const saved = JSON.parse(options.storage?.getItem(STORAGE_KEY) ?? 'null');
      if (saved && typeof saved.enabled === 'boolean') this.enabled = saved.enabled;
      if (saved && typeof saved.volume === 'number' && Number.isFinite(saved.volume)) this.volume = Math.max(0, Math.min(1, saved.volume));
    } catch { /* Defaults remain usable without storage. */ }
    const signal = this.listeners.signal;
    this.toggle.addEventListener('click', () => {
      this.enabled = !this.enabled;
      if (this.enabled) { this.failed = false; this.activate(); } else this.output?.suspend();
      this.store(); this.sync();
    }, { signal });
    this.slider.value = String(Math.round(this.volume * 100));
    this.slider.addEventListener('input', () => {
      this.volume = Math.max(0, Math.min(1, this.slider.valueAsNumber / 100));
      this.output?.setVolume(this.volume);
      if (this.audible) this.activate(); else if (this.volume === 0) this.output?.suspend();
      this.store();
    }, { signal });
    const gesture = (event: Event): void => {
      if (event.isTrusted) this.activate();
    };
    document.addEventListener('pointerdown', gesture, { capture: true, signal });
    document.addEventListener('keydown', gesture, { capture: true, signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.output?.suspend(); else if (this.activated) this.activate();
    }, { signal });
    window.addEventListener('pagehide', () => this.output?.suspend(), { signal });
    this.sync();
  }
  setProvider(provider: AudioProvider | undefined): void {
    if (this.disposed) { if (provider) throw new Error('Audio controls disposed'); return; }
    if (this.provider === provider) return;
    this.output?.dispose(); this.output = undefined;
    this.provider = provider; this.pending = undefined; this.failed = false;
    if (this.activated) this.activate();
    this.sync();
  }
  /** level is effective local thrust, zero during pause, warp or an inactive game. */
  update(level: number, active: boolean): void {
    if (this.active !== active) {
      this.active = active;
      if (!active) this.output?.suspend(); else if (this.activated) this.activate();
    }
    this.thrust = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    this.output?.setThrust(this.audible ? this.thrust : 0);
  }
  play(cue: AudioCue): void { if (this.audible) this.output?.play(cue); }
  /** Establish a new ship/world baseline so saved or caught-up contacts do not replay. */
  reset(contactTime = -Infinity): void {
    this.lastContact = contactTime;
    this.thrust = 0;
    this.output?.setThrust(0);
  }
  contact(time: number, cue: 'land' | 'crash' | 'splash', live: boolean): void {
    if (time <= this.lastContact) return;
    this.lastContact = time;
    if (live) this.play(cue);
  }
  terrainContact(event: Extract<WorldEvent, {type: 'contact'}>, live: boolean): void {
    this.contact(event.contact.time, event.status === 'crashed' ? 'crash' : event.contact.material === 'water' ? 'splash' : 'land', live);
  }
  status(previous: State['status'], state: State, hasSurface: boolean, live: boolean): void {
    if (previous === 'flying' && state.status !== 'flying' && !hasSurface) this.contact(state.time, state.status === 'crashed' ? 'crash' : 'land', live);
  }
  flight(state: State, engine: boolean, fault: boolean, warp: number, paused: boolean, active: boolean): void {
    this.update(engine && !paused && state.status !== 'crashed' && !fault && warp === 1 ? state.throttle : 0, active);
  }
  dispose(): void {
    if (this.disposed) return;
    this.listeners.abort();
    try { this.setProvider(undefined); }
    finally { this.disposed = true; this.output = undefined; this.provider = undefined; this.pending = undefined; }
  }
  private get audible(): boolean { return this.enabled && this.volume > 0 && this.active && !this.document.hidden; }
  private activate(): void {
    if (this.disposed) return;
    this.activated = true;
    if (!this.enabled || this.volume === 0 || !this.active || this.document.hidden || !this.provider || this.pending || this.failed) return;
    try {
      this.output ??= this.provider.create();
      const output = this.output;
      output.setVolume(this.volume);
      this.pending = output.resume().then(() => {
        if (output !== this.output) return;
        if (!this.audible) output.suspend(); else output.setThrust(this.thrust);
      }).catch(() => {
        if (output !== this.output) return;
        this.failed = true; output.suspend(); this.sync();
      }).finally(() => { if (output === this.output) this.pending = undefined; });
    } catch {
      this.failed = true;
    }
    this.sync();
  }
  private sync(): void {
    this.toggle.textContent = this.failed ? 'Sound: unavailable' : this.enabled ? 'Sound: On' : 'Sound: Off';
    this.toggle.setAttribute('aria-pressed', String(this.enabled));
    this.statusElement.textContent = !this.provider ? 'Enable Procedural sound in ModMenu → Instruments & display.'
      : this.failed ? 'Audio could not start. Toggle sound off and on to retry.'
      : 'Engine rumble and flight cues. Volume is saved on this device.';
  }
  private store(): void {
    try { this.options.storage?.setItem(STORAGE_KEY, JSON.stringify({ enabled: this.enabled, volume: this.volume })); } catch { /* Optional. */ }
  }
}
