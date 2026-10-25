<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { InkButton, InkInput, InkPopup, InkSkeleton, InkTabs } from '@inkcre/ui-web'
import {
  CapabilityDelegationUnavailable,
  LexicalRetrievalManager,
  type BlockRef,
  type LexicalRetrievalMatch,
} from '@inkcre/core'

import router from '@/router'
import { closeRecallSearch, openRecallSearch, recallSearchOpen } from './recall-search'

const route = useRoute()
const { t } = useI18n()
const open = computed({
  get: () => recallSearchOpen.value,
  set: (value: boolean) => (value ? openRecallSearch() : closeRecallSearch()),
})
const query = ref('')
const mode = ref<'recall' | 'path'>('recall')
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const matches = shallowRef<LexicalRetrievalMatch[]>([])
const selected = ref<BlockRef[]>([])
const delegationUnavailable = ref(false)
let generation = 0

const isGraphActive = computed(() => String(route.name ?? '').startsWith('InfoBaseGraph'))

function onShortcut(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    openRecallSearch()
  }
}

onMounted(() => window.addEventListener('keydown', onShortcut))
onUnmounted(() => window.removeEventListener('keydown', onShortcut))

async function search(): Promise<void> {
  const value = query.value.trim()
  if (!value || status.value === 'loading') return
  if (mode.value === 'recall') {
    await router.push({
      name: isGraphActive.value ? 'InfoBaseGraphOverview' : 'InfoBaseListOverview',
      query: { q: value },
    })
    closeRecallSearch()
    return
  }
  const current = ++generation
  status.value = 'loading'
  delegationUnavailable.value = false
  matches.value = []
  try {
    const result = await LexicalRetrievalManager.retrieve({ query: value, limit: 20 })
    if (current !== generation) return
    matches.value = result.matches
    status.value = 'ready'
  } catch (cause) {
    if (current !== generation) return
    console.error('[Recall] Search failed.', cause)
    delegationUnavailable.value = cause instanceof CapabilityDelegationUnavailable
    status.value = 'error'
  }
}

async function choosePathBlock(block: BlockRef): Promise<void> {
  if (selected.value.includes(block)) return
  selected.value = [...selected.value, block].slice(0, 2)
  if (selected.value.length < 2) return
  await router.push({
    name: 'InfoBaseGraphOverview',
    query: { path_from: String(selected.value[0]), path_to: String(selected.value[1]) },
  })
  closeRecallSearch()
  selected.value = []
}

function setMode(value: string): void {
  if (value === 'recall' || value === 'path') mode.value = value
}

watch(
  [mode, open],
  () => {
    generation++
    selected.value = []
    matches.value = []
    status.value = 'idle'
  },
  { flush: 'sync' }
)

watch(
  query,
  () => {
    generation++
    matches.value = []
    status.value = 'idle'
  },
  { flush: 'sync' }
)
</script>

<template>
  <InkPopup
    v-model:open="open"
    position="top"
    :aria-label="t('recall.title')"
    style="width: 640px; max-width: calc(100vw - 2 * var(--sys-space-md))"
  >
    <section class="recall-search" :aria-label="t('recall.title')">
      <header>
        <InkTabs
          :model-value="mode"
          :label="t('recall.mode')"
          :tabs="[
            { value: 'recall', label: t('recall.recall') },
            { value: 'path', label: t('recall.findPath') },
          ]"
          @update:model-value="setMode"
        />
        <small>Ctrl K</small>
      </header>
      <form @submit.prevent="search">
        <div class="recall-search__input">
          <InkInput
            v-model="query"
            native-type="search"
            :aria-label="t('infoBase.list.searchLabel')"
            autofocus
            autocomplete="off"
            :placeholder="mode === 'path' ? t('recall.pathPlaceholder') : t('recall.placeholder')"
          />
        </div>
        <InkButton
          :text="t('infoBase.list.search')"
          theme="primary"
          native-type="submit"
          :is-loading="status === 'loading'"
          :disabled="!query.trim()"
        />
      </form>
      <div v-if="mode === 'path'" class="recall-search__results">
        <div v-if="status === 'loading'" role="status" :aria-label="t('common.loading')">
          <div v-for="index in 3" :key="index" class="recall-search__skeleton">
            <InkSkeleton style="width: 40%" />
            <InkSkeleton />
          </div>
        </div>
        <div v-else-if="status === 'error'" class="recall-search__feedback" role="alert">
          <p>
            {{ t(delegationUnavailable ? 'infoBase.list.unavailable' : 'infoBase.list.error') }}
          </p>
          <InkButton :text="t('common.retry')" @click="search" />
        </div>
        <p v-else-if="status === 'ready' && matches.length === 0" role="status">
          {{ t('infoBase.list.empty', { query: query.trim() }) }}
        </p>
        <p v-if="selected.length === 1">{{ t('recall.chooseDestination') }}</p>
        <button
          v-for="match in matches"
          :key="match.block.id"
          type="button"
          :disabled="selected.includes(match.block.id)"
          @click="choosePathBlock(match.block.id)"
        >
          <strong>{{ match.label }}</strong>
          <span>{{ match.excerpt }}</span>
        </button>
      </div>
    </section>
  </InkPopup>
</template>

<style scoped lang="scss">
.recall-search {
  width: 100%;

  header,
  form {
    display: flex;
    align-items: center;
    gap: sys-var(space, sm);
  }

  header {
    justify-content: space-between;
    margin-bottom: sys-var(space, sm);
  }
  small {
    @include apply-font(label-md);
    color: sys-var(color, text, subtle);
  }
  &__input {
    flex: 1;
    min-width: 0;
  }

  /* InkTabs 的 underline 与 tab 边界齐平，视觉拥挤；
     给 tabs 容器加水平 padding，让 underline 比 tab 内容宽出呼吸空间。 */
  :deep(.ink-tabs) {
    padding-inline: sys-var(space, sm);
  }

  &__skeleton,
  &__feedback {
    display: grid;
    gap: sys-var(space, sm);
    padding: sys-var(space, sm);
    background: sys-var(color, surface, base);
  }

  &__results {
    display: grid;
    gap: 1px;
    max-height: 50vh;
    margin-top: sys-var(space, sm);
    overflow: auto;
    background: sys-var(color, border, subtle);
    > button {
      @include apply-font(body-sm);
      overflow-wrap: anywhere;
      display: grid;
      gap: 3px;
      padding: sys-var(space, sm);
      border: 0;
      text-align: left;
      color: sys-var(color, text, base);
      background: sys-var(color, surface, base);
      cursor: pointer;
    }
    > button:hover {
      background: sys-var(color, surface, subtle);
    }
    strong {
      @include apply-font(label-lg);
    }
    span {
      color: sys-var(color, text, subtle);
    }
  }
}
</style>
