/** Host-only multi-game catalog parser and validator (`packages/game-library`). */
import { freezeJson, keys, moduleId, object, string } from '../../game-runtime/src/validation';

/** Individual game entry in the multi-game catalog manifest. */
export interface GameCatalogEntry {
  readonly id: string;
  readonly alias: string;
  readonly name: string;
  readonly description: string;
  readonly category: 'game' | 'example';
  readonly adapter: 'flight' | 'legacy-sandbox' | 'static-viewer' | 'bounded-survey';
  readonly path: string;
  readonly defaultUniverse?: string;
}

/** Authoritative multi-game catalog (`space-lab-game-catalog/1`). */
export interface GameCatalog {
  readonly format: 'space-lab-game-catalog/1';
  readonly defaultGame: string;
  readonly games: readonly GameCatalogEntry[];
}

const VALID_CATEGORIES = new Set<string>(['game', 'example']);
const VALID_ADAPTERS = new Set<string>(['flight', 'legacy-sandbox', 'static-viewer', 'bounded-survey']);
const ALIAS_PATTERN = /^[a-z0-9-]+$/;

/** Validates and freezes an authoritative multi-game catalog (`space-lab-game-catalog/1`). */
export function validateGameCatalog(raw: unknown): GameCatalog {
  const value = object(raw, 'Game catalog');
  keys(value, ['format', 'defaultGame', 'games', '$schema'], 'Game catalog');
  if (value.format !== 'space-lab-game-catalog/1') {
    throw new Error('Unsupported game catalog format');
  }
  const defaultGame = moduleId(value.defaultGame, 'Default game ID');
  if (!Array.isArray(value.games) || value.games.length === 0 || value.games.length > 256) {
    throw new Error('Game catalog: expected non-empty list of at most 256 games');
  }

  const games: GameCatalogEntry[] = [];
  const ids = new Set<string>();
  const aliases = new Set<string>();

  for (const entryRaw of value.games) {
    const entry = object(entryRaw, 'Game catalog entry');
    keys(entry, ['id', 'alias', 'name', 'description', 'category', 'adapter', 'path', 'defaultUniverse'], 'Game catalog entry');
    const id = moduleId(entry.id, 'Game catalog entry ID');
    const alias = string(entry.alias, 'Game catalog entry alias');
    if (!ALIAS_PATTERN.test(alias)) {
      throw new Error(`Game catalog entry alias ${alias}: expected lowercase alphanumeric and hyphens`);
    }
    const name = string(entry.name, 'Game catalog entry name');
    if (typeof entry.description !== 'string' || entry.description.length > 4096) {
      throw new Error('Game catalog entry description: expected string of at most 4096 characters');
    }
    const category = entry.category as string;
    if (!VALID_CATEGORIES.has(category)) {
      throw new Error(`Game catalog entry category: expected 'game' or 'example', got '${category}'`);
    }
    const adapter = entry.adapter as string;
    if (!VALID_ADAPTERS.has(adapter)) {
      throw new Error(`Game catalog entry adapter: invalid adapter '${adapter}'`);
    }
    const path = string(entry.path, 'Game catalog entry path');
    if (path.startsWith('/') || path.includes('..') || !path.endsWith('.json')) {
      throw new Error(`Game catalog entry path: invalid path '${path}'`);
    }
    let defaultUniverse: string | undefined;
    if (entry.defaultUniverse !== undefined) {
      defaultUniverse = string(entry.defaultUniverse, 'Game catalog entry defaultUniverse');
      if (defaultUniverse.startsWith('/') || defaultUniverse.includes('..')) {
        throw new Error(`Game catalog entry defaultUniverse: invalid path '${defaultUniverse}'`);
      }
    }

    if (ids.has(id)) {
      throw new Error(`Duplicate game ID in catalog: ${id}`);
    }
    ids.add(id);

    if (aliases.has(alias)) {
      throw new Error(`Duplicate game alias in catalog: ${alias}`);
    }
    aliases.add(alias);

    games.push({
      id,
      alias,
      name,
      description: entry.description,
      category: category as 'game' | 'example',
      adapter: adapter as 'flight' | 'legacy-sandbox' | 'static-viewer' | 'bounded-survey',
      path,
      ...(defaultUniverse ? { defaultUniverse } : {}),
    });
  }

  if (!ids.has(defaultGame)) {
    throw new Error(`Default game ID '${defaultGame}' not found in catalog games`);
  }

  return freezeJson({
    format: 'space-lab-game-catalog/1',
    defaultGame,
    games,
  });
}
