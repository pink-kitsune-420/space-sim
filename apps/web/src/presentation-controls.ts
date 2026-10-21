import type { Controls, PlayerController, PlayerControllerFactory, PresentationControlTarget, SessionRead } from '../../../packages/game-api/src/index';

const IDLE: Controls = Object.freeze({ turn: 0, throttle: 0, engine: false });
const ACTIONS = ['spacelab.pilot/turn', 'spacelab.pilot/throttle', 'spacelab.pilot/engine'] as const;
const held = (v: Controls) => v.turn !== 0 || v.throttle !== 0 || v.engine;

/** Adapts the legacy flight sample into the delivered PlayerController lifecycle.
 * A game claim consumes ship input before any physics step. The game keeps its own
 * locomotion, receiving only a validated command bound to this seat's owned ship. */
export function createPresentationControls(factory: PlayerControllerFactory | undefined) {
  let controller: PlayerController | undefined;
  let context: { session: SessionRead; world: SessionRead['world']; playerId: string; shipId: string; target: PresentationControlTarget } | undefined;
  let raw: Controls = IDLE, changed = false, waitForNeutral = false;
  const values = { turn: 0, throttle: 0, engine: 0 };
  const owned = () => !!context && context.session.world === context.world && context.world.record(context.shipId)?.ownerId === context.playerId;
  const send = () => {
    if (owned()) { try { context!.session.command(context!.shipId, context!.target.commandId, { ...values }); } catch { /* Authoritative refusal; input stays consumed. */ } }
  };
  function release(): void {
    values.turn = 0; values.throttle = 0; values.engine = 0;
    if (context) send();
    changed = false;
  }
  function reset(): void { controller?.select(undefined); context = undefined; }
  return {
    route(session: SessionRead, playerId: string, shipId: string | undefined, input: Controls,
      target: PresentationControlTarget | null | undefined, allowed: boolean): Controls {
      raw = allowed ? input : IDLE;
      const same = context && context.session === session && context.world === session.world && context.playerId === playerId
        && context.shipId === shipId && context.target.entityId === target?.entityId && context.target.commandId === target?.commandId;
      if (!same && context) { reset(); waitForNeutral = held(raw); }
      if (waitForNeutral && !held(raw)) waitForNeutral = false;
      if (!target) return target === null || !allowed || waitForNeutral ? IDLE : input;
      if (!shipId || !factory || session.world.record(shipId)?.ownerId !== playerId) return IDLE;
      if (!controller) controller = factory.create({
        schema: 'spacelab-control-target/1',
        canControl: binding => owned() && binding.entityId === context!.target.entityId && binding.playerId === context!.playerId,
        actions: () => ACTIONS,
        setAction(_binding, action, value) {
          if (action === ACTIONS[0]) values.turn = value;
          if (action === ACTIONS[1]) values.throttle = value;
          if (action === ACTIONS[2]) values.engine = value;
          changed = true;
        },
        release,
      }, { pilot: 0, sources: [{
        name: 'View held controls',
        sample(_frame, into) {
          const value = waitForNeutral ? IDLE : raw;
          into.set(ACTIONS[0], value.turn); into.set(ACTIONS[1], value.throttle); into.set(ACTIONS[2], value.engine ? 1 : 0);
        }, release() {}, dispose() {},
      }] });
      if (!same) {
        context = { session, world: session.world, playerId, shipId, target };
        controller.select({ seatId: playerId, playerId, entityId: target.entityId });
        release(); // A restored game may contain old held intent; require current input.
      }
      try {
        controller.sample({ elapsed: 0, flightAllowed: allowed, shortcutsAllowed: false });
        if (changed) { send(); changed = false; }
      } catch { reset(); }
      return IDLE;
    },
    release() { controller?.release(); waitForNeutral = true; },
    dispose() { controller?.dispose(); controller = undefined; context = undefined; },
  };
}
