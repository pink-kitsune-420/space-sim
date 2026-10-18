import { describe, expect, it } from 'vitest';
import type { ModuleManifest, ModuleProfile } from '../../packages/game-api/src/index';
import { artifactDigest, type CodeArtifact } from '../../packages/game-runtime/src/artifact';
import { loadCodeModules } from '../../packages/game-runtime/src/loader';
import { ModuleRegistry } from '../../packages/game-runtime/src/index';

function artifact(source = 'const SpaceSimModule = { default() {} };'): CodeArtifact {
  const manifest: ModuleManifest = { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'test.loaded',
    name: 'Loaded', version: '1.0.0', kind: 'provider', authority: 'authoritative', environments: ['node'], dependencies: [],
    provides: [], requires: [], slots: [], before: [], after: [], settings: {}, license: 'MIT' };
  const body: Omit<CodeArtifact, 'digest'> = { format: 'space-sim-code-module/1', manifest, source, assets: {},
    inputs: [{ path: 'src/index.ts', sha256: '0'.repeat(64), license: 'MIT', attribution: 'Test author' }],
    compatibility: { deterministic: true, multiplayer: true } };
  return { ...body, digest: artifactDigest(body) };
}
const profile: ModuleProfile = { format: 'space-sim-profile/1', id: 'test.profile', modules: [{ id: 'test.loaded', version: '1.0.0' }], providers: {}, settings: {} };
function prepare(module: ReturnType<typeof loadCodeModules>[number]) {
  const registry = new ModuleRegistry(); registry.register(module); return registry.prepare(profile, 'node');
}
describe('shared lazy code loader', () => {
  it('never evaluates code during inspection, registration or dependency resolution', () => {
    const code = artifact('throw new Error("evaluated"); const SpaceSimModule = { default() {} };');
    const [module] = loadCodeModules([code], { environment: 'node', allowRuntimeCode: true, approvedDigests: new Set([code.digest]) });
    const registry = new ModuleRegistry(); registry.register(module!); expect(registry.resolve(profile, 'node').order).toEqual(['test.loaded']);
    expect(() => registry.prepare(profile, 'node')).toThrow('evaluated');
  });
  it('rejects disabled runtime code and unapproved digests before evaluating any source', () => {
    const code = artifact('throw new Error("must not evaluate");');
    for (const policy of [{ allowRuntimeCode: false, approvedDigests: new Set([code.digest]) }, { allowRuntimeCode: true, approvedDigests: new Set<string>() }]) {
      const modules = loadCodeModules([code], { ...policy, environment: 'node' });
      expect(() => prepare(modules[0]!)).toThrow(policy.allowRuntimeCode ? 'approve this exact code digest' : 'does not allow imported code');
    }
  });
  it('pins approval and artifact bytes independently of caller mutation and rejects tampered/duplicate inputs', () => {
    const code = artifact(), approvedDigests = new Set([code.digest]);
    const modules = loadCodeModules([code], { environment: 'node', allowRuntimeCode: true, approvedDigests }); approvedDigests.clear();
    (code as { source: string }).source = 'throw new Error("mutated");';
    const candidate = prepare(modules[0]!); candidate.dispose();
    expect(() => loadCodeModules([code], { environment: 'node', allowRuntimeCode: true, approvedDigests })).toThrow('digest mismatch');
    const good = artifact(); expect(() => loadCodeModules([good, good], { environment: 'node', allowRuntimeCode: true, approvedDigests })).toThrow('Duplicate');
  });
});
