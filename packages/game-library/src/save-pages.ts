/** Host-only binary sparse-page extension of saved-progress ZIP layout 3. */
import type { SavedRulePages, SavedWorldRuleState } from '../../game-api/src/index';
import { pageBase64, pageBytes, restoreSavedPages } from '../../game-runtime/src/saved-pages';
import { keys, object } from '../../game-runtime/src/validation';
import { jsonBytes, parsePackageJson, requiredFile } from './portable';
import type { PackageFiles } from './zip';

const CHUNK_BYTES = 1024 * 1024;
export const PAGE_INVENTORY = 'state/pages.json';
const chunkPath = (store: number, chunk: number) => `state/pages/${String(store).padStart(4, '0')}/${String(chunk).padStart(4, '0')}.bin`;

type ZipRuleState = Omit<SavedWorldRuleState, 'pages'> & { readonly pages?: { readonly format: 'space-sim-rule-pages-reference/1' } };
export function writeSavedPages(states: Readonly<Record<string, SavedWorldRuleState>> | undefined,
  files: Map<string, Uint8Array<ArrayBuffer>>): Readonly<Record<string, ZipRuleState>> | undefined {
  if (!states) return undefined;
  const stripped: Record<string, ZipRuleState> = Object.create(null);
  const stores: { moduleId: string; pageSizeBytes: number; keys: string[]; chunks: string[]; dirtyKeys?: readonly string[] }[] = [];
  for (const moduleId of Object.keys(states).sort()) {
    const { pages, ...state } = states[moduleId]!;
    stripped[moduleId] = state;
    if (!pages) continue;
    stripped[moduleId] = { ...state, pages: { format: 'space-sim-rule-pages-reference/1' } };
    restoreSavedPages(pages);
    const count = CHUNK_BYTES / pages.pageSizeBytes, chunks: string[] = [];
    for (let start = 0; start < pages.entries.length; start += count) {
      const end = Math.min(start + count, pages.entries.length);
      const bytes = new Uint8Array((end - start) * pages.pageSizeBytes);
      for (let i = start; i < end; i++) bytes.set(pageBytes(pages.entries[i]!.data, pages.pageSizeBytes), (i - start) * pages.pageSizeBytes);
      const path = chunkPath(stores.length, chunks.length);
      chunks.push(path); files.set(path, bytes);
    }
    stores.push({ moduleId, pageSizeBytes: pages.pageSizeBytes, keys: pages.entries.map(e => e.key), chunks,
      ...(pages.dirtyKeys ? { dirtyKeys: pages.dirtyKeys } : {}) });
  }
  if (stores.length) {
    if (stores.length > 256) throw new Error('Saved pages exceed 256 rule namespaces');
    const inventory = jsonBytes({ format: 'space-sim-rule-pages-zip/1', stores });
    if (inventory.length > CHUNK_BYTES) throw new Error('Saved page inventory exceeds 1 MiB');
    files.set(PAGE_INVENTORY, inventory);
  }
  return stripped;
}

export function readSavedPages(rawStates: unknown, files: PackageFiles, paths: Set<string>): Readonly<Record<string, SavedWorldRuleState>> {
  const states = object(rawStates, 'Saved page namespaces');
  const restored = { ...states } as Record<string, SavedWorldRuleState>;
  const inventory = object(parsePackageJson(requiredFile(files, PAGE_INVENTORY), 'Saved page inventory'), 'Saved page inventory');
  keys(inventory, ['format', 'stores'], 'Saved page inventory');
  if (inventory.format !== 'space-sim-rule-pages-zip/1' || !Array.isArray(inventory.stores) || !inventory.stores.length || inventory.stores.length > 256) throw new Error('Invalid saved page inventory');
  paths.add(PAGE_INVENTORY);
  const seen = new Set<string>();
  for (const [index, raw] of inventory.stores.entries()) {
    const store = object(raw, 'Saved page store');
    keys(store, ['moduleId', 'pageSizeBytes', 'keys', 'chunks', 'dirtyKeys'], 'Saved page store');
    const moduleId = store.moduleId, size = store.pageSizeBytes;
    if (typeof moduleId !== 'string' || !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(moduleId) || seen.has(moduleId)
      || !Object.hasOwn(states, moduleId) || ![1024, 2048, 4096].includes(size as number)
      || !Array.isArray(store.keys) || store.keys.length * (size as number) > 32 * 1024 * 1024 || !Array.isArray(store.chunks)
      || store.chunks.length !== Math.ceil(store.keys.length * (size as number) / CHUNK_BYTES)) throw new Error('Invalid saved page store');
    seen.add(moduleId);
    const state = object(states[moduleId], 'Saved rule namespace');
    const reference = object(state.pages, 'Saved page reference');
    if (reference.format !== 'space-sim-rule-pages-reference/1' || Object.keys(reference).length !== 1) throw new Error('Invalid inline/binary saved page reference');
    const entries: { key: string; data: string }[] = [];
    for (const [chunk, path] of store.chunks.entries()) {
      if (path !== chunkPath(index, chunk)) throw new Error('Invalid saved page chunk path');
      paths.add(path);
      const bytes = requiredFile(files, path);
      const expected = Math.min(CHUNK_BYTES, (store.keys.length - entries.length) * (size as number));
      if (bytes.length !== expected) throw new Error('Invalid saved page chunk size');
      for (let offset = 0; offset < bytes.length; offset += size as number) {
        entries.push({ key: store.keys[entries.length] as string, data: pageBase64(bytes.subarray(offset, offset + (size as number))) });
      }
    }
    const pages: SavedRulePages = { format: 'space-sim-rule-pages/1', pageSizeBytes: size as SavedRulePages['pageSizeBytes'], entries,
      ...(store.dirtyKeys !== undefined ? { dirtyKeys: store.dirtyKeys as string[] } : {}) };
    restoreSavedPages(pages);
    restored[moduleId] = { ...state, pages } as unknown as SavedWorldRuleState;
  }
  for (const [id, raw] of Object.entries(states)) {
    if (object(raw, 'Saved rule namespace').pages !== undefined && !seen.has(id)) throw new Error('Missing saved page store');
  }
  return restored;
}
