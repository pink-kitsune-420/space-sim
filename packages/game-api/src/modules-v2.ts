import type { Disposable, ModuleEnvironment, ModuleInitialization, ModuleReference, NumberSetting } from './modules';
import type { ActionDefinitionV2, DiscoveryProvider, GuidePage, InputSource, MaterialDefinition,
  PostEffectDefinition, TransportProvider, WindowDefinition } from './platform';

export type ModuleTier = 'authoritative' | 'presentation' | 'platform' | 'network';
export interface CapabilityRef { readonly name: string; readonly version: string }
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
  readonly slots: readonly string[];
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly beforeIfPresent?: readonly string[];
  readonly afterIfPresent?: readonly string[];
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
export interface CapabilityBinding extends CapabilityRef { readonly provider: ModuleReference }
export interface ModuleLockV2 {
  readonly format: 'space-sim-lock/2';
  readonly profileId: string;
  readonly modules: readonly ModuleReference[];
  readonly order: readonly string[];
  readonly providers: Readonly<Record<string, string>>;
  readonly capabilities: Readonly<Record<string, Readonly<Record<string, CapabilityBinding>>>>;
  readonly settings: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
/** A phantom function makes service types invariant under strictFunctionTypes. */
export interface ServiceKey<T> {
  readonly slot: string;
  readonly version: string;
  readonly serviceType?: (value: T) => T;
}
export interface ModuleAssets {
  text(path: string): string;
  bytes(path: string): Uint8Array;
  url(path: string): { readonly href: string; dispose(): void };
}
export interface ModuleInitializationV2 extends Omit<ModuleInitialization, 'assets' | 'provide'> {
  readonly assets: ModuleAssets;
  provide<T>(key: ServiceKey<T>, service: T): void;
  use<T>(key: ServiceKey<T>): T;
  contributeInput(source: InputSource): void;
  contributeActions(actions: readonly ActionDefinitionV2[]): void;
  contributeTransport(provider: TransportProvider): void;
  contributeDiscovery(provider: DiscoveryProvider): void;
  contributeWindow(window: WindowDefinition): void;
  contributeGuide(page: GuidePage): void;
  contributeMaterial(material: MaterialDefinition): void;
  contributePostEffect(effect: PostEffectDefinition): void;
}
export interface RegisteredModuleV2 {
  readonly manifest: ManifestV2;
  readonly contentDigest?: string;
  readonly supportsMultiplayer?: boolean;
  initialize(context: ModuleInitializationV2): void;
}
export interface ModuleContribution<T> {
  readonly moduleId: string;
  readonly id: string;
  readonly value: T;
}
export interface ModuleHookFault {
  readonly moduleId: string;
  readonly hook: string;
  readonly kind: 'input' | 'transport' | 'discovery';
  readonly message: string;
}
export interface HostServiceAccess {
  readonly key: Pick<ServiceKey<unknown>, 'slot' | 'version'>;
  readonly service: unknown;
  /** Only these tiers receive the façade. Authoritative contracts must be deterministic. */
  readonly tiers: readonly ModuleTier[];
  readonly environments: readonly ModuleEnvironment[];
}
export interface HostService<T = unknown> extends HostServiceAccess {
  readonly key: ServiceKey<T>;
  readonly service: T;
}
export interface ModuleCandidateV2Handle extends Disposable {
  readonly lock: ModuleLockV2;
  readonly available: boolean;
}
