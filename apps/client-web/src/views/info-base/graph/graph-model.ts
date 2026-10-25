import { MarkerType, type Edge, type Node } from '@vue-flow/core'
import type { Block, Relation, Resolver } from '@inkcre/core'

export interface BlockNodeData {
  block: Block
  resolver: Resolver | null
  solvedContent: unknown
  previewStatus: 'loading' | 'success' | 'error'
  focal: boolean
  muted: boolean
  focusing?: boolean
}

export interface RelationEdgeData {
  relation: Relation
  focal: boolean
  muted: boolean
}

export type BlockNode = Node<BlockNodeData, Record<string, never>, 'block'> & {
  data: BlockNodeData
}
export type RelationEdge = Edge<RelationEdgeData> & { data: RelationEdgeData }

export function blockNode(
  block: Block,
  options: { focal: boolean; muted: boolean; position?: { x: number; y: number } }
): BlockNode {
  return {
    id: String(block.id),
    type: 'block',
    position: options.position ?? { x: 0, y: 0 },
    draggable: true,
    data: {
      block,
      resolver: null,
      solvedContent: null,
      previewStatus: 'loading',
      focal: options.focal,
      muted: options.muted,
    },
  }
}

export function relationEdge(
  relation: Relation,
  options: { focal: boolean; muted: boolean }
): RelationEdge {
  return {
    id: String(relation.id),
    type: 'relation',
    source: String(relation.from_),
    target: String(relation.to_),
    markerEnd: MarkerType.ArrowClosed,
    data: { relation, ...options },
  }
}
