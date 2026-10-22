/** HTML-first loading UI. The shell exists before this module is parsed. */
export interface LoadingProgress { readonly stage: string; readonly done?: number; readonly total?: number }
export const loadingHistory: { stage: string; at: number; done?: number; total?: number }[] = [];
export function loadingProgress(value: LoadingProgress): void {
  const shell = document.getElementById('startup-loading'); if (!shell) return;
  shell.hidden = false; shell.dataset.state = 'loading';
  document.getElementById('app')?.setAttribute('inert', '');
  const label = document.getElementById('loading-stage')!;
  if (label.textContent !== value.stage) label.textContent = value.stage;
  const progress = document.getElementById('loading-progress') as HTMLProgressElement;
  if (value.total !== undefined && value.done !== undefined && value.total > 0) {
    progress.max = value.total; progress.value = Math.min(value.total, value.done);
  } else progress.removeAttribute('value');
  const last = loadingHistory.at(-1);
  if (last?.stage !== value.stage && loadingHistory.length < 128) loadingHistory.push({ ...value, at: performance.now() });
}
/** A macrotask after the next animation callback lets the stage paint before work. */
export async function loadingPaint(): Promise<void> {
  await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
/** Cooperative CPU work yields a task without requiring a frame per chunk.
 * Animation callbacks may be throttled; stage/ready boundaries still await paint. */
export function loadingYield(): Promise<void> { return new Promise(resolve => setTimeout(resolve, 0)); }
export async function loadingStage(stage: string): Promise<void> { loadingProgress({ stage }); await loadingPaint(); }
export async function loadingComplete(): Promise<void> {
  // Call after drawing a real usable frame, then give that frame a paint opportunity.
  await loadingPaint();
  const shell = document.getElementById('startup-loading');
  if (shell) { shell.dataset.state = 'ready'; shell.hidden = true; }
  document.getElementById('app')?.removeAttribute('inert');
}
export function loadingFailure(error: unknown): void {
  loadingProgress({ stage: `Could not prepare this world: ${error instanceof Error ? error.message : String(error)}` });
  const shell = document.getElementById('startup-loading'); if (shell) shell.dataset.state = 'error';
  const retry = document.getElementById('loading-retry'); if (retry) retry.hidden = false;
}
