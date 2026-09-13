import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    name: 'firebase-emulator-mock',
    environment: 'node',
    include: ['tests/emulator/**/*.emulator.test.ts'],
    setupFiles: ['tests/emulator/setup.ts'],
    // Rules fixtures clear this demo-only database; never run files in parallel.
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
