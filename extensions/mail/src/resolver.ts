import { markRaw } from 'vue'
import {
  Block,
  PeerManager,
  PeerProtocolResponseSchema,
  Relation,
  Resolver,
  ResolverCache,
  type LexicalRetrievalMatch,
  type ProjectionOptions,
  type RecallTarget,
} from '@inkcre/core'

import ContentEmail from './components/contentEmail/contentEmail.vue'
import ContentEmailPreview from './components/contentEmail/contentEmailPreview.vue'
import ContentMailFact from './components/contentMailFact/contentMailFact.vue'
import ContentMailFactPreview from './components/contentMailFact/contentMailFactPreview.vue'
import ContentMimePart from './components/contentMimePart/contentMimePart.vue'
import ContentMimePartPreview from './components/contentMimePart/contentMimePartPreview.vue'
import ContentMailingList from './components/contentMailingList.vue'
import ContentNewsletterBody from './components/contentNewsletterBody.vue'
import ContentNewsletterPreview from './components/contentNewsletterPreview.vue'
import {
  HTML_BODIES,
  TEXT_BODIES,
  NEWSLETTER_HTML,
  NEWSLETTER_TEXT,
  cleanNewsletterHtml,
  cleanNewsletterText,
  htmlText,
  readingBodies,
} from './newsletter'
import {
  CanonicalEmailAddressSchema,
  CanonicalEmailSchema,
  CanonicalMailingListSchema,
  CanonicalMailFlagSchema,
  CanonicalMailboxSchema,
  CanonicalMimePartSchema,
  ComponentRelationSchema,
  ContainsRelationSchema,
  EmbeddedReferenceRelationSchema,
  ParticipantRelationSchema,
  parseJson,
  type CanonicalEmailAddress,
  type CanonicalMailFlag,
  type CanonicalMailbox,
  type SolvedMailingList,
  type SolvedBlock,
  type SolvedEmail,
  type SolvedMimePart,
} from './schema'

export const MAIL_MIME_PART_MATERIALIZE_CAPABILITY = 'extensions.mail.mime_part.materialize.v1'

async function solveBlock<Content>(
  block: Block,
  options: ProjectionOptions
): Promise<SolvedBlock<Content>> {
  const resolver = await ResolverCache.getResolver(block)
  return {
    block,
    solvedContent: (await resolver.getSolvedContent({
      ...options,
      materializeMissing: false,
    })) as Content,
  }
}

function parseRelation(content: string): unknown {
  try {
    return parseJson(content)
  } catch {
    return null
  }
}

async function relatedBlocks(relations: Relation[], focal: number): Promise<Map<number, Block>> {
  const refs = new Set(
    relations.map((relation) => (relation.from_ === focal ? relation.to_ : relation.from_))
  )
  const blocks = await Promise.all([...refs].map((ref) => Block.find(ref)))
  return new Map(
    blocks.filter((block): block is Block => block !== null).map((block) => [block.id, block])
  )
}

async function emailRecallTarget(
  block: Block,
  match: LexicalRetrievalMatch
): Promise<RecallTarget | null> {
  const response = await Relation.dbApi
    .from()
    .select()
    .eq('to_', block.id)
    .eq('content', 'publishes')
  if (response.error) throw response.error
  const publications = (
    await Block.getMany(
      (response.data ?? []).flatMap((row) => (row.from_ === null ? [] : [row.from_]))
    )
  )
    .filter((item) => item.resolver === MailingListResolver.type)
    .map((item) => CanonicalMailingListSchema.parse(parseJson(item.content)))
  if (!publications.length) return null
  const email = CanonicalEmailSchema.parse(parseJson(block.content))
  return {
    block,
    label: email.subject || '无主题',
    description: [
      ...new Set(publications.map((item) => item.name || item.list_id)),
      email.authored_at?.toLocaleDateString(),
    ]
      .filter(Boolean)
      .join(' · '),
    // Snippets identify destinations without exposing subscriber tokens; evidence stays intact.
    excerpt: match.excerpt.replace(/https?:\/\/[^\s<>)]+/g, (value) => {
      try {
        return new URL(value).hostname
      } catch {
        return value
      }
    }),
  }
}

async function bodyRecallTarget(
  block: Block,
  match: LexicalRetrievalMatch
): Promise<RecallTarget | null> {
  const response = await Relation.dbApi.from().select().eq('to_', block.id)
  if (response.error) throw response.error
  const owners = new Set(
    (response.data ?? [])
      .filter(
        (row) => ComponentRelationSchema.safeParse(parseRelation(row.content)).data?.role === 'body'
      )
      .flatMap((row) => (row.from_ === null ? [] : [row.from_]))
  )
  const emails = (await Block.getMany(owners)).filter(
    (item) => item.resolver === EmailResolver.type
  )
  if (emails.length !== 1) return null
  return emailRecallTarget(emails[0]!, match)
}

export class EmailResolver extends Resolver<string, SolvedEmail> {
  static readonly type = 'extensions.mail.email.v1'
  static readonly previewRenderer = markRaw(ContentEmailPreview)
  static readonly solvedContentRenderer = markRaw(ContentEmail)

  static {
    Resolver.register(EmailResolver.type, EmailResolver)
  }

  override getRecallTarget(match: LexicalRetrievalMatch): Promise<RecallTarget | null> {
    return emailRecallTarget(this.block, match)
  }

  protected async _getSolvedContent(options: ProjectionOptions): Promise<SolvedEmail> {
    const root = CanonicalEmailSchema.parse(parseJson(await this.getRawContent(options)))
    const relations = await this.getRelations({ refresh: options.refresh })
    const blocks = await relatedBlocks(relations, this.block.id)
    const result: SolvedEmail = {
      root,
      bodies: [],
      mailingLists: [],
      mimeParts: [],
      participants: [],
      mailboxes: [],
      flags: [],
      parents: [],
      references: [],
      embedded: [],
    }

    for (const relation of relations) {
      const outgoing = relation.from_ === this.block.id
      const related = blocks.get(outgoing ? relation.to_ : relation.from_)
      if (!related) continue

      if (outgoing) {
        const component = ComponentRelationSchema.safeParse(parseRelation(relation.content))
        if (component.success && component.data.role === 'body') {
          if (!HTML_BODIES.has(related.resolver) && !TEXT_BODIES.has(related.resolver)) continue
          result.bodies.push({
            ...(await solveBlock<string>(related, options)),
            relation: component.data,
          })
          continue
        }
        if (component.success && component.data.role !== 'body') {
          if (related.resolver !== MailMimePartResolver.type) continue
          result.mimeParts.push({
            ...(await solveBlock<SolvedMimePart>(related, options)),
            relation: component.data,
          })
          continue
        }

        const participant = ParticipantRelationSchema.safeParse(parseRelation(relation.content))
        if (participant.success && related.resolver === EmailAddressResolver.type) {
          result.participants.push({
            relation: participant.data,
            address: await solveBlock<CanonicalEmailAddress>(related, options),
          })
          continue
        }
        if (related.resolver === EmailResolver.type && relation.content.startsWith('parent:')) {
          result.parents.push({
            block: related,
            solvedContent: CanonicalEmailSchema.parse(parseJson(related.content)),
          })
        } else if (
          related.resolver === EmailResolver.type &&
          relation.content.startsWith('reference:')
        ) {
          result.references.push({
            block: related,
            solvedContent: CanonicalEmailSchema.parse(parseJson(related.content)),
          })
        }
        continue
      }

      const contains = ContainsRelationSchema.safeParse(parseRelation(relation.content))
      if (relation.content === 'publishes' && related.resolver === MailingListResolver.type) {
        const publication = CanonicalMailingListSchema.parse(parseJson(related.content))
        if (
          !result.mailingLists.some((item) => item.solvedContent.list_id === publication.list_id)
        ) {
          result.mailingLists.push({ block: related, solvedContent: publication })
        }
      } else if (contains.success && related.resolver === MailboxResolver.type) {
        result.mailboxes.push({
          relation: contains.data,
          mailbox: await solveBlock<CanonicalMailbox>(related, options),
        })
      } else if (relation.content === 'tags' && related.resolver === MailFlagResolver.type) {
        result.flags.push({ flag: await solveBlock<CanonicalMailFlag>(related, options) })
      }
    }

    const mimeParts = new Map(result.mimeParts.map((part) => [part.block.id, part]))
    for (const body of result.bodies.filter((item) => HTML_BODIES.has(item.block.resolver))) {
      for (const relation of await Relation.getByBlock(body.block.id)) {
        if (relation.from_ !== body.block.id) continue
        const embedded = EmbeddedReferenceRelationSchema.safeParse(parseRelation(relation.content))
        const mimePart = mimeParts.get(relation.to_)
        if (embedded.success && mimePart) {
          result.embedded.push({
            body: body.block,
            reference: embedded.data.reference,
            mimePart,
          })
        }
      }
    }
    return result
  }

  async materializeMimePart(blockRef: number): Promise<SolvedEmail> {
    const block = await Block.get(blockRef)
    if (block.resolver !== MailMimePartResolver.type) {
      throw new TypeError(`Block ${blockRef} is not a Mail MIME part`)
    }
    const resolver = await ResolverCache.getResolver<MailMimePartResolver>(block)
    await resolver.getSolvedContent({ refresh: true, materializeMissing: true })
    return this.getSolvedContent({ refresh: true, materializeMissing: false })
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    const email = await this.getSolvedContent(options)
    if (options.context === 'lexical') {
      return email.root.subject || email.root.message_id || 'email'
    }
    const texts = readingBodies(email.bodies).map((body) =>
      HTML_BODIES.has(body.block.resolver) ? htmlText(body.solvedContent) : body.solvedContent
    )
    return [email.root.subject, ...texts].filter(Boolean).join('\n\n') || 'email'
  }
}

export class MailingListResolver extends Resolver<string, SolvedMailingList> {
  static readonly type = 'extensions.mail.mailing_list.v1'
  static readonly previewRenderer = markRaw(ContentNewsletterPreview)
  static readonly solvedContentRenderer = markRaw(ContentMailingList)

  static {
    Resolver.register(MailingListResolver.type, MailingListResolver)
  }

  protected async _getSolvedContent(options: ProjectionOptions): Promise<SolvedMailingList> {
    const root = CanonicalMailingListSchema.parse(parseJson(await this.getRawContent(options)))
    const response = await Block.dbApi.from().select().eq('resolver', MailingListResolver.type)
    if (response.error) throw response.error
    const publications = (response.data ?? [])
      .map((row) => Block.parse(row))
      .filter(
        (block) =>
          CanonicalMailingListSchema.parse(parseJson(block.content)).list_id === root.list_id
      )
    const ids = new Set<number>()
    for (const publication of publications) {
      for (const relation of await Relation.getByBlock(publication.id)) {
        if (relation.from_ === publication.id && relation.content === 'publishes')
          ids.add(relation.to_)
      }
    }
    const emails = await Promise.all([...ids].map((id) => Block.find(id)))
    return {
      root,
      emails: emails
        .filter((block): block is Block => block !== null && block.resolver === EmailResolver.type)
        .map((block) => ({
          block,
          solvedContent: CanonicalEmailSchema.parse(parseJson(block.content)),
        })),
    }
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    const root = CanonicalMailingListSchema.parse(parseJson(await this.getRawContent(options)))
    return [root.name, root.list_id].filter(Boolean).join('\n')
  }
}

export class NewsletterHtmlResolver extends Resolver<string, string> {
  static readonly type = NEWSLETTER_HTML
  static readonly previewRenderer = markRaw(ContentNewsletterPreview)
  static readonly solvedContentRenderer = markRaw(ContentNewsletterBody)

  static {
    Resolver.register(NewsletterHtmlResolver.type, NewsletterHtmlResolver)
  }

  protected async _getSolvedContent(options: ProjectionOptions): Promise<string> {
    return cleanNewsletterHtml(await this.getRawContent(options))
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    return htmlText(await this.getSolvedContent(options), options.context !== 'lexical')
  }

  override getRecallTarget(match: LexicalRetrievalMatch): Promise<RecallTarget | null> {
    return bodyRecallTarget(this.block, match)
  }
}

export class NewsletterTextResolver extends Resolver<string, string> {
  static readonly type = NEWSLETTER_TEXT
  static readonly previewRenderer = markRaw(ContentNewsletterPreview)
  static readonly solvedContentRenderer = markRaw(ContentNewsletterBody)

  static {
    Resolver.register(NewsletterTextResolver.type, NewsletterTextResolver)
  }

  protected async _getSolvedContent(options: ProjectionOptions): Promise<string> {
    return cleanNewsletterText(await this.getRawContent(options))
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    return this.getSolvedContent(options)
  }

  override getRecallTarget(match: LexicalRetrievalMatch): Promise<RecallTarget | null> {
    return bodyRecallTarget(this.block, match)
  }
}

abstract class JsonMailResolver<Content> extends Resolver<string, Content> {
  abstract readonly schema: { parse(value: unknown): Content }

  protected async _getSolvedContent(options: ProjectionOptions): Promise<Content> {
    return this.schema.parse(parseJson(await this.getRawContent(options)))
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    return JSON.stringify(await this.getSolvedContent(options))
  }
}

export class MailboxResolver extends JsonMailResolver<CanonicalMailbox> {
  static readonly type = 'extensions.mail.mailbox.v1'
  static readonly previewRenderer = markRaw(ContentMailFactPreview)
  static readonly solvedContentRenderer = markRaw(ContentMailFact)
  readonly schema = CanonicalMailboxSchema

  static {
    Resolver.register(MailboxResolver.type, MailboxResolver)
  }
}

export class EmailAddressResolver extends JsonMailResolver<CanonicalEmailAddress> {
  static readonly type = 'extensions.mail.email_address.v1'
  static readonly previewRenderer = markRaw(ContentMailFactPreview)
  static readonly solvedContentRenderer = markRaw(ContentMailFact)
  readonly schema = CanonicalEmailAddressSchema

  static {
    Resolver.register(EmailAddressResolver.type, EmailAddressResolver)
  }
}

export class MailFlagResolver extends JsonMailResolver<CanonicalMailFlag> {
  static readonly type = 'extensions.mail.flag.v1'
  static readonly previewRenderer = markRaw(ContentMailFactPreview)
  static readonly solvedContentRenderer = markRaw(ContentMailFact)
  readonly schema = CanonicalMailFlagSchema

  static {
    Resolver.register(MailFlagResolver.type, MailFlagResolver)
  }
}

export class MailMimePartResolver extends Resolver<string, SolvedMimePart> {
  static readonly type = 'extensions.mail.mime_part.v1'
  static readonly previewRenderer = markRaw(ContentMimePartPreview)
  static readonly solvedContentRenderer = markRaw(ContentMimePart)

  static {
    Resolver.register(MailMimePartResolver.type, MailMimePartResolver)
  }

  protected async _getSolvedContent(options: ProjectionOptions): Promise<SolvedMimePart> {
    const root = CanonicalMimePartSchema.parse(parseJson(await this.getRawContent(options)))
    const relations = await this.getRelations({
      refresh: options.refresh,
      includeIn: false,
      includeOut: true,
    })
    const contentRelation = relations.find((relation) => relation.content === 'content')
    if (contentRelation) {
      const child = await Block.find(contentRelation.to_)
      if (child) return { root, content: await solveBlock(child, options) }
    }
    if (!options.materializeMissing) return { root, content: null }

    const delegated = await PeerManager.delegate(MAIL_MIME_PART_MATERIALIZE_CAPABILITY, {
      body: { block: this.block.id },
    })
    const response = PeerProtocolResponseSchema.parse(delegated)
    if (response.status !== 200 || !Object.prototype.hasOwnProperty.call(response, 'body')) {
      throw new Error(`Mail materialization Peer returned HTTP ${response.status}`)
    }
    const child = Block.parse(response.body)
    return { root, content: await solveBlock(child, options) }
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    const { root } = await this.getSolvedContent({ ...options, materializeMissing: false })
    return [root.filename, root.description, root.media_type].filter(Boolean).join('\n')
  }
}
