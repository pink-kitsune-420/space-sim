import { defineConfig } from 'vite';

export default defineConfig({
  define: { __SPACE_SIM_ALLOW_RUNTIME_CODE__: JSON.stringify(process.env.SPACE_SIM_ALLOW_RUNTIME_CODE !== 'false') },
  root: 'apps/web',
  base: './',
  // One chunk and no dynamic imports: the preload polyfill would be the only third-party
  // code in the shipped game, so leave it out to keep shipped code 100% first-party.
  build: { outDir: '../../dist', emptyOutDir: true, modulePreload: { polyfill: false } },
});
