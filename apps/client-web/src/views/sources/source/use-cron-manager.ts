import { ref, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Cron, CronForm } from '@inkcre/core'

/**
 * Cron schedule management for the source detail view: the create popup, run
 * action, and delete confirmation. The crons list is owned by
 * `useSourceDetail` and passed in for mutation.
 */
export function useCronManager(options: {
  sourceId: ComputedRef<number>
  crons: Ref<Cron[]>
  isBusy: () => boolean
}) {
  const { t } = useI18n()
  const cronSchedule = ref('0 * * * *')
  const cronCreateError = ref('')
  const cronSaving = ref(false)
  const cronAction = ref<{ id: number; kind: 'run' | 'delete' } | null>(null)
  const newCronOpen = ref(false)
  const cronToDelete = ref<Cron | null>(null)
  const cronError = ref('')

  function onNewCron(): void {
    cronSchedule.value = '0 * * * *'
    cronCreateError.value = ''
    newCronOpen.value = true
  }

  function onCloseCron(): void {
    if (cronSaving.value) return
    if (cronSchedule.value !== '0 * * * *' && !window.confirm(t('source.discardChanges'))) return
    newCronOpen.value = false
  }

  async function onCreateCron(): Promise<void> {
    if (options.isBusy()) return
    cronSaving.value = true
    cronCreateError.value = ''
    try {
      const created = await new CronForm({
        schedule: cronSchedule.value,
        enabled: true,
        job_type: 'core.source.collect.v1',
        job_parameters: { source: options.sourceId.value },
        job_timeout_seconds: null,
      }).create()
      options.crons.value = [...options.crons.value, created]
      newCronOpen.value = false
    } catch {
      cronCreateError.value = t('source.scheduleFailed')
    } finally {
      cronSaving.value = false
    }
  }

  async function onRunCron(cron: Cron): Promise<void> {
    if (options.isBusy()) return
    cronAction.value = { id: cron.id, kind: 'run' }
    cronError.value = ''
    try {
      await cron.runNow()
    } catch {
      cronError.value = t('source.runFailed')
    } finally {
      cronAction.value = null
    }
  }

  function onRequestDeleteCron(cron: Cron): void {
    if (options.isBusy()) return
    cronError.value = ''
    cronToDelete.value = cron
  }

  async function onDeleteCron(): Promise<void> {
    if (options.isBusy() || !cronToDelete.value) return
    const cron = cronToDelete.value
    cronAction.value = { id: cron.id, kind: 'delete' }
    try {
      await cron.delete()
      options.crons.value = options.crons.value.filter((item) => item.id !== cron.id)
      cronToDelete.value = null
    } catch {
      cronError.value = t('source.deleteFailed')
    } finally {
      cronAction.value = null
    }
  }

  return {
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
  }
}
