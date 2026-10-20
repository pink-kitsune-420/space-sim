/** Host-only shipped module catalogue (`packages/game-library`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); authors pass a catalogue file to `npm run module:validate` with `--catalogue=`. */
import { keys, moduleId, object, version } from '../../game-runtime/src/validation';

/** One shipped module pin: `builtin.*` ID, exact version and package integrity digest. Host-only (`packages/game-library`). */
export interface ShippedModulePin {
  readonly id: string;
  readonly version: string;
  /** Canonical verified package inventory digest, including editable source/assets. */
  readonly digest: string;
}
/** Host-supplied build inventory, never read from an imported archive's claims.
 * Recognition permits a reserved identity; it never approves executable code. */
export class ShippedModuleCatalogue {
  readonly #pins = new Set<string>();
  constructor(entries: readonly ShippedModulePin[]) {
    if (!Array.isArray(entries) || entries.length > 4096) throw new Error('Invalid shipped module catalogue');
    for (const entry of entries) {
      keys(object(entry, 'Shipped pin'), ['id', 'version', 'digest'], 'Shipped pin');
      const id = moduleId(entry.id, 'Shipped module ID'), exact = version(entry.version, 'Shipped module version');
      if (!id.startsWith('builtin.') || id === 'builtin.engine' || !/^[0-9a-f]{64}$/.test(entry.digest))
        throw new Error('Shipped pins require a builtin module identity and exact digest');
      const key = `${id}@${exact}:${entry.digest}`;
      if (this.#pins.has(key)) throw new Error(`Duplicate shipped module pin ${id}@${exact}`);
      this.#pins.add(key);
    }
    Object.freeze(this);
  }
  recognizes(id: string, exact: string, digest: string): boolean { return this.#pins.has(`${id}@${exact}:${digest}`); }
}

/** Parses a `spacelab-shipped-modules/1` catalogue of at most 4,096 pins. Host-only (`packages/game-library`). */
export function parseShippedCatalogue(raw: unknown): ShippedModuleCatalogue {
  const inventory = object(raw, 'Shipped catalogue'); keys(inventory, ['format', 'modules'], 'Shipped catalogue');
  if (inventory.format !== 'spacelab-shipped-modules/1') throw new Error('Unsupported shipped catalogue format');
  return new ShippedModuleCatalogue(inventory.modules as readonly ShippedModulePin[]);
}

/** Inspection option: the catalogue that may recognise `builtin.*` package identities. Without a matching pin, inspection fails with `Imported builtin identities require an exact shipped catalogue pin; fork under a creator namespace`. Host-only (`packages/game-library`). */
export interface ShippedPackageOptions { readonly shipped?: ShippedModuleCatalogue }
