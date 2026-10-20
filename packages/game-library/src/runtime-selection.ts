/** Host-only per-target v2 runtime selections carried by games and progress (`packages/game-library`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`). */
import type { ModuleEnvironment } from '../../game-api/src/index';
import type { InstalledGamePlan } from '../../game-runtime/src/game-loader';
import { packageDigest } from '../../game-runtime/src/package-store';
import { capabilityName, validateProfileV2 } from '../../game-runtime/src/validation-v2';
import { freezeJson, keys, moduleId, object, version } from '../../game-runtime/src/validation';
import { copyPackageFiles, packageFiles, rememberPackageFiles, wrapLegacyCode, wrapLegacyData, encodeModuleFiles } from './portable';
import type { PackageFiles } from './zip';
import { decodeModulePackage } from './portable';
import { installPackage, type PackageBuildPolicy, type PackageStore } from '../../game-runtime/src/package-store';
import { inspectRuntimePackage } from './runtime-package';

/** Explicit per-target v2 selections alongside a legacy game's unchanged base profile.
 * Archive bytes are inert sidecars, never executable fields in the compatibility JSON. */
export interface RuntimeSelection {
  readonly format: 'spacelab-runtime-selection/2';
  readonly plans: Readonly<Partial<Record<ModuleEnvironment, InstalledGamePlan>>>;
}
/** Validates a `spacelab-runtime-selection/2` value: one or more of the `browser`, `offline` and `node` plans, each with a v2 profile, up to 256 exact package pins selected by that profile and up to 256 required slots. Host-only (`packages/game-library`). */
export function validateRuntimeSelection(raw: unknown): RuntimeSelection {
  const value = object(raw, 'Runtime selection');
  keys(value, ['format', 'plans'], 'Runtime selection');
  if (value.format !== 'spacelab-runtime-selection/2') throw new Error('Unsupported runtime selection');
  const targets = object(value.plans, 'Runtime targets');
  keys(targets, ['browser', 'offline', 'node'], 'Runtime targets');
  const plans: Partial<Record<ModuleEnvironment, InstalledGamePlan>> = {};
  for (const environment of ['browser', 'offline', 'node'] as const) {
    if (targets[environment] === undefined) continue;
    const plan = object(targets[environment], 'Runtime plan');
    keys(plan, ['profile', 'packages', 'requiredSlots'], 'Runtime plan');
    const profile = validateProfileV2(plan.profile);
    if (!Array.isArray(plan.packages) || plan.packages.length > 256) throw new Error('Runtime plan: expected at most 256 packages');
    const packages = plan.packages.map(raw => {
      const ref = object(raw, 'Runtime package'); keys(ref, ['id', 'version', 'digest'], 'Runtime package');
      const id = moduleId(ref.id, 'Runtime package ID'), exact = version(ref.version, 'Runtime package version');
      if (!profile.modules.some(m => m.id === id && m.version === exact)) throw new Error(`Runtime package ${id} is not selected exactly`);
      return { id, version: exact, digest: packageDigest(ref.digest as string) };
    });
    if (new Set(packages.map(p => p.id)).size !== packages.length) throw new Error('Duplicate runtime package');
    if (!Array.isArray(plan.requiredSlots) || plan.requiredSlots.length > 256) throw new Error('Invalid runtime slots');
    const requiredSlots = plan.requiredSlots.map(capabilityName);
    if (new Set(requiredSlots).size !== requiredSlots.length) throw new Error('Duplicate runtime slot');
    plans[environment] = { profile, packages, requiredSlots };
  }
  if (!Object.keys(plans).length) throw new Error('Runtime selection has no targets');
  const result = freezeJson({ format: value.format, plans }) as RuntimeSelection;
  copyPackageFiles(value, result);
  return result;
}
/** Every exact package pinned by any target; targets must agree (`Runtime targets disagree on exact package <id>`). Host-only (`packages/game-library`). */
export function runtimeReferences(selection: RuntimeSelection): InstalledGamePlan['packages'] {
  const refs = new Map<string, InstalledGamePlan['packages'][number]>();
  for (const plan of Object.values(selection.plans)) for (const ref of plan.packages) {
    const previous = refs.get(ref.id);
    if (previous && (previous.digest !== ref.digest || previous.version !== ref.version)) throw new Error(`Runtime targets disagree on exact package ${ref.id}`);
    refs.set(ref.id, ref);
  }
  return [...refs.values()];
}
/** Package archives attached to a runtime selection, keyed `modules/<id>.spacemod`. Host-only (`packages/game-library`). */
export function runtimeSelectionFiles(selection: RuntimeSelection): PackageFiles {
  return packageFiles(selection) ?? new Map();
}
/** Attaches package archives to `selection` and returns it. Host-only (`packages/game-library`). */
export function attachRuntimeFiles(selection: RuntimeSelection, files: PackageFiles): RuntimeSelection {
  rememberPackageFiles(selection, files); return selection;
}
/** Hosts persist only the selected target's packages. Installation does not approve or run code. */
export async function installRuntimeSelection(selection: RuntimeSelection, store: PackageStore, policy: PackageBuildPolicy, source: string): Promise<InstalledGamePlan> {
  const plan = selection.plans[policy.environment];
  if (!plan) throw new Error(`This game has no ${policy.environment} runtime target`);
  for (const ref of plan.packages) {
    const bytes = runtimeSelectionFiles(selection).get(`modules/${ref.id}.spacemod`);
    if (!bytes) throw new Error(`Missing runtime package ${ref.id}`);
    const checked = await inspectRuntimePackage(bytes);
    if (checked.id !== ref.id || checked.version !== ref.version || checked.digest !== ref.digest) throw new Error(`Runtime exact package mismatch: ${ref.id}`);
    await installPackage(bytes, store, inspectRuntimePackage, { source, installedAt: new Date().toISOString() }, policy);
  }
  return plan;
}
/** Whether any pinned runtime package is a code (provider) module. Host-only (`packages/game-library`). */
export async function runtimeContainsCode(selection: RuntimeSelection): Promise<boolean> {
  for (const ref of runtimeReferences(selection)) {
    const bytes = runtimeSelectionFiles(selection).get(`modules/${ref.id}.spacemod`);
    if (!bytes) throw new Error(`Missing runtime package ${ref.id}`);
    const checked = await decodeModulePackage(bytes);
    if (checked.descriptor.manifest.kind === 'provider') return true;
  }
  return false;
}

/** Persist every supplied member inertly, including legacy reusable content and code.
 * Target selection and code approval remain separate operations at activation time. */
export async function installGamePackages(game: import('./archive').GamePackage, store: PackageStore, policy: PackageBuildPolicy, source: string): Promise<void> {
  const provenance = { source, installedAt: new Date().toISOString() };
  for (const artifact of [...game.bundle.modules, ...game.plugins]) {
    const files = packageFiles(artifact) ?? (artifact.format === 'space-sim-data-module/1'
      ? wrapLegacyData(artifact, `Declared license: ${artifact.manifest.license}; see package provenance`) : wrapLegacyCode(artifact));
    await installPackage(await encodeModuleFiles(files), store, inspectRuntimePackage, provenance, policy);
  }
  if (game.runtime) for (const ref of runtimeReferences(game.runtime)) {
    const bytes = runtimeSelectionFiles(game.runtime).get(`modules/${ref.id}.spacemod`);
    if (!bytes) throw new Error(`Missing runtime package ${ref.id}`);
    const checked = await inspectRuntimePackage(bytes);
    if (checked.id !== ref.id || checked.version !== ref.version || checked.digest !== ref.digest) throw new Error(`Runtime exact package mismatch: ${ref.id}`);
    await installPackage(bytes, store, inspectRuntimePackage, provenance, policy);
  }
}
