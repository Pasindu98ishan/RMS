import { getResponse } from 'msw'
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'
import { db, expireAccessTokens, resetDb } from './db'
import { seedTerminals } from './seed'

export const worker = setupWorker(...handlers)

declare global {
  interface Window {
    /** Dev helpers for the mock backend (console). */
    rmsMock?: {
      reset(): void
      expireAccessTokens(): void
      db: typeof db
    }
  }
}

export async function startMocks(): Promise<void> {
  try {
    await worker.start({
      onUnhandledRequest(request, print) {
        if (new URL(request.url).pathname.startsWith('/api/')) print.warning()
      },
      quiet: false,
    })
  } catch (e) {
    // Some embedded browsers refuse service workers; answer /api calls in-page with the same handlers.
    console.warn('[rms] MSW service worker unavailable, using in-page fetch mocks instead.', e)
    installFetchFallback()
  }
  window.rmsMock = { reset: resetDb, expireAccessTokens, db }
  console.info('[rms] Mock API active (VITE_USE_MOCKS). rmsMock.reset() restores the seed data.')
}

function installFetchFallback(): void {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (!new URL(request.url).pathname.startsWith('/api/')) return realFetch(input, init)
    const response = await getResponse(handlers, request)
    return response ?? new Response(null, { status: 404 })
  }
}

/** Seeded terminals the mock tools on /setup/terminal can adopt (device token included). */
export function seededTerminals() {
  const live = new Map(db.terminals.map((t) => [t.id, t]))
  return seedTerminals()
    .map((t) => live.get(t.id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t && t.active))
}
