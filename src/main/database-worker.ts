import { parentPort, workerData } from 'node:worker_threads'
import { BSON, MongoClient, type Db } from 'mongodb'
import { Client as PostgresClient } from 'pg'
import Cursor from 'pg-cursor'
import type {
  DatabaseCell,
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionInput,
  DatabaseQueryRequest,
  DatabaseRow,
  PostgresServerInfo,
  PostgresTableDetails,
  PostgresRowDetails,
  PostgresRowRequest,
  UpdatePostgresRowRequest,
  MongoBrowserCollection,
  MongoMutationRequest,
  MongoMutationResult
} from '../shared/database'
import {
  DATABASE_LIMITS,
  parseMongoFilter,
  parseMongoPipeline
} from '../shared/database-helpers'
import { splitPostgresStatements } from '../shared/sql-statements'
import {
  assertCompletePrimaryKey,
  buildRowUpdate,
  quoteIdentifier
} from './postgres-row-edit'

const {
  batchSize: BATCH_SIZE,
  maxColumns: MAX_COLUMNS,
  maxCellChars: MAX_CELL_CHARS,
  maxResultBytes: MAX_RESULT_BYTES,
  timeoutMs: QUERY_TIMEOUT_MS
} = DATABASE_LIMITS
const { EJSON } = BSON

interface WorkerConfig extends DatabaseConnectionInput {}

type WorkerRequest =
  | { type: 'run'; request: DatabaseQueryRequest }
  | {
      type:
        | 'inspect-databases'
        | 'inspect-tables'
        | 'inspect-mongo-databases'
        | 'inspect-postgres-table'
        | 'inspect-postgres-server'
        | 'inspect-postgres-columns'
        | 'get-postgres-row'
        | 'update-postgres-row'
      requestId: string
      schema?: string
      table?: string
      rowRequest?: PostgresRowRequest | UpdatePostgresRowRequest
    }
  | {
      type: 'inspect-mongo-collections' | 'inspect-mongo-collection'
      requestId: string
      database: string
      collection?: string
    }
  | {
      type: 'mongo-operation'
      requestId: string
      request: MongoMutationRequest
    }
  | { type: 'close' }

type WorkerEvent =
  | { type: 'ready' }
  | { type: 'connect-error'; message: string }
  | {
      type: 'inspection-result'
      requestId: string
      databases?: DatabaseBrowserDatabase[]
      tables?: DatabaseBrowserTable[]
      postgresTable?: PostgresTableDetails
      postgresServer?: PostgresServerInfo
      postgresColumns?: { schema: string; table: string; name: string }[]
      postgresRow?: PostgresRowDetails
      mongoDatabases?: { name: string; sizeOnDisk?: number; empty?: boolean }[]
      mongoCollections?: MongoBrowserCollection[]
      mongoCollection?: MongoBrowserCollection
    }
  | { type: 'inspection-error'; requestId: string; message: string }
  | {
      type: 'mongo-operation-result'
      requestId: string
      result: MongoMutationResult
    }
  | { type: 'mongo-operation-error'; requestId: string; message: string }
  | {
      type: 'rows'
      queryId: string
      columns: string[]
      rows: DatabaseRow[]
      receivedRows: number
    }
  | {
      type: 'complete'
      queryId: string
      receivedRows: number
      elapsedMs: number
      truncated: boolean
      affectedRows?: number
      statementCount?: number
    }
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
  const message =
    error instanceof Error ? error.message : 'Database operation failed.'
  return message
    .replace(/(password|pwd)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/mongodb(?:\+srv)?:\/\/[^@\s]+@/gi, 'mongodb://[redacted]@')
    .slice(0, 1_000)
}

function asCell(value: unknown): DatabaseCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') return value.slice(0, MAX_CELL_CHARS)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`
  try {
    const text = JSON.stringify(value, (_key, nested: unknown) => {
      if (typeof nested === 'bigint') return `${nested.toString()}n`
      if (nested instanceof Uint8Array)
        return `[binary ${nested.byteLength} bytes]`
      if (
        nested &&
        typeof nested === 'object' &&
        nested.constructor?.name === 'ObjectId' &&
        'toHexString' in nested
      ) {
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
  for (
    let index = 0;
    index < Math.min(keys.length, values.length, MAX_COLUMNS);
    index += 1
  ) {
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
      database: config.database || 'postgres',
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
    const host =
      config.host.includes(':') && !config.host.startsWith('[')
        ? `[${config.host}]`
        : config.host
    const credentials = config.username
      ? `${encodeURIComponent(config.username)}${config.password ? `:${encodeURIComponent(config.password)}` : ''}@`
      : ''
    const authSource = config.username
      ? `?authSource=${encodeURIComponent(config.database)}&tls=${String(config.tls)}`
      : `?tls=${String(config.tls)}`
    const uri =
      config.connectionString ||
      `mongodb://${credentials}${host}:${config.port}/${encodeURIComponent(config.database)}${authSource}`
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
  const statements = splitPostgresStatements(request.query)
  if (statements.length === 0) throw new Error('Enter a SQL statement to run.')
  let receivedRows = 0
  let estimatedBytes = 0
  let truncated = false
  let affectedRows = 0
  let hasAffectedRows = false
  let finalColumns: string[] = []
  for (
    let statementIndex = 0;
    statementIndex < statements.length;
    statementIndex += 1
  ) {
    const cursor = new Cursor(statements[statementIndex]!, [], {
      rowMode: 'array'
    })
    postgres.query(cursor as never)
    let fields: string[] = []
    const columns = new Set<string>()
    const outgoing: DatabaseRow[] = []
    let statementRows = 0
    let rowCount: number | null = null
    let command = ''
    const read = (
      count: number
    ): Promise<{
      rows: unknown[][]
      resultFields: string[]
      count: number | null
      command: string
    }> =>
      new Promise((resolve, reject) => {
        cursor.read(count, (error, rows, result) => {
          if (error) reject(error)
          else
            resolve({
              rows,
              resultFields: result.fields.map((field) => field.name),
              count:
                (result as typeof result & { rowCount?: number }).rowCount ??
                null,
              command:
                (result as typeof result & { command?: string }).command ?? ''
            })
        })
      })
    try {
      const isFinal = statementIndex === statements.length - 1
      while (!isFinal || statementRows <= request.maxRows) {
        const remaining = isFinal
          ? request.maxRows + 1 - statementRows
          : BATCH_SIZE
        const next = await read(Math.min(BATCH_SIZE, remaining))
        if (next.resultFields.length > 0) {
          fields = distinctColumnNames(next.resultFields)
          for (const field of fields) columns.add(field)
        }
        if (next.count !== null) rowCount = next.count
        if (next.command) command = next.command
        if (next.rows.length === 0) break
        // Previous statements are drained but never accumulated or sent to the UI.
        for (const values of next.rows) {
          statementRows++
          if (!isFinal) continue
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
          receivedRows++
          outgoing.push(row)
          if (outgoing.length >= BATCH_SIZE)
            postBatch(
              request.queryId,
              outgoing.splice(0),
              columns,
              receivedRows
            )
        }
        if (truncated) break
        if (next.rows.length < Math.min(BATCH_SIZE, remaining)) break
      }
    } finally {
      if (truncated) await cursor.close().catch(() => undefined)
    }
    if (statementIndex === statements.length - 1) {
      finalColumns = [...columns]
      // Preserve column metadata for zero-row SELECT results.
      post({
        type: 'rows',
        queryId: request.queryId,
        rows: outgoing,
        columns: finalColumns,
        receivedRows
      })
    }
    if (
      rowCount !== null &&
      /^(INSERT|UPDATE|DELETE|MERGE|COPY)$/.test(command)
    ) {
      affectedRows += rowCount
      hasAffectedRows = true
    }
    if (truncated) break
  }
  post({
    type: 'complete',
    queryId: request.queryId,
    receivedRows,
    elapsedMs: Date.now() - startedAt,
    truncated,
    ...(hasAffectedRows ? { affectedRows } : {}),
    statementCount: statements.length
  })
}
async function readMongo(request: DatabaseQueryRequest): Promise<void> {
  if (!mongo) throw new Error('MongoDB connection is unavailable.')
  const collectionName = request.collection?.trim() ?? ''
  if (
    !collectionName ||
    collectionName.length > 128 ||
    /[\0-\x1f]/.test(collectionName)
  ) {
    throw new Error(
      'Enter a valid MongoDB collection name (up to 128 characters).'
    )
  }

  const selectedCollection = mongo
    .db(request.database || config.database || 'admin')
    .collection(collectionName)
  let cursor
  if (request.mongoMode === 'aggregate') {
    parseMongoPipeline(request.query)
    const pipeline = EJSON.parse(request.query)
    cursor = selectedCollection
      .aggregate(pipeline as never, { maxTimeMS: QUERY_TIMEOUT_MS })
      .batchSize(BATCH_SIZE)
      .limit(request.maxRows + 1)
  } else {
    const parsed = parseMongoFilter(request.query)
    cursor = selectedCollection
      .find(parsed as Record<string, unknown>)
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .batchSize(BATCH_SIZE)
      .limit(request.maxRows + 1)
  }

  const startedAt = Date.now()
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
      const entries = Object.entries(document as Record<string, unknown>).slice(
        0,
        MAX_COLUMNS
      )
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

async function getOrUpdatePostgresRow(
  requestId: string,
  type: 'get-postgres-row' | 'update-postgres-row',
  input: PostgresRowRequest | UpdatePostgresRowRequest
): Promise<void> {
  try {
    if (!postgres) throw new Error('PostgreSQL connection is unavailable.')
    const request = input as UpdatePostgresRowRequest
    const rel = await postgres.query<{ kind: string }>(
      `SELECT c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2`,
      [input.schema, input.table]
    )
    if (!rel.rows[0] || !['r', 'p'].includes(rel.rows[0].kind))
      throw new Error(
        'Only ordinary and partitioned tables can be edited; views are read-only.'
      )
    const meta = await postgres.query<{
      name: string
      dataType: string
      nullable: boolean
      defaultValue: string | null
      isPrimaryKey: boolean
      generated: string
      identity: string
      typeCategory: string
      typeName: string
    }>(
      `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS "dataType",NOT a.attnotnull AS nullable,pg_get_expr(d.adbin,d.adrelid) AS "defaultValue",a.attgenerated AS generated,a.attidentity AS identity,t.typcategory AS "typeCategory",t.typname AS "typeName",EXISTS(SELECT 1 FROM pg_constraint pk WHERE pk.conrelid=c.oid AND pk.contype='p' AND a.attnum=ANY(pk.conkey)) AS "isPrimaryKey" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [input.schema, input.table]
    )
    const pks = meta.rows.filter((c) => c.isPrimaryKey).map((c) => c.name)
    assertCompletePrimaryKey(input.key, pks)
    if (
      pks.some((name) => {
        const column = meta.rows.find((c) => c.name === name)!
        return (
          !['S', 'N', 'B'].includes(column.typeCategory) &&
          column.typeName !== 'uuid'
        )
      })
    )
      throw new Error(
        'Editing requires primary-key columns with safely representable text, numeric, boolean, or UUID values.'
      )
    const params = pks.map((n) => input.key[n])
    const where = pks
      .map((n, i) => `${quoteIdentifier(n)} IS NOT DISTINCT FROM $${i + 1}`)
      .join(' AND ')
    let versionAlias = '__rowfish_xmin_internal'
    while (meta.rows.some((c) => c.name === versionAlias))
      versionAlias = `_${versionAlias}`
    const select = `SELECT ${meta.rows.map((c) => `${quoteIdentifier(c.name)}::text AS ${quoteIdentifier(c.name)}`).join(', ')},xmin::text AS ${quoteIdentifier(versionAlias)} FROM ${quoteIdentifier(input.schema)}.${quoteIdentifier(input.table)} WHERE ${where}`
    const validateResult = (result: Record<string, unknown>): void => {
      const values = Object.values(result)
      if (
        values.some(
          (value) => typeof value === 'string' && value.length > MAX_CELL_CHARS
        )
      )
        throw new Error(
          'This row contains a cell too large for safe editing; no value was truncated.'
        )
      const payload = JSON.stringify(result)
      if (new TextEncoder().encode(payload).byteLength > MAX_RESULT_BYTES)
        throw new Error(
          'This row exceeds the safe result size limit; no value was truncated.'
        )
    }
    let row: Record<string, unknown>
    if (type === 'update-postgres-row') {
      const names = Object.keys(request.changes),
        byName = new Map(meta.rows.map((c) => [c.name, c]))
      if (meta.rows.length > MAX_COLUMNS)
        throw new Error('This table has too many columns for safe editing.')
      if (
        !names.length ||
        names.some(
          (n) =>
            !byName.has(n) ||
            byName.get(n)!.isPrimaryKey ||
            byName.get(n)!.generated !== '' ||
            byName.get(n)!.identity !== '' ||
            ['U', 'P'].includes(byName.get(n)!.typeCategory)
        )
      )
        throw new Error(
          'Changes include an unsupported, generated, identity, or unknown column.'
        )
      // BEGIN inside a caller-owned transaction is not nested in PostgreSQL;
      // committing it would commit the user's work. Refuse saves in that state.
      const statusMethod = (
        postgres as PostgresClient & { getTransactionStatus?: () => string }
      ).getTransactionStatus
      if (typeof statusMethod !== 'function')
        throw new Error(
          'Cannot verify PostgreSQL transaction status; refusing to save.'
        )
      const transactionStatus = statusMethod.call(postgres)
      if (transactionStatus !== 'I')
        throw new Error(
          'Finish or roll back the active SQL transaction before saving a row.'
        )
      await postgres.query('BEGIN')
      try {
        const result = await postgres.query(
          buildRowUpdate(input.schema, input.table, pks, names),
          [...params, ...names.map((n) => request.changes[n]), request.version]
        )
        if (result.rowCount !== 1)
          throw new Error(
            'The row changed or was deleted; reload it before editing.'
          )
        const fresh = await postgres.query(select, params)
        if (fresh.rowCount !== 1)
          throw new Error('The updated row could not be read.')
        row = fresh.rows[0]!
        validateResult(row)
        await postgres.query('COMMIT')
      } catch (e) {
        await postgres.query('ROLLBACK').catch(() => undefined)
        throw e
      }
    } else {
      const result = await postgres.query(select, params)
      if (result.rowCount !== 1)
        throw new Error('The row was not found or its key is ambiguous.')
      row = result.rows[0]!
      validateResult(row)
    }
    const version = String(row[versionAlias])
    delete row[versionAlias]
    const key: DatabaseRow = Object.create(null)
    for (const n of pks) key[n] = row[n] as DatabaseRow[string]
    const columns = meta.rows.map((c) => ({
      name: c.name,
      dataType: c.dataType,
      nullable: c.nullable,
      defaultValue: c.defaultValue,
      isPrimaryKey: c.isPrimaryKey,
      editable:
        !c.isPrimaryKey &&
        c.generated === '' &&
        c.identity === '' &&
        !['U', 'P'].includes(c.typeCategory)
    }))
    post({
      type: 'inspection-result',
      requestId,
      postgresRow: { row: row as DatabaseRow, columns, key, version }
    })
  } catch (e) {
    post({ type: 'inspection-error', requestId, message: safeError(e) })
  }
}

async function inspect(
  request: Extract<
    WorkerRequest,
    {
      type:
        | 'inspect-databases'
        | 'inspect-tables'
        | 'inspect-mongo-databases'
        | 'inspect-mongo-collections'
        | 'inspect-mongo-collection'
        | 'inspect-postgres-table'
        | 'inspect-postgres-server'
        | 'inspect-postgres-columns'
        | 'get-postgres-row'
        | 'update-postgres-row'
    }
  >
): Promise<void> {
  try {
    if (
      request.type === 'get-postgres-row' ||
      request.type === 'update-postgres-row'
    ) {
      if (!request.rowRequest) throw new Error('Missing row request.')
      await getOrUpdatePostgresRow(
        request.requestId,
        request.type,
        request.rowRequest
      )
      return
    }
    if (request.type === 'inspect-mongo-databases') {
      if (!mongo) throw new Error('MongoDB connection is unavailable.')
      const result = await mongo
        .db('admin')
        .admin()
        .listDatabases({ nameOnly: false, authorizedDatabases: true })
      post({
        type: 'inspection-result',
        requestId: request.requestId,
        mongoDatabases: result.databases.map((database) => ({
          name: database.name,
          ...(typeof database.sizeOnDisk === 'number'
            ? { sizeOnDisk: database.sizeOnDisk }
            : {}),
          ...(typeof database.empty === 'boolean'
            ? { empty: database.empty }
            : {})
        }))
      })
      return
    }
    if (
      request.type === 'inspect-mongo-collections' ||
      request.type === 'inspect-mongo-collection'
    ) {
      if (!mongo) throw new Error('MongoDB connection is unavailable.')
      const db = mongo.db(request.database)
      if (request.type === 'inspect-mongo-collections') {
        const collections = await db
          .listCollections({}, { nameOnly: false })
          .toArray()
        post({
          type: 'inspection-result',
          requestId: request.requestId,
          mongoCollections: collections
            .filter((item) => !item.name.startsWith('system.'))
            .map((item) => ({
              name: item.name,
              type: item.type ?? 'collection'
            }))
        })
        return
      }
      const name = request.collection ?? ''
      const listing = await db
        .listCollections({ name }, { nameOnly: false })
        .toArray()
      const definition = listing[0]
      if (!definition) throw new Error(`Collection “${name}” no longer exists.`)
      const collection = db.collection(name)
      const indexes =
        definition.type === 'view'
          ? []
          : await collection
              .listIndexes()
              .toArray()
              .catch(() => [])
      const estimatedDocuments =
        definition.type === 'view'
          ? undefined
          : await collection.estimatedDocumentCount().catch(() => undefined)
      const validator = definition.options?.validator
      post({
        type: 'inspection-result',
        requestId: request.requestId,
        mongoCollection: {
          name,
          type: definition.type ?? 'collection',
          ...(estimatedDocuments !== undefined ? { estimatedDocuments } : {}),
          ...(validator
            ? { validator: EJSON.stringify(validator, { relaxed: false }) }
            : {}),
          ...(definition.options
            ? {
                options: EJSON.stringify(definition.options, { relaxed: false })
              }
            : {}),
          indexes: indexes.map((index) => ({
            name: index.name ?? 'unnamed',
            keys: EJSON.stringify(index.key, { relaxed: true }),
            unique: Boolean(index.unique),
            ...(typeof index.expireAfterSeconds === 'number'
              ? { expireAfterSeconds: index.expireAfterSeconds }
              : {})
          }))
        }
      })
      return
    }
    if (!postgres || config.kind !== 'postgres')
      throw new Error(
        'The PostgreSQL browser is only available for PostgreSQL connections.'
      )
    if (request.type === 'inspect-databases') {
      const result = await postgres.query<{
        name: string
        canConnect: boolean
      }>(`
        SELECT datname AS name,
          (datallowconn AND has_database_privilege(datname, 'CONNECT')) AS "canConnect"
        FROM pg_database
        WHERE NOT datistemplate
        ORDER BY datname
      `)
      post({
        type: 'inspection-result',
        requestId: request.requestId,
        databases: result.rows.map((row) => ({
          name: row.name,
          canConnect: row.canConnect
        }))
      })
      return
    }

    if (request.type === 'inspect-postgres-columns') {
      const result = await postgres.query<{
        schema: string
        table: string
        name: string
      }>(`
        SELECT n.nspname AS schema, c.relname AS table, a.attname AS name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped
          AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
          AND has_schema_privilege(n.oid, 'USAGE') AND has_table_privilege(c.oid, 'SELECT')
        ORDER BY n.nspname, c.relname, a.attnum LIMIT 10000
      `)
      post({
        type: 'inspection-result',
        requestId: request.requestId,
        postgresColumns: result.rows
      })
      return
    }
    if (request.type === 'inspect-postgres-server') {
      const result = await postgres.query<{
        version: string
        user: string
        database: string
      }>(
        'SELECT version() AS version, current_user AS "user", current_database() AS database'
      )
      post({
        type: 'inspection-result',
        requestId: request.requestId,
        postgresServer: result.rows[0]
      })
      return
    }

    if (request.type === 'inspect-postgres-table') {
      const schema = request.schema ?? ''
      const table = request.table ?? ''
      const relation = await postgres.query<{
        schema: string
        name: string
        kind: DatabaseBrowserTable['kind']
        oid: string
      }>(
        `
        SELECT n.nspname AS schema, c.relname AS name, c.oid::text AS oid,
          CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
            WHEN 'f' THEN 'foreign table' WHEN 'p' THEN 'partitioned table' ELSE 'table' END AS kind
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      `,
        [schema, table]
      )
      const item = relation.rows[0]
      if (!item)
        throw new Error(
          'The selected PostgreSQL table or view no longer exists.'
        )
      const [columnsResult, indexesResult, constraintsResult] =
        await Promise.all([
          postgres.query<{
            name: string
            dataType: string
            nullable: boolean
            defaultValue: string | null
            isPrimaryKey: boolean
          }>(
            `
          SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS "dataType",
            NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS "defaultValue",
            EXISTS (SELECT 1 FROM pg_constraint pk WHERE pk.conrelid = c.oid AND pk.contype = 'p' AND a.attnum = ANY(pk.conkey)) AS "isPrimaryKey"
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
          LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
          WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum
        `,
            [schema, table]
          ),
          postgres.query<{
            name: string
            definition: string
            unique: boolean
            primary: boolean
          }>(
            `
          SELECT i.relname AS name, pg_get_indexdef(i.oid) AS definition,
            ix.indisunique AS unique, ix.indisprimary AS primary
          FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN pg_index ix ON ix.indrelid = t.oid JOIN pg_class i ON i.oid = ix.indexrelid
          WHERE n.nspname = $1 AND t.relname = $2 ORDER BY i.relname
        `,
            [schema, table]
          ),
          postgres.query<{ name: string; type: string; definition: string }>(
            `
          SELECT con.conname AS name, con.contype AS type, pg_get_constraintdef(con.oid, true) AS definition
          FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2 ORDER BY con.conname
        `,
            [schema, table]
          )
        ])
      post({
        type: 'inspection-result',
        requestId: request.requestId,
        postgresTable: {
          schema: item.schema,
          name: item.name,
          kind: item.kind,
          columns: columnsResult.rows,
          indexes: indexesResult.rows,
          constraints: constraintsResult.rows
        }
      })
      return
    }

    const result = await postgres.query<{
      schema: string
      name: string
      kind: DatabaseBrowserTable['kind']
    }>(`
      SELECT n.nspname AS schema,
        c.relname AS name,
        CASE c.relkind
          WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized view'
          WHEN 'f' THEN 'foreign table'
          WHEN 'p' THEN 'partitioned table'
          ELSE 'table'
        END AS kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
      ORDER BY n.nspname, c.relname
    `)
    post({
      type: 'inspection-result',
      requestId: request.requestId,
      tables: result.rows
    })
  } catch (error) {
    post({
      type: 'inspection-error',
      requestId: request.requestId,
      message: safeError(error)
    })
  }
}

function parseMongoObject(
  source: string,
  label: string
): Record<string, unknown> {
  const parsed: unknown = EJSON.parse(source)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object.`)
  return parsed as Record<string, unknown>
}

async function mutateMongo(
  requestId: string,
  request: MongoMutationRequest
): Promise<void> {
  try {
    if (!mongo) throw new Error('MongoDB connection is unavailable.')
    const db = mongo.db(request.database)
    let result: MongoMutationResult
    if (request.operation === 'drop-database') {
      await db.dropDatabase()
      result = { message: `Dropped database ${request.database}.` }
    } else if (request.operation === 'create-collection') {
      await db.createCollection(request.collection)
      result = { message: `Created collection ${request.collection}.` }
    } else if (request.operation === 'drop-collection') {
      const dropped = await db.collection(request.collection).drop()
      result = {
        message: dropped
          ? `Dropped collection ${request.collection}.`
          : 'Collection was not found.'
      }
    } else if (request.operation === 'insert') {
      const document = parseMongoObject(request.document, 'Document')
      const inserted = await db
        .collection(request.collection)
        .insertOne(document)
      result = {
        message: 'Document inserted.',
        insertedId: EJSON.stringify(inserted.insertedId, { relaxed: true })
      }
    } else if (request.operation === 'update') {
      parseMongoFilter(request.filter)
      const filter = parseMongoObject(request.filter, 'Filter')
      if (Object.keys(filter).length === 0)
        throw new Error('Update filters cannot be empty.')
      const update = parseMongoObject(request.update, 'Update')
      if (
        !Object.keys(update).length ||
        Object.keys(update).some((key) => !key.startsWith('$'))
      ) {
        throw new Error('Use MongoDB update operators such as $set or $inc.')
      }
      const collection = db.collection(request.collection)
      const updated = request.many
        ? await collection.updateMany(filter, update, {
            upsert: request.upsert
          })
        : await collection.updateOne(filter, update, { upsert: request.upsert })
      result = {
        message: request.many
          ? 'Matching documents updated.'
          : 'Document updated.',
        affectedCount: updated.modifiedCount + (updated.upsertedCount ?? 0)
      }
    } else if (request.operation === 'delete') {
      parseMongoFilter(request.filter)
      const filter = parseMongoObject(request.filter, 'Filter')
      if (Object.keys(filter).length === 0)
        throw new Error('Delete filters cannot be empty.')
      const deleted = request.many
        ? await db.collection(request.collection).deleteMany(filter)
        : await db.collection(request.collection).deleteOne(filter)
      result = {
        message: request.many
          ? 'Matching documents deleted.'
          : 'Document deleted.',
        affectedCount: deleted.deletedCount
      }
    } else if (request.operation === 'create-index') {
      const keys = parseMongoObject(request.keys, 'Index keys')
      if (!Object.keys(keys).length)
        throw new Error('Index keys cannot be empty.')
      const name = await db
        .collection(request.collection)
        .createIndex(keys as never, { unique: request.unique })
      result = { message: `Created index ${name}.` }
    } else {
      const dropped = await db
        .collection(request.collection)
        .dropIndex(request.indexName)
      result = {
        message: `Dropped index ${request.indexName}.`,
        affectedCount: dropped ? 1 : 0
      }
    }
    post({ type: 'mongo-operation-result', requestId, result })
  } catch (error) {
    post({
      type: 'mongo-operation-error',
      requestId,
      message: safeError(error)
    })
  }
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
  if (
    message.type === 'inspect-databases' ||
    message.type === 'inspect-tables' ||
    message.type === 'inspect-mongo-databases' ||
    message.type === 'inspect-mongo-collections' ||
    message.type === 'inspect-mongo-collection' ||
    message.type === 'inspect-postgres-table' ||
    message.type === 'inspect-postgres-server' ||
    message.type === 'inspect-postgres-columns' ||
    message.type === 'get-postgres-row' ||
    message.type === 'update-postgres-row'
  ) {
    void inspect(message)
    return
  }
  if (message.type === 'mongo-operation') {
    void mutateMongo(message.requestId, message.request)
    return
  }
  if (message.type === 'run') void run(message.request)
})

void openConnection().catch((error: unknown) => {
  post({ type: 'connect-error', message: safeError(error) })
})
