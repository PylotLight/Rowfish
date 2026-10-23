export const DATABASE_LIMITS = {
  minRows: 1,
  maxRows: 10_000,
  batchSize: 100,
  maxColumns: 128,
  maxCellChars: 8_192,
  maxResultBytes: 16 * 1024 * 1024,
  maxQueryLength: 100_000,
  timeoutMs: 120_000,
} as const;

export interface VirtualRowRange {
  start: number;
  end: number;
}

export function isValidRowLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= DATABASE_LIMITS.minRows &&
    value <= DATABASE_LIMITS.maxRows
  );
}

export function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export interface MongoConnectionDetails {
  host: string;
  port: number;
  database: string;
}

/** Connection fields a connection string maps onto in the connection dialog. */
/**
 * The database kind a connection string's scheme names, or null when the
 * scheme is missing or not one Rowfish supports. Only the scheme is read, so a
 * half-typed string is detected as soon as its scheme is complete.
 */
export function detectConnectionStringKind(
  source: string,
): "postgres" | "mongodb" | null {
  const match = /^\s*([a-z][a-z0-9+.-]*):\/\//i.exec(source);
  const scheme = match?.[1]?.toLowerCase();
  if (scheme === "postgres" || scheme === "postgresql") return "postgres";
  if (scheme === "mongodb" || scheme === "mongodb+srv") return "mongodb";
  return null;
}

export interface ConnectionStringFields {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  tls: boolean;
  /** Query options the dialog fields cannot represent (kept only in the string). */
  extraOptions: string[];
  /** False when the string uses features the plain fields cannot express. */
  representable: boolean;
}

function decodeConnectionPart(value: string, message: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(message);
  }
}

function readQueryOptions(
  query: string,
  message: string,
): [key: string, value: string][] {
  if (!query) return [];
  return query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const separator = pair.indexOf("=");
      const key = separator < 0 ? pair : pair.slice(0, separator);
      const value = separator < 0 ? "" : pair.slice(separator + 1);
      return [
        decodeConnectionPart(key.replaceAll("+", " "), message),
        decodeConnectionPart(value.replaceAll("+", " "), message),
      ];
    });
}

function splitUserInfo(
  authority: string,
  message: string,
): { username: string; password: string; hostList: string } {
  const at = authority.lastIndexOf("@");
  if (at < 0) return { username: "", password: "", hostList: authority };
  const userInfo = authority.slice(0, at);
  const colon = userInfo.indexOf(":");
  return {
    username: decodeConnectionPart(
      colon < 0 ? userInfo : userInfo.slice(0, colon),
      message,
    ),
    password:
      colon < 0 ? "" : decodeConnectionPart(userInfo.slice(colon + 1), message),
    hostList: authority.slice(at + 1),
  };
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function formatUserInfo(username: string, password: string): string {
  if (!username) return "";
  return `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@`;
}

const TRUE_OPTION = /^(true|1|yes)$/i;

/**
 * Parses every field the connection dialog shows from a MongoDB connection
 * string. The result includes the password, so it must stay in the renderer
 * form or the encrypted saved-connection secret.
 */
export function parseMongoConnectionFields(
  source: string,
): ConnectionStringFields {
  const details = parseMongoConnectionString(source);
  const message = "The MongoDB connection string is not valid.";
  const schemeEnd = source.indexOf("://");
  const srv = source.slice(0, schemeEnd).toLowerCase() === "mongodb+srv";
  const remainder = source.slice(schemeEnd + 3);
  const pathEnd = [remainder.indexOf("/"), remainder.indexOf("?")]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), remainder.length);
  const { username, password } = splitUserInfo(
    remainder.slice(0, pathEnd),
    message,
  );
  const queryStart = remainder.indexOf("?", pathEnd);
  const options = readQueryOptions(
    queryStart < 0 ? "" : remainder.slice(queryStart + 1),
    message,
  );
  let tls = srv;
  const extraOptions: string[] = [];
  for (const [key, value] of options) {
    const name = key.toLowerCase();
    if (name === "tls" || name === "ssl") tls = TRUE_OPTION.test(value);
    else if (name === "authsource" && username && value === details.database) {
      // The dialog fields always authenticate against the selected database.
    } else extraOptions.push(key);
  }
  return {
    ...details,
    username,
    password,
    tls,
    extraOptions,
    representable:
      !srv && !details.host.includes(",") && extraOptions.length === 0,
  };
}

/** Builds the MongoDB URI Rowfish uses for the dialog's connection fields. */
export function buildMongoConnectionString(fields: {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  tls: boolean;
}): string {
  const options = fields.username
    ? `?authSource=${encodeURIComponent(fields.database)}&tls=${String(fields.tls)}`
    : `?tls=${String(fields.tls)}`;
  return `mongodb://${formatUserInfo(fields.username, fields.password)}${formatUrlHost(fields.host)}:${fields.port}/${encodeURIComponent(fields.database)}${options}`;
}

// node-postgres verifies the server certificate for every sslmode except
// disable and its own no-verify extension, matching the dialog's TLS toggle.
const POSTGRES_SSL_MODES = new Set([
  "disable",
  "allow",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
  "no-verify",
]);

/**
 * Parses a postgres:// or postgresql:// connection string into the dialog's
 * fields. Query options other than sslmode/ssl are reported in extraOptions and
 * are applied by the PostgreSQL driver when the string itself is used.
 */
export function parsePostgresConnectionString(
  source: string,
): ConnectionStringFields {
  const invalid = "Enter a valid PostgreSQL connection string.";
  if (!source || source.length > 4_096 || /[\0-\x20\x7f]/.test(source)) {
    throw new Error(invalid);
  }
  const schemeEnd = source.indexOf("://");
  const scheme = schemeEnd < 0 ? "" : source.slice(0, schemeEnd).toLowerCase();
  if (
    (scheme !== "postgres" && scheme !== "postgresql") ||
    source.includes("#")
  ) {
    throw new Error(
      "Connection strings must start with postgres:// or postgresql:// and include a server host.",
    );
  }
  const message = "The PostgreSQL connection string is not valid.";
  const remainder = source.slice(schemeEnd + 3);
  const pathEnd = [remainder.indexOf("/"), remainder.indexOf("?")]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), remainder.length);
  const {
    username: urlUsername,
    password: urlPassword,
    hostList,
  } = splitUserInfo(remainder.slice(0, pathEnd), message);
  const suffix = remainder.slice(pathEnd);
  const queryStart = suffix.indexOf("?");
  const path = queryStart < 0 ? suffix : suffix.slice(0, queryStart);
  const options = readQueryOptions(
    queryStart < 0 ? "" : suffix.slice(queryStart + 1),
    message,
  );

  let username = urlUsername;
  let password = urlPassword;
  let hostText = hostList;
  let portOverride = "";
  let tls = false;
  const extraOptions: string[] = [];
  for (const [key, value] of options) {
    const name = key.toLowerCase();
    if (name === "sslmode") {
      if (!POSTGRES_SSL_MODES.has(value))
        throw new Error(
          "The sslmode in the PostgreSQL connection string is invalid.",
        );
      tls = value !== "disable";
      if (value === "no-verify") extraOptions.push(key);
    } else if (name === "ssl") {
      tls = TRUE_OPTION.test(value) || value === "no-verify";
      if (value === "no-verify") extraOptions.push(key);
    } else if (name === "user") username = value;
    else if (name === "password") password = value;
    else if (name === "host") hostText = value;
    else if (name === "port") portOverride = value;
    else extraOptions.push(key);
  }

  if (!hostText || hostText.includes(","))
    throw new Error(
      hostText
        ? "Rowfish connects to one PostgreSQL host at a time; remove the extra hosts."
        : "Connection strings must include a server host.",
    );
  let hostname = hostText;
  let portText = portOverride;
  if (hostText.startsWith("[")) {
    const closingBracket = hostText.indexOf("]");
    const rest = closingBracket < 0 ? "" : hostText.slice(closingBracket + 1);
    if (closingBracket < 0 || (rest && !rest.startsWith(":")))
      throw new Error(
        "The host in the PostgreSQL connection string is invalid.",
      );
    hostname = hostText.slice(1, closingBracket);
    if (rest) {
      if (rest.length === 1)
        throw new Error(
          "The port in the PostgreSQL connection string is invalid.",
        );
      portText ||= rest.slice(1);
    }
  } else if (hostText.includes(":")) {
    const colon = hostText.lastIndexOf(":");
    if (hostText.indexOf(":") !== colon)
      throw new Error(
        "IPv6 hosts in PostgreSQL connection strings must be enclosed in brackets.",
      );
    hostname = hostText.slice(0, colon);
    if (colon === hostText.length - 1)
      throw new Error(
        "The port in the PostgreSQL connection string is invalid.",
      );
    portText ||= hostText.slice(colon + 1);
  }
  hostname = decodeConnectionPart(hostname, message);
  if (!hostname || /[\s/@?#\\,]/.test(hostname) || hostname.length > 253)
    throw new Error("The host in the PostgreSQL connection string is invalid.");
  if (portText && !/^\d{1,5}$/.test(portText))
    throw new Error("The port in the PostgreSQL connection string is invalid.");
  const port = portText ? Number(portText) : 5_432;
  if (port < 1 || port > 65_535)
    throw new Error("The port in the PostgreSQL connection string is invalid.");

  const databasePath = path.replace(/^\//, "");
  if (databasePath.includes("/"))
    throw new Error(
      "PostgreSQL connection strings must include at most one database name.",
    );
  const database = databasePath
    ? decodeConnectionPart(databasePath, message)
    : "";
  if (database.length > 128 || /[\0-\x1f\x7f]/.test(database))
    throw new Error(
      "The database name in the PostgreSQL connection string is invalid or too long.",
    );
  if (username.length > 512 || /[\0-\x1f\x7f]/.test(username))
    throw new Error(
      "The username in the PostgreSQL connection string is invalid.",
    );
  if (password.length > 1_024 || password.includes("\0"))
    throw new Error(
      "The password in the PostgreSQL connection string is invalid.",
    );
  return {
    host: hostname,
    port,
    database,
    username,
    password,
    tls,
    extraOptions,
    representable: extraOptions.length === 0,
  };
}

/** Builds a PostgreSQL URI from the dialog's connection fields. */
export function buildPostgresConnectionString(fields: {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  tls: boolean;
}): string {
  const database = fields.database
    ? `/${encodeURIComponent(fields.database)}`
    : "";
  const options = fields.tls ? "?sslmode=verify-full" : "";
  return `postgresql://${formatUserInfo(fields.username, fields.password)}${formatUrlHost(fields.host)}:${fields.port}${database}${options}`;
}

/** Returns the PostgreSQL connection string pointed at another database. */
export function withPostgresDatabase(source: string, database: string): string {
  const schemeEnd = source.indexOf("://");
  const remainder = source.slice(schemeEnd + 3);
  const pathEnd = [remainder.indexOf("/"), remainder.indexOf("?")]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), remainder.length);
  const queryStart = remainder.indexOf("?", pathEnd);
  const query = queryStart < 0 ? "" : remainder.slice(queryStart);
  return `${source.slice(0, schemeEnd + 3)}${remainder.slice(0, pathEnd)}/${encodeURIComponent(database)}${query}`;
}

/** Hides the password in a connection string for on-screen previews. */
export function maskConnectionStringPassword(source: string): string {
  const schemeEnd = source.indexOf("://");
  if (schemeEnd < 0) return source;
  const remainder = source.slice(schemeEnd + 3);
  const pathEnd = [remainder.indexOf("/"), remainder.indexOf("?")]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), remainder.length);
  const authority = remainder.slice(0, pathEnd);
  const at = authority.lastIndexOf("@");
  const colon = authority.indexOf(":");
  const maskedAuthority =
    at >= 0 && colon >= 0 && colon < at
      ? `${authority.slice(0, colon)}:••••••${authority.slice(at)}`
      : authority;
  const maskedQuery = remainder
    .slice(pathEnd)
    .replace(/([?&]password=)[^&]*/gi, "$1••••••");
  return `${source.slice(0, schemeEnd + 3)}${maskedAuthority}${maskedQuery}`;
}

export function parseMongoConnectionString(
  source: string,
): MongoConnectionDetails {
  if (!source || source.length > 4_096 || /[\0-\x20\x7f]/.test(source)) {
    throw new Error("Enter a valid MongoDB connection string.");
  }
  const schemeEnd = source.indexOf("://");
  const scheme = schemeEnd < 0 ? "" : source.slice(0, schemeEnd).toLowerCase();
  if (
    (scheme !== "mongodb" && scheme !== "mongodb+srv") ||
    source.includes("#")
  ) {
    throw new Error(
      "Connection strings must start with mongodb:// or mongodb+srv:// and include a server host.",
    );
  }

  const remainder = source.slice(schemeEnd + 3);
  const pathEnd = [remainder.indexOf("/"), remainder.indexOf("?")]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), remainder.length);
  const authority = remainder.slice(0, pathEnd);
  const suffix = remainder.slice(pathEnd);
  const hostList = authority.slice(authority.lastIndexOf("@") + 1);
  const hosts = hostList.split(",");
  if (!hostList || hosts.some((host) => !host)) {
    throw new Error("Connection strings must include a server host.");
  }

  let firstPort = 27_017;
  const normalizedHosts = hosts.map((host, index) => {
    let hostname = "";
    let portText = "";
    let hasPort = false;
    if (host.startsWith("[")) {
      const closingBracket = host.indexOf("]");
      if (closingBracket < 0)
        throw new Error(
          "The host in the MongoDB connection string is invalid.",
        );
      hostname = host.slice(0, closingBracket + 1);
      const rest = host.slice(closingBracket + 1);
      if (rest && !rest.startsWith(":"))
        throw new Error(
          "The host in the MongoDB connection string is invalid.",
        );
      hasPort = Boolean(rest);
      portText = rest.slice(1);
    } else {
      const colon = host.lastIndexOf(":");
      if (colon >= 0) {
        if (host.indexOf(":") !== colon)
          throw new Error(
            "IPv6 hosts in MongoDB connection strings must be enclosed in brackets.",
          );
        hostname = host.slice(0, colon);
        hasPort = true;
        portText = host.slice(colon + 1);
      } else {
        hostname = host;
      }
    }
    if (!hostname || /[\s/@?#\\,]/.test(hostname))
      throw new Error("The host in the MongoDB connection string is invalid.");
    if (hasPort && !portText)
      throw new Error("The port in the MongoDB connection string is invalid.");
    if (portText && !/^\d{1,5}$/.test(portText))
      throw new Error("The port in the MongoDB connection string is invalid.");
    const port = portText ? Number(portText) : 27_017;
    if (port < 1 || port > 65_535)
      throw new Error("The port in the MongoDB connection string is invalid.");
    if (scheme === "mongodb+srv" && (hosts.length > 1 || hasPort)) {
      throw new Error(
        "MongoDB SRV connection strings must use one host and must not specify a port.",
      );
    }
    if (index === 0) firstPort = port;
    return hostname;
  });

  const path = suffix.split("?")[0] ?? "";
  const databasePath = path.split("/").filter(Boolean);
  if (databasePath.length > 1)
    throw new Error(
      "MongoDB connection strings must include at most one database name.",
    );
  let database = "admin";
  if (databasePath.length === 1) {
    try {
      database = decodeURIComponent(databasePath[0]!);
    } catch {
      throw new Error(
        "The database name in the MongoDB connection string is invalid.",
      );
    }
  }
  if (database.length > 128 || /[\0-\x1f\x7f]/.test(database)) {
    throw new Error(
      "The database name in the MongoDB connection string is invalid or too long.",
    );
  }
  return { host: normalizedHosts.join(","), port: firstPort, database };
}

function containsWhereOperator(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsWhereOperator);
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => key === "$where" || containsWhereOperator(child),
  );
}

export function parseMongoFilter(source: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      'MongoDB filter must be a JSON object, for example: {"status":"active"}.',
    );
  }
  if (containsWhereOperator(parsed)) {
    throw new Error(
      "The $where JavaScript operator is disabled; use indexed MongoDB filter operators instead.",
    );
  }
  return parsed as Record<string, unknown>;
}

export function parseMongoPipeline(source: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(source);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (stage) =>
        !stage ||
        typeof stage !== "object" ||
        Array.isArray(stage) ||
        Object.keys(stage).length === 0,
    )
  ) {
    throw new Error(
      "MongoDB aggregation must be a JSON array of pipeline stage objects.",
    );
  }
  const forbidden = new Set([
    "$where",
    "$function",
    "$accumulator",
    "$out",
    "$merge",
  ]);
  const containsForbidden = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsForbidden);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nested]) => forbidden.has(key) || containsForbidden(nested),
    );
  };
  if (containsForbidden(parsed))
    throw new Error(
      "Aggregation pipelines cannot use $where, server-side JavaScript, $out or $merge.",
    );
  return parsed as Record<string, unknown>[];
}

export function getVirtualRowRange(
  totalRows: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = 36,
  overscan = 8,
): VirtualRowRange {
  const total = Math.max(0, Math.floor(totalRows));
  const safeRowHeight = Math.max(1, rowHeight);
  const safeTop = Math.max(0, scrollTop);
  const safeViewport = Math.max(0, viewportHeight);
  const start = Math.min(
    total,
    Math.max(0, Math.floor(safeTop / safeRowHeight) - Math.max(0, overscan)),
  );
  const end = Math.min(
    total,
    Math.ceil((safeTop + safeViewport) / safeRowHeight) + Math.max(0, overscan),
  );
  return { start, end: Math.max(start, end) };
}
