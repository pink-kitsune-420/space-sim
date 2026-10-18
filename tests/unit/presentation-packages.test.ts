import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ManifestV2, ModuleProfileV2 } from '../../packages/game-api/src/index';
import { THEMES, PROCEDURAL_SOUND } from '../../packages/game-api/src/index';
import { ModuleRegistryV2 } from '../../packages/game-runtime/src/modules-v2';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { ShippedModuleCatalogue } from '../../packages/game-library/src/shipped-catalogue';
import { engineModuleServices } from '../../packages/sim-core/src/module-services';
import { createTheme, createThemes } from '../../modules/theme/src/index';
import { createAudioSynth } from '../../modules/audio-procedural/src/index';

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const profile = (manifest: ManifestV2): ModuleProfileV2 => ({ format: 'space-sim-profile/2', id: 'fixture.viewer',
  modules: [{id: manifest.id, version: manifest.version}], providers: Object.fromEntries(manifest.slots.map(slot => [slot, manifest.id])), capabilities: {}, settings: {} });

describe('portable presentation packages', () => {
  it('isolates theme preferences, retains legacy storage identity and releases observers/controllers', () => {
    const stored = new Map<string,string>(), storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key,value); } };
    const provider = createThemes(), first = provider.create({storage}), second = provider.create(); cleanup.push(() => provider.dispose());
    const changes: string[] = []; first.subscribe(() => { throw new Error('Observer failed'); });
    const subscription = first.subscribe(theme => { changes.push(theme.backdropStyle!); });
    first.set({backdropStyle:'void', hudColor:'#123456'});
    expect(second.current().backdropStyle).toBe('galactic'); expect(changes).toEqual(['void']); expect(Object.isFrozen(first.current())).toBe(true);
    const restored = createTheme({storage}); cleanup.push(() => restored.dispose()); expect(restored.load().hudColor).toBe('#123456'); expect(stored.has('space-sim:theme:v5')).toBe(true);
    expect(restored.current().windowOpacity).toBe(.96); restored.set({windowOpacity:3}); expect(restored.current().windowOpacity).toBe(1); restored.set({windowOpacity:0}); expect(restored.current().windowOpacity).toBe(.4);
    restored.set({backdropStyle:'bad' as never, gridSpacing:NaN}); expect(restored.current().backdropStyle).toBe('void'); expect(restored.current().gridSpacing).toBe(80);
    subscription.dispose(); first.set({backdropStyle:'nebula'}); expect(changes).toEqual(['void']);
    provider.dispose(); expect(() => first.set({})).toThrow('disposed'); expect(() => second.current()).toThrow('disposed'); expect(() => provider.create()).toThrow('disposed');
  });
  it('keeps missing storage and unavailable audio devices outside module initialization', async () => {
    const theme = createTheme({ storage: { getItem() { throw new Error('No storage'); }, setItem() { throw new Error('No storage'); } } }); cleanup.push(() => theme.dispose());
    expect(theme.load().backdropStyle).toBe('galactic'); expect(() => theme.set({gridEnabled:true})).not.toThrow();
    const synth = createAudioSynth(), output = synth.create(); output.setVolume(.25); output.setThrust(1);
    // Node has no browser AudioContext. Creating/discarding a silent output still works.
    output.dispose(); await expect(output.resume()).resolves.toBeUndefined(); synth.dispose(); expect(() => synth.create()).toThrow('disposed');
  });
  for (const name of ['render-canvas','render-webgl','shaders-vector','theme','theme-customizer','audio-procedural','audio-controls','ui-windows','profiler','view-hud','navball','throttle-hud']) {
    it(`builds and imports the actual ${name} package through public ports with optional removal`, async () => {
      const directory = await mkdtemp(join(tmpdir(),'portable-presentation-')); cleanup.push(() => rm(directory,{recursive:true,force:true}));
      const folder = join(directory,'source'), output = join(directory,'viewer.spacemod'); await cp(resolve(`modules/${name}`),folder,{recursive:true});
      const built = await buildPortableModule(join(folder,'module.json'),output,{typecheck:false,shippedBuild:true});
      const shipped = new ShippedModuleCatalogue(built.descriptor.manifest.id.startsWith('builtin.') ? [{id:built.descriptor.manifest.id,version:built.descriptor.manifest.version,digest:built.integrity.digest}] : []);
      const imported = await inspectRuntimePackage(new Uint8Array(await readFile(output)),{shipped});
      const registration = imported.register({environment:'browser',allowRuntimeCode:true,approvedDigests:new Set([imported.digest])});
      const graph = new ModuleRegistryV2(engineModuleServices()); graph.register(registration.module,registration.assets);
      const candidate = graph.prepare(profile(registration.module.manifest),'browser'); cleanup.push(() => candidate.dispose());
      expect(candidate.available).toBe(true);
      if (name === 'theme') { const themes = candidate.providedService(THEMES); expect(themes.create().current().gridStyle).toBe('off'); }
      if (name === 'audio-procedural') { const sound = candidate.providedService(PROCEDURAL_SOUND); expect(sound.id).toBe('builtin.audio'); sound.create().dispose(); }
      candidate.dispose();
      const empty = graph.prepare({...profile(registration.module.manifest),modules:[],providers:{}},'browser'); expect(empty.lock.order).toEqual([]); empty.dispose();
      const denied = imported.register({environment:'browser',allowRuntimeCode:true,approvedDigests:new Set()});
      const blocked = new ModuleRegistryV2(engineModuleServices()); blocked.register(denied.module,denied.assets);
      expect(() => blocked.prepare(profile(denied.module.manifest),'browser')).toThrow('approve this exact');
    },60000);
  }
});
