<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { InkTabs, type InkTab } from '@inkcre/ui-web'

// Shared list/graph view switcher. Owns no state — the route is the source of truth.
// Preserves the current query (search, focus, path) so switching views keeps context.

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const currentView = computed<'list' | 'graph'>(() => {
  const name = String(route.name ?? '')
  return name.startsWith('InfoBaseGraph') ? 'graph' : 'list'
})

const tabs = computed<InkTab[]>(() => [
  { value: 'list', label: t('infoBase.view.list') },
  { value: 'graph', label: t('infoBase.view.graph') },
])

function onSwitch(value: string): void {
  if (value === currentView.value) return
  const name = String(route.name ?? '')
  // Map InfoBaseList* ↔ InfoBaseGraph* preserving params (block/relation) and query.
  const targetName =
    value === 'graph'
      ? name.replace(/^InfoBaseList/, 'InfoBaseGraph')
      : name.replace(/^InfoBaseGraph/, 'InfoBaseList')
  // Overview has no params; detail routes need block/relation preserved.
  void router.push({
    name: targetName,
    params: route.params,
    query: route.query,
  })
}
</script>

<template>
  <InkTabs
    :model-value="currentView"
    :tabs="tabs"
    :label="t('infoBase.view.label')"
    @update:model-value="onSwitch"
  />
</template>
