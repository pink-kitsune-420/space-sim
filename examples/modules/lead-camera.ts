/** A presentation add-on that builds on a first-party module: it depends on
 * `builtin.flight-data` (any 0.1.x) and uses its exposed API for a look-ahead camera mode and
 * a marker layer. Imports only the public API; the API shape it uses is declared locally. */
import type { ModuleManifest, PresentationSnapshot, RegisteredModule, Vec } from '../../packages/game-api/src/index';

/** The part of builtin.flight-data's API this module relies on. */
interface FlightData { read(view: PresentationSnapshot): { readonly prograde?: Vec } | undefined }

const manifest: ModuleManifest = {
  format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'example.lead-camera', name: 'Lead camera (example)',
  version: '0.1.0', kind: 'provider', authority: 'presentation', environments: ['browser', 'offline'],
  dependencies: [{ id: 'builtin.flight-data', version: '^0.1.0' }], provides: [], requires: [], slots: [], before: [], after: [],
  settings: {}, license: 'LicenseRef-Project',
};

export const leadCamera: RegisteredModule = {
  manifest,
  initialize(context) {
    const flight = context.dependency<FlightData>('builtin.flight-data');
    /** A third of the shorter viewport side ahead of the ship, along its velocity. */
    const lead = (view: PresentationSnapshot, scale: number): Vec | undefined => {
      const ship = view.ship, direction = flight.read(view)?.prograde;
      if (!ship || !direction) return ship?.position;
      const distance = Math.min(view.viewport.width, view.viewport.height) / 3 / scale;
      return { x: ship.position.x + direction.x * distance, y: ship.position.y + direction.y * distance };
    };
    context.contributeCamera({
      name: 'lead',
      label: 'Lead camera',
      frame: input => ({ center: lead(input, input.scale) ?? input.body.position }),
    });
    context.contributeLayer({
      name: 'lead-point',
      label: 'Lead point',
      draw(view) {
        const point = view.ship && flight.read(view)?.prograde ? lead(view, view.camera.scale) : undefined;
        if (!point) return [];
        const size = 6 / view.camera.scale;
        return [
          { kind: 'line', space: 'world', points: [{ x: point.x - size, y: point.y }, { x: point.x + size, y: point.y }], color: '#c3d3d680', width: 1 },
          { kind: 'line', space: 'world', points: [{ x: point.x, y: point.y - size }, { x: point.x, y: point.y + size }], color: '#c3d3d680', width: 1 },
        ];
      },
    });
  },
};
