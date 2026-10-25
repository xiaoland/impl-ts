<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { InkButton, InkDialog, InkDropdown, InkLoading } from '@inkcre/ui-web'
import { extensionCardProps, extensionCardEmits } from './extensionCard'
import { useExtensionPeerRuntime } from './use-extension-peer-runtime'
import { useExtensionVersionDialog } from './use-extension-version-dialog'
import { useExtensionInfoDialogs } from './use-extension-info-dialogs'
import SchemaConfigEditor from '@/components/schemaConfigEditor/schemaConfigEditor.vue'

const props = defineProps(extensionCardProps)
const emit = defineEmits(extensionCardEmits)
const { t } = useI18n()

const runtime = useExtensionPeerRuntime({
  data: props,
  onParticipationChanged: () => emit('participationChanged'),
})
const {
  statuses,
  errors,
  busyPeer,
  refreshing,
  publishedFormats,
  knownPublishedFormats,
  setupContribution,
  setupOpen,
  setupComponent,
  rows,
  refreshCard,
  currentHostRestoring,
  togglePeer,
  removePeer,
  openSetup,
  closeSetup,
  distributionLabel,
  supportedFormats,
  statusText,
  noPublishedDistributionForPeer,
} = runtime

const {
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
} = useExtensionVersionDialog({ data: props, runtime })

const {
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
} = useExtensionInfoDialogs({
  data: props,
  runtime,
  onUpdated: (extension) => emit('updated', extension),
})
</script>

<template>
  <article class="extension-card" :aria-label="extension.nickname ?? extension.name">
    <header class="extension-card__header">
      <div>
        <span class="extension-card__id">{{ extension.nickname ?? extension.name }}</span>
        <p class="extension-card__hint">{{ extension.name }}</p>
      </div>
      <div class="extension-card__actions">
        <InkButton
          v-if="setupContribution"
          :text="t('extension.setup')"
          size="sm"
          theme="primary"
          @click="openSetup"
        />
        <InkButton :text="t('extension.editConfig')" size="sm" @click="openConfig" />
        <InkButton
          :text="t('common.refresh')"
          size="sm"
          :is-loading="refreshing"
          @click="refreshCard"
        />
      </div>
    </header>
    <h3 class="extension-card__hint">{{ t('extension.usedOnPeers') }}</h3>
    <section
      v-for="{ peer, pin, status } in rows"
      :key="peer.id"
      class="extension-card__peer-row"
      :aria-label="peer.name"
    >
      <div>
        <strong>{{ peer.name }}</strong
        ><span v-if="peer.id === currentPeerId"> · {{ t('extension.currentBrowser') }}</span>
        <p class="extension-card__hint">
          {{
            pin
              ? `${distributionLabel(pin.distribution)} · ${pin.version}`
              : t('extension.notInstalled')
          }}
        </p>
        <p v-if="pin" class="extension-card__hint">{{ statusText(peer.id) }}</p>
        <p v-else-if="noPublishedDistributionForPeer(peer)" class="extension-card__hint">
          {{ t('extension.unavailableOnPeer') }}
        </p>
        <p v-if="errors[peer.id] || status?.error" role="alert" class="extension-card__error">
          {{ errors[peer.id] || status?.error }}
        </p>
      </div>
      <div class="extension-card__actions">
        <InkButton
          v-if="supportedFormats(peer).length"
          :text="
            t(
              pin
                ? 'extension.changeVersion'
                : noPublishedDistributionForPeer(peer)
                  ? 'extension.unavailableOnPeer'
                  : 'extension.install'
            )
          "
          size="sm"
          :disabled="
            !!busyPeer ||
            peerSelectionDisabled ||
            currentHostRestoring(peer) ||
            (!pin && noPublishedDistributionForPeer(peer))
          "
          @click="openVersion(peer)"
        />
        <InkButton
          v-if="pin?.distribution"
          :text="
            t(
              pin.enabled || status?.running
                ? 'extension.disableSelected'
                : 'extension.enableSelected'
            )
          "
          size="sm"
          :is-loading="busyPeer === peer.id || (currentHostRestoring(peer) && pin.enabled)"
          :disabled="!!busyPeer || peerSelectionDisabled || currentHostRestoring(peer)"
          @click="togglePeer(peer, !(pin.enabled || status?.running))"
        />
        <InkButton
          v-if="pin?.distribution"
          :text="t('extension.documentation')"
          size="sm"
          theme="subtle"
          @click="openDocumentation(peer)"
        />
        <InkButton
          v-if="pin && !pin.enabled && !status?.running"
          :text="t('extension.removeFromPeer')"
          size="sm"
          theme="subtle"
          :disabled="!!busyPeer || currentHostRestoring(peer)"
          @click="removePeer(peer)"
        />
      </div>
    </section>
    <InkDialog
      v-model="docsOpen"
      :title="t('extension.documentation')"
      :subtitle="docsPeerName"
      :show-confirm="false"
      :cancel-text="t('common.close')"
    >
      <InkLoading v-if="docsLoading" size="xs" variant="spinner" :label="t('common.loading')" />
      <p v-else-if="docsError" role="alert" class="extension-card__error">{{ docsError }}</p>
      <nav v-else-if="documentation.length" class="extension-card__actions">
        <a
          v-for="link in documentation"
          :key="link.scope"
          :href="link.entry_url"
          target="_blank"
          rel="noopener noreferrer"
          >{{ t(`extension.documentationScope.${link.scope}`) }} ↗</a
        >
      </nav>
      <p v-else class="extension-card__hint">{{ t('extension.documentationMissing') }}</p>
    </InkDialog>
    <InkDialog
      v-model="versionOpen"
      :title="
        t(
          participations.some((row) => row.peer_id === selectedPeer?.id)
            ? 'extension.changeVersionTitle'
            : selectedPeer && noPublishedDistributionForPeer(selectedPeer)
              ? 'extension.unavailableOnPeer'
              : 'extension.install'
        )
      "
      :subtitle="selectedPeer?.name"
      :show-confirm="false"
      :show-cancel="false"
    >
      <InkDropdown
        v-if="distributionOptions.length > 1"
        v-model="distributionModel"
        :label="t('extension.distribution')"
        :options="distributionOptions"
        :disabled="versionLoading || !!busyPeer"
        @change="loadVersions"
      />
      <p v-else class="extension-card__hint">
        {{ t('extension.distribution') }}: {{ distributionLabel(distributionModel) }}
      </p>
      <InkLoading
        v-if="versionLoading"
        size="xs"
        variant="spinner"
        :label="t('extension.versionsLoading')"
      />
      <InkDropdown
        v-else-if="versionOptions.length"
        v-model="versionModel"
        :label="t('extension.version')"
        :options="versionOptions"
        :error="versionError"
        :disabled="!!busyPeer"
        required
      />
      <p
        v-if="!versionLoading && publishedFormats[distributionModel] === false"
        class="extension-card__hint"
      >
        {{
          t('extension.noPublishedDistribution', {
            distribution: distributionLabel(distributionModel),
          })
        }}
      </p>
      <p
        v-if="!versionLoading && !versionOptions.length && knownPublishedFormats.length"
        class="extension-card__hint"
      >
        {{ t('extension.publishedDistributions') }}:
        {{ knownPublishedFormats.map(distributionLabel).join(', ') }}
      </p>
      <p v-if="versionError" role="alert" class="extension-card__error">{{ versionError }}</p>
      <p v-if="selectedPeer && errors[selectedPeer.id]" role="alert" class="extension-card__error">
        {{ errors[selectedPeer.id] }}
      </p>
      <template #footer
        ><InkButton
          :text="t('common.cancel')"
          :disabled="!!busyPeer"
          @click="versionOpen = false" /><InkButton
          :text="t('common.save')"
          theme="primary"
          :is-loading="!!busyPeer"
          :disabled="!versionModel || versionLoading || !!versionError"
          @click="saveVersion"
      /></template>
    </InkDialog>
    <InkDialog
      v-model="configOpen"
      :title="t('extension.editConfigTitle')"
      :show-confirm="false"
      :show-cancel="false"
    >
      <InkDropdown
        v-if="schemaOptions.length"
        v-model="schemaPeerId"
        :label="t('extension.configSchemaSource')"
        :options="[{ label: t('extension.jsonConfig'), value: '' }, ...schemaOptions]"
      />
      <SchemaConfigEditor
        v-model="configModel"
        :schema="configSchema"
        :label="t('extension.editConfigTitle')"
        :disabled="configSaving"
        @validation="configValidation = $event"
      />
      <p v-if="configError" role="alert" class="extension-card__error">{{ configError }}</p>
      <template #footer
        ><InkButton
          :text="t('common.cancel')"
          :disabled="configSaving"
          @click="configOpen = false" /><InkButton
          :text="t('common.save')"
          theme="primary"
          :is-loading="configSaving"
          :disabled="!canSaveConfig"
          @click="saveConfig"
      /></template>
    </InkDialog>
    <InkDialog
      v-model="setupOpen"
      :title="t('extension.setupTitle', { name: extension.nickname ?? extension.name })"
      :show-confirm="false"
      :show-cancel="false"
      :close-on-scrim="false"
      @update:model-value="(open) => !open && closeSetup()"
      ><component :is="setupComponent" v-if="setupComponent" @close="closeSetup"
    /></InkDialog>
  </article>
</template>
<style lang="scss" scoped src="./extensionCard.scss" />
