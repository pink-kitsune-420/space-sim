import type { AuthoritativeLock, ModuleLock, WorldRuleState } from '../../game-api/src/index';
import { COMMAND_ID, MAX_COMMAND_PARAMETERS } from '../../game-runtime/src/commands';
import type { UniverseDefinition } from '../../sim-core/src/universe';
import type { SavedShip } from '../../sim-core/src/save';

/** Bumped whenever a message changes shape. Client and host must match exactly, and so must
 * the physics model, because clients predict with the same code the host runs. */
export const PROTOCOL = 'space-sim-net/4';
/** Clients only send small commands. */
export const MAX_CLIENT_MESSAGE = 16 * 1024;
/** Welcome messages and complete snapshots carry the whole world (a 65,536-object world
 * is about 23 MB of JSON). */
export const MAX_HOST_MESSAGE = 64 * 1024 * 1024;
export const MAX_PASSWORD = 128;

export interface NetPlayer {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
  /** Playing inside the hosting browser. */
  readonly host?: boolean;
}
/** A ship as the host simulates it: saved state plus the held controls the host applies
 * and, for its owner, the last input sequence the host has applied. */
export interface NetShip extends SavedShip {
  readonly controls: readonly [turn: number, throttle: number, engine: 0 | 1];
  readonly ack?: number;
}
export interface SessionRules {
  readonly maxPlayers: number;
  readonly maxShipsPerPlayer: number;
  readonly allowGodMode: boolean;
  readonly snapshotEveryTicks: number;
}

export type HostMessage =
  | { readonly t: 'info'; readonly protocol: string; readonly model: string; readonly worldId: string;
      readonly name: string; readonly password: boolean; readonly players: number; readonly maxPlayers: number;
      readonly fingerprint?: string }
  | { readonly t: 'welcome'; readonly playerId: string; readonly token?: string; readonly universe: UniverseDefinition;
      readonly systemId: string; readonly tick: number; readonly time: number; readonly paused: boolean; readonly reason?: string;
      readonly rules: SessionRules; readonly players: readonly NetPlayer[]; readonly ships: readonly NetShip[];
      readonly lock?: AuthoritativeLock | ModuleLock; readonly fingerprint?: string;
      readonly moduleState?: Readonly<Record<string, WorldRuleState>>;
      readonly warp?: number }
  /** `full`: the complete world (replace everything). Otherwise a delta: the listed ships
   * changed (or are refreshed), `gone` ships were removed, and every other ship continues
   * exactly as the client already computes it. */
  | { readonly t: 'snapshot'; readonly tick: number; readonly time: number; readonly paused: boolean; readonly reason?: string;
      readonly ships: readonly NetShip[]; readonly full?: boolean; readonly gone?: readonly string[];
      readonly moduleState?: Readonly<Record<string, WorldRuleState>>;
      readonly warp?: number }
  | { readonly t: 'players'; readonly players: readonly NetPlayer[] }
  | { readonly t: 'pong'; readonly id: number; readonly tick: number }
  | { readonly t: 'notice'; readonly text: string }
  | { readonly t: 'error'; readonly code: ErrorCode; readonly message: string };
export type ErrorCode = 'version' | 'password' | 'full' | 'kicked' | 'replaced' | 'invalid' | 'rate' | 'timeout' | 'closing';

export type ClientMessage =
  | { readonly t: 'join'; readonly name: string; readonly token?: string; readonly password?: string }
  /** Held controls for one owned ship, effective from simulation `tick`. `set` also sets the
   * throttle at that tick (the throttle slider). */
  | { readonly t: 'input'; readonly seq: number; readonly ship: string; readonly tick: number;
      readonly turn: number; readonly throttle: number; readonly engine: boolean; readonly set?: number }
  | { readonly t: 'spawn'; readonly preset?: string }
  | { readonly t: 'respawn'; readonly ship: string; readonly preset?: string }
  | { readonly t: 'remove'; readonly ship: string }
  | { readonly t: 'god'; readonly ship: string; readonly on: boolean }
  /** A registered module command for one owned ship. The host validates ownership and
   * arguments and runs it between fixed steps; the result arrives in snapshots. */
  | { readonly t: 'command'; readonly ship: string; readonly command: string; readonly args?: Readonly<Record<string, number>> }
  | { readonly t: 'ping'; readonly id: number };

export class ProtocolError extends Error {}

function bad(message: string): never { throw new ProtocolError(message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('message must be an object');
  return value as Record<string, unknown>;
}
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
function text(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || value.length > max) bad(`${field} must be a string of at most ${max} characters`);
  return value as string;
}
function ident(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) bad(`${field} must be an id`);
  return value as string;
}
function int(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) bad(`${field} must be an integer in [${min}, ${max}]`);
  return value as number;
}
function unit(value: unknown, field: string, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > 1) bad(`${field} must be in [${min}, 1]`);
  return value as number;
}
function optional<T>(value: unknown, read: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : read(value);
}

function parse(textValue: string, max: number): Record<string, unknown> {
  if (textValue.length > max) bad(`message exceeds ${max} characters`);
  let value: unknown;
  try { value = JSON.parse(textValue); } catch { bad('message is not JSON'); }
  return object(value);
}

/** Every client message is untrusted: shapes, ranges and sizes are checked here. Ownership
 * and timing are checked by the host session. */
export function parseClientMessage(raw: string): ClientMessage {
  const m = parse(raw, MAX_CLIENT_MESSAGE);
  switch (m.t) {
    case 'join': {
      const token = optional(m.token, v => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v) ? v : bad('token must be 32 hex digits'));
      const password = optional(m.password, v => text(v, MAX_PASSWORD, 'password'));
      return { t: 'join', name: text(m.name, 64, 'name'), ...(token ? { token } : {}), ...(password !== undefined ? { password } : {}) };
    }
    case 'input': {
      if (typeof m.engine !== 'boolean') bad('engine must be boolean');
      const set = optional(m.set, v => unit(v, 'set', 0));
      return { t: 'input', seq: int(m.seq, 'seq'), ship: ident(m.ship, 'ship'), tick: int(m.tick, 'tick'),
        turn: unit(m.turn, 'turn', -1), throttle: unit(m.throttle, 'throttle', -1), engine: m.engine,
        ...(set !== undefined ? { set } : {}) };
    }
    case 'spawn': {
      const preset = optional(m.preset, v => ident(v, 'preset'));
      return { t: 'spawn', ...(preset ? { preset } : {}) };
    }
    case 'respawn': {
      const preset = optional(m.preset, v => ident(v, 'preset'));
      return { t: 'respawn', ship: ident(m.ship, 'ship'), ...(preset ? { preset } : {}) };
    }
    case 'remove': return { t: 'remove', ship: ident(m.ship, 'ship') };
    case 'god':
      if (typeof m.on !== 'boolean') bad('on must be boolean');
      return { t: 'god', ship: ident(m.ship, 'ship'), on: m.on };
    case 'command': {
      if (typeof m.command !== 'string' || !COMMAND_ID.test(m.command)) bad('command must be a module command id');
      const args = optional(m.args, v => {
        const entries = Object.entries(object(v));
        if (entries.length > MAX_COMMAND_PARAMETERS) bad(`args must have at most ${MAX_COMMAND_PARAMETERS} entries`);
        const parsed: Record<string, number> = Object.create(null);
        for (const [key, n] of entries) {
          if (!/^[a-z][A-Za-z0-9]{0,31}$/.test(key) || typeof n !== 'number' || !Number.isFinite(n)) bad('args must map parameter names to finite numbers');
          parsed[key] = n as number;
        }
        return parsed;
      });
      return { t: 'command', ship: ident(m.ship, 'ship'), command: m.command as string, ...(args ? { args } : {}) };
    }
    case 'ping': return { t: 'ping', id: int(m.id, 'id') };
    default: return bad(`unknown message type ${String(m.t)}`);
  }
}

function players(value: unknown): NetPlayer[] {
  if (!Array.isArray(value) || value.length > 1024) bad('players must be a list');
  return (value as unknown[]).map(raw => {
    const p = object(raw);
    if (typeof p.connected !== 'boolean') bad('player.connected must be boolean');
    return { id: ident(p.id, 'player.id'), name: text(p.name, 64, 'player.name'), connected: p.connected,
      ...(p.host === true ? { host: true } : {}) };
  });
}
/** Ship contents are validated against the mirror world when applied; here only the list
 * shape, controls and acknowledgements. */
/** Most ships one message may list (a full snapshot of a large world). */
export const MAX_NET_SHIPS = 65_536;
function ships(value: unknown): NetShip[] {
  if (!Array.isArray(value) || value.length > MAX_NET_SHIPS) bad('ships must be a list');
  return (value as unknown[]).map(raw => {
    const s = object(raw);
    const c = s.controls;
    if (!Array.isArray(c) || c.length !== 3 || (c[2] !== 0 && c[2] !== 1)) bad('ship.controls must be [turn, throttle, engine]');
    unit(c[0], 'ship.controls turn', -1); unit(c[1], 'ship.controls throttle', -1);
    if (s.ack !== undefined) int(s.ack, 'ship.ack');
    return s as unknown as NetShip;
  });
}
function clock(m: Record<string, unknown>): { tick: number; time: number; paused: boolean; reason?: string; warp?: number } {
  if (typeof m.time !== 'number' || !Number.isFinite(m.time) || m.time < 0) bad('time must be finite');
  if (typeof m.paused !== 'boolean') bad('paused must be boolean');
  const reason = optional(m.reason, v => text(v, 200, 'reason'));
  const warp = optional(m.warp, v => int(v, 'warp', 1, 100_000));
  return { tick: int(m.tick, 'tick'), time: m.time, paused: m.paused, ...(reason ? { reason } : {}), ...(warp !== undefined ? { warp } : {}) };
}

function parseRuleStates(value: unknown): Record<string, WorldRuleState> {
  const ms = object(value);
  const result: Record<string, WorldRuleState> = Object.create(null);
  for (const [modId, raw] of Object.entries(ms)) {
    const entry = object(raw);
    const state = object(entry.state);
    if (!Number.isSafeInteger(state.version) || (state.version as number) < 0) bad('moduleState version must be a non-negative integer');
    const randomState = int(entry.randomState, 'randomState');
    result[modId] = { state: { version: state.version as number, value: state.value as any }, randomState };
  }
  return result;
}

/** A host is only trusted to run the game; a broken or hostile one must not crash a client. */
export function parseHostMessage(raw: string): HostMessage {
  const m = parse(raw, MAX_HOST_MESSAGE);
  switch (m.t) {
    case 'info': {
      if (typeof m.password !== 'boolean') bad('password must be boolean');
      const fingerprint = optional(m.fingerprint, v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : bad('fingerprint must be 64 hex digits'));
      return { t: 'info', protocol: text(m.protocol, 64, 'protocol'), model: text(m.model, 128, 'model'),
        worldId: ident(m.worldId, 'worldId'), name: text(m.name, 80, 'name'), password: m.password,
        players: int(m.players, 'players'), maxPlayers: int(m.maxPlayers, 'maxPlayers'),
        ...(fingerprint ? { fingerprint } : {}) };
    }
    case 'welcome': {
      const r = object(m.rules);
      if (typeof r.allowGodMode !== 'boolean') bad('rules.allowGodMode must be boolean');
      const token = optional(m.token, v => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v) ? v : bad('token must be 32 hex digits'));
      const lock = optional(m.lock, v => {
        const l = object(v);
        if (l.format !== 'space-sim-auth-lock/1' && l.format !== 'space-sim-lock/1') bad('invalid lock format');
        return l as unknown as AuthoritativeLock | ModuleLock;
      });
      const fingerprint = optional(m.fingerprint, v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : bad('fingerprint must be 64 hex digits'));
      const moduleState = optional(m.moduleState, parseRuleStates);
      return { t: 'welcome', playerId: ident(m.playerId, 'playerId'), ...(token ? { token } : {}),
        universe: object(m.universe) as unknown as UniverseDefinition, systemId: ident(m.systemId, 'systemId'),
        ...clock(m),
        rules: { maxPlayers: int(r.maxPlayers, 'rules.maxPlayers'), maxShipsPerPlayer: int(r.maxShipsPerPlayer, 'rules.maxShipsPerPlayer'),
          allowGodMode: r.allowGodMode, snapshotEveryTicks: int(r.snapshotEveryTicks, 'rules.snapshotEveryTicks', 1, 1000) },
        players: players(m.players), ships: ships(m.ships),
        ...(lock ? { lock } : {}), ...(fingerprint ? { fingerprint } : {}), ...(moduleState ? { moduleState } : {}) };
    }
    case 'snapshot': {
      if (m.full !== undefined && typeof m.full !== 'boolean') bad('full must be boolean');
      const gone = optional(m.gone, v => {
        if (!Array.isArray(v) || v.length > MAX_NET_SHIPS) bad('gone must be a list');
        return (v as unknown[]).map(id => ident(id, 'gone'));
      });
      const moduleState = optional(m.moduleState, parseRuleStates);
      return { t: 'snapshot', ...clock(m), ships: ships(m.ships), ...(m.full ? { full: true } : {}),
        ...(gone?.length ? { gone } : {}), ...(moduleState ? { moduleState } : {}) };
    }
    case 'players': return { t: 'players', players: players(m.players) };
    case 'pong': return { t: 'pong', id: int(m.id, 'id'), tick: int(m.tick, 'tick') };
    case 'notice': return { t: 'notice', text: text(m.text, 500, 'text') };
    case 'error': {
      const codes: readonly ErrorCode[] = ['version', 'password', 'full', 'kicked', 'replaced', 'invalid', 'rate', 'timeout', 'closing'];
      const code = codes.includes(m.code as ErrorCode) ? m.code as ErrorCode : 'invalid';
      return { t: 'error', code, message: text(m.message, 500, 'message') };
    }
    default: return bad(`unknown message type ${String(m.t)}`);
  }
}
