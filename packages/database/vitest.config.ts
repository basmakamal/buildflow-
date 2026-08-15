import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /**
     * Integration tests share ONE database, so they must not run concurrently.
     *
     * Vitest parallelises test FILES by default. With a shared database, one
     * file's `beforeEach` truncation runs while another is mid-insert, and the
     * result is a foreign-key violation that looks like a code bug but is
     * purely a test-harness race — the worst kind of flake, because it sends
     * you debugging the wrong thing.
     *
     * Per-worker database schemas would allow parallelism, but at this suite
     * size the setup cost exceeds the seconds it would save.
     */
    fileParallelism: false,
    sequence: { concurrent: false },
    // Schema push plus argon2-free integration work; generous but bounded so a
    // hung connection fails rather than stalling CI.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
