import { inspectRuntimeReadiness, readiness, runtimeState } from './database-runtime-lib.mjs'

const instance = process.argv[2]
if (!instance) {
  console.error('usage: node scripts/probe-database.mjs <runtime-instance>')
  process.exit(2)
}

let stage = 'descriptor'
try {
  const state = await runtimeState(instance)
  stage = 'contract'
  if (state.provider.kind === 'external') readiness(instance)
  stage = 'transport'
  const checks = await inspectRuntimeReadiness(state, 1500)
  const ready = Object.values(checks).every(Boolean)
  console.log(
    JSON.stringify({
      ready,
      stage,
      checks,
      identity: state.identity,
      runtime_instance: state.runtime_instance ?? state.identity,
      owner_repository: state.owner_repository ?? 'InKCre/impl-ts',
      contract_revision: state.contract_revision,
      provider: state.provider.kind,
      profile: state.profile,
      source_revision: state.core_source_revision ?? null,
      source_fingerprint: state.source_fingerprint ?? null,
      migration_head: state.migration_head ?? null,
      ...(!ready && {
        action:
          'Inspect the reported transport and its runtime owner; do not reset the database to repair connectivity.',
      }),
    })
  )
  process.exitCode = ready ? 0 : 1
} catch (error) {
  console.log(
    JSON.stringify({
      ready: false,
      identity: instance,
      stage,
      reason: error instanceof Error ? error.message : String(error),
    })
  )
  process.exitCode = 1
}
