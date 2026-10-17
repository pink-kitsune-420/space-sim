import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['apps/orbit-sandbox/tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@spacelab/sim-core': resolve(rootDir, '../../packages/sim-core/src/index.ts'),
      '@spacelab/game-api': resolve(rootDir, '../../packages/game-api/src/index.ts'),
      '@spacelab/render-2d': resolve(rootDir, '../../packages/render-2d/src/index.ts'),
      '@spacelab/game-library': resolve(rootDir, '../../packages/game-library/src/index.ts'),
    },
  },
});
