import { defineConfig } from 'vite';
import { starterProductsPlugin } from './scripts/starter-products-plugin.mjs';
import { fileURLToPath } from 'node:url';
import { bundledCataloguePlugin } from './packages/module-tools/bundled-catalogue.mjs';
import { buildDefines } from './scripts/build_info.mjs';

export default defineConfig(({command}) => ({
  plugins: [bundledCataloguePlugin(), starterProductsPlugin()],
  resolve: { alias: { '@space-sim/game-api': fileURLToPath(new URL('./packages/game-api/src/index.ts', import.meta.url)) } },
  define: buildDefines(command === 'serve'),
  root: 'apps/web',
  base: './',
  // One chunk and no dynamic imports: the preload polyfill would be the only third-party
  // code in the shipped game, so leave it out to keep shipped code 100% first-party.
  build: { outDir: '../../dist', emptyOutDir: true, modulePreload: { polyfill: false } },
}));
