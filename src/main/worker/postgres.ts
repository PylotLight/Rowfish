import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { Client as PostgresClient } from "pg";
import Cursor from "pg-cursor";
import type {
  DatabaseQueryRequest,
  DatabaseRow,
  PostgresRowRequest,
  PostgresSslMode,
  UpdatePostgresRowRequest,
} from "../../shared/database";
import {
  buildMongoConnectionString,
  parsePostgresConnectionString,
  resolvePostgresSslMode,
  stripPostgresSslParams,
  withPostgresDatabase,
} from "../../shared/database-helpers";
import { splitPostgresStatements } from "../../shared/sql-statements";
import {
  openSqliteDatabase,
  closeSqliteDatabase,
  probeSqliteDatabase,
} from "./sqlite";
import {
  assertCompletePrimaryKey,
  buildRowUpdate,
  quoteIdentifier,
} from "../postgres-row-edit";
import {
  BATCH_SIZE,
  MAX_CELL_CHARS,
  MAX_COLUMNS,
  MAX_RESULT_BYTES,
  QUERY_TIMEOUT_MS,
  config,
  state,
  post,
  safeError,
  connectError,
  buildRow,
  distinctColumnNames,
  postBatch,
} from "./shared";

type PostgresTarget = ConstructorParameters<typeof PostgresClient>[0];
type PostgresTls = Exclude<NonNullable<PostgresTarget>, string>["ssl"];

function readCertificate(file: string | undefined, label: string) {
  if (!file) return undefined;
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`Could not read the ${label} file “${file}”.`);
  }
}

/**
 * node-postgres options for a libpq sslmode. node-postgres on its own treats
 * require like verify-full and has no prefer, so Rowfish maps them itself:
 * prefer and require encrypt without checking the certificate (prefer falls
 * back to plain when the server has no TLS), verify-ca checks the chain only,
 * verify-full also checks the host name.
 */
function postgresTls(
  mode: PostgresSslMode,
  files: { rootCert?: string; cert?: string; key?: string },
): PostgresTls {
  if (mode === "disable") return false;
  const ca = readCertificate(files.rootCert, "sslrootcert");
  const cert = readCertificate(files.cert, "sslcert");
  const key = readCertificate(files.key, "sslkey");
  const material = {
    ...(ca ? { ca } : {}),
    ...(cert ? { cert } : {}),
    ...(key ? { key } : {}),
  };
  if (mode === "verify-full") return { rejectUnauthorized: true, ...material };
  // libpq: require with a root certificate behaves like verify-ca.
  if (mode === "verify-ca" || (mode === "require" && ca))
    return {
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
      ...material,
    };
  return { rejectUnauthorized: false, ...material };
}

function postgresSslMode(): PostgresSslMode {
  return resolvePostgresSslMode(config);
}

function postgresTarget(plainFallback = false): PostgresTarget {
  const shared = {
    connectionTimeoutMillis: 8_000,
    options: `-c statement_timeout=${QUERY_TIMEOUT_MS}`,
    application_name: "Rowfish",
  };
  const mode = plainFallback ? "disable" : postgresSslMode();
  if (config.connectionString) {
    // Point the string at the selected database (server-browser children
    // reuse the parent's string) and let node-postgres apply its other
    // options. TLS options are stripped and applied explicitly below.
    const database =
      config.database ||
      parsePostgresConnectionString(config.connectionString).database ||
      "postgres";
    const { connectionString, ...files } = stripPostgresSslParams(
      withPostgresDatabase(config.connectionString, database),
    );
    return { ...shared, connectionString, ssl: postgresTls(mode, files) };
  }
  return {
    ...shared,
    host: config.host,
    port: config.port,
    database: config.database || "postgres",
    user: config.username || undefined,
    password: config.password || undefined,
    ssl: postgresTls(mode, {}),
  };
}

function serverLacksTls(error: unknown): boolean {
  return (
    error instanceof Error &&
    /does not support SSL|server does not support ssl/i.test(error.message)
  );
}

/** Connects with the configured sslmode; prefer retries in plain text. */
async function connectPostgres(): Promise<InstanceType<typeof PostgresClient>> {
  const client = new PostgresClient(postgresTarget());
  client.on("error", () => undefined);
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end().catch(() => undefined);
    if (postgresSslMode() !== "prefer" || !serverLacksTls(error)) throw error;
    const plain = new PostgresClient(postgresTarget(true));
    plain.on("error", () => undefined);
    await plain.connect();
    return plain;
  }
}

export async function openConnection(): Promise<void> {
  if (config.kind === "postgres") {
    state.postgres = await connectPostgres();
    state.postgres.on("error", (error) => {
      if (!state.closing)
        post({ type: "connect-error", message: safeError(error) });
    });
  } else if (config.kind === "sqlite") {
    openSqliteDatabase();
  } else {
    const uri = config.connectionString || buildMongoConnectionString(config);
    state.mongo = new MongoClient(uri, {
      connectTimeoutMS: 8_000,
      serverSelectionTimeoutMS: 8_000,
      maxPoolSize: 2,
    });
    await state.mongo.connect();
    state.mongoDb = state.mongo.db(config.database);
  }
  post({ type: "ready" });
}

export async function probeConnection(): Promise<void> {
  try {
    if (config.kind === "postgres") {
      state.postgres = await connectPostgres();
      const startedAt = performance.now();
      await state.postgres.query("SELECT 1");
      const elapsedMs = Math.round(performance.now() - startedAt);
      let serverVersion: string | undefined;
      try {
        const version = await state.postgres.query<{ version: string }>(
          "SELECT current_setting('server_version') AS version",
        );
        serverVersion = version.rows[0]?.version
          ? `PostgreSQL ${version.rows[0].version.split(" ")[0]}`
          : undefined;
      } catch {
        serverVersion = undefined;
      }
      state.closing = true;
      await state.postgres.end().catch(() => undefined);
      post({ type: "probe-result", elapsedMs, serverVersion });
    } else if (config.kind === "sqlite") {
      state.closing = true;
      probeSqliteDatabase();
    } else {
      state.mongo = new MongoClient(
        config.connectionString || buildMongoConnectionString(config),
        {
          connectTimeoutMS: 8_000,
          serverSelectionTimeoutMS: 8_000,
          maxPoolSize: 1,
        },
      );
      await state.mongo.connect();
      const db = state.mongo.db(config.database);
      const startedAt = performance.now();
      await db.command({ ping: 1 });
      const elapsedMs = Math.round(performance.now() - startedAt);
      let serverVersion: string | undefined;
      try {
        const info = await db.command({ buildInfo: 1 });
        serverVersion =
          typeof info.version === "string"
            ? `MongoDB ${info.version}`
            : undefined;
      } catch {
        serverVersion = undefined;
      }
      state.closing = true;
      await state.mongo.close().catch(() => undefined);
      post({ type: "probe-result", elapsedMs, serverVersion });
    }
  } catch (error) {
    state.closing = true;
    await state.postgres?.end().catch(() => undefined);
    await state.mongo?.close().catch(() => undefined);
    try {
      closeSqliteDatabase();
    } catch {
      // Preserve the original connection error.
    }
    post({ type: "connect-error", message: connectError(error) });
  }
}

export async function readPostgres(
  request: DatabaseQueryRequest,
): Promise<void> {
  if (!state.postgres) throw new Error("PostgreSQL connection is unavailable.");
  const startedAt = Date.now();
  const statements = splitPostgresStatements(request.query);
  if (statements.length === 0) throw new Error("Enter a SQL statement to run.");
  let receivedRows = 0;
  let estimatedBytes = 0;
  let truncated = false;
  let affectedRows = 0;
  let hasAffectedRows = false;
  let finalColumns: string[] = [];
  for (
    let statementIndex = 0;
    statementIndex < statements.length;
    statementIndex += 1
  ) {
    const cursor = new Cursor(statements[statementIndex]!, [], {
      rowMode: "array",
    });
    state.postgres.query(cursor as never);
    let fields: string[] = [];
    const columns = new Set<string>();
    const outgoing: DatabaseRow[] = [];
    let statementRows = 0;
    let rowCount: number | null = null;
    let command = "";
    const read = (
      count: number,
    ): Promise<{
      rows: unknown[][];
      resultFields: string[];
      count: number | null;
      command: string;
    }> =>
      new Promise((resolve, reject) => {
        cursor.read(count, (error, rows, result) => {
          if (error) reject(error);
          else
            resolve({
              rows,
              resultFields: result.fields.map((field) => field.name),
              count:
                (result as typeof result & { rowCount?: number }).rowCount ??
                null,
              command:
                (result as typeof result & { command?: string }).command ?? "",
            });
        });
      });
    try {
      const isFinal = statementIndex === statements.length - 1;
      while (!isFinal || statementRows <= request.maxRows) {
        const remaining = isFinal
          ? request.maxRows + 1 - statementRows
          : BATCH_SIZE;
        const next = await read(Math.min(BATCH_SIZE, remaining));
        if (next.resultFields.length > 0) {
          fields = distinctColumnNames(next.resultFields);
          for (const field of fields) columns.add(field);
        }
        if (next.count !== null) rowCount = next.count;
        if (next.command) command = next.command;
        if (next.rows.length === 0) break;
        // Previous statements are drained but never accumulated or sent to the UI.
        for (const values of next.rows) {
          statementRows++;
          if (!isFinal) continue;
          if (receivedRows >= request.maxRows) {
            truncated = true;
            break;
          }
          const row = buildRow(fields, values);
          const rowBytes = Buffer.byteLength(JSON.stringify(row));
          if (estimatedBytes + rowBytes > MAX_RESULT_BYTES) {
            truncated = true;
            break;
          }
          estimatedBytes += rowBytes;
          receivedRows++;
          outgoing.push(row);
          if (outgoing.length >= BATCH_SIZE)
            postBatch(
              request.queryId,
              outgoing.splice(0),
              columns,
              receivedRows,
            );
        }
        if (truncated) break;
        if (next.rows.length < Math.min(BATCH_SIZE, remaining)) break;
      }
    } finally {
      if (truncated) await cursor.close().catch(() => undefined);
    }
    if (statementIndex === statements.length - 1) {
      finalColumns = [...columns];
      // Preserve column metadata for zero-row SELECT results.
      post({
        type: "rows",
        queryId: request.queryId,
        rows: outgoing,
        columns: finalColumns,
        receivedRows,
      });
    }
    if (
      rowCount !== null &&
      /^(INSERT|UPDATE|DELETE|MERGE|COPY)$/.test(command)
    ) {
      affectedRows += rowCount;
      hasAffectedRows = true;
    }
    if (truncated) break;
  }
  post({
    type: "complete",
    queryId: request.queryId,
    receivedRows,
    elapsedMs: Date.now() - startedAt,
    truncated,
    ...(hasAffectedRows ? { affectedRows } : {}),
    statementCount: statements.length,
  });
}
export async function getOrUpdatePostgresRow(
  requestId: string,
  type: "get-postgres-row" | "update-postgres-row",
  input: PostgresRowRequest | UpdatePostgresRowRequest,
): Promise<void> {
  try {
    if (!state.postgres)
      throw new Error("PostgreSQL connection is unavailable.");
    const request = input as UpdatePostgresRowRequest;
    const rel = await state.postgres.query<{ kind: string }>(
      `SELECT c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2`,
      [input.schema, input.table],
    );
    if (!rel.rows[0] || !["r", "p"].includes(rel.rows[0].kind))
      throw new Error(
        "Only ordinary and partitioned tables can be edited; views are read-only.",
      );
    const meta = await state.postgres.query<{
      name: string;
      dataType: string;
      nullable: boolean;
      defaultValue: string | null;
      isPrimaryKey: boolean;
      generated: string;
      identity: string;
      typeCategory: string;
      typeName: string;
    }>(
      `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS "dataType",NOT a.attnotnull AS nullable,pg_get_expr(d.adbin,d.adrelid) AS "defaultValue",a.attgenerated AS generated,a.attidentity AS identity,t.typcategory AS "typeCategory",t.typname AS "typeName",EXISTS(SELECT 1 FROM pg_constraint pk WHERE pk.conrelid=c.oid AND pk.contype='p' AND a.attnum=ANY(pk.conkey)) AS "isPrimaryKey" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [input.schema, input.table],
    );
    const pks = meta.rows.filter((c) => c.isPrimaryKey).map((c) => c.name);
    assertCompletePrimaryKey(input.key, pks);
    if (
      pks.some((name) => {
        const column = meta.rows.find((c) => c.name === name)!;
        return (
          !["S", "N", "B"].includes(column.typeCategory) &&
          column.typeName !== "uuid"
        );
      })
    )
      throw new Error(
        "Editing requires primary-key columns with safely representable text, numeric, boolean, or UUID values.",
      );
    const params = pks.map((n) => input.key[n]);
    const where = pks
      .map((n, i) => `${quoteIdentifier(n)} IS NOT DISTINCT FROM $${i + 1}`)
      .join(" AND ");
    let versionAlias = "__rowfish_xmin_internal";
    while (meta.rows.some((c) => c.name === versionAlias))
      versionAlias = `_${versionAlias}`;
    const select = `SELECT ${meta.rows.map((c) => `${quoteIdentifier(c.name)}::text AS ${quoteIdentifier(c.name)}`).join(", ")},xmin::text AS ${quoteIdentifier(versionAlias)} FROM ${quoteIdentifier(input.schema)}.${quoteIdentifier(input.table)} WHERE ${where}`;
    const validateResult = (result: Record<string, unknown>): void => {
      const values = Object.values(result);
      if (
        values.some(
          (value) => typeof value === "string" && value.length > MAX_CELL_CHARS,
        )
      )
        throw new Error(
          "This row contains a cell too large for safe editing; no value was truncated.",
        );
      const payload = JSON.stringify(result);
      if (new TextEncoder().encode(payload).byteLength > MAX_RESULT_BYTES)
        throw new Error(
          "This row exceeds the safe result size limit; no value was truncated.",
        );
    };
    let row: Record<string, unknown>;
    if (type === "update-postgres-row") {
      const names = Object.keys(request.changes),
        byName = new Map(meta.rows.map((c) => [c.name, c]));
      if (meta.rows.length > MAX_COLUMNS)
        throw new Error("This table has too many columns for safe editing.");
      if (
        !names.length ||
        names.some(
          (n) =>
            !byName.has(n) ||
            byName.get(n)!.isPrimaryKey ||
            byName.get(n)!.generated !== "" ||
            byName.get(n)!.identity !== "" ||
            ["U", "P"].includes(byName.get(n)!.typeCategory),
        )
      )
        throw new Error(
          "Changes include an unsupported, generated, identity, or unknown column.",
        );
      // BEGIN inside a caller-owned transaction is not nested in PostgreSQL;
      // committing it would commit the user's work. Refuse saves in that state.
      const statusMethod = (
        state.postgres as PostgresClient & {
          getTransactionStatus?: () => string;
        }
      ).getTransactionStatus;
      if (typeof statusMethod !== "function")
        throw new Error(
          "Cannot verify PostgreSQL transaction status; refusing to save.",
        );
      const transactionStatus = statusMethod.call(state.postgres);
      if (transactionStatus !== "I")
        throw new Error(
          "Finish or roll back the active SQL transaction before saving a row.",
        );
      await state.postgres.query("BEGIN");
      try {
        const result = await state.postgres.query(
          buildRowUpdate(input.schema, input.table, pks, names),
          [...params, ...names.map((n) => request.changes[n]), request.version],
        );
        if (result.rowCount !== 1)
          throw new Error(
            "The row changed or was deleted; reload it before editing.",
          );
        const fresh = await state.postgres.query(select, params);
        if (fresh.rowCount !== 1)
          throw new Error("The updated row could not be read.");
        row = fresh.rows[0]!;
        validateResult(row);
        await state.postgres.query("COMMIT");
      } catch (e) {
        await state.postgres.query("ROLLBACK").catch(() => undefined);
        throw e;
      }
    } else {
      const result = await state.postgres.query(select, params);
      if (result.rowCount !== 1)
        throw new Error("The row was not found or its key is ambiguous.");
      row = result.rows[0]!;
      validateResult(row);
    }
    const version = String(row[versionAlias]);
    delete row[versionAlias];
    const key: DatabaseRow = Object.create(null);
    for (const n of pks) key[n] = row[n] as DatabaseRow[string];
    const columns = meta.rows.map((c) => ({
      name: c.name,
      dataType: c.dataType,
      nullable: c.nullable,
      defaultValue: c.defaultValue,
      isPrimaryKey: c.isPrimaryKey,
      editable:
        !c.isPrimaryKey &&
        c.generated === "" &&
        c.identity === "" &&
        !["U", "P"].includes(c.typeCategory),
    }));
    post({
      type: "inspection-result",
      requestId,
      postgresRow: { row: row as DatabaseRow, columns, key, version },
    });
  } catch (e) {
    post({ type: "inspection-error", requestId, message: safeError(e) });
  }
}
