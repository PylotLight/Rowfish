import type { DatabaseConnectionInput } from "../../shared/database";
import { isAbsolute } from "node:path";
import {
  isPostgresSslMode,
  parseMongoConnectionString,
  parsePostgresConnectionString,
  resolvePostgresSslMode,
  sslModeEncrypts,
} from "../../shared/database-helpers";

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function validateText(
  value: unknown,
  label: string,
  maxLength: number,
  required = false,
): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength || /[\0-\x1f\x7f]/.test(normalized)) {
    throw new Error(`${label} is invalid or too long.`);
  }
  return normalized;
}

export function validateQueryText(
  value: unknown,
  label: string,
  maxLength: number,
  required = false,
): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${label} is required.`);
  if (
    normalized.length > maxLength ||
    /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(normalized)
  ) {
    throw new Error(`${label} is invalid or too long.`);
  }
  return normalized;
}

export function validateConnectionInput(
  value: unknown,
): DatabaseConnectionInput {
  if (!isPlainRecord(value)) throw new Error("Invalid connection details.");
  const kind = value.kind;
  if (kind !== "postgres" && kind !== "mongodb" && kind !== "sqlite")
    throw new Error("Choose PostgreSQL, MongoDB, or SQLite.");
  const name = validateText(value.name, "Connection name", 80, true);
  if (kind === "sqlite") {
    if (value.serverMode !== undefined && typeof value.serverMode !== "boolean")
      throw new Error("Server-browser selection is invalid.");
    const database = validateText(
      value.database,
      "SQLite database file",
      4_096,
      true,
    );
    if (!isAbsolute(database))
      throw new Error("Choose an absolute path to a SQLite database file.");
    if (value.serverMode === true || value.connectionString)
      throw new Error(
        "SQLite uses a local database file, not a server or connection string.",
      );
    return {
      name,
      kind,
      host: "",
      port: 0,
      database,
      username: "",
      password: "",
      tls: false,
      serverMode: false,
    };
  }
  const host = validateText(value.host, "Host", 253, true);
  if (/[\s/@?#\\]/.test(host))
    throw new Error(
      "Host must be a hostname or IP address without a URL scheme.",
    );
  const port = Number(value.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("Port must be between 1 and 65535.");
  const serverMode = value.serverMode === true;
  if (value.serverMode !== undefined && typeof value.serverMode !== "boolean")
    throw new Error("Server-browser selection is invalid.");
  if (serverMode && kind !== "postgres")
    throw new Error("Server-wide browsing is available only for PostgreSQL.");
  const connectionString =
    value.connectionString === undefined
      ? ""
      : validateText(value.connectionString, "Connection string", 4_096);
  if (connectionString) {
    if (kind === "postgres") {
      // The password stays inside the connection string (and its encrypted
      // saved secret); only display fields are copied into the config.
      const details = parsePostgresConnectionString(connectionString);
      return {
        name,
        kind,
        host: details.host,
        port: details.port,
        database: serverMode
          ? ""
          : details.database || details.username || "postgres",
        username: details.username,
        password: "",
        tls: details.tls,
        sslMode: details.sslMode ?? "prefer",
        serverMode,
        connectionString,
      };
    }
    const details = parseMongoConnectionString(connectionString);
    return {
      name,
      kind,
      ...details,
      username: "",
      password: "",
      tls: false,
      serverMode: false,
      connectionString,
    };
  }
  const database = serverMode
    ? ""
    : validateText(value.database, "Database", 128, true);
  const username = validateText(value.username ?? "", "Username", 512);
  const password = value.password ?? "";
  if (
    typeof password !== "string" ||
    password.length > 1_024 ||
    password.includes("\0")
  ) {
    throw new Error("Password is invalid or too long.");
  }
  if (typeof value.tls !== "boolean")
    throw new Error("TLS selection is invalid.");
  if (value.sslMode !== undefined && !isPostgresSslMode(value.sslMode))
    throw new Error("SSL mode selection is invalid.");
  const sslMode =
    kind === "postgres"
      ? resolvePostgresSslMode({ sslMode: value.sslMode, tls: value.tls })
      : undefined;

  return {
    name,
    kind,
    host,
    port,
    database,
    username,
    password,
    tls: sslMode ? sslModeEncrypts(sslMode) : value.tls,
    ...(sslMode ? { sslMode } : {}),
    serverMode,
  };
}
