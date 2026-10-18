import type { VehicleCatalog } from './vehicles';
import type { ModuleDataCommand, ModuleDataExtension } from './module-data';
import type { Disposable, AuthoritativeLock, ModuleLock } from './modules';
import type { Controls, Vec } from './state';
import type { Ship, WorldEvent } from './world';
import type { SavedPlayer, WorldRead, WorldControl } from './engine';
import type { SimulationContextFactory } from './context';
import type { CommandExtension } from './commands';
import type { ForceExtension } from './motion';
import type { WorldRuleExtension } from './rules';
import type { TextConnection } from './platform';
import type { ServiceKey } from './modules-v2';
import type { UniverseDefinition } from './universe';

export interface SessionPlayer { readonly id: string; readonly name: string; readonly connected: boolean; readonly host?: boolean }
export type ChatLine = { readonly from?: string; readonly name: string; readonly text: string };

/** What the flight loop needs from a game, whether this browser owns the world or follows
 * someone else's. */
export interface SessionRead {
  readonly kind: 'local' | 'client';
  readonly world: WorldRead;
  readonly playerId: string;
  readonly paused: boolean;
  readonly pauseReason: string;
  readonly warp: number;
  readonly requestedWarp: number;
  readonly warpReason: string;
  /** True if this seat controls time warp (only the host can activate warp). */
  readonly canWarp: boolean;
  setWarp(factor: number): void;
  /** Presentation fraction of the next fixed step. */
  readonly alpha: number;
  /** Ship record before the latest fixed step, for interpolation. */
  previous(shipId: string): Ship | undefined;
  /** Fading body-relative display correction; zero for local worlds. */
  displayOffset(shipId: string): Vec;
  /** Advance by wall-clock seconds. Held controls apply to `shipId` only. */
  update(seconds: number, shipId: string | undefined, controls: Controls, beforeStep?: () => Controls): WorldEvent[];
  /** Returns the new ship's id when it exists immediately (local worlds). */
  spawn(presetId: string, godMode: boolean, vehicleId?: string): string | undefined;
  respawn(shipId: string, presetId: string): void;
  /** Place an owned ship (throw, orbit and teleport cheats). Local worlds apply it now or
   * throw a SessionError; remote hosts check it and answer with the next snapshot or a notice. */
  teleport(shipId: string, bodyId: string, position: Vec, velocity: Vec, heading?: number): void;
  remove(shipId: string): void;
  setThrottle(shipId: string, throttle: number): void;
  setGodMode(shipId: string, enabled: boolean): void;
  setGodModeAll(enabled: boolean): void;
  /** A module command for an owned ship. Local worlds apply it now through the host's
   * checks (or throw a SessionError); remote results arrive with the next snapshot. */
  command(shipId: string, commandId: string, args?: Readonly<Record<string, number>>): void;
  players(): readonly SessionPlayer[];
  playerName(id: string): string | undefined;
  /** Say something to everyone in this world (just this pilot when playing alone). */
  chat(text: string): void;
  dataCommand(request: ModuleDataCommand): void;
  /** Every chat line in this world, this pilot's own included. */
  onchat: ((line: ChatLine) => void) | null;
}


export interface SessionHandle extends SessionRead, Disposable {}
export interface LocalSessionOptions {
  readonly name: string; readonly token?: string; readonly hostId?: string; readonly players?: readonly SavedPlayer[];
}
export interface JoinOptions {
  readonly vehicles?: VehicleCatalog;
  readonly dataAdapters?: readonly ModuleDataExtension[];
  readonly createContext?: SimulationContextFactory; readonly name: string; readonly password?: string;
  /** May reserve a saved pilot asynchronously before sending the join request. */
  readonly token?: (worldId: string, hostId?: string) => string | undefined | Promise<string | undefined>;
  readonly saveToken?: (worldId: string, token: string, playerId: string) => void;
  /** Monotonic milliseconds, used only for network scheduling/interpolation. */
  readonly now?: () => number;
  readonly lock?: AuthoritativeLock | ModuleLock; readonly simulationFingerprint?: string;
  readonly rules?: readonly WorldRuleExtension[]; readonly forces?: readonly ForceExtension[]; readonly commands?: readonly CommandExtension[];
  /** Validate only against locally installed/enabled modules. A different server universe
   * may return its independently computed fingerprint; returning true alone retains the
   * local simulationFingerprint requirement. Never return the host's hash without recomputing it. */
  readonly verifyCandidate?: (candidate: {
    lock?: AuthoritativeLock | ModuleLock; fingerprint?: string; universe: UniverseDefinition; systemId: string;
  }) => { ok: boolean; reason?: string; simulationFingerprint?: string } | boolean;
}
export interface LocalSessionControl {
  readonly token: string; readonly hosting: boolean;
  seatGuest(name: string, token: string): string; unseatGuest(id: string): void;
  guestControls(player: string, ship: string, controls: Controls): void;
  spawnGuest(player: string, preset: string, godMode?: boolean): string;
  respawnGuest(player: string, ship: string, preset: string, godMode?: boolean): void;
  setGuestThrottle(player: string, ship: string, value: number): void;
  accept(connection: TextConnection): void;
  setPaused(paused: boolean, reason?: string): void; settle(): void;
  catchUp(seconds: number, ship: string | undefined): WorldEvent[];
  service(): void; snapshot(): string; roster(): readonly SavedPlayer[]; close(reason?: string): void;
}
export interface LocalSessionHandle extends SessionHandle { readonly local: LocalSessionControl }
export interface SessionFactory {
  readonly protocol: string; readonly entitySchema: string;
  local(world: WorldControl, options: LocalSessionOptions): LocalSessionHandle;
  join(peer: TextConnection, options: JoinOptions, signal: AbortSignal): Promise<SessionHandle>;
}
export const CORE_SESSION: ServiceKey<SessionFactory> = Object.freeze({ slot: 'core.session', version: '1.0.0' });
