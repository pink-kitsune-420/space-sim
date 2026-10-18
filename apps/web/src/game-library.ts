import { ALLOW_RUNTIME_CODE } from '../../../packages/game-runtime/src/build-policy';
import { decodePackage, encodePackage, validatePackage, type GamePackage } from '../../../packages/game-library/src/archive';
import { runtimeContainsCode } from '../../../packages/game-library/src/runtime-selection';

export interface LibraryGame {
  readonly id: string;
  readonly game: GamePackage;
  readonly folder: string;
  readonly favorite: boolean;
  /** Inert ZIP bytes preserve source through storage; older records retain their v1 value. */
  readonly archive?: Uint8Array<ArrayBuffer>;
}
/** Browser storage contains inert packages. Restoring the library never enables a plugin. */
export class GameLibrary {
  private disposed = false;
  private games = new Map<string, LibraryGame>();
  private database: IDBDatabase | undefined;
  persistent = false;
  get entries(): readonly LibraryGame[] { return [...this.games.values()]; }
  async open(): Promise<void> {
    if(this.disposed)throw new Error('Game library is disposed');
    try {
      this.database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('space-lab-library', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('games', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Game library is blocked by another tab'));
      });
      if(this.disposed){this.database.close();this.database=undefined;return;}
      const entries = await new Promise<LibraryGame[]>((resolve, reject) => {
        const request = this.database!.transaction('games').objectStore('games').getAll();
        request.onsuccess = () => resolve(request.result as LibraryGame[]);
        request.onerror = () => reject(request.error);
      });
      if(this.disposed)return;
      for (const entry of entries) {
        try {
          const game = entry.archive ? await decodePackage(entry.archive) : validatePackage(entry.game);
          if (game.format === 'space-lab-game/1' && typeof entry.id === 'string'
            && typeof entry.folder === 'string' && typeof entry.favorite === 'boolean') this.games.set(entry.id, { ...entry, game });
        } catch { /* A corrupt entry cannot prevent the bundled game from starting. */ }
      }
      this.persistent = true;
    } catch { this.database?.close(); this.database = undefined; }
  }
  async put(game: GamePackage, options: { id?: string; folder?: string; favorite?: boolean } = {}): Promise<LibraryGame> {
    if(this.disposed)throw new Error('Game library is disposed');
    const checked = validatePackage(game);
    if (checked.format !== 'space-lab-game/1') throw new Error('Expected a game');
    if (!ALLOW_RUNTIME_CODE && (checked.plugins.length || checked.runtime && await runtimeContainsCode(checked.runtime))) throw new Error('This build does not allow imported code');
    if (!options.id && this.games.size >= 128) throw new Error('The library is full (128 games); remove a game first');
    const entry: LibraryGame = { id: options.id ?? crypto.randomUUID(), game: checked,
      folder: (options.folder ?? '').trim().slice(0, 80), favorite: options.favorite ?? false, archive: await encodePackage(checked) };
    await this.write(store => store.put(entry));
    this.games.set(entry.id, entry);
    return entry;
  }
  async remove(id: string): Promise<void> {
    if(this.disposed)throw new Error('Game library is disposed');
    await this.write(store => store.delete(id));
    this.games.delete(id);
  }
  private async write(action: (store: IDBObjectStore) => void): Promise<void> {
    if(this.disposed)throw new Error('Game library is disposed');
    if (!this.database) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = this.database!.transaction('games', 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Game library could not be saved; export a copy to keep it'));
      transaction.onerror = () => reject(transaction.error);
      action(transaction.objectStore('games'));
    });
  }
  dispose():void {if(this.disposed)return;this.disposed=true;this.database?.close();this.database=undefined;this.persistent=false;}
}
