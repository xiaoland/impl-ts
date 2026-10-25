<script setup lang="ts">
import { computed, ref, provide, watchEffect, watch, onMounted } from 'vue'
import { InkButton, InkHeader, InkLoading } from '@inkcre/ui-web'
import AppSidePanel from './components/common/AppSidePanel/AppSidePanel.vue'
import router from './router'
import { createInkRouterAdapter } from './router'
import { INK_ROUTER_KEY } from '@inkcre/ui-web'
import { useRoute } from 'vue-router'
import RecallSearch from './components/recall/RecallSearch.vue'
import { openRecallSearch } from './components/recall/recall-search'
import ToastHost from './components/toast/ToastHost.vue'
import { useI18n } from 'vue-i18n'
import { configStore } from '@inkcre/core'
import {
  currentWebPeer,
  extensionHostConnectionReady,
  webPeerConnectionState,
  initializeCore,
  shouldLoadPeerConfigAtBootstrap,
  startExtensionHost,
  shutdownCore,
} from './core'
import { pageObjectTitle } from './composables/use-page-object-title'

const route = useRoute()
const { t } = useI18n()
const startupState = ref<'loading' | 'ready' | 'failed'>('loading')
const connectionNoticeKey = computed(() => {
  if (webPeerConnectionState.value === 'failed') return 'startup.peerFailed'
  if (webPeerConnectionState.value === 'disabled') return 'startup.peerDisabled'
  return 'startup.peerConnecting'
})
const reload = () => window.location.reload()

onMounted(async () => {
  const loadPeerConfig = shouldLoadPeerConfigAtBootstrap(window.location.pathname)
  try {
    await initializeCore({ loadPeerConfig })
  } catch (error) {
    console.error('[Core] Startup failed:', error)
    startupState.value = 'failed'
    return
  }
  startupState.value = 'ready'

  window.addEventListener('beforeunload', () => {
    // Browsers may end the page before cleanup completes, but never deliberately
    // dispose Extension resources while our Job handlers are still draining.
    void shutdownCore().catch((error: unknown) => console.error('[Core] Shutdown failed', error))
  })
})

watch([startupState, extensionHostConnectionReady], ([startup, connectionReady]) => {
  if (startup !== 'ready' || !connectionReady) return
  void startExtensionHost().catch((error: unknown) => {
    console.error('[Web Extension Host] Startup failed:', error)
  })
})

const pageLabel = computed(() =>
  t(typeof route.meta.titleKey === 'string' ? route.meta.titleKey : 'sidePanel.home')
)
provide(INK_ROUTER_KEY, createInkRouterAdapter(router, route))
watchEffect(() => {
  const parts: string[] = []
  const objectTitle =
    pageObjectTitle.value?.path === route.fullPath ? pageObjectTitle.value.value : undefined
  if (route.name === 'Source')
    parts.push(objectTitle || `${t('navigation.source')} #${route.params.id}`, pageLabel.value)
  else if (route.name === 'Job') parts.push(`${t('navigation.job')} #${route.params.id}`)
  else if (route.name === 'Extensions')
    parts.push(...(objectTitle ? [objectTitle] : []), pageLabel.value)
  else if (route.params.block || route.params.relation) {
    const kind = route.params.relation
      ? 'relation'
      : String(route.name).endsWith('SolvedContent')
        ? 'content'
        : 'block'
    parts.push(`${t(`navigation.${kind}`)} #${route.params.relation || route.params.block}`)
    if (route.path.startsWith('/info-base/graph')) parts.push(t('navigation.graph'))
  } else if (route.name !== 'InfoBaseListOverview' && route.name) parts.push(pageLabel.value)
  else if (
    configStore.metaConfig.INKCRE_PGREST_URL &&
    currentWebPeer.value?.id === configStore.metaConfig.INKCRE_PEER_ID &&
    currentWebPeer.value.name
  )
    parts.push(currentWebPeer.value.name)
  document.title = [...parts, 'InKCre'].join(' - ')
})

// --- data ---
const sidebarExpanded = ref(false)

// --- connection notice ---
// Dismissal is per-connection-state and persisted only for the session; a real
// state change (e.g. disabled → connecting → failed) surfaces a fresh notice.
const CONNECTION_NOTICE_DISMISS_KEY = 'inkcre.connectionNotice.dismissed'
const dismissedNoticeStates = ref<ReadonlySet<string>>(readDismissedNoticeStates())

function readDismissedNoticeStates(): ReadonlySet<string> {
  try {
    const raw = window.sessionStorage.getItem(CONNECTION_NOTICE_DISMISS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

function dismissConnectionNotice(): void {
  const next = new Set(dismissedNoticeStates.value)
  next.add(webPeerConnectionState.value)
  dismissedNoticeStates.value = next
  try {
    window.sessionStorage.setItem(CONNECTION_NOTICE_DISMISS_KEY, JSON.stringify([...next]))
  } catch {
    // sessionStorage may be unavailable (private mode); dismissal is best-effort.
  }
}

watch(webPeerConnectionState, (state) => {
  // A peer that becomes ready clears its dismissal so future notices surface.
  if (state !== 'ready') return
  if (dismissedNoticeStates.value.size === 0) return
  dismissedNoticeStates.value = new Set()
  try {
    window.sessionStorage.removeItem(CONNECTION_NOTICE_DISMISS_KEY)
  } catch {
    // ignore
  }
})

const connectionNoticeVisible = computed(
  () =>
    startupState.value === 'ready' &&
    ['connecting', 'disabled', 'failed'].includes(webPeerConnectionState.value) &&
    !dismissedNoticeStates.value.has(webPeerConnectionState.value)
)
</script>

<template>
  <div class="app">
    <InkHeader
      title="InKCre"
      :page-title="pageLabel"
      logo-src="/logo/32.svg"
      @menu-click="sidebarExpanded = !sidebarExpanded"
      @title-click="startupState === 'ready' && router.push('/')"
    >
      <template #right-icon>
        <button
          v-if="startupState === 'ready'"
          type="button"
          class="app-header-search"
          :aria-label="t('recall.openShortcut')"
          :title="t('recall.openShortcut')"
          @click="openRecallSearch"
        >
          <span class="i-mdi-magnify" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="app-header-menu"
          :aria-label="t('sidePanel.menu')"
          :aria-expanded="sidebarExpanded"
          aria-controls="app-side-panel"
          @click="sidebarExpanded = !sidebarExpanded"
        >
          <span class="i-mdi-menu" aria-hidden="true" />
        </button>
      </template>
    </InkHeader>
    <div
      v-if="connectionNoticeVisible"
      class="app-connection"
      :role="webPeerConnectionState === 'failed' ? 'alert' : 'status'"
    >
      <span class="app-connection__message">{{ t(connectionNoticeKey) }}</span>
      <InkButton v-if="webPeerConnectionState === 'failed'" size="sm" @click="reload">
        {{ t('common.retry') }}
      </InkButton>
      <a href="/settings">{{ t('common.settings') }}</a>
      <button
        type="button"
        class="app-connection__dismiss"
        :aria-label="t('common.close')"
        @click="dismissConnectionNotice"
      >
        <span class="i-mdi-close" aria-hidden="true" />
      </button>
    </div>
    <div class="app-content">
      <router-view v-if="startupState === 'ready'" />
      <main v-else class="app-startup">
        <InkLoading v-if="startupState === 'loading'" :label="t('startup.loading')" />
        <p v-else role="alert">{{ t('startup.failed') }}</p>
        <div class="app-startup__actions">
          <InkButton v-if="startupState === 'failed'" @click="reload">
            {{ t('common.retry') }}
          </InkButton>
          <!-- Full navigation opens Settings' recovery bootstrap without the partial runtime. -->
          <a href="/settings">{{ t('common.settings') }}</a>
        </div>
      </main>
      <AppSidePanel v-model:expanded="sidebarExpanded" :ready="startupState === 'ready'" />
    </div>
    <RecallSearch v-if="startupState === 'ready'" />
    <ToastHost />
  </div>
</template>

<style lang="scss" scoped>
@use '@inkcre/ui-web/styles/functions' as *;
@use '@inkcre/ui-web/styles/mixins' as *;

.app-startup {
  box-sizing: border-box;
  flex: 1;
  padding: sys-var(space, lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: sys-var(space, md);
  text-align: center;

  p {
    margin: 0;
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: sys-var(space, md);
  }
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-connection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: sys-var(space, sm);
  padding: sys-var(space, sm) sys-var(space, md);
  border-bottom: 1px solid sys-var(color, border, subtle);
  background: sys-var(color, surface, subtle);
  color: sys-var(color, text, base);
  @include apply-font(body-sm);

  &__message {
    flex: 1;
    min-inline-size: 0;
  }

  a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  &__dismiss {
    appearance: none;
    background: transparent;
    border: 0;
    padding: sys-var(space, xs);
    margin-inline-start: auto;
    cursor: pointer;
    color: sys-var(color, text, subtle);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-inline-size: sys-var(size, sm);
    min-block-size: sys-var(size, sm);

    &:hover {
      color: sys-var(color, text, base);
    }

    &:focus-visible {
      outline: 2px solid sys-var(color, border, strong);
      outline-offset: 2px;
    }
  }
}

.app-content {
  position: relative;
  flex: 1;
  overflow: hidden;
  display: flex;
  padding-bottom: sys-var(space, lg);
  background: sys-var(color, surface, base);
}

.app-header-search,
.app-header-menu {
  appearance: none;
  background: transparent;
  border: 0;
  padding: sys-var(space, xs);
  cursor: pointer;
  color: sys-var(color, text, subtle);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-inline-size: sys-var(size, md);
  min-block-size: sys-var(size, md);
  font-size: 20px;

  &:hover {
    color: sys-var(color, text, base);
  }

  &:focus-visible {
    outline: 2px solid sys-var(color, border, strong);
    outline-offset: 2px;
  }
}
</style>

<style>
.info-base-inspector-surface {
  border: 1px solid var(--sys-color-border-base);
  box-shadow: 0 3px 12px rgb(0 0 0 / 16%);
}

body {
  margin: 0;
  font-family: var(--sys-typo-family-sans);
  font-size: var(--sys-font-body-md-font-size);
  font-weight: var(--sys-font-body-md-font-weight);
  letter-spacing: var(--sys-font-body-md-letter-spacing);
  line-height: var(--sys-font-body-md-line-height);
  color: var(--sys-color-text-base);
  background: var(--sys-color-surface-base);
}

a {
  color: inherit;
}

/* Visually hidden but present for assistive tech. Use on h1 when the
   InkHeader page-title already conveys the current page visually. */
.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Global keyboard focus indicator. `:where()` keeps specificity at 0 so any
   component-level `:focus-visible` style wins over this baseline. */
:where(a, button, input, select, textarea, summary, [tabindex]:not([tabindex='-1'])):focus-visible {
  outline: 2px solid var(--sys-color-text-base);
  outline-offset: 2px;
  border-radius: 0;
}

/* Honour the user's reduced-motion preference: make every transition and
   animation instantaneous. Component-level `transition: none` rules still win
   where they exist. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* WCAG 2.5.5: on touch-first viewports, interactive elements should be at
   least 44×44px. Desktop retains its denser 36px rhythm. */
@media (max-width: 768px) {
  button,
  [role='button'],
  a,
  input,
  select,
  textarea,
  summary {
    min-height: 44px;
    min-width: 44px;
  }
}
</style>
