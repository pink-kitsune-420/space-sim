import type { SimulationContextFactory } from '../../../packages/game-api/src/index';
import { builtinContextFactory } from '../../../packages/modules/src/index';
import { closeSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs';
import { copyFile, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadWorld, type LoadedWorld, type WorldSave } from '../../../packages/sim-core/src/save';

const stamp = (date = new Date()): string => date.toISOString().replace(/[:.]/g, '-');

/** The server's world on disk: `world.json`, replaced atomically on every save, and
 * timestamped copies under `backups/`. A save is written to a temporary file, flushed to
 * disk and renamed over the old one, so a crash mid-write never leaves a torn world. */
export class WorldStore {
  readonly file: string;
  readonly backups: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string, private readonly keepBackups: number, private readonly log: (message: string) => void = () => {},
    private readonly createContext: SimulationContextFactory = builtinContextFactory('node'),
    private readonly restore?: (raw: unknown) => LoadedWorld) {
    this.file = join(dir, 'world.json');
    this.backups = join(dir, 'backups');
  }

  /** `world.json`, or undefined when there is none yet. If it exists but cannot be used, it
   * is moved aside (never overwritten) and the newest valid backup is loaded instead. */
  async load(): Promise<{ readonly loaded: LoadedWorld; readonly from: string } | undefined> {
    const read = async (path: string): Promise<LoadedWorld> => {
      const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
      return this.restore ? this.restore(raw) : loadWorld(raw, { createContext: this.createContext });
    };
    try {
      return { loaded: await read(this.file), from: this.file };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      const aside = join(this.dir, `world.unusable-${stamp()}.json`);
      this.log(`World file ${this.file} is unusable: ${(error as Error).message}`);
      await rename(this.file, aside);
      this.log(`Moved it to ${aside}.`);
    }
    for (const name of (await this.backupFiles()).reverse()) {
      const path = join(this.backups, name);
      try {
        const loaded = await read(path);
        this.log(`Restored the world from backup ${path}.`);
        return { loaded, from: path };
      } catch (error) {
        this.log(`Backup ${path} is unusable: ${(error as Error).message}`);
      }
    }
    throw new Error(`No usable world in ${this.dir}. Fix or remove the moved files, or start with --new.`);
  }

  /** Atomically replace world.json. Saves are serialized. */
  save(save: WorldSave): Promise<void> {
    const run = this.queue.then(() => this.write(JSON.stringify(save, null, 1)));
    this.queue = run.catch(() => {});
    return run;
  }

  /** Resolves once every queued save and backup has finished. */
  idle(): Promise<void> { return this.queue.then(() => {}); }

  /** For crash handlers: the same atomic replace, synchronously. */
  saveSync(save: WorldSave): void {
    const temporary = `${this.file}.tmp`;
    const fd = openSync(temporary, 'w');
    try { writeSync(fd, JSON.stringify(save, null, 1)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.file);
  }

  /** Copy the current world.json into backups/ and keep only the newest copies. */
  backup(): Promise<string | undefined> {
    const run = this.queue.then(async () => {
      await mkdir(this.backups, { recursive: true });
      const target = join(this.backups, `world-${stamp()}.json`);
      try { await copyFile(this.file, target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
      const files = await this.backupFiles();
      for (const old of files.slice(0, Math.max(0, files.length - this.keepBackups))) await rm(join(this.backups, old), { force: true });
      return target;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /** Oldest first. */
  async backupFiles(): Promise<string[]> {
    try {
      return (await readdir(this.backups)).filter(name => /^world-[0-9TZ-]+\.json$/.test(name)).sort();
    } catch { return []; }
  }

  private async write(text: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.file}.tmp`;
    const handle = await open(temporary, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await rename(temporary, this.file);
  }
}
