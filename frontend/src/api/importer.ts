import { api, data } from './client'
import type { ImportFileFormat, ImportReport, ImportType } from './types'

export const importApi = {
  /** Downloads the template; the file name comes from Content-Disposition. */
  async template(
    importType: ImportType,
    format: ImportFileFormat,
  ): Promise<{ blob: Blob; fileName: string }> {
    const { data: blob, response } = await api.GET('/import/{importType}/template', {
      params: { path: { importType }, query: { format } },
      parseAs: 'blob',
    })
    const disposition = response.headers.get('content-disposition') ?? ''
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
    const fileName = match?.[1]
      ? decodeURIComponent(match[1])
      : `${importType.toLowerCase()}-template.${format.toLowerCase()}`
    return { blob: blob ?? new Blob(), fileName }
  },

  /**
   * Uploads a .csv / .xlsx. Always 200 with an ImportReport: check `ok`. With dryRun nothing is
   * saved. All rows are checked first; any error means nothing is imported (P1-IMP-01).
   */
  importFile(importType: ImportType, file: File, dryRun: boolean) {
    return data<ImportReport>(
      api.POST('/import/{importType}', {
        params: { path: { importType }, query: { dryRun } },
        // The generated type has `file: string` (binary); the serializer sends the real File.
        body: { file: '' },
        bodySerializer: () => {
          const form = new FormData()
          form.append('file', file, file.name)
          return form
        },
      }),
    )
  },
}
