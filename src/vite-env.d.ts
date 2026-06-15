/** @fileoverview Vite client type declarations. */
/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** Defined by @tauri-apps/api or set to false by vite.config.ts in web mode. */
declare const __TAURI__: boolean | undefined
/** Defined by @tauri-apps/api internals or set to empty object in web mode. */
declare const __TAURI_INTERNALS__: Record<string, unknown> | undefined
