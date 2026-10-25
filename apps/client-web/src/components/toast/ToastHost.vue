<script setup lang="ts">
import { toasts, toast } from './toast'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

function onKeydown(event: KeyboardEvent, id: number): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    toast.dismiss(id)
  }
}
</script>

<template>
  <div class="toast-host" role="region" :aria-label="t('toast.regionLabel')">
    <div
      v-for="item in toasts"
      :key="item.id"
      :class="['toast', `toast--${item.kind}`]"
      :role="item.kind === 'error' ? 'alert' : 'status'"
      tabindex="0"
      @keydown="onKeydown($event, item.id)"
    >
      <span class="toast__message">{{ item.message }}</span>
      <button
        type="button"
        class="toast__dismiss"
        :aria-label="t('common.close')"
        @click="toast.dismiss(item.id)"
      >
        <span class="i-mdi-close" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped src="./ToastHost.scss" />
