import { createRouter, createWebHistory } from 'vue-router'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'
import type { InkRouter } from '@inkcre/ui-web'
import type { InfoBaseRoute, InfoBaseRouter, InfoBaseSceneAddress } from '@inkcre/core'
import { computed } from 'vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'InfoBaseListOverview',
      component: () => import('@/views/info-base/list/list.vue'),
      meta: { titleKey: 'sidePanel.home' },
    },
    {
      path: '/info-base/list',
      redirect: '/',
    },
    {
      path: '/info-base/list/blocks/:block/content',
      name: 'InfoBaseListSolvedContent',
      component: () => import('@/views/info-base/list/list.vue'),
      meta: { title: 'Info Base' },
    },
    {
      path: '/info-base/list/blocks/:block',
      name: 'InfoBaseListBlock',
      component: () => import('@/views/info-base/list/list.vue'),
      meta: { title: 'Info Base' },
    },
    {
      path: '/info-base/list/relations/:relation',
      name: 'InfoBaseListRelation',
      component: () => import('@/views/info-base/list/list.vue'),
      meta: { title: 'Info Base' },
    },
    {
      path: '/sources',
      name: 'Sources',
      component: () => import('@/views/sources/sources.vue'),
      meta: { titleKey: 'sidePanel.sources' },
    },
    {
      path: '/jobs/:id',
      name: 'Job',
      component: () => import('@/views/jobs/job/job.vue'),
      meta: { titleKey: 'job.title' },
    },
    {
      path: '/sources/:id',
      name: 'Source',
      component: () => import('@/views/sources/source/source.vue'),
      meta: { titleKey: 'sidePanel.sources' },
    },
    {
      path: '/extensions',
      name: 'Extensions',
      component: () => import('@/views/extensions/extensions.vue'),
      meta: { titleKey: 'sidePanel.extensions' },
    },
    {
      path: '/info-base/graph',
      name: 'InfoBaseGraphOverview',
      component: () => import('@/views/info-base/graph/graph.vue'),
      meta: { titleKey: 'navigation.graph' },
    },
    {
      path: '/info-base/graph/blocks/:block/content',
      name: 'InfoBaseGraphSolvedContent',
      component: () => import('@/views/info-base/graph/graph.vue'),
      meta: { titleKey: 'navigation.graph' },
    },
    {
      path: '/info-base/graph/blocks/:block',
      name: 'InfoBaseGraphBlock',
      component: () => import('@/views/info-base/graph/graph.vue'),
      meta: { titleKey: 'navigation.graph' },
    },
    {
      path: '/info-base/graph/relations/:relation',
      name: 'InfoBaseGraphRelation',
      component: () => import('@/views/info-base/graph/graph.vue'),
      meta: { titleKey: 'navigation.graph' },
    },
    {
      path: '/peers',
      name: 'Peers',
      component: () => import('@/views/peers/peers.vue'),
      meta: { titleKey: 'sidePanel.peers' },
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('@/views/settings/settings.vue'),
      meta: { titleKey: 'sidePanel.settings' },
    },
  ],
})

export default router

export function createInkRouterAdapter(
  router: Router,
  route: RouteLocationNormalizedLoaded
): InkRouter {
  return {
    currentPath: computed(() => route.path),
    currentName: computed(
      () => (route.meta.title as string | undefined) ?? (route.name as string) ?? null
    ),
  }
}

function parseBlockRef(value: unknown): number | null {
  const block = typeof value === 'string' && value !== '' ? Number(value) : Number.NaN
  return Number.isSafeInteger(block) ? block : null
}

function parseSceneAddress(query: RouteLocationNormalizedLoaded['query']): InfoBaseSceneAddress {
  const pathFrom = parseBlockRef(query.path_from)
  const pathTo = parseBlockRef(query.path_to)
  if (pathFrom !== null && pathTo !== null) return { path_from: pathFrom, path_to: pathTo }
  const focalRelation = parseBlockRef(query.focal_relation)
  if (focalRelation !== null) return { focal_relation: focalRelation }
  const focalBlock = parseBlockRef(query.focal_block)
  if (focalBlock !== null) return { focal_block: focalBlock }
  const q = typeof query.q === 'string' ? query.q.trim() : ''
  return q ? { q } : {}
}

function sceneQuery(route: InfoBaseRoute): Record<string, string> {
  if (route.path_from !== undefined && route.path_to !== undefined) {
    return { path_from: String(route.path_from), path_to: String(route.path_to) }
  }
  if (route.focal_relation !== undefined) {
    return { focal_relation: String(route.focal_relation) }
  }
  if (route.focal_block !== undefined) return { focal_block: String(route.focal_block) }
  if (route.q !== undefined) return { q: route.q }
  return {}
}

export function createInfoBaseRouterAdapter(router: Router): InfoBaseRouter {
  function surface(name: unknown): 'list' | 'graph' | null {
    if (typeof name !== 'string') return null
    if (name.startsWith('InfoBaseList')) return 'list'
    if (name.startsWith('InfoBaseGraph')) return 'graph'
    return null
  }

  return {
    current: computed<InfoBaseRoute | null>(() => {
      const current = router.currentRoute.value
      const currentSurface = surface(current.name)
      if (currentSurface === null) return null
      const scene = parseSceneAddress(current.query)
      if (current.name === `InfoBase${currentSurface === 'list' ? 'List' : 'Graph'}Overview`) {
        return { name: 'overview', ...scene }
      }
      if (String(current.name).endsWith('Relation')) {
        const relation = parseBlockRef(current.params.relation)
        return relation === null ? null : { name: 'relation', relation, ...scene }
      }
      const block = parseBlockRef(current.params.block)
      if (block === null) return null
      return String(current.name).endsWith('Block')
        ? { name: 'block', block, ...scene }
        : { name: 'solved-content', block, ...scene }
    }),
    async push(route) {
      const current = router.currentRoute.value
      const currentSurface = surface(current.name) ?? 'list'
      const prefix = currentSurface === 'list' ? 'InfoBaseList' : 'InfoBaseGraph'
      const requestedQuery = sceneQuery(route)
      const query =
        Object.keys(requestedQuery).length > 0
          ? requestedQuery
          : sceneQuery({ name: 'overview', ...parseSceneAddress(current.query) })
      if (route.name === 'overview') {
        await router.push({ name: `${prefix}Overview`, query })
        return
      }
      if (route.name === 'relation') {
        await router.push({
          name: `${prefix}Relation`,
          params: { relation: String(route.relation) },
          query,
        })
        return
      }
      await router.push({
        name: `${prefix}${route.name === 'block' ? 'Block' : 'SolvedContent'}`,
        params: { block: String(route.block) },
        query,
      })
    },
    back() {
      router.back()
    },
  }
}
