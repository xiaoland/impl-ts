import { useI18n } from 'vue-i18n'
import { computed, onUnmounted, ref, shallowRef } from 'vue'
import {
  configStore,
  ExtensionParticipationModel,
  PeerOutcomeUnknown,
  type NativeDistribution,
  type Peer,
} from '@inkcre/core'
import {
  preferredPublishedRelease,
  RegistryReleaseError,
  sortPublishedReleases,
  type ReleaseRecord,
} from '@inkcre/extension-runtime-client-web'
import { getExtensionHost, getExtensionRegistry } from '@/core'
import { selectExtensionPeerVersion } from '@/extension-peer-control'
import type { ExtensionCardData, useExtensionPeerRuntime } from './use-extension-peer-runtime'

/**
 * Version picker dialog: which distribution and published release to run on a
 * peer. Catalog facts (`publishedFormats`) are owned by the peer runtime and
 * written here only on explicit version choices — never by mounting the card.
 *
 * `saveVersion` re-verifies an uncertain outcome (`PeerOutcomeUnknown`) with an
 * independent participation read; it never resends the select command.
 */
export function useExtensionVersionDialog(options: {
  data: ExtensionCardData
  runtime: ReturnType<typeof useExtensionPeerRuntime>
}) {
  const { t } = useI18n()
  const { data, runtime } = options
  const selectedPeer = shallowRef<Peer | null>(null)
  const versionOpen = ref(false)
  const versionLoading = ref(false)
  const versionModel = ref('')
  const distributionModel = ref<NativeDistribution>('module_federation')
  const versionOptions = ref<{ label: string; value: string }[]>([])
  const versionError = ref('')
  const distributionOptions = computed(() =>
    selectedPeer.value
      ? runtime.supportedFormats(selectedPeer.value).map((format) => ({
          label: format === 'python' ? 'Python' : 'Module Federation',
          value: format,
        }))
      : []
  )
  let versionRequest = 0
  onUnmounted(() => {
    versionRequest += 1
  })

  async function openVersion(peer: Peer): Promise<void> {
    selectedPeer.value = peer
    versionError.value = ''
    versionModel.value = ''
    distributionModel.value =
      data.participations.find((row) => row.peer_id === peer.id)?.distribution ??
      runtime.supportedFormats(peer)[0] ??
      'module_federation'
    versionOpen.value = true
    await loadVersions()
  }

  async function loadVersions(): Promise<void> {
    const request = ++versionRequest
    const distribution = distributionModel.value
    const peerId = selectedPeer.value?.id
    versionLoading.value = true
    versionOptions.value = []
    versionError.value = ''
    if (distribution === 'swift_bundled') {
      versionError.value = t('extension.bundledManagedByApp')
      versionLoading.value = false
      return
    }
    const readPublished = async (
      format: 'python' | 'module_federation'
    ): Promise<ReleaseRecord[]> => {
      try {
        const catalog = await getExtensionRegistry().getExtension(data.extension.name, format)
        const releases = sortPublishedReleases(catalog.releases ?? [])
        if (request === versionRequest) runtime.publishedFormats.value[format] = releases.length > 0
        return releases
      } catch (error) {
        if (error instanceof RegistryReleaseError && error.status === 404) {
          if (request === versionRequest) runtime.publishedFormats.value[format] = false
          return []
        }
        if (request === versionRequest) delete runtime.publishedFormats.value[format]
        throw error
      }
    }
    try {
      const releases = await readPublished(distribution)
      if (request !== versionRequest) return
      versionOptions.value = releases.map((release) => ({
        label: release.version,
        value: release.version,
      }))
      const previous = data.participations.find(
        (row) => row.peer_id === peerId && row.distribution === distribution
      )
      versionModel.value = versionOptions.value.some((option) => option.value === previous?.version)
        ? previous!.version
        : (preferredPublishedRelease(releases)?.version ?? '')
      if (!releases.length) {
        // On explicit install, show another published native format without implying this Peer supports it.
        const other = distribution === 'python' ? 'module_federation' : 'python'
        if (runtime.publishedFormats.value[other] === undefined) await readPublished(other)
      }
    } catch (error) {
      if (request === versionRequest)
        versionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (request === versionRequest) versionLoading.value = false
    }
  }

  async function saveVersion(): Promise<void> {
    const peer = selectedPeer.value
    if (!peer || !versionModel.value || versionLoading.value || runtime.busyPeer.value) return
    const distribution = distributionModel.value
    const version = versionModel.value
    const name = data.extension.name
    const meta = { ...configStore.metaConfig }
    const host = getExtensionHost()
    const pickerRequest = versionRequest
    const ownsSelection = () =>
      runtime.ownsConnection(meta) &&
      getExtensionHost() === host &&
      versionOpen.value &&
      versionRequest === pickerRequest &&
      selectedPeer.value?.id === peer.id &&
      distributionModel.value === distribution &&
      versionModel.value === version
    const commandError = await runtime.perform(peer, () =>
      selectExtensionPeerVersion({
        name: data.extension.name,
        nickname: data.extension.nickname ?? data.extension.name,
        releases: getExtensionRegistry(),
        version,
        distribution,
        peer,
        currentPeerId: data.currentPeerId,
        livePeerIds: data.livePeerIds,
        manager: getExtensionHost(),
      })
    )
    if (!ownsSelection()) return
    if (!commandError) {
      versionOpen.value = false
    } else if (commandError instanceof PeerOutcomeUnknown) {
      // This independent read can verify selection through a target Peer restart; never resend select.
      try {
        const observed = await ExtensionParticipationModel.readForConnection(meta, peer.id, name)
        if (
          ownsSelection() &&
          observed?.distribution === distribution &&
          observed.version === version
        ) {
          versionOpen.value = false
        }
      } catch {
        // Keep the original unknown outcome until the exact selection can be observed.
      }
    }
  }

  return {
    selectedPeer,
    versionOpen,
    versionLoading,
    versionModel,
    distributionModel,
    versionOptions,
    versionError,
    distributionOptions,
    openVersion,
    loadVersions,
    saveVersion,
  }
}
