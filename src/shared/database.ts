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

export interface DatabaseQueryRequest {
  connectionId: string
  queryId: string
  query: string
  collection?: string
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
