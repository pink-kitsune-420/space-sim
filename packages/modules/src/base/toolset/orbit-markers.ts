/** First-party flight aid: periapsis and apoapsis on the orbit, with altitude and time to go. */
import type { ModuleManifest, OverlayPrimitive, RegisteredModule, Vec } from '../../../../game-api/src/index';
import type { FlightDataApi } from './flight-data';

const PERIAPSIS = '#f7c775', APOAPSIS = '#c3a6f0';
/** Eccentricity below which the apsides are too ill-defined to be worth marking. */
const NEARLY_CIRCULAR = 1e-3;

const manifest: ModuleManifest = {
  format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'builtin.orbit-markers', name: 'Orbit markers',
  version: '0.1.0', kind: 'provider', authority: 'presentation', environments: ['browser', 'offline'],
  dependencies: [{ id: 'builtin.flight-data', version: '^0.1.0' }], provides: [], requires: [], slots: [], before: [], after: [],
  settings: {}, license: 'LicenseRef-Project',
};
export const orbitMarkers: RegisteredModule = {
  manifest,
  initialize(context) {
    const flight = context.dependency<FlightDataApi>('builtin.flight-data');
    context.contributeLayer({
      name: 'apsides',
      label: 'Periapsis and apoapsis',
      draw(view) {
        const orbit = flight.read(view)?.orbit;
        if (view.ship?.state.status !== 'flying' || !orbit || orbit.eccentricity < NEARLY_CIRCULAR) return [];
        const scale = view.camera.scale, out: OverlayPrimitive[] = [];
        const mark = (point: Vec | undefined, radius: number | null, time: number | null, name: string, color: string): void => {
          // Below the reference surface the pass never happens; the trajectory card reports the impact.
          if (!point || radius === null || radius <= view.body.radius) return;
          // Suppress past / unreachable apsides: on hyperbolic trajectories or when time is negative
          if (time !== null && time < 0) return;
          // Osculating apsides can lie on a later orbit that the ship never reaches.
          // The traced path includes the exact contact time, also for other-body impacts.
          if (view.prediction.status === 'impact' && view.prediction.last
            && (time === null || view.time + time >= view.prediction.last.time)) return;
          if (orbit.kind === 'hyperbolic' && (time === null || time < 0)) return;
          out.push({ kind: 'circle', space: 'world', center: point, radius: 4 / scale, color, width: 2 });
          const timing = time === null ? '' : ` · ${flight.format.duration(time)}`;
          out.push({ kind: 'text', space: 'world', at: { x: point.x, y: point.y + 10 / scale }, color, align: 'center',
            text: `${name} ${flight.format.distance(radius - view.body.radius)}${timing}` });
        };
        mark(orbit.periapsisPoint, orbit.periapsis, orbit.timeToPeriapsis, 'Pe', PERIAPSIS);
        mark(orbit.apoapsisPoint, orbit.apoapsis, orbit.timeToApoapsis, 'Ap', APOAPSIS);
        return out;
      },
    });
  },
};
