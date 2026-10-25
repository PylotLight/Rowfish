import { randomUUID } from "node:crypto";
import type { IpcMainInvokeEvent } from "electron";
import type { Worker } from "node:worker_threads";
import createDatabaseWorker from "./database-worker?nodeWorker";
import type {
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  DatabaseQueryRequest,
  DatabaseConnectionTestResult,
  PostgresServerInfo,
  PostgresTableDetails,
  PostgresRowDetails,
  MongoBrowserCollection,
  MongoMutationRequest,
  MongoMutationResult,
  SavedConnectionProfile,
} from "../shared/database";
import { DATABASE_LIMITS, isValidRowLimit } from "../shared/database-helpers";
import {
  deleteSavedConnection,
  getSavedConnectionInput,
  listSavedConnections,
  updateConnectionProfile,
  saveConnectionProfile,
} from "./saved-connections";
import {
  validateRowRequest,
  type PostgresRowRequest,
  type UpdatePostgresRowRequest,
} from "./postgres-row-edit";
import {
  isPlainRecord,
  validateText,
  validateQueryText,
  validateConnectionInput,
} from "./database/validation";
import {
  assertAllowedSender,
  closeChildConnections,
  closeUnregistered,
  connections,
  attachedSenders,
  rejectPendingInspections,
  sendEvent,
  startWorker,
  type ActiveConnection,
  type PendingInspection,
  type WorkerMessage,
} from "./database/worker-bridge";

const MAX_QUERY_LENGTH = DATABASE_LIMITS.maxQueryLength;
const MAX_CONNECTIONS = 8;
const CONNECT_TIMEOUT_MS = 12_000;
const INSPECTION_TIMEOUT_MS = 10_000;
const MONGO_OPERATION_TIMEOUT_MS = DATABASE_LIMITS.timeoutMs;

async function openConnection(
  event: IpcMainInvokeEvent,
  config: DatabaseConnectionInput,
  options: { savedConnectionId?: string; parentConnectionId?: string } = {},
): Promise<DatabaseConnectionSummary> {
  if (connections.size >= MAX_CONNECTIONS) {
    throw new Error(
      `Rowfish supports up to ${MAX_CONNECTIONS} active database connections at a time.`,
    );
  }
  const id = randomUUID();
  const parent = options.parentConnectionId
    ? connections.get(options.parentConnectionId)
    : undefined;
  const summary: DatabaseConnectionSummary = {
    id,
    name: parent ? `${parent.summary.name} · ${config.database}` : config.name,
    kind: config.kind,
    host: config.host,
    port: config.port,
    database: config.database,
    connectedAt: Date.now(),
    ...(config.serverMode ? { serverMode: true } : {}),
    ...(options.savedConnectionId
      ? { savedConnectionId: options.savedConnectionId }
      : {}),
    ...(options.parentConnectionId
      ? { parentConnectionId: options.parentConnectionId }
      : {}),
  };
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
    rowBusy: false,
    pendingInspections: new Map(),
  };
  connections.set(id, connection);
  connection.worker = startWorker(connection);

  if (!attachedSenders.has(event.sender)) {
    attachedSenders.add(event.sender);
    event.sender.once("destroyed", () =>
      closeOwnedConnections(connection.ownerId),
    );
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              "Connection timed out after 12 seconds. Check the host, port, network, and database availability.",
            ),
          ),
        CONNECT_TIMEOUT_MS,
      );
      connection.settleReady = (error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      if (connection.ready) connection.settleReady();
    });
    return summary;
  } catch (error) {
    closeUnregistered(connection);
    throw error instanceof Error
      ? error
      : new Error("Could not connect to the database.");
  }
}

export async function connectDatabase(
  event: IpcMainInvokeEvent,
  rawInput: unknown,
  shouldSave = false,
): Promise<DatabaseConnectionSummary> {
  assertAllowedSender(event.sender);
  if (typeof shouldSave !== "boolean")
    throw new Error("Save connection selection is invalid.");
  const config = validateConnectionInput(rawInput);
  const summary = await openConnection(event, config);
  if (shouldSave) {
    try {
      const profile = await saveConnectionProfile(config);
      summary.savedConnectionId = profile.id;
    } catch (error) {
      await closeConnectionById(summary.id);
      throw error;
    }
  }
  return summary;
}

export async function saveDatabaseConnection(
  event: IpcMainInvokeEvent,
  rawInput: unknown,
): Promise<SavedConnectionProfile> {
  assertAllowedSender(event.sender);
  return saveConnectionProfile(validateConnectionInput(rawInput));
}

/** The full saved details, credential included, to prefill the edit dialog. */
export async function getSavedDatabaseConnection(
  event: IpcMainInvokeEvent,
  profileIdValue: unknown,
): Promise<DatabaseConnectionInput> {
  assertAllowedSender(event.sender);
  const profileId = validateText(
    profileIdValue,
    "Saved connection id",
    80,
    true,
  );
  return getSavedConnectionInput(profileId);
}

/** Edits or renames a saved profile; open sessions from it take the new name. */
export async function updateSavedDatabaseConnection(
  event: IpcMainInvokeEvent,
  profileIdValue: unknown,
  rawInput: unknown,
): Promise<SavedConnectionProfile> {
  assertAllowedSender(event.sender);
  const profileId = validateText(
    profileIdValue,
    "Saved connection id",
    80,
    true,
  );
  const profile = await updateConnectionProfile(
    profileId,
    validateConnectionInput(rawInput),
  );
  for (const connection of connections.values()) {
    if (
      connection.ownerId !== event.sender.id ||
      connection.summary.savedConnectionId !== profileId
    )
      continue;
    connection.config.name = profile.name;
    connection.summary.name = connection.summary.parentConnectionId
      ? `${profile.name} · ${connection.config.database}`
      : profile.name;
  }
  return profile;
}

export async function testDatabaseConnection(
  event: IpcMainInvokeEvent,
  rawInput: unknown,
): Promise<DatabaseConnectionTestResult> {
  assertAllowedSender(event.sender);
  const config = validateConnectionInput(rawInput);
  const startedAt = Date.now();
  const worker = createDatabaseWorker({
    workerData: { ...config, probe: true },
    resourceLimits: {
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 16,
    },
  });
  try {
    return await new Promise<DatabaseConnectionTestResult>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Connection timed out after 12 seconds. Check the host, port, network, and database availability.",
              ),
            ),
          CONNECT_TIMEOUT_MS,
        );
        const settle = (error?: Error, result?: WorkerMessage): void => {
          clearTimeout(timeout);
          if (error) reject(error);
          else
            resolve({
              connectMs: Date.now() - startedAt,
              latencyMs: result?.elapsedMs ?? 0,
              ...(result?.serverVersion
                ? { serverVersion: result.serverVersion }
                : {}),
            });
        };
        worker.on("message", (message: WorkerMessage) => {
          if (message.type === "probe-result") settle(undefined, message);
          else if (message.type === "connect-error")
            settle(
              new Error(
                message.message || "Could not connect to the database.",
              ),
            );
        });
        worker.on("error", (error) =>
          settle(
            error instanceof Error
              ? error
              : new Error("Database worker failed to start."),
          ),
        );
        worker.on("exit", () =>
          settle(
            new Error("Database worker stopped before the test finished."),
          ),
        );
      },
    );
  } finally {
    void worker.terminate();
  }
}

export async function connectSavedDatabase(
  event: IpcMainInvokeEvent,
  profileIdValue: unknown,
): Promise<DatabaseConnectionSummary> {
  assertAllowedSender(event.sender);
  const profileId = validateText(
    profileIdValue,
    "Saved connection id",
    80,
    true,
  );
  const config = validateConnectionInput(
    await getSavedConnectionInput(profileId),
  );
  return openConnection(event, config, { savedConnectionId: profileId });
}

export async function listSavedDatabaseConnections(
  event: IpcMainInvokeEvent,
): Promise<SavedConnectionProfile[]> {
  assertAllowedSender(event.sender);
  return listSavedConnections();
}

export async function removeSavedDatabaseConnection(
  event: IpcMainInvokeEvent,
  profileIdValue: unknown,
): Promise<boolean> {
  assertAllowedSender(event.sender);
  const profileId = validateText(
    profileIdValue,
    "Saved connection id",
    80,
    true,
  );
  return deleteSavedConnection(profileId);
}

function getOwnedConnection(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
): ActiveConnection {
  const connectionId = validateText(
    connectionIdValue,
    "Connection id",
    80,
    true,
  );
  const connection = connections.get(connectionId);
  if (
    !connection ||
    connection.ownerId !== event.sender.id ||
    connection.closed
  ) {
    throw new Error(
      "This database connection is no longer available. Reconnect and try again.",
    );
  }
  return connection;
}

type InspectionType =
  | "inspect-databases"
  | "inspect-tables"
  | "inspect-mongo-databases"
  | "inspect-mongo-collections"
  | "inspect-mongo-collection"
  | "inspect-postgres-table"
  | "inspect-postgres-server"
  | "inspect-postgres-columns"
  | "get-postgres-row"
  | "update-postgres-row";
function inspectConnection(
  connection: ActiveConnection,
  type: InspectionType,
  database?: string,
  collection?: string,
  schema?: string,
  table?: string,
): Promise<WorkerMessage> {
  if (connection.rowBusy)
    return Promise.reject(
      new Error(
        "Wait for the row operation to finish before inspecting this connection.",
      ),
    );
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      connection.pendingInspections.delete(requestId);
      reject(new Error("Database catalog inspection timed out."));
    }, INSPECTION_TIMEOUT_MS);
    connection.pendingInspections.set(requestId, { resolve, reject, timeout });
    connection.worker.postMessage({
      type,
      requestId,
      ...(database ? { database } : {}),
      ...(collection ? { collection } : {}),
      ...(schema !== undefined ? { schema } : {}),
      ...(table !== undefined ? { table } : {}),
    });
  });
}

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
  if (connection.config.kind !== "postgres" || connection.config.serverMode) {
    throw new Error("Choose a PostgreSQL database session to list its tables.");
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
  if (connection.config.kind !== "postgres")
    throw new Error(
      "Column metadata is available only for PostgreSQL connections.",
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

function validateMongoDatabase(value: unknown): string {
  return validateText(value, "MongoDB database", 128, true);
}

function validateMongoCollection(value: unknown): string {
  const collection = validateText(value, "MongoDB collection", 128, true);
  if (collection.startsWith("system."))
    throw new Error("System collections are read-only in Rowfish.");
  return collection;
}

function getMongoConnection(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
): ActiveConnection {
  const connection = getOwnedConnection(event, connectionIdValue);
  if (connection.config.kind !== "mongodb")
    throw new Error("Choose a MongoDB connection to browse MongoDB objects.");
  return connection;
}

export async function listMongoDatabases(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
): Promise<NonNullable<WorkerMessage["mongoDatabases"]>> {
  assertAllowedSender(event.sender);
  const connection = getMongoConnection(event, connectionIdValue);
  const message = await inspectConnection(
    connection,
    "inspect-mongo-databases",
  );
  return message.mongoDatabases ?? [];
}

export async function listMongoCollections(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
  databaseValue: unknown,
): Promise<MongoBrowserCollection[]> {
  assertAllowedSender(event.sender);
  const connection = getMongoConnection(event, connectionIdValue);
  const database = validateMongoDatabase(databaseValue);
  const message = await inspectConnection(
    connection,
    "inspect-mongo-collections",
    database,
  );
  return message.mongoCollections ?? [];
}

export async function getMongoCollectionDetails(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
  databaseValue: unknown,
  collectionValue: unknown,
): Promise<MongoBrowserCollection> {
  assertAllowedSender(event.sender);
  const connection = getMongoConnection(event, connectionIdValue);
  const database = validateMongoDatabase(databaseValue);
  const collection = validateMongoCollection(collectionValue);
  const message = await inspectConnection(
    connection,
    "inspect-mongo-collection",
    database,
    collection,
  );
  if (!message.mongoCollection)
    throw new Error(`Could not inspect collection “${collection}”.`);
  return message.mongoCollection;
}

export async function runMongoMutation(
  event: IpcMainInvokeEvent,
  rawRequest: unknown,
): Promise<MongoMutationResult> {
  assertAllowedSender(event.sender);
  if (!isPlainRecord(rawRequest))
    throw new Error("Invalid MongoDB operation request.");
  const connectionId = validateText(
    rawRequest.connectionId,
    "Connection id",
    80,
    true,
  );
  const connection = getMongoConnection(event, connectionId);
  if (connection.activeQueryId)
    throw new Error(
      "Wait for the running query to finish before changing MongoDB data or indexes.",
    );
  const database = validateMongoDatabase(rawRequest.database);
  const operation = rawRequest.operation;
  if (typeof operation !== "string")
    throw new Error("Choose a MongoDB operation.");
  const collection =
    operation === "drop-database"
      ? undefined
      : validateMongoCollection(rawRequest.collection);
  const jsonText = (key: string): string =>
    validateQueryText(rawRequest[key], key, MAX_QUERY_LENGTH, true);
  let request: MongoMutationRequest;
  if (operation === "insert" && collection) {
    request = {
      connectionId,
      operation,
      database,
      collection,
      document: jsonText("document"),
    };
  } else if (operation === "update" && collection) {
    if (
      typeof rawRequest.many !== "boolean" ||
      typeof rawRequest.upsert !== "boolean"
    )
      throw new Error("Update options are invalid.");
    request = {
      connectionId,
      operation,
      database,
      collection,
      filter: jsonText("filter"),
      update: jsonText("update"),
      many: rawRequest.many,
      upsert: rawRequest.upsert,
    };
  } else if (operation === "delete" && collection) {
    if (typeof rawRequest.many !== "boolean")
      throw new Error("Delete options are invalid.");
    request = {
      connectionId,
      operation,
      database,
      collection,
      filter: jsonText("filter"),
      many: rawRequest.many,
    };
  } else if (
    (operation === "create-collection" || operation === "drop-collection") &&
    collection
  ) {
    request = { connectionId, operation, database, collection };
  } else if (operation === "create-index" && collection) {
    if (typeof rawRequest.unique !== "boolean")
      throw new Error("Index options are invalid.");
    request = {
      connectionId,
      operation,
      database,
      collection,
      keys: jsonText("keys"),
      unique: rawRequest.unique,
    };
  } else if (operation === "drop-index" && collection) {
    request = {
      connectionId,
      operation,
      database,
      collection,
      indexName: validateText(rawRequest.indexName, "Index name", 128, true),
    };
  } else if (operation === "drop-database") {
    if (["admin", "config", "local"].includes(database))
      throw new Error(
        `The built-in ${database} database cannot be dropped from Rowfish.`,
      );
    request = { connectionId, operation, database };
  } else {
    throw new Error("The requested MongoDB operation is not supported.");
  }

  const requestId = randomUUID();
  const result = await new Promise<WorkerMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      connection.pendingInspections.delete(requestId);
      reject(new Error("MongoDB operation timed out."));
    }, MONGO_OPERATION_TIMEOUT_MS);
    connection.pendingInspections.set(requestId, { resolve, reject, timeout });
    connection.worker.postMessage({
      type: "mongo-operation",
      requestId,
      request,
    });
  });
  if (!result.result)
    throw new Error("The MongoDB operation returned no result.");
  return result.result;
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

export function runDatabaseQuery(
  event: IpcMainInvokeEvent,
  rawRequest: unknown,
): { queryId: string } {
  assertAllowedSender(event.sender);
  if (!isPlainRecord(rawRequest)) throw new Error("Invalid query request.");
  const connectionId = validateText(
    rawRequest.connectionId,
    "Connection id",
    80,
    true,
  );
  const queryId = validateText(rawRequest.queryId, "Query id", 80, true);
  const query = validateQueryText(
    rawRequest.query,
    "Query",
    MAX_QUERY_LENGTH,
    true,
  );
  const collection =
    rawRequest.collection === undefined
      ? undefined
      : validateText(rawRequest.collection, "Collection", 128, true);
  const database =
    rawRequest.database === undefined
      ? undefined
      : validateMongoDatabase(rawRequest.database);
  const mongoMode =
    rawRequest.mongoMode === undefined ? undefined : rawRequest.mongoMode;
  if (
    mongoMode !== undefined &&
    mongoMode !== "find" &&
    mongoMode !== "aggregate"
  )
    throw new Error("MongoDB query mode is invalid.");
  const maxRows = Number(rawRequest.maxRows);
  if (!isValidRowLimit(maxRows))
    throw new Error(
      `Result limit must be between ${DATABASE_LIMITS.minRows} and ${DATABASE_LIMITS.maxRows} rows.`,
    );

  const connection = connections.get(connectionId);
  if (
    !connection ||
    connection.ownerId !== event.sender.id ||
    connection.closed
  ) {
    throw new Error(
      "This database connection is no longer available. Reconnect and try again.",
    );
  }
  if (connection.activeQueryId || connection.rowBusy)
    throw new Error(
      "A database operation is already running on this connection. Wait for it to finish.",
    );
  if (connection.config.kind === "mongodb" && !collection)
    throw new Error("Enter a MongoDB collection name.");
  if (connection.config.serverMode)
    throw new Error(
      "Choose a database from the server browser before running SQL.",
    );

  if (database && connection.config.kind !== "mongodb")
    throw new Error(
      "Database selection is available only for MongoDB queries.",
    );
  if (mongoMode && connection.config.kind !== "mongodb")
    throw new Error(
      "MongoDB query modes cannot be used on PostgreSQL connections.",
    );
  if (collection?.startsWith("system."))
    throw new Error("System collections are not available in the browser.");
  const request: DatabaseQueryRequest = {
    connectionId,
    queryId,
    query,
    maxRows,
    ...(collection ? { collection } : {}),
    ...(database ? { database } : {}),
    ...(mongoMode ? { mongoMode } : {}),
  };
  connection.activeQueryId = queryId;
  connection.worker.postMessage({ type: "run", request });
  return { queryId };
}

export async function cancelDatabaseQuery(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
  queryIdValue: unknown,
): Promise<boolean> {
  assertAllowedSender(event.sender);
  const connectionId = validateText(
    connectionIdValue,
    "Connection id",
    80,
    true,
  );
  const queryId = validateText(queryIdValue, "Query id", 80, true);
  const connection = connections.get(connectionId);
  if (
    !connection ||
    connection.ownerId !== event.sender.id ||
    connection.activeQueryId !== queryId
  )
    return false;

  connections.delete(connectionId);
  connection.closed = true;
  connection.activeQueryId = null;
  rejectPendingInspections(
    connection,
    new Error("The database connection was closed to cancel the query."),
  );
  sendEvent(connection, { type: "query:cancelled", queryId, connectionId });
  sendEvent(connection, {
    type: "connection:closed",
    connectionId,
    message:
      "The connection was closed to stop the query. Reconnect to run another query.",
  });
  await connection.worker.terminate();
  return true;
}

async function closeConnectionById(connectionId: string): Promise<void> {
  const connection = connections.get(connectionId);
  if (!connection) return;
  connections.delete(connectionId);
  connection.closed = true;
  rejectPendingInspections(
    connection,
    new Error("The database connection was closed."),
  );
  if (connection.activeQueryId) {
    sendEvent(connection, {
      type: "query:cancelled",
      queryId: connection.activeQueryId,
      connectionId,
    });
  }
  await connection.worker.terminate();
}

export async function disconnectDatabase(
  event: IpcMainInvokeEvent,
  connectionIdValue: unknown,
): Promise<boolean> {
  assertAllowedSender(event.sender);
  const connectionId = validateText(
    connectionIdValue,
    "Connection id",
    80,
    true,
  );
  const connection = connections.get(connectionId);
  if (!connection || connection.ownerId !== event.sender.id) return false;
  const ownedIds = [...connections.values()]
    .filter(
      (item) =>
        item.id === connectionId ||
        item.summary.parentConnectionId === connectionId,
    )
    .map((item) => item.id);
  await Promise.all(ownedIds.map(closeConnectionById));
  return true;
}

export async function closeDatabaseConnections(): Promise<void> {
  const current = [...connections.values()];
  connections.clear();
  await Promise.all(
    current.map(async (connection) => {
      connection.closed = true;
      rejectPendingInspections(connection, new Error("Rowfish is closing."));
      await connection.worker.terminate();
    }),
  );
}

function closeOwnedConnections(ownerId: number): void {
  for (const connection of connections.values()) {
    if (connection.ownerId !== ownerId) continue;
    connections.delete(connection.id);
    connection.closed = true;
    rejectPendingInspections(
      connection,
      new Error("The Rowfish window closed."),
    );
    connection.settleReady?.(
      new Error("The Rowfish window closed before the database connected."),
    );
    connection.settleReady = undefined;
    void connection.worker.terminate();
  }
}
