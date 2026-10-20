import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@space-sim/game-api': fileURLToPath(new URL('./packages/game-api/src/index.ts', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.heavy.test.ts'],
    environment: 'node',
    pool: 'threads',
    testTimeout: 240_000,
    hookTimeout: 30_000,
  },
});
