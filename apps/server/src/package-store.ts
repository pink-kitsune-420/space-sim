import { mkdir, readFile, readdir, rename, lstat, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { packageDigest, type PackageIdentity, type PackageStore, type StoredPackage } from '../../../packages/game-runtime/src/package-store';

/** Local owner-configured inert storage. One atomic record per content identity. */
export class FilePackageStore implements PackageStore {
  private readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  private async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('Module store must be a real directory');
  }
  async get(digest: string): Promise<StoredPackage | undefined> {
    const path = join(this.directory, `${packageDigest(digest)}.json`);
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Module store records must be regular files');
      const info = await lstat(path);
      if (!info.isFile() || info.size > 45 * 1024 * 1024) throw new Error('Module store record exceeds size limit');
      const raw = JSON.parse(await readFile(path, 'utf8')) as Omit<StoredPackage, 'bytes'> & { bytes: string };
      if (raw.digest !== digest || typeof raw.bytes !== 'string' || raw.bytes.length > 44 * 1024 * 1024) throw new Error('Corrupt module store record');
      const decoded = Buffer.from(raw.bytes, 'base64');
      if (decoded.toString('base64') !== raw.bytes) throw new Error('Corrupt module store encoding');
      const bytes = new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
      if (bytes.length > 32 * 1024 * 1024) throw new Error('Module store record exceeds size limit');
      return { ...raw, bytes };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  async list(): Promise<readonly PackageIdentity[]> {
    await this.prepare(); const entries: PackageIdentity[] = [];
    for (const name of (await readdir(this.directory)).sort()) {
      if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
      const entry = await this.get(name.slice(0, -5));
      if (entry) entries.push({ digest: entry.digest, id: entry.id, version: entry.version, containsCode: entry.containsCode });
    }
    return entries;
  }
  async putVerified(entry: StoredPackage): Promise<void> {
    packageDigest(entry.digest); await this.prepare();
    const temporary = join(this.directory, `pending-${crypto.randomUUID()}`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      if (entry.bytes.length > 32 * 1024 * 1024) throw new Error('Module store record exceeds size limit');
      await file.writeFile(JSON.stringify({ ...entry, bytes: Buffer.from(entry.bytes).toString('base64') }));
      await file.close(); await rename(temporary, join(this.directory, `${entry.digest}.json`));
    } finally { await file.close(); await unlink(temporary).catch(() => {}); }
  }
  async remove(digest: string): Promise<void> {
    await unlink(join(this.directory, `${packageDigest(digest)}.json`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
