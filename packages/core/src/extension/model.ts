import { parse as parseSemVer } from 'semver'
import type { Component } from 'vue'
import { z } from 'zod'
import { APIError, DBAPIClient } from '../base'
import { MetaConfigSchema, type MetaConfig } from '../config'
import { signDatabaseToken } from '../auth'

const EXTENSION_NAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export const ExtensionNameSchema = z
  .string()
  .refine((value) => EXTENSION_NAME_PATTERN.test(value), {
    error: 'Extension name must be one canonical lowercase ASCII namespace/name pair.',
  })

export const ExtensionVersionSchema = z.string().refine(
  (value) => {
    const parsed = parseSemVer(value)
    return parsed !== null && parsed.version === value && parsed.build.length === 0
  },
  { error: 'Extension version must be strict SemVer without build metadata.' }
)

export const NativeDistributionSchema = z.enum(['python', 'module_federation', 'swift_bundled'])
export type NativeDistribution = z.infer<typeof NativeDistributionSchema>

/** Shared identity and configuration; native versions belong to individual Peers. */
export const InstalledExtensionSchema = z.object({
  name: ExtensionNameSchema,
  nickname: z.string().nullable(),
  config: z.record(z.string(), z.unknown()).default({}),
})
export const InstallExtensionInputSchema = z.object({
  name: ExtensionNameSchema,
  version: ExtensionVersionSchema,
})
export type InstalledExtension = z.infer<typeof InstalledExtensionSchema>
export type InstallExtensionInput = z.infer<typeof InstallExtensionInputSchema>
export interface ExtensionModelInstallInput {
  name: string
  nickname: string
}

export const ExtensionParticipationSchema = z.object({
  name: ExtensionNameSchema,
  peer_id: z.uuid(),
  distribution: NativeDistributionSchema.nullable(),
  version: ExtensionVersionSchema,
  enabled: z.boolean(),
  config_schema: z.record(z.string(), z.unknown()).nullable(),
})
export type ExtensionParticipation = z.infer<typeof ExtensionParticipationSchema>
export const ExtensionRuntimeStatusSchema = ExtensionParticipationSchema.omit({
  version: true,
}).extend({
  version: ExtensionVersionSchema.nullable(),
  supported_distributions: z.array(NativeDistributionSchema),
  loaded_version: ExtensionVersionSchema.nullable(),
  running: z.boolean(),
  restart_required: z.boolean(),
  operation: z.string().nullable(),
  error: z.string().nullable(),
})
export type ExtensionRuntimeStatus = z.infer<typeof ExtensionRuntimeStatusSchema>

const EXTENSION_PROJECTION = 'name,nickname,config' as const
const PARTICIPATION_PROJECTION = 'name,peer_id,distribution,version,enabled,config_schema' as const

export class ExtensionPersistenceError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(
      `Extension state ${operation} failed${cause instanceof Error ? `: ${cause.message}` : ''}.`
    )
    this.name = 'ExtensionPersistenceError'
  }
}

export class ExtensionModel implements InstalledExtension {
  static readonly #dbApi = new DBAPIClient<'extensions'>('extensions')
  readonly name: string
  readonly nickname: string | null
  readonly config: Record<string, unknown>

  constructor(row: InstalledExtension) {
    const parsed = InstalledExtensionSchema.parse(row)
    this.name = parsed.name
    this.nickname = parsed.nickname
    this.config = parsed.config
  }

  static async list(): Promise<ExtensionModel[]> {
    const response = await this.#dbApi.from().select(EXTENSION_PROJECTION).order('name')
    assertSuccess(response, 'list')
    return InstalledExtensionSchema.array()
      .parse(response.data ?? [])
      .map(this.fromRow)
  }

  static async get(name: string): Promise<ExtensionModel | null> {
    const response = await this.#dbApi
      .from()
      .select(EXTENSION_PROJECTION)
      .eq('name', name)
      .maybeSingle()
    assertSuccess(response, 'read')
    return response.data === null ? null : this.fromRow(response.data)
  }

  static async install(input: ExtensionModelInstallInput): Promise<ExtensionModel> {
    const name = ExtensionNameSchema.parse(input.name)
    const existing = await this.get(name)
    if (existing) return existing
    // A competing Peer can create the shared identity; never overwrite its configuration.
    const response = await this.#dbApi
      .from()
      .upsert(
        { name, nickname: input.nickname, config: {}, state: {} },
        { onConflict: 'name', ignoreDuplicates: true }
      )
    assertSuccess(response, 'install')
    const installed = await this.get(name)
    if (!installed) throw new ExtensionPersistenceError('install')
    return installed
  }

  async updateConfig(config: Record<string, unknown>): Promise<ExtensionModel> {
    const response = await ExtensionModel.#dbApi
      .update({ config })
      .eq('name', this.name)
      .select(EXTENSION_PROJECTION)
      .single()
    assertSuccess(response, 'update config')
    return ExtensionModel.fromRow(response.data)
  }

  async uninstall(): Promise<void> {
    const participations = await ExtensionParticipationModel.list()
    if (participations.some((row) => row.name === this.name)) {
      throw new ExtensionPersistenceError(
        'uninstall',
        new Error('Remove every Peer participation before deleting the shared Extension.')
      )
    }
    const response = await ExtensionModel.#dbApi
      .from()
      .delete()
      .eq('name', this.name)
      .select('name')
    assertSuccess(response, 'uninstall')
    if (response.data?.length !== 1) throw new ExtensionPersistenceError('uninstall')
  }

  private static fromRow(this: void, row: unknown): ExtensionModel {
    return new ExtensionModel(InstalledExtensionSchema.parse(row))
  }
}

/** One exact native selection. Runtime facts are obtained from the hosting Peer. */
export class ExtensionParticipationModel implements ExtensionParticipation {
  static readonly #dbApi = new DBAPIClient<'extension_peer_participations'>(
    'extension_peer_participations'
  )
  readonly name: string
  readonly peer_id: string
  readonly distribution: NativeDistribution | null
  readonly version: string
  readonly enabled: boolean
  readonly config_schema: Record<string, unknown> | null

  constructor(row: ExtensionParticipation) {
    const parsed = ExtensionParticipationSchema.parse(row)
    this.name = parsed.name
    this.peer_id = parsed.peer_id
    this.distribution = parsed.distribution
    this.version = parsed.version
    this.enabled = parsed.enabled
    this.config_schema = parsed.config_schema
  }

  static async list(peerId?: string): Promise<ExtensionParticipationModel[]> {
    let query = this.#dbApi.from().select(PARTICIPATION_PROJECTION).order('name')
    if (peerId) query = query.eq('peer_id', peerId)
    const response = await query
    assertSuccess(response, 'list participation')
    return ExtensionParticipationSchema.array()
      .parse(response.data ?? [])
      .map(this.fromRow)
  }

  static async get(peerId: string, name: string): Promise<ExtensionParticipationModel | null> {
    const response = await this.#dbApi
      .from()
      .select(PARTICIPATION_PROJECTION)
      .eq('peer_id', peerId)
      .eq('name', name)
      .maybeSingle()
    assertSuccess(response, 'read participation')
    return response.data === null ? null : this.fromRow(response.data)
  }

  /** Read a selection snapshot from the original connection, without creating a cross-connection mutator. */
  static async readForConnection(
    meta: MetaConfig,
    peerId: string,
    name: string
  ): Promise<ExtensionParticipation | null> {
    const exact = MetaConfigSchema.parse(meta)
    const database = new DBAPIClient<'extension_peer_participations'>(
      'extension_peer_participations',
      undefined,
      'inkcre',
      exact.INKCRE_PGREST_URL,
      () => signDatabaseToken(exact.INKCRE_JWT_SECRET)
    )
    const response = await database
      .from()
      .select(PARTICIPATION_PROJECTION)
      .eq('peer_id', peerId)
      .eq('name', name)
      .maybeSingle()
    assertSuccess(response, 'observe selection')
    return response.data === null ? null : ExtensionParticipationSchema.parse(response.data)
  }

  static async select(input: {
    peerId: string
    name: string
    distribution: NativeDistribution
    version: string
    expectedVersion?: string
  }): Promise<ExtensionParticipationModel> {
    const exact = ExtensionParticipationSchema.parse({
      name: input.name,
      peer_id: input.peerId,
      distribution: input.distribution,
      version: input.version,
      enabled: false,
      config_schema: null,
    })
    const existing = await this.get(exact.peer_id, exact.name)
    if (!existing) {
      if (input.expectedVersion !== undefined)
        throw new ExtensionPersistenceError(
          'select version',
          new Error('The previous selection no longer exists.')
        )
      const response = await this.#dbApi.insert(exact).select(PARTICIPATION_PROJECTION).single()
      assertSuccess(response, 'select version')
      return this.fromRow(response.data)
    }
    if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw new ExtensionPersistenceError(
        'select version',
        new Error('The Peer selection changed; refresh and retry.')
      )
    }
    if (existing.distribution === exact.distribution && existing.version === exact.version)
      return existing
    const expected = input.expectedVersion ?? existing.version
    let query = this.#dbApi
      .update({ distribution: exact.distribution, version: exact.version, config_schema: null })
      .eq('peer_id', exact.peer_id)
      .eq('name', exact.name)
      .eq('version', expected)
    // Resolving a legacy pin must not replace a selection made by another Host.
    query =
      existing.distribution === null
        ? query.is('distribution', null)
        : query.eq('distribution', existing.distribution)
    const response = await query.select(PARTICIPATION_PROJECTION).maybeSingle()
    assertSuccess(response, 'select version')
    if (!response.data)
      throw new ExtensionPersistenceError(
        'select version',
        new Error('The Peer selection changed; refresh and retry.')
      )
    return this.fromRow(response.data)
  }

  async setEnabled(enabled: boolean): Promise<ExtensionParticipationModel> {
    return this.updateExact({ enabled }, enabled ? 'enable Peer' : 'disable Peer')
  }

  async updateConfigSchema(
    config_schema: Record<string, unknown> | null
  ): Promise<ExtensionParticipationModel> {
    return this.updateExact({ config_schema }, 'update config schema')
  }

  async remove(): Promise<void> {
    const response = await ExtensionParticipationModel.#dbApi
      .from()
      .delete()
      .eq('peer_id', this.peer_id)
      .eq('name', this.name)
      .eq('enabled', false)
      .eq('version', this.version)
      .select('name')
    assertSuccess(response, 'remove participation')
    if (response.data?.length !== 1)
      throw new ExtensionPersistenceError(
        'remove participation',
        new Error('Disable this Peer or refresh its selection first.')
      )
  }

  private async updateExact(
    values: Record<string, unknown>,
    operation: string
  ): Promise<ExtensionParticipationModel> {
    let query = ExtensionParticipationModel.#dbApi
      .update(values)
      .eq('peer_id', this.peer_id)
      .eq('name', this.name)
      .eq('version', this.version)
    query =
      this.distribution === null
        ? query.is('distribution', null)
        : query.eq('distribution', this.distribution)
    const response = await query.select(PARTICIPATION_PROJECTION).maybeSingle()
    assertSuccess(response, operation)
    if (!response.data)
      throw new ExtensionPersistenceError(
        operation,
        new Error('The Peer selection changed; refresh and retry.')
      )
    return ExtensionParticipationModel.fromRow(response.data)
  }

  private static fromRow(this: void, row: unknown): ExtensionParticipationModel {
    return new ExtensionParticipationModel(ExtensionParticipationSchema.parse(row))
  }
}

function assertSuccess(response: { error?: { message: string } | null }, operation: string): void {
  if (response.error)
    throw new ExtensionPersistenceError(
      operation,
      new APIError(response.error.message, 0, response.error)
    )
}

/** Setup UI contributed by one already-running Web Extension. */
export interface ExtensionSetupContribution {
  component: Component
}

/** Default export exposed by a Web Extension's native Module Federation Remote. */
export interface ExtensionModule {
  initialize?(): Promise<void>
  activate?(): Promise<void>
  deactivate?(): Promise<void>
  dispose?(): Promise<void>
  setup?: ExtensionSetupContribution
}
