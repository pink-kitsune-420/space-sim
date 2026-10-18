import type { JoinOptions, ModuleEnvironment, ModuleProfile, RegisteredModule } from '../../../packages/game-api/src/index';
import { canonicalJson } from '../../../packages/game-runtime/src/authoritative';
import { prepareGame, type DataModule } from '../../../packages/modules/src/index';

/** Rebuild the server's resolved universe with the currently enabled local profile.
 * Network data supplies no code or module selection. The exact resulting authority must
 * match before ClientSession can publish its remote world; the solo world stays untouched. */
export function verifyServerCandidate(candidate: Parameters<NonNullable<JoinOptions['verifyCandidate']>>[0], installed: {
  readonly environment: ModuleEnvironment; readonly profile: ModuleProfile;
  readonly data: readonly DataModule[]; readonly code: readonly RegisteredModule[];
}): { ok: boolean; reason?: string; simulationFingerprint?: string } {
  if (candidate.lock?.format !== 'space-sim-auth-lock/1' || !candidate.fingerprint) {
    return { ok: false, reason: 'The server did not provide a complete simulation identity. Update the server and client together.' };
  }
  try {
    const prepared = prepareGame({ ...installed, universe: candidate.universe, systemId: candidate.systemId, resolvedUniverse: true });
    try {
      if (prepared.world.soloPreview || canonicalJson(prepared.world.lock) !== canonicalJson(candidate.lock)
        || prepared.world.simulationFingerprint !== candidate.fingerprint) {
        return { ok: false, reason: 'Simulation mismatch: load the same game and authoritative module profile as the server. '
          + 'The server universe could not be reproduced with your enabled modules; your solo world is unchanged.' };
      }
      return { ok: true, simulationFingerprint: prepared.world.simulationFingerprint };
    } finally { prepared.candidate.dispose(); }
  } catch (error) {
    return { ok: false, reason: `Could not prepare the server world with your enabled modules: ${error instanceof Error ? error.message : String(error)}` };
  }
}
