<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@vue-flow/core'
import type { RelationEdgeEmits, RelationEdgeProps } from './RelationEdge'

const props = defineProps<RelationEdgeProps>()
const emit = defineEmits<RelationEdgeEmits>()
const { t } = useI18n()

const label = computed(() => {
  const content = props.data?.relation.content.trim() ?? ''
  return !content || /^[{[]/.test(content) ? `#${props.data?.relation.id}` : content
})

const path = computed(() => {
  return getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: 0.16,
  })
})

const edgePath = computed(() => path.value[0])
const labelX = computed(() => path.value[1])
const labelY = computed(() => path.value[2])
</script>

<template>
  <BaseEdge
    :id="id"
    :path="edgePath"
    :marker-end="markerEnd"
    :class="{
      'relation-edge': true,
      'relation-edge--focal': data?.focal,
      'relation-edge--muted': data?.muted,
    }"
  />

  <EdgeLabelRenderer v-if="label">
    <div
      class="relation-edge__label nodrag nopan"
      :class="{
        'relation-edge__label--focal': data?.focal,
        'relation-edge__label--muted': data?.muted,
      }"
      :style="{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: 'all',
      }"
    >
      <button
        type="button"
        class="relation-edge__focus"
        :aria-label="t('infoBase.graph.exploreRelation', { relation: data?.relation.id })"
        @click="emit('focus', data!.relation.id)"
      >
        {{ label }}
      </button>
    </div>
  </EdgeLabelRenderer>
</template>

<style lang="scss" scoped src="./RelationEdge.scss" />
