<script setup lang="ts">
/**
 * /admin/import - spreadsheet import with a validation report (P1-IMP-01). "Check file" is a dry
 * run; "Import" saves for real. All rows are checked first: any error means nothing is imported.
 * Import categories and modifier groups before the menu items that refer to them by name.
 */
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import { importApi } from '@/api/importer'
import {
  IMPORT_TYPE_LABEL,
  IMPORT_TYPES,
  type ImportFileFormat,
  type ImportReport,
  type ImportType,
} from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'

const notify = useNotify()
const importType = ref<ImportType>('CATEGORIES')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const report = ref<ImportReport | null>(null)
/** The check that the current file + type passed (Import is enabled only then). */
const checkedOk = ref(false)
const done = ref<ImportReport | null>(null)

const MAX_BYTES = 5 * 1024 * 1024

const fileError = computed(() => {
  const f = file.value
  if (!f) return null
  if (!/\.(csv|xlsx)$/i.test(f.name)) return 'Choose a .csv or .xlsx file.'
  if (f.size > MAX_BYTES) return 'The file is larger than 5 MB.'
  return null
})

function reset() {
  report.value = null
  checkedOk.value = false
  done.value = null
}

function onFile(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null
  reset()
}

function onType() {
  reset()
}

function clearFile() {
  file.value = null
  if (fileInput.value) fileInput.value.value = ''
  reset()
}

const downloading = ref<ImportFileFormat | null>(null)
async function template(format: ImportFileFormat) {
  downloading.value = format
  try {
    const { blob, fileName } = await importApi.template(importType.value, format)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (e) {
    notify.error(e, 'Could not download the template')
  } finally {
    downloading.value = null
  }
}

const runner = useAction(async (dryRun: boolean) => {
  const res = await importApi.importFile(importType.value, file.value as File, dryRun)
  return { res, dryRun }
})

async function run(dryRun: boolean) {
  if (!file.value || fileError.value) return
  try {
    const out = await runner.run(dryRun)
    if (!out) return
    report.value = out.res
    if (dryRun) {
      checkedOk.value = out.res.ok
      done.value = null
    } else {
      checkedOk.value = false
      if (out.res.ok) {
        done.value = out.res
        notify.success('Import finished', summary(out.res))
      }
    }
  } catch (e) {
    notify.error(e, dryRun ? 'Could not check the file' : 'Import failed')
  }
}

const summary = (r: ImportReport) =>
  `${r.counts.created} created, ${r.counts.updated} updated, ${r.counts.unchanged} unchanged`

const location = (row: number | undefined, column: string | undefined) =>
  [row !== undefined ? `row ${row}` : '', column ?? ''].filter(Boolean).join(', ')
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>Import from a spreadsheet</h1>
    </div>

    <div class="banner banner-info" data-testid="import-order-note">
      <i class="pi pi-info-circle" aria-hidden="true" />
      <span>
        Import in this order: <strong>categories</strong> and <strong>modifier groups</strong> first, then
        <strong>menu items</strong> (they refer to categories and groups by name), and
        <strong>tables</strong> any time. Re-importing a row with the same name or code updates it; nothing is
        duplicated or deleted.
      </span>
    </div>

    <section class="card steps">
      <div class="field">
        <label for="import-type">1. What is in the file?</label>
        <select
          id="import-type"
          v-model="importType"
          class="native-select"
          data-testid="import-type"
          @change="onType"
        >
          <option v-for="t in IMPORT_TYPES" :key="t" :value="t">{{ IMPORT_TYPE_LABEL[t] }}</option>
        </select>
      </div>

      <div class="field">
        <span class="label">2. Get the template (optional)</span>
        <div class="row">
          <Button
            label="Download CSV template"
            icon="pi pi-download"
            size="small"
            outlined
            :loading="downloading === 'CSV'"
            data-testid="import-template-csv"
            @click="template('CSV')"
          />
          <Button
            label="Download Excel template"
            icon="pi pi-file-excel"
            size="small"
            outlined
            :loading="downloading === 'XLSX'"
            data-testid="import-template-xlsx"
            @click="template('XLSX')"
          />
        </div>
        <span class="hint"
          >First row is the header. UTF-8 text; money with 2 decimals and no thousands separators.</span
        >
        <p class="hint reimport" data-testid="import-reimport-note">
          Re-importing an item or table that already exists updates it from the file: a
          <strong>blank optional cell clears</strong> the existing value (for example, a blank
          <code>foreign_price</code> removes the foreign price). If a column is
          <strong>left out of the file</strong>, the value is kept: <code>active</code> stays as it is, and
          table positions on the floor plan are never changed by an import.
        </p>
      </div>

      <div class="field">
        <label for="import-file">3. Choose the file (.csv or .xlsx, up to 5 MB)</label>
        <input
          id="import-file"
          ref="fileInput"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="native-input file"
          data-testid="import-file"
          @change="onFile"
        />
        <p v-if="fileError" class="field-error" data-testid="import-file-error">{{ fileError }}</p>
      </div>

      <div class="row actions">
        <Button
          label="Check file"
          icon="pi pi-search"
          :loading="runner.busy.value"
          :disabled="!file || Boolean(fileError) || runner.busy.value"
          data-testid="import-check"
          @click="run(true)"
        />
        <Button
          label="Import"
          icon="pi pi-upload"
          severity="success"
          :loading="runner.busy.value"
          :disabled="!checkedOk || runner.busy.value"
          data-testid="import-run"
          @click="run(false)"
        />
        <Button
          v-if="file"
          label="Clear"
          text
          severity="secondary"
          data-testid="import-clear"
          @click="clearFile"
        />
      </div>
      <span class="hint"
        >"Check file" reads every row and reports problems without saving anything. "Import" unlocks after a
        clean check.</span
      >
    </section>

    <section v-if="report" class="card report" data-testid="import-report" :class="report.ok ? 'ok' : 'bad'">
      <header class="rhead">
        <i :class="report.ok ? 'pi pi-check-circle' : 'pi pi-times-circle'" aria-hidden="true" />
        <div>
          <h2 data-testid="import-result">
            <template v-if="report.ok && done">Imported</template>
            <template v-else-if="report.ok">File is OK - ready to import</template>
            <template v-else>Nothing was imported - fix the problems below</template>
          </h2>
          <p class="muted small">
            {{ IMPORT_TYPE_LABEL[report.importType] }} - {{ report.rowsRead }} row{{
              report.rowsRead === 1 ? '' : 's'
            }}
            read
            <template v-if="report.dryRun"> (check only, nothing saved)</template>
          </p>
        </div>
      </header>

      <ul v-if="report.ok" class="counts" data-testid="import-counts">
        <li>
          <strong data-testid="import-count-created">{{ report.counts.created }}</strong>
          {{ report.dryRun ? 'would be created' : 'created' }}
        </li>
        <li>
          <strong data-testid="import-count-updated">{{ report.counts.updated }}</strong>
          {{ report.dryRun ? 'would be updated' : 'updated' }}
        </li>
        <li>
          <strong data-testid="import-count-unchanged">{{ report.counts.unchanged }}</strong> unchanged
        </li>
      </ul>

      <div v-if="report.errors.length" class="table-wrap">
        <table class="rtable" data-testid="import-errors">
          <thead>
            <tr>
              <th>Row</th>
              <th>Column</th>
              <th>Value</th>
              <th>Problem</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in report.errors" :key="i" data-testid="import-error-row">
              <td data-label="Row">{{ e.row ?? '-' }}</td>
              <td data-label="Column" class="mono">{{ e.column ?? '-' }}</td>
              <td data-label="Value" class="mono">{{ e.value ?? '' }}</td>
              <td data-label="Problem">
                <span class="sr-only">{{ location(e.row, e.column) }}: </span>{{ e.message }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="report.errorsTruncated" class="banner banner-warn" data-testid="import-truncated">
        <i class="pi pi-exclamation-triangle" aria-hidden="true" />
        Only the first 200 problems are shown. Fix these and check the file again.
      </p>
    </section>
  </div>
</template>

<style scoped>
.steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 760px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.file {
  padding: 8px;
}

.report {
  max-width: 960px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.report.ok {
  border-color: #b7e2c5;
}

.report.bad {
  border-color: #f3b8b2;
}

.rhead {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.rhead i {
  font-size: 1.6rem;
}

.report.ok .rhead i {
  color: var(--rms-ok);
}

.report.bad .rhead i {
  color: var(--rms-danger);
}

.rhead h2 {
  font-size: 1.1rem;
  margin: 0;
}

.rhead p {
  margin: 2px 0 0;
}

.counts {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0;
  padding: 0;
}
</style>
