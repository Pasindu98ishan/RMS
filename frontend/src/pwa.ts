import { registerSW } from 'virtual:pwa-register'

/** Registers the service worker in production builds only (never alongside the MSW mock worker). */
export function registerPwa(): void {
  if (!import.meta.env.PROD) return
  registerSW({ immediate: true })
}
