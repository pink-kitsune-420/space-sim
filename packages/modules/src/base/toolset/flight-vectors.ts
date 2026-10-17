/** Toolset instrument: the velocity (prograde) vector at the ship, with its speed. */
import type { ModuleManifest, OverlayPrimitive, RegisteredModule, Vec } from '../../../../game-api/src/index';
import type { FlightDataApi } from './flight-data';

const PROGRADE = '#8ddbc1', LABEL = '#c3d3d6';
/** CSS pixels, whatever the zoom: start gap, arrow length and head size. */
const GAP = 14, PROGRADE_PX = 56, HEAD = 8;

/** A world-space arrow of a fixed screen length, so it turns with the camera. */
function arrow(from: Vec, direction: Vec, pixels: number, scale: number, color: string): OverlayPrimitive[] {
  const at = (px: number): Vec => ({ x: from.x + direction.x * px / scale, y: from.y + direction.y * px / scale });
  const tip = at(pixels), c = Math.cos(.5), s = Math.sin(.5);
  const barb = (sign: number): Vec => ({ x: tip.x + (-direction.x * c - sign * direction.y * s) * HEAD / scale,
    y: tip.y + (-direction.y * c + sign * direction.x * s) * HEAD / scale });
  return [
    { kind: 'line', space: 'world', points: [at(GAP), tip], color, width: 2 },
    { kind: 'line', space: 'world', points: [barb(1), tip, barb(-1)], color, width: 2 },
  ];
}

const manifest: ModuleManifest = {
  format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'builtin.flight-vectors', name: 'Velocity vector',
  version: '0.1.0', kind: 'provider', authority: 'presentation', environments: ['browser', 'offline'],
  dependencies: [{ id: 'builtin.flight-data', version: '^0.1.0' }], provides: [], requires: [], slots: [], before: [], after: [],
  settings: {}, license: 'LicenseRef-Project',
};
export const flightVectors: RegisteredModule = {
  manifest,
  initialize(context) {
    const flight = context.dependency<FlightDataApi>('builtin.flight-data');
    context.contributeLayer({
      name: 'velocity',
      label: 'Velocity vector',
      draw(view) {
        const ship = view.ship, data = flight.read(view);
        if (!ship || !data?.prograde || ship.state.status === 'crashed') return [];
        const scale = view.camera.scale;
        // Zoom threshold fade: when zoomed out to orbital/system view (scale < 0.0003),
        // suppress the fixed-pixel arrow and speed readout so it doesn't span across planets.
        if (scale < 0.0003) return [];
        const speed = data.speed;
        if (speed < 0.2) return [];
        // Speed-responsive clamping at tactical zoom (min 24px, max 56px)
        const arrowPx = Math.min(PROGRADE_PX, Math.max(24, speed * 2.5));
        const label = { x: ship.position.x + data.prograde.x * (arrowPx + 20) / scale, y: ship.position.y + data.prograde.y * (arrowPx + 20) / scale };
        return [...arrow(ship.position, data.prograde, arrowPx, scale, PROGRADE),
          { kind: 'text', space: 'world', at: label, text: `${speed.toFixed(1)} m/s`, color: LABEL, align: 'center' }];
      },
    });
  },
};
