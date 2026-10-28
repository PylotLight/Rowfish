import type {
  DatabaseQueryRequest,
  DatabaseRow,
  MongoMutationRequest,
  MongoMutationResult,
} from "../../shared/database";
import {
  parseMongoFilter,
  parseMongoPipeline,
} from "../../shared/database-helpers";
import { normalizeMongoQuery } from "../../shared/mongo-shell";
import {
  BATCH_SIZE,
  MAX_COLUMNS,
  MAX_RESULT_BYTES,
  QUERY_TIMEOUT_MS,
  EJSON,
  config,
  state,
  post,
  safeError,
  buildRow,
  postBatch,
  documentEjson,
} from "./shared";

export async function readMongo(request: DatabaseQueryRequest): Promise<void> {
  if (!state.mongo) throw new Error("MongoDB connection is unavailable.");
  const collectionName = request.collection?.trim() ?? "";
  if (
    !collectionName ||
    collectionName.length > 128 ||
    // eslint-disable-next-line no-control-regex -- MongoDB collection names cannot contain control characters
    /[\0-\x1f]/.test(collectionName)
  ) {
    throw new Error(
      "Enter a valid MongoDB collection name (up to 128 characters).",
    );
  }

  const selectedCollection = state.mongo
    .db(request.database || config.database || "admin")
    .collection(collectionName);
  let cursor;
  if (request.mongoMode === "aggregate") {
    parseMongoPipeline(request.query);
    const pipeline = EJSON.parse(
      normalizeMongoQuery(request.query.trim() || "[]"),
      { relaxed: false },
    );
    cursor = selectedCollection
      .aggregate(pipeline as never, { maxTimeMS: QUERY_TIMEOUT_MS })
      .batchSize(BATCH_SIZE)
      .limit(request.maxRows + 1);
  } else {
    parseMongoFilter(request.query);
    // EJSON so {"$oid": …}, ObjectId("…"), ISODate("…") and regexes become
    // real BSON values instead of literal operator objects.
    const filter = EJSON.parse(
      normalizeMongoQuery(request.query.trim() || "{}"),
      { relaxed: false },
    ) as Record<string, unknown>;
    cursor = selectedCollection
      .find(filter)
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .batchSize(BATCH_SIZE)
      .limit(request.maxRows + 1);
  }

  const startedAt = Date.now();
  const columns = new Set<string>();
  const outgoing: DatabaseRow[] = [];
  const outgoingDocuments: (string | null)[] = [];
  let receivedRows = 0;
  let estimatedBytes = 0;
  // Typed documents get their own budget so they never shrink the row cap.
  let documentBytes = 0;
  let truncated = false;

  try {
    for await (const document of cursor) {
      if (receivedRows >= request.maxRows) {
        truncated = true;
        break;
      }
      const entries = Object.entries(document as Record<string, unknown>).slice(
        0,
        MAX_COLUMNS,
      );
      const keys = entries.map(([key]) => key);
      const values = entries.map(([, value]) => value);
      for (const key of keys) columns.add(key);
      const row = buildRow(keys, values);
      const rowBytes = Buffer.byteLength(JSON.stringify(row));
      if (estimatedBytes + rowBytes > MAX_RESULT_BYTES) {
        truncated = true;
        break;
      }
      estimatedBytes += rowBytes;
      receivedRows += 1;
      outgoing.push(row);
      let typed =
        documentBytes < MAX_RESULT_BYTES ? documentEjson(document) : null;
      if (typed && documentBytes + typed.length > MAX_RESULT_BYTES)
        typed = null;
      if (typed) documentBytes += typed.length;
      outgoingDocuments.push(typed);
      if (outgoing.length >= BATCH_SIZE) {
        postBatch(
          request.queryId,
          outgoing.splice(0),
          columns,
          receivedRows,
          outgoingDocuments.splice(0),
        );
      }
    }
  } finally {
    if (truncated) await cursor.close().catch(() => undefined);
  }

  postBatch(
    request.queryId,
    outgoing,
    columns,
    receivedRows,
    outgoingDocuments,
  );
  post({
    type: "complete",
    queryId: request.queryId,
    receivedRows,
    elapsedMs: Date.now() - startedAt,
    truncated,
  });
}

function parseMongoObject(
  source: string,
  label: string,
): Record<string, unknown> {
  const parsed: unknown = EJSON.parse(normalizeMongoQuery(source), {
    relaxed: false,
  });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

export async function mutateMongo(
  requestId: string,
  request: MongoMutationRequest,
): Promise<void> {
  try {
    if (!state.mongo) throw new Error("MongoDB connection is unavailable.");
    const db = state.mongo.db(request.database);
    let result: MongoMutationResult;
    if (request.operation === "drop-database") {
      await db.dropDatabase();
      result = { message: `Dropped database ${request.database}.` };
    } else if (request.operation === "create-collection") {
      await db.createCollection(request.collection);
      result = { message: `Created collection ${request.collection}.` };
    } else if (request.operation === "drop-collection") {
      const dropped = await db.collection(request.collection).drop();
      result = {
        message: dropped
          ? `Dropped collection ${request.collection}.`
          : "Collection was not found.",
      };
    } else if (request.operation === "insert") {
      const document = parseMongoObject(request.document, "Document");
      const inserted = await db
        .collection(request.collection)
        .insertOne(document);
      result = {
        message: "Document inserted.",
        insertedId: EJSON.stringify(inserted.insertedId, { relaxed: true }),
      };
    } else if (request.operation === "update") {
      parseMongoFilter(request.filter);
      const filter = parseMongoObject(request.filter, "Filter");
      if (Object.keys(filter).length === 0)
        throw new Error("Update filters cannot be empty.");
      const update = parseMongoObject(request.update, "Update");
      if (
        !Object.keys(update).length ||
        Object.keys(update).some((key) => !key.startsWith("$"))
      ) {
        throw new Error("Use MongoDB update operators such as $set or $inc.");
      }
      const collection = db.collection(request.collection);
      const updated = request.many
        ? await collection.updateMany(filter, update, {
            upsert: request.upsert,
          })
        : await collection.updateOne(filter, update, {
            upsert: request.upsert,
          });
      result = {
        message: request.many
          ? "Matching documents updated."
          : "Document updated.",
        affectedCount: updated.modifiedCount + (updated.upsertedCount ?? 0),
      };
    } else if (request.operation === "delete") {
      parseMongoFilter(request.filter);
      const filter = parseMongoObject(request.filter, "Filter");
      if (Object.keys(filter).length === 0)
        throw new Error("Delete filters cannot be empty.");
      const deleted = request.many
        ? await db.collection(request.collection).deleteMany(filter)
        : await db.collection(request.collection).deleteOne(filter);
      result = {
        message: request.many
          ? "Matching documents deleted."
          : "Document deleted.",
        affectedCount: deleted.deletedCount,
      };
    } else if (request.operation === "create-index") {
      const keys = parseMongoObject(request.keys, "Index keys");
      if (!Object.keys(keys).length)
        throw new Error("Index keys cannot be empty.");
      const name = await db
        .collection(request.collection)
        .createIndex(keys as never, { unique: request.unique });
      result = { message: `Created index ${name}.` };
    } else {
      const dropped = await db
        .collection(request.collection)
        .dropIndex(request.indexName);
      result = {
        message: `Dropped index ${request.indexName}.`,
        affectedCount: dropped ? 1 : 0,
      };
    }
    post({ type: "mongo-operation-result", requestId, result });
  } catch (error) {
    post({
      type: "mongo-operation-error",
      requestId,
      message: safeError(error),
    });
  }
}
