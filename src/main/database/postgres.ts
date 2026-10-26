import { randomUUID } from "node:crypto";
import type { IpcMainInvokeEvent } from "electron";
import type {
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  PostgresRowDetails,
  PostgresServerInfo,
  PostgresTableDetails,
} from "../../shared/database";
import { DATABASE_LIMITS } from "../../shared/database-helpers";
import {
  validateRowRequest,
  type PostgresRowRequest,
  type UpdatePostgresRowRequest,
} from "../postgres-row-edit";
import { validateText } from "./validation";
import {
  assertAllowedSender,
  closeChildConnections,
  closeUnregistered,
  connections,
  sendEvent,
  type WorkerMessage,
} from "./worker-bridge";
import {
  closeConnectionById,
  getOwnedConnection,
  inspectConnection,
  openConnection,
} from "../database";

export async function listPostgresDatabases(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
): Promise<DatabaseBrowserDatabase[]> {
  assertAllowedSender(event.sender);
  const connection = getOwnedConnection(event, connectionIdValue);
  if (connection.config.kind !== "postgres")
    throw new Error("Only PostgreSQL connections list server databases.");
  const message = await inspectConnection(connection, "inspect-databases");
  return message.databases ?? [];
}

export async function listPostgresTables(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
): Promise<DatabaseBrowserTable[]> {
  assertAllowedSender(event.sender);
  const connection = getOwnedConnection(event, connectionIdValue);
  if (
    (connection.config.kind !== "postgres" &&
      connection.config.kind !== "sqlite") ||
    connection.config.serverMode
  ) {
    throw new Error(
      "Choose a PostgreSQL or SQLite database session to list its tables.",
    );
  }
  const message = await inspectConnection(connection, "inspect-tables");
  return message.tables ?? [];
}

export async function getPostgresTableDetails(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
  schemaValue: unknown,
  tableValue: unknown,
): Promise<PostgresTableDetails> {
  assertAllowedSender(event.sender);
  const connection = getOwnedConnection(event, connectionIdValue);
  if (connection.config.kind !== "postgres" || connection.config.serverMode) {
    throw new Error("Choose a PostgreSQL database session to inspect a table.");
  }
  const schema = validateText(schemaValue, "PostgreSQL schema", 128, true);
  const table = validateText(tableValue, "PostgreSQL table", 128, true);
  const message = await inspectConnection(
    connection,
    "inspect-postgres-table",
    undefined,
    undefined,
    schema,
    table,
  );
  if (!message.postgresTable)
    throw new Error("Could not load PostgreSQL table details.");
  return message.postgresTable;
}

async function rowOperation(
  event: IpcMainInvokeEvent,
  value: unknown,
  update: boolean,
): Promise<PostgresRowDetails> {
  assertAllowedSender(event.sender);
  const request = validateRowRequest(value, update) as
    PostgresRowRequest | UpdatePostgresRowRequest;
  const connection = getOwnedConnection(event, request.connectionId);
  if (connection.config.kind !== "postgres" || connection.config.serverMode)
    throw new Error(
      "Choose a PostgreSQL database session to edit a table row.",
    );
  if (
    connection.activeQueryId ||
    connection.rowBusy ||
    connection.pendingInspections.size
  )
    throw new Error(
      "Wait for the active database operation or inspection to finish before editing a row.",
    );
  connection.rowBusy = true;
  try {
    const message = await new Promise<WorkerMessage>((resolve, reject) => {
      const requestId = randomUUID();
      const timeout = setTimeout(() => {
        connection.pendingInspections.delete(requestId);
        // Do not release the busy guard while a worker could still be writing.
        // Terminating closes its socket and rolls back an unfinished transaction.
        closeUnregistered(connection);
        closeChildConnections(
          connection.id,
          "The database connection timed out.",
        );
        const message =
          "Row operation timed out and the connection was closed. Reconnect and verify the row before retrying; the save may have completed.";
        sendEvent(connection, {
          type: "connection:closed",
          connectionId: connection.id,
          message,
        });
        reject(new Error(message));
      }, DATABASE_LIMITS.timeoutMs);
      connection.pendingInspections.set(requestId, {
        resolve,
        reject,
        timeout,
      });
      connection.worker.postMessage({
        type: update ? "update-postgres-row" : "get-postgres-row",
        requestId,
        rowRequest: request,
      });
    });
    if (!message.postgresRow)
      throw new Error("Could not load PostgreSQL row details.");
    return message.postgresRow;
  } finally {
    connection.rowBusy = false;
  }
}
export function getPostgresRow(
  event: IpcMainInvokeEvent,
  request: unknown,
): Promise<PostgresRowDetails> {
  return rowOperation(event, request, false);
}
export function updatePostgresRow(
  event: IpcMainInvokeEvent,
  request: unknown,
): Promise<PostgresRowDetails> {
  return rowOperation(event, request, true);
}

export async function listPostgresColumns(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
): Promise<{ schema: string; table: string; name: string }[]> {
  assertAllowedSender(event.sender);
  const connection = getOwnedConnection(event, connectionIdValue);
  if (
    connection.config.kind !== "postgres" &&
    connection.config.kind !== "sqlite"
  )
    throw new Error(
      "Column metadata is available only for PostgreSQL or SQLite connections.",
    );
  const message = await inspectConnection(
    connection,
    "inspect-postgres-columns",
  );
  return message.postgresColumns ?? [];
}
export async function getPostgresServerInfo(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
): Promise<PostgresServerInfo> {
  assertAllowedSender(event.sender);
  const connection = getOwnedConnection(event, connectionIdValue);
  if (connection.config.kind !== "postgres")
    throw new Error(
      "Server information is available only for PostgreSQL connections.",
    );
  const message = await inspectConnection(
    connection,
    "inspect-postgres-server",
  );
  if (!message.postgresServer)
    throw new Error("Could not load PostgreSQL server information.");
  return message.postgresServer;
}

export async function openPostgresDatabase(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
  databaseValue: unknown,
): Promise<DatabaseConnectionSummary> {
  assertAllowedSender(event.sender);
  const parent = getOwnedConnection(event, connectionIdValue);
  if (parent.config.kind !== "postgres" || !parent.config.serverMode) {
    throw new Error("Choose a PostgreSQL server-browser connection first.");
  }
  const database = validateText(databaseValue, "Database", 128, true);
  const knownDatabases = await inspectConnection(parent, "inspect-databases");
  const selectedDatabase = knownDatabases.databases?.find(
    (item) => item.name === database,
  );
  if (!selectedDatabase)
    throw new Error(
      "This database is no longer available on the server. Refresh the browser and try again.",
    );
  if (!selectedDatabase.canConnect)
    throw new Error(
      `The current PostgreSQL user does not have permission to connect to “${database}”.`,
    );

  const existing = [...connections.values()].find(
    (item) =>
      item.ownerId === event.sender.id &&
      item.summary.parentConnectionId === parent.id &&
      item.config.database === database,
  );
  if (existing) return existing.summary;

  const config: DatabaseConnectionInput = {
    ...parent.config,
    database,
    serverMode: false,
  };
  return openConnection(event, config, {
    ...(parent.summary.savedConnectionId
      ? { savedConnectionId: parent.summary.savedConnectionId }
      : {}),
    parentConnectionId: parent.id,
  });
}

/**
 * Moves a single-database PostgreSQL session onto another database on the
 * same server. Opens the new session first, so a failed switch leaves the
 * current one untouched, then closes the old one.
 */
export async function switchPostgresDatabase(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
  databaseValue: unknown,
): Promise<DatabaseConnectionSummary> {
  assertAllowedSender(event.sender);
  const current = getOwnedConnection(event, connectionIdValue);
  if (
    current.config.kind !== "postgres" ||
    current.config.serverMode ||
    current.summary.parentConnectionId
  ) {
    throw new Error("Choose a single-database PostgreSQL connection first.");
  }
  if (current.activeQueryId || current.rowBusy)
    throw new Error("Wait for the running query to finish before switching.");
  const database = validateText(databaseValue, "Database", 128, true);
  if (database === current.config.database) return current.summary;
  const known = await inspectConnection(current, "inspect-databases");
  const target = known.databases?.find((item) => item.name === database);
  if (!target)
    throw new Error(
      "This database is no longer available on the server. Refresh and try again.",
    );
  if (!target.canConnect)
    throw new Error(
      `The current PostgreSQL user does not have permission to connect to “${database}”.`,
    );
  const config: DatabaseConnectionInput = {
    ...current.config,
    database,
  };
  const next = await openConnection(event, config, {
    ...(current.summary.savedConnectionId
      ? { savedConnectionId: current.summary.savedConnectionId }
      : {}),
  });
  await closeConnectionById(current.id);
  return next;
}
