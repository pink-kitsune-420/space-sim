import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JoinIdentity, rememberToken } from '../../apps/web/src/identity';

function storage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }, key: index => [...values.keys()][index] ?? null };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  const held = new Set<string>();
  vi.stubGlobal('navigator', { locks: {
    async request(name: string, _options: unknown, callback: (lock: object | null) => Promise<void> | void) {
      // Browser lock requests are queued, after releases already requested by this task.
      await Promise.resolve();
      if (held.has(name)) return callback(null);
      held.add(name);
      try { await callback({ name }); } finally { held.delete(name); }
    },
  } });
});
afterEach(() => vi.unstubAllGlobals());

it('reserves saved pilots across windows, gives another window a fresh seat and reconnects on release', async () => {
  const firstTab = sessionStorage;
  rememberToken('world', 'a'.repeat(32), 'pilot-a');
  const first = new JoinIdentity();
  expect(await first.token('world')).toBe('a'.repeat(32));
  vi.stubGlobal('sessionStorage', storage());
  const second = new JoinIdentity();
  expect(await second.token('world')).toBeUndefined();
  second.remember('world', 'b'.repeat(32), 'pilot-b');
  first.release();
  vi.stubGlobal('sessionStorage', firstTab);
  const reload = new JoinIdentity();
  expect(await reload.token('world')).toBe('a'.repeat(32));
  reload.release(); second.release();
});

it('never reclaims the host browser’s pilot', async () => {
  rememberToken('world', 'a'.repeat(32), 'host');
  const identity = new JoinIdentity();
  expect(await identity.token('world', 'host')).toBeUndefined();
  identity.release();
});

it.each([false, true])('keeps separate session seats when Web Locks are unavailable (rejected: %s)', async rejected => {
  vi.stubGlobal('navigator', rejected ? { locks: { request: () => Promise.reject(new Error('Opaque origin')) } } : {});
  rememberToken('world', 'a'.repeat(32), 'pilot-a');
  const first = new JoinIdentity();
  expect(await first.token('world')).toBeUndefined();
  first.remember('world', 'b'.repeat(32), 'pilot-b');
  const reload = new JoinIdentity();
  expect(await reload.token('world')).toBe('b'.repeat(32));
  vi.stubGlobal('sessionStorage', storage());
  const second = new JoinIdentity();
  expect(await second.token('world')).toBeUndefined();
  first.release(); reload.release(); second.release();
});

it('does not return a token when disconnected while waiting for its reservation', async () => {
  let grant!: () => void;
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown, callback: (lock: object) => void) =>
    new Promise<void>(done => { grant = () => { callback({}); done(); }; }) } });
  rememberToken('world', 'a'.repeat(32), 'pilot-a');
  const identity = new JoinIdentity();
  const pending = identity.token('world');
  identity.release();
  grant();
  expect(await pending).toBeUndefined();
});
