import type { WebContents } from "electron";
import type { Worker } from "node:worker_threads";
import createDatabaseWorker from "../database-worker?nodeWorker";
import type {
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  DatabaseEvent,
  DatabaseRow,
  MongoBrowserCollection,
  MongoMutationResult,
  PostgresRowDetails,
  PostgresServerInfo,
  PostgresTableDetails,
} from "../../shared/database";
import { getMainWindow } from "../window";

export interface WorkerMessage {
  type: string;
  message?: string;
  queryId?: string;
  requestId?: string;
  databases?: DatabaseBrowserDatabase[];
  tables?: DatabaseBrowserTable[];
  postgresTable?: PostgresTableDetails;
  postgresRow?: PostgresRowDetails;
  postgresServer?: PostgresServerInfo;
  postgresColumns?: { schema: string; table: string; name: string }[];
  mongoDatabases?: { name: string; sizeOnDisk?: number; empty?: boolean }[];
  mongoCollections?: MongoBrowserCollection[];
  mongoCollection?: MongoBrowserCollection;
  result?: MongoMutationResult;
  rows?: DatabaseRow[];
  documents?: (string | null)[];
  columns?: string[];
  receivedRows?: number;
  elapsedMs?: number;
  truncated?: boolean;
  affectedRows?: number;
  statementCount?: number;
  serverVersion?: string;
}

export interface PendingInspection {
  resolve: (message: WorkerMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface ActiveConnection {
  id: string;
  ownerId: number;
  sender: WebContents;
  config: DatabaseConnectionInput;
  summary: DatabaseConnectionSummary;
  worker: Worker;
  ready: boolean;
  closed: boolean;
  activeQueryId: string | null;
  rowBusy: boolean;
  pendingInspections: Map<string, PendingInspection>;
  settleReady?: (error?: Error) => void;
}

export const connections = new Map<string, ActiveConnection>();
export const attachedSenders = new WeakSet<WebContents>();

export function assertAllowedSender(sender: WebContents): void {
  if (sender.isDestroyed() || getMainWindow()?.webContents.id !== sender.id) {
    throw new Error("Database access is available only to the Rowfish window.");
  }
}

export function sendEvent(
  connection: ActiveConnection,
  event: DatabaseEvent,
): void {
  if (!connection.sender.isDestroyed())
    connection.sender.send("database:event", event);
}

export function rejectPendingInspections(
  connection: ActiveConnection,
  error: Error,
): void {
  for (const pending of connection.pendingInspections.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  connection.pendingInspections.clear();
}

export function closeChildConnections(parentId: string, reason: string): void {
  for (const child of [...connections.values()]) {
    if (child.summary.parentConnectionId !== parentId) continue;
    connections.delete(child.id);
    child.closed = true;
    rejectPendingInspections(child, new Error(reason));
    sendEvent(child, {
      type: "connection:closed",
      connectionId: child.id,
      message: reason,
    });
    void child.worker.terminate();
  }
}

export function startWorker(connection: ActiveConnection): Worker {
  const worker = createDatabaseWorker({
    workerData: connection.config,
    resourceLimits: {
      maxOldGenerationSizeMb: 256,
      maxYoungGenerationSizeMb: 32,
    },
  });
  connection.worker = worker;

  worker.on("message", (message: WorkerMessage) => {
    if (
      connections.get(connection.id) !== connection ||
      connection.worker !== worker
    )
      return;
    if (message.type === "ready") {
      connection.ready = true;
      connection.settleReady?.();
      connection.settleReady = undefined;
      return;
    }
    if (message.type === "connect-error") {
      const error = new Error(
        message.message || "Could not connect to the database.",
      );
      if (!connection.ready) {
        connection.settleReady?.(error);
        connection.settleReady = undefined;
        return;
      }
      connections.delete(connection.id);
      connection.closed = true;
      rejectPendingInspections(connection, error);
      closeChildConnections(
        connection.id,
        "The PostgreSQL server-browser connection closed. Reconnect to continue.",
      );
      sendEvent(connection, {
        type: "connection:closed",
        connectionId: connection.id,
        message: error.message,
      });
      void worker.terminate();
      return;
    }
    if (
      (message.type === "inspection-result" ||
        message.type === "inspection-error" ||
        message.type === "mongo-operation-result" ||
        message.type === "mongo-operation-error") &&
      message.requestId
    ) {
      const pending = connection.pendingInspections.get(message.requestId);
      if (!pending) return;
      connection.pendingInspections.delete(message.requestId);
      clearTimeout(pending.timeout);
      if (
        message.type === "inspection-error" ||
        message.type === "mongo-operation-error"
      )
        pending.reject(
          new Error(message.message || "Could not inspect the database."),
        );
      else pending.resolve(message);
      return;
    }
    if (
      message.type === "rows" &&
      message.queryId &&
      Array.isArray(message.rows)
    ) {
      sendEvent(connection, {
        type: "query:rows",
        queryId: message.queryId,
        columns: message.columns ?? [],
        rows: message.rows,
        receivedRows: message.receivedRows ?? 0,
        ...(message.documents &&
        message.documents.length === message.rows.length
          ? { documents: message.documents }
          : {}),
      });
      return;
    }
    if (message.type === "complete" && message.queryId) {
      connection.activeQueryId = null;
      sendEvent(connection, {
        type: "query:complete",
        queryId: message.queryId,
        receivedRows: message.receivedRows ?? 0,
        elapsedMs: message.elapsedMs ?? 0,
        truncated: Boolean(message.truncated),
        ...(message.affectedRows !== undefined
          ? { affectedRows: message.affectedRows }
          : {}),
        ...(message.statementCount !== undefined
          ? { statementCount: message.statementCount }
          : {}),
      });
      return;
    }
    if (message.type === "error" && message.queryId) {
      connection.activeQueryId = null;
      sendEvent(connection, {
        type: "query:error",
        queryId: message.queryId,
        message: message.message || "Query failed.",
      });
    }
  });

  worker.on("error", (error) => {
    if (
      connections.get(connection.id) !== connection ||
      connection.worker !== worker
    )
      return;
    if (!connection.ready) {
      connection.settleReady?.(
        new Error(
          error instanceof Error
            ? error.message
            : "Database worker failed to start.",
        ),
      );
      connection.settleReady = undefined;
    } else {
      connections.delete(connection.id);
      connection.closed = true;
      rejectPendingInspections(
        connection,
        error instanceof Error ? error : new Error("Database worker failed."),
      );
      closeChildConnections(
        connection.id,
        "The PostgreSQL server-browser connection closed. Reconnect to continue.",
      );
      void worker.terminate();
      sendEvent(connection, {
        type: "connection:closed",
        connectionId: connection.id,
        message:
          "The database worker stopped unexpectedly. Reconnect to continue.",
      });
    }
  });

  worker.on("exit", (code) => {
    if (
      connections.get(connection.id) !== connection ||
      connection.worker !== worker ||
      connection.closed
    )
      return;
    const error = new Error(
      code === 0
        ? "Database worker closed."
        : "Database worker stopped unexpectedly.",
    );
    if (!connection.ready) {
      connection.settleReady?.(error);
      connection.settleReady = undefined;
    } else {
      connections.delete(connection.id);
      connection.closed = true;
      rejectPendingInspections(connection, error);
      closeChildConnections(
        connection.id,
        "The PostgreSQL server-browser connection closed. Reconnect to continue.",
      );
      sendEvent(connection, {
        type: "connection:closed",
        connectionId: connection.id,
        message: error.message,
      });
    }
  });
  return worker;
}

export function closeUnregistered(connection: ActiveConnection): void {
  connection.closed = true;
  connections.delete(connection.id);
  rejectPendingInspections(
    connection,
    new Error("The database connection was closed."),
  );
  void connection.worker.terminate();
}
