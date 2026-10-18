import type { JoinOffer, JoinStage, DataModule, HostServiceAccess, JoinOptions, ModuleProfile, RegisteredModule, SimulationContextFactory, UniverseDefinition } from '../../game-api/src/index';
import { canonicalJson, sha256Hex } from '../../game-runtime/src/authoritative';
import { prepareInstalledGame, type CandidateGame, type EngineAdapters, type InstalledGamePlan } from '../../game-runtime/src/game-loader';
import { normalizeLegacyModule, type LoadPolicy } from '../../game-runtime/src/loader';
import { moduleAssets, type ModuleCandidateV2 } from '../../game-runtime/src/modules-v2';
import type { PackageStore } from '../../game-runtime/src/package-store';
import { moduleWorldConfiguration } from '../../sim-core/src/module-world';
import { loadWorld, type LoadedWorld } from '../../sim-core/src/save';
import { World } from '../../sim-core/src/world';
import { validateUniverse } from '../../sim-core/src/universe';
import { applyDataModules } from './data';
import { prepareGame, BASE_GAME_MODULES, DEFAULT_PROFILE } from './index';

export interface InstalledWorldOptions {
  readonly logs?:EngineAdapters['logs'];
  readonly configuration?: import('../../game-api/src/index').SavedGameConfiguration;
  readonly profile?: ModuleProfile;
  readonly data?: readonly DataModule[];
  readonly code?: readonly RegisteredModule[];
  readonly universe?: UniverseDefinition; readonly universeKey?: string; readonly systemId?: string; readonly id?: string;
  readonly hostServices: readonly HostServiceAccess[];
  readonly inspect: EngineAdapters['inspect'];
  /** Hosts validate and configure device/view contributions while the candidate is isolated. */
  readonly configure?: (modules: ModuleCandidateV2) => void;
  /** Host resources are owned by CandidateGame, after module initialization is sealed. */
  readonly dispose?: () => void;
  readonly restore?: unknown;
}
/** Verify a peer's physical world using the already enabled exact module graph.
 * The peer supplies universe data, never code, settings or a replacement module plan. */
export function verifyInstalledWorldCandidate(game: CandidateGame, candidate: Parameters<NonNullable<JoinOptions['verifyCandidate']>>[0]): {
  readonly ok: boolean; readonly reason?: string; readonly simulationFingerprint?: string;
} {
  if (!game.available || !candidate.lock || !candidate.fingerprint) return { ok: false, reason: 'Load the exact installed game before joining this server.' };
  try {
    const configuration = moduleWorldConfiguration(game.modules, game.identity, { universe: candidate.universe, systemId: candidate.systemId });
    const probe = new World(configuration.universe, configuration.options);
    try {
      if (probe.soloPreview || canonicalJson(probe.lock) !== canonicalJson(candidate.lock) || probe.simulationFingerprint !== candidate.fingerprint)
        return { ok: false, reason: 'Simulation mismatch: load the same exact game packages and settings as the server.' };
      return { ok: true, simulationFingerprint: probe.simulationFingerprint };
    } finally { probe.dispose(); }
  } catch (error) { return { ok: false, reason: `Could not reproduce the server world: ${error instanceof Error ? error.message : String(error)}` }; }
}
/** Shared browser/server composition for an explicitly upgraded mixed v1/v2 game.
 * Codecs, storage and viewer services are injected; this graph has no browser imports. */
export async function prepareInstalledWorld(plan: InstalledGamePlan, store: PackageStore, policy: LoadPolicy,
  options: InstalledWorldOptions, signal: AbortSignal): Promise<{ readonly candidate: CandidateGame; readonly loaded: LoadedWorld; readonly createContext: SimulationContextFactory }> {
  const profile = options.profile ?? DEFAULT_PROFILE, data = options.data ?? [];
  const staticModules = [...BASE_GAME_MODULES, ...data.map(module => ({ manifest: module.manifest,
    contentDigest: sha256Hex(canonicalJson(module)), supportsMultiplayer: true, initialize() {} })), ...options.code ?? []]
    .map(module => normalizeLegacyModule(module, moduleAssets()));
  const selected = new Set(profile.modules.map(ref => ref.id));
  if (plan.profile.modules.some(ref => selected.has(ref.id))) throw new Error('Mixed game repeats a base-profile module');
  const merged: InstalledGamePlan = { ...plan, profile: { ...plan.profile,
    modules: [...profile.modules, ...plan.profile.modules], providers: { ...profile.providers, ...plan.profile.providers },
    settings: { ...profile.settings, ...plan.profile.settings } }, requiredSlots: [...new Set(['motion', 'content', ...plan.requiredSlots])] };
  let loaded!: LoadedWorld;
  let createContext!: SimulationContextFactory;
  const candidate = await prepareInstalledGame(merged, store, policy, { logs:options.logs,hostServices: options.hostServices, staticModules, inspect: options.inspect,
    construct(modules, identity) {
      const saved = options.restore === undefined ? undefined : options.restore as Record<string, unknown>;
      const configuration = moduleWorldConfiguration(modules, identity, { id: options.id, systemId: saved ? saved.systemId as string : options.systemId,
        universe: saved ? validateUniverse(saved.universe) : options.universe, universeKey: saved ? undefined : options.universeKey,
        resolveContent: saved ? undefined : base => applyDataModules(base, data.filter(m => selected.has(m.manifest.id))) });
      const worldOptions = { ...configuration.options, configuration: options.configuration };
      createContext = worldOptions.createContext!;
      if (saved) {
        const probe = new World(configuration.universe, worldOptions);
        try {
          if (canonicalJson(probe.lock) !== canonicalJson(saved.lock) || probe.simulationFingerprint !== saved.simulationFingerprint) throw new Error('Save: exact installed game selection, settings or geometry differ from the required lock');
        } finally { probe.dispose(); }
        loaded = loadWorld(saved, worldOptions);
      } else loaded = { world: new World(configuration.universe, worldOptions), players: [], paused: false };
      try { options.configure?.(modules); } catch (error) {
        try { options.dispose?.(); } finally { loaded.world.dispose(); }
        throw error;
      }
      const dispose = loaded.world.dispose.bind(loaded.world);
      return { async start(signal) { signal.throwIfAborted(); }, dispose() { try { options.dispose?.(); } finally { dispose(); } } };
    },
  }, signal);
  // Ownership is in CandidateGame.resources; world callers close the complete candidate.
  loaded.world.dispose = () => candidate.dispose();
  return { candidate, loaded, createContext };
}

/** Prepare exact remote authority in isolation. Physical content is already resolved by the
 * server pack; no saved craft state or code approval is accepted from a welcome message. */
export async function preparePeerWorld(plan: InstalledGamePlan | undefined, store: PackageStore, policy: LoadPolicy,
  options: InstalledWorldOptions, offer: JoinOffer, signal: AbortSignal): Promise<JoinStage> {
  signal.throwIfAborted();
  if (plan) {
    const prepared = await prepareInstalledWorld(plan, store, policy, options, signal);
    try {
      const world = prepared.loaded.world;
      if (world.soloPreview || sha256Hex(canonicalJson(world.lock)) !== offer.lockDigest || world.simulationFingerprint !== offer.fingerprint)
        throw new Error('Server pack cannot reproduce the offered authoritative lock and simulation fingerprint');
      await prepared.candidate.start(signal); signal.throwIfAborted();
      return { options: { name: 'Pilot', lock: world.lock, simulationFingerprint: world.simulationFingerprint,
        createContext: prepared.createContext, vehicles: world.vehicles, dataAdapters: world.dataAdapters, rules: world.rules, forces: world.forces, commands: world.commands,
        verifyCandidate: candidate => {
          if (candidate.fingerprint !== offer.fingerprint || sha256Hex(canonicalJson(candidate.lock)) !== offer.lockDigest)
            return { ok: false, reason: 'The host changed its enabled game while joining' };
          return verifyInstalledWorldCandidate(prepared.candidate, candidate);
        } }, dispose: () => prepared.candidate.dispose() };
    } catch (error) { prepared.candidate.dispose(); throw error; }
  }
  const prepared = prepareGame({ environment: policy.environment, profile: options.profile, data: options.data,
    code: options.code, universe: options.universe, systemId: options.systemId, resolvedUniverse: true });
  try {
    signal.throwIfAborted(); const world = prepared.world;
    if (world.soloPreview || sha256Hex(canonicalJson(world.lock)) !== offer.lockDigest || world.simulationFingerprint !== offer.fingerprint)
      throw new Error('Server pack cannot reproduce the offered authoritative lock and simulation fingerprint');
    return { options: { name: 'Pilot', lock: world.lock, simulationFingerprint: world.simulationFingerprint,
      createContext: prepared.createContext, vehicles: world.vehicles, dataAdapters: world.dataAdapters, rules: world.rules, forces: world.forces, commands: world.commands,
      verifyCandidate(candidate) {
        if (!prepared.candidate.available || !candidate.lock || candidate.fingerprint !== offer.fingerprint
          || sha256Hex(canonicalJson(candidate.lock)) !== offer.lockDigest) return { ok: false, reason: 'The host changed its enabled game while joining' };
        const probe = prepareGame({ environment: policy.environment, profile: options.profile, data: options.data,
          code: options.code, universe: candidate.universe, systemId: candidate.systemId, resolvedUniverse: true });
        try { return { ok: probe.world.simulationFingerprint === offer.fingerprint
          && sha256Hex(canonicalJson(probe.world.lock)) === offer.lockDigest, simulationFingerprint: probe.world.simulationFingerprint }; }
        finally { probe.candidate.dispose(); }
      } }, activate() { prepared.runtime.activate(prepared.candidate); }, dispose: () => prepared.candidate.dispose() };
  } catch (error) { prepared.candidate.dispose(); throw error; }
}
