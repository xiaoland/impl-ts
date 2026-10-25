<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import {
  RouterLink,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  InkLoading,
  InkSkeleton,
  InkButton,
  InkDialog,
  InkPopup,
  InkDropdown,
  InkInput,
  InkForm,
  InkTabs,
} from '@inkcre/ui-web'
import SourceForm from '@/components/source/sourceForm/sourceForm.vue'
import SchemaConfigEditor from '@/components/schemaConfigEditor/schemaConfigEditor.vue'
import JobCard from '@/components/job/JobCard/JobCard.vue'
import { humanizeCron } from '@/utils/cron'
import { Source } from '@inkcre/core'
import { usePageObjectTitle } from '@/composables/use-page-object-title'
import { useSourceDetail } from './use-source-detail'
import { useJobCreator } from './use-job-creator'
import { useCronManager } from './use-cron-manager'

type TabId = 'overview' | 'config' | 'schedules' | 'jobs'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const sourceId = computed(() => Number(route.params.id))

const {
  source,
  draft,
  sourceLoading,
  sourceLoadError,
  sourceSaving,
  sourceError,
  sourceSaved,
  deleteOpen,
  sourceDeleting,
  deleteError,
  jobs,
  jobsLoading,
  jobsError,
  crons,
  cronsLoading,
  cronsError,
  loadSource,
  loadJobs,
  loadCrons,
  sourceTypeFull,
  lastJob,
  lastJobStatus,
  lastJobTime,
  cronCount,
  enabledCronCount,
  jobCount,
  runningJob,
} = useSourceDetail(sourceId)

usePageObjectTitle(
  computed(() =>
    source.value?.id === sourceId.value ? source.value.nickname || undefined : undefined
  )
)

const editor = useTemplateRef('editor')

const {
  jobKind,
  jobConfig,
  jobValidation,
  jobError,
  jobSaving,
  newJobOpen,
  canCreateJob,
  onNewJob,
  onCloseJob,
  onCreateJob,
} = useJobCreator({
  sourceId,
  jobs,
  isBusy: () => busy.value,
  onCreated: (job) => router.push(`/jobs/${job.id}`),
})

const {
  cronSchedule,
  cronCreateError,
  cronSaving,
  cronAction,
  newCronOpen,
  cronToDelete,
  cronError,
  onNewCron,
  onCloseCron,
  onCreateCron,
  onRunCron,
  onRequestDeleteCron,
  onDeleteCron,
} = useCronManager({ sourceId, crons, isBusy: () => busy.value })

const busy = computed(
  () =>
    sourceLoading.value ||
    sourceSaving.value ||
    sourceDeleting.value ||
    jobsLoading.value ||
    cronsLoading.value ||
    jobSaving.value ||
    cronSaving.value ||
    Boolean(cronAction.value)
)

// Tabs state
const activeTab = ref<TabId>('overview')
const tabs = computed(() => [
  { value: 'overview' as TabId, label: t('source.tab.overview') },
  { value: 'config' as TabId, label: t('source.tab.config') },
  { value: 'schedules' as TabId, label: t('source.tab.schedules') },
  { value: 'jobs' as TabId, label: t('source.tab.jobs') },
])

// Generate unique IDs for ARIA associations
const baseId = `source-tabs-${Math.random().toString(36).substr(2, 9)}`
function getTabId(value: string): string {
  return `${baseId}-tab-${value}`
}

function setTab(tab: string) {
  activeTab.value = tab as TabId
}

function canLeave(): boolean {
  const dirty =
    Boolean(draft.value && editor.value?.isDirty) ||
    (newJobOpen.value && jobConfig.value !== '{}') ||
    (newCronOpen.value && cronSchedule.value !== '0 * * * *')
  return !busy.value && (!dirty || window.confirm(t('source.discardChanges')))
}
onBeforeRouteLeave(canLeave)
onBeforeRouteUpdate((to) => to.params.id === route.params.id || canLeave())

async function onSaveSource() {
  if (busy.value || !draft.value || !editor.value) return
  if (!editor.value.canSave) return
  sourceSaving.value = true
  sourceError.value = ''
  sourceSaved.value = false
  try {
    const saved = await draft.value.save()
    if (source.value) source.value = Source.parse(saved)
    draft.value = Source.parse(saved)
    sourceSaved.value = true
  } catch {
    sourceError.value = t('common.saveFailed')
  } finally {
    sourceSaving.value = false
  }
}

function onRequestDeleteSource() {
  if (busy.value) return
  deleteError.value = ''
  deleteOpen.value = true
}

async function onDeleteSource() {
  if (busy.value || !source.value) return
  sourceDeleting.value = true
  deleteError.value = ''
  try {
    await source.value.delete()
  } catch {
    deleteError.value = t('source.deleteFailed')
    return
  } finally {
    sourceDeleting.value = false
  }
  deleteOpen.value = false
  draft.value = null
  await router.push('/sources')
}
</script>

<template>
  <main class="source-view">
    <nav :aria-label="t('common.back')">
      <RouterLink :to="{ path: '/sources', hash: `#source-${sourceId}` }" class="source-view__back">
        <span aria-hidden="true">←</span> {{ t('source.backToSources') }}
      </RouterLink>
    </nav>
    <div
      v-if="sourceLoading"
      class="source-view__skeleton"
      role="status"
      :aria-label="t('common.loading')"
    >
      <InkSkeleton style="width: 40%; height: 1.5rem" /><InkSkeleton style="width: 65%" />
    </div>
    <div v-else-if="sourceLoadError" class="source-view__feedback">
      <p role="alert" class="text-feedback-error">{{ t('source.detailFailed') }}</p>
      <InkButton :text="t('source.retry')" theme="subtle" @click="loadSource" />
    </div>
    <template v-else-if="source && draft">
      <header class="source-view__header">
        <h1>{{ source.nickname || t('source.unnamed') }}</h1>
        <div class="source-view__metadata">
          <code class="source-view__type">{{ sourceTypeFull }}</code>
          <span class="source-view__id">#{{ source.id }}</span>
        </div>
      </header>

      <!-- Tabs Navigation -->
      <InkTabs
        ref="tabsRef"
        v-model="activeTab"
        :tabs="tabs"
        :label="t('source.tab.overview')"
        class="source-view__tabs"
        @update:model-value="setTab"
      />

      <!-- Tab Content -->
      <div class="source-view__tab-content">
        <!-- Overview Tab -->
        <section
          v-if="activeTab === 'overview'"
          class="source-view__tab-panel"
          role="tabpanel"
          :aria-labelledby="getTabId('overview')"
        >
          <div class="source-view__overview-grid">
            <div class="source-view__overview-card">
              <h3>{{ t('source.info') }}</h3>
              <dl class="source-view__overview-list">
                <div>
                  <dt>{{ t('source.nickname') }}</dt>
                  <dd>{{ source.nickname || t('source.unnamed') }}</dd>
                </div>
                <div>
                  <dt>{{ t('source.type') }}</dt>
                  <dd>
                    <code>{{ sourceTypeFull }}</code>
                  </dd>
                </div>
                <div>
                  <dt>{{ t('source.id') }}</dt>
                  <dd>#{{ source.id }}</dd>
                </div>
                <div>
                  <dt>{{ t('source.created') }}</dt>
                  <dd>{{ source.created_at?.toLocaleString() }}</dd>
                </div>
                <div>
                  <dt>{{ t('source.updated') }}</dt>
                  <dd>{{ source.updated_at?.toLocaleString() }}</dd>
                </div>
              </dl>
            </div>

            <div class="source-view__overview-card">
              <h3>{{ t('source.lastRun') }}</h3>
              <div v-if="lastJob" class="source-view__last-job">
                <div class="source-view__last-job-status">
                  <span
                    class="source-view__status-dot"
                    :class="`source-view__status-dot--${lastJobStatus?.toLowerCase()}`"
                  />
                  <span>{{ lastJobStatus }}</span>
                </div>
                <div class="source-view__last-job-time">{{ lastJobTime?.toLocaleString() }}</div>
                <RouterLink :to="`/jobs/${lastJob.id}`" class="source-view__last-job-link">
                  {{ t('source.view') }} →
                </RouterLink>
              </div>
              <p v-else class="source-view__no-data">{{ t('source.noJobs') }}</p>
            </div>

            <div class="source-view__overview-card">
              <h3>{{ t('source.tab.schedules') }}</h3>
              <div class="source-view__stat-row">
                <span class="source-view__stat-value">{{ cronCount }}</span>
                <span class="source-view__stat-label">{{ t('source.schedules') }}</span>
              </div>
              <div class="source-view__stat-row">
                <span class="source-view__stat-value">{{ enabledCronCount }}</span>
                <span class="source-view__stat-label">{{ t('source.enabled') }}</span>
              </div>
              <div v-if="crons.length" class="source-view__cron-preview">
                <code>{{ crons[0].schedule }}</code>
                <span>({{ t(`source.cronHuman.${humanizeCron(crons[0].schedule)}`) }})</span>
              </div>
            </div>

            <div class="source-view__overview-card">
              <h3>{{ t('source.tab.jobs') }}</h3>
              <div class="source-view__stat-row">
                <span class="source-view__stat-value">{{ jobCount }}</span>
                <span class="source-view__stat-label">{{ t('source.jobs') }}</span>
              </div>
              <div v-if="runningJob" class="source-view__running-job">
                <span class="source-view__status-dot source-view__status-dot--running" />
                <span>{{ t('source.checkOpenJob') }}</span>
                <RouterLink :to="`/jobs/${runningJob.id}`">{{ t('source.view') }}</RouterLink>
              </div>
            </div>
          </div>
        </section>

        <!-- Config Tab -->
        <section
          v-if="activeTab === 'config'"
          class="source-view__tab-panel"
          role="tabpanel"
          :aria-labelledby="getTabId('config')"
        >
          <div class="source-view__config-section">
            <h2>{{ t('source.editConfig') }}</h2>
            <SourceForm ref="editor" :model-value="draft" :disabled="busy" @submit="onSaveSource">
              <p v-if="sourceError" role="alert" class="text-feedback-error">{{ sourceError }}</p>
              <p v-else-if="sourceSaved && !editor?.isDirty" role="status">
                {{ t('source.saved') }}
              </p>
              <div class="source-view__actions">
                <InkButton
                  :text="t('source.delete')"
                  theme="danger"
                  size="sm"
                  :disabled="busy"
                  @click="onRequestDeleteSource"
                />
                <InkButton
                  :text="t('common.save')"
                  theme="primary"
                  native-type="submit"
                  :is-loading="sourceSaving"
                  :disabled="!editor?.canSave || !editor?.isDirty || (busy && !sourceSaving)"
                />
              </div>
            </SourceForm>
          </div>
        </section>

        <!-- Schedules Tab -->
        <section
          v-if="activeTab === 'schedules'"
          class="source-view__tab-panel"
          role="tabpanel"
          :aria-labelledby="getTabId('schedules')"
        >
          <div class="source-view__schedules-section">
            <div class="source-view__section-header">
              <h2>{{ t('source.schedules') }}</h2>
              <InkButton
                :text="t('source.addSchedule')"
                theme="subtle"
                size="sm"
                :disabled="busy"
                @click="onNewCron"
              />
            </div>
            <InkLoading
              v-if="cronsLoading"
              variant="spinner"
              size="xs"
              :label="t('common.loading')"
            />
            <div v-else-if="cronsError" class="source-view__feedback">
              <p role="alert" class="text-feedback-error">{{ t('source.schedulesFailed') }}</p>
              <InkButton :text="t('source.retry')" theme="subtle" size="sm" @click="loadCrons" />
            </div>
            <p v-else-if="!crons.length">{{ t('source.noSchedules') }}</p>
            <div v-else class="source-view__cron-list">
              <div v-for="cron in crons" :key="cron.id" class="source-view__cron-item">
                <div class="source-view__cron-info">
                  <code>{{ cron.schedule }}</code>
                  <span class="source-view__cron-human">{{
                    t(`source.cronHuman.${humanizeCron(cron.schedule)}`)
                  }}</span>
                </div>
                <span
                  class="source-view__cron-status"
                  :class="{ 'source-view__cron-status--enabled': cron.enabled }"
                >
                  {{ t(cron.enabled ? 'source.enabled' : 'source.disabled') }}
                </span>
                <div class="source-view__cron-actions">
                  <InkButton
                    :text="t('source.runNow')"
                    theme="subtle"
                    size="sm"
                    :is-loading="cronAction?.id === cron.id && cronAction.kind === 'run'"
                    :disabled="busy && cronAction?.id !== cron.id"
                    @click="onRunCron(cron)"
                  />
                  <InkButton
                    :text="t('source.delete')"
                    theme="subtle"
                    size="sm"
                    :disabled="busy"
                    @click="onRequestDeleteCron(cron)"
                  />
                </div>
              </div>
            </div>
            <p v-if="cronError && !cronToDelete" role="alert" class="text-feedback-error">
              {{ cronError }}
            </p>
          </div>
        </section>

        <!-- Jobs Tab -->
        <section
          v-if="activeTab === 'jobs'"
          class="source-view__tab-panel"
          role="tabpanel"
          :aria-labelledby="getTabId('jobs')"
        >
          <div class="source-view__jobs-section">
            <div class="source-view__section-header">
              <h2>{{ t('source.jobs') }}</h2>
              <InkButton
                :text="t('source.newJob')"
                theme="subtle"
                size="sm"
                :disabled="busy || !sourceTypeFull"
                @click="onNewJob"
              />
            </div>
            <InkLoading
              v-if="jobsLoading"
              variant="spinner"
              size="xs"
              :label="t('source.jobsLoading')"
            />
            <div v-else-if="jobsError" class="source-view__feedback">
              <p role="alert" class="text-feedback-error">{{ t('source.jobsFailed') }}</p>
              <InkButton :text="t('source.retry')" theme="subtle" size="sm" @click="loadJobs" />
            </div>
            <p v-else-if="!jobs.length">{{ t('source.noJobs') }}</p>
            <div v-else class="source-view__job-list">
              <RouterLink
                v-for="job in jobs"
                :key="job.id"
                :to="`/jobs/${job.id}`"
                class="source-view__job-link"
                ><JobCard :job="job"
              /></RouterLink>
            </div>
          </div>
        </section>
      </div>
    </template>

    <!-- Dialogs and Popups -->
    <InkDialog
      v-model="deleteOpen"
      :title="t('source.deleteConfirmTitle')"
      :confirm-text="t('source.delete')"
      :cancel-text="t('common.cancel')"
      :is-loading="sourceDeleting"
      @confirm="onDeleteSource"
    >
      <p>{{ t('source.deleteConfirmMessage') }}</p>
      <p v-if="deleteError" role="alert" class="text-feedback-error">{{ deleteError }}</p>
    </InkDialog>

    <InkPopup v-model:open="newJobOpen" :title="t('source.newJobTitle')" @close="onCloseJob">
      <InkForm @submit="onCreateJob">
        <p class="source-view__popup-description">{{ t('source.newJobDescription') }}</p>
        <InkDropdown
          v-model="jobKind"
          :label="t('source.collectionIntent')"
          :options="[
            { value: 'ordinary', label: t('source.ordinary') },
            { value: 'backfill', label: t('source.backfill') },
          ]"
        />
        <SchemaConfigEditor
          v-model="jobConfig"
          :label="t('source.config')"
          @validation="jobValidation = $event"
        />
        <p v-if="jobError" role="alert" class="text-feedback-error">{{ jobError }}</p>
        <div class="source-view__popup-actions">
          <InkButton :text="t('common.cancel')" theme="subtle" @click="onCloseJob" />
          <InkButton
            :text="t('source.createJob')"
            theme="primary"
            native-type="submit"
            :is-loading="jobSaving"
            :disabled="!canCreateJob || busy"
          />
        </div>
      </InkForm>
    </InkPopup>

    <InkPopup v-model:open="newCronOpen" :title="t('source.addSchedule')" @close="onCloseCron">
      <InkForm @submit="onCreateCron">
        <InkInput
          v-model="cronSchedule"
          :label="t('source.cronSchedule')"
          placeholder="0 * * * *"
        />
        <p v-if="cronCreateError" role="alert" class="text-feedback-error">{{ cronCreateError }}</p>
        <div class="source-view__popup-actions">
          <InkButton :text="t('common.cancel')" theme="subtle" @click="onCloseCron" />
          <InkButton
            :text="t('source.addSchedule')"
            theme="primary"
            native-type="submit"
            :is-loading="cronSaving"
            :disabled="busy"
          />
        </div>
      </InkForm>
    </InkPopup>

    <InkDialog
      :model-value="cronToDelete !== null"
      :title="t('source.deleteSchedule')"
      :confirm-text="t('source.delete')"
      :cancel-text="t('common.cancel')"
      @confirm="onDeleteCron"
      @update:model-value="cronToDelete = null"
    >
      <p>{{ t('source.deleteScheduleMessage') }}</p>
      <p v-if="cronError" role="alert" class="text-feedback-error">{{ cronError }}</p>
    </InkDialog>
  </main>
</template>

<style lang="scss" scoped src="./source.scss" />
