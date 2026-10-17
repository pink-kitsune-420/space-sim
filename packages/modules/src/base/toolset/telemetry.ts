/** First-party flight aid: a telemetry panel with speed components, energy and orbit timing. */
import type { ModuleManifest, PanelRow, RegisteredModule } from '../../../../game-api/src/index';
import type { FlightDataApi } from './flight-data';

const manifest: ModuleManifest = {
  format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'builtin.telemetry', name: 'Telemetry',
  version: '0.1.0', kind: 'provider', authority: 'presentation', environments: ['browser', 'offline'],
  dependencies: [{ id: 'builtin.flight-data', version: '^0.1.0' }], provides: [], requires: [], slots: [], before: [], after: [],
  settings: {}, license: 'LicenseRef-Project',
};
export const telemetry: RegisteredModule = {
  manifest,
  initialize(context) {
    const flight = context.dependency<FlightDataApi>('builtin.flight-data');
    const { duration, number } = flight.format;
    context.contributePanel({
      name: 'telemetry',
      title: 'Telemetry',
      update(view) {
        const data = flight.read(view);
        if (!data) return [{ label: 'Vessel', value: 'none' }];
        const orbit = data.orbit;
        const rows: PanelRow[] = [
          { label: 'Speed', value: data.speed.toFixed(1), unit: 'm/s' },
          { label: 'Radial speed', value: `${data.radial >= 0 ? '+' : ''}${data.radial.toFixed(1)}`, unit: 'm/s' },
          { label: 'Horizontal speed', value: Math.abs(data.tangential).toFixed(1), unit: 'm/s' },
          { label: 'Flight path angle', value: data.pathAngle.toFixed(1), unit: '°' },
          { label: 'Local gravity', value: data.gravity.toFixed(2), unit: 'm/s²' },
          { label: 'Thrust / weight', value: data.thrustToWeight.toFixed(2) },
          { label: 'Orbital energy', value: number(data.energy), unit: 'J/kg' },
        ];
        if (!orbit) rows.push({ label: 'Orbit', value: view.analyticOrbits ? '—' : 'Unavailable · custom motion' });
        else {
          rows.push({ label: 'Orbit', value: orbit.kind === 'elliptic' ? `e ${orbit.eccentricity.toFixed(3)}` : `escape · e ${orbit.eccentricity.toFixed(3)}` });
          rows.push({ label: 'Period', value: orbit.period === null ? '—' : duration(orbit.period) });
          rows.push({ label: 'Time to periapsis', value: orbit.timeToPeriapsis === null ? '—' : duration(orbit.timeToPeriapsis) });
          rows.push({ label: 'Time to apoapsis', value: orbit.timeToApoapsis === null ? '—' : duration(orbit.timeToApoapsis) });
        }
        const last = view.prediction.last;
        if (view.prediction.status === 'impact' && last) rows.push({ label: 'Time to impact', value: duration(Math.max(0, last.time - view.time)) });
        return rows;
      },
    });
  },
};
