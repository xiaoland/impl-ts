import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from '@/components/toast/toast'
import {
  configStore,
  ExtensionParticipationModel,
  type ExtensionParticipation,
  type ExtensionRuntimeStatus,
  type InstalledExtension,
  type NativeDistribution,
  type Peer,
} from '@inkcre/core'
import { manageExtensionOnPeer } from '@inkcre/extension-runtime-client-web'
import {
  extensionHostRestoreState,
  extensionHostConnectionReady,
  getExtensionHost,
  getExtensionSetupContribution,
  startExtensionHost,
} from '@/core'
import {
  extensionPeerControlMode,
  observeExtensionPeer,
  setExtensionPeerEnabled,
} from '@/extension-peer-control'

/** The card props the runtime reads. Structural, so the component can pass `props` directly. */
export interface ExtensionCardData {
  extension: InstalledExtension
  participations: ExtensionParticipation[]
  peers: Peer[]
  livePeerIds: ReadonlySet<string>
  currentPeerId: string
}

/**
 * Per-peer participation runtime for an extension card: live status observation,
 * enable/uninstall commands, published-distribution catalog facts, and the
 * extension's setup contribution.
 *
 * Request-guarded throughout: `refreshRuntime` samples must not replace the
 * status observed after a command completes (`perform` bumps `runtimeRequest`
 * so the pre-command sample is discarded), and everything connection-scoped
 * checks `ownsConnection` so stale async work dies with a switched connection.
 */
export function useExtensionPeerRuntime(options: {
  data: ExtensionCardData
  onParticipationChanged: () => void
}) {
  const { t } = useI18n()
  const { data } = options
  const statuses = ref<Record<string, ExtensionRuntimeStatus | null>>({})
  const formats = ref<Record<string, NativeDistribution[]>>({})
  const errors = ref<Record<string, string>>({})
  const busyPeer = ref('')
  const refreshing = ref(false)
  const publishedFormats = ref<Partial<Record<NativeDistribution, boolean>>>({})
  const setupContribution = shallowRef(getExtensionSetupContribution(data.extension.name))

  const knownPublishedFormats = computed(() =>
    (['python', 'module_federation'] as const).filter((format) => publishedFormats.value[format])
  )

  const rows = computed(() =>
    data.peers.map((peer) => ({
      peer,
      pin: data.participations.find((row) => row.peer_id === peer.id),
      status: statuses.value[peer.id],
    }))
  )

  let runtimeRequest = 0
  let active = true
  onUnmounted(() => {
    active = false
    runtimeRequest += 1
  })

  function ownsConnection(meta: {
    INKCRE_PGREST_URL: string
    INKCRE_PEER_ID: string
    INKCRE_JWT_SECRET: string
  }): boolean {
    const current = configStore.metaConfig
    return (
      active &&
      meta.INKCRE_PGREST_URL === current.INKCRE_PGREST_URL &&
      meta.INKCRE_PEER_ID === current.INKCRE_PEER_ID &&
      meta.INKCRE_JWT_SECRET === current.INKCRE_JWT_SECRET
    )
  }

  async function refreshCard(): Promise<void> {
    // Catalog facts are populated only by an explicit version choice, never by initial card mounting.
    publishedFormats.value = {}
    await refreshRuntime()
  }

  async function refreshRuntime(): Promise<void> {
    const request = ++runtimeRequest
    refreshing.value = true
    const meta = { ...configStore.metaConfig }
    const host = getExtensionHost()
    const ownsRefresh = () =>
      request === runtimeRequest && ownsConnection(meta) && getExtensionHost() === host
    try {
      if (extensionHostConnectionReady.value && extensionHostRestoreState.value !== 'failed') {
        // Restore attempts every enabled module; a failure still leaves per-module status to inspect.
        await startExtensionHost().catch(() => {})
      }
      if (!ownsRefresh()) return
      await Promise.all(
        data.peers.map(async (peer) => {
          try {
            const result = await observeExtensionPeer({
              name: data.extension.name,
              peer,
              currentPeerId: data.currentPeerId,
              livePeerIds: data.livePeerIds,
              manager: host,
            })
            if (!ownsRefresh()) return
            formats.value[peer.id] = result.supported_distributions
            statuses.value[peer.id] = result.status
            delete errors.value[peer.id]
          } catch (error) {
            if (!ownsRefresh()) return
            statuses.value[peer.id] = null
            errors.value[peer.id] = error instanceof Error ? error.message : String(error)
          }
        })
      )
      if (ownsRefresh())
        setupContribution.value = getExtensionSetupContribution(data.extension.name)
    } finally {
      if (request === runtimeRequest) refreshing.value = false
    }
  }

  function currentHostRestoring(peer: Peer): boolean {
    return peer.id === data.currentPeerId && extensionHostRestoreState.value === 'restoring'
  }

  async function perform(peer: Peer, operation: () => Promise<unknown>): Promise<Error | null> {
    if (busyPeer.value) return null
    busyPeer.value = peer.id
    // A pre-command sample must not replace the status observed after its completion.
    runtimeRequest += 1
    delete errors.value[peer.id]
    let operationError: Error | null = null
    const meta = { ...configStore.metaConfig }
    const host = getExtensionHost()
    const ownsOperation = () => ownsConnection(meta) && getExtensionHost() === host
    try {
      if (currentHostRestoring(peer)) await startExtensionHost().catch(() => {})
      if (!ownsOperation()) return null
      await operation()
    } catch (error) {
      operationError = error instanceof Error ? error : new Error(String(error))
    } finally {
      // A failed command may still have persisted its desired intent.
      if (ownsOperation()) options.onParticipationChanged()
      try {
        if (ownsOperation()) await refreshRuntime()
      } finally {
        if (operationError && ownsOperation()) errors.value[peer.id] = operationError.message
        busyPeer.value = ''
      }
    }
    return operationError
  }

  async function togglePeer(peer: Peer, enabled: boolean): Promise<void> {
    // Disabling on the current browser tears the setup popup down with the module.
    if (!enabled && peer.id === data.currentPeerId) await closeSetup()
    await perform(peer, () =>
      setExtensionPeerEnabled({
        name: data.extension.name,
        peer,
        currentPeerId: data.currentPeerId,
        livePeerIds: data.livePeerIds,
        enabled,
        manager: getExtensionHost(),
      })
    )
  }

  async function removePeer(peer: Peer): Promise<void> {
    const error = await perform(peer, async () => {
      if (peer.id === data.currentPeerId)
        return getExtensionHost().uninstall(data.extension.name, peer.id)
      if (extensionPeerControlMode(peer, data.currentPeerId, data.livePeerIds) === 'remote-host') {
        await manageExtensionOnPeer(peer.id, {
          action: 'unselect',
          extension: data.extension.name,
        })
        return
      }
      const pin = await ExtensionParticipationModel.get(peer.id, data.extension.name)
      if (pin) await pin.remove()
    })
    if (!error) toast.success(t('extension.uninstallSuccess'))
  }

  // --- Setup contribution popup (contribution state is refreshed by refreshRuntime) ---

  const setupOpen = ref(false)
  const setupComponent = shallowRef<Component | null>(null)

  function openSetup(): void {
    setupComponent.value = setupContribution.value?.component ?? null
    setupOpen.value = Boolean(setupComponent.value)
  }

  async function closeSetup(): Promise<void> {
    setupOpen.value = false
    setupComponent.value = null
    await nextTick()
  }

  // --- Display helpers ---

  function distributionLabel(distribution: NativeDistribution | null): string {
    return distribution === 'python'
      ? 'Python'
      : distribution === 'module_federation'
        ? 'Module Federation'
        : distribution === 'swift_bundled'
          ? 'Swift (bundled)'
          : t('extension.distributionUnknown')
  }

  function supportedFormats(peer: Peer): NativeDistribution[] {
    if (peer.id === data.currentPeerId) return ['module_federation']
    const observed = formats.value[peer.id]
    if (observed?.length) return observed
    const previous = data.participations.find((row) => row.peer_id === peer.id)
    return previous?.distribution ? [previous.distribution] : []
  }

  function statusText(peerId: string): string {
    const pin = data.participations.find((row) => row.peer_id === peerId)
    const status = statuses.value[peerId]
    if (status?.restart_required)
      return [
        status.loaded_version
          ? t('extension.runningVersion', { version: status.loaded_version })
          : null,
        t('extension.restartRequired'),
      ]
        .filter(Boolean)
        .join(' · ')
    if (status?.running && status.loaded_version)
      return t('extension.runningVersion', { version: status.loaded_version })
    if (pin?.distribution === null) return t('extension.needsVersionSelection')
    if (!status) return t('extension.runtimeUnknown')
    if (status?.error) return t('extension.startFailed')
    return t('extension.notRunning')
  }

  function noPublishedDistributionForPeer(peer: Peer): boolean {
    const supported = supportedFormats(peer)
    return (
      supported.length > 0 && supported.every((format) => publishedFormats.value[format] === false)
    )
  }

  // --- Lifecycle ---

  watch(() => data.livePeerIds, refreshRuntime)
  watch(extensionHostRestoreState, (state) => {
    if (state === 'restored' || state === 'failed') void refreshRuntime()
  })
  onMounted(refreshRuntime)

  return {
    statuses,
    formats,
    errors,
    busyPeer,
    refreshing,
    publishedFormats,
    knownPublishedFormats,
    setupContribution,
    setupOpen,
    setupComponent,
    rows,
    ownsConnection,
    refreshCard,
    refreshRuntime,
    currentHostRestoring,
    perform,
    togglePeer,
    removePeer,
    openSetup,
    closeSetup,
    distributionLabel,
    supportedFormats,
    statusText,
    noPublishedDistributionForPeer,
  }
}
