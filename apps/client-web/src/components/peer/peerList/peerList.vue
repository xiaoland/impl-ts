<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { InkButton, InkSkeleton, InkPlaceholder } from '@inkcre/ui-web'
import { RouterLink } from 'vue-router'
import { currentWebPeer } from '@/core'
import {
  configStore,
  Peer,
  PeerManager,
  probePeerReadiness,
  type PeerReadinessObservation,
} from '@inkcre/core'
import PeerCard from '../peerCard/peerCard.vue'

const { t } = useI18n()
const peers = ref<Peer[]>([])
const livePeers = ref(new Set<string>())
const readiness = ref(new Map<string, PeerReadinessObservation>())
const loading = ref(false)
const error = ref('')
const currentPeerId = configStore.metaConfig.INKCRE_PEER_ID
const connected = computed(
  () => !!configStore.metaConfig.INKCRE_PGREST_URL && !!configStore.metaConfig.INKCRE_JWT_SECRET
)

const refreshPeers = async () => {
  if (loading.value || !connected.value) return
  loading.value = true
  error.value = ''
  try {
    const all = await Peer.list()
    peers.value = all
    const self = all.find((peer) => peer.id === currentPeerId)
    if (self) currentWebPeer.value = { id: self.id, name: self.name }
    readiness.value = new Map(
      await Promise.all(all.map(async (peer) => [peer.id, await probePeerReadiness(peer)] as const))
    )
    // Public requests can wake hosted Peers; read their leases after the probes finish.
    const live = await PeerManager.listLive()
    livePeers.value = new Set(live.map((peer) => peer.id))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

const getPeerStatus = (peer: Peer): 'online' | 'offline' | 'unknown' => {
  // Current browser is always online
  if (peer.id === currentPeerId) return 'online'
  if (livePeers.value.has(peer.id)) return 'online'
  if (peer.lease_expires_at === null) return 'unknown'
  return 'offline'
}

onMounted(refreshPeers)
</script>

<template>
  <section class="peer-list">
    <div v-if="connected" class="peer-list__header">
      <InkButton
        :text="t('peer.refresh')"
        size="sm"
        :is-loading="loading"
        :disabled="loading"
        @click="refreshPeers"
      />
    </div>

    <InkPlaceholder v-if="!connected" :title="t('extension.connectDeployment')">
      <template #actions
        ><RouterLink to="/settings">{{ t('common.settings') }}</RouterLink></template
      >
    </InkPlaceholder>
    <div
      v-else-if="loading && peers.length === 0"
      class="peer-list__list"
      role="status"
      :aria-label="t('common.loading')"
    >
      <div v-for="index in 3" :key="index" class="peer-list__skeleton" aria-hidden="true">
        <InkSkeleton style="width: 40%" /><InkSkeleton style="width: 70%" />
      </div>
    </div>
    <InkPlaceholder
      v-else-if="error && peers.length === 0"
      state="error"
      :title="t('peer.listFailed')"
      :description="t('peer.errorDescription')"
    >
      <template #actions>
        <InkButton :text="t('common.retry')" @click="refreshPeers" />
        <details class="peer-list__error-details">
          <summary>{{ t('common.errorDetails') }}</summary>
          <code>{{ error }}</code>
        </details>
      </template>
    </InkPlaceholder>
    <InkPlaceholder v-else-if="peers.length === 0" :title="t('peer.empty')" />
    <div v-else class="peer-list__list">
      <PeerCard
        v-for="peer in peers"
        :key="peer.id"
        :peer="peer"
        :status="getPeerStatus(peer)"
        :current="peer.id === currentPeerId"
        :readiness="readiness.get(peer.id)"
        @updated="refreshPeers"
      />
    </div>
    <div v-if="error && peers.length" class="peer-list__error">
      <p role="alert">{{ t('peer.listFailed') }}</p>
      <details>
        <summary>{{ t('common.details') }}</summary>
        {{ error }}
      </details>
      <InkButton :text="t('common.retry')" size="sm" @click="refreshPeers" />
    </div>
  </section>
</template>

<style lang="scss" scoped src="./peerList.scss" />
