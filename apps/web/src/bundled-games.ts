import { canonicalJson } from '../../../packages/game-runtime/src/authoritative';
import { validatePackage, type GamePackage } from '../../../packages/game-library/src/archive';
import spaceSim from '../../../games/space-sim/game.json' with { type: 'json' };
import orbitSandbox from '../../../games/orbit-sandbox/game.json' with { type: 'json' };
import flightStarter from '../../../games/flight-starter/game.json' with { type: 'json' };
import planetViewer from '../../../games/planet-viewer/game.json' with { type: 'json' };
import surveyFixture from '../../../games/survey-fixture/game.json' with { type: 'json' };

export const defaultGame = validatePackage(spaceSim) as GamePackage;
export const orbitSandboxGame = validatePackage(orbitSandbox) as GamePackage;
export const bundledGames: readonly GamePackage[] = Object.freeze([
  defaultGame, orbitSandboxGame, validatePackage(flightStarter) as GamePackage,
  validatePackage(planetViewer) as GamePackage, validatePackage(surveyFixture) as GamePackage,
]);

/** Bundled descriptors are inert. A URL selects one composition, never code or a remote file. */
export function requestedBuiltinGame(search: string): GamePackage {
  const id = new URLSearchParams(search).get('game');
  return bundledGames.find(game => game.info.id === id || game.info.id === `builtin.${id}`) ?? defaultGame;
}

/** Explicit compatible host adapters. A transport never promotes the legacy Sandbox
 * model to the flight session protocol. Target plans separately select public services. */
export const bundledGameAdapters = new Map<string, 'flight' | 'legacy-sandbox' | 'static-viewer' | 'bounded-survey'>([
  ['builtin.space-sim', 'flight'], ['builtin.flight-starter', 'flight'], ['builtin.orbit-sandbox', 'legacy-sandbox'],
  ['builtin.planet-viewer', 'static-viewer'], ['builtin.survey-fixture', 'bounded-survey'],
]);

/** Exact bundled definitions can round-trip through legacy game archives. An edited
 * archive cannot claim a trusted host adapter merely by copying its built-in ID. */
export function bundledGameDefinition(game: GamePackage): GamePackage | undefined {
  return bundledGames.find(builtin => builtin.info.id === game.info.id && canonicalJson(builtin) === canonicalJson(game));
}
