import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { RenderTimer, RenderSection } from './presentation';
/** A timed part of a frame: a render section or one of `physics`, `prediction`, `hud`. */
export type ProfileSection = RenderSection | 'physics' | 'prediction' | 'hud';
/** Distribution of one measurement over the retained frames, in wall-clock milliseconds. All zero when no frame was recorded. */
export interface ProfileStats {
  /** Mean. */ readonly avg: number;
  /** Median. */ readonly p50: number;
  /** 95th percentile. */ readonly p95: number;
  /** 99th percentile. */ readonly p99: number;
  /** Largest value. */ readonly max: number;
}
/** Snapshot of the retained window of at most 600 frames. Treat it as read-only; it may be cached until the next frame ends. */
export interface ProfileSummary {
  /** Frames recorded since creation, not capped at the window size. */
  readonly frames: number;
  /** Frames per second implied by the mean frame interval; 0 with no data. */
  readonly fps: number;
  /** Wall time between frame starts, in ms. */
  readonly interval: ProfileStats;
  /** Game work per frame, in ms, from `begin` to the last `lap`. */
  readonly work: ProfileStats;
  /** Per-section time in ms. */
  readonly sections: Readonly<Record<ProfileSection,ProfileStats>>;
  /** Frames flagged as long work or hitches since creation. */
  readonly slowFrames: number;
}
/** One bounded-log event. `t` is wall-clock seconds on the viewer's monotonic clock; extra fields are free-form detail. */
export interface ProfileEvent { readonly t: number; readonly type: string; readonly [detail: string]: unknown }
/** Viewer-local wall-clock measurements; never feeds simulation or authoritative identity. */
export interface FrameProfiler extends RenderTimer, Disposable {
  /** When true each `lap` first calls the flush callback so deferred raster work is attributed to the section that queued it. Slower. */
  precise: boolean;
  /** Wall-clock date at creation. */
  readonly startedAt: Date;
  /** Most recent `slow-frame` event, or undefined. */
  readonly lastSlow: ProfileEvent | undefined;
  /** Starts a frame. `intervalMs` is the wall time since the previous frame started. */
  begin(intervalMs: number): void;
  /** Attributes the time since the previous lap (or `begin`) to `section`. */
  lap(section: ProfileSection): void;
  /** Ends the frame, stores it in the 600-frame ring and may log a `slow-frame` event. Call once per `begin`. */
  end(): void;
  /** Appends an event to the 1000-event log (oldest dropped) and returns it. After disposal it is returned but not stored. */
  event(type: string, detail?: Record<string,unknown>): ProfileEvent;
  /** Computes statistics for the retained frames on request; cached until the next frame ends. */
  summary(): ProfileSummary;
  /** Statistics of the per-frame sum of several sections, not the sum of their percentiles. */
  group(sections: readonly ProfileSection[]): ProfileStats;
  /** Oldest-first copy of the retained frames (milliseconds, rounded) for export. Allocates. */
  history(): Array<Record<string,number>>;
  /** The live bounded event log, oldest first. Do not mutate. */
  log(): readonly ProfileEvent[];
  /** Draws stacked per-section bars of recent frames into a 2D canvas, newest at the right. Does nothing after disposal. */
  drawGraph(canvas: HTMLCanvasElement): void;
}
/** Optional tuning for a profiler. Every value is viewer-only and never affects simulation. */
export interface ProfilerOptions {
  /** Start in precise mode. Default false. */
  readonly precise?: boolean;
  /** Game work above this many ms flags a slow frame. Default 11. */
  readonly longWorkMs?: number;
  /** Frame interval in ms above which a hitch may be flagged. Default 25. */
  readonly hitchMs?: number;
  /** A hitch must also exceed this multiple of the typical interval. Default 2.5. */
  readonly hitchRatio?: number;
  /** Full height of the graph in ms. Default 33.4. */
  readonly graphMs?: number;
}
/** Creates independent profilers. The factory owns them: disposing it disposes every instance. */
export interface ProfilerFactory extends Disposable {
  /** `flush` is optional and is called before each lap in precise mode (for example to read back a canvas pixel). Throws after disposal. */
  create(flush?: () => void, options?: ProfilerOptions): FrameProfiler
}
/** Service key for the frame-profiler provider (`diagnostics.profiler@1.0.0`). */
export const PROFILERS: ServiceKey<ProfilerFactory> = Object.freeze({slot:'diagnostics.profiler',version:'1.0.0'});
