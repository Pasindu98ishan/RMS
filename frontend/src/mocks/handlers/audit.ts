import { HttpResponse } from 'msw'
import type { AuditEntry } from '@/api/types'
import { colomboDate, formatDateTime } from '@/utils/time'
import { audit, db, persist } from '../db'
import { http, latency, mustCaller, paginate, parseSort, problem, validation } from '../http'

interface Filters {
  from: string | null
  to: string | null
  userId: string | null
  action: string | null
  entityType: string | null
  entityId: string | null
}

function filtered(f: Filters): AuditEntry[] | Response {
  if (f.from && f.to && f.to < f.from) {
    return validation([{ field: 'to', message: 'The end date must not be before the start date' }])
  }
  return db.audit.filter((e) => {
    const day = colomboDate(new Date(e.at))
    if (f.from && day < f.from) return false
    if (f.to && day > f.to) return false
    if (f.userId && e.user?.id !== f.userId) return false
    if (f.action && e.action !== f.action) return false
    if (f.entityType && e.entityType !== f.entityType) return false
    if (f.entityId && e.entityId !== f.entityId) return false
    return true
  })
}

function filtersOf(q: { get(name: string): string | null }): Filters {
  return {
    from: q.get('from'),
    to: q.get('to'),
    userId: q.get('userId'),
    action: q.get('action'),
    entityType: q.get('entityType'),
    entityId: q.get('entityId'),
  }
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const auditHandlers = [
  http.get('/audit-log', async ({ query, response }) => {
    await latency()
    const sort = parseSort(query.get('sort'), ['at'], 'at,desc')
    if (!sort) return response.untyped(problem(400, 'MALFORMED_REQUEST', 'Unknown sort field.'))
    const rows = filtered(filtersOf(query as unknown as URLSearchParams))
    if (rows instanceof Response) return response.untyped(rows)
    const sorted = rows.slice().sort((a, b) => a.at.localeCompare(b.at) * sort.dir)
    const page = paginate(sorted, query.get('page'), query.get('size'))
    if (!page) return response.untyped(problem(400, 'MALFORMED_REQUEST', 'Bad page or size.'))
    return response(200).json(page)
  }),

  http.get('/audit-log/export', async ({ request, query, response }) => {
    await latency()
    const c = mustCaller(request)
    const f = filtersOf(query as unknown as URLSearchParams)
    const rows = filtered(f)
    if (rows instanceof Response) return response.untyped(rows)
    if (rows.length > 50_000) {
      return response.untyped(
        problem(422, 'EXPORT_TOO_LARGE', 'More than 50,000 rows match. Narrow the filters and try again.'),
      )
    }
    const header = [
      'Time (Asia/Colombo)',
      'User',
      'Terminal',
      'Action',
      'Entity',
      'Entity id',
      'Reason',
      'Before',
      'After',
    ]
    const lines = rows
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((e) =>
        [
          formatDateTime(e.at),
          e.user?.username ?? e.username ?? '',
          e.terminal?.name ?? '',
          e.action,
          e.entityType,
          e.entityId ?? '',
          e.reason ?? '',
          e.before ?? '',
          e.after ?? '',
        ]
          .map(csvCell)
          .join(','),
      )
    audit('AUDIT_EXPORTED', 'AUDIT_LOG', {
      actor: c.user,
      terminal: c.terminal,
      after: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null)),
    })
    persist()
    // The real server sends .xlsx; the mock sends CSV and names it so (no spreadsheet library in the browser).
    const name = `audit-log-${f.from ?? 'all'}_${f.to ?? colomboDate()}-MOCK.csv`
    return response.untyped(
      new HttpResponse([header.join(','), ...lines].join('\r\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${name}"` },
      }),
    )
  }),
]
