<script setup lang="ts">
/**
 * Reason list + comment (screens.md shared dialogs). Reason is always required; the comment is
 * required when `commentRequired` is true or the chosen reason has `needsComment` (Annex A
 * mandatory fields). Emits only valid input.
 */
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import type { ReasonOption } from './types'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    message?: string
    reasons: ReasonOption[]
    commentRequired?: boolean
    confirmLabel?: string
    danger?: boolean
    busy?: boolean
    error?: string | null
    maxComment?: number
  }>(),
  {
    title: 'Reason',
    message: '',
    commentRequired: false,
    confirmLabel: 'Confirm',
    danger: false,
    busy: false,
    error: null,
    maxComment: 500,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [value: { reason: string; comment: string }]
  cancel: []
}>()

const reason = ref<string | null>(null)
const comment = ref('')
const touched = ref(false)

watch(
  () => props.visible,
  (open) => {
    if (open) {
      reason.value = null
      comment.value = ''
      touched.value = false
    }
  },
)

const needsComment = computed(
  () => props.commentRequired || Boolean(props.reasons.find((r) => r.value === reason.value)?.needsComment),
)
const reasonError = computed(() => (touched.value && !reason.value ? 'Choose a reason.' : null))
const commentError = computed(() => {
  if (!touched.value) return null
  if (needsComment.value && !comment.value.trim()) return 'A comment is required.'
  if (comment.value.length > props.maxComment) return `Keep the comment under ${props.maxComment} characters.`
  return null
})

function confirm() {
  touched.value = true
  if (props.busy || reasonError.value || commentError.value || !reason.value) return
  emit('confirm', { reason: reason.value, comment: comment.value.trim() })
}

function cancel() {
  emit('update:visible', false)
  emit('cancel')
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="title"
    :closable="!busy"
    :draggable="false"
    :style="{ width: 'min(480px, calc(100vw - 32px))' }"
    data-testid="reason-dialog"
    @update:visible="(v: boolean) => (v ? emit('update:visible', v) : cancel())"
  >
    <form class="reason-form" novalidate @submit.prevent="confirm">
      <p v-if="message" class="muted">{{ message }}</p>
      <fieldset class="reasons">
        <legend class="label">Reason <span aria-hidden="true">*</span></legend>
        <label
          v-for="r in reasons"
          :key="r.value"
          class="reason"
          :class="{ selected: reason === r.value }"
          :data-testid="`reason-option-${r.value}`"
        >
          <input v-model="reason" type="radio" name="reason" :value="r.value" :disabled="busy" />
          <span>{{ r.label }}</span>
        </label>
      </fieldset>
      <p v-if="reasonError" class="field-error" data-testid="reason-error">{{ reasonError }}</p>
      <div class="field">
        <label for="reason-comment">Comment<span v-if="needsComment"> *</span></label>
        <Textarea
          id="reason-comment"
          v-model="comment"
          rows="3"
          auto-resize
          :disabled="busy"
          :maxlength="maxComment"
          data-testid="reason-comment"
        />
        <p v-if="commentError" class="field-error" data-testid="reason-comment-error">{{ commentError }}</p>
      </div>
      <p v-if="error" class="field-error" role="alert" data-testid="reason-server-error">{{ error }}</p>
      <div class="actions">
        <Button
          type="button"
          label="Cancel"
          text
          severity="secondary"
          :disabled="busy"
          data-testid="reason-cancel"
          @click="cancel"
        />
        <Button
          type="submit"
          :label="confirmLabel"
          :severity="danger ? 'danger' : undefined"
          :loading="busy"
          :disabled="busy"
          data-testid="reason-confirm"
        />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.reason-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reasons {
  border: 0;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.reasons legend {
  margin-bottom: 6px;
}

.reason {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 8px 12px;
  border: 1px solid var(--rms-border);
  border-radius: 8px;
  cursor: pointer;
}

.reason.selected {
  border-color: var(--rms-primary);
  background: var(--rms-primary-soft);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
