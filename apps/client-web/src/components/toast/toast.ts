import { reactive, readonly } from 'vue'

// Lightweight toast queue. App-level; mount <ToastHost /> once in App.vue.
//
// Design: neutral surface + border + low elevation (DESIGN "默认直角, 默认无阴影
// 但浮层允许低强度阴影"). Only error toasts use feedback.error color.
// A11y: success/info use role="status" (polite), error uses role="alert" (assertive).

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  // Auto-dismiss after this many ms; 0 means manual close only.
  durationMs: number
}

interface ToastState {
  items: ToastItem[]
}

const DEFAULT_DURATION_MS = 3000
const ERROR_DURATION_MS = 6000

const state = reactive<ToastState>({ items: [] })
let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function dismiss(id: number): void {
  const index = state.items.findIndex((item) => item.id === id)
  if (index >= 0) state.items.splice(index, 1)
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

function push(kind: ToastKind, message: string, durationMs?: number): number {
  const id = nextId++
  const effectiveDuration =
    durationMs ?? (kind === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS)
  state.items.push({ id, kind, message, durationMs: effectiveDuration })
  if (effectiveDuration > 0) {
    timers.set(
      id,
      setTimeout(() => dismiss(id), effectiveDuration)
    )
  }
  return id
}

export const toasts = readonly(state.items)

export const toast = {
  info: (message: string, durationMs?: number) => push('info', message, durationMs),
  success: (message: string, durationMs?: number) => push('success', message, durationMs),
  error: (message: string, durationMs?: number) => push('error', message, durationMs),
  dismiss,
}
