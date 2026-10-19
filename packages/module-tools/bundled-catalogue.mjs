// Build-time metadata only. No source bundles, archive inspection or code execution.
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicId = 'virtual:spacelab-bundled-modules', virtualId = `\0${publicId}`;
export function bundledCataloguePlugin(root = fileURLToPath(new URL('../../', import.meta.url))) {
  return {
    name: 'spacelab-bundled-catalogue',
    resolveId(id) { if (id === publicId) return virtualId; },
    async load(id) {
      if (id !== virtualId) return;
      const entries = [], seen = new Set();
      for (const folder of (await readdir(resolve(root, 'modules'), { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const descriptorPath = resolve(root, 'modules', folder.name, 'module.json');
        this.addWatchFile(descriptorPath);
        const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')), manifest = descriptor.manifest;
        if (!manifest?.id || seen.has(manifest.id)) throw new Error(`Invalid or duplicate bundled module: ${folder.name}`);
        seen.add(manifest.id);
        let description = '';
        const guide = descriptor.guides?.find(path => path.startsWith('docs/creators/')) ?? descriptor.guides?.[0];
        if (guide) {
          const guidePath = resolve(root, 'modules', folder.name, guide);
          this.addWatchFile(guidePath);
          description = JSON.parse(await readFile(guidePath, 'utf8')).summary ?? '';
        }
        entries.push({ id: manifest.id, name: manifest.name, version: manifest.version, tier: manifest.tier,
          environments: manifest.environments, description, folder: folder.name });
      }
      return `export default ${JSON.stringify(entries)};`;
    },
  };
}
