/**
 * Convert a 5-field cron expression to a human-readable description
 */
export function humanizeCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return schedule

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // Common patterns
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'everyMinute'
  }
  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'everyHour'
  }
  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'everyDay'
  }
  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    return 'everyWeek'
  }
  if (minute === '0' && hour === '0' && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    return 'everyMonth'
  }

  return 'custom'
}
