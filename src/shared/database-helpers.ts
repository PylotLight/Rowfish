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

export function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

export interface MongoConnectionDetails {
  host: string
  port: number
  database: string
}

export function parseMongoConnectionString(source: string): MongoConnectionDetails {
  if (!source || source.length > 4_096 || /[\0-\x20\x7f]/.test(source)) {
    throw new Error('Enter a valid MongoDB connection string.')
  }
  const schemeEnd = source.indexOf('://')
  const scheme = schemeEnd < 0 ? '' : source.slice(0, schemeEnd).toLowerCase()
  if ((scheme !== 'mongodb' && scheme !== 'mongodb+srv') || source.includes('#')) {
    throw new Error('Connection strings must start with mongodb:// or mongodb+srv:// and include a server host.')
  }

  const remainder = source.slice(schemeEnd + 3)
  const pathEnd = [remainder.indexOf('/'), remainder.indexOf('?')].filter((index) => index >= 0).reduce((earliest, index) => Math.min(earliest, index), remainder.length)
  const authority = remainder.slice(0, pathEnd)
  const suffix = remainder.slice(pathEnd)
  const hostList = authority.slice(authority.lastIndexOf('@') + 1)
  const hosts = hostList.split(',')
  if (!hostList || hosts.some((host) => !host)) {
    throw new Error('Connection strings must include a server host.')
  }

  let firstPort = 27_017
  const normalizedHosts = hosts.map((host, index) => {
    let hostname = ''
    let portText = ''
    let hasPort = false
    if (host.startsWith('[')) {
      const closingBracket = host.indexOf(']')
      if (closingBracket < 0) throw new Error('The host in the MongoDB connection string is invalid.')
      hostname = host.slice(0, closingBracket + 1)
      const rest = host.slice(closingBracket + 1)
      if (rest && !rest.startsWith(':')) throw new Error('The host in the MongoDB connection string is invalid.')
      hasPort = Boolean(rest)
      portText = rest.slice(1)
    } else {
      const colon = host.lastIndexOf(':')
      if (colon >= 0) {
        if (host.indexOf(':') !== colon) throw new Error('IPv6 hosts in MongoDB connection strings must be enclosed in brackets.')
        hostname = host.slice(0, colon)
        hasPort = true
        portText = host.slice(colon + 1)
      } else {
        hostname = host
      }
    }
    if (!hostname || /[\s/@?#\\,]/.test(hostname)) throw new Error('The host in the MongoDB connection string is invalid.')
    if (hasPort && !portText) throw new Error('The port in the MongoDB connection string is invalid.')
    if (portText && !/^\d{1,5}$/.test(portText)) throw new Error('The port in the MongoDB connection string is invalid.')
    const port = portText ? Number(portText) : 27_017
    if (port < 1 || port > 65_535) throw new Error('The port in the MongoDB connection string is invalid.')
    if (scheme === 'mongodb+srv' && (hosts.length > 1 || hasPort)) {
      throw new Error('MongoDB SRV connection strings must use one host and must not specify a port.')
    }
    if (index === 0) firstPort = port
    return hostname
  })

  const path = suffix.split('?')[0] ?? ''
  const databasePath = path.split('/').filter(Boolean)
  if (databasePath.length > 1) throw new Error('MongoDB connection strings must include at most one database name.')
  let database = 'admin'
  if (databasePath.length === 1) {
    try {
      database = decodeURIComponent(databasePath[0]!)
    } catch {
      throw new Error('The database name in the MongoDB connection string is invalid.')
    }
  }
  if (database.length > 128 || /[\0-\x1f\x7f]/.test(database)) {
    throw new Error('The database name in the MongoDB connection string is invalid or too long.')
  }
  return { host: normalizedHosts.join(','), port: firstPort, database }
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

export function parseMongoPipeline(source: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(source)
  if (!Array.isArray(parsed) || parsed.some((stage) => !stage || typeof stage !== 'object' || Array.isArray(stage) || Object.keys(stage).length === 0)) {
    throw new Error('MongoDB aggregation must be a JSON array of pipeline stage objects.')
  }
  const forbidden = new Set(['$where', '$function', '$accumulator', '$out', '$merge'])
  const containsForbidden = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsForbidden)
    if (!value || typeof value !== 'object') return false
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => forbidden.has(key) || containsForbidden(nested))
  }
  if (containsForbidden(parsed)) throw new Error('Aggregation pipelines cannot use $where, server-side JavaScript, $out or $merge.')
  return parsed as Record<string, unknown>[]
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
