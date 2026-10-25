<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { InkButton, InkSkeleton, InkPopup } from '@inkcre/ui-web'
import { getInfoBaseRouter, Relation } from '@inkcre/core'

import type { RelationInspectorPopupProps } from './RelationInspectorPopup'

const props = defineProps<RelationInspectorPopupProps>()
const router = getInfoBaseRouter()
const { t } = useI18n()
const status = ref<'loading' | 'success' | 'missing' | 'error'>('loading')
const relation = shallowRef<Relation | null>(null)
let generation = 0
const retry = ref(0)

watch(
  () => [props.relation, retry.value] as const,
  async ([relationRef]) => {
    const current = ++generation
    status.value = 'loading'
    relation.value = null
    try {
      const loaded = await Relation.find(relationRef)
      if (current !== generation) return
      relation.value = loaded
      status.value = loaded ? 'success' : 'missing'
    } catch (cause) {
      if (current !== generation) return
      console.error('[InfoBase] Failed to inspect Relation.', cause)
      status.value = 'error'
    }
  },
  { immediate: true }
)

function close(): void {
  void router.back()
}
</script>

<template>
  <InkPopup
    class="info-base-side-panel"
    style="width: 360px; padding: 0"
    :open="true"
    :scrim="false"
    position="right"
    :aria-label="`Relation #${props.relation}`"
    @update:open="close"
  >
    <section class="relation-inspector-popup">
      <header>
        <h3>Relation #{{ props.relation }}</h3>
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
        class="relation-inspector-popup__skeleton"
        role="status"
        :aria-label="t('common.loading')"
      >
        <InkSkeleton
          v-for="index in 3"
          :key="index"
          :style="{ width: index % 2 ? '50%' : '75%' }"
        />
      </div>
      <p v-else-if="status === 'missing'">This Relation no longer exists.</p>
      <div v-else-if="status === 'error'">
        <p role="alert">{{ t('infoBase.relationLoadFailed') }}</p>
        <InkButton :text="t('common.retry')" @click="retry++" />
      </div>
      <dl v-else-if="relation">
        <dt>From</dt>
        <dd>
          <button type="button" @click="router.push({ name: 'block', block: relation.from_ })">
            Block #{{ relation.from_ }}
          </button>
        </dd>
        <dt>Property</dt>
        <dd>{{ relation.content }}</dd>
        <dt>To</dt>
        <dd>
          <button type="button" @click="router.push({ name: 'block', block: relation.to_ })">
            Block #{{ relation.to_ }}
          </button>
        </dd>
      </dl>
    </section>
  </InkPopup>
</template>

<style scoped lang="scss">
.relation-inspector-popup {
  width: 100%;
  height: 100%;
  background: var(--sys-color-surface-base);

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: sys-var(space, md);
    padding: 16px 20px;
    border-bottom: 1px solid var(--sys-color-border-base);
  }

  h3 {
    margin: 0;
    @include apply-font(title-sm);
  }

  > *:not(header) {
    padding-inline: 20px;
  }

  dl {
    display: grid;
    grid-template-columns: fit-content(30%) minmax(0, 1fr);
    gap: sys-var(space, sm) sys-var(space, md);
    padding-block: 20px;
  }

  &__skeleton {
    display: grid;
    gap: sys-var(space, md);
    padding-block: sys-var(space, lg);
  }

  dd button {
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }

  button:focus-visible {
    outline: 2px solid sys-var(color, border, strong);
    outline-offset: 2px;
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  dt {
    color: sys-var(color, text, subtle);
  }
}
</style>

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
