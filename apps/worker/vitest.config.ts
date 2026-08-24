import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Integration tests share one database — see packages/database/vitest.config.ts
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
