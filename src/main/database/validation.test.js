import { describe, expect, test } from "bun:test";
import { validateConnectionInput } from "./validation.ts";

const sqliteInput = (overrides = {}) => ({
  name: "Local SQLite",
  kind: "sqlite",
  database: "/tmp/rowfish-test.db",
  host: "",
  port: 0,
  username: "",
  password: "",
  tls: false,
  serverMode: false,
  ...overrides,
});

describe("SQLite connection validation", () => {
  test("accepts an absolute database-file path and removes network credentials", () => {
    expect(validateConnectionInput(sqliteInput())).toMatchObject({
      name: "Local SQLite",
      kind: "sqlite",
      database: "/tmp/rowfish-test.db",
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
