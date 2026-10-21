import { describe, expect, it } from 'vitest';
import { createSparsePageStore, type WorldRuleExtension } from '../../packages/game-api/src/index';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { loadWorld, saveWorld } from '../../packages/sim-core/src/save';
import { createSaveFiles, decodeUniverseSave, encodeUniverseSave, inspectSaveFiles } from '../../packages/game-library/src/save-package';
import { createIntegrity, jsonBytes } from '../../packages/game-library/src/portable';
import { readZip } from '../../packages/game-library/src/zip';
import { restoreSavedPages } from '../../packages/game-runtime/src/saved-pages';

function fixture(size: 1024 | 2048 | 4096 = 2048) {
  const pages = createSparsePageStore(size);
  const bytes = Uint8Array.from({ length: size }, (_, i) => i & 255);
  pages.setPage('planet:0:-1', bytes); pages.setPage('moon:0:-1', new Uint8Array(size)); pages.commitDirtyPages();
  const rule: WorldRuleExtension = { moduleId: 'test.terrain', version: '1.0.0', hook: {
    modelIdentity: 'terrain/test-1', seed: 7, initialState: { version: 1, value: 0 }, pageSizeBytes: size, pageStore: pages,
    evaluate({ state, pages, random }) {
      pages!.markDirty('planet:0:-1');
      const page = pages!.getPage('planet:0:-1')!; page[0] = (page[0]! + 1) & 255;
      return { state: { version: 1, value: { count: Number((state.value as { count?: number })?.count ?? 0) + 1, random: random() } } };
    },
  } };
  const world = new World(DEFAULT_UNIVERSE, { rules: [rule], soloPreview: false });
  world.spawn({ ownerId: 'pilot' }); world.step();
  return { world, rule };
}
const rehash = (files: Map<string, Uint8Array<ArrayBuffer>>) => files.set('integrity.json', jsonBytes(createIntegrity(files)));

describe('sparse terrain progress persistence', () => {
  it('retains staged initial-page commits when saving before the first tick', () => {
    const pages = createSparsePageStore(1024);
    pages.setPage('initial', new Uint8Array(1024).fill(7));
    const rule: WorldRuleExtension = { moduleId: 'test.initial', version: '1.0.0', hook: {
      modelIdentity: 'initial-pages/test', seed: 7, initialState: { version: 1, value: 0 }, pageSizeBytes: 1024, pageStore: pages,
      evaluate: ({ state }) => ({ state }),
    } };
    const world = new World(DEFAULT_UNIVERSE, { rules: [rule], soloPreview: false });
    const loaded = loadWorld(JSON.parse(JSON.stringify(saveWorld(world))), { rules: [rule], soloPreview: false }).world;
    try {
      world.step(); loaded.step();
      expect(loaded.tickFingerprint).toBe(world.tickFingerprint);
      expect(saveWorld(loaded)).toEqual(saveWorld(world));
    } finally { world.dispose(); loaded.dispose(); }
  });
  for (const size of [1024, 2048, 4096] as const) it(`roundtrips exact ${size}-byte pages through JSON, binary ZIP and continued simulation`, async () => {
    const { world, rule } = fixture(size);
    const save = saveWorld(world), pages = save.moduleState!['test.terrain']!.pages!;
    const avatar = world.spawnAvatar({ ownerId: 'pilot', bodyId: 'planet', position: { x: 512, y: 0 } });
    const full = saveWorld(world);
    expect(save.version).toBe(5);
    expect(pages.entries.map(e => e.key)).toEqual(['moon:0:-1', 'planet:0:-1']);
    const zip = await encodeUniverseSave(full), files = await readZip(zip);
    expect(JSON.parse(new TextDecoder().decode(files.get('save.json'))).format).toBe('spacelab-universe-save/3');
    expect(files.has('state/pages.json')).toBe(true);
    expect([...files.keys()].filter(path => path.endsWith('.bin'))).toHaveLength(1);
    expect(new TextDecoder().decode(files.get('state/modules.json'))).not.toContain('entries');
    const decoded = await decodeUniverseSave(zip);
    expect(decoded).toEqual(full);
    const a = loadWorld(JSON.parse(JSON.stringify(full)), { rules: [rule], soloPreview: false }).world;
    const b = loadWorld(decoded, { rules: [rule], soloPreview: false }).world;
    const clone = b.cloneForPrediction();
    try {
      expect(b.avatar(avatar.id)).toEqual(avatar);
      for (let i = 0; i < 5; i++) { world.step(); a.step(); b.step(); clone.step(); }
      expect(saveWorld(a)).toEqual(saveWorld(world));
      expect(saveWorld(b)).toEqual(saveWorld(world));
      expect(saveWorld(clone)).toEqual(saveWorld(world));
      expect(pages.entries[1]!.data).not.toBe(saveWorld(world).moduleState!['test.terrain']!.pages!.entries[1]!.data);
    } finally { world.dispose(); a.dispose(); b.dispose(); clone.dispose(); }
  });

  it('splits more than one MiB of pages without adding one ZIP entry per page', async () => {
    const { world } = fixture(4096);
    try {
      const store = world.moduleState['test.terrain']!.pages!;
      for (let i = 0; i < 300; i++) store.setPage(`region:${String(i).padStart(4, '0')}`, new Uint8Array(4096).fill(i & 255));
      const save = saveWorld(world), files = createSaveFiles(save);
      expect([...files.keys()].filter(path => path.endsWith('.bin'))).toHaveLength(2);
      expect(inspectSaveFiles(files)).toEqual(save);
    } finally { world.dispose(); }
  });

  it('refuses legacy lost-map saves and lossy downversioning while retaining valid older saves', () => {
    const { world } = fixture();
    try {
      expect(() => saveWorld(world, { version: 2 })).toThrow('Sparse pages require save version 5');
      const lost = { ...saveWorld(world), version: 2, moduleState: { 'test.terrain': {
        state: { version: 1, value: { minedCount: 2 } }, randomState: 7,
        pages: { pageSizeBytes: 2048, committedPages: {}, uncommittedPages: {}, dirtyKeySet: {} },
      } } };
      const before = JSON.stringify(lost);
      expect(() => loadWorld(lost)).toThrow('older terrain save lost its binary page contents');
      expect(JSON.stringify(lost)).toBe(before);
      const plain = new World(DEFAULT_UNIVERSE);
      try {
        for (const version of [1, 2]) {
          const old = saveWorld(plain, { version });
          const loaded = loadWorld(inspectSaveFiles(createSaveFiles(old))).world;
          try { expect(loaded.id).toBe(plain.id); } finally { loaded.dispose(); }
        }
      } finally { plain.dispose(); }
    } finally { world.dispose(); }
  });

  it('rejects corrupted bytes, duplicate keys, unknown stores, missing and extra chunks', () => {
    const { world } = fixture();
    try {
      const save = saveWorld(world);
      const p = save.moduleState!['test.terrain']!.pages!;
      expect(() => restoreSavedPages({ ...p, entries: [p.entries[0], p.entries[0]] })).toThrow('duplicate');
      expect(() => restoreSavedPages({ ...p, pageSizeBytes: 8192 })).toThrow('inventory');
      expect(() => restoreSavedPages({ ...p, entries: [{ key: 'x', data: 'AAAA' }] })).toThrow('encoding');
      for (const edit of ['bytes', 'duplicate', 'store', 'missing', 'extra'] as const) {
        const files = createSaveFiles(save);
        const path = [...files.keys()].find(path => path.endsWith('.bin'))!;
        if (edit === 'bytes') files.set(path, new Uint8Array(1));
        if (edit === 'missing') files.delete(path);
        if (edit === 'extra') files.set('state/pages/extra.bin', new Uint8Array(1024));
        if (edit === 'duplicate' || edit === 'store') {
          const inventory = JSON.parse(new TextDecoder().decode(files.get('state/pages.json')));
          if (edit === 'duplicate') inventory.stores[0].keys[1] = inventory.stores[0].keys[0];
          else inventory.stores[0].moduleId = 'test.unknown';
          files.set('state/pages.json', jsonBytes(inventory));
        }
        rehash(files);
        expect(() => inspectSaveFiles(files), edit).toThrow();
      }
    } finally { world.dispose(); }
  });
});
