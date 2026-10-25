import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ExtensionRuntimeStatus } from '@inkcre/core'
import {
  generatePassword,
  configuredRegistry,
  RegistryConfigurationError,
  runtimeFailed,
  runtimeReady,
  savedPassword,
  waitingForRuntime,
} from '../../src/setup-state.ts'

const running: ExtensionRuntimeStatus = {
  name: 'inkcre/caldav',
  peer_id: '454cda4b-5576-58e4-9d26-7a7c93cd06b6',
  distribution: 'python',
  version: '0.1.0',
  enabled: true,
  config_schema: null,
  supported_distributions: ['python'],
  loaded_version: '0.1.0',
  running: true,
  restart_required: false,
  operation: null,
  error: null,
}

void test('a Python nullable Registry override uses shared configuration without guessing a process default', () => {
  const shared = {
    schema: 'extension.registry.config.v1',
    value: { extension_registry_url: 'https://deployment.example' },
  }
  assert.equal(configuredRegistry(null, shared), 'https://deployment.example')
  assert.equal(configuredRegistry(undefined, shared), 'https://deployment.example')
  assert.equal(configuredRegistry('https://peer.example', shared), 'https://peer.example')
  assert.throws(() => configuredRegistry(null, null), RegistryConfigurationError)
  assert.throws(
    () => configuredRegistry(null, { ...shared, value: { extension_registry_url: null } }),
    RegistryConfigurationError
  )
  assert.throws(() => configuredRegistry(123, shared), RegistryConfigurationError)
})

void test('readiness requires the selected version to be actually running', () => {
  assert.equal(runtimeReady(running), true)
  for (const change of [
    { enabled: false },
    { running: false },
    { loaded_version: '0.0.1' },
    { restart_required: true },
    { operation: 'restarting' },
    { operation: 'downloading' },
    { operation: 'failed' },
    { error: 'failed' },
  ])
    assert.equal(runtimeReady({ ...running, ...change }), false)
  assert.equal(runtimeReady(null), false)
})

void test('a completed failure is not presented as installation still in progress', () => {
  assert.equal(waitingForRuntime({ ...running, operation: 'failed', error: 'failed' }), false)
  assert.equal(waitingForRuntime({ ...running, operation: 'applying' }), true)
  const failed = { ...running, operation: 'failed', restart_required: true }
  assert.equal(waitingForRuntime(failed), false)
  assert.equal(runtimeFailed(failed), true)
  assert.equal(runtimeReady(failed), false)
  assert.equal(waitingForRuntime({ ...running, version: null, operation: 'downloading' }), true)
})

void test('password preparation matches Python character limits and preserves existing values', () => {
  const extension = { name: 'inkcre/caldav', nickname: 'CalDAV', config: {} }
  assert.equal(savedPassword(extension), null)
  const existing = '日'.repeat(32)
  assert.equal(savedPassword({ ...extension, config: { password: existing } }), existing)
  for (const password of ['a'.repeat(31), 'a'.repeat(129), 123])
    assert.throws(() => savedPassword({ ...extension, config: { password } }))
  const generated = generatePassword()
  assert.match(generated, /^[0-9a-f]{64}$/)
  assert.notEqual(generated, generatePassword())
})
