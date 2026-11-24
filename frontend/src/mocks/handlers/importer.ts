import { HttpResponse } from 'msw'
import { IMPORT_TYPES, type ImportType } from '@/api/types'
import { audit, db, persist } from '../db'
import { http, latency, mustCaller, problem, validation } from '../http'
import { runImport, templateCsv } from '../importer'

const isType = (v: string): v is ImportType => (IMPORT_TYPES as readonly string[]).includes(v)

export const importHandlers = [
  http.get('/import/{importType}/template', async ({ params, query, response }) => {
    await latency()
    if (!isType(params.importType)) return response.untyped(problem(404, 'NOT_FOUND', 'Unknown import type.'))
    const name = `${params.importType.toLowerCase()}-template`
    // The real server sends .xlsx for XLSX; the mock only has CSV, so it always sends CSV and names it so.
    const note = query.get('format') === 'XLSX' ? '-MOCK' : ''
    return response.untyped(
      new HttpResponse(templateCsv(params.importType), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${name}${note}.csv"`,
        },
      }),
    )
  }),

  http.post('/import/{importType}', async ({ params, request, query, response }) => {
    await latency()
    const c = mustCaller(request)
    if (!isType(params.importType)) return response.untyped(problem(404, 'NOT_FOUND', 'Unknown import type.'))
    const type = params.importType
    const dryRun = query.get('dryRun') === 'true'
    let file: File | null = null
    try {
      const form = await request.formData()
      const f = form.get('file')
      file = f instanceof File ? f : null
    } catch {
      file = null
    }
    if (!file)
      return response.untyped(
        validation([{ field: 'file', message: 'Choose a .csv or .xlsx file to import' }]),
      )
    if (file.size > 5 * 1024 * 1024) {
      return response.untyped(problem(422, 'IMPORT_FILE_TOO_LARGE', 'The file is larger than 5 MB.'))
    }
    if (/\.xlsx$/i.test(file.name)) {
      return response(200).json({
        importType: type,
        dryRun,
        ok: false,
        rowsRead: 0,
        counts: { created: 0, updated: 0, unchanged: 0 },
        errors: [
          { message: 'The mock server reads .csv files only. Save the sheet as CSV (UTF-8) and try again.' },
        ],
        errorsTruncated: false,
      })
    }
    const report = runImport(type, await file.text(), dryRun, db)
    if (report.ok && !dryRun) {
      audit('DATA_IMPORTED', 'IMPORT', {
        actor: c.user,
        terminal: c.terminal,
        after: { type, ...report.counts },
      })
    }
    persist()
    return response(200).json(report)
  }),
]
