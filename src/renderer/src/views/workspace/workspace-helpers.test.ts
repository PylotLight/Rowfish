import { describe, expect, test } from "bun:test";
import type {
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
} from "../../../../shared/database";
import {
  buildConnectionString,
  canSwitchDatabase,
  connectionSubline,
  DEFAULT_FORM,
  dialogErrorMessage,
  kindDefaults,
  kindLabel,
  mongoBrowserKey,
  parseConnectionStringFields,
} from "./workspace-helpers";

function postgresForm(
  overrides: Partial<DatabaseConnectionInput> = {},
): DatabaseConnectionInput {
  return { ...DEFAULT_FORM, ...overrides };
}

function summary(
  overrides: Partial<DatabaseConnectionSummary> = {},
): DatabaseConnectionSummary {
  return {
    id: "conn-1",
    name: "Local",
    kind: "postgres",
    host: "localhost",
    port: 5432,
    database: "postgres",
    connectedAt: 0,
    ...overrides,
  };
}

describe("connection string round-trip", () => {
  test("postgres with an explicit sslmode keeps every field", () => {
    const form = postgresForm({
      host: "db.example.com",
      port: 5433,
      database: "app",
      username: "alice",
      password: "s3cr3t",
      tls: true,
      sslMode: "verify-full",
    });
    const fields = parseConnectionStringFields(
      "postgres",
      buildConnectionString(form),
    );
    expect(fields.host).toBe("db.example.com");
    expect(fields.port).toBe(5433);
    expect(fields.database).toBe("app");
    expect(fields.username).toBe("alice");
    expect(fields.password).toBe("s3cr3t");
    expect(fields.tls).toBe(true);
    expect(fields.sslMode).toBe("verify-full");
    expect(fields.representable).toBe(true);
  });

  test("postgres with the default sslmode omits it and parses back to prefer", () => {
    const form = postgresForm({
      host: "localhost",
      port: 5432,
      database: "postgres",
      username: "postgres",
      password: "",
      tls: false,
      sslMode: "prefer",
    });
    const built = buildConnectionString(form);
    expect(built).not.toContain("sslmode");
    const fields = parseConnectionStringFields("postgres", built);
    expect(fields.sslMode).toBe("prefer");
    expect(fields.tls).toBe(false);
  });

  test("postgres in server mode drops the database from the string", () => {
    const form = postgresForm({ serverMode: true, database: "anything" });
    const built = buildConnectionString(form);
    const afterScheme = built.slice(built.indexOf("//") + 2);
    expect(afterScheme).not.toContain("/");
    expect(parseConnectionStringFields("postgres", built).database).toBe("");
  });

  test("mongo keeps auth source and tls through the round-trip", () => {
    const form = postgresForm({
      kind: "mongodb",
      host: "mongo.local",
      port: 27017,
      database: "shop",
      username: "bob",
      password: "pw",
      tls: true,
    });
    const fields = parseConnectionStringFields(
      "mongodb",
      buildConnectionString(form),
    );
    expect(fields.host).toBe("mongo.local");
    expect(fields.port).toBe(27017);
    expect(fields.database).toBe("shop");
    expect(fields.username).toBe("bob");
    expect(fields.password).toBe("pw");
    expect(fields.tls).toBe(true);
    expect(fields.representable).toBe(true);
  });

  test("SQLite file connections do not generate a connection URI", () => {
    expect(
      buildConnectionString(
        postgresForm({ kind: "sqlite", database: "/tmp/local.db" }),
      ),
    ).toBe("");
  });
});

describe("dialog field helpers", () => {
  test("kindDefaults matches each driver's default port and database", () => {
    expect(kindDefaults("postgres")).toEqual({
      port: 5432,
      database: "postgres",
    });
    expect(kindDefaults("mongodb")).toEqual({ port: 27017, database: "admin" });
    expect(kindDefaults("sqlite")).toEqual({ port: 0, database: "" });
  });

  test("kindLabel names the engine", () => {
    expect(kindLabel("postgres")).toBe("PostgreSQL");
    expect(kindLabel("mongodb")).toBe("MongoDB");
    expect(kindLabel("sqlite")).toBe("SQLite");
  });

  test("connectionSubline describes the connection target", () => {
    expect(connectionSubline(summary())).toBe("PostgreSQL · postgres");
    expect(
      connectionSubline(summary({ kind: "sqlite", database: "/tmp/local.db" })),
    ).toBe("SQLite · /tmp/local.db");
    expect(
      connectionSubline(summary({ kind: "mongodb", database: "shop" })),
    ).toBe("MongoDB · shop");
    expect(
      connectionSubline(
        summary({ serverMode: true, host: "db", port: 5433, database: "" }),
      ),
    ).toBe("PostgreSQL · db:5433 · all databases");
  });

  test("canSwitchDatabase is only for plain PostgreSQL connections", () => {
    expect(canSwitchDatabase(summary())).toBe(true);
    expect(canSwitchDatabase(summary({ serverMode: true }))).toBe(false);
    expect(canSwitchDatabase(summary({ kind: "mongodb" }))).toBe(false);
    expect(canSwitchDatabase(summary({ parentConnectionId: "conn-1" }))).toBe(
      false,
    );
  });

  test("mongoBrowserKey namespaces the browser state per database", () => {
    expect(mongoBrowserKey("conn-1", "shop")).toBe("conn-1::shop");
  });

  test("dialogErrorMessage strips Electron's IPC prefix and falls back", () => {
    expect(
      dialogErrorMessage(
        new Error("Error invoking remote method 'db.connect': Error: timeout"),
        "Failed",
      ),
    ).toBe("timeout");
    expect(
      dialogErrorMessage(
        new Error("Error invoking remote method 'db.connect': timeout"),
        "Failed",
      ),
    ).toBe("timeout");
    expect(dialogErrorMessage(new Error("plain message"), "Failed")).toBe(
      "plain message",
    );
    expect(dialogErrorMessage(new Error(""), "Failed")).toBe("Failed");
    expect(dialogErrorMessage("a plain string", "Failed")).toBe("Failed");
    expect(dialogErrorMessage(null, "Failed")).toBe("Failed");
  });
});
