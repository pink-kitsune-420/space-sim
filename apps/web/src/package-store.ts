import { packageDigest, type PackageIdentity, type PackageStore, type StoredPackage } from '../../../packages/game-runtime/src/package-store';

/** Versioned inert, content-addressed storage; unrelated to active game selections. */
export class BrowserPackageStore implements PackageStore {
  private database: Promise<IDBDatabase> | undefined;
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      let failed = false;
      const request = indexedDB.open('space-lab-modules', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('packages', { keyPath: 'digest' });
      request.onsuccess = () => {
        const database = request.result;
        if (failed) { database.close(); return; }
        database.onversionchange = () => { database.close(); this.database = undefined; };
        resolve(database);
      };
      request.onerror = () => { failed = true; this.database = undefined; reject(request.error); };
      request.onblocked = () => { failed = true; this.database = undefined; reject(new Error('Module storage is blocked by another tab')); };
    });
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('packages', mode);
      const request = action(transaction.objectStore('packages'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Module storage failed; export a copy to keep it'));
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  }
  get(digest: string): Promise<StoredPackage | undefined> { return this.transaction('readonly', store => store.get(packageDigest(digest))); }
  async list(): Promise<readonly PackageIdentity[]> {
    const records = await this.transaction<StoredPackage[]>('readonly', store => store.getAll());
    return records.map(({ digest, id, version, containsCode }) => ({ digest, id, version, containsCode }));
  }
  async putVerified(entry: StoredPackage): Promise<void> {
    packageDigest(entry.digest);
    await this.transaction('readwrite', store => store.put(entry));
  }
  async remove(digest: string): Promise<void> { await this.transaction('readwrite', store => store.delete(packageDigest(digest))); }
}
