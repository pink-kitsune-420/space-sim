import { describe, expect, it } from 'vitest';
import type { ModuleInitialization, ModuleManifest, ModuleProfile, RegisteredModule } from '../../packages/game-api/src/index';
import { ModuleRegistry, compareVersions, parseVersion, satisfies, validRange, validateManifest } from '../../packages/game-runtime/src/index';

function manifest(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id, name: id, version: '1.0.0', kind: 'provider',
    authority: 'presentation', environments: ['browser', 'offline', 'node'], dependencies: [], slots: [], provides: [], requires: [],
    settings: {}, before: [], after: [], license: 'LicenseRef-Project', ...extra };
}
function profile(modules: readonly { id: string; version?: string }[]): ModuleProfile {
  return { format: 'space-sim-profile/1', id: 'test.profile', modules: modules.map(m => ({ id: m.id, version: m.version ?? '1.0.0' })), providers: {}, settings: {} };
}
function module(id: string, extra: Partial<ModuleManifest> = {}, initialize: RegisteredModule['initialize'] = () => {}): RegisteredModule {
  return { manifest: manifest(id, extra), initialize };
}

describe('semantic version ranges', () => {
  it('orders versions by semantic precedence, including prereleases', () => {
    const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
    for (let i = 1; i < order.length; i++) {
      expect(compareVersions(parseVersion(order[i - 1]!)!, parseVersion(order[i]!)!), `${order[i - 1]} < ${order[i]}`).toBe(-1);
      expect(compareVersions(parseVersion(order[i]!)!, parseVersion(order[i - 1]!)!)).toBe(1);
    }
    expect(compareVersions(parseVersion('1.0.0+build.1')!, parseVersion('1.0.0+build.2')!)).toBe(0);
    for (const bad of ['1.0', '01.0.0', '1.0.0-01', 'v1.0.0', '1.0.0-']) expect(parseVersion(bad)).toBeUndefined();
  });
  it('matches exact, caret, tilde, comparator, wildcard and alternative ranges', () => {
    const cases: [string, string, boolean][] = [
      ['1.2.3', '1.2.3', true], ['1.2.4', '1.2.3', false], ['1.2.3', '=1.2.3', true],
      ['1.9.0', '^1.2.3', true], ['2.0.0', '^1.2.3', false], ['1.2.2', '^1.2.3', false],
      ['0.2.9', '^0.2.3', true], ['0.3.0', '^0.2.3', false], ['0.0.3', '^0.0.3', true], ['0.0.4', '^0.0.3', false],
      ['0.1.0', '^0.1.0', true], ['0.1.7', '^0.1.0', true], ['0.2.0', '^0.1.0', false],
      ['1.2.9', '~1.2.3', true], ['1.3.0', '~1.2.3', false],
      ['1.5.0', '>=1.2.0 <2.0.0', true], ['2.0.0', '>=1.2.0 <2.0.0', false], ['1.1.9', '>1.1.9', false], ['1.1.9', '<=1.1.9', true],
      ['3.1.0', '^1.0.0 || ^3.0.0', true], ['2.1.0', '^1.0.0 || ^3.0.0', false], ['9.9.9', '*', true],
      // Prereleases match only ranges that name a prerelease of the same version.
      ['1.3.0-beta', '^1.2.3', false], ['1.2.3-rc.2', '^1.2.3-rc.1', true], ['1.2.4-rc.1', '^1.2.3-rc.1', false],
      ['1.0.0-rc.1', '*', false], ['1.0.0-rc.1', '1.0.0-rc.1', true],
    ];
    for (const [version, range, expected] of cases) expect(satisfies(version, range), `${version} ${range}`).toBe(expected);
    for (const bad of ['', ' ', '^1.2', '1.x', '>=', 'latest', '1.0.0 ||', '^'.repeat(2) + '1.0.0', `${'1.0.0 '.repeat(30)}`]) expect(validRange(bad), bad).toBe(false);
  });
  it('validates dependency and conflict ranges in manifests while profiles stay exact', () => {
    const m = validateManifest(manifest('test.dependent', { dependencies: [{ id: 'test.base', version: '  >=1.0.0   <2.0.0 ' }],
      conflicts: [{ id: 'test.rival', version: '*' }] }));
    expect(m.dependencies).toEqual([{ id: 'test.base', version: '>=1.0.0 <2.0.0' }]);
    expect(m.conflicts).toEqual([{ id: 'test.rival', version: '*' }]);
    expect(Object.isFrozen(m.conflicts)).toBe(true);
    expect(validateManifest(manifest('test.plain'))).not.toHaveProperty('conflicts');
    expect(() => validateManifest(manifest('test.bad', { dependencies: [{ id: 'test.base', version: '^1' }] }))).toThrow('invalid version range ^1');
    expect(() => validateManifest(manifest('test.bad', { conflicts: [{ id: 'test.a', version: '*' }, { id: 'test.a', version: '1.0.0' }] }))).toThrow('duplicate module ID');
    const registry = new ModuleRegistry();
    registry.register(module('test.base'));
    expect(() => registry.resolve(profile([{ id: 'test.base', version: '^1.0.0' }]), 'node')).toThrow('exact semantic version');
  });
});

describe('module dependencies', () => {
  it('resolves ranges against the enabled version and explains each failure', () => {
    const registry = new ModuleRegistry();
    registry.register(module('test.base', { version: '1.4.0' }));
    registry.register(module('test.wants-one', { dependencies: [{ id: 'test.base', version: '^1.2.0' }] }));
    registry.register(module('test.wants-two', { dependencies: [{ id: 'test.base', version: '^2.0.0' }] }));
    const lock = registry.resolve(profile([{ id: 'test.wants-one' }, { id: 'test.base', version: '1.4.0' }]), 'node');
    expect(lock.order).toEqual(['test.base', 'test.wants-one']);
    // The lock still records exact versions; ranges are only declarations.
    expect(lock.modules).toEqual([{ id: 'test.base', version: '1.4.0' }, { id: 'test.wants-one', version: '1.0.0' }]);
    expect(() => registry.resolve(profile([{ id: 'test.wants-one' }]), 'node')).toThrow('Module test.wants-one: missing dependency test.base@^1.2.0');
    expect(() => registry.resolve(profile([{ id: 'test.wants-two' }, { id: 'test.base', version: '1.4.0' }]), 'node'))
      .toThrow('Module test.wants-two: dependency test.base@^2.0.0 is not satisfied by enabled version 1.4.0');
  });
  it('rejects conflicting modules and authority that would rely on presentation code', () => {
    const registry = new ModuleRegistry();
    registry.register(module('test.overlay-a', { conflicts: [{ id: 'test.overlay-b', version: '<2.0.0' }] }));
    registry.register(module('test.overlay-b'));
    registry.register(module('test.look'));
    registry.register(module('test.rule', { authority: 'authoritative', dependencies: [{ id: 'test.look', version: '1.0.0' }] }));
    registry.register(module('test.physics', { authority: 'authoritative' }));
    registry.register(module('test.panel', { dependencies: [{ id: 'test.physics', version: '1.0.0' }] }));
    expect(() => registry.resolve(profile([{ id: 'test.overlay-a' }, { id: 'test.overlay-b' }]), 'node')).toThrow('Module test.overlay-a: conflicts with test.overlay-b@1.0.0');
    expect(() => registry.resolve(profile([{ id: 'test.rule' }, { id: 'test.look' }]), 'node'))
      .toThrow('Module test.rule: authoritative modules cannot depend on presentation module test.look');
    // Presentation may build on authoritative modules: it never feeds back into the simulation.
    expect(registry.resolve(profile([{ id: 'test.panel' }, { id: 'test.physics' }]), 'node').order).toEqual(['test.physics', 'test.panel']);
  });
  it('computes the sorted dependency closure a module needs at installed versions', () => {
    const registry = new ModuleRegistry();
    registry.register(module('test.core', { version: '0.3.1' }));
    registry.register(module('test.library', { dependencies: [{ id: 'test.core', version: '~0.3.0' }] }));
    registry.register(module('test.addon', { dependencies: [{ id: 'test.library', version: '1.0.0' }, { id: 'test.core', version: '^0.3.0' }] }));
    registry.register(module('test.stale', { dependencies: [{ id: 'test.core', version: '^0.2.0' }] }));
    registry.register(module('test.orphan', { dependencies: [{ id: 'test.missing', version: '1.0.0' }] }));
    expect(registry.closure([{ id: 'test.addon', version: '1.0.0' }])).toEqual([
      { id: 'test.addon', version: '1.0.0' }, { id: 'test.core', version: '0.3.1' }, { id: 'test.library', version: '1.0.0' }]);
    expect(() => registry.closure([{ id: 'test.stale', version: '1.0.0' }])).toThrow('Module test.stale: dependency test.core@^0.2.0 is not satisfied by installed version 0.3.1');
    expect(() => registry.closure([{ id: 'test.orphan', version: '1.0.0' }])).toThrow('Module test.orphan: missing dependency test.missing@1.0.0');
    expect(() => registry.closure([{ id: 'test.unknown', version: '1.0.0' }])).toThrow('Module test.unknown: not installed');
    const lock = registry.resolve(profile(registry.closure([{ id: 'test.addon', version: '1.0.0' }])), 'node');
    expect(lock.order).toEqual(['test.core', 'test.library', 'test.addon']);
  });
  it('lets a module use the frozen API its declared dependency exposes, initialized first', () => {
    const order: string[] = [];
    let seen: number | undefined;
    const registry = new ModuleRegistry();
    registry.register(module('test.user', { dependencies: [{ id: 'test.math', version: '^1.0.0' }] }, context => {
      order.push('user');
      const math = context.dependency<{ double(n: number): number; unit: string }>('test.math');
      seen = math.double(21);
      expect(Object.isFrozen(math)).toBe(true);
      expect(() => { (math as { unit: string }).unit = 'ft'; }).toThrow();
    }));
    registry.register(module('test.math', {}, context => { order.push('math'); context.expose({ double: (n: number) => n * 2, unit: 'm' }); }));
    // Profile order does not matter: the dependency initializes first.
    const candidate = registry.prepare(profile([{ id: 'test.user' }, { id: 'test.math' }]), 'node');
    expect(order).toEqual(['math', 'user']);
    expect(seen).toBe(42);
    candidate.dispose();
  });
  it('rejects undeclared, missing, duplicate, invalid and late APIs', () => {
    const registry = new ModuleRegistry();
    let late: ModuleInitialization | undefined;
    registry.register(module('test.math', {}, c => { c.expose({ one: 1 }); }));
    registry.register(module('test.twice', {}, c => { c.expose({}); c.expose({}); }));
    registry.register(module('test.quiet'));
    registry.register(module('test.sneaky', {}, c => { c.dependency('test.math'); }));
    registry.register(module('test.needs-quiet', { dependencies: [{ id: 'test.quiet', version: '1.0.0' }] }, c => { c.dependency('test.quiet'); }));
    registry.register(module('test.keeps', {}, c => { late = c; }));
    registry.register(module('test.bad-api', {}, c => { c.expose(42 as unknown as object); }));
    expect(() => registry.prepare(profile([{ id: 'test.sneaky' }, { id: 'test.math' }]), 'node')).toThrow('test.math is not a declared dependency');
    expect(() => registry.prepare(profile([{ id: 'test.needs-quiet' }, { id: 'test.quiet' }]), 'node')).toThrow('Dependency test.quiet exposes no API');
    expect(() => registry.prepare(profile([{ id: 'test.twice' }]), 'node')).toThrow('duplicate or late API');
    expect(() => registry.prepare(profile([{ id: 'test.bad-api' }]), 'node')).toThrow('an API must be an object');
    const candidate = registry.prepare(profile([{ id: 'test.keeps' }]), 'node');
    expect(() => late!.expose({})).toThrow('duplicate or late API');
    candidate.dispose();
  });
  it('gives no API for a provider the profile did not select', () => {
    const registry = new ModuleRegistry();
    for (const id of ['test.fast', 'test.slow']) registry.register(module(id, { slots: ['engine'] }, c => { c.provide('engine', id); c.expose({ id }); }));
    registry.register(module('test.tuner', { dependencies: [{ id: 'test.slow', version: '1.0.0' }] }, c => { c.dependency('test.slow'); }));
    const modules = profile([{ id: 'test.fast' }, { id: 'test.slow' }, { id: 'test.tuner' }]);
    expect(() => registry.prepare({ ...modules, providers: { engine: 'test.fast' } }, 'node')).toThrow('Dependency test.slow exposes no API');
    const candidate = registry.prepare({ ...modules, providers: { engine: 'test.slow' } }, 'node');
    expect(candidate.service('engine')).toBe('test.slow');
    candidate.dispose();
  });
});
