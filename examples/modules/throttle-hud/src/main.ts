import { FLIGHT_HUD_STATE, THROTTLE_HUD, type HudInstrumentDefinition, type HudSurface,
  type ModuleInitializationV2, type OverlayPrimitive } from '@space-sim/game-api';

const COLOR = '#e8eef7';

/** A read-only replacement for the hud.throttle lever: draws "THR 42%" and a bar as overlay
 * shapes, so it needs no DOM elements. Players keep their keyboard and gamepad throttle actions.
 * Shapes are rebuilt only when the readout changes, keeping the per-frame path allocation-free. */
export function createThrottleReadout(barWidth: number): HudInstrumentDefinition {
  return Object.freeze<HudInstrumentDefinition>({
    id: 'example.throttle-readout',
    // A HUD without the flight adapter skips this instrument instead of failing.
    requires: Object.freeze([FLIGHT_HUD_STATE]),
    create(context) {
      const adapter = context.use(FLIGHT_HUD_STATE);
      let surface: HudSurface | undefined, shapes: readonly OverlayPrimitive[] = [], key = '', disposed = false;
      return {
        cancel() { /* No gestures to stop. */ },
        // A new target or session: draw nothing until the next update reads it.
        rebind() { shapes = []; key = ''; },
        resize(value) { surface = value; key = ''; },
        update() {
          const state = disposed || !surface ? undefined : adapter.throttle();
          if (!state || !surface) { shapes = []; key = ''; return; }
          const percent = Math.round(state.throttle * 100), mode = state.locked ? ' LOCK' : state.firing ? ' BURN' : '';
          const next = `${percent}${mode}`;
          if (next === key) return;
          key = next;
          const x = surface.x + 16, y = surface.y + surface.height - 32;
          shapes = Object.freeze([
            { kind: 'text', space: 'screen', at: { x, y }, text: `THR ${percent}%${mode}`, color: COLOR },
            { kind: 'line', space: 'screen', points: [{ x, y: y + 8 }, { x: x + barWidth * state.throttle, y: y + 8 }], color: COLOR, width: 3 },
          ] satisfies OverlayPrimitive[]);
        },
        draw(into) { for (const shape of shapes) into.push(shape); },
        dispose() { disposed = true; surface = undefined; shapes = []; },
      };
    },
  });
}

/** Fills hud.throttle when a game profile selects this module as that slot's provider. */
export default function initialize(context: ModuleInitializationV2): void {
  context.provide(THROTTLE_HUD, createThrottleReadout(context.settings.barWidth ?? 80));
}
