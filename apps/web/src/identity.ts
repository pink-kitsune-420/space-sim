/** This browser's pilot name and per-world reconnect tokens. A token is issued by each host
 * and only ever sent back to that world, so one host cannot impersonate a player elsewhere.
 * Storage can be unavailable (private windows, some file:// pages); everything still works
 * for the session, players just cannot reclaim ships after reloading. */
const KEY = 'space-sim-identity';
const MAX_WORLDS = 64;

interface Stored {
  name?: string;
  worlds?: Record<string, { readonly playerId: string; readonly token: string; readonly used: number }>;
}

function read(): Stored {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Stored : {};
  } catch { return {}; }
}
function write(data: Stored): void {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}

export function savedName(): string {
  const name = read().name;
  return typeof name === 'string' ? name : '';
}
export function saveName(name: string): void { write({ ...read(), name }); }

export function tokenFor(worldId: string): string | undefined {
  const entry = read().worlds?.[worldId];
  return typeof entry?.token === 'string' && /^[0-9a-f]{32}$/.test(entry.token) ? entry.token : undefined;
}

export function rememberToken(worldId: string, token: string, playerId: string): void {
  const data = read();
  const worlds = { ...data.worlds, [worldId]: { playerId, token, used: Date.now() } };
  const ids = Object.keys(worlds).sort((a, b) => (worlds[b]!.used ?? 0) - (worlds[a]!.used ?? 0));
  for (const id of ids.slice(MAX_WORLDS)) delete worlds[id];
  write({ ...data, worlds });
}
