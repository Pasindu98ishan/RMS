// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// Point the shared client (used by the api wrappers) at a test origin.
vi.stubEnv('VITE_API_BASE', 'http://rms.test/api/v1')
const BASE = 'http://rms.test/api/v1'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const { api } = await import('../client')
const { importApi } = await import('../importer')
const { terminalsApi } = await import('../terminals')
const { floorApi } = await import('../floor')

api.setAuthHooks({
  getAccessToken: () => 'tok',
  getTerminalId: () => 'term-1',
  canRefresh: () => false,
  refresh: async () => false,
  onSessionExpired: () => undefined,
})

const report = {
  importType: 'MENU_ITEMS',
  dryRun: true,
  ok: false,
  rowsRead: 2,
  counts: { created: 0, updated: 0, unchanged: 0 },
  errors: [{ row: 3, column: 'local_price', value: 'abc', message: "'abc' is not a number" }],
  errorsTruncated: false,
}

describe('import API (P1-IMP-01)', () => {
  it('uploads the file as multipart `file` with dryRun, and returns the report even when ok is false', async () => {
    let seen:
      { dryRun: string | null; name: string | null; text: string; contentType: string | null } | undefined
    server.use(
      http.post(`${BASE}/import/MENU_ITEMS`, async ({ request }) => {
        const form = await request.formData()
        const f = form.get('file') as File
        seen = {
          dryRun: new URL(request.url).searchParams.get('dryRun'),
          name: f.name,
          text: await f.text(),
          contentType: request.headers.get('content-type'),
        }
        return HttpResponse.json(report)
      }),
    )
    const file = new File(['code,name\nA1,x'], 'items.csv', { type: 'text/csv' })
    const res = await importApi.importFile('MENU_ITEMS', file, true)
    expect(seen?.dryRun).toBe('true')
    expect(seen?.name).toBe('items.csv')
    expect(seen?.text).toBe('code,name\nA1,x')
    expect(seen?.contentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(res.ok).toBe(false)
    expect(res.errors[0]).toMatchObject({ row: 3, column: 'local_price' })
  })

  it('downloads a template with the server file name', async () => {
    server.use(
      http.get(`${BASE}/import/TABLES/template`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('format')).toBe('XLSX')
        return new HttpResponse('x', {
          headers: {
            'Content-Disposition': 'attachment; filename="tables-template.xlsx"',
            'Content-Type': 'application/octet-stream',
          },
        })
      }),
    )
    const out = await importApi.template('TABLES', 'XLSX')
    expect(out.fileName).toBe('tables-template.xlsx')
  })
})

describe('terminal setup options (token-less)', () => {
  it('P1-AUTH-04 sends the owner credentials in the body and no bearer token', async () => {
    let auth: string | null = 'unset'
    let body: unknown
    server.use(
      http.post(`${BASE}/terminals/setup-options`, async ({ request }) => {
        auth = request.headers.get('authorization')
        body = await request.json()
        return HttpResponse.json({
          kitchenStations: [{ id: 's1', number: 1, name: 'Kitchen 1' }],
          orderingPoints: [],
        })
      }),
    )
    const out = await terminalsApi.setupOptions({ username: 'owner1', password: 'pw' })
    expect(auth).toBeNull()
    expect(body).toEqual({ username: 'owner1', password: 'pw' })
    expect(out.kitchenStations[0]?.name).toBe('Kitchen 1')
  })
})

describe('floor plan save', () => {
  it('P1-FLOOR-01 saves every moved table in one call, each with its version', async () => {
    let calls = 0
    let body: unknown
    server.use(
      http.put(`${BASE}/tables/positions`, async ({ request }) => {
        calls++
        body = await request.json()
        return HttpResponse.json([])
      }),
    )
    await floorApi.savePositions([
      { tableId: 't1', x: 100, y: 200, version: 3 },
      { tableId: 't2', x: 300, y: 400, version: 1 },
    ])
    expect(calls).toBe(1)
    expect(body).toEqual({
      positions: [
        { tableId: 't1', x: 100, y: 200, version: 3 },
        { tableId: 't2', x: 300, y: 400, version: 1 },
      ],
    })
  })
})
