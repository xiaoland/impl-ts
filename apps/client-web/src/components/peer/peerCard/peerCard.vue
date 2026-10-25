<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { InkButton, InkDialog, InkInput, type JsonEditorValidation } from '@inkcre/ui-web'
import { toast } from '@/components/toast/toast'
import SchemaConfigEditor from '@/components/schemaConfigEditor/schemaConfigEditor.vue'
import {
  configStore,
  ExtensionParticipationModel,
  Peer,
  PeerConfigSchema,
  PeerManager,
} from '@inkcre/core'
import { peerCardEmits, peerCardProps } from './peerCard'
import { currentWebPeer } from '@/core'

const props = defineProps(peerCardProps)
const emit = defineEmits(peerCardEmits)
const { t } = useI18n()

const configPopupOpen = ref(false)
const configModel = ref('{}')
const configValidation = ref<JsonEditorValidation>()
const savingConfig = ref(false)
const configError = ref('')
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref('')
const capabilitiesOpen = ref(false)
const showRawCapabilities = ref(false)

const diagnostics = computed(() =>
  props.readiness && props.readiness.status !== 'unavailable' ? props.readiness.diagnostics : null
)

const hasIssues = computed(() => {
  if (!diagnostics.value) return false
  const db = diagnostics.value.database
  return Object.values(db).some(
    (c: any) => c && typeof c === 'object' && (c.status === 'error' || c.problems?.length)
  )
})

function openDelete() {
  deleteError.value = ''
  deleteOpen.value = true
}

const canSaveConfig = computed(
  () =>
    configValidation.value?.status === 'valid' && configValidation.value.text === configModel.value
)

function openConfig() {
  configModel.value = JSON.stringify(props.peer.config, null, 2)
  configValidation.value = undefined
  configError.value = ''
  configPopupOpen.value = true
}

const saveError = ref('')

const savePeer = async () => {
  saveError.value = ''
  try {
    await props.peer.save()
    if (props.current) currentWebPeer.value = { id: props.peer.id, name: props.peer.name }
    emit('updated')
    toast.success(t('peer.saveSuccess'))
  } catch (error) {
    console.error('Failed to update Peer:', error)
    saveError.value = error instanceof Error ? error.message : t('common.saveFailed')
    toast.error(t('common.saveFailed'))
  }
}

const onConfirmConfig = async () => {
  if (savingConfig.value || !canSaveConfig.value) return
  savingConfig.value = true
  configError.value = ''
  try {
    const updated = Peer.parse({ ...props.peer, config: JSON.parse(configModel.value) })
    await updated.saveConfig()
    props.peer.config = updated.config
    if (props.current) configStore.peerConfig = PeerConfigSchema.parse(updated.config)
    emit('updated')
    configPopupOpen.value = false
  } catch (error) {
    configError.value = error instanceof Error ? error.message : t('common.saveFailed')
  } finally {
    savingConfig.value = false
  }
}

const onConfirmDelete = async () => {
  if (deleting.value || props.current) return
  deleting.value = true
  deleteError.value = ''
  try {
    const live = await PeerManager.listLive()
    if (live.some((peer) => peer.id === props.peer.id)) {
      deleteError.value = t('peer.deleteOnline')
      emit('updated')
      return
    }
    const extensions = await ExtensionParticipationModel.list(props.peer.id)
    for (const extension of extensions) {
      if (extension.enabled) await extension.setEnabled(false)
      await (await ExtensionParticipationModel.get(props.peer.id, extension.name))?.remove()
    }
    await props.peer.delete()
    deleteOpen.value = false
    emit('updated')
    toast.success(t('peer.deleteSuccess'))
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : t('peer.deleteFailed')
  } finally {
    deleting.value = false
  }
}

const statusConfig = computed(() => {
  const config = {
    online: { text: t('peer.statusOnline'), class: 'peer-card__status--online' },
    offline: { text: t('peer.statusOffline'), class: 'peer-card__status--offline' },
    unknown: { text: t('peer.statusUnknown'), class: 'peer-card__status--unknown' },
  }
  return config[props.status]
})

const formatCapability = (cap: unknown): string => {
  if (typeof cap === 'string') return cap
  if (cap && typeof cap === 'object' && 'id' in cap) {
    return String((cap as { id: unknown }).id)
  }
  return JSON.stringify(cap)
}
</script>

<template>
  <article class="entity-card peer-card">
    <header class="entity-card__header">
      <div class="entity-card__title-group">
        <h3 class="entity-card__title peer-card__title">
          <InkInput v-model="peer.name" type="inline" @confirm="savePeer" />
        </h3>
        <span :class="['peer-card__status-badge', statusConfig.class]">
          {{ statusConfig.text }}
        </span>
        <span v-if="current" class="peer-card__status-badge peer-card__status--current">
          {{ t('peer.current') }}
        </span>
        <button
          v-if="peer.capabilities.length > 0"
          type="button"
          class="peer-card__status-badge peer-card__status--capabilities peer-card__capabilities-btn"
          @click="capabilitiesOpen = true"
        >
          {{ t('peer.capabilitiesCount', { count: peer.capabilities.length }) }}
        </button>
      </div>
      <div class="entity-card__actions peer-card__actions">
        <InkButton :text="t('peer.editConfig')" size="sm" @click="openConfig" />
        <InkButton
          v-if="!current"
          :text="t('peer.delete')"
          size="sm"
          theme="danger"
          :disabled="status === 'online'"
          @click="openDelete"
        />
      </div>
    </header>

    <div class="entity-card__meta">
      <span>{{
        peer.application_version ? `v${peer.application_version}` : t('peer.versionUnknown')
      }}</span>
    </div>

    <p v-if="saveError" role="alert" class="peer-card__save-error text-feedback-error">
      {{ saveError }}
    </p>

    <!-- Readiness warning -->
    <div v-if="diagnostics && hasIssues" class="peer-card__readiness-warning" role="alert">
      <p>{{ t('peer.readinessIssues') }}</p>
    </div>
    <div v-else-if="readiness?.status === 'unavailable'" class="peer-card__readiness-unavailable">
      <p>{{ t(`peer.readinessUnavailable.${readiness.reason}`) }}</p>
    </div>

    <!-- Config dialog -->
    <InkDialog v-model="configPopupOpen" :title="t('peer.editConfig')" :is-loading="savingConfig">
      <SchemaConfigEditor
        v-model="configModel"
        :schema="peer.config_schema"
        :label="t('peer.editConfig')"
        :disabled="savingConfig"
        @validation="configValidation = $event"
      />
      <p v-if="configError" role="alert" class="text-feedback-error">{{ configError }}</p>
      <template #footer>
        <InkButton :text="t('common.cancel')" @click="configPopupOpen = false" />
        <InkButton
          :text="t('common.save')"
          theme="primary"
          :is-loading="savingConfig"
          :disabled="!canSaveConfig"
          @click="onConfirmConfig"
        />
      </template>
    </InkDialog>

    <!-- Capabilities dialog -->
    <InkDialog
      v-model="capabilitiesOpen"
      :title="t('peer.capabilitiesList')"
      :show-confirm="false"
      :cancel-text="t('common.close')"
    >
      <div class="peer-card__capabilities-header">
        <button
          type="button"
          class="peer-card__view-toggle"
          @click="showRawCapabilities = !showRawCapabilities"
        >
          {{ showRawCapabilities ? t('peer.viewFormatted') : t('peer.viewRaw') }}
        </button>
      </div>

      <!-- Formatted view -->
      <ul v-if="!showRawCapabilities" class="peer-card__capabilities-list">
        <li v-for="(cap, index) in peer.capabilities" :key="index">
          <code>{{ formatCapability(cap) }}</code>
        </li>
      </ul>

      <!-- Raw JSON view -->
      <pre v-else class="peer-card__capabilities-raw">{{
        JSON.stringify(peer.capabilities, null, 2)
      }}</pre>
    </InkDialog>

    <!-- Delete dialog -->
    <InkDialog
      v-model="deleteOpen"
      :title="t('peer.delete')"
      :confirm-text="t('peer.delete')"
      :cancel-text="t('common.cancel')"
      :is-loading="deleting"
      @confirm="onConfirmDelete"
    >
      <div class="peer-card__delete-info">
        <p class="peer-card__delete-name">{{ peer.name }}</p>
        <code class="peer-card__delete-id">{{ peer.id }}</code>
      </div>
      <p>{{ t('peer.deleteConfirm') }}</p>
      <p v-if="status === 'online'" class="peer-card__delete-warning">
        {{ t('peer.deleteOnline') }}
      </p>
      <p v-if="deleteError" role="alert" class="text-feedback-error">{{ deleteError }}</p>
    </InkDialog>
  </article>
</template>

<style lang="scss" scoped src="./peerCard.scss" />
