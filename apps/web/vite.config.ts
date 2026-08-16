import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    /**
     * Array form with an EXACT regex for the package root.
     *
     * A plain string alias matches by prefix, so '@buildflow/ui/tokens.css'
     * would be rewritten to '<path-to-index.ts>/tokens.css' and fail to
     * resolve. Anchoring the pattern lets subpath imports fall through to the
     * package's own `exports` map, which is what should answer them.
     */
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      {
        find: /^@buildflow\/ui$/,
        replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
      },
      {
        find: /^@buildflow\/ui\/tokens\.css$/,
        replacement: fileURLToPath(
          new URL('../../packages/ui/src/tokens/tokens.css', import.meta.url),
        ),
      },
    ],
  },
  server: {
    // Honour an externally assigned port so the dev server can coexist with
    // others on the machine; falls back to Vite's default locally.
    port: process.env['PORT'] ? Number(process.env['PORT']) : 5173,
    proxy: {
      // The API runs separately; proxying keeps the browser same-origin so the
      // httpOnly refresh cookie is sent without CORS credential gymnastics.
      // 127.0.0.1 explicitly: 'localhost' can resolve to ::1 first, where a
      // DIFFERENT app may be listening — exactly what happened in development.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
})
