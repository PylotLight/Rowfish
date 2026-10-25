import { randomUUID } from "node:crypto";
import type { IpcMainInvokeEvent } from "electron";
import type {
  MongoBrowserCollection,
  MongoMutationRequest,
  MongoMutationResult,
} from "../../shared/database";
import { isPlainRecord, validateText, validateQueryText } from "./validation";
import {
  assertAllowedSender,
  type ActiveConnection,
  type WorkerMessage,
} from "./worker-bridge";
import {
  getOwnedConnection,
  inspectConnection,
  MAX_QUERY_LENGTH,
  MONGO_OPERATION_TIMEOUT_MS,
} from "../database";

export function validateMongoDatabase(value: unknown): string {
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
