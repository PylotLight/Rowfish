export type DatabaseKind = "postgres" | "mongodb" | "sqlite";

/** libpq sslmode values Rowfish supports for PostgreSQL. */
export type PostgresSslMode =
  "disable" | "prefer" | "require" | "verify-ca" | "verify-full";

export interface DatabaseConnectionInput {
  name: string;
  kind: DatabaseKind;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  tls: boolean;
  /** PostgreSQL only; older saved profiles omit it (see resolvePostgresSslMode). */
  sslMode?: PostgresSslMode;
  serverMode: boolean;
  connectionString?: string;
}

export interface DatabaseConnectionTestResult {
  /** Wall time to open the connection, run the check and close it. */
  connectMs: number;
  /** Round trip of the check query (SELECT 1 / ping) on the open connection. */
  latencyMs: number;
  serverVersion?: string;
}

export interface DatabaseConnectionSummary {
  id: string;
  name: string;
  kind: DatabaseKind;
  host: string;
  port: number;
  database: string;
  connectedAt: number;
  serverMode?: boolean;
  savedConnectionId?: string;
  parentConnectionId?: string;
}

export interface AlembicDatabaseStatus {
  tableFound: boolean;
  schema?: string;
  revisions: string[];
  error?: string;
}

export interface AlembicStatus {
  directory: string;
  database: AlembicDatabaseStatus;
  graph: {
    revisions: {
      revision: string;
      downRevisions: string[];
      dependsOn: string[];
      branchLabels: string[];
      filename: string;
      message: string;
    }[];
    heads: string[];
    topologicalOrder: string[];
    diagnostics: string[];
  };
  comparison: {
    knownCurrent: string[];
    applied: string[];
    pending: string[];
    unknown: string[];
    diagnostics: string[];
  };
}

export interface SavedConnectionProfile extends Omit<
  DatabaseConnectionInput,
  "password" | "connectionString"
> {
  id: string;
  hasSecret: boolean;
}

export interface DatabaseBrowserDatabase {
  name: string;
  canConnect: boolean;
}

export interface DatabaseBrowserTable {
  schema: string;
  name: string;
  kind:
    | "table"
    | "view"
    | "materialized view"
    | "foreign table"
    | "partitioned table";
}

export interface PostgresColumnDetails {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface PostgresRowRequest {
  connectionId: string;
  schema: string;
  table: string;
  key: DatabaseRow;
}

export interface UpdatePostgresRowRequest extends PostgresRowRequest {
  version: string;
  changes: DatabaseRow;
}

export interface PostgresRowDetails {
  row: DatabaseRow;
  columns: (PostgresColumnDetails & { editable: boolean })[];
  key: DatabaseRow;
  version: string;
}

export interface PostgresIndexDetails {
  name: string;
  definition: string;
  unique: boolean;
  primary: boolean;
}

export interface PostgresConstraintDetails {
  name: string;
  type: string;
  definition: string;
}

export interface PostgresTableDetails {
  schema: string;
  name: string;
  kind: DatabaseBrowserTable["kind"];
  columns: PostgresColumnDetails[];
  indexes: PostgresIndexDetails[];
  constraints: PostgresConstraintDetails[];
}

export interface PostgresServerInfo {
  version: string;
  user: string;
  database: string;
}

export interface MongoBrowserDatabase {
  name: string;
  sizeOnDisk?: number;
  empty?: boolean;
}

export interface MongoBrowserIndex {
  name: string;
  keys: string;
  unique: boolean;
  expireAfterSeconds?: number;
}

export interface MongoBrowserCollection {
  name: string;
  type: string;
  estimatedDocuments?: number;
  indexes?: MongoBrowserIndex[];
  validator?: string;
  options?: string;
  /** Dotted field paths seen in a small sample of documents, for autocomplete. */
  fields?: string[];
}

export type MongoMutationRequest =
  | {
      connectionId: string;
      operation: "insert";
      database: string;
      collection: string;
      document: string;
    }
  | {
      connectionId: string;
      operation: "update";
      database: string;
      collection: string;
      filter: string;
      update: string;
      many: boolean;
      upsert: boolean;
    }
  | {
      connectionId: string;
      operation: "delete";
      database: string;
      collection: string;
      filter: string;
      many: boolean;
    }
  | {
      connectionId: string;
      operation: "create-collection";
      database: string;
      collection: string;
    }
  | {
      connectionId: string;
      operation: "drop-collection";
      database: string;
      collection: string;
    }
  | {
      connectionId: string;
      operation: "create-index";
      database: string;
      collection: string;
      keys: string;
      unique: boolean;
    }
  | {
      connectionId: string;
      operation: "drop-index";
      database: string;
      collection: string;
      indexName: string;
    }
  | { connectionId: string; operation: "drop-database"; database: string };

export interface MongoMutationResult {
  message: string;
  affectedCount?: number;
  insertedId?: string;
}

export interface DatabaseQueryRequest {
  connectionId: string;
  queryId: string;
  query: string;
  collection?: string;
  database?: string;
  mongoMode?: "find" | "aggregate";
  maxRows: number;
}

export type DatabaseCell = string | number | boolean | null;
export type DatabaseRow = Record<string, DatabaseCell>;

export type DatabaseEvent =
  | {
      type: "query:rows";
      queryId: string;
      columns: string[];
      rows: DatabaseRow[];
      receivedRows: number;
      /** MongoDB only: canonical EJSON per row, null when over the size budget. */
      documents?: (string | null)[];
    }
  | {
      type: "query:complete";
      queryId: string;
      receivedRows: number;
      elapsedMs: number;
      truncated: boolean;
      affectedRows?: number;
      statementCount?: number;
    }
  | { type: "query:error"; queryId: string; message: string }
  | { type: "query:cancelled"; queryId: string; connectionId: string }
  | { type: "connection:closed"; connectionId: string; message?: string };
