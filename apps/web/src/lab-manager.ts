import { decodeLabFile, encodePackage, MAX_ARCHIVE_BYTES, validatePackage, type GamePackage, type PluginPackage } from '../../../packages/game-library/src/archive';
import { validateUniverse } from '../../../packages/sim-core/src/universe';
import type { UniverseDefinition } from '../../../packages/game-api/src/index';
import { parseCodeArtifact } from '../../../packages/game-runtime/src/artifact';
import { parseModuleImport } from './modules';
import { GameLibrary, type LibraryGame } from './game-library';
import { downloadBytes, element, message, show } from './ui';

/** One import route for games, compressed plugins and existing JSON module files. */
export class LabManager {
  readonly library = new GameLibrary();
  private busy = false;
  private ready: Promise<void> | undefined;
  constructor(private readonly options: {
    readonly builtin: GamePackage;
    readonly builtins?: readonly GamePackage[];
    readonly install: (plugin: PluginPackage) => void;
    readonly installDevicePackage?: (bytes: Uint8Array, source: string) => Promise<boolean>;
    readonly legacy: (text: string) => void;
    readonly universe: (universe: UniverseDefinition) => void;
    readonly capture: () => GamePackage | Promise<GamePackage>;
    readonly play: (game: GamePackage) => void | Promise<void>;
    readonly editable: () => boolean;
    readonly world: () => object;
  }) {
    const input = element<HTMLInputElement>('lab-file');
    element('lab-import').onclick = () => input.click();
    input.onchange = () => { void this.run(async () => {
      const file = input.files?.[0], world = options.world();
      if (!file) return;
      try {
        if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Package must be at most 32 MiB');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (await options.installDevicePackage?.(bytes, file.name)) { this.status('Installed device module. Code has not run. Review and enable it in Plugins.'); return; }
        const raw = await decodeLabFile(bytes) as { format?: string; schemaVersion?: number; bodies?: unknown[]; systems?: unknown[] };
        if (options.world() !== world) throw new Error('The active session changed while importing');
        if (raw && (Array.isArray(raw.systems) || Array.isArray(raw.bodies)) && !raw.format) {
          if (!options.editable()) throw new Error('Import a universe in your solo game');
          const universe = validateUniverse(raw);
          options.universe(universe);
          this.status(`Loaded universe ${universe.name}. Save as a game to keep and share its setup.`);
          return;
        }
        if (raw?.format === 'space-sim-world') throw new Error('This file is saved progress. Use Fleet → Load universe… to continue it.');
        if (raw?.format === 'space-sim-shaders/1') throw new Error('Use Tools → Load shader… for shader data.');
        let imported;
        if (raw?.format === 'space-lab-game/1' || raw?.format === 'space-lab-plugin/1') imported = validatePackage(raw);
        else if (raw?.format === 'space-sim-code-module/1') {
          const code = parseCodeArtifact(JSON.stringify(raw));
          imported = { format: 'space-lab-plugin/1', info: { id: code.manifest.id, name: code.manifest.name, description: '' }, data: [], code: [code] } as const;
        } else {
          const text = JSON.stringify(raw), legacy = parseModuleImport(text);
          if (legacy.format === 'space-sim-module-profile/1') { options.legacy(text); this.status('Profile inspected. See plugin configuration for its activation status.'); return; }
          imported = { format: 'space-lab-plugin/1', info: { id: legacy.manifest.id, name: legacy.manifest.name, description: '' }, data: [legacy], code: [] } as const;
        }
        if (options.world() !== world) throw new Error('The active session changed while importing');
        if (imported.format === 'space-lab-game/1') {
          await this.library.put(imported);
          this.status(`Added ${imported.info.name} to your library. Choose Play to enable its plugins and start a new world.`);
        } else {
          options.install(imported);
          this.status(`Installed ${imported.info.name}. Select it in Plugins and apply to enable it. Code has not run.`);
          element('plugin-manager').hidden = false;
          document.querySelector<HTMLDetailsElement>('.code-module-settings')!.open = true;
        }
        this.refresh();
      } finally { input.value = ''; }
    }); };
    element('lab-save').onclick = () => { void this.run(async () => {
      const game = await this.capture();
      await this.library.put(game, { folder: element<HTMLInputElement>('game-folder').value });
      this.status(`Saved ${game.info.name} to the library. This game starts a fresh world; use Save universe for flight progress.`);
      this.refresh();
    }); };
    element('lab-export').onclick = () => { void this.run(async () => {
      const game = await this.capture();
      await this.export(game);
      this.status(`Exported ${game.info.name} with its selected plugins, data and settings.`);
    }); };
    element('game-search').oninput = () => this.refresh();
    element('game-sort').onchange = () => this.refresh();
    element('game-favorites').onchange = () => this.refresh();
  }
  async start(): Promise<void> {
    await (this.ready ??= this.library.open());
    show('library-storage', this.library.persistent
      ? 'Games are saved in this browser. Export a file to share or back up a game.'
      : 'Browser storage is unavailable. This library lasts until the page closes; export games to keep them.');
    this.refresh();
  }
  refresh(): void {
    const search = element<HTMLInputElement>('game-search').value.trim().toLowerCase();
    const favorites = element<HTMLInputElement>('game-favorites').checked;
    const builtins: LibraryGame[] = (this.options.builtins ?? [this.options.builtin]).map(b => ({
      id: b.info.id === this.options.builtin.info.id ? 'builtin' : b.info.id,
      game: b,
      folder: 'Built-in',
      favorite: false,
    }));
    const entries: LibraryGame[] = [...builtins, ...this.library.entries];
    const visible = entries.filter(e => (!favorites || e.favorite)
      && `${e.game.info.name} ${e.game.info.description} ${e.folder}`.toLowerCase().includes(search));
    const folder = element<HTMLSelectElement>('game-sort').value === 'folder';
    visible.sort((a, b) => Number(b.favorite) - Number(a.favorite)
      || (folder ? a.folder.localeCompare(b.folder) : 0) || a.game.info.name.localeCompare(b.game.info.name));
    element('game-list').replaceChildren(...visible.map(e => this.card(e)));
    element('game-empty').hidden = visible.length > 0;
    for (const id of ['lab-save', 'lab-export']) element<HTMLButtonElement>(id).disabled = !this.options.editable() || this.busy;
  }
  private async capture(): Promise<GamePackage> {
    if (!this.options.editable()) throw new Error('Save or export games from your solo world');
    const game = await this.options.capture();
    return { ...game, info: { ...game.info, name: element<HTMLInputElement>('game-name').value.trim() || `${game.info.name} remix` } };
  }
  private card(entry: LibraryGame): HTMLElement {
    const card = document.createElement('li'); card.className = 'game-card'; card.dataset.game = entry.id;
    const title = document.createElement('h3'); title.textContent = entry.game.info.name;
    const description = document.createElement('p'); description.textContent = entry.game.info.description;
    const meta = document.createElement('p'); meta.className = 'module-note';
    meta.textContent = `${entry.folder || 'Unfiled'} · ${entry.game.bundle.modules.length} data · ${entry.game.plugins.length} code plugins`;
    const actions = document.createElement('div'); actions.className = 'lab-actions';
    actions.append(this.button('Play · new world', async () => {
      if (!this.options.editable()) throw new Error('Leave multiplayer before switching games');
      await this.options.play(entry.game);
      show('active-game', entry.game.info.name);
      document.title = `Spacelab · ${entry.game.info.name}`;
      element<HTMLInputElement>('game-name').value = `${entry.game.info.name} remix`;
      this.status(`Playing ${entry.game.info.name}. Its plugin selection is active in a new world.`);
    }, !this.options.editable()), this.button('Export game', () => this.export(entry.game)));
    card.append(title, description, meta, actions);
    const isBuiltin = entry.id === 'builtin' || entry.id.startsWith('builtin') || entry.folder === 'Built-in';
    if (!isBuiltin) {
      const star = this.button(entry.favorite ? '★ Favorite' : '☆ Favorite', async () => {
        await this.library.put(entry.game, { ...entry, favorite: !entry.favorite }); this.refresh();
      }); star.setAttribute('aria-pressed', String(entry.favorite)); actions.append(star);
      const edit = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Organize';
      const nameLabel = document.createElement('label'), name = document.createElement('input');
      name.type = 'text'; name.value = entry.game.info.name; name.maxLength = 256; nameLabel.append('Game name', name);
      const folderLabel = document.createElement('label'), folder = document.createElement('input');
      folder.type = 'text'; folder.value = entry.folder; folder.maxLength = 80; folderLabel.append('Collection', folder);
      edit.append(summary, nameLabel, folderLabel, this.button('Save details', async () => {
        if (!name.value.trim()) throw new Error('Enter a game name');
        await this.library.put({ ...entry.game, info: { ...entry.game.info, name: name.value.trim() } }, { ...entry, folder: folder.value }); this.refresh();
      }), this.button('Remove from library', async () => {
        await this.library.remove(entry.id); this.status(`Removed ${entry.game.info.name} from the library. The active world is unchanged.`); this.refresh();
      }));
      card.append(edit);
    }
    return card;
  }
  private button(label: string, action: () => Promise<void>, disabled = false): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = disabled || this.busy;
    button.onclick = () => { void this.run(action); }; return button;
  }
  private async export(game: GamePackage): Promise<void> {
    downloadBytes(`${game.info.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.spacegame`, await encodePackage(game));
  }
  private status(text: string): void { show('lab-status', text); }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await this.ready; await action(); }
    catch (error) { this.status(`Could not complete the action: ${message(error)}`); }
    finally { this.busy = false; this.refresh(); }
  }
}
