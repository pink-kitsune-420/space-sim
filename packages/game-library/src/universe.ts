import type { UniverseDefinition } from '../../game-api/src/index';
import { validateUniverse } from '../../sim-core/src/universe';
import { compressJson, readJsonFile } from './compression';

/** The existing universe schema, compressed intact; single-system JSON remains supported. */
export async function encodeUniverse(universe: UniverseDefinition): Promise<Uint8Array<ArrayBuffer>> {
  return compressJson(validateUniverse(universe));
}
export async function decodeUniverse(bytes: Uint8Array<ArrayBuffer>): Promise<UniverseDefinition> {
  return validateUniverse(await readJsonFile(bytes));
}
