import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { parseCodeArtifact, MAX_CODE_ARTIFACT_BYTES, type CodeArtifact } from '../../../packages/game-runtime/src/index';
import { artifactModules, decodePackage, MAX_ARCHIVE_BYTES } from '../../../packages/game-library/src/archive';
import { parseModuleImport, type ModuleBundle } from '../../../packages/modules/src/index';
import type { RegisteredModule } from '../../../packages/game-api/src/index';
import type { ServerConfig } from './config';

/** Paths come only from the server owner's configuration. Merely inspecting artifacts
 * does not execute their source. Profiles never embed or download executable code. */
export async function serverModules(config: ServerConfig, dataDir: string): Promise<{
  readonly code: readonly RegisteredModule[]; readonly bundle?: ModuleBundle;
}> {
  const local = (path: string) => isAbsolute(path) ? path : join(dataDir, path);
  if (config.gameFile) {
    if (config.moduleDirectory || config.moduleProfile) throw new Error('Server: choose --game or a legacy module directory/profile');
    const path = local(config.gameFile);
    if ((await stat(path)).size > MAX_ARCHIVE_BYTES) throw new Error('Server game exceeds 32 MiB');
    const game = await decodePackage(new Uint8Array(await readFile(path)));
    if (game.format !== 'space-lab-game/1') throw new Error('Server: --game requires a game package');
    return { code: artifactModules(game.plugins.filter(a => a.manifest.authority === 'authoritative'), 'node'), bundle: game.bundle };
  }
  const artifacts = new Map<string, CodeArtifact>();
  if (config.moduleDirectory) {
    const directory = local(config.moduleDirectory);
    const names = (await readdir(directory)).filter(name => name.endsWith('.module.json')).sort();
    if (names.length > 256) throw new Error('Server: at most 256 code artifacts');
    for (const name of names) {
      const path = join(directory, name);
      if ((await stat(path)).size > MAX_CODE_ARTIFACT_BYTES) throw new Error(`${name}: code artifact exceeds 4 MiB`);
      const artifact = parseCodeArtifact(await readFile(path, 'utf8'));
      if (artifacts.has(artifact.manifest.id)) throw new Error(`Module ${artifact.manifest.id}: duplicate server installation`);
      artifacts.set(artifact.manifest.id, artifact);
    }
  }
  let bundle: ModuleBundle | undefined;
  if (config.moduleProfile) {
    const path = local(config.moduleProfile);
    if ((await stat(path)).size > MAX_CODE_ARTIFACT_BYTES) throw new Error('Server profile exceeds 4 MiB');
    const imported = parseModuleImport(await readFile(path, 'utf8'));
    if (imported.format !== 'space-sim-module-profile/1') throw new Error('Server requires an exported module profile');
    bundle = imported;
    for (const artifact of artifacts.values()) {
      if (artifact.manifest.authority === 'authoritative' && bundle.profile.modules.some(ref => ref.id === artifact.manifest.id)
        && !bundle.code?.some(ref => ref.id === artifact.manifest.id && ref.digest === artifact.digest))
        throw new Error(`Server profile must declare exact code requirement ${artifact.manifest.id}`);
    }
    for (const ref of bundle.code ?? []) {
      // Viewer-only requirements do not belong to a headless world's installation.
      if (!bundle.profile.modules.some(module => module.id === ref.id)) continue;
      const artifact = artifacts.get(ref.id);
      if (!artifact || artifact.manifest.version !== ref.version || artifact.digest !== ref.digest) throw new Error(`Server: install exact artifact ${ref.id}@${ref.version} (${ref.digest})`);
    }
  }
  const code = artifactModules([...artifacts.values()].filter(a => a.manifest.authority === 'authoritative'), 'node');
  return { code, ...(bundle ? { bundle } : {}) };
}
