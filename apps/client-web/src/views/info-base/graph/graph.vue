<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, useNodesInitialized, useVueFlow, type NodeDragEvent } from '@vue-flow/core'
import { InkButton, InkDropdown, InkForm, InkLoading, InkPlaceholder } from '@inkcre/ui-web'
import { getInfoBaseRouter, type InfoBaseRoute } from '@inkcre/core'

import BlockNodeComponent from '@/components/info-base/BlockNode/BlockNode.vue'
import RelationEdgeComponent from '@/components/info-base/RelationEdge/RelationEdge.vue'
import BlockInspectorPopup from '@/components/info-base/BlockInspectorPopup/BlockInspectorPopup.vue'
import RelationInspectorPopup from '@/components/info-base/RelationInspectorPopup/RelationInspectorPopup.vue'
import SolvedContentPopup from '@/components/info-base/SolvedContentPopup/SolvedContentPopup.vue'
import { openRecallSearch } from '@/components/recall/recall-search'
import type { BlockNode, RelationEdge } from './graph-model'
import {
  layoutForce,
  layoutHierarchical,
  layoutNewNodes,
  layoutRadial,
  type MeasuredNode,
} from './graph-layouts'
import { useGraphScene } from './useGraphScene'

const { t } = useI18n()
const container = ref<HTMLElement | null>(null)

// ---------------------------------------------------------------------------
// Scene state (data loading, previews, presentation) lives in the composable;
// this view owns everything that requires the Vue Flow instance: measurement,
// layout application, edge routing, and the camera.
// ---------------------------------------------------------------------------

const scene = useGraphScene({
  layoutAndRoute: () => {
    layoutMeasuredNodes()
    updateNodeInternals(nodes.value.map((node) => node.id))
    void nextTick(() => routeEdges())
  },
  layoutMergedAndRoute: (newBlockIds: number[], focusBlock: number | null) => {
    const laidOut = layoutNewNodes(layoutContext(), new Set(newBlockIds.map(String)))
    if (laidOut) {
      nodes.value = laidOut
    } else {
      // No existing nodes to anchor to: run the selected full layout.
      layoutMeasuredNodes()
    }
    updateNodeInternals(nodes.value.map((node) => node.id))
    void nextTick(() => {
      routeEdges()
      if (focusBlock !== null) focusCameraOnNode(focusBlock)
    })
  },
})
const {
  nodes,
  edges,
  status,
  delegationUnavailable,
  scale,
  direction,
  expansionMode,
  layoutAlgorithm,
  pendingCamera,
  skipLayout,
  selectedBlock,
  positionCache,
  draggedNodes,
  currentRoute,
  sceneKey,
  focalBlock,
  focalRelation,
  sceneDescription,
  applyPresentation,
  loadScene,
  focusBlock,
  focusRelation,
} = scene

const scaleOptions = computed(() => [
  { value: 'compact', label: t('infoBase.graph.scale.compact') },
  { value: 'standard', label: t('infoBase.graph.scale.standard') },
  { value: 'broad', label: t('infoBase.graph.scale.broad') },
])
const directionOptions = computed(() => [
  { value: 'both', label: t('infoBase.graph.direction.both') },
  { value: 'in', label: t('infoBase.graph.direction.in') },
  { value: 'out', label: t('infoBase.graph.direction.out') },
])
const expansionModeOptions = computed(() => [
  { value: 'smooth', label: t('infoBase.graph.expansion.smooth') },
  { value: 'incremental', label: t('infoBase.graph.expansion.incremental') },
])
const layoutAlgorithmOptions = computed(() => [
  { value: 'radial', label: t('infoBase.graph.layout.radial') },
  { value: 'force', label: t('infoBase.graph.layout.force') },
  { value: 'hierarchical', label: t('infoBase.graph.layout.hierarchical') },
])

const {
  fitView,
  zoomIn,
  zoomOut,
  getNodes,
  onMoveStart,
  updateNodeInternals,
  setViewport,
  getViewport,
} = useVueFlow()
const nodesInitialized = useNodesInitialized()
onMoveStart(() => {
  pendingCamera.value = false
})

function measuredNodes(): MeasuredNode[] {
  return getNodes.value.map((node) => ({
    id: node.id,
    position: node.position,
    dimensions: node.dimensions,
  }))
}

function layoutContext() {
  return {
    nodes: nodes.value,
    edges: edges.value,
    measured: measuredNodes(),
    dragged: draggedNodes,
  }
}

function layoutMeasuredNodes(): void {
  const context = layoutContext()
  if (layoutAlgorithm.value === 'radial') {
    nodes.value = layoutRadial(context, focalBlock.value !== null ? String(focalBlock.value) : null)
  } else if (layoutAlgorithm.value === 'force') {
    nodes.value = layoutForce(context)
  } else {
    nodes.value = layoutHierarchical(context)
  }
}

function routeEdges(): void {
  const centers = new Map(
    getNodes.value.map((node) => [
      node.id,
      {
        x: node.position.x + node.dimensions.width / 2,
        y: node.position.y + node.dimensions.height / 2,
      },
    ])
  )
  edges.value = edges.value.map((edge) => {
    const source = centers.get(edge.source)
    const target = centers.get(edge.target)
    if (!source || !target) return edge
    const dx = target.x - source.x
    const dy = target.y - source.y
    const [from, to] =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? ['right', 'left']
          : ['left', 'right']
        : dy > 0
          ? ['bottom', 'top']
          : ['top', 'bottom']
    return { ...edge, sourceHandle: `source-${from}`, targetHandle: `target-${to}` }
  })
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const realizing = ref(false)
let realizationRequested = false

/** Focus the camera on a node without changing zoom. */
function focusCameraOnNode(blockId: number): void {
  const node = getNodes.value.find((n) => n.id === String(blockId))
  if (!node) return
  const centerX = node.position.x + node.dimensions.width / 2
  const centerY = node.position.y + node.dimensions.height / 2
  const rect = container.value?.querySelector('.vue-flow')?.getBoundingClientRect()
  const currentZoom = getViewport()?.zoom ?? 1
  void setViewport(
    {
      x: (rect?.width ?? 800) / 2 - centerX * currentZoom,
      y: (rect?.height ?? 600) / 2 - centerY * currentZoom,
      zoom: currentZoom,
    },
    {
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400,
    }
  )
}

async function realizeScene(): Promise<void> {
  if (realizing.value) {
    realizationRequested = true
    return
  }
  realizing.value = true
  const current = scene.epoch.value // snapshot for the timeout guard below
  try {
    // Trigger node measurement
    updateNodeInternals(nodes.value.map((node) => node.id))
    // Use setTimeout instead of await to avoid blocking
    setTimeout(() => {
      if (current !== scene.epoch.value) {
        realizing.value = false
        return
      }
      // Skip layout when in incremental merge mode (nodes already positioned)
      if (!skipLayout.value) {
        layoutMeasuredNodes()
      }
      routeEdges()
      if (!pendingCamera.value) {
        realizing.value = false
        return
      }
      pendingCamera.value = false
      const narrow = (container.value?.clientWidth ?? 0) < 640
      const focalId =
        focalBlock.value ??
        (scene.sceneAddress.value?.type === 'path' ? scene.sceneAddress.value.from : null)
      const visibleNodes =
        narrow && focalId !== null ? [String(focalId)] : nodes.value.map((node) => node.id)
      void fitView({
        nodes: visibleNodes,
        minZoom: 0.05,
        maxZoom: 1,
        padding: 0.3,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260,
      }).finally(() => {
        realizing.value = false
        if (realizationRequested) {
          realizationRequested = false
          void realizeScene()
        }
      })
    }, 100)
  } catch (error) {
    realizing.value = false
    console.error('[Graph] realizeScene error:', error)
  }
}

function refocus(): void {
  pendingCamera.value = true
  void realizeScene()
}

// ---------------------------------------------------------------------------
// Vue Flow event handlers
// ---------------------------------------------------------------------------

function onNodeDragStart(event: NodeDragEvent): void {
  pendingCamera.value = false
  draggedNodes.add(event.node.id)
}

function onNodeDrag(_event: NodeDragEvent): void {
  // Update edge routing in real-time during drag for responsive feel
  routeEdges()
}

function onNodeDragStop(event: NodeDragEvent): void {
  positionCache.set(event.node.id, { ...event.node.position })
  draggedNodes.delete(event.node.id)
  routeEdges()
}

// ---------------------------------------------------------------------------
// Glue: react to scene, route, and measurement changes
// ---------------------------------------------------------------------------

watch(
  [sceneKey, scale],
  () => {
    // In incremental mode, scene changes are handled by mergeGraph; skip full reload.
    if (expansionMode.value === 'incremental' && status.value === 'ready') return
    void loadScene()
  },
  { immediate: true }
)
watch(direction, applyPresentation)
watch(layoutAlgorithm, () => {
  // Re-layout when algorithm changes
  layoutMeasuredNodes()
  void nextTick(() => routeEdges())
})
watch(
  [
    nodesInitialized,
    () =>
      getNodes.value
        .map((node) => `${node.id}:${node.dimensions.width}:${node.dimensions.height}`)
        .join(','),
  ],
  () => {
    if (nodesInitialized.value) void realizeScene()
  }
)

// ---------------------------------------------------------------------------
// Navigation and side panels
// ---------------------------------------------------------------------------

function inspectBlock(block: number): void {
  selectedBlock.value = block
  void infoBaseRouter.push({ name: 'block', block })
}
function inspectRelation(relation: number): void {
  selectedBlock.value = null
  void infoBaseRouter.push({ name: 'relation', relation })
}

const infoBaseRouter = getInfoBaseRouter()

function onRuminated(): void {
  void loadScene()
}

function isRoute(route: InfoBaseRoute | null, name: InfoBaseRoute['name']): boolean {
  return route?.name === name
}

// Check if side panel is open (block or relation detail)
const isSidePanelOpen = computed(() => {
  return currentRoute.value?.name === 'block' || currentRoute.value?.name === 'relation'
})

function closeSidePanel(): void {
  selectedBlock.value = null
  void infoBaseRouter.back()
}
</script>

<template>
  <main ref="container" class="graph-view">
    <header class="graph-view__toolbar">
      <div class="graph-view__context">
        <h1>{{ sceneDescription }}</h1>
        <p v-if="status === 'ready'">
          {{ t('infoBase.graph.stats', { blocks: nodes.length, relations: edges.length }) }}
        </p>
      </div>
      <div class="graph-view__actions">
        <InkButton
          v-if="focalRelation !== null"
          :text="t('infoBase.graph.relationDetails')"
          theme="subtle"
          :aria-label="t('infoBase.graph.inspectRelation', { relation: focalRelation })"
          @click="inspectRelation(focalRelation)"
        />
        <details v-if="focalBlock !== null" class="graph-view__options">
          <summary class="graph-view__options-summary">
            {{ t('infoBase.graph.viewOptions') }}
          </summary>
          <InkForm layout="col">
            <InkDropdown
              v-model="scale"
              :label="t('infoBase.graph.neighborhoodSize')"
              :options="scaleOptions"
            />
            <InkDropdown
              v-model="direction"
              :label="t('infoBase.graph.emphasizeRelations')"
              :options="directionOptions"
            />
            <InkDropdown
              v-model="expansionMode"
              :label="t('infoBase.graph.expansionMode')"
              :options="expansionModeOptions"
            />
            <InkDropdown
              v-model="layoutAlgorithm"
              :label="t('infoBase.graph.layoutAlgorithm')"
              :options="layoutAlgorithmOptions"
            />
          </InkForm>
        </details>
      </div>
    </header>

    <div v-if="status === 'loading' && nodes.length === 0" class="graph-view__state" role="status">
      <InkLoading />
      <p>{{ t('infoBase.graph.loading') }}</p>
    </div>
    <InkPlaceholder
      v-else-if="status !== 'ready' && nodes.length === 0"
      class="graph-view__placeholder"
      :state="status === 'error' ? 'error' : 'empty'"
      :title="
        status === 'empty'
          ? t('infoBase.graph.emptyTitle')
          : status === 'missing'
            ? t('infoBase.graph.missingTitle')
            : status === 'not-found'
              ? t('infoBase.graph.notFoundTitle')
              : status === 'limit'
                ? t('infoBase.graph.limitTitle')
                : t('infoBase.graph.errorTitle')
      "
      :description="
        status === 'empty' || status === 'missing'
          ? t('infoBase.graph.emptyHint')
          : status === 'limit'
            ? t('infoBase.graph.limitHint')
            : status === 'not-found'
              ? t('infoBase.graph.notFoundHint')
              : delegationUnavailable
                ? t('infoBase.graph.delegationUnavailableHint')
                : t('infoBase.graph.genericHint')
      "
    >
      <template #actions>
        <InkButton
          v-if="status === 'error'"
          :text="t('infoBase.graph.retry')"
          theme="primary"
          @click="loadScene"
        />
        <InkButton
          v-else
          :text="t('infoBase.graph.searchInformation')"
          theme="subtle"
          @click="openRecallSearch"
        />
      </template>
    </InkPlaceholder>

    <VueFlow
      v-else
      v-model:nodes="nodes"
      v-model:edges="edges"
      class="graph-view__flow"
      :min-zoom="0.05"
      :max-zoom="2.4"
      :nodes-draggable="true"
      :node-drag-threshold="0"
      :pan-on-drag="[0, 1, 2]"
      @nodeDragStart="onNodeDragStart"
      @nodeDrag="onNodeDrag"
      @nodeDragStop="onNodeDragStop"
    >
      <template #node-block="nodeProps">
        <BlockNodeComponent
          v-bind="nodeProps"
          :selected="nodeProps.data.block.id === selectedBlock"
          @focus="focusBlock"
          @inspect="inspectBlock"
        />
      </template>
      <template #edge-relation="edgeProps">
        <RelationEdgeComponent v-bind="edgeProps" @focus="focusRelation" />
      </template>
      <div class="graph-view__viewport-controls">
        <InkButton
          icon="i-mdi-plus"
          aria-label="Zoom in"
          type="square"
          theme="subtle"
          @click="zoomIn()"
        />
        <InkButton
          icon="i-mdi-minus"
          aria-label="Zoom out"
          type="square"
          theme="subtle"
          @click="zoomOut()"
        />
        <InkButton
          icon="i-mdi-crosshairs-gps"
          aria-label="Focus current"
          type="square"
          theme="subtle"
          @click="refocus"
        />
      </div>
    </VueFlow>

    <!-- Transparent scrim for side panels -->
    <div v-if="isSidePanelOpen" class="graph-view__scrim" @click="closeSidePanel" />

    <BlockInspectorPopup
      v-if="isRoute(currentRoute, 'block') && currentRoute?.name === 'block'"
      :block="currentRoute.block"
      @ruminated="onRuminated"
    />
    <RelationInspectorPopup
      v-else-if="isRoute(currentRoute, 'relation') && currentRoute?.name === 'relation'"
      :relation="currentRoute.relation"
    />
    <SolvedContentPopup
      v-else-if="isRoute(currentRoute, 'solved-content') && currentRoute?.name === 'solved-content'"
      :block="currentRoute.block"
    />
  </main>
</template>

<style scoped lang="scss" src="./graph.scss" />
