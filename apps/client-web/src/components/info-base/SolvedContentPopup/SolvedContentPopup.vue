<script setup lang="ts">
import { onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { InkButton, InkLoading, InkPopup } from '@inkcre/ui-web'
import { Block, getInfoBaseRouter, Resolver, UnknownResolverError } from '@inkcre/core'

import { extensionHostRestoreState } from '@/core'
import SolvedContentRenderer from '@/components/info-base/SolvedContentRenderer/SolvedContentRenderer.vue'
import type { SolvedContentPopupProps } from './SolvedContentPopup'

const props = defineProps<SolvedContentPopupProps>()
const { t } = useI18n()
const router = getInfoBaseRouter()

const open = ref(true)
const status = ref<'loading' | 'success' | 'missing' | 'error'>('loading')
const resolver = shallowRef<Resolver | null>(null)
const solvedContent = shallowRef<unknown>(null)
const error = shallowRef<Error | null>(null)
let generation = 0
let lookupBeforeRestore = false

async function load(refresh = false): Promise<void> {
  const current = ++generation
  const previous = resolver.value
  resolver.value = null
  solvedContent.value = null
  error.value = null
  status.value = 'loading'
  lookupBeforeRestore = false
  await previous?.dispose()

  let next: Resolver | null = null
  try {
    const block = await Block.find(props.block)
    if (current !== generation) return
    if (!block) {
      status.value = 'missing'
      return
    }
    lookupBeforeRestore = ['idle', 'restoring'].includes(extensionHostRestoreState.value)
    const resolverClass = Resolver.getClass(block.resolver)
    next = new resolverClass(block)
    const solved = await next.getSolvedContent({ refresh, materializeMissing: false })
    if (current !== generation) {
      await next.dispose()
      return
    }
    resolver.value = next
    solvedContent.value = solved
    status.value = 'success'
  } catch (cause) {
    await next?.dispose()
    if (current !== generation) return
    error.value = cause instanceof Error ? cause : new Error(String(cause))
    status.value = 'error'
  }
}

watch(
  () => props.block,
  () => void load(),
  { immediate: true }
)
// A deep link can arrive before enabled native modules register their resolvers.
// Retry only that lookup failure when restore finishes; preserve other read failures.
watch([extensionHostRestoreState, error], ([state, cause]) => {
  if (
    ['restored', 'failed'].includes(state) &&
    lookupBeforeRestore &&
    cause instanceof UnknownResolverError
  ) {
    void load()
  }
})
onUnmounted(() => {
  generation += 1
  void resolver.value?.dispose()
})

function close(): void {
  void router.back()
}

function onOpenChange(value: boolean): void {
  open.value = value
  if (!value) close()
}
</script>

<template>
  <InkPopup
    class="info-base-inspector-surface"
    style="width: 900px; max-width: 95vw; padding: 0"
    :open="open"
    :scrim="true"
    position="center"
    :aria-label="t('infoBase.solvedContent.title')"
    @update:open="onOpenChange"
  >
    <section class="solved-content-popup">
      <header class="solved-content-popup__header">
        <h3>{{ t('infoBase.solvedContent.title') }}</h3>
        <div class="solved-content-popup__controls">
          <InkButton
            icon="i-mdi-refresh"
            :aria-label="t('common.refresh')"
            theme="subtle"
            type="square"
            :disabled="status === 'loading'"
            @click="load(true)"
          />
          <InkButton
            icon="i-mdi-close"
            :aria-label="t('common.close')"
            theme="subtle"
            type="square"
            @click="close"
          />
        </div>
      </header>

      <div v-if="status === 'loading'" class="solved-content-popup__state"><InkLoading /></div>
      <div v-else-if="status === 'missing'" class="solved-content-popup__state">
        {{ t('infoBase.solvedContent.missing', { block: props.block }) }}
      </div>
      <div v-else-if="status === 'error'" class="solved-content-popup__state">
        {{ error?.message }}
      </div>
      <SolvedContentRenderer
        v-else-if="resolver"
        class="solved-content-popup__content"
        :resolver="resolver"
        :solved-content="solvedContent"
      />
    </section>
  </InkPopup>
</template>

<style lang="scss" scoped src="./SolvedContentPopup.scss" />
