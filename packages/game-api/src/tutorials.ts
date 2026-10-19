import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { State, Vec } from './state';
import type { Elements } from './orbit';
import type { OverlayPrimitive, PresentationView } from './presentation';
import type { ThemePreferences } from './theme';
import type { WindowSystem } from './windows';
import type { WindowShell } from './window-shell';

export type TutorialValues = Readonly<Record<string, number | string | boolean>>;
export interface TutorialObservation {
  /** Session, target and revision/teleport continuity. Changing it invalidates an attempt. */
  readonly identity: object;
  readonly time: number;
  readonly paused: boolean;
  readonly values: TutorialValues;
}
export interface TutorialCondition {
  readonly field: string;
  readonly operator: 'gte' | 'lte' | 'eq' | 'changed' | 'ratio-gte' | 'ratio-lte';
  readonly value?: number | string | boolean;
}
export interface TutorialStep {
  readonly title: string; readonly instruction: string; readonly hint: string;
  readonly conditions?: readonly TutorialCondition[];
  /** UI/planning objectives may complete while paused; they cannot have a timed hold. */
  readonly allowPaused?: boolean;
  /** Consecutive simulation seconds; paused frames never accrue credit. */
  readonly holdSeconds?: number;
  readonly question?: { readonly choices: readonly string[]; readonly correct: number; readonly explanation: string };
}
export interface TutorialLesson {
  readonly id: string; readonly version: number; readonly title: string;
  readonly level: 'First flights' | 'Orbital skills' | 'Advanced';
  readonly introduction: string; readonly deeper: string;
  readonly steps: readonly TutorialStep[];
}
export interface TutorialRunner extends Disposable {
  readonly lesson: TutorialLesson | undefined; readonly step: number;
  readonly finished: boolean; readonly interrupted: boolean;
  readonly feedback: string; readonly completed: ReadonlySet<string>;
  start(lesson: TutorialLesson, observation: TutorialObservation): void;
  update(observation: TutorialObservation): void;
  answer(choice: number): boolean;
  stop(): void;
}
export interface TutorialRunnerFactory {
  create(options: { readonly storage?: ThemePreferences; readonly storageKey: string }): TutorialRunner;
}
export const TUTORIAL_RUNNERS: ServiceKey<TutorialRunnerFactory> = Object.freeze({ slot: 'learning.runner', version: '1.0.0' });

/** Ratios are measured from the body's reference radius; no world physics is changed. */
export interface AcademyPractice {
  readonly kind: 'pad' | 'circle' | 'ellipse' | 'approach' | 'encounter';
  readonly bodyId: string; readonly low: number; readonly high: number;
  readonly at?: 'periapsis' | 'apoapsis';
}
export interface AcademyTarget { readonly low: number; readonly high: number }
export interface OrbitalLesson extends TutorialLesson {
  readonly practice: AcademyPractice; readonly target?: AcademyTarget;
}
export interface OrbitalCourse {
  readonly id: string; readonly version: number; readonly title: string;
  readonly lessons: readonly OrbitalLesson[];
}
export const ORBITAL_COURSE: ServiceKey<OrbitalCourse> = Object.freeze({ slot: 'learning.orbital-course', version: '1.0.0' });

/** Detached committed flight state, SI and body-relative inertial coordinates.
 * No mutable session/world reference crosses the learning boundary. */
export interface AcademyFlight {
  readonly identity: object; readonly time: number; readonly paused: boolean;
  readonly state: State; readonly engine: boolean;
  readonly body: { readonly id: string; readonly name: string; readonly radius: number; readonly mu: number;
    readonly surfaceTop: number; readonly soi: number };
  readonly orbit: Elements | null; readonly clearance: number | null;
  readonly analytic: boolean; readonly prediction: string;
  readonly plannedNodes: number; readonly plannedDeltaV: number; readonly alarms: number;
}
export interface AcademyPanelOptions {
  readonly container: HTMLElement; readonly windows: Pick<WindowSystem, 'create'>;
  readonly shell: Pick<WindowShell, 'addInstrument'>;
  readonly storage?: ThemePreferences; readonly learnerKey: string;
  read(): AcademyFlight | undefined;
  /** Actual current bindings, resolved by the host; never hard-coded by lessons. */
  bindings(): string;
  /** Explicit button action only. The host checks local authority/ownership again. */
  practice(setup: AcademyPractice): void;
}
export interface AcademyPanel extends Disposable {
  update(elapsed: number): void;
  draw(view: PresentationView): readonly OverlayPrimitive[];
}
export interface AcademyPanelFactory { create(options: AcademyPanelOptions): AcademyPanel }
export const ACADEMY_PANELS: ServiceKey<AcademyPanelFactory> = Object.freeze({ slot: 'learning.academy', version: '1.0.0' });
export interface AcademyOrbitPreview { readonly bodyId: string; readonly points: readonly Vec[] }
