export type DatabaseKind = 'postgres' | 'mongodb'

export interface DatabaseConnectionInput {
  name: string
  kind: DatabaseKind
  host: string
  port: number
  database: string
  username: string
  password: string
  tls: boolean
  serverMode: boolean
  connectionString?: string
}

export interface DatabaseConnectionSummary {
  id: string
  name: string
  kind: DatabaseKind
  host: string
  port: number
  database: string
  connectedAt: number
  serverMode?: boolean
  savedConnectionId?: string
  parentConnectionId?: string
}

export interface SavedConnectionProfile extends Omit<DatabaseConnectionInput, 'password' | 'connectionString'> {
  id: string
  hasSecret: boolean
}

export interface DatabaseBrowserDatabase {
  name: string
  canConnect: boolean
}

export interface DatabaseBrowserTable {
  schema: string
  name: string
  kind: 'table' | 'view' | 'materialized view' | 'foreign table' | 'partitioned table'
}

export interface MongoBrowserDatabase {
  name: string
  sizeOnDisk?: number
  empty?: boolean
}

export interface MongoBrowserIndex {
  name: string
  keys: string
  unique: boolean
  expireAfterSeconds?: number
}

export interface MongoBrowserCollection {
  name: string
  type: string
  estimatedDocuments?: number
  indexes?: MongoBrowserIndex[]
  validator?: string
  options?: string
}

export type MongoMutationRequest =
  | { connectionId: string; operation: 'insert'; database: string; collection: string; document: string }
  | { connectionId: string; operation: 'update'; database: string; collection: string; filter: string; update: string; many: boolean; upsert: boolean }
  | { connectionId: string; operation: 'delete'; database: string; collection: string; filter: string; many: boolean }
  | { connectionId: string; operation: 'create-collection'; database: string; collection: string }
  | { connectionId: string; operation: 'drop-collection'; database: string; collection: string }
  | { connectionId: string; operation: 'create-index'; database: string; collection: string; keys: string; unique: boolean }
  | { connectionId: string; operation: 'drop-index'; database: string; collection: string; indexName: string }
  | { connectionId: string; operation: 'drop-database'; database: string }

export interface MongoMutationResult {
  message: string
  affectedCount?: number
  insertedId?: string
}

export interface DatabaseQueryRequest {
  connectionId: string
  queryId: string
  query: string
  collection?: string
  database?: string
  mongoMode?: 'find' | 'aggregate'
  maxRows: number
}

export type DatabaseCell = string | number | boolean | null
export type DatabaseRow = Record<string, DatabaseCell>

export type DatabaseEvent =
  | { type: 'query:rows'; queryId: string; columns: string[]; rows: DatabaseRow[]; receivedRows: number }
  | { type: 'query:complete'; queryId: string; receivedRows: number; elapsedMs: number; truncated: boolean }
  | { type: 'query:error'; queryId: string; message: string }
  | { type: 'query:cancelled'; queryId: string; connectionId: string }
  | { type: 'connection:closed'; connectionId: string; message?: string }
