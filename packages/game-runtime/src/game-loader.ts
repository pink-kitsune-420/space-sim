/** Host-only (`packages/game-runtime`): preparation, start and activation of installed games. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); a module sees only its `initialize(context)` call and the resources it owns. */
import type { Disposable, HostServiceAccess, ManifestV2, ModuleAssets, ModuleEnvironment, ModuleLockV2,
  ModuleProfileV2, RegisteredModuleV2 } from '../../game-api/src/index';
import { canonicalJson, sha256Hex } from './authoritative';
import { ModuleRegistryV2, type ModuleCandidateV2 } from './modules-v2';
import { packageDigest, type PackageIdentity, type PackageStore } from './package-store';
import type { LoadPolicy } from './loader';
import { validateProfileV2 } from './validation-v2';

/** An intact progress file cannot be activated with this installed configuration.
 * Hosts must retain its bytes rather than treating it as corrupt saved progress. */
export class GameConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'GameConfigurationError'; }
}

/** A verified installed package: identity, manifest and a lazy `register(policy)`. Registering evaluates nothing; code runs only when its candidate initializes it, after the policy and digest checks. Host-only (`packages/game-runtime`). */
export interface InspectedRuntimePackage extends PackageIdentity {
  readonly manifest: ManifestV2;
  /** Creating a lazy registration is inert. Initialization is the only execution gate. */
  register(policy: LoadPolicy): { readonly module: RegisteredModuleV2; readonly assets: ModuleAssets };
}
/** One target's exact v2 plan: the profile, the exact package digests it pins and the slots the game requires. Host-only (`packages/game-runtime`). */
export interface InstalledGamePlan {
  readonly profile: ModuleProfileV2;
  readonly packages: readonly { readonly id: string; readonly version: string; readonly digest: string }[];
  readonly requiredSlots: readonly string[];
}
/** World, view or network resources a host builds for a prepared candidate before activation. Host-only (`packages/game-runtime`). */
export interface CandidateResources extends Disposable {
  /** Allocate/connect without publishing to the current game. Honor cancellation. */
  start(signal: AbortSignal): Promise<void>;
  /** Synchronous publication after startup succeeds; throwing must leave the old game intact. */
  activate?(): void;
}
/** What a browser, desktop or server host injects into `prepareInstalledGame`: host services, shipped modules, package inspection and candidate construction. Host-only (`packages/game-runtime`). */
export interface EngineAdapters {
  /** Optional host diagnostics; excluded from locks, fingerprints and simulation state. */
  readonly logs?:import('../../game-api/src/index').ModuleLogService;
  readonly hostServices: readonly HostServiceAccess[];
  readonly staticModules: readonly RegisteredModuleV2[];
  inspect(bytes: Uint8Array): Promise<InspectedRuntimePackage>;
  construct(modules: ModuleCandidateV2, identity: GameIdentity): CandidateResources;
}
/** Identity of a prepared game: exact v2 lock, packages, manifests and content digests, with SHA-256 digests of the whole game and of its authoritative part. Presentation, platform and network modules never change `authoritativeDigest`. Host-only (`packages/game-runtime`). */
export interface GameIdentity {
  readonly format: 'spacelab-runtime-game/2';
  readonly environment: ModuleEnvironment;
  readonly lock: ModuleLockV2;
  readonly packages: InstalledGamePlan['packages'];
  readonly manifests: readonly ManifestV2[];
  readonly contentDigests: Readonly<Record<string, string>>;
  readonly gameLockDigest: string;
  /** Authoritative module schedule only; viewer/device changes cannot alter it.
   * World adapters must additionally bind physical content/geometry to their world fingerprint. */
  readonly authoritativeDigest: string;
}
function identity(lock: ModuleLockV2, manifests: ReadonlyMap<string, ManifestV2>, packages: InstalledGamePlan['packages'], environment: ModuleEnvironment, contentDigests: Readonly<Record<string, string>>): GameIdentity {
  const authoritative = new Set(lock.order.filter(id => manifests.get(id)!.tier === 'authoritative'));
  const filter = <T>(record: Readonly<Record<string, T>>): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([id]) => authoritative.has(id)));
  const exact = packages.map(ref => ({ ...ref })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const digests = Object.freeze(Object.fromEntries(Object.entries(contentDigests).filter(([id]) => lock.order.includes(id))));
  const body = { format: 'spacelab-runtime-game/2' as const, environment, lock, packages: exact, contentDigests: digests };
  const authority = { format: 'space-sim-module-authority/2', modules: lock.modules.filter(ref => authoritative.has(ref.id)),
    order: lock.order.filter(id => authoritative.has(id)), providers: Object.fromEntries(Object.entries(lock.providers).filter(([, id]) => authoritative.has(id))),
    settings: filter(lock.settings), capabilities: filter(lock.capabilities), packages: exact.filter(ref => authoritative.has(ref.id)), contentDigests: filter(digests) };
  return Object.freeze({ ...body, manifests: Object.freeze(lock.order.map(id => manifests.get(id)!)),
    gameLockDigest: sha256Hex(canonicalJson(body)), authoritativeDigest: sha256Hex(canonicalJson(authority)) });
}
/** A prepared game that is not yet active. `start` runs its resources under an abort signal and disposes everything on failure; `dispose` closes owned resources, then its resources, then its modules, recording failures in `disposalErrors`. Host-only (`packages/game-runtime`). */
export class CandidateGame implements Disposable {
  private started = false;
  private starting = false;
  private disposed = false;
  readonly disposalErrors: unknown[] = [];
  private readonly owned: Disposable[] = [];
  own<T extends Disposable>(resource: T): T {
    if (this.disposed) { resource.dispose(); throw new Error('Game candidate is disposed'); }
    this.owned.push(resource); return resource;
  }
  private readonly controller = new AbortController();
  constructor(readonly modules: ModuleCandidateV2, readonly identity: GameIdentity, readonly resources: CandidateResources) {}
  get available(): boolean { return !this.disposed; }
  get ready(): boolean { return this.started && !this.disposed; }
  async start(signal: AbortSignal): Promise<void> {
    if (this.disposed || this.started || this.starting) throw new Error('Game candidate is already starting, started or disposed');
    this.starting = true;
    const abort = () => this.controller.abort(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    try {
      this.controller.signal.throwIfAborted();
      await this.resources.start(this.controller.signal);
      this.controller.signal.throwIfAborted(); this.started = true;
    } catch (error) { this.dispose(); throw error; }
    finally { this.starting = false; signal.removeEventListener('abort', abort); }
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.controller.abort();
    for (let i = this.owned.length - 1; i >= 0; i--) { try { this.owned[i]!.dispose(); } catch (error) { this.disposalErrors.push(error); } }
    this.owned.length = 0;
    try { this.resources.dispose(); } catch (error) { this.disposalErrors.push(error); }
    try { this.modules.dispose(); } catch (error) { this.disposalErrors.push(error); }
  }
}
/** Browser, desktop and server inject codecs/world/view adapters into this one loader.
 * Replay is verified before resolution, and all resolution precedes any initialization.
 * Every non-shipped module needs an exact stored package (`Install exact package <id>@<version> (<digest>)`,
 * `Game must pin the exact package digest for <id>`); a package cannot replace a shipped ID. Host-only (`packages/game-runtime`). */
export async function prepareInstalledGame(plan: InstalledGamePlan, store: PackageStore, policy: LoadPolicy,
  adapters: EngineAdapters, signal: AbortSignal): Promise<CandidateGame> {
  plan = { profile: validateProfileV2(plan.profile), packages: plan.packages.map(ref => ({ ...ref })), requiredSlots: [...plan.requiredSlots] };
  const registry = new ModuleRegistryV2(adapters.hostServices,adapters.logs), references = plan.packages.map(ref => Object.freeze({ ...ref }));
  if (references.length > 256 || new Set(references.map(ref => ref.id)).size !== references.length) throw new Error('Duplicate or excessive game packages');
  const staticIds = new Set(adapters.staticModules.map(m => m.manifest.id));
  for (const ref of references) if (staticIds.has(ref.id)) throw new Error(`Package ${ref.id} cannot replace a shipped identity`);
  for (const module of adapters.staticModules) registry.register(module);
  for (const ref of references) {
    signal.throwIfAborted();
    const entry = await store.get(packageDigest(ref.digest));
    if (!entry) throw new Error(`Install exact package ${ref.id}@${ref.version} (${ref.digest})`);
    const checked = await adapters.inspect(entry.bytes.slice());
    if (checked.id !== ref.id || checked.version !== ref.version || checked.digest !== ref.digest) throw new Error(`Stored package ${ref.id} has a digest or identity mismatch`);
    if (checked.containsCode && !policy.allowRuntimeCode) throw new Error(`Module ${ref.id}: this build does not allow imported code`);
    if (!plan.profile.modules.some(m => m.id === ref.id && m.version === ref.version)) throw new Error(`Package ${ref.id} is not selected by this game`);
    const registration = checked.register(policy);
    registry.register(registration.module, registration.assets);
  }
  // Every non-static selection needs an exact package identity; no global version fallback.
  for (const ref of plan.profile.modules) if (!staticIds.has(ref.id) && !references.some(p => p.id === ref.id && p.version === ref.version)) throw new Error(`Game must pin the exact package digest for ${ref.id}`);
  signal.throwIfAborted();
  const lock = registry.resolve(plan.profile, policy.environment, plan.requiredSlots);
  const gameIdentity = identity(lock, registry.manifests, references, policy.environment, registry.contentDigests);
  const modules = registry.prepare(plan.profile, policy.environment, plan.requiredSlots);
  try {
    signal.throwIfAborted();
    return new CandidateGame(modules, gameIdentity, adapters.construct(modules, gameIdentity));
  } catch (error) { modules.dispose(); throw error; }
}
/** One publication boundary shared by browser mixed worlds and installed runtimes. */
export class GameTransition implements Disposable {
  active: CandidateGame | undefined;
  private pending: AbortController | undefined;
  private closed = false;
  async replace(prepare: (signal: AbortSignal) => Promise<CandidateGame>, publish: (candidate: CandidateGame) => void = () => {}, signal?: AbortSignal): Promise<CandidateGame> {
    if (this.closed) throw new Error('Game runtime is disposed');
    this.pending?.abort(); const controller = this.pending = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    let candidate: CandidateGame | undefined;
    try {
      candidate = await prepare(controller.signal);
      await candidate.start(controller.signal); controller.signal.throwIfAborted();
      if (this.pending !== controller || this.closed) throw new Error('Game replacement was superseded');
      candidate.resources.activate?.(); publish(candidate);
      const previous = this.active; this.active = candidate; previous?.dispose(); return candidate;
    } catch (error) { candidate?.dispose(); throw error; }
    finally { if (this.pending === controller) this.pending = undefined; signal?.removeEventListener('abort', abort); }
  }
  cancel(): void { this.pending?.abort(new Error('Game replacement cancelled')); }
  dispose(): void { this.closed = true; this.cancel(); this.active?.dispose(); this.active = undefined; }
}
/** Latest request wins. Start/IO failure keeps the previous complete game alive. */
export class InstalledGameRuntime implements Disposable {
  private readonly transition = new GameTransition();
  get active(): CandidateGame | undefined { return this.transition.active; }
  constructor(private readonly store: PackageStore, private readonly policy: LoadPolicy, private readonly adapters: EngineAdapters) {}
  replace(plan: InstalledGamePlan, signal?: AbortSignal): Promise<CandidateGame> {
    return this.transition.replace(signal => prepareInstalledGame(plan, this.store, this.policy, this.adapters, signal), () => {}, signal);
  }
  dispose(): void { this.transition.dispose(); }
}
