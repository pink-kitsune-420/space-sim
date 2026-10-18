import type { ModuleEnvironment } from '../../game-api/src/index';
import { ALLOW_RUNTIME_CODE } from './build-policy';

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
export function packageDigest(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Invalid package SHA-256 digest');
  return value;
}
export interface PackageInspector {
  (bytes: Uint8Array): Promise<PackageIdentity>;
}
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
