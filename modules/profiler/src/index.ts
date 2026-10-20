import { PROFILERS, type FrameProfiler, type ModuleInitializationV2, type ProfilerFactory, type ProfilerOptions, type ProfileStats, type ProfileSummary, type ProfileEvent } from '@space-sim/game-api';

/** Timed parts of one frame, in the order the frame runs them. */
export const SECTIONS = ['physics', 'prediction', 'background', 'planet', 'path', 'ship', 'overlay', 'hud'] as const;
export type Section = typeof SECTIONS[number];
export type Stats = ProfileStats;
export type Summary = ProfileSummary;
export type LogEvent = ProfileEvent;

const CAPACITY = 600;          // ten seconds of frames at 60 Hz
const EVENT_CAPACITY = 1000;
/** Game work above this leaves too little of a 60-Hz frame for the browser. */
const LONG_WORK_MS = 11;
const INDEX = Object.fromEntries(SECTIONS.map((s, i) => [s, i])) as Record<Section, number>;
const COLORS: Record<Section, string> = { physics: '#e0a665', prediction: '#8ddbc1', background: '#4f6d83',
  planet: '#5fa8d3', path: '#b39ddb', ship: '#e8f8ef', overlay: '#f4d35e', hud: '#ef8c7a' };

const sortScratch = new Float64Array(CAPACITY);

function stats(values: Float64Array, count: number): Stats {
  if (count === 0) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = sortScratch.subarray(0, count);
  sorted.set(values.subarray(0, count));
  sorted.sort();
  let sum = 0;
  for (let i = 0; i < count; i++) sum += sorted[i]!;
  const at = (q: number): number => sorted[Math.min(count - 1, Math.floor(count * q))]!;
  return { avg: sum / count, p50: at(.5), p95: at(.95), p99: at(.99), max: sorted[count - 1]! };
}

/** Per-frame section timings in fixed ring buffers plus a bounded event log. */
export class Profiler implements FrameProfiler {
  /** Read back one canvas pixel at every lap so deferred raster work lands in the section
   * that queued it. Slower, and Chromium may keep the canvas unaccelerated until reload. */
  private disposed = false;
  private readonly longWorkMs: number;
  private readonly hitchMs:number;
  private readonly hitchRatio:number;
  private readonly graphMs:number;
  precise = false;
  readonly startedAt = new Date();
  private readonly sections = SECTIONS.map(() => new Float64Array(CAPACITY));
  private readonly work = new Float64Array(CAPACITY);
  private readonly interval = new Float64Array(CAPACITY);
  private readonly starts = new Float64Array(CAPACITY);
  private readonly current = new Float64Array(SECTIONS.length);
  private readonly groupTotals = new Float64Array(CAPACITY);
  private readonly events: LogEvent[] = [];
  private frames = 0;
  private start = 0;
  private mark = 0;
  private frameInterval = 0;
  private typicalInterval = 0;
  private slow = 0;
  private cachedSummary: Summary | undefined;
  private cachedSummaryFrame = -1;
  lastSlow: LogEvent | undefined;
  constructor(private readonly flush: () => void = () => {}, options: ProfilerOptions = {}) {
    this.longWorkMs=options.longWorkMs??LONG_WORK_MS;
    if(!Number.isFinite(this.longWorkMs)||this.longWorkMs<1||this.longWorkMs>1000)throw new Error('Profiler work threshold must be in [1,1000] ms');
    this.hitchMs=options.hitchMs??25;this.hitchRatio=options.hitchRatio??2.5;this.graphMs=options.graphMs??33.4;
    if(![this.hitchMs,this.hitchRatio,this.graphMs].every(Number.isFinite)||this.hitchMs<1||this.hitchMs>1000||this.hitchRatio<1||this.hitchRatio>10||this.graphMs<8||this.graphMs>1000)throw new Error('Invalid profiler timing configuration');
    this.precise=options.precise??false;
  }
  dispose(): void {if(this.disposed)return;this.disposed=true;this.frames=0;this.slow=0;this.events.length=0;this.cachedSummary=undefined;this.lastSlow=undefined;}

  begin(intervalMs: number): void {
    if(this.disposed)return;
    this.current.fill(0);
    this.frameInterval = intervalMs;
    this.start = this.mark = performance.now();
  }
  lap(section: Section): void {
    if(this.disposed)return;
    if (this.precise) this.flush();
    const now = performance.now();
    this.current[INDEX[section]]! += now - this.mark;
    this.mark = now;
  }
  end(): void {
    if(this.disposed)return;
    const slot = this.frames % CAPACITY, previous = (this.frames + CAPACITY - 1) % CAPACITY;
    const work = this.mark - this.start, interval = this.frameInterval;
    for (let i = 0; i < SECTIONS.length; i++) this.sections[i]![slot] = this.current[i]!;
    this.work[slot] = work;
    this.interval[slot] = interval;
    this.starts[slot] = this.start;
    // A hitch shows up as a long interval before this frame: blame the previous frame's work.
    const long = work > this.longWorkMs;
    const hitch = this.frames > 30 && interval > this.hitchMs && interval > this.hitchRatio * this.typicalInterval;
    if (long || hitch) {
      const at = long ? slot : previous, cost = this.work[at]!;
      let top: Section = 'physics';
      for (const s of SECTIONS) if (this.sections[INDEX[s]]![at]! > this.sections[INDEX[top]]![at]!) top = s;
      const breakdown = Object.fromEntries(SECTIONS.map(s => [s, +this.sections[INDEX[s]]![at]!.toFixed(2)]));
      this.slow++;
      this.lastSlow = this.event('slow-frame', { intervalMs: +interval.toFixed(2), workMs: +cost.toFixed(2),
        cause: long || cost > Math.max(4, interval / 3) ? top : 'outside game work (browser, GC or compositor)', breakdown });
    }
    if (interval > 0) this.typicalInterval = this.typicalInterval ? this.typicalInterval * .95 + Math.min(interval, 50) * .05 : interval;
    this.frames++;
  }
  event(type: string, detail: Record<string, unknown> = {}): LogEvent {
    const entry: LogEvent = { t: +(performance.now() / 1000).toFixed(3), type, ...detail };
    if(this.disposed)return entry;
    this.events.push(entry);
    if (this.events.length > EVENT_CAPACITY) this.events.shift();
    return entry;
  }
  summary(): Summary {
    if (this.cachedSummary && this.cachedSummaryFrame === this.frames) {
      return this.cachedSummary;
    }
    const count = Math.min(this.frames, CAPACITY);
    const interval = stats(this.interval, count);
    const result: Summary = { frames: this.frames, fps: interval.avg > 0 ? 1000 / interval.avg : 0, interval,
      work: stats(this.work, count), slowFrames: this.slow,
      sections: Object.fromEntries(SECTIONS.map(s => [s, stats(this.sections[INDEX[s]]!, count)])) as Record<Section, Stats> };
    this.cachedSummary = result;
    this.cachedSummaryFrame = this.frames;
    return result;
  }
  /** Statistics of the per-frame sum of several sections (not the sum of their percentiles). */
  group(sections: readonly Section[]): Stats {
    const count = Math.min(this.frames, CAPACITY);
    const totals = this.groupTotals.subarray(0, count);
    totals.fill(0);
    for (const s of sections) { const values = this.sections[INDEX[s]]!; for (let i = 0; i < count; i++) totals[i]! += values[i]!; }
    return stats(totals, count);
  }
  /** Oldest-first copy of the retained frames, for export. */
  history(): Array<Record<string, number>> {
    const count = Math.min(this.frames, CAPACITY), out: Array<Record<string, number>> = [];
    for (let k = 0; k < count; k++) {
      const i = (this.frames - count + k) % CAPACITY;
      const row: Record<string, number> = { t: +(this.starts[i]! / 1000).toFixed(4),
        intervalMs: +this.interval[i]!.toFixed(3), workMs: +this.work[i]!.toFixed(3) };
      for (const s of SECTIONS) row[s] = +this.sections[INDEX[s]]![i]!.toFixed(3);
      out.push(row);
    }
    return out;
  }
  log(): readonly LogEvent[] { return this.events; }

  /** Stacked per-section bars for the most recent frames, newest on the right. */
  drawGraph(graph: HTMLCanvasElement): void {
    if(this.disposed)return;
    const width = graph.clientWidth, height = graph.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (graph.width !== Math.round(width * dpr) || graph.height !== Math.round(height * dpr)) {
      graph.width = Math.round(width * dpr); graph.height = Math.round(height * dpr);
    }
    const ctx = graph.getContext('2d');
    if (!ctx || width === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const msToY = height / this.graphMs; // two 60-Hz frames tall
    const columns = Math.min(Math.floor(width), Math.min(this.frames, CAPACITY));
    for (let c = 0; c < columns; c++) {
      const i = (this.frames - columns + c) % CAPACITY;
      let y = height;
      for (const s of SECTIONS) {
        const h = this.sections[INDEX[s]]![i]! * msToY;
        if (h <= 0) continue;
        ctx.fillStyle = COLORS[s]; ctx.fillRect(width - columns + c, y - h, 1, h); y -= h;
      }
      const intervalY = height - this.interval[i]! * msToY;
      ctx.fillStyle = '#ffffff55'; ctx.fillRect(width - columns + c, Math.max(0, intervalY), 1, 1);
    }
    ctx.fillStyle = '#ef8c7a80'; ctx.fillRect(0, height - 16.7 * msToY, width, 1);
  }
}

/** Overlay table rows, created once and updated in place. */
export function createRows(body: HTMLElement): (summary: Summary) => void {
  const cells = new Map<string, HTMLTableCellElement[]>();
  for (const name of [...SECTIONS, 'work', 'interval']) {
    const row = body.ownerDocument.createElement('tr');
    const label = body.ownerDocument.createElement('th');
    label.scope = 'row';
    label.textContent = name;
    if (name in COLORS) label.style.setProperty('--swatch', COLORS[name as Section]);
    else label.className = 'total';
    row.append(label);
    const values = [0, 1, 2].map(() => row.appendChild(body.ownerDocument.createElement('td')));
    cells.set(name, values);
    body.append(row);
  }
  return summary => {
    const rows: Array<[string, Stats]> = [...SECTIONS.map(s => [s, summary.sections[s]] as [string, Stats]),
      ['work', summary.work], ['interval', summary.interval]];
    for (const [name, s] of rows) {
      const [avg, p95, max] = cells.get(name)!;
      avg!.textContent = s.avg.toFixed(2); p95!.textContent = s.p95.toFixed(2); max!.textContent = s.max.toFixed(1);
    }
  };
}

export function createProfilers(defaults: ProfilerOptions = {}): ProfilerFactory {
 const profilers=new Set<Profiler>(); let disposed=false;
 return Object.freeze<ProfilerFactory>({
  create(flush,options) {if(disposed)throw new Error('Profiler provider disposed');const profiler=new Profiler(flush,{...defaults,...options}),close=profiler.dispose.bind(profiler);let closed=false;
   profiler.dispose=()=>{if(closed)return;closed=true;profilers.delete(profiler);close();};profilers.add(profiler);return profiler;},
  dispose(){if (disposed) return; disposed = true; const errors: unknown[] = [];
   for (const profiler of profilers) { try { profiler.dispose(); } catch (error) { errors.push(error); } }
   profilers.clear(); if (errors.length) throw new AggregateError(errors, 'Profiler provider cleanup failed');}
 });
}
/**
 * Contributes optional bounded viewer frame profilers.
 * Provides diagnostics.profiler@1.0.0 in slot diagnostics.profiler.
 * Requires nothing.
 * Settings precise, longWorkMs, hitchMs, hitchRatio and graphMs set the defaults for new profilers.
 */
export default function initialize(context:ModuleInitializationV2):void {
 context.contributeGuide({id:'usage',audience:'creators',title:'Frame profiler',summary:'Optional bounded viewer diagnostics.',asset:'docs/creators/usage.json'});
 context.provide(PROFILERS,context.own(createProfilers({precise:(context.settings.precise??0)>=1,longWorkMs:context.settings.longWorkMs??LONG_WORK_MS,hitchMs:context.settings.hitchMs,hitchRatio:context.settings.hitchRatio,graphMs:context.settings.graphMs})));
}
