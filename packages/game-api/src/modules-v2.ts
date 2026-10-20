import type { ModuleDataAdapter } from './module-data';
import type { VehicleDefinition, VehicleAppearance } from './vehicles';
import type { Disposable, ModuleEnvironment, ModuleInitialization, ModuleReference, NumberSetting } from './modules';
import type { ActionDefinitionV2, DiscoveryProvider, GuidePage, InputSource, MaterialDefinition,
  PostEffectDefinition, TransportProvider, WindowDefinition } from './platform';

/** Where a module runs and what it may touch. `authoritative` code is deterministic simulation
 * shared by saves and multiplayer; `presentation` code draws or plays per viewer; `platform`
 * code owns devices, windows and files; `network` code owns transports and sessions.
 * Authoritative modules may require only authoritative providers; presentation modules may
 * require presentation or authoritative providers; platform and network modules may require any. */
export type ModuleTier = 'authoritative' | 'presentation' | 'platform' | 'network';
/** A provided service: its slot name and exact semver version, such as `hud.throttle` `1.0.0`. */
export interface CapabilityRef { readonly name: string; readonly version: string }
/** A required service. `version` is a semver range such as `^1.0.0`. An optional need may
 * resolve without a provider; read it with `tryUse`. A required need fails resolution instead. */
export interface CapabilityNeed extends CapabilityRef { readonly optional?: boolean }
/** New metadata has a separate parser and lock. Legacy manifests/locks keep their identity. */
export interface ManifestV2 {
  readonly format: 'space-sim-module/2';
  readonly apiVersion: 'space-sim-game-api/2';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly kind: 'provider' | 'data';
  readonly tier: ModuleTier;
  readonly environments: readonly ModuleEnvironment[];
  readonly dependencies: readonly ModuleReference[];
  readonly conflicts: readonly ModuleReference[];
  readonly provides: readonly CapabilityRef[];
  readonly requires: readonly CapabilityNeed[];
  /** Service slots this module can fill. A profile selects one provider per slot. */
  readonly slots: readonly string[];
  /** Module IDs this module must initialize before or after; both must be enabled. */
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly beforeIfPresent?: readonly string[];
  readonly afterIfPresent?: readonly string[];
  /** Numeric settings shown in module configuration; values reach `context.settings`. */
  readonly settings: Readonly<Record<string, NumberSetting>>;
  readonly license: string;
}
/** Dependencies use semver ranges despite sharing the reference record shape. */
export interface ModuleProfileV2 {
  readonly format: 'space-sim-profile/2';
  readonly id: string;
  readonly modules: readonly ModuleReference[];
  readonly providers: Readonly<Record<string, string>>;
  /** Requester ID -> capability name -> explicitly chosen provider ID. */
  readonly capabilities: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly settings: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
/** Resolved capability binding pairing a required service slot and exact version with the selected provider module reference. */
export interface CapabilityBinding extends CapabilityRef { readonly provider: ModuleReference }
/** Resolved v2 module lock (`space-sim-lock/2`) recording enabled modules, topological initialization order, slot providers, capability bindings, and numeric settings. */
export interface ModuleLockV2 {
  readonly format: 'space-sim-lock/2';
  readonly profileId: string;
  readonly modules: readonly ModuleReference[];
  readonly order: readonly string[];
  readonly providers: Readonly<Record<string, string>>;
  readonly capabilities: Readonly<Record<string, Readonly<Record<string, CapabilityBinding>>>>;
  readonly settings: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
/** Typed handle for one service slot and exact version, exported by game-api as a constant
 * (for example `THROTTLE_HUD`). Pass it to `provide`, `use` or `tryUse`; never construct a
 * look-alike key for a service you have not declared in the manifest.
 * A phantom function makes service types invariant under strictFunctionTypes. */
export interface ServiceKey<T> {
  readonly slot: string;
  readonly version: string;
  readonly serviceType?: (value: T) => T;
}
/** Read-only package asset accessor for embedded UTF-8 text, raw bytes, or revocable blob URLs. */
export interface ModuleAssets {
  text(path: string): string;
  bytes(path: string): Uint8Array;
  url(path: string): { readonly href: string; dispose(): void };
}
/** Synchronous v2 module initialization context (`space-sim-game-api/2`) providing typed service lookup (`use`/`tryUse`), publication (`provide`), resource ownership (`own`), and host contributions. */
export interface ModuleInitializationV2 extends Omit<ModuleInitialization, 'assets' | 'provide'> {
  /** Present on current hosts; older v2 hosts may omit this additive diagnostic identity. */
  readonly module?: ModuleReference;
  readonly assets: ModuleAssets;
  /** Initialization only. Publishes this module's implementation of a declared `provides`
   * entry; throws unless the resolved profile selected this module for the slot. */
  provide<T>(key: ServiceKey<T>, service: T): void;
  /** Initialization only. Returns the bound provider for a declared `requires` entry, which
   * initialized first. Throws for an undeclared, unbound or version-incompatible key.
   * Keep the returned service; it remains valid until this candidate is disposed. */
  use<T>(key: ServiceKey<T>): T;
  /** Initialization only. Absence is allowed only for a declared optional capability
   * with no binding; invalid access and a bound provider's failures still throw. */
  tryUse<T>(key: ServiceKey<T>): T | undefined;
  contributeInput(source: InputSource): void;
  /** Contributes namespaced action definitions to the active candidate (platform tier only). */
  contributeActions(actions: readonly ActionDefinitionV2[]): void;
  contributeTransport(provider: TransportProvider): void;
  contributeDiscovery(provider: DiscoveryProvider): void;
  /** Authoritative records shared by saves and compatible session replication. */
  contributeData(adapter: ModuleDataAdapter): void;
  contributeVehicle(vehicle: VehicleDefinition): void;
  contributeVehicleAppearance(appearance: VehicleAppearance): void;
  contributeWindow(window: WindowDefinition): void;
  /** Bounded structured Manual data, available in every tier without a UI dependency. */
  contributeGuide(page: GuidePage): void;
  contributeMaterial(material: MaterialDefinition): void;
  contributePostEffect(effect: PostEffectDefinition): void;
}
/** Default export of a v2 module entry: `export default function initialize(context)`.
 * Initialization is synchronous and runs once per candidate in resolved dependency order. */
export interface RegisteredModuleV2 {
  readonly manifest: ManifestV2;
  readonly contentDigest?: string;
  readonly supportsMultiplayer?: boolean;
  initialize(context: ModuleInitializationV2): void;
}
/** Namespaced contribution record (`<moduleId>/<localName>`) registered by a v2 module during candidate initialization. */
export interface ModuleContribution<T> {
  readonly moduleId: string;
  readonly id: string;
  readonly value: T;
}
/** Diagnostic fault record when a contributed input, transport, or discovery hook throws or violates its contract. */
export interface ModuleHookFault {
  readonly moduleId: string;
  readonly hook: string;
  readonly kind: 'input' | 'transport' | 'discovery';
  readonly message: string;
}
/** Untyped host-supplied service descriptor restricting access to specified `tiers` and `environments`. */
export interface HostServiceAccess {
  readonly key: Pick<ServiceKey<unknown>, 'slot' | 'version'>;
  readonly service: unknown;
  /** Only these tiers receive the façade. Authoritative contracts must be deterministic. */
  readonly tiers: readonly ModuleTier[];
  readonly environments: readonly ModuleEnvironment[];
}
/** Strongly typed host-supplied service descriptor binding a `ServiceKey<T>` to its implementation and tier/environment rules. */
export interface HostService<T = unknown> extends HostServiceAccess {
  readonly key: ServiceKey<T>;
  readonly service: T;
}
/** Disposable lifecycle handle for a prepared v2 module candidate and its resolved `ModuleLockV2`. */
export interface ModuleCandidateV2Handle extends Disposable {
  readonly lock: ModuleLockV2;
  readonly available: boolean;
}
