import type { DataModule, ModuleEnvironment, ModuleProfile, RegisteredModule } from '../../../packages/game-api/src/index';
import { parseCodeArtifact, type CodeArtifact } from '../../../packages/game-runtime/src/index';
import { copyPackageFiles, decodeModulePackage, encodeModuleFiles, packageFiles, wrapLegacyCode, wrapLegacyData } from '../../../packages/game-library/src/portable';
import { BrowserPackageStore } from './package-store';
import { ALLOW_RUNTIME_CODE } from '../../../packages/game-runtime/src/build-policy';
import { inspectRuntimePackage } from '../../../packages/game-library/src/runtime-package';
import { installPackage, type PackageStore } from '../../../packages/game-runtime/src/package-store';
import { artifactModules } from '../../../packages/game-runtime/src/loader';

/** Inert persistent installation. Restoring packages never enables their code.
 * Active game selection remains separate from the content-addressed archive store. */
export class ModuleLibrary {
  readonly store: PackageStore;
  readonly data = new Map<string, DataModule>();
  storageStatus = 'Module storage has not been opened';
  private pending: Promise<void> = Promise.resolve();
  private opened = false;
  constructor(store: PackageStore = new BrowserPackageStore()) { this.store = store; }
  async open(): Promise<void> {
    if (this.opened) return; this.opened = true;
    await this.refreshInstalled();
  }
  async refreshInstalled(): Promise<void> {
    try {
      for (const entry of await this.store.list()) {
        const stored = await this.store.get(entry.digest);
        if (!stored) continue;
        try {
          const module = await decodeModulePackage(Uint8Array.from(stored.bytes));
          if (module.integrity.digest !== entry.digest) throw new Error('Stored module digest mismatch');
          if (module.code && ALLOW_RUNTIME_CODE && !this.installed.has(module.code.manifest.id)) this.installed.set(module.code.manifest.id, module.code);
          if (module.content && !this.data.has(module.content.manifest.id)) this.data.set(module.content.manifest.id, module.content);
        } catch { /* A corrupt entry is inert; it cannot prevent the bundled game from booting. */ }
      }
      this.storageStatus = 'Installed modules are saved on this device; restoring them does not enable code.';
    } catch { this.storageStatus = 'Module storage is unavailable. New installations are session-only; export a copy to keep them.'; }
  }
  private persist(artifact: CodeArtifact | DataModule): void {
    this.pending = this.pending.then(async () => {
      const files = packageFiles(artifact) ?? (artifact.format === 'space-sim-data-module/1'
        ? wrapLegacyData(artifact, `Declared license: ${artifact.manifest.license}; see package provenance`) : wrapLegacyCode(artifact));
      await installPackage(await encodeModuleFiles(files), this.store, inspectRuntimePackage,
        { source: 'Local import', installedAt: new Date().toISOString() }, { environment: 'browser', allowRuntimeCode: ALLOW_RUNTIME_CODE });
      this.storageStatus = 'Installed modules are saved on this device; restoring them does not enable code.';
    }).catch(() => { this.storageStatus = 'Module storage failed or is full. This installation is session-only; export a copy to keep it.'; });
  }
  async flush(): Promise<void> { await this.pending; }
  installData(data: DataModule): void { this.data.set(data.manifest.id, data); this.persist(data); }
  private readonly installed = new Map<string, CodeArtifact>();
  get artifacts(): readonly CodeArtifact[] { return [...this.installed.values()]; }
  install(source: string | CodeArtifact): CodeArtifact {
    if (!ALLOW_RUNTIME_CODE) throw new Error('This build does not allow imported code');
    const artifact = parseCodeArtifact(typeof source === 'string' ? source : JSON.stringify(source));
    if (typeof source !== 'string') copyPackageFiles(source, artifact);
    if (this.installed.has(artifact.manifest.id)) throw new Error(`Module ${artifact.manifest.id}: already installed; remove it before installing another version`);
    this.installed.set(artifact.manifest.id, artifact);
    this.persist(artifact);
    return artifact;
  }
  remove(id: string): void {
    this.installed.delete(id); this.data.delete(id);
    this.pending = this.pending.then(async () => {
      for (const entry of await this.store.list()) if (entry.id === id) await this.store.remove(entry.digest);
    }).catch(() => { this.storageStatus = 'Stored module could not be removed; it remains installed and disabled.'; });
  }
  /** A played game owns its complete code selection, so versions cannot leak between games. */
  replace(artifacts: readonly CodeArtifact[]): void {
    this.installed.clear();
    for (const artifact of artifacts) { this.installed.set(artifact.manifest.id, artifact); this.persist(artifact); }
  }
  modules(environment: ModuleEnvironment): RegisteredModule[] {
    return artifactModules(this.artifacts, environment);
  }
  requireProfile(profile: ModuleProfile, presentation: ModuleProfile | undefined,
    requirements: readonly { readonly id: string; readonly version: string; readonly digest: string }[] = []): boolean {
    this.require(requirements);
    const selected = [...profile.modules, ...(presentation?.modules ?? [])];
    const used = this.artifacts.filter(a => selected.some(ref => ref.id === a.manifest.id));
    for (const artifact of used) {
      if (!requirements.some(ref => ref.id === artifact.manifest.id && ref.digest === artifact.digest))
        throw new Error(`Profile must declare exact code requirement ${artifact.manifest.id} (${artifact.digest})`);
    }
    return used.length > 0;
  }
  require(requirements: readonly { readonly id: string; readonly version: string; readonly digest: string }[]): void {
    for (const ref of requirements) {
      const artifact = this.installed.get(ref.id);
      if (!artifact || artifact.manifest.version !== ref.version || artifact.digest !== ref.digest)
        throw new Error(`Install exact code artifact ${ref.id}@${ref.version} (${ref.digest}) locally before enabling this profile`);
    }
  }
}
export const moduleLibrary = new ModuleLibrary();
