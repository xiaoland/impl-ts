<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAsyncState, useIntervalFn } from '@vueuse/core'
import { InkLoading, InkButton, InkField, InkSkeleton } from '@inkcre/ui-web'
import LogsViewer from '@/components/obsrv/LogsViewer/LogsViewer.vue'
import { formatTypeId } from '@/utils/format'
import { APIError, Job, JobStatus, Source, telemetryDiagnosticsUrl } from '@inkcre/core'
import dayjs from 'dayjs'

const route = useRoute()
const { t } = useI18n()

// --- data ---
const jobId = computed(() => Number(route.params.id))
const pollingInterval = computed(() => (isRunning.value ? 1500 : 5000))

const {
  state: job,
  isLoading: jobLoading,
  error: jobError,
  executeImmediate: refetchJob,
} = useAsyncState(() => Job.get(jobId.value), null, {
  immediate: false,
  resetOnExecute: false,
  onError: () => {},
})
const jobMissing = computed(
  () => jobError.value instanceof APIError && jobError.value.status === 404
)

const {
  state: source,
  executeImmediate: refetchSource,
  isLoading: sourceLoading,
  error: sourceError,
} = useAsyncState(
  async () => {
    const sourceRef = job.value?.parameters.source
    if (typeof sourceRef === 'number') {
      return await Source.get(sourceRef)
    }
    return null
  },
  null,
  { immediate: false, onError: () => {} }
)

// --- logs ---
const enableLogsPolling = computed(() => isRunning.value)

// --- computed ---
const isRunning = computed(() => job.value?.status === JobStatus.RUNNING)

const formattedState = computed(() => {
  return JSON.stringify(job.value?.state || {}, null, 2)
})
const jobFailureDetails = computed(() => {
  const error = job.value?.state.error
  return typeof error === 'string' ? error : null
})

const statusColor = computed(() => {
  if (!job.value) return ''
  switch (job.value.status) {
    case JobStatus.PENDING:
      return 'status--pending'
    case JobStatus.RUNNING:
      return 'status--running'
    case JobStatus.FINISHED:
      return 'status--finished'
    case JobStatus.FAILED:
      return 'status--failed'
    default:
      return ''
  }
})

// --- methods ---
const formatDate = (date: Date | null) => {
  if (!date) return t('job.notAvailable')
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss')
}

// --- watchers ---
watch(
  () => job.value?.parameters.source,
  () => void refetchSource(),
  { immediate: true }
)

const { pause: pausePolling, resume: resumePolling } = useIntervalFn(
  () => {
    if (!jobLoading.value) void refetchJob()
  },
  pollingInterval,
  { immediate: false }
)

watch([job, jobError], () => {
  if (job.value && !job.value.isTerminal && !jobError.value) resumePolling()
  else pausePolling()
})

watch(
  jobId,
  () => {
    job.value = null
    void refetchJob()
  },
  { immediate: true }
)
</script>

<template>
  <main class="job-view" :aria-label="`${t('navigation.job')} #${jobId}`">
    <div
      v-if="jobLoading && !job"
      class="job-view__metadata"
      role="status"
      :aria-label="t('common.loading')"
    >
      <InkSkeleton style="width: 45%; height: 1.5rem" />
      <div v-for="index in 6" :key="index" class="job-view__skeleton-row">
        <InkSkeleton style="width: 25%" />
        <InkSkeleton style="width: 65%" />
      </div>
    </div>
    <div v-if="jobError" class="job-view__error" role="alert">
      <span>{{ jobMissing ? t('job.notFound') : t('job.loadFailed') }}</span>
      <details v-if="!jobMissing">
        <summary>{{ t('common.errorDetails') }}</summary>
        <p>{{ jobError instanceof Error ? jobError.message : String(jobError) }}</p>
      </details>
      <InkButton
        :text="t('common.retry')"
        :is-loading="jobLoading"
        :disabled="jobLoading"
        @click="refetchJob()"
      />
      <InkButton :text="t('common.back')" theme="subtle" size="sm" @click="$router.back()" />
    </div>
    <!-- Content -->
    <template v-if="job && !jobMissing">
      <!-- Left Section: Metadata -->
      <section class="job-view__metadata">
        <div class="metadata__header">
          <h1 class="metadata__title">{{ t('navigation.job') }} #{{ job.id }}</h1>
        </div>

        <InkField :label="t('job.jobId')">
          <span class="metadata__value">{{ job.id }}</span>
        </InkField>

        <a
          v-if="telemetryDiagnosticsUrl"
          :href="telemetryDiagnosticsUrl"
          target="_blank"
          rel="noopener noreferrer"
          >{{ t('job.openDiagnostics') }}</a
        >

        <InkField :label="t('job.status')">
          <div class="flex items-center gap-2" :aria-busy="jobLoading">
            <span class="metadata__value" :class="statusColor">
              {{ job.status }}
            </span>
            <InkLoading v-if="jobLoading" variant="spinner" size="xs" aria-hidden="true" />
          </div>
        </InkField>

        <InkField :label="t('job.source')">
          <InkLoading
            v-if="sourceLoading"
            variant="spinner"
            size="sm"
            :label="t('common.loading')"
          />
          <div v-else-if="sourceError" class="metadata__value" role="alert">
            <span>{{ t('job.sourceLoadFailed') }}</span>
            <InkButton :text="t('common.retry')" size="sm" @click="refetchSource()" />
          </div>
          <div v-else-if="source" class="metadata__value">
            <div class="source-info">
              <span class="source-info__type">{{ formatTypeId(source.type) }}</span>
              <span class="source-info__nickname">{{ source.nickname }}</span>
              <span class="source-info__id">#{{ source.id }}</span>
            </div>
          </div>
          <span v-else class="metadata__value">
            {{ t('job.sourceNotFound') }}
          </span>
        </InkField>

        <InkField :label="t('job.createdAt')">
          <span class="metadata__value">{{ formatDate(job.created_at) }}</span>
        </InkField>

        <InkField :label="t('job.startedAt')">
          <span class="metadata__value">{{ formatDate(job.started_at) }}</span>
        </InkField>

        <InkField :label="t('job.closedAt')">
          <span class="metadata__value">{{ formatDate(job.closed_at) }}</span>
        </InkField>

        <InkField v-if="jobFailureDetails !== null" :label="t('common.errorDetails')">
          <pre class="metadata__value" :aria-label="t('common.errorDetails')">{{
            jobFailureDetails
          }}</pre>
        </InkField>

        <InkField :label="t('job.state')">
          <pre class="metadata__value" :aria-label="t('job.state')">{{ formattedState }}</pre>
        </InkField>
      </section>

      <!-- Right Section: Logs -->
      <section class="job-view__logs">
        <h2 class="job-view__logs__title">{{ t('logs.title') }}</h2>
        <LogsViewer
          v-if="job"
          class="flex-1 w-full"
          :trace-id="`job.${job.id}`"
          :enable-polling="enableLogsPolling"
          :polling-interval="pollingInterval"
        />
      </section>
    </template>
  </main>
</template>

<style lang="scss" scoped src="./job.scss" />
