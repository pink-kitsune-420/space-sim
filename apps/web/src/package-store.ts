import type { JoinOffer } from '../../../packages/game-api/src/index';
import { packageDigest, type PackageIdentity, type PackageStore, type StoredPackage } from '../../../packages/game-runtime/src/package-store';

/** Versioned inert, content-addressed storage; unrelated to active game selections. */
export class BrowserPackageStore implements PackageStore {
  private database: Promise<IDBDatabase> | undefined;
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      let failed = false;
      const request = indexedDB.open('space-lab-modules', 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('packages')) database.createObjectStore('packages', { keyPath: 'digest' });
        if (!database.objectStoreNames.contains('join-packs')) database.createObjectStore('join-packs', { keyPath: 'digest' });
        if (!database.objectStoreNames.contains('join-approvals')) database.createObjectStore('join-approvals', { keyPath: 'scope' });
      };
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
  async joinApproved(scope: string, offer: JoinOffer): Promise<boolean> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('join-approvals', 'readonly'), request = transaction.objectStore('join-approvals').get(scope);
      transaction.oncomplete = () => resolve(request.result?.offer === offer.id && request.result?.digest === offer.packDigest);
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Could not read server approval'));
    });
  }
  async joinCached(offer: JoinOffer): Promise<Uint8Array | undefined> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('join-packs', 'readonly'), request = transaction.objectStore('join-packs').get(packageDigest(offer.packDigest));
      transaction.oncomplete = () => resolve(request.result?.bytes ? Uint8Array.from(request.result.bytes) : undefined);
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Could not read server pack'));
    });
  }
  /** Packages, inert cache, provenance and source-scoped exact approval commit together. */
  async commitJoin(scope: string, offer: JoinOffer, bytes: Uint8Array, entries: readonly StoredPackage[], signal: AbortSignal): Promise<void> {
    const database = await this.open(); signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['packages', 'join-packs', 'join-approvals'], 'readwrite');
      const abort = (): void => { try { transaction.abort(); } catch { /* already completed */ } };
      signal.addEventListener('abort', abort, { once: true });
      transaction.oncomplete = () => { signal.removeEventListener('abort', abort); resolve(); };
      transaction.onabort = transaction.onerror = () => { signal.removeEventListener('abort', abort); reject(transaction.error ?? new Error('Server installation cancelled; the active game was retained')); };
      try {
        for (const entry of entries) { packageDigest(entry.digest); transaction.objectStore('packages').put(entry); }
        transaction.objectStore('join-packs').put({ digest: packageDigest(offer.packDigest), bytes: bytes.slice() });
        transaction.objectStore('join-approvals').put({ scope, offer: offer.id, digest: offer.packDigest, source: scope, installedAt: new Date().toISOString() });
      } catch (error) { abort(); reject(error); }
    });
  }

}
