<script setup lang="ts">
import { computed, onMounted, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  InkForm,
  InkInput,
  InkButton,
  InkDoubleCheck,
  InkDropdown,
  InkSwitch,
} from '@inkcre/ui-web'
import { toast } from '@/components/toast/toast'
import { configStore, MetaConfigSchema, type MetaConfig } from '@inkcre/core'
import { z } from 'zod'
import { setLocale, SUPPORT_LOCALES, LOCALE_NAMES, type SupportLocale } from '@/locales'
import i18n from '@/locales'
import {
  adoptWebPeerRuntime,
  prepareWebPeerConfigurationChange,
  webPeerConnectionState,
  startConfiguredWebPeerRuntime,
  stopWebPeerRuntime,
  WEB_PEER_IDENTITY,
  refreshCurrentWebPeer,
} from '@/core'

const { t } = useI18n()
const telemetryLabelId = useId()

const metaFormConfig = reactive<MetaConfig>({ ...configStore.metaConfig })
const pendingAction = ref<'save' | 'import' | 'reset' | null>(null)
const feedback = ref<{
  action: 'save' | 'import' | 'reset'
  error: boolean
  message: string
} | null>(null)
const hasConnectedConfig = computed(
  () =>
    Boolean(configStore.metaConfig.INKCRE_PGREST_URL) &&
    Boolean(configStore.metaConfig.INKCRE_JWT_SECRET)
)
const formBusy = computed(() => pendingAction.value !== null)
const readinessTimeoutInput = computed({
  get: () => String(metaFormConfig.peer_readiness_timeout_seconds),
  set: (value: string) => {
    metaFormConfig.peer_readiness_timeout_seconds = Number(value)
  },
})
const readinessTimeoutError = computed(() => {
  const result = MetaConfigSchema.safeParse(metaFormConfig)
  return !result.success &&
    result.error.issues.some((issue) => issue.path[0] === 'peer_readiness_timeout_seconds')
    ? t('settings.peerReadinessTimeoutInvalid')
    : ''
})
const leaseRenewIntervalInput = computed({
  get: () =>
    Number.isNaN(metaFormConfig.peer_lease_renew_interval_seconds)
      ? ''
      : String(metaFormConfig.peer_lease_renew_interval_seconds),
  set: (value: string) => {
    metaFormConfig.peer_lease_renew_interval_seconds =
      value.trim() === '' ? Number.NaN : Number(value)
  },
})
const leaseRenewIntervalError = computed(() => {
  const result = MetaConfigSchema.safeParse(metaFormConfig)
  return !result.success &&
    result.error.issues.some((issue) => issue.path[0] === 'peer_lease_renew_interval_seconds')
    ? t('settings.peerLeaseRenewIntervalInvalid')
    : ''
})
const SettingsExportSchema = z.object({
  version: z.literal(2),
  metaConfig: MetaConfigSchema,
  locale: z.enum(SUPPORT_LOCALES),
})

// Synchronize metaFormConfig with configStore.metaConfig
watch(
  () => configStore.metaConfig,
  (newMetaConfig) => {
    Object.assign(metaFormConfig, newMetaConfig)
  },
  { deep: true }
)
onMounted(async () => {
  if (!hasConnectedConfig.value) return
  try {
    await startConfiguredWebPeerRuntime()
  } catch (error) {
    console.warn('Configured Web Peer could not start from Settings.', error)
  }
})

// Current locale (computed for v-model)
const currentLocale = computed({
  get: () => i18n.global.locale.value as string,
  set: (value: string) => {
    setLocale(value as SupportLocale)
  },
})

const onSave = async () => {
  if (formBusy.value) return
  pendingAction.value = 'save'
  feedback.value = null
  try {
    const validatedMeta = MetaConfigSchema.parse(metaFormConfig)
    await prepareWebPeerConfigurationChange(validatedMeta)
    const runtime = await configStore.connectAndSave(validatedMeta, WEB_PEER_IDENTITY)
    await adoptWebPeerRuntime(runtime)
    void refreshCurrentWebPeer()
    Object.assign(metaFormConfig, configStore.metaConfig)
    feedback.value = { action: 'save', error: false, message: t('settings.saveSuccess') }
    toast.success(t('settings.saveSuccess'))
  } catch (error) {
    if (webPeerConnectionState.value === 'idle' && hasConnectedConfig.value)
      webPeerConnectionState.value = 'failed'
    console.error('Failed to save config:', error)
    feedback.value = { action: 'save', error: true, message: t('common.saveFailed') }
    toast.error(t('common.saveFailed'))
  } finally {
    pendingAction.value = null
  }
}

const onReset = async () => {
  if (formBusy.value) return
  pendingAction.value = 'reset'
  feedback.value = null
  try {
    await stopWebPeerRuntime()
    await configStore.resetMeta()
    Object.assign(metaFormConfig, configStore.metaConfig)
  } catch {
    feedback.value = { action: 'reset', error: true, message: t('common.saveFailed') }
  } finally {
    pendingAction.value = null
  }
}

const onExport = () => {
  const portableConfig = SettingsExportSchema.parse({
    version: 2,
    metaConfig: configStore.metaConfig,
    locale: currentLocale.value,
  })
  const configJson = JSON.stringify(portableConfig, null, 2)
  const blob = new Blob([configJson], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'inkcre-config.json'
  a.click()
  URL.revokeObjectURL(url)
}

const fileInput = ref<HTMLInputElement | null>(null)

const onImport = () => {
  if (formBusy.value) return
  fileInput.value?.click()
}

const onFileSelected = async (event: Event) => {
  if (formBusy.value) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  pendingAction.value = 'import'
  feedback.value = null
  try {
    const imported = SettingsExportSchema.parse(JSON.parse(await file.text()))
    await prepareWebPeerConfigurationChange(imported.metaConfig)
    const runtime = await configStore.connectAndSave(imported.metaConfig, WEB_PEER_IDENTITY)
    await adoptWebPeerRuntime(runtime)
    void refreshCurrentWebPeer()
    await setLocale(imported.locale)
    Object.assign(metaFormConfig, configStore.metaConfig)
    feedback.value = { action: 'import', error: false, message: t('settings.importSuccess') }
  } catch (error) {
    if (webPeerConnectionState.value === 'idle' && hasConnectedConfig.value)
      webPeerConnectionState.value = 'failed'
    console.error('Failed to import config:', error)
    feedback.value = { action: 'import', error: true, message: t('settings.importError') }
  } finally {
    pendingAction.value = null
  }
  input.value = ''
}
</script>

<template>
  <main class="settings-view" :aria-label="t('settings.title')">
    <h1 class="sr-only">{{ t('settings.title') }}</h1>
    <InkForm
      layout="col"
      class="settings-view__form"
      :aria-label="t('settings.metaConfig')"
      @submit="onSave"
    >
      <fieldset class="settings-view__group">
        <legend>{{ t('settings.deploymentConnection') }}</legend>
        <InkInput
          v-model="metaFormConfig.INKCRE_PGREST_URL"
          :label="t('settings.pgrestUrl')"
          placeholder="https://..."
          :disabled="formBusy"
        />
        <InkInput
          v-model="metaFormConfig.INKCRE_JWT_SECRET"
          :label="t('settings.jwtSecret')"
          native-type="password"
          autocomplete="off"
          placeholder="••••••••"
          :disabled="formBusy"
        />
      </fieldset>

      <fieldset class="settings-view__group">
        <legend>{{ t('settings.peerRuntime') }}</legend>
        <InkInput
          v-model="readinessTimeoutInput"
          :label="t('settings.peerReadinessTimeout')"
          :error="readinessTimeoutError"
          native-type="number"
          min="1"
          max="300"
          step="1"
          :disabled="formBusy"
        />
        <InkInput
          v-model="leaseRenewIntervalInput"
          :label="t('settings.peerLeaseRenewInterval')"
          :error="leaseRenewIntervalError"
          native-type="number"
          min="0"
          max="86400"
          step="1"
          :disabled="formBusy"
        />
        <p v-if="metaFormConfig.peer_lease_renew_interval_seconds === 0">
          {{ t('settings.backgroundDisabledEffect') }}
        </p>
      </fieldset>

      <fieldset class="settings-view__group">
        <legend>{{ t('settings.telemetry') }}</legend>
        <div class="settings-view__switch-field">
          <span :id="telemetryLabelId">{{ t('settings.telemetryEnabled') }}</span>
          <InkSwitch
            v-model="metaFormConfig.telemetry_enabled"
            :disabled="formBusy"
            :aria-labelledby="telemetryLabelId"
          />
        </div>
        <InkInput
          v-model="metaFormConfig.telemetry_peer_relay_url"
          :label="t('settings.telemetryRelay')"
          placeholder="https://..."
          :disabled="formBusy"
        />
        <p>{{ t('settings.telemetryRelayDefault') }}</p>
      </fieldset>

      <div class="settings-view__actions">
        <InkButton
          :text="t('settings.saveConfig')"
          theme="primary"
          :disabled="formBusy"
          :is-loading="pendingAction === 'save'"
          native-type="submit"
        />
      </div>
      <p
        v-if="feedback?.action === 'save'"
        :role="feedback.error ? 'alert' : 'status'"
        :class="{ 'text-feedback-error': feedback.error }"
      >
        {{ feedback.message }}
      </p>
    </InkForm>

    <section class="settings-view__section" :aria-label="t('settings.languageLabel')">
      <InkDropdown
        v-model="currentLocale"
        :label="t('settings.languageLabel')"
        :options="SUPPORT_LOCALES.map((locale) => ({ value: locale, label: LOCALE_NAMES[locale] }))"
        :disabled="formBusy"
      />
    </section>

    <section class="settings-view__section" :aria-label="t('settings.backup')">
      <h2>{{ t('settings.backup') }}</h2>
      <div class="settings-view__actions">
        <InkButton :text="t('settings.exportConfig')" :disabled="formBusy" @click="onExport" />
        <InkButton
          :text="t('settings.importConfig')"
          :disabled="formBusy"
          :is-loading="pendingAction === 'import'"
          @click="onImport"
        />
        <InkDoubleCheck
          :title="t('settings.resetConfirmTitle')"
          :message="t('settings.resetConfirmMessage')"
          @confirm="onReset"
        >
          <InkButton
            :text="t('settings.resetConfig')"
            theme="danger"
            :disabled="formBusy"
            :is-loading="pendingAction === 'reset'"
          />
        </InkDoubleCheck>
      </div>
      <p
        v-if="feedback && feedback.action !== 'save'"
        :role="feedback.error ? 'alert' : 'status'"
        :class="{ 'text-feedback-error': feedback.error }"
      >
        {{ feedback.message }}
      </p>

      <input
        ref="fileInput"
        type="file"
        accept=".json"
        style="display: none"
        @change="onFileSelected"
      />
    </section>
  </main>
</template>

<style lang="scss" scoped src="./settings.scss"></style>
