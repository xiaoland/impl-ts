import { computed, onUnmounted, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  CapabilityDelegationUnavailable,
  configStore,
  UnknownResolverError,
  getInfoBaseRouter,
  GraphNavigationRetrievalManager,
  LexicalRetrievalManager,
  presentLexicalMatches,
  ResolverCache,
  type Block,
  type GraphDirection,
  type GraphModel,
  type Relation,
} from '@inkcre/core'

import { extensionHostRestoreState, getExtensionHost } from '@/core'
import { blockNode, relationEdge, type BlockNode, type RelationEdge } from './graph-model'
import { layoutNewNodes, type LayoutAlgorithm } from './graph-layouts'

export type { LayoutAlgorithm }

export type SceneScale = 'compact' | 'standard' | 'broad'
export type SceneStatus =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'missing'
  | 'not-found'
  | 'limit'
  | 'error'
export type ExpansionMode = 'smooth' | 'incremental'

export type SceneAddress =
  | { type: 'path'; from: number; to: number }
  | { type: 'relation'; relation: number }
  | { type: 'block'; block: number }
  | { type: 'recall'; query: string }
  | { type: 'random' }

const SCALE_LIMITS: Record<SceneScale, number> = { compact: 8, standard: 20, broad: 50 }
const EXPANSION_MODE_KEY = 'inkcre.graph.expansionMode'
const LAYOUT_KEY = 'inkcre.graph.layout'

/**
 * Layout/routing work that requires the Vue Flow instance. The view wires these
 * to its `useVueFlow()` helpers; the composable stays free of rendering concerns.
 */
export interface GraphSceneHooks {
  /** After a full graph replace: run the selected layout, refresh internals, re-route edges. */
  layoutAndRoute: () => void
  /** After an incremental merge: position new nodes, refresh, re-route, then focus the camera. */
  layoutMergedAndRoute: (newBlockIds: number[], focusBlock: number | null) => void
}

interface PendingPreview {
  block: Block
  relations: Relation[]
  owns: () => boolean
}

/**
 * Graph scene state: route-driven scene identity, data loading (full replace and
 * incremental merge), preview resolution, and focal presentation.
 *
 * Generation-guarded throughout: any async result that arrives after a newer
 * load has started is discarded, including preview workers that capture the
 * extension host and connection they belong to.
 */
export function useGraphScene(hooks: GraphSceneHooks) {
  const { t } = useI18n()
  const infoBaseRouter = getInfoBaseRouter()
  const currentRoute = computed(() => infoBaseRouter.current.value)

  const nodes: ShallowRef<BlockNode[]> = shallowRef([])
  const edges: ShallowRef<RelationEdge[]> = shallowRef([])
  const status = ref<SceneStatus>('loading')
  const delegationUnavailable = ref(false)
  const scale = ref<SceneScale>('standard')
  const direction = ref<GraphDirection>('both')
  const expansionMode = ref<ExpansionMode>(
    (localStorage.getItem(EXPANSION_MODE_KEY) as ExpansionMode) || 'smooth'
  )
  const layoutAlgorithm = ref<LayoutAlgorithm>(
    (localStorage.getItem(LAYOUT_KEY) as LayoutAlgorithm) || 'radial'
  )
  const previewReady = ref(false)
  const pendingCamera = ref(false)
  const transitioning = ref(false)
  const skipLayout = ref(false)
  const selectedBlock = ref<number | null>(null)

  /** User-dragged coordinates survive relayouts until the scene reloads. */
  const positionCache = new Map<string, { x: number; y: number }>()
  const draggedNodes = new Set<string>()

  let generation = 0
  /** Increments on every scene load; the view uses it to abort stale async work. */
  const epoch = ref(0)

  watch(expansionMode, (mode) => {
    localStorage.setItem(EXPANSION_MODE_KEY, mode)
  })
  watch(layoutAlgorithm, (algorithm) => {
    localStorage.setItem(LAYOUT_KEY, algorithm)
  })

  const sceneAddress = computed<SceneAddress | null>(() => {
    const route = currentRoute.value
    if (!route) return null
    if (route.path_from !== undefined && route.path_to !== undefined) {
      return { type: 'path', from: route.path_from, to: route.path_to }
    }
    if (route.focal_relation !== undefined) {
      return { type: 'relation', relation: route.focal_relation }
    }
    if (route.focal_block !== undefined) {
      return { type: 'block', block: route.focal_block }
    }
    if (route.q) return { type: 'recall', query: route.q }
    if (route.name === 'relation') return { type: 'relation', relation: route.relation }
    if (route.name === 'block' || route.name === 'solved-content') {
      return { type: 'block', block: route.block }
    }
    return { type: 'random' }
  })

  const sceneKey = computed(() => JSON.stringify(sceneAddress.value))
  const focalBlock = computed(() => {
    const address = sceneAddress.value
    return address?.type === 'block' ? address.block : null
  })
  const focalRelation = computed(() => {
    const address = sceneAddress.value
    return address?.type === 'relation' ? address.relation : null
  })

  const sceneDescription = computed(() => {
    const address = sceneAddress.value
    if (address?.type === 'block') return t('infoBase.graph.scene.block', { block: address.block })
    if (address?.type === 'relation')
      return t('infoBase.graph.scene.relation', { relation: address.relation })
    if (address?.type === 'path')
      return t('infoBase.graph.scene.path', { from: address.from, to: address.to })
    if (address?.type === 'recall')
      return t('infoBase.graph.scene.recall', { query: address.query })
    return t('infoBase.graph.scene.default')
  })

  // Restore may register reading destinations after the initial query has already returned.
  watch(extensionHostRestoreState, (state) => {
    if (['restored', 'failed'].includes(state) && sceneAddress.value?.type === 'recall') {
      void loadScene()
    }
  })

  function activeRelation(relation: Relation): boolean {
    if (direction.value === 'both') return true
    if (focalRelation.value === relation.id) return true
    if (focalBlock.value === null) return true
    return direction.value === 'out'
      ? relation.from_ === focalBlock.value
      : relation.to_ === focalBlock.value
  }

  function applyPresentation(): void {
    const activeBlocks = new Set<number>()
    if (focalBlock.value !== null) activeBlocks.add(focalBlock.value)
    for (const edge of edges.value) {
      if (activeRelation(edge.data.relation)) {
        activeBlocks.add(edge.data.relation.from_)
        activeBlocks.add(edge.data.relation.to_)
      }
    }
    edges.value = edges.value.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        focal: edge.data.relation.id === focalRelation.value,
        muted: !activeRelation(edge.data.relation),
      },
    }))
    nodes.value = nodes.value.map((node) => ({
      ...node,
      data: {
        ...node.data,
        focal: node.data.block.id === focalBlock.value,
        muted: direction.value !== 'both' && !activeBlocks.has(node.data.block.id),
      },
    }))
  }

  function setGraph(graph: GraphModel): void {
    const incident = new Map<number, Relation[]>()
    for (const relation of graph.relations) {
      incident.set(relation.from_, [...(incident.get(relation.from_) ?? []), relation])
      incident.set(relation.to_, [...(incident.get(relation.to_) ?? []), relation])
    }
    nodes.value = graph.blocks.map((block) =>
      blockNode(block, {
        focal: block.id === focalBlock.value,
        muted: false,
        position: positionCache.get(String(block.id)),
      })
    )
    edges.value = graph.relations.map((relation) =>
      relationEdge(relation, {
        focal: relation.id === focalRelation.value,
        muted: false,
      })
    )
    applyPresentation()
    void loadPreviews(graph.blocks, incident, generation)
    // Layout after a short delay to allow Vue Flow to measure nodes.
    setTimeout(() => {
      hooks.layoutAndRoute()
    }, 100)
  }

  // --------------------------------------------------------------------------
  // Preview resolution
  // --------------------------------------------------------------------------

  const pendingPreviews = shallowRef<PendingPreview[]>([])

  function updatePreviewReady(): void {
    previewReady.value = nodes.value.every((node) => node.data.previewStatus !== 'loading')
  }

  async function resolvePreview(entry: PendingPreview, allowRestoreRetry: boolean): Promise<void> {
    if (!entry.owns()) return
    const lookupBeforeRestore =
      allowRestoreRetry && ['idle', 'restoring'].includes(extensionHostRestoreState.value)
    try {
      const resolver = await ResolverCache.getResolver(entry.block, entry.relations)
      const solvedContent = await resolver.getSolvedContent({ materializeMissing: false })
      if (!entry.owns()) return
      nodes.value = nodes.value.map((node) =>
        node.data.block.id === entry.block.id
          ? { ...node, data: { ...node.data, resolver, solvedContent, previewStatus: 'success' } }
          : node
      )
    } catch (cause) {
      if (!entry.owns()) return
      if (lookupBeforeRestore && cause instanceof UnknownResolverError) {
        pendingPreviews.value = [...pendingPreviews.value, entry]
        return
      }
      console.error(`[InfoBase] Failed to resolve preview for Block ${entry.block.id}.`, cause)
      nodes.value = nodes.value.map((node) =>
        node.data.block.id === entry.block.id
          ? { ...node, data: { ...node.data, previewStatus: 'error' } }
          : node
      )
    }
    if (entry.owns()) updatePreviewReady()
  }

  // Both registration completion and a late early-lookup failure can make a retry ready.
  watch([extensionHostRestoreState, pendingPreviews], ([state]) => {
    if (!['restored', 'failed'].includes(state) || pendingPreviews.value.length === 0) return
    const pending = pendingPreviews.value
    pendingPreviews.value = []
    for (const entry of pending) void resolvePreview(entry, false)
  })
  onUnmounted(() => {
    generation += 1
    epoch.value = generation
    pendingPreviews.value = []
  })

  async function loadPreviews(
    blocks: Block[],
    incident: Map<number, Relation[]>,
    current: number
  ): Promise<void> {
    previewReady.value = false
    const meta = { ...configStore.metaConfig }
    const host = getExtensionHost()
    const owns = () =>
      current === generation &&
      getExtensionHost() === host &&
      configStore.metaConfig.INKCRE_PEER_ID === meta.INKCRE_PEER_ID &&
      configStore.metaConfig.INKCRE_PGREST_URL === meta.INKCRE_PGREST_URL &&
      configStore.metaConfig.INKCRE_JWT_SECRET === meta.INKCRE_JWT_SECRET
    let index = 0
    async function worker(): Promise<void> {
      while (index < blocks.length) {
        const block = blocks[index++]!
        await resolvePreview({ block, relations: incident.get(block.id) ?? [], owns }, true)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, blocks.length) }, () => worker()))
    if (owns()) updatePreviewReady()
  }

  // --------------------------------------------------------------------------
  // Scene loading
  // --------------------------------------------------------------------------

  async function loadScene(): Promise<void> {
    const current = ++generation
    epoch.value = current
    pendingPreviews.value = []
    // Only show full loading state when graph is empty (first load).
    // During smooth transitions, keep the existing graph visible while new data loads.
    const isFirstLoad = nodes.value.length === 0
    if (isFirstLoad) {
      status.value = 'loading'
    }
    delegationUnavailable.value = false
    previewReady.value = false
    pendingCamera.value = true
    try {
      const address = sceneAddress.value
      if (!address) return

      if (address.type === 'random') {
        const block = await GraphNavigationRetrievalManager.getRandomBlock()
        if (current !== generation) return
        if (!block) {
          nodes.value = []
          edges.value = []
          status.value = 'empty'
          return
        }
        await infoBaseRouter.push({ name: 'overview', focal_block: block.id })
        return
      }

      let graph: GraphModel | null = null
      let nextStatus: SceneStatus = 'empty'
      if (address.type === 'block') {
        const result = await GraphNavigationRetrievalManager.getBlockNeighborhood(address.block, {
          direction: 'both',
          limit: SCALE_LIMITS[scale.value],
        })
        graph = result?.graph ?? null
        if (!graph) nextStatus = 'missing'
      } else if (address.type === 'relation') {
        const result = await GraphNavigationRetrievalManager.getRelationNeighborhood(
          address.relation
        )
        graph = result?.graph ?? null
        if (!graph) nextStatus = 'missing'
      } else if (address.type === 'path') {
        const result = await GraphNavigationRetrievalManager.findPath(address.from, address.to)
        if (result.status === 'found') graph = result.graph
        else nextStatus = result.status === 'not_found' ? 'not-found' : 'limit'
      } else {
        const result = await LexicalRetrievalManager.retrieve({ query: address.query, limit: 20 })
        const groups = await presentLexicalMatches(result.matches)
        graph = { blocks: groups.map((group) => group.block), relations: [] }
      }
      if (current !== generation) return
      transitioning.value = false
      if (graph) {
        setGraph(graph)
        status.value = graph.blocks.length > 0 ? 'ready' : 'empty'
      } else {
        status.value = nextStatus
        nodes.value = []
        edges.value = []
      }
    } catch (cause) {
      if (current !== generation) return
      console.error('[InfoBase] Failed to load Graph scene.', cause)
      nodes.value = []
      edges.value = []
      delegationUnavailable.value = cause instanceof CapabilityDelegationUnavailable
      status.value = 'error'
      transitioning.value = false
    }
  }

  // --------------------------------------------------------------------------
  // Focus and incremental expansion
  // --------------------------------------------------------------------------

  function setNodeFocusing(blockId: number | null): void {
    nodes.value = nodes.value.map((node) => ({
      ...node,
      data: {
        ...node.data,
        focusing: blockId !== null && node.data.block.id === blockId,
      },
    }))
  }

  function focusBlock(block: number): void {
    transitioning.value = true
    selectedBlock.value = block
    setNodeFocusing(block)
    if (expansionMode.value === 'incremental') {
      // Incremental: load new neighborhood and merge into existing graph.
      void loadIncrementalBlock(block).finally(() => {
        transitioning.value = false
        setNodeFocusing(null)
      })
    } else {
      // Smooth: replace graph, animate camera to new focal.
      void infoBaseRouter.push({ name: 'overview', focal_block: block })
    }
  }

  function focusRelation(relation: number): void {
    transitioning.value = true
    setNodeFocusing(null)
    if (expansionMode.value === 'incremental') {
      void loadIncrementalRelation(relation).finally(() => {
        transitioning.value = false
      })
    } else {
      void infoBaseRouter.push({ name: 'overview', focal_relation: relation })
    }
  }

  async function loadIncrementalBlock(block: number): Promise<void> {
    const current = generation
    try {
      const result = await GraphNavigationRetrievalManager.getBlockNeighborhood(block, {
        direction: 'both',
        limit: SCALE_LIMITS[scale.value],
      })
      if (current !== generation || !result?.graph) return
      mergeGraph(result.graph, block)
      // Update URL to reflect new focal without full reload
      void infoBaseRouter.push({ name: 'overview', focal_block: block })
    } catch (cause) {
      console.error('[InfoBase] Failed to load incremental neighborhood.', cause)
    }
  }

  async function loadIncrementalRelation(relation: number): Promise<void> {
    const current = generation
    try {
      const result = await GraphNavigationRetrievalManager.getRelationNeighborhood(relation)
      if (current !== generation || !result?.graph) return
      mergeGraph(result.graph, null, relation)
      void infoBaseRouter.push({ name: 'overview', focal_relation: relation })
    } catch (cause) {
      console.error('[InfoBase] Failed to load incremental relation.', cause)
    }
  }

  function mergeGraph(
    graph: GraphModel,
    newFocalBlock: number | null,
    newFocalRelation?: number
  ): void {
    const existingBlockIds = new Set(nodes.value.map((node) => node.data.block.id))
    const existingRelationIds = new Set(edges.value.map((edge) => edge.data.relation.id))

    const newBlocks = graph.blocks.filter((block) => !existingBlockIds.has(block.id))
    const newRelations = graph.relations.filter((relation) => !existingRelationIds.has(relation.id))

    if (newBlocks.length === 0 && newRelations.length === 0) {
      // Just update focal highlighting and move camera to focal block
      applyPresentation()
      if (newFocalBlock !== null) {
        setTimeout(() => {
          hooks.layoutMergedAndRoute([], newFocalBlock)
        }, 100)
      }
      return
    }

    const incident = new Map<number, Relation[]>()
    for (const relation of graph.relations) {
      incident.set(relation.from_, [...(incident.get(relation.from_) ?? []), relation])
      incident.set(relation.to_, [...(incident.get(relation.to_) ?? []), relation])
    }

    // Add new nodes with temporary positions (positioned by the layout hook)
    const newNodes = newBlocks.map((block) =>
      blockNode(block, {
        focal: block.id === newFocalBlock,
        muted: false,
        position: { x: 0, y: 0 },
      })
    )
    const newEdges = newRelations.map((relation) =>
      relationEdge(relation, {
        focal: relation.id === newFocalRelation,
        muted: false,
      })
    )

    // Merge into existing graph
    nodes.value = [...nodes.value, ...newNodes]
    edges.value = [...edges.value, ...newEdges]

    // Update focal highlighting
    const targetFocal = newFocalBlock ?? focalBlock.value
    const targetFocalRelation = newFocalRelation ?? focalRelation.value
    nodes.value = nodes.value.map((node) => ({
      ...node,
      data: {
        ...node.data,
        focal: node.data.block.id === targetFocal,
      },
    }))
    edges.value = edges.value.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        focal: edge.data.relation.id === targetFocalRelation,
      },
    }))

    // Load previews for new blocks only
    void loadPreviews(newBlocks, incident, generation)

    // Layout only new nodes around existing graph, then focus camera.
    // Set skipLayout to prevent the view from re-layouting all nodes.
    skipLayout.value = true
    setTimeout(() => {
      hooks.layoutMergedAndRoute(
        newBlocks.map((block) => block.id),
        newFocalBlock
      )
      // Reset skipLayout after a delay to allow the measurement watcher to fire
      setTimeout(() => {
        skipLayout.value = false
      }, 200)
    }, 100)
  }

  return {
    // State
    nodes,
    edges,
    status,
    delegationUnavailable,
    scale,
    direction,
    expansionMode,
    layoutAlgorithm,
    previewReady,
    pendingCamera,
    transitioning,
    skipLayout,
    selectedBlock,
    positionCache,
    draggedNodes,
    epoch,
    // Derived scene identity
    currentRoute,
    sceneAddress,
    sceneKey,
    focalBlock,
    focalRelation,
    sceneDescription,
    // Actions
    applyPresentation,
    loadScene,
    focusBlock,
    focusRelation,
    setNodeFocusing,
    mergeGraph,
    layoutNewNodes,
  }
}
