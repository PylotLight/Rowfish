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
}

export interface DatabaseConnectionSummary {
  id: string
  name: string
  kind: DatabaseKind
  host: string
  port: number
  database: string
  connectedAt: number
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
