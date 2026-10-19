import type { Disposable, ManifestV2 } from '@space-sim/game-api';

/** Build inventory for discovery. Presence here never means installed or enabled. */
export interface BundledModuleEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly tier: ManifestV2['tier'];
  readonly environments: ManifestV2['environments'];
  readonly description: string;
  readonly folder: string;
}
const categories: Readonly<Record<ManifestV2['tier'], string>> = {
  authoritative: 'Simulation', presentation: 'Display & audio', platform: 'Controls & tools', network: 'Multiplayer',
};

/** Searchable source inventory. It cannot change a profile or initialize a module. */
export function mountBundledCatalogue(root: HTMLElement, entries: readonly BundledModuleEntry[]): Disposable {
  const document = root.ownerDocument, Controller = document.defaultView?.AbortController ?? AbortController;
  const controller = new Controller(), previous = [...root.childNodes], signal = controller.signal;
  const tools = document.createElement('div'), searchLabel = document.createElement('label'), search = document.createElement('input');
  tools.className = 'library-tools'; search.type = 'search'; search.placeholder = 'Find a package…';
  searchLabel.append('Find a bundled package', search);
  const categoryLabel = document.createElement('label'), category = document.createElement('select');
  for (const [value, label] of [['', 'All categories'] as const, ...Object.entries(categories)]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; category.append(option);
  }
  categoryLabel.append('Category', category); tools.append(searchLabel, categoryLabel);
  const count = document.createElement('p'), list = document.createElement('ul'), empty = document.createElement('p');
  count.className = 'module-note'; count.setAttribute('role', 'status'); list.className = 'bundled-module-list';
  list.setAttribute('aria-label', 'Bundled source packages'); empty.textContent = 'No bundled packages match your search.';
  root.replaceChildren(tools, count, list, empty);
  // Keep nodes and their details state when filtering; browsing never decodes package blobs.
  const rows = [...entries].sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const item = document.createElement('li'), heading = document.createElement('h4'), description = document.createElement('p');
    item.dataset.bundledModule = entry.id; heading.textContent = entry.name; description.textContent = entry.description;
    const badge = document.createElement('span'); badge.className = 'module-badge'; badge.textContent = categories[entry.tier];
    const detail = document.createElement('details'), summary = document.createElement('summary'), identity = document.createElement('p'), source = document.createElement('a');
    summary.textContent = 'Package details & source'; identity.className = 'module-note';
    identity.textContent = `${entry.id}@${entry.version} · ${entry.environments.map(target => target === 'node' ? 'server' : target).join(', ')}`;
    const location = document.createElement('p'); location.className = 'module-note'; location.textContent = `Source folder: modules/${entry.folder}`; detail.append(location);
    source.textContent = 'Project source on GitHub ↗'; source.href = 'https://github.com/pink-kitsune-420/space-sim';
    source.target = '_blank'; source.rel = 'noopener noreferrer'; detail.append(summary, identity, source); item.append(badge, heading, description, detail); list.append(item);
    return { item, entry, text: `${entry.name} ${entry.id} ${entry.description} ${entry.environments.join(' ')} ${categories[entry.tier]}`.toLocaleLowerCase() };
  });
  const filter = (): void => {
    const query = search.value.trim().toLocaleLowerCase(); let shown = 0;
    for (const row of rows) { row.item.hidden = !!(query && !row.text.includes(query) || category.value && category.value !== row.entry.tier); if (!row.item.hidden) shown++; }
    count.textContent = `${shown} of ${entries.length} bundled packages`; empty.hidden = shown > 0;
  };
  search.addEventListener('input', filter, { signal }); category.addEventListener('change', filter, { signal }); filter();
  let disposed = false;
  return { dispose() { if (disposed) return; disposed = true; controller.abort(); root.replaceChildren(...previous); } };
}
