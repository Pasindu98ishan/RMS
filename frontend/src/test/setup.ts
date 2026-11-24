import { afterEach, beforeEach } from 'vitest'

// Some test files run in the node environment (multipart uploads need Node's FormData), so every
// browser global is guarded.
// jsdom has no matchMedia; PrimeVue overlays (Select, Dialog) call it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

// jsdom has no ResizeObserver; PrimeVue's auto-resize Textarea uses it on mount.
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear()
})

afterEach(() => {
  if (typeof document !== 'undefined') document.body.innerHTML = ''
})
