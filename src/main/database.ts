import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { Worker } from 'node:worker_threads'
import createDatabaseWorker from './database-worker?nodeWorker'
import type {
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  DatabaseEvent,
  DatabaseQueryRequest,
  DatabaseRow
} from '../shared/database'
import { DATABASE_LIMITS, isValidRowLimit } from '../shared/database-helpers'
import { getMainWindow } from './window'

const MAX_QUERY_LENGTH = DATABASE_LIMITS.maxQueryLength
const MAX_CONNECTIONS = 8
const CONNECT_TIMEOUT_MS = 12_000

interface WorkerMessage {
  type: string
  message?: string
  queryId?: string
  rows?: DatabaseRow[]
  columns?: string[]
  receivedRows?: number
  elapsedMs?: number
  truncated?: boolean
}

interface ActiveConnection {
  id: string
  ownerId: number
  sender: WebContents
  config: DatabaseConnectionInput
  summary: DatabaseConnectionSummary
  worker: Worker
  ready: boolean
  closed: boolean
  activeQueryId: string | null
  settleReady?: (error?: Error) => void
}

const connections = new Map<string, ActiveConnection>()
const attachedSenders = new WeakSet<WebContents>()

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function validateText(value: unknown, label: string, maxLength: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const normalized = value.trim()
  if (required && !normalized) throw new Error(`${label} is required.`)
  if (normalized.length > maxLength || /[\0-\x1f\x7f]/.test(normalized)) {
    throw new Error(`${label} is invalid or too long.`)
  }
  return normalized
}

function validateConnectionInput(value: unknown): DatabaseConnectionInput {
  if (!isPlainRecord(value)) throw new Error('Invalid connection details.')
  const kind = value.kind
  if (kind !== 'postgres' && kind !== 'mongodb') throw new Error('Choose PostgreSQL or MongoDB.')
  const name = validateText(value.name, 'Connection name', 80, true)
  const host = validateText(value.host, 'Host', 253, true)
  if (/[\s/@?#\\]/.test(host)) throw new Error('Host must be a hostname or IP address without a URL scheme.')
  const port = Number(value.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Port must be between 1 and 65535.')
  const database = validateText(value.database, 'Database', 128, true)
  const username = validateText(value.username ?? '', 'Username', 512)
  const password = value.password ?? ''
  if (typeof password !== 'string' || password.length > 1_024 || password.includes('\0')) {
    throw new Error('Password is invalid or too long.')
  }
  if (typeof value.tls !== 'boolean') throw new Error('TLS selection is invalid.')

  return { name, kind, host, port, database, username, password, tls: value.tls }
}

function assertAllowedSender(sender: WebContents): void {
  if (sender.isDestroyed() || getMainWindow()?.webContents.id !== sender.id) {
    throw new Error('Database access is available only to the Rowfish window.')
  }
}

function sendEvent(connection: ActiveConnection, event: DatabaseEvent): void {
  if (!connection.sender.isDestroyed()) connection.sender.send('database:event', event)
}

function startWorker(connection: ActiveConnection): Worker {
  const worker = createDatabaseWorker({
    workerData: connection.config,
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 }
  })
  connection.worker = worker

  worker.on('message', (message: WorkerMessage) => {
    if (connections.get(connection.id) !== connection || connection.worker !== worker) return
    if (message.type === 'ready') {
      connection.ready = true
      connection.settleReady?.()
      connection.settleReady = undefined
      return
    }
    if (message.type === 'connect-error') {
      const error = new Error(message.message || 'Could not connect to the database.')
      if (!connection.ready) {
        connection.settleReady?.(error)
        connection.settleReady = undefined
        return
      }
      connections.delete(connection.id)
      connection.closed = true
      sendEvent(connection, { type: 'connection:closed', connectionId: connection.id, message: error.message })
      void worker.terminate()
      return
    }
    if (message.type === 'rows' && message.queryId && Array.isArray(message.rows)) {
      sendEvent(connection, {
        type: 'query:rows',
        queryId: message.queryId,
        columns: message.columns ?? [],
        rows: message.rows,
        receivedRows: message.receivedRows ?? 0
      })
      return
    }
    if (message.type === 'complete' && message.queryId) {
      connection.activeQueryId = null
      sendEvent(connection, {
        type: 'query:complete',
        queryId: message.queryId,
        receivedRows: message.receivedRows ?? 0,
        elapsedMs: message.elapsedMs ?? 0,
        truncated: Boolean(message.truncated)
      })
      return
    }
    if (message.type === 'error' && message.queryId) {
      connection.activeQueryId = null
      sendEvent(connection, {
        type: 'query:error',
        queryId: message.queryId,
        message: message.message || 'Query failed.'
      })
    }
  })

  worker.on('error', (error) => {
    if (connections.get(connection.id) !== connection || connection.worker !== worker) return
    if (!connection.ready) {
      connection.settleReady?.(new Error(error instanceof Error ? error.message : 'Database worker failed to start.'))
      connection.settleReady = undefined
    } else {
      connections.delete(connection.id)
      connection.closed = true
      void worker.terminate()
      sendEvent(connection, {
        type: 'connection:closed',
        connectionId: connection.id,
        message: 'The database worker stopped unexpectedly. Reconnect to continue.'
      })
    }
  })

  worker.on('exit', (code) => {
    if (connections.get(connection.id) !== connection || connection.worker !== worker || connection.closed) return
    const error = new Error(code === 0 ? 'Database worker closed.' : 'Database worker stopped unexpectedly.')
    if (!connection.ready) {
      connection.settleReady?.(error)
      connection.settleReady = undefined
    } else {
      connections.delete(connection.id)
      connection.closed = true
      sendEvent(connection, { type: 'connection:closed', connectionId: connection.id, message: error.message })
    }
  })
  return worker
}

function closeUnregistered(connection: ActiveConnection): void {
  connection.closed = true
  connections.delete(connection.id)
  void connection.worker.terminate()
}

export async function connectDatabase(
  event: IpcMainInvokeEvent,
  rawInput: unknown
): Promise<DatabaseConnectionSummary> {
  assertAllowedSender(event.sender)
  const config = validateConnectionInput(rawInput)
  if (connections.size >= MAX_CONNECTIONS) {
    throw new Error(`Rowfish supports up to ${MAX_CONNECTIONS} active database connections at a time.`)
  }
  const id = randomUUID()
  const summary: DatabaseConnectionSummary = {
    id,
    name: config.name,
    kind: config.kind,
    host: config.host,
    port: config.port,
    database: config.database,
    connectedAt: Date.now()
  }
  const connection: ActiveConnection = {
    id,
    ownerId: event.sender.id,
    sender: event.sender,
    config,
    summary,
    worker: undefined as unknown as Worker,
    ready: false,
    closed: false,
    activeQueryId: null
  }
  connections.set(id, connection)
  connection.worker = startWorker(connection)

  if (!attachedSenders.has(event.sender)) {
    attachedSenders.add(event.sender)
    event.sender.once('destroyed', () => closeOwnedConnections(connection.ownerId))
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timed out after 12 seconds. Check the host, port, network, and database availability.')), CONNECT_TIMEOUT_MS)
      connection.settleReady = (error) => {
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve()
      }
      if (connection.ready) connection.settleReady()
      if (connection.ready) connection.settleReady = undefined
    })
    return summary
  } catch (error) {
    closeUnregistered(connection)
    throw error instanceof Error ? error : new Error('Could not connect to the database.')
  }
}

export function runDatabaseQuery(event: IpcMainInvokeEvent, rawRequest: unknown): { queryId: string } {
  assertAllowedSender(event.sender)
  if (!isPlainRecord(rawRequest)) throw new Error('Invalid query request.')
  const connectionId = validateText(rawRequest.connectionId, 'Connection id', 80, true)
  const queryId = validateText(rawRequest.queryId, 'Query id', 80, true)
  const query = validateText(rawRequest.query, 'Query', MAX_QUERY_LENGTH, true)
  const collection = rawRequest.collection === undefined
    ? undefined
    : validateText(rawRequest.collection, 'Collection', 128, true)
  const maxRows = Number(rawRequest.maxRows)
  if (!isValidRowLimit(maxRows)) throw new Error(`Result limit must be between ${DATABASE_LIMITS.minRows} and ${DATABASE_LIMITS.maxRows} rows.`)

  const connection = connections.get(connectionId)
  if (!connection || connection.ownerId !== event.sender.id || connection.closed) {
    throw new Error('This database connection is no longer available. Reconnect and try again.')
  }
  if (connection.activeQueryId) throw new Error('A query is already running on this connection. Cancel it or wait for it to finish.')
  if (connection.config.kind === 'mongodb' && !collection) throw new Error('Enter a MongoDB collection name.')

  const request: DatabaseQueryRequest = { connectionId, queryId, query, maxRows, ...(collection ? { collection } : {}) }
  connection.activeQueryId = queryId
  connection.worker.postMessage({ type: 'run', request })
  return { queryId }
}

export async function cancelDatabaseQuery(event: IpcMainInvokeEvent, connectionIdValue: unknown, queryIdValue: unknown): Promise<boolean> {
  assertAllowedSender(event.sender)
  const connectionId = validateText(connectionIdValue, 'Connection id', 80, true)
  const queryId = validateText(queryIdValue, 'Query id', 80, true)
  const connection = connections.get(connectionId)
  if (!connection || connection.ownerId !== event.sender.id || connection.activeQueryId !== queryId) return false

  connections.delete(connectionId)
  connection.closed = true
  connection.activeQueryId = null
  sendEvent(connection, { type: 'query:cancelled', queryId, connectionId })
  sendEvent(connection, {
    type: 'connection:closed',
    connectionId,
    message: 'The connection was closed to stop the query. Reconnect to run another query.'
  })
  await connection.worker.terminate()
  return true
}

export async function disconnectDatabase(event: IpcMainInvokeEvent, connectionIdValue: unknown): Promise<boolean> {
  assertAllowedSender(event.sender)
  const connectionId = validateText(connectionIdValue, 'Connection id', 80, true)
  const connection = connections.get(connectionId)
  if (!connection || connection.ownerId !== event.sender.id) return false
  connections.delete(connectionId)
  connection.closed = true
  if (connection.activeQueryId) {
    sendEvent(connection, { type: 'query:cancelled', queryId: connection.activeQueryId, connectionId })
  }
  await connection.worker.terminate()
  return true
}

export async function closeDatabaseConnections(): Promise<void> {
  const current = [...connections.values()]
  connections.clear()
  await Promise.all(current.map(async (connection) => {
    connection.closed = true
    await connection.worker.terminate()
  }))
}

function closeOwnedConnections(ownerId: number): void {
  for (const connection of connections.values()) {
    if (connection.ownerId !== ownerId) continue
    connections.delete(connection.id)
    connection.closed = true
    connection.settleReady?.(new Error('The Rowfish window closed before the database connected.'))
    connection.settleReady = undefined
    void connection.worker.terminate()
  }
}
