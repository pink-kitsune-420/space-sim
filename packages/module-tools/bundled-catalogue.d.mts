// Host-side build tooling (Vite only). Modules cannot import packages/module-tools.
import type { Plugin } from 'vite';
/**
 * Vite plugin that serves `virtual:spacelab-bundled-modules`: a sorted list of
 * `{ id, name, version, tier, environments, description, folder }` for every folder in
 * `<root>/modules/`, read from each `module.json` and the `summary` of its first
 * `docs/creators/` guide (or first guide). Reads metadata only and registers the files for
 * watch mode; it never bundles source, inspects archives or runs module code.
 * @param root Checkout root; defaults to the repository containing this file.
 * @throws Error ("Invalid or duplicate bundled module: <folder>") when a manifest has no ID or
 *   two folders share one, failing the build.
 */
export function bundledCataloguePlugin(root?: string): Plugin;
