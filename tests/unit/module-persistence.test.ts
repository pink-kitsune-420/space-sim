import { describe, expect, it } from 'vitest';
import { ModuleLibrary } from '../../apps/web/src/module-library';
import { MemoryPackageStore } from '../../packages/game-runtime/src/package-store';
import { artifactDigest, type CodeArtifact } from '../../packages/game-runtime/src/artifact';
import { builtinManifest } from '../../packages/modules/src/base/manifest';
import { sha256Hex } from '../../packages/game-runtime/src/authoritative';

function artifact(version = '1.0.0'): CodeArtifact {
  const body: Omit<CodeArtifact, 'digest'> = { format: 'space-sim-code-module/1', manifest: { ...builtinManifest('test.persisted', []), version },
    source: 'throw new Error("storage must never evaluate this");', assets: {},
    inputs: [{ path: 'source.ts', sha256: sha256Hex('source'), license: 'MIT', attribution: 'Test authors' }],
    compatibility: { deterministic: true, multiplayer: true } };
  return { ...body, digest: artifactDigest(body) };
}
describe('persistent inert module library', () => {
  it('restores source without activation, keeps versions, and separates game selection from installation', async () => {
    const store = new MemoryPackageStore(), library = new ModuleLibrary(store), first = artifact(), second = artifact('2.0.0');
    library.install(first); await library.flush(); expect(await store.list()).toHaveLength(1);
    library.replace([second]); expect(library.artifacts[0]!.digest).toBe(second.digest);
    const reopened = new ModuleLibrary(store); await reopened.open(); expect(reopened.artifacts[0]!.digest).toBe(first.digest);
    reopened.replace([]); expect(reopened.artifacts[0]!.digest).toBe(first.digest);
    reopened.replace([second]); await reopened.flush(); expect(await store.list()).toHaveLength(2);
    reopened.remove(second.manifest.id); await reopened.flush(); expect(await store.list()).toEqual([]);
  });
  it('reports quota failures as session-only while retaining the inert local artifact', async () => {
    const store = new MemoryPackageStore(); store.putVerified = async () => { throw new Error('Quota exceeded'); };
    const library = new ModuleLibrary(store); library.install(artifact()); await library.flush();
    expect(library.artifacts).toHaveLength(1); expect(library.storageStatus).toContain('session-only');
  });
});
