<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import { InkButton, InkSkeleton, InkPopup } from '@inkcre/ui-web'
import { Block, getInfoBaseRouter, OrganizationManager, PeerOutcomeUnknown } from '@inkcre/core'

import type { BlockInspectorPopupProps } from './BlockInspectorPopup'
import { blockInspectorPopupEmits } from './BlockInspectorPopup'

const props = defineProps<BlockInspectorPopupProps>()
const emit = defineEmits(blockInspectorPopupEmits)
const { t } = useI18n()
const router = getInfoBaseRouter()

const open = ref(true)
const status = ref<'loading' | 'success' | 'missing' | 'error'>('loading')
const block = shallowRef<Block | null>(null)
const error = shallowRef<Error | null>(null)
const isRuminating = ref(false)
const ruminationOutcome = ref<'success' | 'error' | 'outcome-unknown' | null>(null)
let generation = 0
const retry = ref(0)

const formattedCreatedAt = computed(() =>
  block.value?.created_at ? dayjs(block.value.created_at).format('YYYY-MM-DD HH:mm') : '-'
)
const formattedUpdatedAt = computed(() =>
  block.value?.updated_at ? dayjs(block.value.updated_at).format('YYYY-MM-DD HH:mm') : '-'
)

watch(
  () => [props.block, retry.value] as const,
  async ([blockRef]) => {
    const current = ++generation
    status.value = 'loading'
    block.value = null
    error.value = null
    try {
      const loaded = await Block.find(blockRef)
      if (current !== generation) return
      block.value = loaded
      status.value = loaded ? 'success' : 'missing'
    } catch (cause) {
      if (current !== generation) return
      error.value = cause instanceof Error ? cause : new Error(String(cause))
      status.value = 'error'
    }
  },
  { immediate: true }
)

function close(): void {
  void router.back()
}

function onOpenChange(value: boolean): void {
  open.value = value
  if (!value) close()
}

function viewSolvedContent(): void {
  void router.push({ name: 'solved-content', block: props.block })
}

async function ruminate(): Promise<void> {
  isRuminating.value = true
  ruminationOutcome.value = null
  try {
    await OrganizationManager.ruminate(props.block)
    ruminationOutcome.value = 'success'
    emit('ruminated')
  } catch (cause) {
    ruminationOutcome.value = cause instanceof PeerOutcomeUnknown ? 'outcome-unknown' : 'error'
  } finally {
    isRuminating.value = false
  }
}
</script>

<template>
  <InkPopup
    class="info-base-side-panel"
    style="width: 420px; padding: 0"
    :open="open"
    :scrim="false"
    position="right"
    :aria-label="t('infoBase.blockInspector.title')"
    @update:open="onOpenChange"
  >
    <section class="block-inspector-popup">
      <header class="block-inspector-popup__header">
        <h3>{{ t('infoBase.blockInspector.title') }}</h3>
        <InkButton
          icon="i-mdi-close"
          :aria-label="t('common.close')"
          theme="subtle"
          type="square"
          @click="close"
        />
      </header>

      <div
        v-if="status === 'loading'"
        class="block-inspector-popup__skeleton"
        role="status"
        :aria-label="t('common.loading')"
      >
        <InkSkeleton
          v-for="index in 4"
          :key="index"
          :style="{ width: index % 2 ? '40%' : '75%' }"
        />
      </div>
      <div v-else-if="status === 'missing'" class="block-inspector-popup__state">
        {{ t('infoBase.blockInspector.missing', { block: props.block }) }}
      </div>
      <div v-else-if="status === 'error'" class="block-inspector-popup__state">
        <p role="alert">{{ t('infoBase.blockInspector.loadFailed') }}</p>
        <details>
          <summary>{{ t('common.errorDetails') }}</summary>
          {{ error?.message }}
        </details>
        <InkButton :text="t('common.retry')" @click="retry++" />
      </div>

      <div v-else-if="block" class="block-inspector-popup__body">
        <dl class="block-inspector-popup__facts">
          <dt>{{ t('infoBase.blockInspector.id') }}</dt>
          <dd>#{{ block.id }}</dd>
          <dt>{{ t('infoBase.blockInspector.resolver') }}</dt>
          <dd>
            <code>{{ block.resolver }}</code>
          </dd>
          <dt>{{ t('infoBase.blockInspector.created') }}</dt>
          <dd>{{ formattedCreatedAt }}</dd>
          <dt>{{ t('infoBase.blockInspector.updated') }}</dt>
          <dd>{{ formattedUpdatedAt }}</dd>
          <template v-if="block.storage !== null"
            ><dt>{{ t('infoBase.blockInspector.storage') }}</dt>
            <dd>#{{ block.storage }}</dd></template
          >
        </dl>

        <div class="block-inspector-popup__actions">
          <InkButton
            :text="t('infoBase.blockInspector.viewContent')"
            theme="primary"
            @click="viewSolvedContent"
          />
          <InkButton
            :text="t('infoBase.blockInspector.ruminate')"
            :is-loading="isRuminating"
            @click="ruminate"
          />
          <p v-if="ruminationOutcome" :role="ruminationOutcome === 'success' ? 'status' : 'alert'">
            {{ t(`infoBase.blockInspector.rumination.${ruminationOutcome}`) }}
          </p>
        </div>
      </div>
    </section>
  </InkPopup>
</template>

<style lang="scss" scoped src="./BlockInspectorPopup.scss" />

<style lang="scss">
/* Side panel styling - applied globally to override InkPopup */
.info-base-side-panel {
  top: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  left: auto !important;
  transform: none !important;
  height: 100vh;
  max-height: 100vh;
  max-width: 90vw;
  margin: 0;
  border-left: 1px solid var(--sys-color-border-base);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
}
</style>
