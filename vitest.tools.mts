import { defineConfig } from 'vitest/config';

// Analysis tools that run through Vitest (TypeScript, no build step).
export default defineConfig({
  test: { include: ['tests/tools/**/*.tool.ts'], environment: 'node', testTimeout: 600_000 },
});
