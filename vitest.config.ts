import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'node', environment: 'node', include: ['tests/unit/**/*.test.ts', 'functions/tests/**/*.test.ts'] } },
      { test: { name: 'ui', environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], setupFiles: ['tests/setup-ui.ts'] } },
    ],
  },
});
