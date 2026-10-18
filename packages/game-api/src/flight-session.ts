import type { ModuleDataCommand } from './module-data';
import type { ClockService, CoreCommands, CoreMotion, SaveCodec, WorldControl, WorldFactory, SavedPlayer } from './engine';
import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { SessionFactory, SessionPlayer, ChatLine } from './session';
import type { TextConnection } from './platform';
import type { Controls, Vec } from './state';
import type { Ship, WorldEvent } from './world';

/** Privileged headless ports for the explicit legacy flight protocol; not a general entity codec. */
export interface FlightSessionServices {
  readonly world: WorldFactory;
  readonly save: SaveCodec;
  readonly clock: ClockService;
  readonly motion: CoreMotion;
  readonly commands: CoreCommands;
}
export interface FlightHostSettings {
  readonly name: string; readonly password: string;
  readonly maxPlayers: number; readonly maxShipsPerPlayer: number; readonly maxShips: number;
  readonly allowGodMode: boolean; readonly snapshotEveryTicks: number;
  readonly spawnPreset?: string; readonly releaseAfterMs: number; readonly joinTimeoutMs: number;
}
export interface FlightHostOptions {
  readonly players?: readonly SavedPlayer[]; readonly now?: () => number; readonly log?: (message: string) => void;
}
/** Owns peers and change subscription, borrows the supplied world; scheduler steps once. */
export interface FlightHost extends Disposable {
  readonly world: WorldControl; readonly settings: FlightHostSettings; readonly hostId?: string;
  readonly paused: boolean; readonly pauseReason: string; readonly warp: number; readonly requestedWarp: number; readonly warpReason: string;
  onplayers: (() => void) | null;
  onchat: ((line: ChatLine) => void) | null;
  seatHost(name: string, token: string, savedHostId?: string): string;
  seatLocal(name: string, token: string): string; unseatLocal(id: string): void;
  accept(connection: TextConnection): void;
  connectedCount(): number; remoteCount(): number;
  playerList(): SessionPlayer[]; roster(): SavedPlayer[]; playerName(id: string): string | undefined;
  setPaused(paused: boolean, reason?: string): void; canWarp(playerId?: string): boolean;
  setWarp(factor: number, playerId?: string): { readonly granted: number; readonly reason?: string };
  spawnShip(playerId: string, presetId?: string, godMode?: boolean, vehicleId?: string): Ship;
  respawnShip(playerId: string, shipId: string, presetId?: string, godMode?: boolean): Ship;
  removeShip(playerId: string, shipId: string): void;
  setGodMode(playerId: string, shipId: string, enabled: boolean): void; setGodModeAll(enabled: boolean): void;
  teleportShip(playerId: string, shipId: string, bodyId: string, position: Vec, velocity: Vec, heading?: number): Ship;
  setControls(playerId: string, shipId: string, controls: Controls): void; setThrottle(playerId: string, shipId: string, throttle: number): void;
  command(playerId: string, shipId: string, commandId: string, args?: unknown): void;
  dataCommand(playerId: string, request: ModuleDataCommand): void;
  chat(playerId: string | undefined, text: string): void; kick(playerId: string, message?: string): boolean;
  step(): WorldEvent[]; advance(seconds: number): WorldEvent[]; service(): void;
  close(reason?: string): void;
  /** Existing flight wire snapshot, never a general world-state format. */
  snapshot(): unknown;
}
export interface FlightSessionFactory extends SessionFactory {
  host(world: WorldControl, settings?: Partial<FlightHostSettings>, options?: FlightHostOptions): FlightHost;
}
export const FLIGHT_SESSIONS: ServiceKey<FlightSessionFactory> = Object.freeze({ slot: 'session.flight', version: '1.0.0' });
