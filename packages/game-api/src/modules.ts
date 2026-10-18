import type { PresetDefinition, UniverseDefinition, VehicleDefaults } from './universe';
import type { WorldRuleHook } from './rules';
import type { ModuleValue, ForceHook } from './motion';
import type { CommandHook } from './commands';
import type { CameraHook, LayerHook, PanelHook } from './presentation';

/** Public module registration and data contracts. */
export type ModuleEnvironment = 'browser' | 'offline' | 'node';
export interface Disposable { dispose(): void }
/** An exact module version, as profiles and locks record it. */
export interface ModuleReference { readonly id: string; readonly version: string }
/** A dependency or conflict: an exact version or a range such as `^1.2.0`, `~1.2.0`,
 * `>=1.2.0 <2.0.0`, `*`, or alternatives joined by `||`. Prereleases match only ranges that
 * name a prerelease of the same version. Resolution records the exact enabled version. */
export interface ModuleDependency { readonly id: string; readonly version: string }
export interface NumberSetting {
  readonly type: 'number';
  readonly label?: string;
  /** Plain-text help for module configuration controls. */
  readonly description?: string;
  /** Optional numeric increment, measured from minimum. Omitted means continuous. */
  readonly step?: number;
  readonly default: number;
  readonly minimum: number;
  readonly maximum: number;
}
export interface ModuleManifest {
  readonly format: 'space-sim-module/1';
  readonly apiVersion: 'space-sim-game-api/1';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly kind: 'provider' | 'data';
  readonly authority: 'authoritative' | 'presentation';
  readonly environments: readonly ModuleEnvironment[];
  /** Enabled before this module, which may use their exposed APIs. */
  readonly dependencies: readonly ModuleDependency[];
  /** Modules that cannot be enabled together with this one. */
  readonly conflicts?: readonly ModuleDependency[];
  readonly provides: readonly string[];
  readonly requires: readonly string[];
  readonly slots: readonly string[];
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly settings: Readonly<Record<string, NumberSetting>>;
  readonly license: string;
}
export interface ModuleProfile {
  readonly format: 'space-sim-profile/1';
  readonly id: string;
  readonly modules: readonly ModuleReference[];
  readonly providers: Readonly<Record<string, string>>;
  readonly settings: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
/** Initialization is synchronous in Phase 2. Own resources immediately after allocation.
 * provide() only accepts slots selected for this module by the resolved profile. */
export interface ModuleInitialization {
  readonly settings: Readonly<Record<string, number>>;
  /** Text assets embedded in an imported code artifact; empty for static modules. */
  readonly assets: Readonly<Record<string, string>>;
  /** Own a sequential state migration in this candidate, without global registration. */
  migrateState(fromVersion: number, migrate: (value: ModuleValue) => ModuleValue): void;
  own<T extends Disposable>(resource: T): T;
  selected(slot: string): boolean;
  provide(slot: string, service: unknown): void;
  /** Authoritative static modules only; uses the resolved module identity and order. */
  contributeForce(hook: ForceHook): void;
  contributeWorldRule(hook: WorldRuleHook): void;
  /** Authoritative modules only: up to 32 named commands, run by the authoritative host. */
  contributeCommand(hook: CommandHook): void;
  /** Presentation modules only: up to eight of each, in resolved module order. */
  contributeLayer(hook: LayerHook): void;
  contributePanel(hook: PanelHook): void;
  contributeCamera(hook: CameraHook): void;
  /** Publish a read-only API (an object of functions and constants) for dependent modules.
   * At most once. Authoritative state still belongs in module state, never in closures. */
  expose(api: object): void;
  /** The API exposed by one of this module's declared dependencies, which initialize first. */
  dependency<T extends object>(id: string): T;
}
export interface RegisteredModule {
  readonly manifest: ModuleManifest;
  /** Canonical imported package identity, independent of the execution environment. */
  readonly contentDigest?: string;
  /** Author declaration; numerical/replay conformance remains the author’s responsibility. */
  readonly supportsMultiplayer?: boolean;
  initialize(context: ModuleInitialization): void;
}
export interface ModuleLock {
  readonly format: 'space-sim-lock/1';
  readonly profileId: string;
  readonly modules: readonly ModuleReference[];
  readonly order: readonly string[];
  readonly providers: Readonly<Record<string, string>>;
  readonly settings: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** Canonical authoritative lock: excludes presentation modules and binds physics/settings/geometry/rules. */
export interface AuthoritativeLock {
  readonly format: 'space-sim-auth-lock/1';
  readonly profileId: string;
  readonly modules: readonly ModuleReference[];
  readonly order: readonly string[];
  readonly providers: Readonly<Record<string, string>>;
  readonly settings: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly contentDigests: Readonly<Record<string, string>>;
  readonly physicalGeometry: Readonly<Record<string, string>>;
  readonly rules: readonly { readonly moduleId: string; readonly version: string; readonly modelIdentity: string; readonly seed: number }[];
  readonly forces: readonly { readonly moduleId: string; readonly version: string; readonly modelIdentity: string }[];
}

export interface DataModule {
  readonly format: 'space-sim-data-module/1';
  readonly manifest: ModuleManifest;
  readonly data: {
    readonly vehicle?: { readonly override: true; readonly settings: Partial<VehicleDefaults> };
    readonly universes?: readonly { readonly definition: UniverseDefinition; readonly target?: string; readonly override?: true }[];
    readonly presets?: readonly { readonly universe: string; readonly system: string; readonly preset: PresetDefinition; readonly override?: true }[];
    readonly appearance?: readonly { readonly universe: string; readonly system: string; readonly body: string;
      readonly override: true; readonly colors: Readonly<Record<string, string>> }[];
  };
}
