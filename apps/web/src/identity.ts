/** This browser's pilot name and per-world reconnect tokens. A token is issued by each host
 * and only ever sent back to that world, so one host cannot impersonate a player elsewhere.
 * Storage can be unavailable (private windows, some file:// pages); everything still works
 * for the session, players just cannot reclaim ships after reloading.
 *
 * Tabs of one browser share that storage, so a tab joining a world hosted in another tab
 * (or a second seat in the same world) keeps its own token in tab storage instead. */
const KEY = 'space-sim-identity';
const TAB_KEY = 'space-sim-tab-identity';
const MAX_WORLDS = 64;

interface Stored {
  name?: string;
  worlds?: Record<string, { readonly playerId: string; readonly token: string; readonly used: number }>;
}

type Scope = 'shared' | 'tab';
const store = (scope: Scope): Storage => scope === 'tab' ? sessionStorage : localStorage;
function read(scope: Scope = 'shared'): Stored {
  try {
    const value = JSON.parse(store(scope).getItem(scope === 'tab' ? TAB_KEY : KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Stored : {};
  } catch { return {}; }
}
function write(data: Stored, scope: Scope = 'shared'): void {
  try { store(scope).setItem(scope === 'tab' ? TAB_KEY : KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}
function entry(worldId: string, scope: Scope): { readonly playerId: string; readonly token: string } | undefined {
  const e = read(scope).worlds?.[worldId];
  return typeof e?.token === 'string' && /^[0-9a-f]{32}$/.test(e.token) && typeof e.playerId === 'string' ? e : undefined;
}

export function savedName(): string {
  const name = read().name;
  return typeof name === 'string' ? name : '';
}
export function saveName(name: string): void { write({ ...read(), name }); }

/** This browser's seat in a world (the host's own, or a player's). */
export function tokenFor(worldId: string): string | undefined { return entry(worldId, 'shared')?.token; }

/** The token to present when joining a world: this tab's own seat first, then the
 * browser's, except the seat of a host playing in another tab of this browser. */
export function joinTokenFor(worldId: string, hostId?: string): string | undefined {
  const own = entry(worldId, 'tab') ?? entry(worldId, 'shared');
  return own && own.playerId !== hostId ? own.token : undefined;
}

/** Keep a newly issued player token: in shared storage, unless that holds the seat of the
 * host playing in another tab of this browser (then in this tab only). */
export function rememberJoinToken(worldId: string, token: string, playerId: string, hostId?: string): void {
  const shared = entry(worldId, 'shared');
  rememberToken(worldId, token, playerId, hostId !== undefined && shared?.playerId === hostId ? 'tab' : 'shared');
}

export function rememberToken(worldId: string, token: string, playerId: string, scope: Scope = 'shared'): void {
  const data = read(scope);
  const worlds = { ...data.worlds, [worldId]: { playerId, token, used: Date.now() } };
  const ids = Object.keys(worlds).sort((a, b) => (worlds[b]!.used ?? 0) - (worlds[a]!.used ?? 0));
  for (const id of ids.slice(MAX_WORLDS)) delete worlds[id];
  write({ ...data, worlds }, scope);
}
