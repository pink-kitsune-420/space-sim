import type { ModuleDataCommand } from './module-data';
import type { ClockService, CoreCommands, CoreMotion, SaveCodec, WorldControl, WorldFactory, SavedPlayer } from './engine';
import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { SessionFactory, SessionPlayer, ChatLine } from './session';
import type { TextConnection } from './platform';
import type { Controls, Vec } from './state';
import type { Ship, WorldEvent } from './world';

/** Privileged headless ports for the explicit flight protocol; not a general entity codec. */
export interface FlightSessionServices {
  /** Core world construction and entity management factory. */
  readonly world: WorldFactory;
  /** Save file encoding and decoding service. */
  readonly save: SaveCodec;
  /** High-resolution simulation clock service. */
  readonly clock: ClockService;
  /** Numerical integration and motion update engine. */
  readonly motion: CoreMotion;
  /** Flight command registry and executor. */
  readonly commands: CoreCommands;
}
/** Settings configuring a FlightHost server instance. */
export interface FlightHostSettings {
  /** Server display name. */
  readonly name: string;
  /** Server access password (empty string if open). */
  readonly password: string;
  /** Maximum concurrent players allowed. */
  readonly maxPlayers: number;
  /** Maximum active ships one player can pilot concurrently. */
  readonly maxShipsPerPlayer: number;
  /** Maximum total ships permitted in the simulation world. */
  readonly maxShips: number;
  /** Whether god mode (invulnerability, unlimited fuel) is allowed on this server. */
  readonly allowGodMode: boolean;
  /** Interval in simulation ticks between state snapshots sent to clients. */
  readonly snapshotEveryTicks: number;
  /** Initial spawn preset identifier (e.g. 'earth-orbit'). */
  readonly spawnPreset?: string;
  /** Grace period in milliseconds before releasing a disconnected player's ships. */
  readonly releaseAfterMs: number;
  /** Maximum duration in milliseconds allowed for a client join handshake. */
  readonly joinTimeoutMs: number;
}
/** Optional parameters passed when constructing a FlightHost. */
export interface FlightHostOptions {
  /** Roster of players to restore into the session from a saved world. */
  readonly players?: readonly SavedPlayer[];
  /** Optional monotonic clock source for server timekeeping. */
  readonly now?: () => number;
  /** Optional diagnostic logging callback. */
  readonly log?: (message: string) => void;
}
/**
 * Authoritative flight session host owning peer connections and world stepping.
 * Borrows the supplied WorldControl; steps the simulation and broadcasts events.
 */
export interface FlightHost extends Disposable {
  /** Borrowed simulation world control interface. */
  readonly world: WorldControl;
  /** Active host settings. */
  readonly settings: FlightHostSettings;
  /** Host player identifier, if seated. */
  readonly hostId?: string;
  /** Whether the simulation is currently paused. */
  readonly paused: boolean;
  /** Diagnostic reason why the simulation is paused. */
  readonly pauseReason: string;
  /** Active simulation time warp acceleration factor (1x, 2x, etc.). */
  readonly warp: number;
  /** Time warp factor requested by the host or client. */
  readonly requestedWarp: number;
  /** Reason why the requested warp factor was clamped or granted. */
  readonly warpReason: string;
  /** Listener notified whenever players connect, disconnect, or change seats. */
  onplayers: (() => void) | null;
  /** Listener notified when chat messages are posted. */
  onchat: ((line: ChatLine) => void) | null;
  /** Seat the local host player, returning the assigned player ID. */
  seatHost(name: string, token: string, savedHostId?: string): string;
  /** Seat a local player, returning their player ID. */
  seatLocal(name: string, token: string): string;
  /** Unseat a local player by ID. */
  unseatLocal(id: string): void;
  /** Accept an established TextConnection from a remote client. */
  accept(connection: TextConnection): void;
  /** Number of currently connected peer connections. */
  connectedCount(): number;
  /** Number of remote players currently seated. */
  remoteCount(): number;
  /** List active connected session players with names, IDs and ship lists. */
  playerList(): SessionPlayer[];
  /** Snapshot the complete player roster including saved session tokens. */
  roster(): SavedPlayer[];
  /** Retrieve player display name by ID. */
  playerName(id: string): string | undefined;
  /** Set or clear the simulation pause state. */
  setPaused(paused: boolean, reason?: string): void;
  /** Check whether a given player has permission to change time warp. */
  canWarp(playerId?: string): boolean;
  /** Request a change to the simulation warp multiplier. */
  setWarp(factor: number, playerId?: string): { readonly granted: number; readonly reason?: string };
  /** Spawn a new ship in the world for the specified player. */
  spawnShip(playerId: string, presetId?: string, godMode?: boolean, vehicleId?: string): Ship;
  /** Respawn an existing destroyed or lost ship for a player. */
  respawnShip(playerId: string, shipId: string, presetId?: string, godMode?: boolean): Ship;
  /** Remove a ship from the world. */
  removeShip(playerId: string, shipId: string): void;
  /** Set god mode on a specific ship belonging to a player. */
  setGodMode(playerId: string, shipId: string, enabled: boolean): void;
  /** Set god mode on all ships in the world. */
  setGodModeAll(enabled: boolean): void;
  /** Teleport a ship to an orbital body, position, and velocity vector. */
  teleportShip(playerId: string, shipId: string, bodyId: string, position: Vec, velocity: Vec, heading?: number): Ship;
  /** Apply flight control inputs (pitch, yaw, roll, throttle) to a ship. */
  setControls(playerId: string, shipId: string, controls: Controls): void;
  /** Directly set throttle lever position [0, 1] on a ship. */
  setThrottle(playerId: string, shipId: string, throttle: number): void;
  /** Dispatch a named flight command to a ship. */
  command(playerId: string, shipId: string, commandId: string, args?: unknown): void;
  /** Route a custom module data command request. */
  dataCommand(playerId: string, request: ModuleDataCommand): void;
  /** Broadcast a chat message across all connected players. */
  chat(playerId: string | undefined, text: string): void;
  /** Kick a player by ID with an optional reason message. */
  kick(playerId: string, message?: string): boolean;
  /** Advance the world simulation by one discrete tick. */
  step(): WorldEvent[];
  /** Advance the world simulation by a duration in wall seconds. */
  advance(seconds: number): WorldEvent[];
  /** Perform periodic housekeeping (pruning stale connections, heartbeat checks). */
  service(): void;
  /** Close the host session and disconnect all peers with the given reason. */
  close(reason?: string): void;
  /** Generate an authoritative wire snapshot for broadcasting to clients. */
  snapshot(): unknown;
}
/** Factory creating flight session hosts, local sessions and remote client sessions. */
export interface FlightSessionFactory extends SessionFactory {
  /** Create an authoritative FlightHost borrowing an existing WorldControl. */
  host(world: WorldControl, settings?: Partial<FlightHostSettings>, options?: FlightHostOptions): FlightHost;
}
/** ServiceKey for the flight session factory (slot `session.flight`). */
export const FLIGHT_SESSIONS: ServiceKey<FlightSessionFactory> = Object.freeze({ slot: 'session.flight', version: '1.0.0' });
