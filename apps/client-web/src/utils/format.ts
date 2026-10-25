/**
 * Format an internal type ID for display.
 * `extensions.github.stars.Source` → `Source`
 * `core.text.v1` → `text`
 */
export function formatTypeId(id: string): string {
  const last = id.split('.').pop()
  if (!last) return id
  // Strip version suffix (e.g. `v1`) from core types
  return last.replace(/^v\d+$/, '')
}
