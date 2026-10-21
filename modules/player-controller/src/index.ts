import { PLAYER_CONTROLLERS, type ControlTargetAdapter, type ControlTargetBinding,
  type ActionSink, type InputFrame, type PlayerInputBinding, type ModuleInitializationV2, type PlayerController } from '@space-sim/game-api';

const ACTION = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\/[a-z][a-z0-9-]{0,63}$/;
const NO_SOURCES = Object.freeze([]);
/** Local intent routing; the supplied compatible adapter owns command validation. */
export function createPlayerController(adapter: ControlTargetAdapter, initialInput?: PlayerInputBinding): PlayerController {
  if (adapter.schema !== 'spacelab-control-target/1') throw new Error('Incompatible control-target adapter');
  let target: ControlTargetBinding | undefined, actions: readonly string[] = [], disposed = false;
  let input: PlayerInputBinding | undefined, sampling = false, writes = 0;
  const indices = new Map<string, number>(), values = new Float64Array(256), previous = new Float64Array(256);
  const frame: { -readonly [K in keyof InputFrame]: InputFrame[K] } = { elapsed: 0, pilot: 0, flightAllowed: false, shortcutsAllowed: false };
  const live = (): void => { if (disposed) throw new Error('Player controller is disposed'); };
  const release = (): void => {
    let errors: unknown[] | undefined;
    values.fill(0); previous.fill(0);
    for (const source of input?.sources ?? NO_SOURCES) {
      try { source.release(input!.pilot); } catch (error) { (errors ??= []).push(error); }
    }
    try { if (target) adapter.release(target); } catch (error) { (errors ??= []).push(error); }
    if (errors) throw new AggregateError(errors, 'Player input release failed');
  };
  const bindInput = (next: PlayerInputBinding | undefined): void => {
    live();
    try { release(); } finally { input = undefined; }
    if (!next) return;
    if (!Number.isInteger(next.pilot) || next.pilot < 0 || next.pilot > 3 || !Array.isArray(next.sources)
      || next.sources.length > 16 || new Set(next.sources).size !== next.sources.length
      || next.sources.some(source => !source || typeof source.sample !== 'function' || typeof source.release !== 'function' || typeof source.dispose !== 'function'))
      throw new Error('Input binding needs a local pilot (0–3) and at most 16 distinct sources');
    input = Object.freeze({ pilot: next.pilot, sources: Object.freeze([...next.sources]) });
    // A newly borrowed device must require fresh intent too.
    release();
  };
  const set = (action: string, value: number): void => {
    live(); if (!target) throw new Error('Select a control target before sending intent');
    if (!Number.isFinite(value) || !indices.has(action)) throw new Error(`Invalid or unsupported control action ${action}`);
    if (!adapter.canControl(target)) {
      try { release(); } finally { target = undefined; actions = []; indices.clear(); }
      throw new Error('Session ownership of this control target changed');
    }
    const bounded = Math.max(-1, Math.min(1, value));
    adapter.setAction(target, action, bounded); previous[indices.get(action)!] = bounded;
  };
  const sink: ActionSink = Object.freeze({ set(action: string, value: number) {
    if (!sampling) throw new Error('Controller input sink is outside its sample');
    if (++writes > 256 || !Number.isFinite(value)) throw new Error('Input sample needs at most 256 finite writes');
    const index = indices.get(action);
    if (index !== undefined) values[index] = Math.max(-1, Math.min(1, value));
  } });
  bindInput(initialInput);
  return {
    get target() { return target; },
    select(next) {
      live();
      // Drop old intent before any validation, including a rejected transfer.
      try { release(); } finally { target = undefined; actions = []; indices.clear(); }
      if (!next) return;
      if ([next.seatId, next.playerId, next.entityId].some(id => typeof id !== 'string' || !id.length)
        || next.viewportId !== undefined && (typeof next.viewportId !== 'string' || !next.viewportId.length))
        throw new Error('Control binding needs separate seat, player and entity identities');
      const captured = Object.freeze({ seatId: next.seatId, playerId: next.playerId, entityId: next.entityId,
        ...(next.viewportId === undefined ? {} : { viewportId: next.viewportId }) });
      if (!adapter.canControl(captured)) throw new Error('Session player does not own this control target');
      const declared = adapter.actions(captured);
      if (!Array.isArray(declared) || declared.length > 256 || declared.some(id => typeof id !== 'string' || !ACTION.test(id))
        || new Set(declared).size !== declared.length) throw new Error('Control target must declare bounded namespaced actions');
      actions = Object.freeze([...declared]); actions.forEach((action, index) => indices.set(action, index)); target = captured;
    },
    bindInput,
    sample(next) {
      live();
      if (!input) throw new Error('Bind input sources before sampling');
      if (sampling) throw new Error('Controller input sampling is not reentrant');
      if (!Number.isFinite(next.elapsed) || next.elapsed < 0 || typeof next.flightAllowed !== 'boolean' || typeof next.shortcutsAllowed !== 'boolean')
        throw new Error('Invalid controller input frame');
      if (!target || !next.flightAllowed && !next.shortcutsAllowed) { release(); return; }
      if (!adapter.canControl(target)) {
        try { release(); } finally { target = undefined; actions = []; indices.clear(); }
        throw new Error('Session ownership of this control target changed');
      }
      frame.pilot = input.pilot; frame.elapsed = next.elapsed; frame.captureId = next.captureId;
      frame.flightAllowed = next.flightAllowed; frame.shortcutsAllowed = next.shortcutsAllowed; values.fill(0);
      try {
        for (let i = 0; i < input.sources.length; i++) {
          writes = 0; sampling = true;
          try {
            const result: unknown = input.sources[i]!.sample(frame, sink);
            if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
              void Promise.resolve(result).catch(() => {}); throw new Error('Input sampling must be synchronous');
            }
          } finally { sampling = false; }
        }
        for (let i = 0; i < actions.length; i++) if (values[i] !== 0 || previous[i] !== 0) set(actions[i]!, values[i]!);
        previous.set(values);
      } catch (error) {
        try { release(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Input sampling and release failed'); }
        throw error;
      }
    },
    set,
    release() { live(); release(); },
    dispose() {
      if (disposed) return;
      try { release(); } finally { target = undefined; input = undefined; actions = []; indices.clear(); disposed = true; }
    },
  };
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: "Player controller", summary: "Routes namespaced intent to a compatible entity/session adapter without advancing a world.", asset: 'docs/creators/usage.json' });
  const controllers = new Set<PlayerController>(); let disposed = false;
  context.own({ dispose() {
    disposed = true;
    const errors: unknown[] = [];
    for (const controller of controllers) { try { controller.dispose(); } catch (error) { errors.push(error); } }
    controllers.clear();
    if (errors.length) throw new AggregateError(errors, 'Player controller cleanup failed');
  } });
  context.provide(PLAYER_CONTROLLERS, Object.freeze({ create(adapter: ControlTargetAdapter, input?: PlayerInputBinding) {
    if (disposed) throw new Error('Player controller provider is disposed');
    const controller = createPlayerController(adapter, input), dispose = controller.dispose.bind(controller);
    controller.dispose = () => { try { dispose(); } finally { controllers.delete(controller); } };
    controllers.add(controller); return controller;
  } }));
}
