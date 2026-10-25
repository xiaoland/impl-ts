<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { appSidePanelProps, appSidePanelEmits } from './AppSidePanel'
import { InkPopup } from '@inkcre/ui-web'

const props = defineProps(appSidePanelProps)
const emit = defineEmits(appSidePanelEmits)
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

// --- data ---

interface NavItem {
  name: string
  labelKey: string
  to: string
  // Router paths that mark this item as current (exact match or prefix).
  matches: string[]
  requiresReady: boolean
  // 'full-reload' forces a full navigation (used when the runtime is not ready).
  fallbackToFullReload?: boolean
}

interface NavGroup {
  titleKey: string
  items: NavItem[]
}

const NAV_ITEMS: NavItem[] = [
  {
    name: 'home',
    labelKey: 'sidePanel.home',
    to: '/',
    matches: ['/'],
    requiresReady: true,
  },
  {
    name: 'explore',
    labelKey: 'sidePanel.explore',
    to: '/info-base/graph',
    matches: ['/info-base/graph'],
    requiresReady: true,
  },
  {
    name: 'sources',
    labelKey: 'sidePanel.sources',
    to: '/sources',
    matches: ['/sources'],
    requiresReady: true,
  },
  {
    name: 'extensions',
    labelKey: 'sidePanel.extensions',
    to: '/extensions',
    matches: ['/extensions'],
    requiresReady: true,
  },
  {
    name: 'peers',
    labelKey: 'sidePanel.peers',
    to: '/peers',
    matches: ['/peers'],
    requiresReady: true,
  },
  {
    name: 'settings',
    labelKey: 'sidePanel.settings',
    to: '/settings',
    matches: ['/settings'],
    requiresReady: false,
    fallbackToFullReload: true,
  },
]

// --- methods ---

function isActive(item: NavItem): boolean {
  const path = route.path
  return item.matches.some((match) => {
    if (match === '/') return path === '/'
    return path === match || path.startsWith(`${match}/`)
  })
}

function close(): void {
  emit('update:expanded', false)
}

function onItemClick(item: NavItem, event: MouseEvent): void {
  if (!props.ready && item.requiresReady) {
    event.preventDefault()
    return
  }
  if (!props.ready && item.fallbackToFullReload) {
    event.preventDefault()
    window.location.assign(item.to)
    return
  }
  // Allow cmd/ctrl+click to open in new tab; only intercept plain clicks.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  void router.push(item.to)
  close()
}

// Close panel whenever a navigation completes (covers back/forward and
// programmatic pushes that did not go through onItemClick).
watch(
  () => route.fullPath,
  () => close()
)
</script>

<template>
  <InkPopup
    :open="props.expanded"
    position="right"
    class="app-side-panel-popup"
    :aria-label="t('sidePanel.menu')"
    @update:open="close"
  >
    <nav id="app-side-panel" class="app-side-panel" aria-label="Primary">
      <ul class="app-side-panel__list">
        <li v-for="item in NAV_ITEMS" :key="item.name">
          <a
            :href="item.to"
            class="app-side-panel__item"
            :class="{
              'app-side-panel__item--active': isActive(item),
              'app-side-panel__item--disabled': !props.ready && item.requiresReady,
            }"
            :aria-current="isActive(item) ? 'page' : undefined"
            :aria-disabled="!props.ready && item.requiresReady ? 'true' : undefined"
            @click="onItemClick(item, $event)"
          >
            <span class="app-side-panel__item-label">{{ t(item.labelKey) }}</span>
          </a>
        </li>
      </ul>
    </nav>
  </InkPopup>
</template>

<style lang="scss" scoped src="./AppSidePanel.scss" />
