// Host-side static checks (Node only). Modules cannot import packages/module-tools.
// This is an authoring boundary check, not a security sandbox.
/**
 * Lists the import-boundary violations in one source file. A module folder may import
 * `@space-sim/game-api`, the public game-api entry point and files inside its own folder;
 * a small fixed list of host bridge files may import named private paths. Computed specifiers
 * and import assignments are rejected. Source is parsed, never executed.
 * @param source File text.
 * @param path Checkout-relative path with `/` separators; selects the folder rules.
 * @returns One "<path>: …" message per violation (or parse error); empty when clean.
 */
export function checkSource(source: string, path: string): string[];
/**
 * Runs {@link checkSource} on every `.ts` and `.mjs` file under `packages/game-api/src`,
 * `packages/game-runtime/src`, `packages/modules/src`, `examples/modules`, `examples/packages`
 * and `modules`. First half of `npm run check:modules`; reads files only.
 * @returns The number of sources checked.
 * @throws Error listing every violation, one per line.
 */
export function checkBoundaries(): Promise<number>;
/**
 * Checkout-relative paths that a runtime import of `entry` loads, following static relative
 * imports and re-exports and skipping type-only ones. Used by tests to keep headless graphs
 * free of renderer, browser and presentation code. Reads files only.
 * @param entry Checkout-relative path of the starting file.
 * @throws Error ("<path>: cannot resolve <specifier>") when a relative import has no file.
 */
export function reachable(entry: string): Promise<Set<string>>;
