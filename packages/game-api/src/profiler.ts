import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { RenderTimer, RenderSection } from './presentation';
export type ProfileSection = RenderSection | 'physics' | 'prediction' | 'hud';
export interface ProfileStats { readonly avg: number; readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number }
export interface ProfileSummary {
  readonly frames: number; readonly fps: number; readonly interval: ProfileStats; readonly work: ProfileStats;
  readonly sections: Readonly<Record<ProfileSection,ProfileStats>>; readonly slowFrames: number;
}
export interface ProfileEvent { readonly t: number; readonly type: string; readonly [detail: string]: unknown }
/** Viewer-local wall-clock measurements; never feeds simulation or authoritative identity. */
export interface FrameProfiler extends RenderTimer, Disposable {
  precise: boolean;
  readonly startedAt: Date;
  readonly lastSlow: ProfileEvent | undefined;
  begin(intervalMs: number): void;
  lap(section: ProfileSection): void;
  end(): void;
  event(type: string, detail?: Record<string,unknown>): ProfileEvent;
  summary(): ProfileSummary;
  group(sections: readonly ProfileSection[]): ProfileStats;
  history(): Array<Record<string,number>>;
  log(): readonly ProfileEvent[];
  drawGraph(canvas: HTMLCanvasElement): void;
}
export interface ProfilerOptions {
  readonly precise?: boolean; readonly longWorkMs?: number;
  readonly hitchMs?: number; readonly hitchRatio?: number; readonly graphMs?: number;
}
export interface ProfilerFactory extends Disposable { create(flush?: () => void, options?: ProfilerOptions): FrameProfiler }
export const PROFILERS: ServiceKey<ProfilerFactory> = Object.freeze({slot:'diagnostics.profiler',version:'1.0.0'});
