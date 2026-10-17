import type { ModuleEnvironment, ModuleProfile, RegisteredModule } from '../../../packages/game-api/src/index';
import { parseCodeArtifact, type CodeArtifact } from '../../../packages/game-runtime/src/index';
import { artifactModules } from '../../../packages/game-library/src/archive';

/** Page-local installation. No persistence, downloads or evaluation on installation.
 * Initialization is deferred until an explicit profile enable action prepares a candidate. */
export class ModuleLibrary {
  private readonly installed = new Map<string, CodeArtifact>();
  get artifacts(): readonly CodeArtifact[] { return [...this.installed.values()]; }
  install(text: string): CodeArtifact {
    const artifact = parseCodeArtifact(text);
    if (this.installed.has(artifact.manifest.id)) throw new Error(`Module ${artifact.manifest.id}: already installed; remove it before installing another version`);
    this.installed.set(artifact.manifest.id, artifact);
    return artifact;
  }
  remove(id: string): void { this.installed.delete(id); }
  /** A played game owns its complete code selection, so versions cannot leak between games. */
  replace(artifacts: readonly CodeArtifact[]): void {
    this.installed.clear();
    for (const artifact of artifacts) this.installed.set(artifact.manifest.id, artifact);
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
