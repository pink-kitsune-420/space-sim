import { validatePackage, type GamePackage } from '../../../packages/game-library/src/archive';
import spaceSim from '../../../games/space-sim/game.json' with { type: 'json' };
import orbitSandbox from '../../../games/orbit-sandbox/game.json' with { type: 'json' };
import flightStarter from '../../../games/flight-starter/game.json' with { type: 'json' };

export const defaultGame = validatePackage(spaceSim) as GamePackage;
export const orbitSandboxGame = validatePackage(orbitSandbox) as GamePackage;
export const bundledGames: readonly GamePackage[] = Object.freeze([
  defaultGame, orbitSandboxGame, validatePackage(flightStarter) as GamePackage,
]);

/** Bundled descriptors are inert. A URL selects one composition, never code or a remote file. */
export function requestedBuiltinGame(search: string): GamePackage {
  const id = new URLSearchParams(search).get('game');
  return bundledGames.find(game => game.info.id === id || game.info.id === `builtin.${id}`) ?? defaultGame;
}
