import { computed, ref, watch, type ComputedRef } from 'vue'
import { Cron, Job, JobStatus, Source } from '@inkcre/core'

/**
 * Data layer for the source detail view: the source itself plus its jobs and
 * crons. Each region loads independently behind its own request counter, so a
 * late response can never replace another source's context.
 */
export function useSourceDetail(sourceId: ComputedRef<number>) {
  const source = ref<Source | null>(null)
  const draft = ref<Source | null>(null)
  const sourceLoading = ref(false)
  const sourceLoadError = ref(false)
  const jobs = ref<Job[]>([])
  const jobsLoading = ref(false)
  const jobsError = ref(false)
  const crons = ref<Cron[]>([])
  const cronsLoading = ref(false)
  const cronsError = ref(false)
  const sourceSaving = ref(false)
  const sourceError = ref('')
  const sourceSaved = ref(false)
  const deleteOpen = ref(false)
  const sourceDeleting = ref(false)
  const deleteError = ref('')

  let sourceRequest = 0
  let jobsRequest = 0
  let cronsRequest = 0

  async function loadSource(): Promise<void> {
    const request = ++sourceRequest
    sourceLoading.value = true
    sourceLoadError.value = false
    try {
      const loaded = await Source.get(sourceId.value)
      if (request !== sourceRequest) return
      source.value = loaded
      draft.value = Source.parse(loaded)
    } catch {
      if (request === sourceRequest) sourceLoadError.value = true
    } finally {
      if (request === sourceRequest) sourceLoading.value = false
    }
  }

  async function loadJobs(): Promise<void> {
    const request = ++jobsRequest
    jobsLoading.value = true
    jobsError.value = false
    try {
      const loaded = await Job.getBySource(sourceId.value)
      if (request === jobsRequest) jobs.value = loaded
    } catch {
      if (request === jobsRequest) jobsError.value = true
    } finally {
      if (request === jobsRequest) jobsLoading.value = false
    }
  }

  async function loadCrons(): Promise<void> {
    const request = ++cronsRequest
    cronsLoading.value = true
    cronsError.value = false
    try {
      const loaded = await Cron.getBySource(sourceId.value)
      if (request === cronsRequest) crons.value = loaded
    } catch {
      if (request === cronsRequest) cronsError.value = true
    } finally {
      if (request === cronsRequest) cronsLoading.value = false
    }
  }

  watch(
    sourceId,
    () => {
      void loadSource()
      void loadJobs()
      void loadCrons()
    },
    { immediate: true }
  )

  const sourceTypeFull = computed(() => source.value?.type || '')

  const lastJob = computed(() => (jobs.value.length ? jobs.value[0] : null))
  const lastJobStatus = computed(() => lastJob.value?.status ?? null)
  const lastJobTime = computed(() => lastJob.value?.created_at ?? null)
  const cronCount = computed(() => crons.value.length)
  const enabledCronCount = computed(() => crons.value.filter((cron) => cron.enabled).length)
  const jobCount = computed(() => jobs.value.length)
  const runningJob = computed(() =>
    jobs.value.find((job) => job.status === JobStatus.PENDING || job.status === JobStatus.RUNNING)
  )

  return {
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
  }
}
