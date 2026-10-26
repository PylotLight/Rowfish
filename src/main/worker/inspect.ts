import { collectMongoFieldPaths } from "../../shared/mongo-shell";
import type { DatabaseBrowserTable } from "../../shared/database";
import {
  EJSON,
  config,
  state,
  post,
  safeError,
  type WorkerRequest,
} from "./shared";
import { getOrUpdatePostgresRow } from "./postgres";
import {
  listSqliteColumns,
  listSqliteTables,
  readSqliteAlembicVersion,
} from "./sqlite";

export async function inspect(
  request: Extract<
    WorkerRequest,
    {
      type:
        | "inspect-databases"
        | "inspect-tables"
        | "inspect-mongo-databases"
        | "inspect-mongo-collections"
        | "inspect-mongo-collection"
        | "inspect-postgres-table"
        | "inspect-postgres-server"
        | "inspect-postgres-columns"
        | "inspect-alembic-version"
        | "get-postgres-row"
        | "update-postgres-row";
    }
  >,
): Promise<void> {
  try {
    if (
      request.type === "get-postgres-row" ||
      request.type === "update-postgres-row"
    ) {
      if (!request.rowRequest) throw new Error("Missing row request.");
      await getOrUpdatePostgresRow(
        request.requestId,
        request.type,
        request.rowRequest,
      );
      return;
    }
    if (request.type === "inspect-mongo-databases") {
      if (!state.mongo) throw new Error("MongoDB connection is unavailable.");
      const result = await state.mongo
        .db("admin")
        .admin()
        .listDatabases({ nameOnly: false, authorizedDatabases: true });
      post({
        type: "inspection-result",
        requestId: request.requestId,
        mongoDatabases: result.databases.map((database) => ({
          name: database.name,
          ...(typeof database.sizeOnDisk === "number"
            ? { sizeOnDisk: database.sizeOnDisk }
            : {}),
          ...(typeof database.empty === "boolean"
            ? { empty: database.empty }
            : {}),
        })),
      });
      return;
    }
    if (
      request.type === "inspect-mongo-collections" ||
      request.type === "inspect-mongo-collection"
    ) {
      if (!state.mongo) throw new Error("MongoDB connection is unavailable.");
      const db = state.mongo.db(request.database);
      if (request.type === "inspect-mongo-collections") {
        const collections = await db
          .listCollections({}, { nameOnly: false })
          .toArray();
        post({
          type: "inspection-result",
          requestId: request.requestId,
          mongoCollections: collections
            .filter((item) => !item.name.startsWith("system."))
            .map((item) => ({
              name: item.name,
              type: item.type ?? "collection",
            })),
        });
        return;
      }
      const name = request.collection ?? "";
      const listing = await db
        .listCollections({ name }, { nameOnly: false })
        .toArray();
      const definition = listing[0];
      if (!definition)
        throw new Error(`Collection “${name}” no longer exists.`);
      const collection = db.collection(name);
      const indexes =
        definition.type === "view"
          ? []
          : await collection
              .listIndexes()
              .toArray()
              .catch(() => []);
      const estimatedDocuments =
        definition.type === "view"
          ? undefined
          : await collection.estimatedDocumentCount().catch(() => undefined);
      const validator = definition.options?.validator;
      const fields = collectMongoFieldPaths(
        await collection
          .find({}, { maxTimeMS: 5_000 })
          .limit(100)
          .toArray()
          .catch(() => []),
      );
      post({
        type: "inspection-result",
        requestId: request.requestId,
        mongoCollection: {
          name,
          type: definition.type ?? "collection",
          ...(estimatedDocuments !== undefined ? { estimatedDocuments } : {}),
          ...(fields.length ? { fields } : {}),
          ...(validator
            ? { validator: EJSON.stringify(validator, { relaxed: false }) }
            : {}),
          ...(definition.options
            ? {
                options: EJSON.stringify(definition.options, {
                  relaxed: false,
                }),
              }
            : {}),
          indexes: indexes.map((index) => ({
            name: index.name ?? "unnamed",
            keys: EJSON.stringify(index.key, { relaxed: true }),
            unique: Boolean(index.unique),
            ...(typeof index.expireAfterSeconds === "number"
              ? { expireAfterSeconds: index.expireAfterSeconds }
              : {}),
          })),
        },
      });
      return;
    }
    if (request.type === "inspect-alembic-version") {
      if (config.kind === "postgres" && state.postgres) {
        const found = await state.postgres.query<{
          schema: string;
          visible: boolean;
        }>(
          `
          SELECT n.nspname AS schema, pg_table_is_visible(c.oid) AS visible
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = $1 AND c.relkind IN ('r', 'p')
            AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            AND has_table_privilege(c.oid, 'SELECT')
          ORDER BY pg_table_is_visible(c.oid) DESC,
            array_position(current_schemas(true), n.nspname) NULLS LAST,
            n.nspname
        `,
          ["alembic_version"],
        );
        if (found.rows.length === 0) {
          post({
            type: "inspection-result",
            requestId: request.requestId,
            alembicStatus: { tableFound: false, revisions: [] },
          });
          return;
        }
        const visible = found.rows.filter((row) => row.visible);
        const versionTable =
          visible[0] ?? (found.rows.length === 1 ? found.rows[0] : undefined);
        if (!versionTable) {
          post({
            type: "inspection-result",
            requestId: request.requestId,
            alembicStatus: {
              tableFound: true,
              revisions: [],
              error:
                "Multiple accessible alembic_version tables exist outside the connection search path.",
            },
          });
          return;
        }
        const quotedSchema = `"${versionTable.schema.replaceAll('"', '""')}"`;
        const result = await state.postgres.query<{ version_num: string }>(
          `SELECT version_num FROM ${quotedSchema}."alembic_version" ORDER BY version_num`,
        );
        post({
          type: "inspection-result",
          requestId: request.requestId,
          alembicStatus: {
            tableFound: true,
            schema: versionTable.schema,
            revisions: result.rows.map((row) => row.version_num),
          },
        });
        return;
      }
      if (config.kind === "sqlite") {
        post({
          type: "inspection-result",
          requestId: request.requestId,
          alembicStatus: readSqliteAlembicVersion(),
        });
        return;
      }
      throw new Error(
        "Alembic status is available for PostgreSQL or SQLite connections.",
      );
    }
    if (request.type === "inspect-tables" && config.kind === "sqlite") {
      post({
        type: "inspection-result",
        requestId: request.requestId,
        tables: listSqliteTables() as DatabaseBrowserTable[],
      });
      return;
    }
    if (
      request.type === "inspect-postgres-columns" &&
      config.kind === "sqlite"
    ) {
      post({
        type: "inspection-result",
        requestId: request.requestId,
        postgresColumns: listSqliteColumns(),
      });
      return;
    }
    if (!state.postgres || config.kind !== "postgres")
      throw new Error(
        "The PostgreSQL browser is only available for PostgreSQL connections.",
      );
    if (request.type === "inspect-databases") {
      const result = await state.postgres.query<{
        name: string;
        canConnect: boolean;
      }>(`
        SELECT datname AS name,
          (datallowconn AND has_database_privilege(datname, 'CONNECT')) AS "canConnect"
        FROM pg_database
        WHERE NOT datistemplate
        ORDER BY datname
      `);
      post({
        type: "inspection-result",
        requestId: request.requestId,
        databases: result.rows.map((row) => ({
          name: row.name,
          canConnect: row.canConnect,
        })),
      });
      return;
    }

    if (request.type === "inspect-postgres-columns") {
      const result = await state.postgres.query<{
        schema: string;
        table: string;
        name: string;
      }>(`
        SELECT n.nspname AS schema, c.relname AS table, a.attname AS name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped
          AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
          AND has_schema_privilege(n.oid, 'USAGE') AND has_table_privilege(c.oid, 'SELECT')
        ORDER BY n.nspname, c.relname, a.attnum LIMIT 10000
      `);
      post({
        type: "inspection-result",
        requestId: request.requestId,
        postgresColumns: result.rows,
      });
      return;
    }
    if (request.type === "inspect-postgres-server") {
      const result = await state.postgres.query<{
        version: string;
        user: string;
        database: string;
      }>(
        'SELECT version() AS version, current_user AS "user", current_database() AS database',
      );
      post({
        type: "inspection-result",
        requestId: request.requestId,
        postgresServer: result.rows[0],
      });
      return;
    }

    if (request.type === "inspect-postgres-table") {
      const schema = request.schema ?? "";
      const table = request.table ?? "";
      const relation = await state.postgres.query<{
        schema: string;
        name: string;
        kind: DatabaseBrowserTable["kind"];
        oid: string;
      }>(
        `
        SELECT n.nspname AS schema, c.relname AS name, c.oid::text AS oid,
          CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
            WHEN 'f' THEN 'foreign table' WHEN 'p' THEN 'partitioned table' ELSE 'table' END AS kind
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      `,
        [schema, table],
      );
      const item = relation.rows[0];
      if (!item)
        throw new Error(
          "The selected PostgreSQL table or view no longer exists.",
        );
      const [columnsResult, indexesResult, constraintsResult] =
        await Promise.all([
          state.postgres.query<{
            name: string;
            dataType: string;
            nullable: boolean;
            defaultValue: string | null;
            isPrimaryKey: boolean;
          }>(
            `
          SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS "dataType",
            NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS "defaultValue",
            EXISTS (SELECT 1 FROM pg_constraint pk WHERE pk.conrelid = c.oid AND pk.contype = 'p' AND a.attnum = ANY(pk.conkey)) AS "isPrimaryKey"
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
          LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
          WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum
        `,
            [schema, table],
          ),
          state.postgres.query<{
            name: string;
            definition: string;
            unique: boolean;
            primary: boolean;
          }>(
            `
          SELECT i.relname AS name, pg_get_indexdef(i.oid) AS definition,
            ix.indisunique AS unique, ix.indisprimary AS primary
          FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN pg_index ix ON ix.indrelid = t.oid JOIN pg_class i ON i.oid = ix.indexrelid
          WHERE n.nspname = $1 AND t.relname = $2 ORDER BY i.relname
        `,
            [schema, table],
          ),
          state.postgres.query<{
            name: string;
            type: string;
            definition: string;
          }>(
            `
          SELECT con.conname AS name, con.contype AS type, pg_get_constraintdef(con.oid, true) AS definition
          FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2 ORDER BY con.conname
        `,
            [schema, table],
          ),
        ]);
      post({
        type: "inspection-result",
        requestId: request.requestId,
        postgresTable: {
          schema: item.schema,
          name: item.name,
          kind: item.kind,
          columns: columnsResult.rows,
          indexes: indexesResult.rows,
          constraints: constraintsResult.rows,
        },
      });
      return;
    }

    const result = await state.postgres.query<{
      schema: string;
      name: string;
      kind: DatabaseBrowserTable["kind"];
    }>(`
      SELECT n.nspname AS schema,
        c.relname AS name,
        CASE c.relkind
          WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized view'
          WHEN 'f' THEN 'foreign table'
          WHEN 'p' THEN 'partitioned table'
          ELSE 'table'
        END AS kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
      ORDER BY n.nspname, c.relname
    `);
    post({
      type: "inspection-result",
      requestId: request.requestId,
      tables: result.rows,
    });
  } catch (error) {
    post({
      type: "inspection-error",
      requestId: request.requestId,
      message: safeError(error),
    });
  }
}
