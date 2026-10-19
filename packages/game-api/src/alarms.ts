import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
/** Portable reminder preferences; notified survives save/load without saving execution. */
export interface NodeAlarmSettings {
 readonly enabled: boolean; readonly leadSeconds: number; readonly pause: boolean;
 readonly notified?: boolean;
}
export interface OrbitalAlarmEvent {
 readonly id: string; readonly kind: string; readonly label: string;
 /** Simulation seconds: reminder deadline and physical event/impulse centre. */
 readonly deadline: number; readonly time: number; readonly pause: boolean;
 readonly handled?: boolean;
}
export interface OrbitalAlarmNotice extends OrbitalAlarmEvent { readonly missed: boolean }
export interface OrbitalAlarmClock extends Disposable {
 /** Borrowed result buffer, valid until next sync. Each due event fires once, even
  * after a time jump. Session identity or time rewind clears prior in-memory state.
  * Call with the complete current set (max 1024); omitted events are deleted. */
 sync(session: object, now: number, events: readonly OrbitalAlarmEvent[]): readonly OrbitalAlarmNotice[];
 readonly secondsUntilNext: number;
 clear(): void;
}
export interface OrbitalAlarmFactory { create(): OrbitalAlarmClock }
export const ORBITAL_ALARMS: ServiceKey<OrbitalAlarmFactory> = Object.freeze({ slot: 'flight.alarms', version: '1.0.0' });
