import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { State, Vec } from './state';
import type { Elements } from './orbit';
import type { OverlayPrimitive, PresentationView } from './presentation';
import type { ThemePreferences } from './theme';
import type { WindowSystem } from './windows';
import type { WindowShell } from './window-shell';

/**
 * Read-only scalar telemetry map observed by tutorial runners (e.g. `flying`, `landed`, `coasting`, `safe`, `bound`, `bodyId`,
 * `clearance` in metres, `radius` in metres, `radiusRatio`, `speed` in m/s, `periapsis` and `apoapsis` in metres,
 * `periapsisRatio` and `apoapsisRatio`, `eccentricity`, `energy` in J/kg, `angularMomentum` in m²/s, `period` in seconds,
 * `nodeCount`, `nodeDv` in m/s, and `alarmCount`). Never writes simulation state.
 */
export type TutorialValues = Readonly<Record<string, number | string | boolean>>;
/**
 * Detached read-only observation snapshot passed to a tutorial runner at start and on each update.
 * Tutorials are read-only observers: they read scalar telemetry and never mutate simulation state.
 */
export interface TutorialObservation {
  /** Session, target and revision/teleport continuity. Changing it invalidates an attempt. */
  readonly identity: object;
  /** Monotonic simulation time in seconds. Rewinds (`time < lastTime`) or non-finite values interrupt the active attempt. */
  readonly time: number;
  /** Whether the simulation is currently paused; paused frames do not advance timed holds. */
  readonly paused: boolean;
  /** Read-only scalar telemetry fields evaluated against step conditions. */
  readonly values: TutorialValues;
}
/**
 * Single scalar predicate evaluated by a `TutorialRunner` against `TutorialObservation.values` and the lesson-start baseline.
 * Non-finite numbers or missing fields evaluate to `false`; `'ratio-gte'` and `'ratio-lte'` require a finite positive baseline.
 */
export interface TutorialCondition {
  /** Name of the scalar key in `TutorialValues` to inspect. */
  readonly field: string;
  /** Comparison operator: value threshold (`'gte'`, `'lte'`, `'eq'`), change from baseline (`'changed'`), or ratio to baseline (`'ratio-gte'`, `'ratio-lte'`). */
  readonly operator: 'gte' | 'lte' | 'eq' | 'changed' | 'ratio-gte' | 'ratio-lte';
  /** Target threshold or exact match value (omitted for `'changed'`). */
  readonly value?: number | string | boolean;
}
/**
 * One sequential objective within a `TutorialLesson`: either simulation-checked `conditions` (up to 32) or a multiple-choice `question`, never both.
 */
export interface TutorialStep {
  /** Short step heading shown in the objective banner and HUD button. */
  readonly title: string;
  /** Actionable player instruction explaining what to fly, observe or answer. */
  readonly instruction: string;
  /** Optional guidance revealed when the learner opens the hint disclosure. */
  readonly hint: string;
  /** Read-only scalar predicates (1 to 32) that must all hold simultaneously. Mutually exclusive with `question`. */
  readonly conditions?: readonly TutorialCondition[];
  /** UI/planning objectives may complete while paused; they cannot have a timed hold. */
  readonly allowPaused?: boolean;
  /** Consecutive simulation seconds; paused frames never accrue credit. */
  readonly holdSeconds?: number;
  /** Multiple-choice knowledge check (mutually exclusive with `conditions`); `correct` is the 0-based index in `choices`. */
  readonly question?: { readonly choices: readonly string[]; readonly correct: number; readonly explanation: string };
}
/**
 * Read-only definition of a multi-step tutorial lesson (1 to 64 steps).
 * Versioned so changes to completion criteria invalidate stale completion records (`<id>@<version>`).
 */
export interface TutorialLesson {
  /** Stable lesson identifier within a course. */
  readonly id: string;
  /** Positive integer version encoded in persisted completion keys (`<id>@<version>`). */
  readonly version: number;
  /** Human-readable lesson title. */
  readonly title: string;
  /** Difficulty tier used to group lessons in the selector. */
  readonly level: 'First flights' | 'Orbital skills' | 'Advanced';
  /** Introductory summary shown above the objective. */
  readonly introduction: string;
  /** Expandable physics and orbital mechanics notes ("Go deeper"). */
  readonly deeper: string;
  /** Ordered sequence of 1 to 64 checked objectives or knowledge questions. */
  readonly steps: readonly TutorialStep[];
}
/**
 * Stateful read-only state machine evaluating a `TutorialLesson` against `TutorialObservation` snapshots
 * and persisting versioned completion keys (`<lesson.id>@<lesson.version>`, up to 256 entries).
 * Never mutates simulation state, DOM nodes or timers. Caller owns and disposes the runner.
 */
export interface TutorialRunner extends Disposable {
  /** Currently active lesson, or `undefined` when idle or stopped. */
  readonly lesson: TutorialLesson | undefined;
  /** Zero-based index of the current step in `lesson.steps`. */
  readonly step: number;
  /** `true` once all steps of `lesson` have been completed. */
  readonly finished: boolean;
  /** `true` if `observation.identity` changed or `observation.time` rewound or became non-finite during an active lesson. */
  readonly interrupted: boolean;
  /** Latest learner-facing status or explanation message. */
  readonly feedback: string;
  /** Read-only set of completed `<lesson.id>@<lesson.version>` keys loaded from storage and updated on lesson completion. */
  readonly completed: ReadonlySet<string>;
  /**
   * Validates `lesson` (1–64 steps, each with either 1–32 conditions or a valid question, non-negative finite `holdSeconds`,
   * and no `holdSeconds > 0` when `allowPaused` is set) and starts tracking from `observation` as the baseline.
   * Throws if disposed or if the lesson or observation time is invalid.
   */
  start(lesson: TutorialLesson, observation: TutorialObservation): void;
  /**
   * Evaluates the current step's conditions against `observation`. Interrupts the attempt if `identity` changed or simulation
   * `time` decreased. Advances the step once conditions hold for `holdSeconds` consecutive unpaused simulation seconds.
   */
  update(observation: TutorialObservation): void;
  /**
   * Submits a 0-based `choice` index for the current step's knowledge question.
   * Returns `true` and advances the step when `choice === question.correct`; returns `false` otherwise or when inactive.
   */
  answer(choice: number): boolean;
  /** Clears the active lesson, interruption state and hold timer while preserving `completed` progress. */
  stop(): void;
}
/**
 * Stateless factory creating independent `TutorialRunner` state machines (`learning.runner@1.0.0`).
 */
export interface TutorialRunnerFactory {
  /**
   * Creates a runner backed by optional `storage` under `storageKey` (recommended format: `<courseId>/v<courseVersion>/<learnerKey>`).
   * Storage read/write failures fall back silently to in-memory tracking.
   */
  create(options: { readonly storage?: ThemePreferences; readonly storageKey: string }): TutorialRunner;
}
/** Service key for the reusable tutorial runner factory (`learning.runner@1.0.0`). */
export const TUTORIAL_RUNNERS: ServiceKey<TutorialRunnerFactory> = Object.freeze({ slot: 'learning.runner', version: '1.0.0' });

/**
 * Declarative practice ship placement requested only by an explicit learner button action.
 * Ratios are measured from the body's reference radius; no world physics is changed.
 */
export interface AcademyPractice {
  /** Placement archetype: launch pad respawn (`'pad'`), bound orbit (`'circle'`, `'ellipse'`), hyperbolic lunar approach (`'approach'`), or moon transfer (`'encounter'`). */
  readonly kind: 'pad' | 'circle' | 'ellipse' | 'approach' | 'encounter';
  /** Target celestial body identifier (e.g. `'planet'` for Primus or `'moon'` for Parvus). */
  readonly bodyId: string;
  /** Periapsis or low-side radius expressed as a multiple of `body.radius`. */
  readonly low: number;
  /** Apoapsis or high-side radius expressed as a multiple of `body.radius`. */
  readonly high: number;
  /** Optional starting apsis for elliptical placements (`'periapsis'` or `'apoapsis'`). */
  readonly at?: 'periapsis' | 'apoapsis';
}
/**
 * Optional geometric teaching-guide ellipse ratios (`low` and `high` as multiples of `body.radius`).
 * Purely illustrative: never predicts burns, steers the ship or alters simulation state.
 */
export interface AcademyTarget {
  /** Periapsis radius of the suggested guide orbit as a multiple of `body.radius`. */
  readonly low: number;
  /** Apoapsis radius of the suggested guide orbit as a multiple of `body.radius`. */
  readonly high: number;
}
/**
 * An `OrbitalCourse` lesson pairing a `TutorialLesson` with an explicit `AcademyPractice` setup and optional `AcademyTarget` guide ellipse.
 */
export interface OrbitalLesson extends TutorialLesson {
  /** Practice setup loaded only when the learner explicitly clicks "Load practice setup" or "Restart practice". */
  readonly practice: AcademyPractice;
  /** Optional suggested target orbit ratios (`low` and `high` in multiples of `body.radius`) drawn as a cyan teaching guide. */
  readonly target?: AcademyTarget;
}
/**
 * Immutable orbital mechanics curriculum (`learning.orbital-course@1.0.0`) consumed by `learning.academy`.
 */
export interface OrbitalCourse {
  /** Stable course identifier used in progress storage keys. */
  readonly id: string;
  /** Positive integer course version used to namespace learner progress (`<id>/v<version>/<learnerKey>`). */
  readonly version: number;
  /** Display title for the Academy window. */
  readonly title: string;
  /** Ordered catalogue of beginner, orbital-skills and advanced lessons. */
  readonly lessons: readonly OrbitalLesson[];
}
/** Service key for the orbital mechanics course data (`learning.orbital-course@1.0.0`). */
export const ORBITAL_COURSE: ServiceKey<OrbitalCourse> = Object.freeze({ slot: 'learning.orbital-course', version: '1.0.0' });

/**
 * Detached committed flight state, SI and body-relative inertial coordinates.
 * No mutable session/world reference crosses the learning boundary.
 * Tutorials read this snapshot to derive `TutorialObservation` values and never write back to the world.
 */
export interface AcademyFlight {
  /** Opaque continuity token for the controlled session, ship and teleport/respawn epoch. */
  readonly identity: object;
  /** Committed simulation time in seconds. */
  readonly time: number;
  /** Whether the flight session is currently paused. */
  readonly paused: boolean;
  /** Detached ship state in body-relative SI coordinates (metres, m/s, radians). */
  readonly state: State;
  /** Whether the ship's main engine is currently firing. */
  readonly engine: boolean;
  /** Active gravitating body parameters in SI units (`radius`, `surfaceTop` and `soi` in metres; `mu` in m³/s²). */
  readonly body: { readonly id: string; readonly name: string; readonly radius: number; readonly mu: number;
    readonly surfaceTop: number; readonly soi: number };
  /** Analytic two-body Keplerian elements when `analytic` is `true` and the ship is flying, or `null`. */
  readonly orbit: Elements | null;
  /** Height above terrain or sea level in metres, or `null` when unavailable. */
  readonly clearance: number | null;
  /** Whether the active motion model provides analytic two-body orbital elements. */
  readonly analytic: boolean;
  /** Current trajectory prediction end classification (e.g. `'closed'`, `'impact'`, `'escape'`). */
  readonly prediction: string;
  /** Count of valid planned maneuver nodes for the selected ship. */
  readonly plannedNodes: number;
  /** Total planned delta-v magnitude in m/s across valid maneuver nodes. */
  readonly plannedDeltaV: number;
  /** Count of pending (unhandled) orbital alarms. */
  readonly alarms: number;
}
/**
 * Host adapters supplied when mounting an `AcademyPanel`.
 * Keeps the Academy UI decoupled from mutable sessions: `read()` returns detached snapshots and `practice()` runs only on explicit user click.
 */
export interface AcademyPanelOptions {
  /** Borrowed viewport container element into which the HUD reopen button and floating window are mounted. */
  readonly container: HTMLElement;
  /** Window factory used to create the pinned Academy floating window (`id: 'academy'`). */
  readonly windows: Pick<WindowSystem, 'create'>;
  /** Window shell used to register the Academy dock instrument button. */
  readonly shell: Pick<WindowShell, 'addInstrument'>;
  /** Optional local storage backend for lesson completion progress. */
  readonly storage?: ThemePreferences;
  /** Learner/seat identifier appended to the course storage key (`<course.id>/v<course.version>/<learnerKey>`). */
  readonly learnerKey: string;
  /** Returns a detached `AcademyFlight` snapshot for the currently selected owned ship, or `undefined` when no owned ship is selected. */
  read(): AcademyFlight | undefined;
  /** Actual current bindings, resolved by the host; never hard-coded by lessons. */
  bindings(): string;
  /** Explicit button action only. The host checks local authority/ownership again. */
  practice(setup: AcademyPractice): void;
}
/**
 * Mounted Orbital Academy UI panel and world-space target orbit overlay source.
 * Disposing removes the HUD button, disposes the dock instrument, window and tutorial runner.
 */
export interface AcademyPanel extends Disposable {
  /**
   * Advances UI and tutorial runner state by `elapsed` wall-clock seconds (throttled internally to 0.1 s intervals).
   * Reads `options.read()` and never mutates simulation state.
   */
  update(elapsed: number): void;
  /**
   * Returns world-space `OverlayPrimitive` line segments (in metres) for the suggested target orbit when a lesson with a target
   * is active, un-interrupted, checked by the learner and orbiting the viewed body; otherwise returns `[]`. Reuses preallocated line objects.
   */
  draw(view: PresentationView): readonly OverlayPrimitive[];
}
/**
 * Factory creating mounted `AcademyPanel` instances (`learning.academy@1.0.0`).
 * Candidate-owned: disposing the provider disposes all active panels and rejects subsequent `create()` calls.
 */
export interface AcademyPanelFactory {
  /** Mounts the Academy window, dock instrument, HUD objective button and tutorial runner. Throws if the provider is disposed. */
  create(options: AcademyPanelOptions): AcademyPanel;
}
/** Service key for the Orbital Academy flight UI factory (`learning.academy@1.0.0`). */
export const ACADEMY_PANELS: ServiceKey<AcademyPanelFactory> = Object.freeze({ slot: 'learning.academy', version: '1.0.0' });
/**
 * Sampled 97-point geometric conic (`points` in body-relative metres) for a lesson's suggested target orbit around `bodyId`.
 */
export interface AcademyOrbitPreview {
  /** Celestial body identifier in whose frame `points` are expressed. */
  readonly bodyId: string;
  /** Closed 97-vertex polyline in body-relative inertial coordinates (metres). */
  readonly points: readonly Vec[];
}

