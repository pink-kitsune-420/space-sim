/** Host-only (`packages/game-runtime`): registrations of modules linked into this build. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); it has no module-facing equivalent. */
import type { HostServiceAccess, ModuleAssets, ModuleEnvironment, RegisteredModuleV2 } from '../../game-api/src/index';
import type { InstalledGamePlan } from './game-loader';
import { ModuleRegistryV2, moduleAssets } from './modules-v2';
import { validateManifestV2 } from './validation-v2';

/** A shipped module's validated v2 registration and its guide assets. Host-only (`packages/game-runtime`). */
export interface BundledRegistration { readonly module: RegisteredModuleV2; readonly assets: ModuleAssets }
/** Statically linked source is trusted by the build, never by an imported archive's claims.
 * The same initializer, metadata and guide assets are used by editable package builds. */
export function bundledRegistration(descriptor: { readonly manifest: unknown; readonly compatibility: { readonly multiplayer: boolean } },
  initialize: RegisteredModuleV2['initialize'], documents: Readonly<Record<string, unknown>>): BundledRegistration {
  return { module: { manifest: validateManifestV2(descriptor.manifest), supportsMultiplayer: descriptor.compatibility.multiplayer, initialize },
    assets: moduleAssets(new Map(Object.entries(documents).map(([path, document]) => [path, new TextEncoder().encode(JSON.stringify(document))]))) };
}
/** One load-time graph for shipped host features. Downloaded code uses the installed
 * loader with its exact digests/consent; it cannot replace this trusted build inventory. */
export function prepareBundledPlan(plan: InstalledGamePlan, environment: ModuleEnvironment,
  registrations: readonly BundledRegistration[], hostServices: readonly HostServiceAccess[] = []) {
  if (plan.packages.length) throw new Error('Installed packages require the exact-package loader and explicit code approval');
  const registry = new ModuleRegistryV2(hostServices);
  for (const { module, assets } of registrations) registry.register(module, assets);
  return registry.prepare(plan.profile, environment, plan.requiredSlots);
}
