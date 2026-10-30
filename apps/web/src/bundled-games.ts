// Copyright (c) 2026 pink-kitsune-420
// SPDX-License-Identifier: MIT

import { canonicalJson } from '../../../packages/game-runtime/src/authoritative';
import { validatePackage, validateGameCatalog, type GamePackage, type GameCatalog } from '../../../packages/game-library/src/archive';
import catalogJson from '../../../games/catalog.json' with { type: 'json' };
import spaceSim from '../../../games/space-sim/game.json' with { type: 'json' };
import spaceSimSuccessor from '../../../games/space-sim-successor/game.json' with { type: 'json' };
import orbitSandbox from '../../../games/orbit-sandbox/game.json' with { type: 'json' };
import orbitAcademy from '../../../games/orbit-academy/game.json' with { type: 'json' };
import flightStarter from '../../../games/flight-starter/game.json' with { type: 'json' };
import planetViewer from '../../../games/planet-viewer/game.json' with { type: 'json' };
import surveyFixture from '../../../games/survey-fixture/game.json' with { type: 'json' };

export const catalog: GameCatalog = validateGameCatalog(catalogJson);

export const defaultGame = validatePackage(spaceSim) as GamePackage;
export const spaceSimSuccessorGame = validatePackage(spaceSimSuccessor) as GamePackage;
export const orbitSandboxGame = validatePackage(orbitSandbox) as GamePackage;
export const orbitAcademyGame = validatePackage(orbitAcademy) as GamePackage;
export const flightStarterGame = validatePackage(flightStarter) as GamePackage;
export const planetViewerGame = validatePackage(planetViewer) as GamePackage;
export const surveyFixtureGame = validatePackage(surveyFixture) as GamePackage;

export const bundledGames: readonly GamePackage[] = Object.freeze([
  defaultGame,
  spaceSimSuccessorGame,
  orbitSandboxGame,
  orbitAcademyGame,
  flightStarterGame,
  planetViewerGame,
  surveyFixtureGame,
]);

/** Library organization only; independent of runtime adapters and archive formats. */
export function bundledGameCategory(id: string): 'game' | 'example' {
  const entry = catalog.games.find(g => g.id === id || g.alias === id || g.id === `builtin.${id}`);
  return (entry?.category as 'game' | 'example') ?? (id === 'builtin.flight-starter' || id === 'builtin.planet-viewer' || id === 'builtin.survey-fixture' ? 'example' : 'game');
}

/** Bundled descriptors are inert. A URL selects one composition, never code or a remote file. */
export function requestedBuiltinGame(search: string): GamePackage {
  const id = new URLSearchParams(search).get('game');
  if (!id) return defaultGame;
  const entry = catalog.games.find(g => g.id === id || g.alias === id || g.id === `builtin.${id}`);
  const targetId = entry?.id ?? id;
  return bundledGames.find(game => game.info.id === targetId || game.info.id === id || game.info.id === `builtin.${id}`) ?? defaultGame;
}

/** Explicit compatible host adapters. A transport never promotes the legacy Sandbox
 * model to the flight session protocol. Target plans separately select public services. */
export const bundledGameAdapters = new Map<string, 'flight' | 'legacy-sandbox' | 'static-viewer' | 'bounded-survey'>([
  ['builtin.space-sim', 'flight'],
  ['builtin.space-sim-successor', 'flight'],
  ['builtin.orbit-sandbox', 'legacy-sandbox'],
  ['builtin.orbit-academy', 'flight'],
  ['builtin.flight-starter', 'flight'],
  ['builtin.planet-viewer', 'static-viewer'],
  ['builtin.survey-fixture', 'bounded-survey'],
]);

/** Exact bundled definitions can round-trip through legacy game archives. An edited
 * archive cannot claim a trusted host adapter merely by copying its built-in ID. */
export function bundledGameDefinition(game: GamePackage): GamePackage | undefined {
  return bundledGames.find(builtin => builtin.info.id === game.info.id && canonicalJson(builtin) === canonicalJson(game));
}
