/** Host-only progress ownership. This metadata never changes physics locks or save versions. */
import type { WorldSave, UniverseSaveFormat, HostServiceAccess } from '../../game-api/src/index';
import { CORE_UNIVERSE_FORMAT } from '../../game-api/src/index';
import { encodeUniverseSave, decodeUniverseSave } from './save-package';

export const CLASSIC_GAME_ID = 'builtin.space-sim';
export const SUCCESSOR_GAME_ID = 'builtin.space-sim-successor';

/** Keep built-in successor progress separate from Classic and existing creator hosts.
 * Untagged saves and other compositions retain the legacy explicit import workflow;
 * their installed packages, physical locks and code consent are validated on restore. */
export function assertGameProgress(raw: unknown, gameId: string): void {
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== 'space-sim-world')
    throw new Error('Expected saved universe progress');
  const owner = (raw as { gameId?: unknown }).gameId;
  if (owner !== undefined && (typeof owner !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(owner)))
    throw new Error('Invalid saved game identity');
  if ((owner === SUCCESSOR_GAME_ID || gameId === SUCCESSOR_GAME_ID) && (owner ?? CLASSIC_GAME_ID) !== gameId)
    throw new Error(`This progress belongs to ${owner ?? 'Space Sim Classic'}. Open that game in the Library before loading it.`);
}

/** Browser save IO records the active game and isolates the built-in successor's progress,
 * while preserving existing creator restore flows and the shared headless codec.
 * The getter follows in-page library activation. */
export function gameProgressFormat(currentGameId: () => string): UniverseSaveFormat {
  return Object.freeze<UniverseSaveFormat>({
    async encode(save, signal) {
      const tagged: WorldSave & { readonly gameId: string } = { ...save, gameId: currentGameId() };
      return encodeUniverseSave(tagged, { signal });
    },
    async decode(bytes, signal) {
      const saved = await decodeUniverseSave(bytes, { signal });
      assertGameProgress(saved, currentGameId());
      return saved;
    },
  });
}

export function gameProgressService(currentGameId: () => string): HostServiceAccess {
  return Object.freeze({ key: CORE_UNIVERSE_FORMAT, service: gameProgressFormat(currentGameId),
    tiers: ['platform'] as const, environments: ['browser', 'offline'] as const });
}

/** Preserve Classic's existing preference keys; every other game's gameplay choices are
 * independent. Shell preferences such as graphics, input, audio and HUD remain shared. */
export function gamePreferenceKey(legacyKey: string, gameId: string): string {
  return gameId === CLASSIC_GAME_ID ? legacyKey : `${legacyKey}:${gameId}`;
}
