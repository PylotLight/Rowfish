import { describe, expect, test } from "bun:test";
import {
  exportResultsCsv,
  exportResultsJson,
  getSqlStatement,
  loadQueryWorkspace,
  makeQueryTab,
  queryConnectionKey,
  saveQueryWorkspace,
  type QueryWorkspaceState,
} from "./query-workspace";

const memoryStorage = (initial = "") => {
  let value = initial;
  return {
    getItem: (_key: string) => value || null,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
};

describe("query workspace persistence", () => {
  test("round-trips state and ignores storage failures", () => {
    const tab = makeQueryTab(
      "postgres",
      "postgres|localhost|5432|db",
      "select 1",
      "Example",
    );
    const state: QueryWorkspaceState = {
      tabs: [tab],
      activeTabId: tab.id,
      saved: [],
      history: [],
    };
    const storage = memoryStorage();
    expect(saveQueryWorkspace(state, storage)).toBe(true);
    expect(loadQueryWorkspace(storage)).toEqual(state);
    expect(
      loadQueryWorkspace({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual({ tabs: [], activeTabId: null, saved: [], history: [] });
    expect(
      saveQueryWorkspace(state, {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).toBe(false);
  });
  test("rejects corrupt data, clamps collections, and validates active tabs", () => {
    expect(loadQueryWorkspace(memoryStorage("{not json")).tabs).toEqual([]);
    const tabs = Array.from({ length: 130 }, (_, i) => ({
      id: `${i}`,
      title: "T",
      query: "x",
      kind: "postgres",
      connectionKey: "",
      updatedAt: i,
    }));
    const storage = memoryStorage(
      JSON.stringify({
        tabs,
        saved: [null, { id: "bad" }],
        history: [],
        activeTabId: "not-present",
      }),
    );
    const state = loadQueryWorkspace(storage);
    expect(state.tabs).toHaveLength(100);
    expect(state.saved).toEqual([]);
    expect(state.activeTabId).toBeNull();
  });
  test("connection key does not contain credentials and distinguishes databases", () => {
    const key = queryConnectionKey({
      id: "secret-id",
      name: "db",
      kind: "postgres",
      host: "LOCALHOST",
      port: 5432,
      database: "app",
      connectedAt: 0,
    });
    expect(key).toBe("session%3Asecret-id|postgres|localhost|5432|app");
    expect(key).not.toContain("password");
    const base = {
      id: "runtime",
      name: "db",
      kind: "postgres" as const,
      host: "localhost",
      port: 5432,
      database: "app",
      connectedAt: 0,
    };
    expect(
      queryConnectionKey({ ...base, savedConnectionId: "profile-a" }),
    ).not.toBe(queryConnectionKey({ ...base, savedConnectionId: "profile-b" }));
  });
});

describe("exports", () => {
  test("CSV quotes and escapes cells, protects formulas and preserves null as empty", () => {
    expect(
      exportResultsCsv(
        ["a", "b", "c", "d"],
        [{ a: "hello, world", b: 'say "hi"', c: null, d: "=1+1" }],
      ),
    ).toBe('a,b,c,d\r\n"hello, world","say ""hi""",,\'=1+1');
    expect(exportResultsCsv(["x"], [{ x: "line1\nline2" }])).toBe(
      'x\r\n"line1\nline2"',
    );
  });
  test("JSON export retains null values", () => {
    expect(exportResultsJson([{ value: null }])).toBe(
      '[\n  {\n    "value": null\n  }\n]',
    );
  });
});

describe("SQL statement selection", () => {
  test("splits statements but ignores semicolons in strings, identifiers, comments and dollar quotes", () => {
    const sql =
      "select 'a;b', \"x;y\"; -- ; ignored\nselect $$body; text$$; select 3;";
    expect(getSqlStatement(sql, 4)).toBe("select 'a;b', \"x;y\"");
    expect(getSqlStatement(sql, sql.indexOf("text"))).toBe(
      "-- ; ignored\nselect $$body; text$$",
    );
    expect(getSqlStatement(sql, sql.indexOf("select 3"))).toBe("select 3");
  });
  test("handles cursor bounds and trailing statements", () => {
    expect(getSqlStatement(" select 1; select 2  ", 999)).toBe("select 2");
    expect(getSqlStatement("select 1;", -10)).toBe("select 1");
  });
});

test("statement selection follows PostgreSQL backslash rules", () => {
  expect(getSqlStatement("SELECT 'a\\'; SELECT 2;", 3)).toBe("SELECT 'a\\'");
  expect(getSqlStatement("SELECT E'a\\';b'; SELECT 2;", 3)).toBe(
    "SELECT E'a\\';b'",
  );
});

test("SQLite statement selection keeps trigger bodies and bracket names intact", () => {
  const sql =
    "SELECT [semi;colon]; CREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO audit VALUES ('a;b'); END; SELECT 3;";
  expect(getSqlStatement(sql, sql.indexOf("INSERT INTO audit"), "sqlite")).toBe(
    "CREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO audit VALUES ('a;b'); END",
  );
  expect(getSqlStatement(sql, sql.indexOf("SELECT 3"), "sqlite")).toBe(
    "SELECT 3",
  );
});
