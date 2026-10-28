import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { validateConnectionInput } from "./validation.ts";

const sqliteInput = (overrides = {}) => ({
  name: "Local SQLite",
  kind: "sqlite",
  database: resolve("rowfish-test.db"),
  host: "remote.example",
  port: 5432,
  username: "rowfish-user",
  password: "actual-db-secret",
  tls: true,
  serverMode: false,
  ...overrides,
});

describe("SQLite connection validation", () => {
  test("accepts an absolute path and strips network-only settings", () => {
    expect(validateConnectionInput(sqliteInput())).toMatchObject({
      name: "Local SQLite",
      kind: "sqlite",
      database: resolve("rowfish-test.db"),
      host: "",
      port: 0,
      username: "",
      password: "",
      tls: false,
      serverMode: false,
    });
  });

  test("rejects relative paths, server browsing, and connection strings", () => {
    expect(() =>
      validateConnectionInput(sqliteInput({ database: "data.db" })),
    ).toThrow("absolute path");
    expect(() =>
      validateConnectionInput(sqliteInput({ serverMode: true })),
    ).toThrow("local database file");
    expect(() =>
      validateConnectionInput(
        sqliteInput({ connectionString: "sqlite:///data.db" }),
      ),
    ).toThrow("local database file");
  });
});
