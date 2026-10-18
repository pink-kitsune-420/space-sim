import { describe, expect, it } from 'vitest';
import type { ManifestV2, ModuleProfileV2 } from '../../packages/game-api/src/index';
import { previewModulesV2 } from '../../packages/game-runtime/src/preview-v2';
import { ModuleResolutionError } from '../../packages/game-runtime/src/resolver-v2';

const module = (id: string, extra: Partial<ManifestV2> = {}): ManifestV2 => ({ format: 'space-sim-module/2', apiVersion: 'space-sim-game-api/2',
  id, name: id, version: '1.0.0', kind: 'provider', tier: 'platform', environments: ['browser'], dependencies: [], conflicts: [], provides: [], requires: [],
  slots: [], before: [], after: [], settings: {}, license: 'MIT', ...extra });
const profile = (ids: string[]): ModuleProfileV2 => ({ format: 'space-sim-profile/2', id: 'test.preview', modules: ids.map(id => ({ id, version: '1.0.0' })), providers: {}, capabilities: {}, settings: {} });
describe('inert dependency previews', () => {
  it('includes complete ID closure only on request and refuses reverse-dependency removal', () => {
    const a = module('test.actions'), b = module('test.keyboard', { dependencies: [{ id: a.id, version: '^1.0.0' }] });
    const installed = new Map([a, b].map(m => [m.id, m]));
    expect(() => previewModulesV2(installed, profile([b.id]), undefined, 'browser')).toThrow(ModuleResolutionError);
    const complete = previewModulesV2(installed, profile([b.id]), undefined, 'browser', { includeDependencies: true });
    expect(complete.lock.order).toEqual([a.id, b.id]); expect(complete.restartRequired).toBe(true);
    expect(complete.dependencies).toContainEqual({ requester: b.id, provider: a.id, reason: 'module ^1.0.0' });
    expect(() => previewModulesV2(installed, profile([b.id]), complete.lock, 'browser')).toThrow('needs enabled dependency');
    const removed = previewModulesV2(installed, profile([a.id]), complete.lock, 'browser'); expect(removed.removed).toEqual([b.id]);
  });
  it('preserves explicit choices and exposes the capability dependency tree', () => {
    const need = { name: 'input.actions', version: '^1.0.0' };
    const a = module('test.first', { provides: [{ ...need, version: '1.0.0' }] }), b = module('test.second', { provides: [{ ...need, version: '1.0.0' }] });
    const c = module('test.consumer', { requires: [need] }), installed = new Map([a, b, c].map(m => [m.id, m]));
    expect(() => previewModulesV2(installed, profile([a.id, b.id, c.id]), undefined, 'browser')).toThrow('Choose a compatible provider');
    const chosen = { ...profile([a.id, b.id, c.id]), capabilities: { [c.id]: { [need.name]: b.id } } };
    const preview = previewModulesV2(installed, chosen, undefined, 'browser');
    expect(preview.dependencies).toContainEqual({ requester: c.id, provider: b.id, reason: 'input.actions@1.0.0' });
  });
  it('prevents device ordering edges from changing authoritative initialization order', () => {
    const authority = module('test.authority', { tier: 'authoritative' });
    const device = module('test.device', { before: [authority.id] });
    expect(() => previewModulesV2(new Map([authority, device].map(m => [m.id, m])), profile([authority.id, device.id]), undefined, 'browser')).toThrow('cannot depend');
    const after = { ...device, before: [], after: [authority.id] };
    expect(previewModulesV2(new Map([authority, after].map(m => [m.id, m])), profile([authority.id, after.id]), undefined, 'browser').lock.order).toEqual([authority.id, after.id]);
  });
});
