<script setup lang="ts">
/**
 * /admin/floor - tables and the drag-to-arrange floor plan (P1-FLOOR-01). Positions live on a
 * 1000 x 700 logical grid; the canvas scales to any width. Drag (mouse or touch) or use the arrow
 * keys on a focused table; "Save plan" sends every moved table in one saveTablePositions call.
 */
import { computed, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import TableFormDialog from './TableFormDialog.vue'
import { floorApi } from '@/api/floor'
import { isApiError } from '@/api/errors'
import type { DiningTable } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { gridToPercent, nudge, pointerToGrid, snapPoint, type Point } from './floorMath'

const notify = useNotify()
const tables = ref<DiningTable[]>([])
/** Current (possibly unsaved) position of every table. */
const positions = ref<Record<string, Point>>({})
const selectedId = ref<string | null>(null)
const canvas = ref<HTMLElement | null>(null)
const conflict = ref(false)

const loader = useAction(async () => {
  const list = await floorApi.listTables()
  tables.value = list
  const next: Record<string, Point> = {}
  for (const t of list) {
    const existing = positions.value[t.id]
    // Keep an unsaved drag across a reload; otherwise take the saved position.
    next[t.id] = existing && isMoved(t, existing) ? existing : { x: t.x, y: t.y }
  }
  positions.value = next
})
const load = () => loader.run().catch((e) => notify.error(e, 'Could not load the tables'))
onMounted(load)

const isMoved = (t: DiningTable, p: Point | undefined) => Boolean(p && (p.x !== t.x || p.y !== t.y))
const movedTables = computed(() => tables.value.filter((t) => t.active && isMoved(t, positions.value[t.id])))
const activeTables = computed(() => tables.value.filter((t) => t.active))
const sections = computed(() => [...new Set(tables.value.map((t) => t.section))].sort())
const hue = (section: string) => (sections.value.indexOf(section) * 67 + 170) % 360

// ---------------------------------------------------------------- dragging
let drag: { id: string; pointerId: number; offset: Point } | null = null

function onPointerDown(e: PointerEvent, t: DiningTable) {
  if (e.button !== 0 && e.pointerType === 'mouse') return
  const rect = canvas.value?.getBoundingClientRect()
  const pos = positions.value[t.id]
  if (!rect || !pos) return
  selectedId.value = t.id
  const at = pointerToGrid(e.clientX, e.clientY, rect)
  drag = { id: t.id, pointerId: e.pointerId, offset: { x: pos.x - at.x, y: pos.y - at.y } }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}

function onPointerMove(e: PointerEvent) {
  if (!drag || drag.pointerId !== e.pointerId) return
  const rect = canvas.value?.getBoundingClientRect()
  if (!rect) return
  const at = pointerToGrid(e.clientX, e.clientY, rect)
  positions.value = {
    ...positions.value,
    [drag.id]: snapPoint({ x: at.x + drag.offset.x, y: at.y + drag.offset.y }),
  }
}

function onPointerUp(e: PointerEvent) {
  if (drag && drag.pointerId === e.pointerId) drag = null
}

function onKeydown(e: KeyboardEvent, t: DiningTable) {
  const pos = positions.value[t.id]
  const next = pos ? nudge(e.key, e.shiftKey, pos) : null
  if (!next) return
  e.preventDefault()
  selectedId.value = t.id
  positions.value = { ...positions.value, [t.id]: next }
}

// ---------------------------------------------------------------- save / discard
const saver = useAction(async () => {
  const saved = await floorApi.savePositions(
    movedTables.value.map((t) => {
      const p = positions.value[t.id] as Point
      return { tableId: t.id, x: p.x, y: p.y, version: t.version }
    }),
  )
  const byId = new Map(saved.map((t) => [t.id, t]))
  tables.value = tables.value.map((t) => byId.get(t.id) ?? t)
  positions.value = Object.fromEntries(tables.value.map((t) => [t.id, { x: t.x, y: t.y }]))
  return saved.length
})

async function savePlan() {
  conflict.value = false
  try {
    const n = await saver.run()
    if (n !== undefined) notify.success('Floor plan saved', `${n} table${n === 1 ? '' : 's'} moved.`)
  } catch (e) {
    if (isApiError(e) && e.isVersionConflict) conflict.value = true
    else notify.error(e, 'Could not save the floor plan')
  }
}

function discard() {
  positions.value = Object.fromEntries(tables.value.map((t) => [t.id, { x: t.x, y: t.y }]))
  conflict.value = false
}

async function reloadDiscarding() {
  positions.value = {}
  conflict.value = false
  await load()
}

// ---------------------------------------------------------------- table dialog
const formOpen = ref(false)
const editing = ref<DiningTable | null>(null)
function openForm(t: DiningTable | null) {
  editing.value = t
  formOpen.value = true
}
async function onTableSaved(t: DiningTable) {
  notify.success(editing.value ? 'Table saved' : 'Table created', `Table ${t.number}`)
  await load()
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>Floor plan</h1>
      <div class="header-actions">
        <Button
          label="New table"
          icon="pi pi-plus"
          outlined
          data-testid="table-create"
          @click="openForm(null)"
        />
      </div>
    </div>
    <p class="muted small">
      Drag the tables to where they stand in the restaurant (or select one and use the arrow keys). Tables
      snap to a grid. Nothing is saved until you press Save plan.
    </p>

    <VersionConflictBanner v-if="conflict" :busy="loader.busy.value" @reload="reloadDiscarding" />

    <section class="card plan">
      <div
        ref="canvas"
        class="canvas"
        data-testid="floor-canvas"
        role="application"
        aria-label="Floor plan. Select a table and use the arrow keys to move it."
      >
        <button
          v-for="t in activeTables"
          :key="t.id"
          type="button"
          class="tbl"
          :class="{ selected: selectedId === t.id, moved: isMoved(t, positions[t.id]) }"
          :style="{ ...gridToPercent(positions[t.id] ?? { x: t.x, y: t.y }), '--hue': hue(t.section) }"
          :aria-label="`Table ${t.number}, ${t.section}, ${t.seats} seats`"
          :data-testid="`floor-table-${t.number}`"
          :data-x="(positions[t.id] ?? t).x"
          :data-y="(positions[t.id] ?? t).y"
          @pointerdown="onPointerDown($event, t)"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @keydown="onKeydown($event, t)"
        >
          <span class="tnum">{{ t.number }}</span>
          <span class="tseats">{{ t.seats }}</span>
        </button>
        <p v-if="!activeTables.length && !loader.busy.value" class="empty-canvas muted">
          No active tables yet.
        </p>
      </div>

      <div class="plan-bar">
        <span v-if="movedTables.length" class="small" data-testid="floor-dirty">
          <i class="pi pi-circle-fill dot" aria-hidden="true" /> {{ movedTables.length }} table{{
            movedTables.length === 1 ? '' : 's'
          }}
          moved, not saved
        </span>
        <span v-else class="muted small">All positions saved.</span>
        <span class="spacer" />
        <Button
          label="Discard"
          text
          severity="secondary"
          :disabled="!movedTables.length || saver.busy.value"
          data-testid="floor-discard"
          @click="discard"
        />
        <Button
          label="Save plan"
          icon="pi pi-check"
          :loading="saver.busy.value"
          :disabled="!movedTables.length || saver.busy.value"
          data-testid="floor-save"
          @click="savePlan"
        />
      </div>
      <ul v-if="sections.length" class="legend" aria-label="Sections">
        <li v-for="s in sections" :key="s"><span class="swatch" :style="{ '--hue': hue(s) }" /> {{ s }}</li>
      </ul>
    </section>

    <div class="table-wrap">
      <table class="rtable" data-testid="tables-table" :aria-busy="loader.busy.value">
        <thead>
          <tr>
            <th>Table</th>
            <th>Section</th>
            <th>Seats</th>
            <th>Status</th>
            <th class="sr-only">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in tables"
            :key="t.id"
            :class="{ inactive: !t.active }"
            :data-testid="`table-row-${t.number}`"
          >
            <td data-label="Table">
              <strong>{{ t.number }}</strong>
            </td>
            <td data-label="Section">{{ t.section }}</td>
            <td data-label="Seats">{{ t.seats }}</td>
            <td data-label="Status">
              <span class="chip" :class="t.active ? 'chip-ok' : 'chip-muted'">{{
                t.active ? 'Active' : 'Inactive'
              }}</span>
            </td>
            <td data-label="" class="no-label">
              <div class="actions">
                <Button
                  label="Edit"
                  icon="pi pi-pencil"
                  size="small"
                  outlined
                  :data-testid="`table-edit-${t.number}`"
                  @click="openForm(t)"
                />
              </div>
            </td>
          </tr>
          <tr v-if="!tables.length && !loader.busy.value">
            <td colspan="5" class="no-label empty">No tables yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <TableFormDialog
      v-model:visible="formOpen"
      :table="editing"
      :sections="sections"
      @saved="onTableSaved"
      @reload="load"
    />
  </div>
</template>

<style scoped>
.plan {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.canvas {
  position: relative;
  width: 100%;
  max-width: 960px;
  aspect-ratio: 1000 / 700;
  margin: 0 auto;
  container-type: inline-size;
  background:
    linear-gradient(#e8edf1 1px, transparent 1px) 0 0 / 10% 14.2857%,
    linear-gradient(90deg, #e8edf1 1px, transparent 1px) 0 0 / 10% 14.2857%,
    #f8fafb;
  border: 2px solid var(--rms-border);
  border-radius: 12px;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}

.tbl {
  position: absolute;
  width: 11%;
  aspect-ratio: 4 / 3;
  min-width: 36px;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 2px solid hsl(var(--hue) 45% 45%);
  background: hsl(var(--hue) 60% 92%);
  color: hsl(var(--hue) 50% 22%);
  font: inherit;
  cursor: grab;
  touch-action: none;
  padding: 0;
}

.tbl:active {
  cursor: grabbing;
}

.tbl.selected {
  outline: 3px solid var(--rms-primary);
  outline-offset: 2px;
  z-index: 2;
}

.tbl.moved {
  border-style: dashed;
  box-shadow: 0 0 0 3px var(--rms-warn-soft);
}

.tnum {
  font-weight: 800;
  font-size: clamp(0.7rem, 2.6cqw, 1.4rem);
  line-height: 1.1;
}

.tseats {
  font-size: clamp(0.55rem, 1.7cqw, 0.9rem);
  opacity: 0.8;
}

.tseats::before {
  content: '\1F464 ';
}

.empty-canvas {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
}

.plan-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dot {
  color: var(--rms-warn);
  font-size: 0.6rem;
}

.spacer {
  flex: 1;
}

.legend {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0;
  padding: 0;
  font-size: 0.85rem;
}

.swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  vertical-align: -2px;
  background: hsl(var(--hue) 60% 92%);
  border: 2px solid hsl(var(--hue) 45% 45%);
}

.empty {
  text-align: center;
  color: var(--rms-muted);
  padding: 24px;
}
</style>
