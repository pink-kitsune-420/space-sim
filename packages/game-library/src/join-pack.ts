import type { JoinOffer, JoinPackageRequirement, ManifestV2, ModuleEnvironment, WorldRead, UniverseDefinition } from '../../game-api/src/index';
import { canonicalJson, sha256Hex, sha256Bytes } from '../../game-runtime/src/authoritative';
import { moduleAssets } from '../../game-runtime/src/modules-v2';
import { MODEL } from '../../sim-core/src/constants';
import { normalizeLegacyModule } from '../../game-runtime/src/loader';
import { resolveModulesV2 } from '../../game-runtime/src/resolver-v2';
import { BASE_GAME_MODULES } from '../../modules/src/index';
import { engineModuleServices } from '../../sim-core/src/module-services';
import { validateUniverse } from '../../sim-core/src/universe';
import { createOffer } from '../../../modules/session-join/src/offer';
import { MAX_EXPANDED_BYTES } from './compression';
import { decodeGamePackage, inspectGameFiles } from './game-package';
import { readZip, writeZip } from './zip';
import { validatePackage, encodePackage, type GamePackage } from './archive';
import { decodeModulePackage } from './portable';
import { attachRuntimeFiles, runtimeReferences, runtimeSelectionFiles, type RuntimeSelection } from './runtime-selection';

/** Public game selection, trimmed to authority and explicitly required client capabilities.
 * Optional host HUD, themes and controls never become mandatory guest modules. */
export async function requiredJoinGame(game: GamePackage): Promise<GamePackage> {
  const selected = new Set(game.bundle.profile.modules.map(ref => ref.id));
  const plugins = game.plugins.filter(module => module.manifest.authority === 'authoritative' && selected.has(module.manifest.id));
  const modules = game.bundle.modules.filter(module => selected.has(module.manifest.id));
  const { presentation: _presentation, ...bundle } = game.bundle;
  const legacy = [...BASE_GAME_MODULES, ...modules.map(module => ({ manifest: module.manifest, initialize() {} })), ...plugins.map(module => ({ manifest: module.manifest, initialize() {} }))];
  const manifests = new Map<string, ManifestV2>(legacy.map(module => { const normalized = normalizeLegacyModule(module, moduleAssets()); return [normalized.manifest.id, normalized.manifest]; }));
  let runtime: RuntimeSelection | undefined;
  if (game.runtime) {
    const files = runtimeSelectionFiles(game.runtime), retained = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const reference of runtimeReferences(game.runtime)) {
      const path = `modules/${reference.id}.spacemod`, bytes = files.get(path);
      if (!bytes) throw new Error(`Missing enabled game package ${reference.id}`);
      const checked = await decodeModulePackage(Uint8Array.from(bytes));
      if (checked.descriptor.manifest.format !== 'space-sim-module/2' || checked.descriptor.manifest.id !== reference.id || checked.integrity.digest !== reference.digest) throw new Error('Server package inventory mismatch');
      manifests.set(reference.id, checked.descriptor.manifest);
    }
    const plans: Partial<Record<ModuleEnvironment, NonNullable<RuntimeSelection['plans']['browser']>>> = {};
    for (const [target, plan] of Object.entries(game.runtime.plans)) {
      const environment = target as ModuleEnvironment;
      const profile = { ...plan.profile, modules: [...game.bundle.profile.modules, ...plan.profile.modules],
        providers: { ...game.bundle.profile.providers, ...plan.profile.providers }, settings: { ...game.bundle.profile.settings, ...plan.profile.settings } };
      // Resolution is metadata-only. UI ports stand in for the eventual browser host without allocating DOM.
      const services = [...engineModuleServices()];
      for (const name of ['core.ui', 'core.dom', 'core.theme', 'core.pilots', 'core.session']) services.push({ key: { slot: name, version: '1.0.0' }, service: {}, tiers: ['authoritative', 'presentation', 'platform', 'network'], environments: ['browser', 'offline', 'node'] });
      const lock = resolveModulesV2(manifests, profile, environment, ['motion', 'content', ...plan.requiredSlots], services);
      const needed = new Set(profile.modules.filter(ref => manifests.get(ref.id)?.tier === 'authoritative').map(ref => ref.id));
      for (const slot of plan.requiredSlots) if (lock.providers[slot]) needed.add(lock.providers[slot]!);
      const visit = (id: string): void => {
        const manifest = manifests.get(id)!;
        for (const dependency of manifest.dependencies) if (!needed.has(dependency.id)) { needed.add(dependency.id); visit(dependency.id); }
        for (const need of manifest.requires) {
          if (need.optional) continue;
          const provider = lock.capabilities[id]?.[need.name]?.provider.id;
          if (provider && provider !== 'builtin.engine' && !needed.has(provider)) { needed.add(provider); visit(provider); }
        }
      };
      for (const id of needed) visit(id);
      const filter = <T>(value: Readonly<Record<string, T>>) => Object.fromEntries(Object.entries(value).filter(([id]) => needed.has(id)));
      const capabilities = Object.fromEntries(Object.entries(filter(plan.profile.capabilities)).map(([id, choices]) => [id,
        Object.fromEntries(Object.entries(choices).filter(([, provider]) => needed.has(provider) || provider === 'builtin.engine'))]));
      const packages = plan.packages.filter(reference => needed.has(reference.id));
      for (const reference of packages) retained.set(`modules/${reference.id}.spacemod`, files.get(`modules/${reference.id}.spacemod`)!);
      plans[environment] = { ...plan, packages, profile: { ...plan.profile, modules: plan.profile.modules.filter(ref => needed.has(ref.id)),
        providers: Object.fromEntries(Object.entries(plan.profile.providers).filter(([, provider]) => needed.has(provider))), settings: filter(plan.profile.settings), capabilities } };
    }
    runtime = attachRuntimeFiles({ format: 'spacelab-runtime-selection/2', plans }, retained);
  }
  return { ...game, bundle: { ...bundle, modules, ...(bundle.code ? { code: bundle.code.filter(ref => selected.has(ref.id)) } : {}) }, plugins, ...(runtime ? { runtime } : {}) };
}
export async function joinInventory(game: GamePackage, archives: ReadonlyMap<string, Uint8Array>): Promise<readonly JoinPackageRequirement[]> {
  const entries: JoinPackageRequirement[] = [];
  for (const module of [...game.bundle.modules, ...game.plugins]) {
    const code = module.format === 'space-sim-code-module/1';
    const bytes = archives.get(code ? `modules/${module.manifest.id}.spacemod` : `data/${module.manifest.id}.spacedata`);
    if (!bytes) throw new Error('Missing exact embedded legacy package');
    const inspected = await decodeModulePackage(Uint8Array.from(bytes));
    entries.push({ id: module.manifest.id, version: module.manifest.version,
      digest: code ? module.digest : sha256Hex(canonicalJson(module)), bytes: bytes.length, license: module.manifest.license,
      containsCode: code, sourceIncluded: inspected.descriptor.sourceStatus === 'included', required: true, tier: module.manifest.authority });
  }
  if (game.runtime) for (const reference of runtimeReferences(game.runtime)) {
    const bytes = runtimeSelectionFiles(game.runtime).get(`modules/${reference.id}.spacemod`);
    if (!bytes) throw new Error('Missing enabled runtime package');
    const checked = await decodeModulePackage(Uint8Array.from(bytes)), manifest = checked.descriptor.manifest;
    if (manifest.id !== reference.id || manifest.version !== reference.version || checked.integrity.digest !== reference.digest || manifest.format !== 'space-sim-module/2') throw new Error('Runtime package inventory mismatch');
    if (!checked.descriptor.compatibility.multiplayer) throw new Error(`${manifest.id} does not declare multiplayer compatibility`);
    entries.push({ id: manifest.id, version: manifest.version, digest: reference.digest, bytes: bytes.length, license: manifest.license,
      containsCode: manifest.kind === 'provider', sourceIncluded: checked.descriptor.sourceStatus === 'included', required: true, tier: manifest.tier });
  }
  if (new Set(entries.map(item => item.id)).size !== entries.length) throw new Error('Duplicate join-pack module');
  return entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export interface InspectedJoinPack { readonly game: GamePackage; readonly universe: UniverseDefinition; readonly systemId: string; readonly inventory: readonly JoinPackageRequirement[] }
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
/** Ephemeral server wire container: ordinary editable game plus physical content, never progress. */
export async function encodeJoinPack(raw: GamePackage, world: WorldRead): Promise<{ readonly bytes: Uint8Array<ArrayBuffer>; readonly offer: JoinOffer }> {
  if (world.soloPreview || !world.lock) throw new Error('Only a multiplayer-compatible enabled game can be offered');
  const game = await requiredJoinGame(raw), gameBytes = await encodePackage(game);
  const budget = { bytes: 0, files: 0 }, checked = await decodeGamePackage(gameBytes, validatePackage, { budget });
  const checkedGame = checked.legacy;
  if (checkedGame.format !== 'space-lab-game/1') throw new Error('Join source is not a game');
  const inventory = await joinInventory(checkedGame, checked.files);
  if (budget.bytes + gameBytes.length + json(world.universe).length + 1024 > MAX_EXPANDED_BYTES) throw new Error('Server pack exceeds the combined expanded-byte budget');
  const bytes = await writeZip(new Map([['join.json', json({ format: 'spacelab-server-pack/1', systemId: world.systemId })],
    ['game.spacegame', gameBytes], ['world.json', json(world.universe)]]));
  const offer = createOffer({ sessionId: world.id, name: game.info.name, protocol: 'space-sim-net/5', entitySchema: 'space-sim-ships/1', model: MODEL,
    fingerprint: world.simulationFingerprint, lockDigest: sha256Hex(canonicalJson(world.lock)), packDigest: sha256Bytes(bytes), packBytes: bytes.length, packages: inventory });
  return { bytes, offer };
}
/** Pure whole-pack inspection. Inventory/code/source/license mismatches fail before any initializer. */
export async function inspectJoinPack(raw: Uint8Array, offer: JoinOffer, signal?: AbortSignal): Promise<InspectedJoinPack> {
  if (raw.length !== offer.packBytes || sha256Bytes(raw) !== offer.packDigest) throw new Error('Server pack digest or size mismatch');
  const budget = { bytes: 0, files: 0 };
  const files = await readZip(Uint8Array.from(raw), { signal, maxFiles: 3, budget });
  if (files.size !== 3 || !['join.json', 'game.spacegame', 'world.json'].every(path => files.has(path))) throw new Error('Invalid server pack inventory');
  const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get('join.json')!));
  if (!metadata || metadata.format !== 'spacelab-server-pack/1' || Object.keys(metadata).length !== 2 || typeof metadata.systemId !== 'string' || metadata.systemId.length > 128) throw new Error('Unsupported server pack metadata');
  const gameFiles = await readZip(files.get('game.spacegame')!, { signal, budget });
  const game = (await inspectGameFiles(gameFiles, validatePackage, { budget })).legacy;
  if (game.format !== 'space-lab-game/1') throw new Error('Server pack requires a game');
  const inventory = await joinInventory(game, gameFiles);
  if (canonicalJson(inventory) !== canonicalJson([...offer.packages].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) throw new Error('Server pack code/data inventory differs from the approved offer');
  return { game, inventory, universe: validateUniverse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get('world.json')!))), systemId: metadata.systemId };
}
