export const LAYOUT_DEFAULTS = {
  sidebar: 292,
  split: 42,
  rowPanel: 390
} as const
export const LAYOUT_BOUNDS = {
  sidebar: [220, 520],
  split: [20, 78],
  rowPanel: [300, 560]
} as const
const KEY = 'rowfish.layout.v1'
type Layout = { sidebar: number; split: number; rowPanel: number }
export function clampLayout(
  value: number,
  key: keyof Layout,
  viewport?: number
): number {
  const [lo, hi] = LAYOUT_BOUNDS[key]
  const responsiveMax = viewport
    ? Math.max(lo, Math.min(hi, viewport - 360))
    : hi
  return Math.round(
    Math.max(
      lo,
      Math.min(
        responsiveMax,
        Number.isFinite(value) ? value : LAYOUT_DEFAULTS[key]
      )
    )
  )
}
export function loadLayout(storage?: Pick<Storage, 'getItem'>): Layout {
  try {
    const raw = (storage ?? localStorage).getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    const data =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {}
    const valid = (v: unknown): number =>
      typeof v === 'number' && Number.isFinite(v) ? v : NaN
    return {
      sidebar: clampLayout(valid(data.sidebar), 'sidebar'),
      split: clampLayout(valid(data.split), 'split'),
      rowPanel: clampLayout(valid(data.rowPanel), 'rowPanel')
    }
  } catch {
    return { ...LAYOUT_DEFAULTS }
  }
}
export function saveLayout(
  layout: Layout,
  storage?: Pick<Storage, 'setItem'>
): boolean {
  try {
    ;(storage ?? localStorage).setItem(
      KEY,
      JSON.stringify({
        sidebar: clampLayout(layout.sidebar, 'sidebar'),
        split: clampLayout(layout.split, 'split'),
        rowPanel: clampLayout(layout.rowPanel, 'rowPanel')
      })
    )
    return true
  } catch {
    return false
  }
}
