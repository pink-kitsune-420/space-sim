import type { PilotRegistry } from '../../../packages/game-api/src/index';
import { DEFAULT_CONTROLLER_PROFILE, normalizeProfile, type ControllerProfile } from './gamepad';
import { newToken } from '../../../packages/net/src/sha256';

/** Split screen: up to four pilots on one screen, each flying their own ship. */
export const MAX_LOCAL_PLAYERS = 4;
export type PlayerCount = 1 | 2 | 3 | 4;

/** What a player flies with. `auto` (player 1 only) is the keyboard, mouse, touch overlay
 * and any controller no other player has claimed. */
export type InputDevice = 'auto' | 'keyboard' | `pad:${number}` | 'none';
export type TwoPlayerLayout = 'auto' | 'side' | 'stacked';
export type ScreenMode = 'dynamic' | 'split';
export type NavballAnchor = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center-bottom' | 'custom';

export interface NavballPlacement {
  /** Anchor preset or 'custom' */
  readonly anchor: NavballAnchor;
  /** Normalized fraction [0..1] within the pane or shared viewport. */
  readonly x: number;
  readonly y: number;
  /** Whether the navball is pinned in place (cannot be dragged). */
  readonly pinned: boolean;
}

export function defaultNavballPlacement(slot: number): NavballPlacement {
  switch (slot) {
    case 1: return { anchor: 'bottom-left', x: 0.14, y: 0.82, pinned: true };
    case 2: return { anchor: 'top-left', x: 0.14, y: 0.22, pinned: true };
    case 3: return { anchor: 'top-right', x: 0.88, y: 0.22, pinned: true };
    default: return { anchor: 'bottom-right', x: 0.88, y: 0.82, pinned: true };
  }
}

export function normalizeNavballPlacement(raw: unknown, fallback: NavballPlacement): NavballPlacement {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const r = raw as Record<string, unknown>;
  const validAnchors: readonly NavballAnchor[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center-bottom', 'custom'];
  const anchor = validAnchors.includes(r.anchor as NavballAnchor) ? (r.anchor as NavballAnchor) : fallback.anchor;
  const x = typeof r.x === 'number' && Number.isFinite(r.x) ? Math.max(0.02, Math.min(0.98, r.x)) : fallback.x;
  const y = typeof r.y === 'number' && Number.isFinite(r.y) ? Math.max(0.02, Math.min(0.98, r.y)) : fallback.y;
  const pinned = typeof r.pinned === 'boolean' ? r.pinned : fallback.pinned;
  return { anchor, x, y, pinned };
}

export interface PlayerSlot {
  /** Player 1's name is the pilot name; the others are named here. */
  readonly name: string;
  readonly device: InputDevice;
  readonly profile: ControllerProfile;
  /** Seat secret, so a returning player gets their own ships back in a saved world. */
  readonly token: string;
  readonly navball: NavballPlacement;
}

export interface LocalPlayersConfig {
  readonly count: PlayerCount;
  readonly twoPlayerLayout: TwoPlayerLayout;
  readonly screenMode: ScreenMode;
  readonly slots: readonly PlayerSlot[];
}

/** Pane accents, also used for each player's name tag. */
export const PLAYER_COLORS: readonly string[] = ['#38ef7d', '#00d2ff', '#ffb347', '#ff6b9d'];

const STORAGE_KEY = 'space-sim:local-players:v1';

export function padDevice(index: number): InputDevice { return `pad:${index}`; }
export function deviceIndex(device: InputDevice): number | undefined {
  return device.startsWith('pad:') ? Number(device.slice(4)) : undefined;
}

function defaultSlot(slot: number, profile = DEFAULT_CONTROLLER_PROFILE): PlayerSlot {
  return { name: slot === 0 ? '' : `Pilot ${slot + 1}`, device: slot === 0 ? 'auto' : 'none', profile, token: newToken(), navball: defaultNavballPlacement(slot) };
}

export function defaultLocalPlayers(player1Profile = DEFAULT_CONTROLLER_PROFILE): LocalPlayersConfig {
  return { count: 1, twoPlayerLayout: 'auto', screenMode: 'dynamic',
    slots: Array.from({ length: MAX_LOCAL_PLAYERS }, (_, i) => defaultSlot(i, i === 0 ? player1Profile : DEFAULT_CONTROLLER_PROFILE)) };
}

function validDevice(value: unknown, slot: number): InputDevice {
  if (value === 'keyboard' || value === 'none' || (value === 'auto' && slot === 0)) return value;
  if (typeof value === 'string' && /^pad:\d{1,2}$/.test(value)) return value as InputDevice;
  return slot === 0 ? 'auto' : 'none';
}

/** A stored configuration with every field checked and duplicate devices released. */
export function normalizeLocalPlayers(raw: unknown, player1Profile = DEFAULT_CONTROLLER_PROFILE): LocalPlayersConfig {
  const base = defaultLocalPlayers(player1Profile);
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const rawSlots = Array.isArray(r.slots) ? r.slots : [];
  const slots = base.slots.map((fallback, i) => {
    const s = rawSlots[i];
    if (typeof s !== 'object' || s === null) return fallback;
    const o = s as Record<string, unknown>;
    return {
      name: typeof o.name === 'string' ? o.name.slice(0, 24) : fallback.name,
      device: validDevice(o.device, i),
      profile: o.profile === undefined ? fallback.profile : normalizeProfile(o.profile),
      token: typeof o.token === 'string' && /^[0-9a-f]{16,128}$/i.test(o.token) ? o.token : fallback.token,
      navball: o.navball === undefined ? fallback.navball : normalizeNavballPlacement(o.navball, fallback.navball),
    };
  });
  const count = r.count === 2 || r.count === 3 || r.count === 4 ? r.count : 1;
  const layout = r.twoPlayerLayout === 'side' || r.twoPlayerLayout === 'stacked' ? r.twoPlayerLayout : 'auto';
  const screenMode: ScreenMode = r.screenMode === 'split' ? 'split' : 'dynamic';
  let config: LocalPlayersConfig = { count, twoPlayerLayout: layout, screenMode, slots };
  // Later slots give up a device an earlier one already holds.
  for (let i = 0; i < slots.length; i++) config = assignDevice(config, i, config.slots[i]!.device);
  return config;
}

export function loadLocalPlayers(player1Profile?: ControllerProfile): LocalPlayersConfig {
  if (typeof localStorage === 'undefined') return defaultLocalPlayers(player1Profile);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeLocalPlayers(JSON.parse(raw), player1Profile) : defaultLocalPlayers(player1Profile);
  } catch {
    return defaultLocalPlayers(player1Profile);
  }
}

export function saveLocalPlayers(config: LocalPlayersConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota errors
  }
}

/** Give `device` to `slot`; any other slot holding it falls back (player 1 to `auto`). */
export function assignDevice(config: LocalPlayersConfig, slot: number, device: InputDevice): LocalPlayersConfig {
  const wanted = validDevice(device, slot);
  const exclusive = wanted !== 'none' && wanted !== 'auto';
  const slots = config.slots.map((s, i) => {
    if (i === slot) return { ...s, device: wanted };
    if (exclusive && s.device === wanted) return { ...s, device: i === 0 ? 'auto' as const : 'none' as const };
    return s;
  });
  return { ...config, slots };
}

export function updateSlot(config: LocalPlayersConfig, slot: number, change: Partial<Omit<PlayerSlot, 'token' | 'device'>>): LocalPlayersConfig {
  return { ...config, slots: config.slots.map((s, i) => i === slot ? { ...s, ...change } : s) };
}

export function setPlayerCount(config: LocalPlayersConfig, count: number): LocalPlayersConfig {
  const n = Math.max(1, Math.min(MAX_LOCAL_PLAYERS, Math.round(count))) as PlayerCount;
  return { ...config, count: n };
}

/** Which active player owns pad `index`, given the connected pads. An explicit claim by an
 * active player wins; otherwise player 1 on `auto` takes it (alone: every pad; in split
 * screen: only the lowest unclaimed pad, leaving the rest free to join). */
export function padOwner(config: LocalPlayersConfig, index: number, connected: readonly number[]): number | undefined {
  const active = config.slots.slice(0, config.count);
  const explicit = active.findIndex(s => s.device === padDevice(index));
  if (explicit >= 0) return explicit;
  if (active[0]?.device !== 'auto') return undefined;
  if (config.count === 1) return 0;
  const claimed = new Set(active.map(s => deviceIndex(s.device)).filter(i => i !== undefined));
  const first = connected.filter(i => !claimed.has(i)).sort((a, b) => a - b)[0];
  return first === index ? 0 : undefined;
}

/** The active player who flies with the keyboard, if any. */
export function keyboardOwner(config: LocalPlayersConfig): number | undefined {
  const active = config.slots.slice(0, config.count);
  const explicit = active.findIndex(s => s.device === 'keyboard');
  if (explicit >= 0) return explicit;
  return active[0]?.device === 'auto' ? 0 : undefined;
}

/** A pane as fractions of the flight view. */
export interface PaneRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** Player panes: two side by side (landscape) or stacked (portrait); three with player 1
 * across the top; four in quarters. */
export function paneRects(count: number, layout: TwoPlayerLayout, width: number, height: number): PaneRect[] {
  if (count <= 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (count === 2) {
    const side = layout === 'side' || (layout === 'auto' && width >= height);
    return side ? [{ x: 0, y: 0, w: .5, h: 1 }, { x: .5, y: 0, w: .5, h: 1 }]
      : [{ x: 0, y: 0, w: 1, h: .5 }, { x: 0, y: .5, w: 1, h: .5 }];
  }
  if (count === 3) return [{ x: 0, y: 0, w: 1, h: .5 }, { x: 0, y: .5, w: .5, h: .5 }, { x: .5, y: .5, w: .5, h: .5 }];
  return [{ x: 0, y: 0, w: .5, h: .5 }, { x: .5, y: 0, w: .5, h: .5 }, { x: 0, y: .5, w: .5, h: .5 }, { x: .5, y: .5, w: .5, h: .5 }];
}

/** Dynamically computes pane rectangles based on which guest slots are separated vs shared.
 * When a guest is shared with Player 1, its pane collapses to zero width/height at the edge.
 * Separated guests and Player 1 receive packed rectangular tiles filling the viewport. */
export function dynamicPaneRects(
  totalCount: number,
  separatedGuests: ReadonlySet<number>,
  layout: TwoPlayerLayout,
  width: number,
  height: number
): { rects: PaneRect[]; visible: boolean[] } {
  if (totalCount <= 1 || separatedGuests.size === 0) {
    const rects: PaneRect[] = [{ x: 0, y: 0, w: 1, h: 1 }];
    const visible: boolean[] = [true];
    for (let slot = 1; slot < totalCount; slot++) {
      rects.push({ x: 1, y: 0, w: 0, h: 1 });
      visible.push(false);
    }
    return { rects, visible };
  }

  const activeSlots = [0, ...[...separatedGuests].filter(s => s > 0 && s < totalCount).sort((a, b) => a - b)];
  const tiles = paneRects(activeSlots.length, layout, width, height);

  const rects: PaneRect[] = new Array(totalCount);
  const visible: boolean[] = new Array(totalCount).fill(false);

  for (let k = 0; k < activeSlots.length; k++) {
    const slot = activeSlots[k]!;
    rects[slot] = tiles[k]!;
    visible[slot] = true;
  }

  const p1Rect = rects[0]!;
  for (let slot = 1; slot < totalCount; slot++) {
    if (!visible[slot]) {
      rects[slot] = { x: p1Rect.x + p1Rect.w, y: p1Rect.y, w: 0, h: p1Rect.h };
    }
  }

  return { rects, visible };
}

/** Computes the CSS pixel centre for a navball placement within a viewport/pane of (width, height). */
export function computeNavballCenter(
  placement: NavballPlacement,
  width: number,
  height: number,
  scale = 1
): { x: number; y: number } {
  const side = (65 + 3) * scale;
  const below = (65 + 5.5 + 46) * scale;
  switch (placement.anchor) {
    case 'bottom-left':
      return { x: side + 24, y: height - below - 20 };
    case 'top-left':
      return { x: side + 24, y: side + 72 };
    case 'top-right':
      return { x: width - side - 24, y: side + 72 };
    case 'center-bottom':
      return { x: width * 0.5, y: height - below - 20 };
    case 'bottom-right':
      return { x: width - side - 24, y: height - below - 20 };
    case 'custom': {
      const minX = side + 12;
      const maxX = Math.max(minX, width - side - 12);
      const minY = side + 12;
      const maxY = Math.max(minY, height - below - 12);
      return {
        x: Math.max(minX, Math.min(maxX, placement.x * width)),
        y: Math.max(minY, Math.min(maxY, placement.y * height)),
      };
    }
  }
}

export function setSlotNavball(config: LocalPlayersConfig, slot: number, placement: Partial<NavballPlacement>): LocalPlayersConfig {
  const current = config.slots[slot]?.navball ?? defaultNavballPlacement(slot);
  return updateSlot(config, slot, { navball: { ...current, ...placement } });
}

export function setAllNavballsPinned(config: LocalPlayersConfig, pinned: boolean): LocalPlayersConfig {
  return {
    ...config,
    slots: config.slots.map(s => ({
      ...s,
      navball: { ...s.navball, pinned },
    })),
  };
}

/** Public pilot contract over this window's existing seats/device preferences. The host
 * supplies identity; this registry never creates reconnect tokens or network authority. */
export class LocalPilotRegistry implements PilotRegistry {
  constructor(private readonly host: {
    config(): LocalPlayersConfig; count(): number; playerId(pilot: number): string | undefined;
    change(config: LocalPlayersConfig): void; release(pilot?: number): void;
  }) {}
  get count(): number { return this.host.count(); }
  private check(pilot: number): void {
    if (!Number.isInteger(pilot) || pilot < 0 || pilot >= this.count) throw new Error('Pilot is not active in this window');
  }
  playerId(pilot: number): string | undefined { this.check(pilot); return this.host.playerId(pilot); }
  assign(pilot: number, device: string): void {
    this.check(pilot);
    if (!(device === 'keyboard' || device === 'none' || device === 'auto' && pilot === 0 || /^pad:\d{1,2}$/.test(device))) throw new Error('Unsupported pilot input device');
    this.host.release();
    this.host.change(assignDevice(this.host.config(), pilot, device as InputDevice));
  }
  release(pilot?: number): void { if (pilot !== undefined) this.check(pilot); this.host.release(pilot); }
}
