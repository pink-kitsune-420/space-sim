/** Host-only (`packages/game-runtime`): the inert installed-package store. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); it has no module-facing equivalent. */
import type { ModuleEnvironment } from '../../game-api/src/index';
import { ALLOW_RUNTIME_CODE } from './build-policy';

/** A stored package's identity: integrity digest, module ID, exact version and whether it contains code. Host-only (`packages/game-runtime`). */
export interface PackageIdentity {
  readonly digest: string;
  readonly id: string;
  readonly version: string;
  readonly containsCode: boolean;
}
/** Provenance describes installation, never trust or package identity. */
export interface PackageProvenance {
  readonly source: string;
  readonly installedAt: string;
}
/** Inert stored package bytes with identity and provenance. Host-only (`packages/game-runtime`). */
export interface StoredPackage extends PackageIdentity {
  readonly bytes: Uint8Array;
  readonly provenance: PackageProvenance;
}
/** Adapters store inert bytes. Callers must reinspect bytes before use, even after replay. */
export interface PackageStore {
  get(digest: string): Promise<StoredPackage | undefined>;
  list(): Promise<readonly PackageIdentity[]>;
  putVerified(value: StoredPackage): Promise<void>;
  remove(digest: string): Promise<void>;
}
/** Returns `value` when it is 64 lowercase hex characters, otherwise throws `Invalid package SHA-256 digest`. Host-only (`packages/game-runtime`). */
export function packageDigest(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Invalid package SHA-256 digest');
  return value;
}
/** Verifies package bytes and returns their identity without running code. Host-only (`packages/game-runtime`). */
export interface PackageInspector {
  (bytes: Uint8Array): Promise<PackageIdentity>;
}
/** Install-time policy: target environment and whether code packages may be stored for later approval. Host-only (`packages/game-runtime`). */
export interface PackageBuildPolicy {
  readonly environment: ModuleEnvironment;
  readonly allowRuntimeCode: boolean;
}
/** Inspection and installation never initialize a module or approve its code. */
export async function installPackage(bytes: Uint8Array, store: PackageStore, inspect: PackageInspector,
  provenance: PackageProvenance, policy: PackageBuildPolicy): Promise<PackageIdentity> {
  const copy = bytes.slice(), checked = await inspect(copy);
  const identity: PackageIdentity = { digest: checked.digest, id: checked.id, version: checked.version, containsCode: checked.containsCode };
  packageDigest(identity.digest);
  if (identity.containsCode && (!ALLOW_RUNTIME_CODE || !policy.allowRuntimeCode)) throw new Error('This build does not allow imported code');
  if (!provenance.source.trim() || provenance.source.length > 2048 || !Number.isFinite(Date.parse(provenance.installedAt))) throw new Error('Invalid package provenance');
  await store.putVerified({ ...identity, bytes: copy, provenance: { ...provenance } });
  return identity;
}
/** In-memory `PackageStore` for tests and session-only installation; copies bytes on every read and write. Host-only (`packages/game-runtime`). */
export class MemoryPackageStore implements PackageStore {
  private readonly entries = new Map<string, StoredPackage>();
  async get(digest: string): Promise<StoredPackage | undefined> {
    const entry = this.entries.get(packageDigest(digest));
    return entry ? { ...entry, provenance: { ...entry.provenance }, bytes: entry.bytes.slice() } : undefined;
  }
  async list(): Promise<readonly PackageIdentity[]> {
    return [...this.entries.values()].map(({ digest, id, version, containsCode }) => ({ digest, id, version, containsCode }));
  }
  async putVerified(entry: StoredPackage): Promise<void> {
    this.entries.set(packageDigest(entry.digest), { ...entry, bytes: entry.bytes.slice(), provenance: { ...entry.provenance } });
  }
  async remove(digest: string): Promise<void> { this.entries.delete(packageDigest(digest)); }
}
