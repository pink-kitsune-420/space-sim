import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  base: './',
  resolve: {
    alias: {
      '@space-sim/game-api': resolve(rootDir, '../../packages/game-api/src/index.ts'),
      '@spacelab/sim-core': resolve(rootDir, '../../packages/sim-core/src/index.ts'),
      '@spacelab/game-api': resolve(rootDir, '../../packages/game-api/src/index.ts'),
      '@spacelab/render-2d': resolve(rootDir, '../../packages/render-2d/src/index.ts'),
      '@spacelab/game-library': resolve(rootDir, '../../packages/game-library/src/index.ts'),
    },
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
  },
  build: {
    outDir: '../../dist-orbit-sandbox',
    emptyOutDir: true,
  },
});
