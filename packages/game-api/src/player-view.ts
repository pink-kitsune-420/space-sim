import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { ControlTargetBinding, LocalViewCamera, PlayerController } from './platform';
import type { HudBinding, ViewHud } from './view-hud';

export type PlayerViewRole = 'input' | 'camera' | 'hud' | 'appearance';
/** One player's adapter instance. Configuration/schema belongs to its provider,
 * allowing future editors without a shared bag of game-specific settings.
 * The view owns this adapter; underlying borrowed services retain their owner. */
export interface PlayerViewAdapter extends Disposable {
  /** Stable underlying resource identity; prevents mutable instances crossing players. */
  readonly resource: object;
  rebind(binding: HudBinding): void;
  release(): void;
}
export type PlayerViewAdapters = Readonly<Partial<Record<PlayerViewRole, PlayerViewAdapter>>>;
export interface PlayerView extends Disposable {
  readonly binding: HudBinding;
  readonly adapters: PlayerViewAdapters;
  /** Release all old intent before rebinding. A failed rebind removes every adapter,
   * leaving a neutral view that can be configured again. Seat/view identity is fixed. */
  bind(binding: HudBinding): void;
  /** Replace only this player's parts. Failed preparation retains the old parts,
   * with their intent released; no game world is created or advanced. */
  configure(adapters: PlayerViewAdapters): void;
  release(): void;
}
export type PlayerAdapterOwnership = 'borrowed' | 'owned';
export interface PlayerViewFactory extends Disposable {
  create(options: { readonly binding: HudBinding; readonly adapters: PlayerViewAdapters }): PlayerView;
  controller(controller: PlayerController, ownership?: PlayerAdapterOwnership,
    target?: (binding: HudBinding) => ControlTargetBinding | undefined): PlayerViewAdapter;
  camera(camera: LocalViewCamera, ownership?: PlayerAdapterOwnership): PlayerViewAdapter;
  hud(hud: ViewHud, ownership?: PlayerAdapterOwnership): PlayerViewAdapter;
}
export const PLAYER_VIEWS: ServiceKey<PlayerViewFactory> = Object.freeze({ slot: 'ui.player-view', version: '1.0.0' });
