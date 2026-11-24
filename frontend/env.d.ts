/// <reference types="vite/client" />

/** True when the app runs against the openapi-msw mocks (VITE_USE_MOCKS=true or `--mode mock`). */
declare const __RMS_USE_MOCKS__: boolean

interface ImportMetaEnv {
  readonly VITE_USE_MOCKS?: string
  /** API base path; defaults to /api/v1 (same origin, proxied by Vite in dev and nginx in prod). */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
