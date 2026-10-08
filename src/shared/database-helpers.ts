export const DATABASE_LIMITS = {
  minRows: 1,
  maxRows: 10_000,
  batchSize: 100,
  maxColumns: 128,
  maxCellChars: 8_192,
  maxResultBytes: 16 * 1024 * 1024,
  maxQueryLength: 100_000,
  timeoutMs: 120_000
} as const

export interface VirtualRowRange {
  start: number
  end: number
}

export function isValidRowLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= DATABASE_LIMITS.minRows && value <= DATABASE_LIMITS.maxRows
}

function containsWhereOperator(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsWhereOperator)
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === '$where' || containsWhereOperator(child))
}

export function parseMongoFilter(source: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(source)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MongoDB filter must be a JSON object, for example: {"status":"active"}.')
  }
  if (containsWhereOperator(parsed)) {
    throw new Error('The $where JavaScript operator is disabled; use indexed MongoDB filter operators instead.')
  }
  return parsed as Record<string, unknown>
}

export function getVirtualRowRange(
  totalRows: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = 36,
  overscan = 8
): VirtualRowRange {
  const total = Math.max(0, Math.floor(totalRows))
  const safeRowHeight = Math.max(1, rowHeight)
  const safeTop = Math.max(0, scrollTop)
  const safeViewport = Math.max(0, viewportHeight)
  const start = Math.min(total, Math.max(0, Math.floor(safeTop / safeRowHeight) - Math.max(0, overscan)))
  const end = Math.min(total, Math.ceil((safeTop + safeViewport) / safeRowHeight) + Math.max(0, overscan))
  return { start, end: Math.max(start, end) }
}
