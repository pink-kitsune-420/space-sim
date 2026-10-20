import {
  ALARM_CATALOGUE,
  ORBITAL_ALARMS,
  type ModuleInitializationV2,
  type OrbitalAlarmCatalogue,
  type OrbitalAlarmClock,
  type OrbitalAlarmEvent,
  type OrbitalAlarmFactory,
  type OrbitalAlarmNotice,
  type OrbitalAlarmStatus,
  type ServiceKey,
} from '@space-sim/game-api';

export interface OrbitalAlarmHelper {
  createClock(): OrbitalAlarmClock;
  syncClock(clock: OrbitalAlarmClock, session: object, now: number, events: readonly OrbitalAlarmEvent[]): readonly OrbitalAlarmNotice[];
  readCatalogue(session: object): readonly OrbitalAlarmStatus[];
}

export const ORBITAL_ALARM_HELPER: ServiceKey<OrbitalAlarmHelper> = Object.freeze({
  slot: 'example.orbital-alarms',
  version: '1.0.0',
});

export function createOrbitalAlarmHelper(
  factory: OrbitalAlarmFactory,
  catalogue: OrbitalAlarmCatalogue,
): OrbitalAlarmHelper {
  return Object.freeze({
    createClock(): OrbitalAlarmClock {
      return factory.create();
    },
    syncClock(clock: OrbitalAlarmClock, session: object, now: number, events: readonly OrbitalAlarmEvent[]): readonly OrbitalAlarmNotice[] {
      return clock.sync(session, now, events);
    },
    readCatalogue(session: object): readonly OrbitalAlarmStatus[] {
      return catalogue.read(session);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(ORBITAL_ALARMS);
  const catalogue = context.use(ALARM_CATALOGUE);
  context.provide(ORBITAL_ALARM_HELPER, createOrbitalAlarmHelper(factory, catalogue));
}
