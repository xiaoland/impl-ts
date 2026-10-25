<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { InkButton, InkPlaceholder, InkSkeleton } from '@inkcre/ui-web'
import {
  CapabilityDelegationUnavailable,
  getInfoBaseRouter,
  LexicalRetrievalManager,
  presentLexicalMatches,
  type RecallGroup,
  type LexicalRetrievalMatch,
} from '@inkcre/core'

import router from '@/router'
import { extensionHostRestoreState } from '@/core'
import BlockInspectorPopup from '@/components/info-base/BlockInspectorPopup/BlockInspectorPopup.vue'
import SolvedContentPopup from '@/components/info-base/SolvedContentPopup/SolvedContentPopup.vue'
import RelationInspectorPopup from '@/components/info-base/RelationInspectorPopup/RelationInspectorPopup.vue'
import InfoBaseViewTabs from '@/components/info-base/InfoBaseViewTabs.vue'

const { t } = useI18n()
const route = useRoute()
const infoBaseRouter = getInfoBaseRouter()

const input = ref('')
const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
const matches = shallowRef<RecallGroup[]>([])
const error = shallowRef<Error | null>(null)
const delegationUnavailable = computed(() => error.value instanceof CapabilityDelegationUnavailable)
let generation = 0

const currentInfoBaseRoute = computed(() => infoBaseRouter.current.value)
const routeQuery = computed(() => {
  const value = route.query.q
  return typeof value === 'string' ? value.trim() : ''
})

async function retrieve(query: string): Promise<void> {
  const current = ++generation
  matches.value = []
  error.value = null
  if (!query) {
    status.value = 'idle'
    return
  }
  status.value = 'loading'
  try {
    const result = await LexicalRetrievalManager.retrieve({ query, limit: 20 })
    const presented = await presentLexicalMatches(result.matches)
    if (current !== generation) return
    matches.value = presented
    status.value = 'success'
  } catch (cause) {
    if (current !== generation) return
    error.value = cause instanceof Error ? cause : new Error(String(cause))
    status.value = 'error'
  }
}

watch(
  routeQuery,
  (query) => {
    input.value = query
    void retrieve(query)
  },
  { immediate: true }
)

// A direct URL can retrieve before its extension Resolvers finish registering.
watch(extensionHostRestoreState, (state) => {
  if (['restored', 'failed'].includes(state) && routeQuery.value) void retrieve(routeQuery.value)
})

function search(): void {
  const query = input.value.trim()
  void router.push({ name: 'InfoBaseListOverview', query: query ? { q: query } : {} })
}

function inspect(match: LexicalRetrievalMatch): void {
  void infoBaseRouter.push({ name: 'block', block: match.block.id })
}

function openResult(group: RecallGroup): void {
  void infoBaseRouter.push({
    name: group.readable ? 'solved-content' : 'block',
    block: group.block.id,
  })
}

function formatRank(rank: number): string {
  return rank.toFixed(3).replace(/\.?0+$/, '')
}

function refresh(): void {
  void retrieve(routeQuery.value)
}
</script>

<template>
  <main class="info-base-list-view">
    <!-- 首页（无 block/relation 参数）是搜索入口，不显示视图切换 tabs -->
    <div
      v-if="route.params.block || route.params.relation"
      class="info-base-list-view__view-switch"
    >
      <InfoBaseViewTabs />
    </div>
    <header class="info-base-list-view__hero">
      <h1>{{ t('infoBase.list.title') }}</h1>
      <form class="info-base-list-view__search" @submit.prevent="search">
        <input
          v-model="input"
          type="search"
          :aria-label="t('infoBase.list.searchLabel')"
          :placeholder="t('infoBase.list.searchPlaceholder')"
          autocomplete="off"
        />
        <InkButton
          :text="t('infoBase.list.search')"
          theme="primary"
          native-type="submit"
          :is-loading="status === 'loading'"
          :disabled="status === 'loading'"
        />
      </form>
      <p class="info-base-list-view__help">{{ t('infoBase.list.idle') }}</p>
    </header>

    <section class="info-base-list-view__results" aria-live="polite">
      <div
        v-if="status === 'loading'"
        class="info-base-list-view__skeletons"
        :aria-label="t('common.loading')"
      >
        <div
          v-for="index in 3"
          :key="index"
          class="info-base-list-view__skeleton"
          aria-hidden="true"
        >
          <InkSkeleton style="width: 40%" /><InkSkeleton style="width: 80%" />
        </div>
      </div>
      <InkPlaceholder
        v-else-if="status === 'error'"
        state="error"
        :title="t(delegationUnavailable ? 'infoBase.list.unavailable' : 'infoBase.list.error')"
        :description="error?.message"
      >
        <template #actions>
          <InkButton :text="t('infoBase.list.retry')" theme="subtle" @click="refresh" />
        </template>
      </InkPlaceholder>
      <InkPlaceholder
        v-else-if="status === 'success' && matches.length === 0"
        :title="t('infoBase.list.empty', { query: routeQuery })"
      />
      <ol v-else-if="matches.length" class="info-base-list-view__matches">
        <li v-for="match in matches" :key="match.block.id">
          <button type="button" class="info-base-list-view__match" @click="openResult(match)">
            <span class="info-base-list-view__match-heading">
              <strong>{{ match.label }}</strong>
            </span>
            <span v-if="match.description" class="info-base-list-view__evidence">{{
              match.description
            }}</span>
            <span class="info-base-list-view__excerpt">{{ match.excerpt }}</span>
            <span class="info-base-list-view__evidence">
              <span>{{ t(`infoBase.list.evidence.${match.matches[0]!.evidence}`) }}</span>
            </span>
          </button>
          <details class="info-base-list-view__match-details">
            <summary>{{ t('common.details') }}</summary>
            <div v-for="evidence in match.matches" :key="evidence.block.id">
              <InkButton theme="subtle" size="sm" @click="inspect(evidence)">
                #{{ evidence.block.id }} · {{ t(`infoBase.list.evidence.${evidence.evidence}`) }}
              </InkButton>
              <p>{{ evidence.excerpt }}</p>
              <code>{{ evidence.block.resolver }}</code>
              <span> · {{ formatRank(evidence.rank) }}</span>
            </div>
          </details>
        </li>
      </ol>
    </section>

    <BlockInspectorPopup
      v-if="currentInfoBaseRoute?.name === 'block'"
      :block="currentInfoBaseRoute.block"
    />
    <SolvedContentPopup
      v-else-if="currentInfoBaseRoute?.name === 'solved-content'"
      :block="currentInfoBaseRoute.block"
    />
    <RelationInspectorPopup
      v-else-if="currentInfoBaseRoute?.name === 'relation'"
      :relation="currentInfoBaseRoute.relation"
    />
  </main>
</template>

<style lang="scss" scoped src="./list.scss" />
