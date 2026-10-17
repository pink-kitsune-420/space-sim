import { describe, expect, it } from 'vitest';
import type { ModuleManifest, ModuleProfile, RegisteredModule } from '../../packages/game-api/src/index';
import { ModuleRegistry, ModuleRuntime } from '../../packages/game-runtime/src/index';

function manifest(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id, name: id,
    version: '1.0.0', kind: 'provider', authority: 'authoritative', environments: ['browser', 'offline', 'node'],
    dependencies: [], slots: [], provides: [], requires: [], settings: {}, before: [], after: [], license: 'LicenseRef-Project', ...extra };
}
function profile(ids: string[], extra: Partial<ModuleProfile> = {}): ModuleProfile {
  return { format: 'space-sim-profile/1', id: 'test.profile', modules: ids.map(id => ({ id, version: '1.0.0' })), providers: {}, settings: {}, ...extra };
}
function register(registry: ModuleRegistry, id: string, extra: Partial<ModuleManifest> = {}, initialize: RegisteredModule['initialize'] = () => {}) {
  registry.register({ manifest: manifest(id, extra), initialize });
}
describe('static module resolution', () => {
  it('requires explicit provider choice and ignores unselected providers during initialization/capability resolution', () => {
    const registry = new ModuleRegistry(), initialized: string[] = [];
    register(registry, 'test.a', { slots: ['motion'], provides: ['test.a/v1'] }, c => { initialized.push('a'); c.provide('motion', 1); });
    register(registry, 'test.b', { slots: ['motion'], provides: ['test.b/v1'] }, c => { initialized.push('b'); c.provide('motion', 2); });
    expect(() => registry.resolve(profile(['test.a', 'test.b']), 'node')).toThrow('select one');
    const p = profile(['test.a', 'test.b'], { providers: { motion: 'test.b' } });
    const candidate = registry.prepare(p, 'node', ['motion']);
    expect(candidate.service('motion')).toBe(2);
    expect(initialized).toEqual(['b']);
    register(registry, 'test.consumer', { requires: ['test.a/v1'] });
    expect(() => registry.resolve({ ...p, modules: [...p.modules, { id: 'test.consumer', version: '1.0.0' }] }, 'node')).toThrow('missing capability test.a/v1');
    candidate.dispose();
  });
  it('locks exact dependencies and orders independent ties by ID regardless of installation/profile order', () => {
    for (const ids of [['test.c', 'test.b', 'test.a'], ['test.a', 'test.b', 'test.c']]) {
      const registry = new ModuleRegistry();
      for (const id of ids) register(registry, id, id === 'test.a' ? { dependencies: [{ id: 'test.c', version: '1.0.0' }] } : {});
      const lock = registry.resolve(profile(ids), 'offline');
      expect(lock.order).toEqual(['test.b', 'test.c', 'test.a']);
      expect(lock.modules.map(m => m.version)).toEqual(['1.0.0', '1.0.0', '1.0.0']);
      expect(() => registry.resolve(profile(['test.a']), 'node')).toThrow('missing dependency test.c@1.0.0');
      expect(() => registry.resolve(profile(ids, { modules: [{ id: 'test.a', version: '2.0.0' }] }), 'node')).toThrow('requires exact version 2.0.0');
    }
  });
  it('rejects invalid manifests, duplicate IDs, unsupported API/environment, missing slots and ordering cycles', () => {
    const registry = new ModuleRegistry();
    expect(() => register(registry, 'not-namespaced')).toThrow('namespaced');
    expect(() => register(registry, 'test.bad', { apiVersion: 'wrong' as ModuleManifest['apiVersion'] })).toThrow('unsupported');
    expect(() => register(registry, 'test.bad', { version: '^1.0.0' })).toThrow('exact semantic version');
    for (const version of ['1.0.0-..', '1.0.0-01', '01.0.0', '1.0.0+']) {
      expect(() => register(registry, 'test.bad', { version })).toThrow('exact semantic version');
    }
    register(registry, 'test.versioned', { version: '1.0.0-rc.1+local.2' });
    register(registry, 'test.a', { environments: ['browser'], before: ['test.b'] });
    expect(() => register(registry, 'test.a')).toThrow('duplicate');
    register(registry, 'test.b', { before: ['test.a'] });
    expect(() => registry.resolve(profile(['test.a']), 'node')).toThrow('unsupported environment');
    expect(() => registry.resolve(profile(['test.a']), 'browser')).toThrow('before target');
    expect(() => registry.resolve(profile(['test.a', 'test.b']), 'browser')).toThrow('cycle');
    expect(() => registry.resolve(profile([]), 'node', ['motion'])).toThrow('missing required provider');
    expect(() => registry.resolve(profile(['test.missing']), 'node')).toThrow('not installed');
    expect(() => registry.resolve(profile(['test.b', 'test.b']), 'node')).toThrow('duplicate');
  });
  it('validates settings by module and field and freezes detached lock records', () => {
    const registry = new ModuleRegistry();
    register(registry, 'test.tuning', { settings: { acceleration: { type: 'number', default: 100, minimum: 0, maximum: 200 } } });
    const p = profile(['test.tuning'], { settings: { 'test.tuning': { acceleration: 75 } } });
    const lock = registry.resolve(p, 'node');
    (p.settings['test.tuning'] as Record<string, number>).acceleration = 190;
    expect(lock.settings['test.tuning']!.acceleration).toBe(75);
    expect(Object.isFrozen(lock.settings['test.tuning'])).toBe(true);
    register(registry, 'test.constructor', { slots: ['constructor'], settings: { constructor: { type: 'number' as const, default: 7, minimum: 0, maximum: 10 } } }, c => c.provide('constructor', c.settings.constructor));
    const inherited = registry.prepare(profile(['test.constructor'], { settings: { 'test.constructor': {} } }), 'node');
    expect(inherited.service('constructor')).toBe(7);
    inherited.dispose();
    for (const settings of [{ acceleration: 201 }, { acceleration: NaN }, { arbitraryPath: 1 }] as Record<string, number>[]) {
      expect(() => registry.resolve(profile(['test.tuning'], { settings: { 'test.tuning': settings } }), 'node')).toThrow(/Module test.tuning setting/);
    }
  });
});

describe('candidate lifecycle', () => {
  it('preserves the active context on failure, disposes failed resources in reverse order, and retires old resources after activation', () => {
    const registry = new ModuleRegistry(), runtime = new ModuleRuntime(registry, 'node'), disposed: string[] = [];
    for (const id of ['test.good', 'test.next', 'test.bad']) register(registry, id, {}, c => {
      c.own({ dispose: () => { disposed.push(`${id}/1`); } });
      c.own({ dispose: () => { disposed.push(`${id}/2`); if (id === 'test.bad') throw new Error('close failed'); } });
      if (id === 'test.bad') throw new Error('start failed');
    });
    const good = runtime.prepare(profile(['test.good'])); runtime.activate(good);
    expect(() => runtime.prepare(profile(['test.bad']))).toThrow('test.bad initialization: start failed');
    expect(runtime.active).toBe(good);
    expect(disposed).toEqual(['test.bad/2', 'test.bad/1']);
    expect(() => runtime.prepare(profile(['test.missing']))).toThrow('not installed');
    expect(runtime.active).toBe(good);
    const next = runtime.prepare(profile(['test.next']));
    expect(disposed).toHaveLength(2);
    runtime.activate(next);
    expect(runtime.active).toBe(next);
    expect(disposed.slice(2)).toEqual(['test.good/2', 'test.good/1']);
    runtime.dispose(); runtime.dispose(); good.dispose();
    expect(disposed.slice(4)).toEqual(['test.next/2', 'test.next/1']);
    expect(() => runtime.activate(next)).toThrow('disposed');
  });
  it('rejects providers that fail to publish a selected slot and candidates from another runtime registry', () => {
    const registry = new ModuleRegistry();
    register(registry, 'test.missing', { slots: ['motion'] });
    expect(() => registry.prepare(profile(['test.missing']), 'node')).toThrow('Provider motion: unavailable');
    register(registry, 'test.good');
    const candidate = registry.prepare(profile(['test.good']), 'browser');
    const runtime = new ModuleRuntime(registry, 'node');
    expect(() => runtime.activate(candidate)).toThrow('foreign');
    candidate.dispose();
  });
});
