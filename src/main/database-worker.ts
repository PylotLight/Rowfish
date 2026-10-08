import { parentPort, workerData } from 'node:worker_threads'
import { MongoClient, type Db } from 'mongodb'
import { Client as PostgresClient } from 'pg'
import Cursor from 'pg-cursor'
import type {
  DatabaseCell,
  DatabaseConnectionInput,
  DatabaseQueryRequest,
  DatabaseRow
} from '../shared/database'
import { DATABASE_LIMITS, parseMongoFilter } from '../shared/database-helpers'

const { batchSize: BATCH_SIZE, maxColumns: MAX_COLUMNS, maxCellChars: MAX_CELL_CHARS, maxResultBytes: MAX_RESULT_BYTES, timeoutMs: QUERY_TIMEOUT_MS } = DATABASE_LIMITS

interface WorkerConfig extends DatabaseConnectionInput {}

type WorkerRequest =
  | { type: 'run'; request: DatabaseQueryRequest }
  | { type: 'close' }

type WorkerEvent =
  | { type: 'ready' }
  | { type: 'connect-error'; message: string }
  | { type: 'rows'; queryId: string; columns: string[]; rows: DatabaseRow[]; receivedRows: number }
  | { type: 'complete'; queryId: string; receivedRows: number; elapsedMs: number; truncated: boolean }
  | { type: 'error'; queryId: string; message: string }
  | { type: 'closed' }

const config = workerData as WorkerConfig
let postgres: PostgresClient | null = null
let mongo: MongoClient | null = null
let mongoDb: Db | null = null
let closing = false

function post(event: WorkerEvent): void {
  parentPort?.postMessage(event)
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Database operation failed.'
  return message
    .replace(/(password|pwd)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/mongodb(?:\+srv)?:\/\/[^@\s]+@/gi, 'mongodb://[redacted]@')
    .slice(0, 1_000)
}

function asCell(value: unknown): DatabaseCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') return value.slice(0, MAX_CELL_CHARS)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`
  try {
    const text = JSON.stringify(value, (_key, nested: unknown) => {
      if (typeof nested === 'bigint') return `${nested.toString()}n`
      if (nested instanceof Uint8Array) return `[binary ${nested.byteLength} bytes]`
      if (nested && typeof nested === 'object' && nested.constructor?.name === 'ObjectId' && 'toHexString' in nested) {
        return (nested as { toHexString: () => string }).toHexString()
      }
      if (typeof nested === 'string' && nested.length > MAX_CELL_CHARS) {
        return `${nested.slice(0, MAX_CELL_CHARS)}… [truncated]`
      }
      return nested
    })
    return (text ?? String(value)).slice(0, MAX_CELL_CHARS)
  } catch {
    return String(value).slice(0, MAX_CELL_CHARS)
  }
}

function buildRow(keys: string[], values: unknown[]): DatabaseRow {
  const row = Object.create(null) as DatabaseRow
  for (let index = 0; index < Math.min(keys.length, values.length, MAX_COLUMNS); index += 1) {
    const key = keys[index]!.slice(0, 128)
    row[key] = asCell(values[index])
  }
  return row
}

function distinctColumnNames(names: string[]): string[] {
  const counts = new Map<string, number>()
  return names.slice(0, MAX_COLUMNS).map((name) => {
    const count = (counts.get(name) ?? 0) + 1
    counts.set(name, count)
    return count === 1 ? name : `${name} (${count})`
  })
}

function postBatch(
  queryId: string,
  rows: DatabaseRow[],
  columns: Set<string>,
  receivedRows: number
): void {
  if (rows.length === 0) return
  post({ type: 'rows', queryId, rows, columns: [...columns], receivedRows })
}

async function openConnection(): Promise<void> {
  if (config.kind === 'postgres') {
    postgres = new PostgresClient({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username || undefined,
      password: config.password || undefined,
      ssl: config.tls ? { rejectUnauthorized: true } : false,
      connectionTimeoutMillis: 8_000,
      options: `-c statement_timeout=${QUERY_TIMEOUT_MS}`,
      application_name: 'Rowfish'
    })
    await postgres.connect()
    postgres.on('error', (error) => {
      if (!closing) post({ type: 'connect-error', message: safeError(error) })
    })
  } else {
    const host = config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host
    const credentials = config.username
      ? `${encodeURIComponent(config.username)}${config.password ? `:${encodeURIComponent(config.password)}` : ''}@`
      : ''
    const authSource = config.username ? `?authSource=${encodeURIComponent(config.database)}&tls=${String(config.tls)}` : `?tls=${String(config.tls)}`
    const uri = `mongodb://${credentials}${host}:${config.port}/${encodeURIComponent(config.database)}${authSource}`
    mongo = new MongoClient(uri, {
      connectTimeoutMS: 8_000,
      serverSelectionTimeoutMS: 8_000,
      maxPoolSize: 2
    })
    await mongo.connect()
    mongoDb = mongo.db(config.database)
  }
  post({ type: 'ready' })
}

async function readPostgres(request: DatabaseQueryRequest): Promise<void> {
  if (!postgres) throw new Error('PostgreSQL connection is unavailable.')
  const startedAt = Date.now()
  const cursor = new Cursor(request.query, [], { rowMode: 'array' })
  postgres.query(cursor as never)
  let fields: string[] = []
  const columns = new Set<string>()
  const outgoing: DatabaseRow[] = []
  let receivedRows = 0
  let estimatedBytes = 0
  let truncated = false

  const read = (count: number): Promise<{ rows: unknown[][]; resultFields: string[] }> =>
    new Promise((resolve, reject) => {
      cursor.read(count, (error, rows, result) => {
        if (error) reject(error)
        else resolve({ rows, resultFields: result.fields.map((field) => field.name) })
      })
    })

  try {
    while (receivedRows <= request.maxRows) {
      const remaining = request.maxRows + 1 - receivedRows
      const next = await read(Math.min(BATCH_SIZE, remaining))
      if (next.resultFields.length > 0) {
        fields = distinctColumnNames(next.resultFields)
        for (const field of fields) columns.add(field)
      }
      if (next.rows.length === 0) break
      for (const values of next.rows) {
        if (receivedRows >= request.maxRows) {
          truncated = true
          break
        }
        const row = buildRow(fields, values)
        const rowBytes = Buffer.byteLength(JSON.stringify(row))
        if (estimatedBytes + rowBytes > MAX_RESULT_BYTES) {
          truncated = true
          break
        }
        estimatedBytes += rowBytes
        receivedRows += 1
        outgoing.push(row)
        if (outgoing.length >= BATCH_SIZE) {
          postBatch(request.queryId, outgoing.splice(0), columns, receivedRows)
        }
      }
      if (truncated) break
      if (next.rows.length < Math.min(BATCH_SIZE, remaining)) break
    }
  } finally {
    if (truncated) await cursor.close().catch(() => undefined)
  }

  postBatch(request.queryId, outgoing, columns, receivedRows)
  post({
    type: 'complete',
    queryId: request.queryId,
    receivedRows,
    elapsedMs: Date.now() - startedAt,
    truncated
  })
}

async function readMongo(request: DatabaseQueryRequest): Promise<void> {
  if (!mongoDb) throw new Error('MongoDB connection is unavailable.')
  const collectionName = request.collection?.trim() ?? ''
  if (!collectionName || collectionName.length > 128 || /[\0-\x1f]/.test(collectionName)) {
    throw new Error('Enter a valid MongoDB collection name (up to 128 characters).')
  }

  const parsed = parseMongoFilter(request.query)

  const startedAt = Date.now()
  const cursor = mongoDb.collection(collectionName)
    .find(parsed as Record<string, unknown>)
    .maxTimeMS(QUERY_TIMEOUT_MS)
    .batchSize(BATCH_SIZE)
    .limit(request.maxRows + 1)
  const columns = new Set<string>()
  const outgoing: DatabaseRow[] = []
  let receivedRows = 0
  let estimatedBytes = 0
  let truncated = false

  try {
    for await (const document of cursor) {
      if (receivedRows >= request.maxRows) {
        truncated = true
        break
      }
      const entries = Object.entries(document as Record<string, unknown>).slice(0, MAX_COLUMNS)
      const keys = entries.map(([key]) => key)
      const values = entries.map(([, value]) => value)
      for (const key of keys) columns.add(key)
      const row = buildRow(keys, values)
      const rowBytes = Buffer.byteLength(JSON.stringify(row))
      if (estimatedBytes + rowBytes > MAX_RESULT_BYTES) {
        truncated = true
        break
      }
      estimatedBytes += rowBytes
      receivedRows += 1
      outgoing.push(row)
      if (outgoing.length >= BATCH_SIZE) {
        postBatch(request.queryId, outgoing.splice(0), columns, receivedRows)
      }
    }
  } finally {
    if (truncated) await cursor.close().catch(() => undefined)
  }

  postBatch(request.queryId, outgoing, columns, receivedRows)
  post({
    type: 'complete',
    queryId: request.queryId,
    receivedRows,
    elapsedMs: Date.now() - startedAt,
    truncated
  })
}

async function run(request: DatabaseQueryRequest): Promise<void> {
  try {
    if (config.kind === 'postgres') await readPostgres(request)
    else await readMongo(request)
  } catch (error) {
    post({ type: 'error', queryId: request.queryId, message: safeError(error) })
  }
}

parentPort?.on('message', (message: WorkerRequest) => {
  if (message.type === 'close') {
    closing = true
    void (async () => {
      try {
        if (postgres) await postgres.end()
        if (mongo) await mongo.close()
      } finally {
        post({ type: 'closed' })
        parentPort?.close()
      }
    })()
    return
  }
  void run(message.request)
})

void openConnection().catch((error: unknown) => {
  post({ type: 'connect-error', message: safeError(error) })
})
