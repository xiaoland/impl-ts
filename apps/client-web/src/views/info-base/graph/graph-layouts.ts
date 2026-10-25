import dagre from '@dagrejs/dagre'
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceCenter,
  forceRadial,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'

import type { BlockNode, RelationEdge } from './graph-model'

/**
 * Graph layout algorithms.
 *
 * Every layout returns a position map for the nodes it manages; the caller
 * applies them to its reactive state. Dragged nodes always keep their current
 * coordinates — a user drag owns its position until a full scene reload.
 */

/** Block card dimensions used for collision and size estimation. */
export const GRAPH_NODE_WIDTH = 182
export const GRAPH_NODE_HEIGHT = 122
/** Fallback size when Vue Flow has not measured a node yet. */
export const FALLBACK_NODE_WIDTH = 180
export const FALLBACK_NODE_HEIGHT = 80

/** Minimal structural view of a Vue Flow node, to avoid coupling to its API. */
export interface MeasuredNode {
  id: string
  position: { x: number; y: number }
  dimensions: { width: number; height: number }
}

export interface LayoutContext {
  nodes: BlockNode[]
  edges: RelationEdge[]
  measured: MeasuredNode[]
  dragged: Set<string>
}

export type LayoutAlgorithm = 'hierarchical' | 'radial' | 'force'

interface SimNode extends SimulationNodeDatum {
  id: string
  radius: number
  targetRadius?: number
}

type SimLink = SimulationLinkDatum<SimNode>

function measuredById(ctx: LayoutContext): Map<string, MeasuredNode> {
  return new Map(ctx.measured.map((node) => [node.id, node]))
}

/** Positions of dragged nodes are pinned to their current coordinates. */
function pinDragged(
  ctx: LayoutContext,
  byId: Map<string, MeasuredNode>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  for (const node of ctx.nodes) {
    if (ctx.dragged.has(node.id)) {
      const current = byId.get(node.id)?.position
      if (current) positions.set(node.id, current)
    }
  }
  return positions
}

function applyPositions(
  nodes: BlockNode[],
  positions: Map<string, { x: number; y: number }>
): BlockNode[] {
  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }))
}

/** Run a d3-force simulation synchronously and return the settled positions. */
function simulate(
  simNodes: SimNode[],
  simLinks: SimLink[],
  forces: (sim: ReturnType<typeof forceSimulation<SimNode>>) => void
): Map<string, { x: number; y: number }> {
  const simulation = forceSimulation(simNodes).stop()
  forces(simulation)
  for (let i = 0; i < 300; i++) {
    simulation.tick()
  }
  const positions = new Map<string, { x: number; y: number }>()
  for (const simNode of simNodes) {
    positions.set(simNode.id, {
      x: (simNode.x ?? 0) - GRAPH_NODE_WIDTH / 2,
      y: (simNode.y ?? 0) - GRAPH_NODE_HEIGHT / 2,
    })
  }
  return positions
}

function buildSimLinks(simNodes: SimNode[], edges: RelationEdge[]): SimLink[] {
  const ids = new Set(simNodes.map((node) => node.id))
  return edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }))
}

/** Hierarchical top-down layout via dagre. Skips dragged nodes. */
export function layoutHierarchical(ctx: LayoutContext): BlockNode[] {
  const byId = measuredById(ctx)
  const unpositioned = ctx.nodes.filter((node) => !ctx.dragged.has(node.id))
  if (unpositioned.length === 0) return ctx.nodes

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120, marginx: 40, marginy: 40 })

  for (const node of unpositioned) {
    const measured = byId.get(node.id)
    g.setNode(node.id, {
      width: measured?.dimensions.width || FALLBACK_NODE_WIDTH,
      height: measured?.dimensions.height || FALLBACK_NODE_HEIGHT,
    })
  }
  for (const edge of ctx.edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(g)

  const positions = pinDragged(ctx, byId)
  for (const node of unpositioned) {
    const laidOut = g.node(node.id)
    if (laidOut) {
      positions.set(node.id, {
        x: laidOut.x - laidOut.width / 2,
        y: laidOut.y - laidOut.height / 2,
      })
    }
  }
  return applyPositions(ctx.nodes, positions)
}

/** Force-directed layout via d3-force. */
export function layoutForce(ctx: LayoutContext): BlockNode[] {
  const byId = measuredById(ctx)
  const simNodes: SimNode[] = ctx.nodes.map((node) => ({
    id: node.id,
    x: byId.get(node.id)?.position.x ?? (Math.random() - 0.5) * 400,
    y: byId.get(node.id)?.position.y ?? (Math.random() - 0.5) * 400,
    radius: Math.hypot(GRAPH_NODE_WIDTH, GRAPH_NODE_HEIGHT) / 2,
  }))
  const simLinks = buildSimLinks(simNodes, ctx.edges)

  const positions = simulate(simNodes, simLinks, (simulation) => {
    simulation
      .force('charge', forceManyBody().strength(-800))
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((node) => node.id)
          .distance(250)
          .strength(0.5)
      )
      .force(
        'collide',
        forceCollide<SimNode>()
          .radius((node) => node.radius + 40)
          .iterations(2)
      )
      .force('center', forceCenter(0, 0))
  })

  for (const [id, position] of pinDragged(ctx, byId)) {
    positions.set(id, position)
  }
  return applyPositions(ctx.nodes, positions)
}

/** Radial layout: rings by BFS depth from the focal block, via d3-force. */
export function layoutRadial(ctx: LayoutContext, focalId: string | null): BlockNode[] {
  const byId = measuredById(ctx)

  // Adjacency from edges, BFS from the focal node to assign ring depths.
  const adjacency = new Map<string, string[]>()
  for (const edge of ctx.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, [])
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, [])
    adjacency.get(edge.source)!.push(edge.target)
    adjacency.get(edge.target)!.push(edge.source)
  }

  const ringDepth = new Map<string, number>()
  if (focalId) {
    const visited = new Set<string>([focalId])
    const queue: Array<[string, number]> = [[focalId, 0]]
    ringDepth.set(focalId, 0)
    while (queue.length > 0) {
      const [current, depth] = queue.shift()!
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          ringDepth.set(neighbor, depth + 1)
          queue.push([neighbor, depth + 1])
        }
      }
    }
    const maxDepth = Math.max(...ringDepth.values(), 0)
    for (const node of ctx.nodes) {
      if (!ringDepth.has(node.id)) ringDepth.set(node.id, maxDepth + 1)
    }
  } else {
    for (const node of ctx.nodes) ringDepth.set(node.id, 1)
  }

  const maxDepth = Math.max(...ringDepth.values(), 1)
  const baseRadius = 300
  const radiusStep = 250
  const depthRadius = new Map<number, number>()
  for (let depth = 1; depth <= maxDepth; depth++) {
    depthRadius.set(depth, baseRadius + (depth - 1) * radiusStep)
  }

  const simNodes: SimNode[] = ctx.nodes.map((node) => {
    const depth = ringDepth.get(node.id) ?? 1
    return {
      id: node.id,
      x: byId.get(node.id)?.position.x ?? (Math.random() - 0.5) * 400,
      y: byId.get(node.id)?.position.y ?? (Math.random() - 0.5) * 400,
      radius: Math.hypot(GRAPH_NODE_WIDTH, GRAPH_NODE_HEIGHT) / 2,
      targetRadius: depth === 0 ? 0 : (depthRadius.get(depth) ?? baseRadius),
    }
  })
  const simLinks = buildSimLinks(simNodes, ctx.edges)

  const positions = simulate(simNodes, simLinks, (simulation) => {
    simulation
      .force('charge', forceManyBody().strength(-500))
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((node) => node.id)
          .distance(200)
          .strength(0.3)
      )
      .force(
        'collide',
        forceCollide<SimNode>()
          .radius((node) => node.radius + 30)
          .iterations(2)
      )
      .force('radial', forceRadial<SimNode>((node) => node.targetRadius ?? 0, 0, 0).strength(0.8))
  })

  for (const [id, position] of pinDragged(ctx, byId)) {
    positions.set(id, position)
  }
  return applyPositions(ctx.nodes, positions)
}

/**
 * Position only the newly merged nodes near their connected existing nodes;
 * existing nodes keep their coordinates.
 * Returns null when there are no existing nodes to anchor to — the caller
 * should then run its full layout algorithm of choice.
 */
export function layoutNewNodes(ctx: LayoutContext, newNodeIds: Set<string>): BlockNode[] | null {
  const newNodes = ctx.nodes.filter((node) => newNodeIds.has(node.id))
  const existingPositions = new Map<string, { x: number; y: number }>()
  for (const node of ctx.nodes) {
    if (!newNodeIds.has(node.id)) existingPositions.set(node.id, node.position)
  }

  if (existingPositions.size === 0) {
    return null
  }

  const spacing = 250
  const positions = new Map<string, { x: number; y: number }>()
  const connectionCount = new Map<string, number>()

  const anchor = (connectedId: string): { x: number; y: number } | null => {
    const connectedPos = existingPositions.get(connectedId)
    if (!connectedPos) return null
    const offsetIndex = connectionCount.get(connectedId) ?? 0
    connectionCount.set(connectedId, offsetIndex + 1)
    return {
      x: connectedPos.x + GRAPH_NODE_WIDTH + spacing,
      y: connectedPos.y + offsetIndex * (GRAPH_NODE_HEIGHT + 50),
    }
  }

  let sumX = 0
  let sumY = 0
  for (const pos of existingPositions.values()) {
    sumX += pos.x
    sumY += pos.y
  }

  for (const newNode of newNodes) {
    const connectedEdge = ctx.edges.find(
      (edge) =>
        (edge.source === newNode.id && existingPositions.has(edge.target)) ||
        (edge.target === newNode.id && existingPositions.has(edge.source))
    )
    const connectedId =
      connectedEdge && connectedEdge.source === newNode.id
        ? connectedEdge.target
        : connectedEdge?.source
    const position = connectedId ? anchor(connectedId) : null
    if (position) {
      positions.set(newNode.id, position)
    } else {
      // Disconnected from existing nodes: fan out right of the graph's centroid.
      const fallbackIndex = newNodes.indexOf(newNode)
      positions.set(newNode.id, {
        x: sumX / existingPositions.size + GRAPH_NODE_WIDTH + spacing,
        y: sumY / existingPositions.size + fallbackIndex * (GRAPH_NODE_HEIGHT + 50),
      })
    }
  }

  return ctx.nodes.map((node) =>
    newNodeIds.has(node.id) && positions.has(node.id)
      ? { ...node, position: positions.get(node.id)! }
      : node
  )
}
