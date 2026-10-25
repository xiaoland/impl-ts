<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PeerList from '@/components/peer/peerList/peerList.vue'

const { t } = useI18n()
</script>

<template>
  <main class="peers-view" :aria-label="t('peer.title')">
    <h1 class="sr-only">{{ t('peer.title') }}</h1>
    <PeerList />
  </main>
</template>

<style lang="scss" scoped src="./peers.scss" />
