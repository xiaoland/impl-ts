import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ExtensionModel, ExtensionRegistryOriginResolver, configStore } from '@inkcre/core'
import {
  getExtensionDocumentation,
  type ExtensionDocumentationLink,
} from '@inkcre/extension-runtime-client-web'
import type { JsonEditorValidation } from '@inkcre/ui-web'
import type { ExtensionCardData, useExtensionPeerRuntime } from './use-extension-peer-runtime'

/**
 * Documentation and shared-config dialogs for an extension card. The config
 * editor can pick a schema from any peer that published one; saving updates the
 * shared extension record.
 */
export function useExtensionInfoDialogs(options: {
  data: ExtensionCardData
  runtime: ReturnType<typeof useExtensionPeerRuntime>
  onUpdated: (extension: ExtensionCardData['extension']) => void
}) {
  const { t } = useI18n()
  const { data, runtime, onUpdated } = options

  // --- Documentation ---

  const documentation = ref<ExtensionDocumentationLink[]>([])
  const docsOpen = ref(false)
  const docsLoading = ref(false)
  const docsError = ref('')
  const docsPeerName = ref('')
  let documentationRequest = 0
  onUnmounted(() => {
    documentationRequest += 1
  })

  async function openDocumentation(peer: ExtensionCardData['peers'][number]): Promise<void> {
    const pin = data.participations.find((row) => row.peer_id === peer.id)
    if (!pin?.distribution) return
    const request = ++documentationRequest
    docsPeerName.value = `${peer.name} · ${runtime.distributionLabel(pin.distribution)} ${pin.version}`
    docsOpen.value = true
    docsLoading.value = true
    documentation.value = []
    docsError.value = ''
    if (pin.distribution === 'swift_bundled') {
      docsError.value = t('extension.bundledManagedByApp')
      docsLoading.value = false
      return
    }
    try {
      const origin = await new ExtensionRegistryOriginResolver(
        () => configStore.peerConfig.extension_registry_url
      ).resolve()
      const links =
        (await getExtensionDocumentation(
          origin,
          data.extension.name,
          pin.version,
          pin.distribution
        )) ?? []
      if (request === documentationRequest) documentation.value = links
    } catch (error) {
      if (request === documentationRequest)
        docsError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (request === documentationRequest) docsLoading.value = false
    }
  }

  // --- Shared config ---

  const configOpen = ref(false)
  const configSaving = ref(false)
  const configModel = ref('')
  const schemaPeerId = ref('')
  const configValidation = ref<JsonEditorValidation>()
  const configError = ref('')

  const schemaOptions = computed(() =>
    data.participations
      .filter((row) => row.config_schema && row.distribution)
      .map((row) => ({
        label: `${data.peers.find((peer) => peer.id === row.peer_id)?.name ?? row.peer_id} · ${runtime.distributionLabel(row.distribution)} ${row.version}`,
        value: row.peer_id,
      }))
  )
  const configSchema = computed(
    () =>
      data.participations.find((row) => row.peer_id === schemaPeerId.value)?.config_schema ??
      undefined
  )
  const canSaveConfig = computed(
    () =>
      configValidation.value?.status === 'valid' &&
      configValidation.value.text === configModel.value
  )

  function openConfig(): void {
    configModel.value = JSON.stringify(data.extension.config, null, 2)
    schemaPeerId.value = schemaOptions.value.some((option) => option.value === data.currentPeerId)
      ? data.currentPeerId
      : ''
    configValidation.value = undefined
    configError.value = ''
    configOpen.value = true
  }

  async function saveConfig(): Promise<void> {
    if (configSaving.value || !canSaveConfig.value) return
    configSaving.value = true
    try {
      const config: unknown = JSON.parse(configModel.value)
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new Error(t('common.invalidConfig'))
      const shared = await ExtensionModel.get(data.extension.name)
      if (!shared) throw new Error('Extension no longer exists.')
      onUpdated(await shared.updateConfig(config as Record<string, unknown>))
      configOpen.value = false
    } catch (error) {
      configError.value = error instanceof Error ? error.message : String(error)
    } finally {
      configSaving.value = false
    }
  }

  return {
    documentation,
    docsOpen,
    docsLoading,
    docsError,
    docsPeerName,
    openDocumentation,
    configOpen,
    configSaving,
    configModel,
    schemaPeerId,
    configValidation,
    configError,
    schemaOptions,
    configSchema,
    canSaveConfig,
    openConfig,
    saveConfig,
  }
}
