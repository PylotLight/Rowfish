import { describe, expect, test } from "bun:test";
import {
  DATABASE_LIMITS,
  getVirtualRowRange,
  buildMongoConnectionString,
  buildPostgresConnectionString,
  detectConnectionStringKind,
  isValidRowLimit,
  maskConnectionStringPassword,
  parseMongoConnectionFields,
  parseMongoConnectionString,
  parsePostgresConnectionString,
  withPostgresDatabase,
  parseMongoFilter,
  parseMongoPipeline,
  quotePostgresIdentifier,
} from "./database-helpers";

describe("database query guards", () => {
  test("quotes table-browser identifiers without allowing SQL injection", () => {
    expect(quotePostgresIdentifier("sales")).toBe('"sales"');
    expect(quotePostgresIdentifier('odd"; DROP TABLE users;--')).toBe(
      '"odd""; DROP TABLE users;--"',
    );
  });

  test("parses MongoDB direct and SRV connection strings without exposing credentials", () => {
    expect(
      parseMongoConnectionString(
        "mongodb://user:secret@db.example:27018/rowfish?authSource=admin",
      ),
    ).toEqual({
      host: "db.example",
      port: 27018,
      database: "rowfish",
    });
    expect(
      parseMongoConnectionString("mongodb+srv://user:secret@cluster.example/"),
    ).toEqual({
      host: "cluster.example",
      port: 27017,
      database: "admin",
    });
    expect(
      parseMongoConnectionString(
        "mongodb://db-a.example:27018,db-b.example:27019/rowfish?replicaSet=rs0",
      ),
    ).toEqual({
      host: "db-a.example,db-b.example",
      port: 27018,
      database: "rowfish",
    });
    expect(() =>
      parseMongoConnectionString("https://db.example/rowfish"),
    ).toThrow("mongodb://");
    expect(() =>
      parseMongoConnectionString("mongodb+srv://cluster.example:27017/db"),
    ).toThrow("must not specify a port");
  });

  test("parses PostgreSQL connection strings into dialog fields", () => {
    expect(
      parsePostgresConnectionString(
        "postgresql://app%40corp:p%40ss%3Aword@db.example:6543/sales%20db?sslmode=require",
      ),
    ).toEqual({
      host: "db.example",
      port: 6543,
      database: "sales db",
      username: "app@corp",
      password: "p@ss:word",
      tls: true,
      extraOptions: [],
      representable: true,
    });
    expect(parsePostgresConnectionString("postgres://localhost")).toEqual({
      host: "localhost",
      port: 5432,
      database: "",
      username: "",
      password: "",
      tls: false,
      extraOptions: [],
      representable: true,
    });
    expect(
      parsePostgresConnectionString(
        "postgres://u@[::1]:5433/app?sslmode=disable&application_name=cli&connect_timeout=5",
      ),
    ).toMatchObject({
      host: "::1",
      port: 5433,
      database: "app",
      username: "u",
      tls: false,
      extraOptions: ["application_name", "connect_timeout"],
      representable: false,
    });
    expect(
      parsePostgresConnectionString(
        "postgres://db.example/app?user=alice&password=s3cret&port=7000",
      ),
    ).toMatchObject({ username: "alice", password: "s3cret", port: 7000 });
    expect(
      parsePostgresConnectionString("postgres://db.example/app?ssl=true").tls,
    ).toBe(true);
  });

  test("rejects malformed PostgreSQL connection strings", () => {
    expect(() =>
      parsePostgresConnectionString("mysql://db.example/app"),
    ).toThrow("postgres://");
    expect(() => parsePostgresConnectionString("postgres:///app")).toThrow(
      "server host",
    );
    expect(() =>
      parsePostgresConnectionString("postgres://db.example:99999/app"),
    ).toThrow("port");
    expect(() =>
      parsePostgresConnectionString("postgres://db.example:/app"),
    ).toThrow("port");
    expect(() =>
      parsePostgresConnectionString("postgres://a.example,b.example/app"),
    ).toThrow("one PostgreSQL host");
    expect(() =>
      parsePostgresConnectionString("postgres://db.example/a/b"),
    ).toThrow("at most one database");
    expect(() =>
      parsePostgresConnectionString("postgres://db.example/app?sslmode=maybe"),
    ).toThrow("sslmode");
    expect(() =>
      parsePostgresConnectionString("postgres://db.example/app with space"),
    ).toThrow("valid PostgreSQL");
    expect(() => parsePostgresConnectionString("postgres://::1/app")).toThrow(
      "brackets",
    );
  });

  test("round-trips dialog fields through generated connection strings", () => {
    const fields = {
      host: "db.example",
      port: 5432,
      database: "sales/eu",
      username: "app user",
      password: "p@ss:/?#word",
      tls: true,
    };
    const postgres = buildPostgresConnectionString(fields);
    expect(postgres).toBe(
      "postgresql://app%20user:p%40ss%3A%2F%3F%23word@db.example:5432/sales%2Feu?sslmode=verify-full",
    );
    expect(parsePostgresConnectionString(postgres)).toMatchObject({
      ...fields,
      representable: true,
    });
    expect(
      buildPostgresConnectionString({
        ...fields,
        host: "::1",
        database: "",
        username: "",
        tls: false,
      }),
    ).toBe("postgresql://[::1]:5432");

    const mongo = buildMongoConnectionString({ ...fields, database: "app" });
    expect(mongo).toBe(
      "mongodb://app%20user:p%40ss%3A%2F%3F%23word@db.example:5432/app?authSource=app&tls=true",
    );
    expect(parseMongoConnectionFields(mongo)).toEqual({
      ...fields,
      database: "app",
      extraOptions: [],
      representable: true,
    });
  });

  test("reports MongoDB string options the dialog fields cannot express", () => {
    expect(
      parseMongoConnectionFields(
        "mongodb+srv://user:secret@cluster.example/app?retryWrites=true&w=majority",
      ),
    ).toEqual({
      host: "cluster.example",
      port: 27017,
      database: "app",
      username: "user",
      password: "secret",
      tls: true,
      extraOptions: ["retryWrites", "w"],
      representable: false,
    });
    expect(
      parseMongoConnectionFields("mongodb://a.example,b.example/app")
        .representable,
    ).toBe(false);
  });

  test("masks passwords and swaps databases in connection strings", () => {
    expect(
      maskConnectionStringPassword(
        "postgresql://alice:s3cret@db.example:5432/app?password=other&sslmode=require",
      ),
    ).toBe(
      "postgresql://alice:••••••@db.example:5432/app?password=••••••&sslmode=require",
    );
    expect(maskConnectionStringPassword("mongodb://alice@db.example/app")).toBe(
      "mongodb://alice@db.example/app",
    );
    expect(
      withPostgresDatabase(
        "postgres://alice:s3cret@db.example/postgres?sslmode=require",
        "sales db",
      ),
    ).toBe("postgres://alice:s3cret@db.example/sales%20db?sslmode=require");
    expect(withPostgresDatabase("postgres://db.example", "app")).toBe(
      "postgres://db.example/app",
    );
  });

  test("accepts only whole row limits inside the configured bounds", () => {
    expect(isValidRowLimit(DATABASE_LIMITS.minRows)).toBe(true);
    expect(isValidRowLimit(DATABASE_LIMITS.maxRows)).toBe(true);
    expect(isValidRowLimit(0)).toBe(false);
    expect(isValidRowLimit(DATABASE_LIMITS.maxRows + 1)).toBe(false);
    expect(isValidRowLimit(1.5)).toBe(false);
    expect(isValidRowLimit("100")).toBe(false);
  });

  test("accepts a MongoDB document filter", () => {
    expect(parseMongoFilter('{"status":"active","rank":{"$gte":3}}')).toEqual({
      status: "active",
      rank: { $gte: 3 },
    });
  });

  test("rejects MongoDB scalar/array filters and nested JavaScript execution", () => {
    expect(() => parseMongoFilter("[]")).toThrow("must be a JSON object");
    expect(() => parseMongoFilter('"active"')).toThrow("must be a JSON object");
    expect(() =>
      parseMongoFilter(
        '{"$or":[{"status":"active"},{"$where":"return true"}]}',
      ),
    ).toThrow("$where");
  });

  test("accepts read-only MongoDB aggregation pipelines and blocks writes or server-side JavaScript", () => {
    expect(
      parseMongoPipeline('[{"$match":{"status":"active"}},{"$limit":20}]'),
    ).toEqual([{ $match: { status: "active" } }, { $limit: 20 }]);
    expect(() => parseMongoPipeline("{}")).toThrow(
      "array of pipeline stage objects",
    );
    expect(() => parseMongoPipeline('[{"$out":"archive"}]')).toThrow("$out");
    expect(() =>
      parseMongoPipeline('[{"$facet":{"items":[{"$merge":"archive"}]}}]'),
    ).toThrow("$merge");
    expect(() =>
      parseMongoPipeline(
        '[{"$project":{"computed":{"$function":{"body":"return 1"}}}}]',
      ),
    ).toThrow("server-side JavaScript");
  });
});

describe("virtual result window", () => {
  test("keeps the rendered slice bounded and adds overscan around the viewport", () => {
    expect(getVirtualRowRange(10_000, 0, 360)).toEqual({ start: 0, end: 18 });
    expect(getVirtualRowRange(10_000, 180_000, 360)).toEqual({
      start: 4_992,
      end: 5_018,
    });
    expect(getVirtualRowRange(3, 99_999, 360)).toEqual({ start: 3, end: 3 });
  });

  test("normalizes negative positions and dimensions", () => {
    expect(getVirtualRowRange(-1, -10, -20, 0, -1)).toEqual({
      start: 0,
      end: 0,
    });
  });
});

describe("connection string kind detection", () => {
  test("detects PostgreSQL and MongoDB from the scheme", () => {
    expect(detectConnectionStringKind("postgres://u@h/db")).toBe("postgres");
    expect(detectConnectionStringKind("postgresql://h")).toBe("postgres");
    expect(detectConnectionStringKind("PostgreSQL://h")).toBe("postgres");
    expect(detectConnectionStringKind("mongodb://h:27017/app")).toBe("mongodb");
    expect(detectConnectionStringKind("mongodb+srv://c.example/app")).toBe(
      "mongodb",
    );
    expect(detectConnectionStringKind("  mongodb://h")).toBe("mongodb");
  });

  test("returns null for empty, partial or unsupported schemes", () => {
    expect(detectConnectionStringKind("")).toBeNull();
    expect(detectConnectionStringKind("postgres")).toBeNull();
    expect(detectConnectionStringKind("postgres:/h")).toBeNull();
    expect(detectConnectionStringKind("mysql://h/db")).toBeNull();
    expect(detectConnectionStringKind("not-a-connection-string")).toBeNull();
    expect(detectConnectionStringKind("mongo://h")).toBeNull();
  });
});
