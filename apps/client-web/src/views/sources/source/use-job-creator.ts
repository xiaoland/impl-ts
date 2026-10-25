import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Job, JobManager } from '@inkcre/core'
import type { JsonEditorValidation } from '@inkcre/ui-web'

/**
 * State and actions for the "new job" popup on the source detail view. The
 * jobs list is owned by `useSourceDetail` and passed in; the view supplies
 * `onCreated` for post-create navigation.
 */
export function useJobCreator(options: {
  sourceId: ComputedRef<number>
  jobs: Ref<Job[]>
  isBusy: () => boolean
  onCreated: (job: Job) => unknown
}) {
  const { t } = useI18n()
  const jobKind = ref<'ordinary' | 'backfill'>('ordinary')
  const jobConfig = ref('{}')
  const jobValidation = ref<JsonEditorValidation>()
  const jobError = ref('')
  const jobSaving = ref(false)
  const newJobOpen = ref(false)

  const canCreateJob = computed(
    () => jobConfig.value.trim() !== '' && (!jobValidation.value || jobValidation.value.valid)
  )

  function onNewJob(): void {
    jobKind.value = 'ordinary'
    jobConfig.value = '{}'
    jobValidation.value = undefined
    jobError.value = ''
    newJobOpen.value = true
  }

  function onCloseJob(): void {
    if (jobSaving.value) return
    if (jobConfig.value !== '{}' && !window.confirm(t('source.discardChanges'))) return
    newJobOpen.value = false
  }

  async function onCreateJob(): Promise<void> {
    if (options.isBusy() || !canCreateJob.value) return
    jobSaving.value = true
    jobError.value = ''
    let created: Job
    try {
      created = await JobManager.create(
        jobKind.value === 'ordinary' ? 'core.source.collect.v1' : 'core.source.backfill.v1',
        { source: options.sourceId.value, config: JSON.parse(jobConfig.value) }
      )
      options.jobs.value = [created, ...options.jobs.value]
      newJobOpen.value = false
    } catch {
      jobError.value = t('source.runFailed')
      return
    } finally {
      jobSaving.value = false
    }
    await options.onCreated(created)
  }

  return {
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
  }
}
