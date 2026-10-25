<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  InkAutoForm,
  InkJsonEditor,
  InkTabs,
  canRenderJsonSchema,
  type FormValidation,
  type JsonEditorValidation,
  type JSONSchema,
} from '@inkcre/ui-web'

const props = defineProps<{
  modelValue: string
  schema?: Record<string, unknown>
  label: string
  disabled?: boolean
  placeholder?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  validation: [result: JsonEditorValidation]
}>()
const { t } = useI18n()
const visualSchema = computed<JSONSchema | null>(() =>
  canRenderJsonSchema(props.schema) ? props.schema : null
)
const tabs = computed(() => [
  { value: 'visual', label: t('common.visual') },
  { value: 'json', label: t('common.json') },
])
const mode = ref<'visual' | 'json'>('json')
const formData = ref<Record<string, unknown>>({})
const modeError = ref(false)
let lastEmitted = ''

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

watch(
  () => props.schema,
  () => {
    modeError.value = false
    const object = parseObject(props.modelValue)
    formData.value = object ?? {}
    mode.value = visualSchema.value && object ? 'visual' : 'json'
  },
  { immediate: true }
)
watch(
  () => props.modelValue,
  (text) => {
    if (text === lastEmitted) return
    const object = parseObject(text)
    if (object) formData.value = object
  }
)

function updateVisual(value: Record<string, unknown>) {
  formData.value = value
  lastEmitted = JSON.stringify(value, null, 2)
  emit('update:modelValue', lastEmitted)
}
function updateJson(text: string) {
  modeError.value = false
  lastEmitted = text
  emit('update:modelValue', text)
}
function onVisualValidation(result: FormValidation) {
  const text = JSON.stringify(formData.value, null, 2)
  emit('validation', {
    text,
    status: result.status,
    valid: result.valid,
    messages: [...result.rootErrors, ...Object.values(result.errors).flat()],
  })
}
function selectMode(value: string) {
  if (value === 'json') {
    modeError.value = false
    emit('validation', { text: props.modelValue, status: 'pending', valid: false, messages: [] })
    mode.value = 'json'
    return
  }
  const object = parseObject(props.modelValue)
  if (!visualSchema.value || !object) {
    modeError.value = true
    return
  }
  modeError.value = false
  emit('validation', { text: props.modelValue, status: 'pending', valid: false, messages: [] })
  formData.value = object
  mode.value = 'visual'
}
</script>

<template>
  <div class="schema-config-editor">
    <InkTabs
      v-if="visualSchema"
      :model-value="mode"
      :tabs="tabs"
      :label="label"
      @update:model-value="selectMode"
    />
    <p v-if="modeError" role="alert" class="schema-config-editor__error">
      {{ t('common.fixJsonBeforeForm') }}
    </p>
    <InkAutoForm
      v-if="mode === 'visual' && visualSchema"
      :schema="visualSchema"
      :form-data="formData"
      :embedded="true"
      :disabled="disabled"
      @update:form-data="updateVisual"
      @validation="onVisualValidation"
    />
    <InkJsonEditor
      v-else
      :model-value="modelValue"
      :schema="schema"
      :label="label"
      :placeholder="placeholder"
      :rows="8"
      :disabled="disabled"
      @update:model-value="updateJson"
      @validation="emit('validation', $event)"
    />
  </div>
</template>

<style lang="scss" scoped>
.schema-config-editor {
  display: flex;
  flex-direction: column;
  gap: sys-var(space, md);
  min-width: 0;

  /* InkTabs 的 underline 与 tab 边界齐平，视觉拥挤；
     给 tabs 容器加水平 padding，让 underline 比 tab 内容宽出呼吸空间。 */
  :deep(.ink-tabs) {
    padding-inline: sys-var(space, sm);
  }
}

.schema-config-editor__error {
  margin: 0;
  color: sys-var(color, feedback, error);
}
</style>
