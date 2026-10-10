import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Tests always run against mocks — never real services.
    env: { MOCK_EXTERNAL: '1', TZ: 'UTC' },
    testTimeout: 20000,
    // PGlite (in-process Postgres) can take >10 s to boot when many test files run in parallel.
    hookTimeout: 60000,
  },
});
