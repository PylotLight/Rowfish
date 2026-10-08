import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { Worker } from 'node:worker_threads'
import createDatabaseWorker from './database-worker?nodeWorker'
import type {
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  DatabaseEvent,
  DatabaseQueryRequest,
  DatabaseRow,
  SavedConnectionProfile
} from '../shared/database'
import { DATABASE_LIMITS, isValidRowLimit, parseMongoConnectionString } from '../shared/database-helpers'
import { deleteSavedConnection, getSavedConnectionInput, listSavedConnections, saveConnectionProfile } from './saved-connections'
import { getMainWindow } from './window'

const MAX_QUERY_LENGTH = DATABASE_LIMITS.maxQueryLength
const MAX_CONNECTIONS = 8
const CONNECT_TIMEOUT_MS = 12_000
const INSPECTION_TIMEOUT_MS = 10_000

interface WorkerMessage {
  type: string
  message?: string
  queryId?: string
  requestId?: string
  databases?: DatabaseBrowserDatabase[]
  tables?: DatabaseBrowserTable[]
  rows?: DatabaseRow[]
  columns?: string[]
  receivedRows?: number
  elapsedMs?: number
  truncated?: boolean
}

interface PendingInspection {
  resolve: (message: WorkerMessage) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
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
  pendingInspections: Map<string, PendingInspection>
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
  const serverMode = value.serverMode === true
  if (value.serverMode !== undefined && typeof value.serverMode !== 'boolean') throw new Error('Server-browser selection is invalid.')
  if (serverMode && kind !== 'postgres') throw new Error('Server-wide browsing is available only for PostgreSQL.')
  const connectionString = value.connectionString === undefined
    ? ''
    : validateText(value.connectionString, 'MongoDB connection string', 4_096)
  if (connectionString) {
    if (kind !== 'mongodb') throw new Error('Connection strings are supported only for MongoDB.')
    const details = parseMongoConnectionString(connectionString)
    return {
      name,
      kind,
      ...details,
      username: '',
      password: '',
      tls: false,
      serverMode: false,
      connectionString
    }
  }
  const database = serverMode ? '' : validateText(value.database, 'Database', 128, true)
  const username = validateText(value.username ?? '', 'Username', 512)
  const password = value.password ?? ''
  if (typeof password !== 'string' || password.length > 1_024 || password.includes('\0')) {
    throw new Error('Password is invalid or too long.')
  }
  if (typeof value.tls !== 'boolean') throw new Error('TLS selection is invalid.')

  return { name, kind, host, port, database, username, password, tls: value.tls, serverMode }
}

function assertAllowedSender(sender: WebContents): void {
  if (sender.isDestroyed() || getMainWindow()?.webContents.id !== sender.id) {
    throw new Error('Database access is available only to the Rowfish window.')
  }
}

function sendEvent(connection: ActiveConnection, event: DatabaseEvent): void {
  if (!connection.sender.isDestroyed()) connection.sender.send('database:event', event)
}

function rejectPendingInspections(connection: ActiveConnection, error: Error): void {
  for (const pending of connection.pendingInspections.values()) {
    clearTimeout(pending.timeout)
    pending.reject(error)
  }
  connection.pendingInspections.clear()
}

function closeChildConnections(parentId: string, reason: string): void {
  for (const child of [...connections.values()]) {
    if (child.summary.parentConnectionId !== parentId) continue
    connections.delete(child.id)
    child.closed = true
    rejectPendingInspections(child, new Error(reason))
    sendEvent(child, { type: 'connection:closed', connectionId: child.id, message: reason })
    void child.worker.terminate()
  }
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
      rejectPendingInspections(connection, error)
      closeChildConnections(connection.id, 'The PostgreSQL server-browser connection closed. Reconnect to continue.')
      sendEvent(connection, { type: 'connection:closed', connectionId: connection.id, message: error.message })
      void worker.terminate()
      return
    }
    if ((message.type === 'inspection-result' || message.type === 'inspection-error') && message.requestId) {
      const pending = connection.pendingInspections.get(message.requestId)
      if (!pending) return
      connection.pendingInspections.delete(message.requestId)
      clearTimeout(pending.timeout)
      if (message.type === 'inspection-error') pending.reject(new Error(message.message || 'Could not inspect the database.'))
      else pending.resolve(message)
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
      rejectPendingInspections(connection, error instanceof Error ? error : new Error('Database worker failed.'))
      closeChildConnections(connection.id, 'The PostgreSQL server-browser connection closed. Reconnect to continue.')
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
      rejectPendingInspections(connection, error)
      closeChildConnections(connection.id, 'The PostgreSQL server-browser connection closed. Reconnect to continue.')
      sendEvent(connection, { type: 'connection:closed', connectionId: connection.id, message: error.message })
    }
  })
  return worker
}

function closeUnregistered(connection: ActiveConnection): void {
  connection.closed = true
  connections.delete(connection.id)
  rejectPendingInspections(connection, new Error('The database connection was closed.'))
  void connection.worker.terminate()
}

async function openConnection(
  event: IpcMainInvokeEvent,
  config: DatabaseConnectionInput,
  options: { savedConnectionId?: string; parentConnectionId?: string } = {}
): Promise<DatabaseConnectionSummary> {
  if (connections.size >= MAX_CONNECTIONS) {
    throw new Error(`Rowfish supports up to ${MAX_CONNECTIONS} active database connections at a time.`)
  }
  const id = randomUUID()
  const parent = options.parentConnectionId ? connections.get(options.parentConnectionId) : undefined
  const summary: DatabaseConnectionSummary = {
    id,
    name: parent ? `${parent.summary.name} · ${config.database}` : config.name,
    kind: config.kind,
    host: config.host,
    port: config.port,
    database: config.database,
    connectedAt: Date.now(),
    ...(config.serverMode ? { serverMode: true } : {}),
    ...(options.savedConnectionId ? { savedConnectionId: options.savedConnectionId } : {}),
    ...(options.parentConnectionId ? { parentConnectionId: options.parentConnectionId } : {})
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
    activeQueryId: null,
    pendingInspections: new Map()
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
    })
    return summary
  } catch (error) {
    closeUnregistered(connection)
    throw error instanceof Error ? error : new Error('Could not connect to the database.')
  }
}

export async function connectDatabase(
  event: IpcMainInvokeEvent,
  rawInput: unknown,
  shouldSave = false
): Promise<DatabaseConnectionSummary> {
  assertAllowedSender(event.sender)
  if (typeof shouldSave !== 'boolean') throw new Error('Save connection selection is invalid.')
  const config = validateConnectionInput(rawInput)
  const summary = await openConnection(event, config)
  if (shouldSave) {
    try {
      const profile = await saveConnectionProfile(config)
      summary.savedConnectionId = profile.id
    } catch (error) {
      await closeConnectionById(summary.id)
      throw error
    }
  }
  return summary
}

export async function connectSavedDatabase(event: IpcMainInvokeEvent, profileIdValue: unknown): Promise<DatabaseConnectionSummary> {
  assertAllowedSender(event.sender)
  const profileId = validateText(profileIdValue, 'Saved connection id', 80, true)
  const config = validateConnectionInput(await getSavedConnectionInput(profileId))
  return openConnection(event, config, { savedConnectionId: profileId })
}

export async function listSavedDatabaseConnections(event: IpcMainInvokeEvent): Promise<SavedConnectionProfile[]> {
  assertAllowedSender(event.sender)
  return listSavedConnections()
}

export async function removeSavedDatabaseConnection(event: IpcMainInvokeEvent, profileIdValue: unknown): Promise<boolean> {
  assertAllowedSender(event.sender)
  const profileId = validateText(profileIdValue, 'Saved connection id', 80, true)
  return deleteSavedConnection(profileId)
}

function getOwnedConnection(event: IpcMainInvokeEvent, connectionIdValue: unknown): ActiveConnection {
  const connectionId = validateText(connectionIdValue, 'Connection id', 80, true)
  const connection = connections.get(connectionId)
  if (!connection || connection.ownerId !== event.sender.id || connection.closed) {
    throw new Error('This database connection is no longer available. Reconnect and try again.')
  }
  return connection
}

function inspectConnection(connection: ActiveConnection, type: 'inspect-databases' | 'inspect-tables'): Promise<WorkerMessage> {
  if (connection.config.kind !== 'postgres') throw new Error('The PostgreSQL browser is only available for PostgreSQL connections.')
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      connection.pendingInspections.delete(requestId)
      reject(new Error('PostgreSQL catalog inspection timed out.'))
    }, INSPECTION_TIMEOUT_MS)
    connection.pendingInspections.set(requestId, { resolve, reject, timeout })
    connection.worker.postMessage({ type, requestId })
  })
}

export async function listPostgresDatabases(event: IpcMainInvokeEvent, connectionIdValue: unknown): Promise<DatabaseBrowserDatabase[]> {
  assertAllowedSender(event.sender)
  const connection = getOwnedConnection(event, connectionIdValue)
  if (!connection.config.serverMode) throw new Error('Connect with server-browser mode to list databases on this server.')
  const message = await inspectConnection(connection, 'inspect-databases')
  return message.databases ?? []
}

export async function listPostgresTables(event: IpcMainInvokeEvent, connectionIdValue: unknown): Promise<DatabaseBrowserTable[]> {
  assertAllowedSender(event.sender)
  const connection = getOwnedConnection(event, connectionIdValue)
  if (connection.config.kind !== 'postgres' || connection.config.serverMode) {
    throw new Error('Choose a PostgreSQL database session to list its tables.')
  }
  const message = await inspectConnection(connection, 'inspect-tables')
  return message.tables ?? []
}

export async function openPostgresDatabase(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
  databaseValue: unknown
): Promise<DatabaseConnectionSummary> {
  assertAllowedSender(event.sender)
  const parent = getOwnedConnection(event, connectionIdValue)
  if (parent.config.kind !== 'postgres' || !parent.config.serverMode) {
    throw new Error('Choose a PostgreSQL server-browser connection first.')
  }
  const database = validateText(databaseValue, 'Database', 128, true)
  const knownDatabases = await inspectConnection(parent, 'inspect-databases')
  const selectedDatabase = knownDatabases.databases?.find((item) => item.name === database)
  if (!selectedDatabase) throw new Error('This database is no longer available on the server. Refresh the browser and try again.')
  if (!selectedDatabase.canConnect) throw new Error(`The current PostgreSQL user does not have permission to connect to “${database}”.`)

  const existing = [...connections.values()].find((item) =>
    item.ownerId === event.sender.id && item.summary.parentConnectionId === parent.id && item.config.database === database
  )
  if (existing) return existing.summary

  const config: DatabaseConnectionInput = { ...parent.config, database, serverMode: false }
  return openConnection(event, config, {
    ...(parent.summary.savedConnectionId ? { savedConnectionId: parent.summary.savedConnectionId } : {}),
    parentConnectionId: parent.id
  })
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
  if (connection.config.serverMode) throw new Error('Choose a database from the server browser before running SQL.')

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
  rejectPendingInspections(connection, new Error('The database connection was closed to cancel the query.'))
  sendEvent(connection, { type: 'query:cancelled', queryId, connectionId })
  sendEvent(connection, {
    type: 'connection:closed',
    connectionId,
    message: 'The connection was closed to stop the query. Reconnect to run another query.'
  })
  await connection.worker.terminate()
  return true
}

async function closeConnectionById(connectionId: string): Promise<void> {
  const connection = connections.get(connectionId)
  if (!connection) return
  connections.delete(connectionId)
  connection.closed = true
  rejectPendingInspections(connection, new Error('The database connection was closed.'))
  if (connection.activeQueryId) {
    sendEvent(connection, { type: 'query:cancelled', queryId: connection.activeQueryId, connectionId })
  }
  await connection.worker.terminate()
}

export async function disconnectDatabase(event: IpcMainInvokeEvent, connectionIdValue: unknown): Promise<boolean> {
  assertAllowedSender(event.sender)
  const connectionId = validateText(connectionIdValue, 'Connection id', 80, true)
  const connection = connections.get(connectionId)
  if (!connection || connection.ownerId !== event.sender.id) return false
  const ownedIds = [...connections.values()]
    .filter((item) => item.id === connectionId || item.summary.parentConnectionId === connectionId)
    .map((item) => item.id)
  await Promise.all(ownedIds.map(closeConnectionById))
  return true
}

export async function closeDatabaseConnections(): Promise<void> {
  const current = [...connections.values()]
  connections.clear()
  await Promise.all(current.map(async (connection) => {
    connection.closed = true
    rejectPendingInspections(connection, new Error('Rowfish is closing.'))
    await connection.worker.terminate()
  }))
}

function closeOwnedConnections(ownerId: number): void {
  for (const connection of connections.values()) {
    if (connection.ownerId !== ownerId) continue
    connections.delete(connection.id)
    connection.closed = true
    rejectPendingInspections(connection, new Error('The Rowfish window closed.'))
    connection.settleReady?.(new Error('The Rowfish window closed before the database connected.'))
    connection.settleReady = undefined
    void connection.worker.terminate()
  }
}
