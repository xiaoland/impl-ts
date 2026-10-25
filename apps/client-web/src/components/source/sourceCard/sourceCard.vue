<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { InkButton } from '@inkcre/ui-web'
import type { SourceCardProps } from './sourceCard'
import { Job, JobManager, JobStatus } from '@inkcre/core'
import { useAsyncState } from '@vueuse/core'

const props = defineProps<SourceCardProps>()
const { t } = useI18n()
const router = useRouter()
const {
  state: jobs,
  isLoading,
  error: jobsError,
  execute: loadJobs,
} = useAsyncState(() => Job.getBySource(props.source.id), [], {
  // Loading errors are shown on this row with an explicit retry action.
  onError: () => undefined,
})
const openJob = computed(() =>
  jobs.value.find((job) => job.status === JobStatus.PENDING || job.status === JobStatus.RUNNING)
)

const lastJob = computed(() => {
  if (!jobs.value.length) return null
  return jobs.value[0]
})

const lastJobStatus = computed(() => lastJob.value?.status || null)

const hasRunningJob = computed(() => !!openJob.value)

const running = ref(false)
const runError = ref('')

const sourceTypeFull = computed(() => props.source.type)

async function onRunNow() {
  if (running.value) return
  running.value = true
  runError.value = ''
  try {
    const job = await JobManager.create('core.source.collect.v1', {
      source: props.source.id,
      config: {},
    })
    jobs.value = [job, ...jobs.value]
    await router.push(`/jobs/${job.id}`)
  } catch {
    runError.value = t('source.runFailed')
  } finally {
    running.value = false
  }
}
</script>

<template>
  <article class="source-card">
    <div class="source-card__identity">
      <RouterLink :to="`/sources/${source.id}`" class="source-card__name">{{
        source.nickname || t('source.unnamed')
      }}</RouterLink>
      <div class="source-card__metadata">
        <code class="source-card__type">{{ sourceTypeFull }}</code>
        <span class="source-card__id">#{{ source.id }}</span>
      </div>
      <div v-if="lastJob" class="source-card__last-job">
        <span
          class="source-card__status-dot"
          :class="`source-card__status-dot--${lastJobStatus?.toLowerCase()}`"
        />
        <span class="source-card__last-job-time">{{ lastJob.created_at?.toLocaleString() }}</span>
      </div>
    </div>
    <div class="source-card__operations">
      <span v-if="isLoading" role="status" class="source-card__loading">{{
        t('source.jobsLoading')
      }}</span>
      <template v-else-if="jobsError">
        <span role="alert" class="text-feedback-error">{{ t('source.jobsFailed') }}</span>
        <InkButton :text="t('source.retry')" theme="subtle" size="sm" @click="loadJobs()" />
      </template>
      <RouterLink v-else-if="openJob" :to="`/jobs/${openJob.id}`" class="source-card__running-link">
        <span class="source-card__status-dot source-card__status-dot--running" />
        {{ t('source.checkOpenJob') }}
      </RouterLink>
      <InkButton
        v-else
        :text="t('source.runNow')"
        theme="subtle"
        size="sm"
        :is-loading="running"
        @click="onRunNow"
      />
    </div>
    <p v-if="runError" role="alert" class="source-card__error text-feedback-error">
      {{ runError }}
    </p>
  </article>
</template>

<style lang="scss" scoped src="./sourceCard.scss" />
