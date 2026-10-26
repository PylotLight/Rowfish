import { parentPort, workerData } from "node:worker_threads";
import { BSON, type Db, type MongoClient } from "mongodb";
import type { DatabaseSync } from "node:sqlite";
import type { Client as PostgresClient } from "pg";
import type {
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseCell,
  DatabaseConnectionInput,
  AlembicDatabaseStatus,
  DatabaseQueryRequest,
  DatabaseRow,
  MongoBrowserCollection,
  MongoMutationRequest,
  MongoMutationResult,
  PostgresRowDetails,
  PostgresRowRequest,
  PostgresServerInfo,
  PostgresTableDetails,
  UpdatePostgresRowRequest,
} from "../../shared/database";
import {
  DATABASE_LIMITS,
  postgresTlsHint,
} from "../../shared/database-helpers";

export const BATCH_SIZE = DATABASE_LIMITS.batchSize;
export const MAX_COLUMNS = DATABASE_LIMITS.maxColumns;
export const MAX_CELL_CHARS = DATABASE_LIMITS.maxCellChars;
export const MAX_RESULT_BYTES = DATABASE_LIMITS.maxResultBytes;
export const QUERY_TIMEOUT_MS = DATABASE_LIMITS.timeoutMs;
export const { EJSON } = BSON;

export interface WorkerConfig extends DatabaseConnectionInput {
  /** Open, run a trivial check, report and close without serving requests. */
  probe?: boolean;
}

export type WorkerRequest =
  | { type: "run"; request: DatabaseQueryRequest }
  | {
      type:
        | "inspect-databases"
        | "inspect-tables"
        | "inspect-mongo-databases"
        | "inspect-postgres-table"
        | "inspect-postgres-server"
        | "inspect-postgres-columns"
        | "inspect-alembic-version"
        | "get-postgres-row"
        | "update-postgres-row";
      requestId: string;
      schema?: string;
      table?: string;
      rowRequest?: PostgresRowRequest | UpdatePostgresRowRequest;
    }
  | {
      type: "inspect-mongo-collections" | "inspect-mongo-collection";
      requestId: string;
      database: string;
      collection?: string;
    }
  | {
      type: "mongo-operation";
      requestId: string;
      request: MongoMutationRequest;
    }
  | { type: "close" };

export type WorkerEvent =
  | { type: "ready" }
  | { type: "connect-error"; message: string }
  | { type: "probe-result"; elapsedMs: number; serverVersion?: string }
  | {
      type: "inspection-result";
      requestId: string;
      databases?: DatabaseBrowserDatabase[];
      tables?: DatabaseBrowserTable[];
      postgresTable?: PostgresTableDetails;
      postgresServer?: PostgresServerInfo;
      alembicStatus?: AlembicDatabaseStatus;
      postgresColumns?: { schema: string; table: string; name: string }[];
      postgresRow?: PostgresRowDetails;
      mongoDatabases?: { name: string; sizeOnDisk?: number; empty?: boolean }[];
      mongoCollections?: MongoBrowserCollection[];
      mongoCollection?: MongoBrowserCollection;
    }
  | { type: "inspection-error"; requestId: string; message: string }
  | {
      type: "mongo-operation-result";
      requestId: string;
      result: MongoMutationResult;
    }
  | { type: "mongo-operation-error"; requestId: string; message: string }
  | {
      type: "rows";
      queryId: string;
      columns: string[];
      rows: DatabaseRow[];
      receivedRows: number;
      /** MongoDB only: canonical EJSON per row (null past the size budget). */
      documents?: (string | null)[];
    }
  | {
      type: "complete";
      queryId: string;
      receivedRows: number;
      elapsedMs: number;
      truncated: boolean;
      affectedRows?: number;
      statementCount?: number;
    }
  | { type: "error"; queryId: string; message: string }
  | { type: "closed" };

export const config = workerData as WorkerConfig;

/**
 * The live driver connections and the close flag. One object because the
 * connect sequence (postgres.ts) writes both drivers and the query,
 * inspection and mutation modules only read them.
 */
export const state = {
  postgres: null as PostgresClient | null,
  mongo: null as MongoClient | null,
  mongoDb: null as Db | null,
  sqlite: null as DatabaseSync | null,
  closing: false,
};

export function post(event: WorkerEvent): void {
  parentPort?.postMessage(event);
}

export function safeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Database operation failed.";
  return message
    .replace(/(password|pwd)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/mongodb(?:\+srv)?:\/\/[^@\s]+@/gi, "mongodb://[redacted]@")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[redacted]@")
    .slice(0, 1_000);
}

export function connectError(error: unknown): string {
  const message = safeError(error);
  if (config.kind !== "postgres") return message;
  const hint = postgresTlsHint(message);
  return hint ? `${message.replace(/\.$/, "")}. ${hint}` : message;
}

export function asCell(value: unknown): DatabaseCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return value.slice(0, MAX_CELL_CHARS);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  try {
    const text = JSON.stringify(value, (_key, nested: unknown) => {
      if (typeof nested === "bigint") return `${nested.toString()}n`;
      if (nested instanceof Uint8Array)
        return `[binary ${nested.byteLength} bytes]`;
      if (
        nested &&
        typeof nested === "object" &&
        nested.constructor?.name === "ObjectId" &&
        "toHexString" in nested
      ) {
        return (nested as { toHexString: () => string }).toHexString();
      }
      if (typeof nested === "string" && nested.length > MAX_CELL_CHARS) {
        return `${nested.slice(0, MAX_CELL_CHARS)}… [truncated]`;
      }
      return nested;
    });
    return (text ?? String(value)).slice(0, MAX_CELL_CHARS);
  } catch {
    return String(value).slice(0, MAX_CELL_CHARS);
  }
}

export function buildRow(keys: string[], values: unknown[]): DatabaseRow {
  const row = Object.create(null) as DatabaseRow;
  for (
    let index = 0;
    index < Math.min(keys.length, values.length, MAX_COLUMNS);
    index += 1
  ) {
    const key = keys[index]!.slice(0, 128);
    row[key] = asCell(values[index]);
  }
  return row;
}

export function distinctColumnNames(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.slice(0, MAX_COLUMNS).map((name) => {
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

export function postBatch(
  queryId: string,
  rows: DatabaseRow[],
  columns: Set<string>,
  receivedRows: number,
  documents?: (string | null)[],
): void {
  if (rows.length === 0) return;
  post({
    type: "rows",
    queryId,
    rows,
    columns: [...columns],
    receivedRows,
    ...(documents ? { documents } : {}),
  });
}

/** Largest single document kept as typed EJSON for the list / JSON views. */
export const MAX_DOCUMENT_CHARS = 2 * 1024 * 1024;

/**
 * Canonical EJSON keeps BSON types (ObjectId, Int32 vs Double, Date…) so the
 * renderer can show a typed tree. Returns null for oversized or odd values;
 * the renderer then falls back to the flat row cells.
 */
export function documentEjson(document: unknown): string | null {
  try {
    const text = EJSON.stringify(document, { relaxed: false });
    return text.length > MAX_DOCUMENT_CHARS ? null : text;
  } catch {
    return null;
  }
}
