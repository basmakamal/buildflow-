/// <reference types="vite/client" />

/**
 * Declares `.vue` files to TypeScript.
 *
 * Without this, `import App from './App.vue'` resolves to `any`, which then
 * propagates silently through `createApp(App)` — and typed-lint correctly
 * flags it as an unsafe argument. The shim is what makes SFC imports typed
 * rather than merely tolerated.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
