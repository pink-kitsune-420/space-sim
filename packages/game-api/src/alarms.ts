import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
/** Portable reminder preferences; notified survives save/load without saving execution. */
export interface NodeAlarmSettings {
 readonly enabled: boolean; readonly leadSeconds: number; readonly pause: boolean;
 /** Optional local presentation request; absent/false leaves selection and camera alone. */
 readonly focusShip?: boolean;
 readonly notified?: boolean;
}
/** Declared orbital reminder event with simulation-second deadline, impulse center time, and pause flag. */
export interface OrbitalAlarmEvent {
 readonly id: string; readonly kind: string; readonly label: string;
 /** Simulation seconds: reminder deadline and physical event/impulse centre. */
 readonly deadline: number; readonly time: number; readonly pause: boolean;
 readonly handled?: boolean;
}
/** Delivered orbital alarm notice indicating arrival or missed status when delivered past event time. */
export interface OrbitalAlarmNotice extends OrbitalAlarmEvent { readonly missed: boolean }
export interface OrbitalAlarmClock extends Disposable {
 /** Borrowed result buffer, valid until next sync. Each due event fires once, even
  * after a time jump. Session identity or time rewind clears prior in-memory state.
  * Call with the complete current set (max 1024); omitted events are deleted. */
 sync(session: object, now: number, events: readonly OrbitalAlarmEvent[]): readonly OrbitalAlarmNotice[];
 readonly secondsUntilNext: number;
 clear(): void;
}
/** Factory creating independent simulation-time orbital alarm clocks (`flight.alarms@1.0.0`). */
export interface OrbitalAlarmFactory { create(): OrbitalAlarmClock }
/** Service key for the orbital alarm clock factory (`flight.alarms@1.0.0`). */
export const ORBITAL_ALARMS: ServiceKey<OrbitalAlarmFactory> = Object.freeze({ slot: 'flight.alarms', version: '1.0.0' });

/** Read-only inspection; never an arming, delivery or host-control interface. */
export interface OrbitalAlarmStatus extends OrbitalAlarmEvent { readonly now: number; readonly handled: boolean }
export interface OrbitalAlarmCatalogue {
 /** Detached snapshot of current events for one opaque session identity, max1024.
  * Clocks own their schedule; removing a clock removes its catalogue entries. */
 read(session: object): readonly OrbitalAlarmStatus[];
}
/** Service key for the read-only orbital alarm catalogue (`flight.alarm-catalogue@1.0.0`). */
export const ALARM_CATALOGUE: ServiceKey<OrbitalAlarmCatalogue> = Object.freeze({slot:'flight.alarm-catalogue',version:'1.0.0'});
/** Options for creating an Alarms dock instrument panel window over an active session. */
export interface AlarmPanelOptions {
 readonly id?: string; readonly container: HTMLElement;
 /** Optional explicit host chrome; otherwise use the selected ui.windows provider. */
 readonly windows?: Pick<import('./windows').WindowSystem,'create'>;
 readonly shell?: Pick<import('./window-shell').WindowShell,'addInstrument'>;
 session(): object;
}
/** Removable dock/window presentation panel displaying pending and delivered orbital alarms. */
export interface AlarmPanel extends Disposable { update(): void }
/** Factory creating alarm dock instrument panels (`view.alarms@1.0.0`). */
export interface AlarmPanelFactory { create(options: AlarmPanelOptions): AlarmPanel }
/** Service key for the alarm dock instrument panel factory (`view.alarms@1.0.0`). */
export const ALARM_PANELS: ServiceKey<AlarmPanelFactory> = Object.freeze({slot:'view.alarms',version:'1.0.0'});
