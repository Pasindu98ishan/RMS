import { api, data } from './client'
import type { AuditExportQuery, AuditLogPage, AuditQuery } from './types'

export const auditApi = {
  search(query: AuditQuery) {
    return data<AuditLogPage>(api.GET('/audit-log', { params: { query } }))
  },
  /** Downloads the .xlsx; the file name comes from Content-Disposition. */
  async export(query: AuditExportQuery): Promise<{ blob: Blob; fileName: string }> {
    const { data: blob, response } = await api.GET('/audit-log/export', {
      params: { query },
      parseAs: 'blob',
    })
    const disposition = response.headers.get('content-disposition') ?? ''
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
    const fileName = match?.[1] ? decodeURIComponent(match[1]) : 'audit-log.xlsx'
    return { blob: blob ?? new Blob(), fileName }
  },
}
