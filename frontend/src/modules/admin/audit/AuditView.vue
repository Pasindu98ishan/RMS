<script setup lang="ts">
/** /admin/audit - audit log search, paging and Excel export (P1-AUD-03). Read-only by design (P1-AUD-02). */
import { computed, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import { auditApi } from '@/api/audit'
import { usersApi } from '@/api/users'
import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditEntry,
  type AuditLogPage,
  type UserOption,
} from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'
import { formatDateTime } from '@/utils/time'

const PAGE_SIZE = 50
const ENTITY_TYPES = [
  'USER',
  'ROLE',
  'TERMINAL',
  'SETTING',
  'SERVICE_CHARGE_RULE',
  'AUTH_SESSION',
  'AUDIT_LOG',
]

const notify = useNotify()

const from = ref('')
const to = ref('')
const userId = ref('')
const action = ref<AuditAction | ''>('')
const entityType = ref('')
const entityId = ref('')
const page = ref(0)
const result = ref<AuditLogPage | null>(null)
const users = ref<UserOption[]>([])
const expanded = ref<Set<string>>(new Set())

const filters = computed(() => ({
  ...(from.value ? { from: from.value } : {}),
  ...(to.value ? { to: to.value } : {}),
  ...(userId.value ? { userId: userId.value } : {}),
  ...(action.value ? { action: action.value } : {}),
  ...(entityType.value.trim() ? { entityType: entityType.value.trim().toUpperCase() } : {}),
  ...(entityId.value.trim() ? { entityId: entityId.value.trim() } : {}),
}))

const rangeError = computed(() =>
  from.value && to.value && to.value < from.value ? 'The end date is before the start date.' : null,
)

const searcher = useAction(async () => {
  result.value = await auditApi.search({
    ...filters.value,
    page: page.value,
    size: PAGE_SIZE,
    sort: 'at,desc',
  })
  expanded.value = new Set()
})

async function search(resetPage = true) {
  if (rangeError.value) return
  if (resetPage) page.value = 0
  await searcher.run().catch((e) => notify.error(e, 'Could not search the audit log'))
}

onMounted(async () => {
  // GET /users/options needs only AUDIT_VIEW and includes deactivated users (they stay in the log).
  const [, options] = await Promise.all([search(), usersApi.options().catch(() => null)])
  if (options) users.value = options
  else notify.info('User filter unavailable', 'The user list could not be loaded.')
})

const totalPages = computed(() =>
  result.value ? Math.max(1, Math.ceil(result.value.totalItems / PAGE_SIZE)) : 1,
)
function goPage(p: number) {
  page.value = p
  void search(false)
}

function clearFilters() {
  from.value = to.value = userId.value = entityType.value = entityId.value = ''
  action.value = ''
  void search()
}

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

const who = (e: AuditEntry) => e.user?.fullName ?? (e.username ? `${e.username} (unknown user)` : 'System')
const hasDetail = (e: AuditEntry) => Boolean(e.before || e.after || e.approver || e.entityId || e.clientInfo)
/** Terminal name; a user action without a terminal came from a personal session (ADR-008); none at all = system. */
const where = (e: AuditEntry) => e.terminal?.name ?? (e.user ? 'Personal' : '-')
const pretty = (v: unknown) => JSON.stringify(v, null, 2)

const exporter = useAction(async () => {
  const { blob, fileName } = await auditApi.export(filters.value)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return fileName
})
async function exportXlsx() {
  if (rangeError.value) return
  try {
    const name = await exporter.run()
    if (name) notify.success('Export ready', name)
  } catch (e) {
    notify.error(e, 'Export failed')
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>Audit log</h1>
      <Button
        label="Export to Excel"
        icon="pi pi-file-excel"
        outlined
        :loading="exporter.busy.value"
        :disabled="exporter.busy.value || Boolean(rangeError)"
        data-testid="audit-export"
        @click="exportXlsx"
      />
    </div>

    <form class="card filters" novalidate @submit.prevent="search()">
      <div class="field">
        <label for="audit-from">From</label>
        <input id="audit-from" v-model="from" type="date" class="native-input" data-testid="audit-from" />
      </div>
      <div class="field">
        <label for="audit-to">To</label>
        <input id="audit-to" v-model="to" type="date" class="native-input" data-testid="audit-to" />
      </div>
      <div v-if="users.length" class="field">
        <label for="audit-user">User</label>
        <select id="audit-user" v-model="userId" class="native-select" data-testid="audit-user">
          <option value="">Anyone</option>
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.fullName }} ({{ u.username }})</option>
        </select>
      </div>
      <div class="field">
        <label for="audit-action">Action</label>
        <select id="audit-action" v-model="action" class="native-select" data-testid="audit-action">
          <option value="">Any action</option>
          <option v-for="a in AUDIT_ACTIONS" :key="a" :value="a">{{ a }}</option>
        </select>
      </div>
      <div class="field">
        <label for="audit-entity">Record type</label>
        <input
          id="audit-entity"
          v-model="entityType"
          class="native-input"
          list="audit-entity-types"
          placeholder="e.g. USER"
          autocapitalize="characters"
          data-testid="audit-entity"
        />
        <datalist id="audit-entity-types">
          <option v-for="t in ENTITY_TYPES" :key="t" :value="t" />
        </datalist>
      </div>
      <div class="field">
        <label for="audit-entity-id">Record id</label>
        <input
          id="audit-entity-id"
          v-model="entityId"
          class="native-input"
          maxlength="100"
          data-testid="audit-entity-id"
        />
      </div>
      <div class="filter-actions">
        <Button
          type="submit"
          label="Search"
          icon="pi pi-search"
          :loading="searcher.busy.value"
          data-testid="audit-search"
        />
        <Button
          type="button"
          label="Clear"
          text
          severity="secondary"
          data-testid="audit-clear"
          @click="clearFilters"
        />
      </div>
      <p v-if="rangeError" class="field-error range-error" data-testid="field-error-to">{{ rangeError }}</p>
      <p
        v-else-if="searcher.fieldErrors.value.to"
        class="field-error range-error"
        data-testid="field-error-to"
      >
        {{ searcher.fieldErrors.value.to }}
      </p>
    </form>

    <p class="muted small tz-note">Dates are calendar dates and times are shown in Asia/Colombo.</p>

    <div class="table-wrap">
      <table class="rtable" data-testid="audit-table" :aria-busy="searcher.busy.value">
        <thead>
          <tr>
            <th>Time</th>
            <th>User</th>
            <th>Terminal</th>
            <th>Action</th>
            <th>Record</th>
            <th>Reason</th>
            <th class="sr-only">Details</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="e in result?.items ?? []" :key="e.id">
            <tr data-testid="audit-row">
              <td data-label="Time" data-testid="audit-time" class="nowrap">{{ formatDateTime(e.at) }}</td>
              <td data-label="User">{{ who(e) }}</td>
              <td data-label="Terminal" :title="e.clientInfo" data-testid="audit-terminal">
                <span :class="{ muted: !e.terminal }">{{ where(e) }}</span>
                <span v-if="e.clientInfo" class="client muted small" data-testid="audit-client-info">{{
                  e.clientInfo
                }}</span>
              </td>
              <td data-label="Action">
                <span class="chip chip-info" data-testid="audit-action-cell">{{ e.action }}</span>
              </td>
              <td data-label="Record">
                <span class="mono">{{ e.entityType }}</span>
              </td>
              <td data-label="Reason">{{ e.reason ?? '' }}</td>
              <td data-label="" class="no-label">
                <Button
                  v-if="hasDetail(e)"
                  :label="expanded.has(e.id) ? 'Hide' : 'Details'"
                  size="small"
                  text
                  :aria-expanded="expanded.has(e.id)"
                  data-testid="audit-details"
                  @click="toggle(e.id)"
                />
              </td>
            </tr>
            <tr v-if="expanded.has(e.id)" class="detail-row">
              <td colspan="7" class="no-label">
                <div class="detail">
                  <div v-if="e.clientInfo">
                    <span class="label">From</span> <span class="mono">{{ e.clientInfo }}</span>
                  </div>
                  <div v-if="e.entityId">
                    <span class="label">Record id</span> <span class="mono">{{ e.entityId }}</span>
                  </div>
                  <div v-if="e.approver">
                    <span class="label">Approved by</span> {{ e.approver.fullName }} ({{
                      e.approver.username
                    }})
                  </div>
                  <div v-if="e.before" class="snap">
                    <span class="label">Before</span>
                    <pre>{{ pretty(e.before) }}</pre>
                  </div>
                  <div v-if="e.after" class="snap">
                    <span class="label">After</span>
                    <pre>{{ pretty(e.after) }}</pre>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="result && result.items.length === 0">
            <td colspan="7" class="no-label empty" data-testid="audit-empty">
              No entries match these filters.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="result" class="pager">
      <span class="muted small" data-testid="audit-total"
        >{{ result.totalItems }} entr{{ result.totalItems === 1 ? 'y' : 'ies' }}</span
      >
      <div class="pager-buttons">
        <Button
          icon="pi pi-angle-left"
          text
          aria-label="Previous page"
          :disabled="page === 0 || searcher.busy.value"
          data-testid="audit-prev"
          @click="goPage(page - 1)"
        />
        <span class="small" data-testid="audit-page">Page {{ page + 1 }} of {{ totalPages }}</span>
        <Button
          icon="pi pi-angle-right"
          text
          aria-label="Next page"
          :disabled="page + 1 >= totalPages || searcher.busy.value"
          data-testid="audit-next"
          @click="goPage(page + 1)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 12px;
  align-items: end;
}

.filter-actions {
  display: flex;
  gap: 6px;
}

.range-error {
  grid-column: 1 / -1;
  margin: 0;
}

.tz-note {
  margin: -6px 0 0;
}

.client {
  display: block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nowrap {
  white-space: nowrap;
}

.detail-row td {
  background: #f9fafb;
}

.detail {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  font-size: 0.88rem;
}

.detail .label {
  font-weight: 600;
  color: var(--rms-muted);
  margin-right: 4px;
}

.snap {
  min-width: 220px;
  flex: 1;
}

.snap pre {
  margin: 4px 0 0;
  padding: 8px;
  background: #fff;
  border: 1px solid var(--rms-border);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}

.empty {
  text-align: center;
  color: var(--rms-muted);
  padding: 24px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.pager-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
}

@media (max-width: 720px) {
  .detail {
    flex-direction: column;
  }
}
</style>
