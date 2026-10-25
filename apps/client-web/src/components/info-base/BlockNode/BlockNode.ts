import type { NodeProps } from '@vue-flow/core'
import type { BlockNodeData } from '@/views/info-base/graph/graph-model'

export type BlockNodeProps = NodeProps<BlockNodeData> & {
  selected?: boolean
}

export const blockNodeEmits = {
  focus: (_blockId: number) => true,
  inspect: (_blockId: number) => true,
} as const
