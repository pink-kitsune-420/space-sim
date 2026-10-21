/** Host-only sparse-page save codec. Not a module import boundary. */
import { createSparsePageStore, MAX_SPARSE_PAGE_STORE_BYTES, type SavedRulePages, type SparsePageStore } from '../../game-api/src/index';

export function pageBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]!);
  return btoa(text);
}
export function pageBytes(data: unknown, size: number): Uint8Array<ArrayBuffer> {
  if (typeof data !== 'string' || data.length !== 4 * Math.ceil(size / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Invalid saved page encoding');
  const text = atob(data);
  if (text.length !== size) throw new Error('Invalid saved page size');
  const bytes = Uint8Array.from(text, c => c.charCodeAt(0));
  if (pageBase64(bytes) !== data) throw new Error('Noncanonical saved page encoding');
  return bytes;
}
export function captureSavedPages(store: SparsePageStore): SavedRulePages {
  if (typeof store.keys !== 'function') throw new Error('Cannot save a non-enumerable sparse page store');
  const clone = (store as SparsePageStore & { clone?: () => SparsePageStore }).clone;
  if (typeof clone !== 'function') throw new Error('Cannot safely save a sparse page store without an independent clone');
  const staged = clone.call(store);
  if (staged === store) throw new Error('Cannot safely save a sparse page store whose clone shares its transaction');
  const dirtyKeys = staged.commitDirtyPages().map(page => page.key);
  const entries: { key: string; data: string }[] = [];
  for (const key of store.keys()) {
    if ((entries.length + 1) * store.pageSizeBytes > MAX_SPARSE_PAGE_STORE_BYTES) throw new Error('Saved sparse pages exceed 32 MiB');
    const bytes = store.getPage(key);
    if (!bytes || bytes.length !== store.pageSizeBytes) throw new Error('Invalid sparse page contents');
    entries.push({ key, data: pageBase64(bytes) });
  }
  entries.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const saved: SavedRulePages = { format: 'space-sim-rule-pages/1', pageSizeBytes: store.pageSizeBytes, entries,
    ...(dirtyKeys.length ? { dirtyKeys } : {}) };
  restoreSavedPages(saved); // Same bounds and identity checks on both save and load.
  return saved;
}
export function restoreSavedPages(raw: unknown): SparsePageStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid saved sparse pages');
  const p = raw as Record<string, unknown>;
  if (p.format !== 'space-sim-rule-pages/1' || Object.keys(p).some(k => !['format', 'pageSizeBytes', 'entries', 'dirtyKeys'].includes(k))
    || ![1024, 2048, 4096].includes(p.pageSizeBytes as number) || !Array.isArray(p.entries)
    || p.entries.length * (p.pageSizeBytes as number) > MAX_SPARSE_PAGE_STORE_BYTES) throw new Error('Invalid saved sparse page inventory');
  const store = createSparsePageStore(p.pageSizeBytes as 1024 | 2048 | 4096);
  let previous: string | undefined;
  for (const rawEntry of p.entries) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) throw new Error('Invalid saved page entry');
    const entry = rawEntry as Record<string, unknown>, key = entry.key;
    if (Object.keys(entry).some(k => k !== 'key' && k !== 'data') || typeof key !== 'string' || !key.length || key.length > 1024
      || /[\u0000-\u001f\u007f]/.test(key) || previous !== undefined && key <= previous) throw new Error('Invalid or duplicate saved page key');
    store.setPage(key, pageBytes(entry.data, store.pageSizeBytes));
    previous = key;
  }
  store.commitDirtyPages();
  if (p.dirtyKeys !== undefined) {
    if (!Array.isArray(p.dirtyKeys) || p.dirtyKeys.length > p.entries.length) throw new Error('Invalid saved dirty-page keys');
    let last: string | undefined;
    for (const key of p.dirtyKeys) {
      if (typeof key !== 'string' || !store.getPage(key) || last !== undefined && key <= last) throw new Error('Invalid saved dirty-page key');
      store.markDirty(key); last = key;
    }
  }
  return store;
}
