import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManifestV2, ModuleProfileV2 } from '../../packages/game-api/src/index';
import { ModuleRegistryV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import guide from '../../modules/input-actions/docs/creators/actions.json';
import descriptor from '../../modules/input-actions/module.json';
import initialize, { FLIGHT_ACTION_DEFINITIONS, flightActionId } from '../../modules/input-actions/src/index';
import { loadKeybindings, saveKeybindings } from '../../modules/input-actions/src/bindings';

const manifest = descriptor.manifest as ManifestV2;
function profile(enabled: boolean): ModuleProfileV2 {
  return { format: 'space-sim-profile/2', id: 'test.actions', modules: enabled ? [{ id: manifest.id, version: manifest.version }] : [],
    providers: enabled ? { 'input.flight-actions': manifest.id } : {}, capabilities: {}, settings: {} };
}
afterEach(() => vi.unstubAllGlobals());
describe('extracted action ownership', () => {
  it('uses the public contribution registry and can be omitted without world/device services', () => {
    const registry = new ModuleRegistryV2(); registry.register({ manifest, initialize }, moduleAssets(new Map([['docs/creators/actions.json', new TextEncoder().encode(JSON.stringify(guide))]])));
    const active = registry.prepare(profile(true), 'offline');
    expect(active.actionDefinitions).toEqual(FLIGHT_ACTION_DEFINITIONS);
    expect(active.actionIds.has(flightActionId('throttleRemember'))).toBe(true);
    active.dispose();
    const absent = registry.prepare(profile(false), 'offline');
    expect(absent.actionDefinitions).toEqual([]); absent.dispose();
  });
  it('coexists with an unrelated non-flight namespaced action', () => {
    const registry = new ModuleRegistryV2(); registry.register({ manifest, initialize }, moduleAssets(new Map([['docs/creators/actions.json', new TextEncoder().encode(JSON.stringify(guide))]])));
    registry.register({ manifest: { ...manifest, id: 'fixture.survey', slots: [], provides: [] }, initialize(c) {
      c.contributeActions([{ id: 'fixture.survey/record', label: 'Record observation', category: 'system', mode: 'press', defaultKeys: ['KeyO'] }]);
    } });
    const selection = profile(true);
    const candidate = registry.prepare({ ...selection, modules: [...selection.modules, { id: 'fixture.survey', version: manifest.version }] }, 'browser');
    expect(candidate.actionIds.has('fixture.survey/record')).toBe(true);
    expect(candidate.actionIds.has(flightActionId('engine'))).toBe(true); candidate.dispose();
  });
  it('retains unavailable action bindings across legacy throttle migration and saving', () => {
    const storage = new Map([['space-sim:keybindings:v1', JSON.stringify({ throttleUp: ['ArrowUp', 'KeyW'], 'fixture.survey/record': ['KeyO'] })]]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) });
    const bindings = loadKeybindings();
    expect(bindings.throttleUp).toEqual(['ArrowUp']);
    expect((bindings as Record<string, string[]>)['fixture.survey/record']).toEqual(['KeyO']);
    saveKeybindings(bindings);
    expect(JSON.parse(storage.get('space-sim:keybindings:v1')!)['fixture.survey/record']).toEqual(['KeyO']);
  });
});
