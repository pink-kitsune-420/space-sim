import type { Disposable, HostServiceAccess, ManifestV2, ModuleAssets, ModuleEnvironment, ModuleLockV2,
  ModuleProfileV2, RegisteredModuleV2 } from '../../game-api/src/index';
import { canonicalJson, sha256Hex } from './authoritative';
import { ModuleRegistryV2, type ModuleCandidateV2 } from './modules-v2';
import { packageDigest, type PackageIdentity, type PackageStore } from './package-store';
import type { LoadPolicy } from './loader';
import { validateProfileV2 } from './validation-v2';

export interface InspectedRuntimePackage extends PackageIdentity {
  readonly manifest: ManifestV2;
  /** Creating a lazy registration is inert. Initialization is the only execution gate. */
  register(policy: LoadPolicy): { readonly module: RegisteredModuleV2; readonly assets: ModuleAssets };
}
export interface InstalledGamePlan {
  readonly profile: ModuleProfileV2;
  readonly packages: readonly { readonly id: string; readonly version: string; readonly digest: string }[];
  readonly requiredSlots: readonly string[];
}
export interface CandidateResources extends Disposable {
  /** Allocate/connect without publishing to the current game. Honor cancellation. */
  start(signal: AbortSignal): Promise<void>;
  /** Synchronous publication after startup succeeds; throwing must leave the old game intact. */
  activate?(): void;
}
export interface EngineAdapters {
  readonly hostServices: readonly HostServiceAccess[];
  readonly staticModules: readonly RegisteredModuleV2[];
  inspect(bytes: Uint8Array): Promise<InspectedRuntimePackage>;
  construct(modules: ModuleCandidateV2, identity: GameIdentity): CandidateResources;
}
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
export class CandidateGame implements Disposable {
  private started = false;
  private starting = false;
  private disposed = false;
  readonly disposalErrors: unknown[] = [];
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
    try { this.resources.dispose(); } catch (error) { this.disposalErrors.push(error); }
    try { this.modules.dispose(); } catch (error) { this.disposalErrors.push(error); }
  }
}
/** Browser, desktop and server inject codecs/world/view adapters into this one loader.
 * Replay is verified before resolution, and all resolution precedes any initialization. */
export async function prepareInstalledGame(plan: InstalledGamePlan, store: PackageStore, policy: LoadPolicy,
  adapters: EngineAdapters, signal: AbortSignal): Promise<CandidateGame> {
  plan = { profile: validateProfileV2(plan.profile), packages: plan.packages.map(ref => ({ ...ref })), requiredSlots: [...plan.requiredSlots] };
  const registry = new ModuleRegistryV2(adapters.hostServices), references = plan.packages.map(ref => Object.freeze({ ...ref }));
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
/** Latest request wins. Start/IO failure keeps the previous complete game alive. */
export class InstalledGameRuntime implements Disposable {
  active: CandidateGame | undefined;
  private pending: AbortController | undefined;
  private closed = false;
  constructor(private readonly store: PackageStore, private readonly policy: LoadPolicy, private readonly adapters: EngineAdapters) {}
  async replace(plan: InstalledGamePlan, signal?: AbortSignal): Promise<CandidateGame> {
    if (this.closed) throw new Error('Game runtime is disposed');
    this.pending?.abort(); const controller = this.pending = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    let candidate: CandidateGame | undefined;
    try {
      candidate = await prepareInstalledGame(plan, this.store, this.policy, this.adapters, controller.signal);
      await candidate.start(controller.signal); controller.signal.throwIfAborted();
      if (this.pending !== controller || this.closed) throw new Error('Game replacement was superseded');
      candidate.resources.activate?.();
      const previous = this.active; this.active = candidate; previous?.dispose(); return candidate;
    } catch (error) { candidate?.dispose(); throw error; }
    finally { if (this.pending === controller) this.pending = undefined; signal?.removeEventListener('abort', abort); }
  }
  dispose(): void { this.closed = true; this.pending?.abort(); this.active?.dispose(); this.active = undefined; }
}
