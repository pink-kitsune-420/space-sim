import { PLAYER_CONTROLLERS, type ControlTargetAdapter, type ControlTargetBinding,
  type ModuleInitializationV2, type PlayerController, type PlayerControllerFactory, type ServiceKey } from '@space-sim/game-api';

export interface TurretState {
  yaw: number;
  fire: number;
  released: boolean;
}

export function createTurretAdapter(ownerPlayerId: string, state: TurretState): ControlTargetAdapter {
  return Object.freeze({
    schema: 'spacelab-control-target/1',
    canControl(binding: ControlTargetBinding) {
      return binding.playerId === ownerPlayerId;
    },
    actions() {
      return Object.freeze(['example.turret/yaw', 'example.turret/fire']);
    },
    setAction(_binding: ControlTargetBinding, action: string, value: number) {
      if (action === 'example.turret/yaw') state.yaw = value;
      else if (action === 'example.turret/fire') state.fire = value;
    },
    release() {
      state.yaw = 0;
      state.fire = 0;
      state.released = true;
    },
  });
}

export interface TurretControllerHelper {
  /** After binding sources, sample controllers with one shared captureId per input frame:
   * controller.sample({elapsed: .016, flightAllowed: false, shortcutsAllowed: true, captureId}).
   * Omit the optional hint for callers that need a fresh capture per sample. */
  createTurretSession(ownerPlayerId: string): { state: TurretState; controller: PlayerController; target: ControlTargetBinding };
}

export const TURRET_CONTROLLER: ServiceKey<TurretControllerHelper> = Object.freeze({
  slot: 'example.custom-control-target',
  version: '1.0.0',
});

export function createTurretControllerHelper(factory: PlayerControllerFactory): TurretControllerHelper {
  return Object.freeze({
    createTurretSession(ownerPlayerId: string) {
      const state: TurretState = { yaw: 0, fire: 0, released: false };
      const adapter = createTurretAdapter(ownerPlayerId, state);
      const controller = factory.create(adapter);
      const target: ControlTargetBinding = Object.freeze({
        seatId: 'seat-turret-0',
        playerId: ownerPlayerId,
        entityId: 'turret-entity-0',
      });
      controller.select(target);
      return { state, controller, target };
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(PLAYER_CONTROLLERS);
  context.provide(TURRET_CONTROLLER, createTurretControllerHelper(factory));
}
