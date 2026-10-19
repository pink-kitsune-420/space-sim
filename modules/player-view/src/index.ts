import { PLAYER_VIEWS, type HudBinding, type PlayerView, type PlayerViewAdapter,
  type PlayerViewAdapters, type PlayerViewFactory, type ModuleInitializationV2 } from '@space-sim/game-api';

const ROLES = ['input', 'camera', 'hud', 'appearance'] as const;
const EMPTY: PlayerViewAdapters = Object.freeze({});
function capture(value: HudBinding): HudBinding {
  if (!value.seatId || !value.viewportId || !value.session || typeof value.session !== 'object') throw new Error('Player view needs seat, viewport and session identities');
  return Object.freeze({ ...value });
}
/** Composes existing adapters; never polls devices, renders or steps a world. */
export function createPlayerViews(): PlayerViewFactory {
  const views = new Set<PlayerView>(), claims = new WeakMap<object, { owner: object; adapter: PlayerViewAdapter }>();
  let disposed = false;
  const live = () => { if (disposed) throw new Error('Player view provider is disposed'); };
  return {
    create(options) {
      live(); let binding = capture(options.binding), adapters = EMPTY, closed = false;
      const owner = {};
      const check = () => { live(); if (closed) throw new Error('Player view is disposed'); };
      const release = () => {
        const errors: unknown[] = [];
        for (const role of ROLES) { try { adapters[role]?.release(); } catch (error) { errors.push(error); } }
        if (errors.length) throw new AggregateError(errors, 'Player adapter release failed');
      };
      const close = (part: PlayerViewAdapter, errors: unknown[]) => {
        try { part.dispose(); } catch (error) { errors.push(error); }
        if (claims.get(part.resource)?.owner === owner) claims.delete(part.resource);
      };
      const clear = () => {
        const errors: unknown[] = [];
        try { release(); } catch (error) { errors.push(error); }
        const previous = adapters; adapters = EMPTY;
        for (let i = ROLES.length - 1; i >= 0; i--) { const part = previous[ROLES[i]!]; if (part) close(part, errors); }
        return errors;
      };
      const view: PlayerView = {
        get binding() { return binding; }, get adapters() { return adapters; },
        bind(value) {
          check();
          if (value.seatId !== binding.seatId || value.viewportId !== binding.viewportId) throw new Error('Create a player view for another seat or viewport');
          if (value.session === binding.session && value.context === binding.context && value.playerId === binding.playerId && value.targetId === binding.targetId) return;
          const next = capture(value);
          release();
          try { for (const role of ROLES) adapters[role]?.rebind(next); }
          catch (error) { binding = next; const errors = clear(); throw errors.length ? new AggregateError([error, ...errors], 'Player rebind failed') : error; }
          binding = next;
        },
        configure(value) {
          check();
          if (Object.keys(value).some(key => !ROLES.includes(key as typeof ROLES[number]))) throw new Error('Unknown player adapter role');
          if (ROLES.every(role => adapters[role] === value[role])) return;
          const next = Object.freeze({ ...value }), resources = new Set<object>();
          for (const role of ROLES) {
            const part = next[role]; if (!part) continue;
            if (!part.resource || typeof part.resource !== 'object' || resources.has(part.resource)
              || typeof part.rebind !== 'function' || typeof part.release !== 'function' || typeof part.dispose !== 'function') throw new Error('Player parts need distinct resources and a complete adapter lifecycle');
            resources.add(part.resource);
            if (ROLES.some(previous => previous !== role && adapters[previous]?.resource === part.resource)) throw new Error('Remove a player resource before moving it to another role');
            const claim = claims.get(part.resource);
            if (claim && (claim.owner !== owner || claim.adapter !== part)) throw new Error('Player adapter resource is already in use; remove it before replacement');
          }
          release();
          const added: PlayerViewAdapter[] = [];
          try {
            for (const role of ROLES) {
              const part = next[role]; if (!part || adapters[role] === part) continue;
              claims.set(part.resource, { owner, adapter: part }); added.push(part); part.rebind(binding);
            }
          } catch (error) {
            const errors: unknown[] = [];
            for (let i = added.length - 1; i >= 0; i--) { const part = added[i]!; try { part.release(); } catch (failure) { errors.push(failure); } close(part, errors); }
            throw errors.length ? new AggregateError([error, ...errors], 'Player adapter preparation failed') : error;
          }
          const previous = adapters, errors: unknown[] = []; adapters = next;
          for (let i = ROLES.length - 1; i >= 0; i--) { const role = ROLES[i]!, part = previous[role]; if (part && part !== next[role]) close(part, errors); }
          if (errors.length) throw new AggregateError(errors, 'Player adapter replacement cleanup failed');
        },
        release() { if (!closed) release(); },
        dispose() { if (closed) return; closed = true; const errors = clear(); views.delete(view); if (errors.length) throw new AggregateError(errors, 'Player view cleanup failed'); },
      };
      try { view.configure(options.adapters); views.add(view); return view; }
      catch (error) { view.dispose(); throw error; }
    },
    controller(controller, ownership = 'borrowed', target) {
      live(); return { resource: controller,
        rebind(binding) { controller.select(target ? target(binding) : binding.playerId && binding.targetId
          ? { seatId: binding.seatId, viewportId: binding.viewportId, playerId: binding.playerId, entityId: binding.targetId } : undefined); },
        release: () => controller.release(), dispose() { if (ownership === 'owned') controller.dispose(); },
      };
    },
    camera(camera, ownership = 'borrowed') {
      live(); return { resource: camera,
        rebind(binding) { if (camera.viewportId !== binding.viewportId) throw new Error('Camera belongs to another viewport'); camera.focus(binding.targetId); },
        release() {}, dispose() { if (ownership === 'owned') camera.dispose(); },
      };
    },
    hud(hud, ownership = 'borrowed') {
      live(); return { resource: hud, rebind: binding => hud.bind(binding), release() { hud.cancel?.(); }, dispose() { if (ownership === 'owned') hud.dispose(); } };
    },
    dispose() {
      if (disposed) return; disposed = true; const errors: unknown[] = [];
      for (const view of views) { try { view.dispose(); } catch (error) { errors.push(error); } }
      views.clear(); if (errors.length) throw new AggregateError(errors, 'Player view provider cleanup failed');
    },
  };
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Customizable player views', summary: 'Independent input, camera, HUD and appearance adapters with shared identity and cleanup.', asset: 'docs/creators/usage.json' });
  context.provide(PLAYER_VIEWS, context.own(createPlayerViews()));
}
