import type { UniverseDefinition } from '../../game-api/src/index';
import { validateUniverse } from '../../sim-core/src/universe';
import { encodeDataFile, decodeDataFile } from './data-file';

/** Reusable definitions export separately from saved progress, without rounding model numbers. */
export async function encodeUniverse(universe: UniverseDefinition): Promise<Uint8Array<ArrayBuffer>> {
  return encodeDataFile('universe', universe);
}
/** Includes legacy JSON, gzip and old .spaceuniverse definition files, identified by content. */
export async function decodeUniverse(bytes: Uint8Array<ArrayBuffer>): Promise<UniverseDefinition> {
  return validateUniverse(await decodeDataFile(bytes, 'universe'));
}
