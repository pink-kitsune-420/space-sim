export const cache = new Map<string, HTMLElement>();
export function element<T extends HTMLElement>(id: string): T {
  let el = cache.get(id);
  if (!el) {
    el = document.getElementById(id) ?? undefined;
    if (!el) throw new Error(`Missing element ${id}`);
    cache.set(id, el);
  }
  return el as T;
}
/** Write a HUD field only when its text changes, so unchanged values cause no DOM work. */
export const shown = new Map<string, string>();
export function show(id: string, text: string): void {
  if (shown.get(id) === text) return;
  element(id).textContent = text; shown.set(id, text);
}
export function download(name: string, text: string): void {
  downloadBlob(name, new Blob([text], { type: 'application/json' }));
}
export function downloadBytes(name: string, bytes: Uint8Array<ArrayBuffer>): void {
  downloadBlob(name, new Blob([bytes], { type: 'application/gzip' }));
}
function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

