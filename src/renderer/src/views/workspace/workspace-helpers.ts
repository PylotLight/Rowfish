import { documentFor } from "../../lib/document-view";
import type { RowSource } from "../../components/RowSidePanel";
import type {
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  DatabaseRow,
  PostgresTableDetails,
} from "../../../../shared/database";
import {
  buildMongoConnectionString,
  buildPostgresConnectionString,
  parseMongoConnectionFields,
  parsePostgresConnectionString,
  resolvePostgresSslMode,
  type ConnectionStringFields,
} from "../../../../shared/database-helpers";

export const ROW_HEIGHT = 36;
export const ROW_INDEX_WIDTH = 45;

/** Canonical EJSON per MongoDB result row, for the typed list / JSON views. */
export const typedDocuments = new WeakMap<DatabaseRow, string | null>();
const parsedDocuments = new WeakMap<DatabaseRow, Record<string, unknown>>();
export function documentOf(row: DatabaseRow): Record<string, unknown> {
  let document = parsedDocuments.get(row);
  if (!document) {
    document = documentFor(row, typedDocuments.get(row));
    parsedDocuments.set(row, document);
  }
  return document;
}
const resultIds = new WeakMap<DatabaseRow, number>();
let nextResultId = 1;
export function resultId(row: DatabaseRow | undefined): number {
  if (!row) return 0;
  let id = resultIds.get(row);
  if (id === undefined) resultIds.set(row, (id = nextResultId++));
  return id;
}

let measureContext: CanvasRenderingContext2D | null = null;
export function measureText(text: string, font: string): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * 6.4;
  measureContext.font = font;
  return measureContext.measureText(text.slice(0, 400)).width;
}

export function parseConnectionStringFields(
  kind: DatabaseConnectionInput["kind"],
  source: string,
): ConnectionStringFields {
  return kind === "postgres"
    ? parsePostgresConnectionString(source)
    : parseMongoConnectionFields(source);
}

export const CONNECT_MODE_KEY = "rowfish.connect-mode";
export const MONGO_DETAILS_KEY = "rowfish.mongo-details";

/** The connection dialog's last used mode: true for connection string. */
export function loadConnectStringMode(): boolean {
  try {
    return localStorage.getItem(CONNECT_MODE_KEY) !== "manual";
  } catch {
    return true;
  }
}

export function kindLabel(kind: DatabaseConnectionInput["kind"]): string {
  return kind === "postgres" ? "PostgreSQL" : "MongoDB";
}

export function kindDefaults(
  kind: DatabaseConnectionInput["kind"],
): Pick<DatabaseConnectionInput, "port" | "database"> {
  return kind === "postgres"
    ? { port: 5432, database: "postgres" }
    : { port: 27017, database: "admin" };
}

/** An IPC error's own message, without Electron's "Error invoking remote method" prefix. */
export function dialogErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  return error.message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
}

export function buildConnectionString(form: DatabaseConnectionInput): string {
  const fields = {
    host: form.host.trim(),
    port: form.port,
    database: form.kind === "postgres" && form.serverMode ? "" : form.database,
    username: form.username.trim(),
    password: form.password,
    tls: form.tls,
    ...(form.kind === "postgres"
      ? { sslMode: resolvePostgresSslMode(form) }
      : {}),
  };
  return form.kind === "postgres"
    ? buildPostgresConnectionString(fields)
    : buildMongoConnectionString(fields);
}
export const DEFAULT_FORM: DatabaseConnectionInput = {
  name: "Local database",
  kind: "postgres",
  host: "localhost",
  port: 5432,
  database: "postgres",
  username: "postgres",
  password: "",
  tls: false,
  sslMode: "prefer",
  serverMode: false,
  connectionString: "",
};

export type RunState = "idle" | "running" | "cancelling";
export type MongoOperation =
  | "insert"
  | "update"
  | "delete"
  | "create-collection"
  | "drop-collection"
  | "create-index"
  | "drop-index"
  | "drop-database";

export function mongoBrowserKey(
  connectionId: string,
  database: string,
): string {
  return `${connectionId}::${database}`;
}

export function connectionSubline(
  connection: DatabaseConnectionSummary,
): string {
  if (connection.serverMode)
    return `PostgreSQL · ${connection.host}:${connection.port} · all databases`;
  return `${connection.kind === "postgres" ? "PostgreSQL" : "MongoDB"} · ${connection.database}`;
}

/** Non-server-mode PostgreSQL connections expose a database switcher. */
export function canSwitchDatabase(
  connection: DatabaseConnectionSummary,
): boolean {
  return (
    connection.kind === "postgres" &&
    !connection.serverMode &&
    !connection.parentConnectionId
  );
}

export const MAX_CACHED_TAB_RESULTS = 12;
/** The explorer rail's tabs. */
export type RailView = "servers" | "saved" | "history";
export type TabResultSnapshot = {
  rows: DatabaseRow[];
  columns: string[];
  queryError: string;
  queryPlan: unknown;
  querySummary: string;
  resultView: "data" | "structure" | "indexes" | "plan";
  sort: { column: string; direction: 1 | -1 } | null;
  rowSource: RowSource | null;
  selectedTable: { connectionId: string; schema: string; name: string } | null;
  tableDetails: PostgresTableDetails | null;
};
