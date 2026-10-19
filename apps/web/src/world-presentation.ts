import { createVehicleArtwork, type VehicleArtwork, type WorldRead } from '../../../packages/game-api/src/index';
import type { ModuleCandidateV2 } from '../../../packages/game-runtime/src/modules-v2';

const artwork = new WeakMap<WorldRead, VehicleArtwork>();
/** Capture selected presentation data outside rendering. An explicit mixed vehicle game
 * may intentionally omit artwork; legacy worlds retain the host's legacy appearance. */
export function moduleVehicleArtwork(modules: ModuleCandidateV2): VehicleArtwork | undefined {
  const appearances = modules.contributions('vehicleAppearance').map(item => item.value);
  return appearances.length || modules.contributions('vehicle').length ? createVehicleArtwork(appearances) : undefined;
}
export function rememberWorldArtwork(world: WorldRead, value: VehicleArtwork | undefined): void {
  if (value) artwork.set(world, value); else artwork.delete(world);
}
export function worldArtwork(world: WorldRead): VehicleArtwork | undefined { return artwork.get(world); }
