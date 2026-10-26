import { describe, expect, test } from "bun:test";
import {
  splitPostgresStatements,
  splitSqliteStatements,
} from "./sql-statements";

describe("splitPostgresStatements", () => {
  test("splits ordinary statements and ignores empty segments", () => {
    expect(splitPostgresStatements(" ; SELECT 1; SELECT 2 ;;")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });
  test("keeps semicolons in quoted literals and identifiers", () => {
    expect(
      splitPostgresStatements(
        `SELECT ';' AS a, "semi;colon"; SELECT 'it''s; ok'`,
      ),
    ).toEqual([`SELECT ';' AS a, "semi;colon"`, `SELECT 'it''s; ok'`]);
  });
  test("handles E strings with escaped quotes and backslashes", () => {
    expect(
      splitPostgresStatements(String.raw`SELECT E'one\';two'; SELECT 3`),
    ).toEqual([String.raw`SELECT E'one\';two'`, "SELECT 3"]);
  });
  test("handles tagged and untagged dollar-quoted bodies", () => {
    expect(
      splitPostgresStatements(
        "DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$; SELECT $$a;b$$",
      ),
    ).toEqual([
      "DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$",
      "SELECT $$a;b$$",
    ]);
  });
  test("handles line comments and nested block comments", () => {
    expect(
      splitPostgresStatements(
        "SELECT 1 /* ; /* nested ; */ end */; -- ; ignored\nSELECT 2",
      ),
    ).toEqual([
      "SELECT 1 /* ; /* nested ; */ end */",
      "-- ; ignored\nSELECT 2",
    ]);
  });
});

test("rejects incomplete script before executing earlier statements", () => {
  expect(() => splitPostgresStatements("SELECT 1; SELECT 'unfinished")).toThrow(
    "Unterminated",
  );
  expect(() => splitPostgresStatements("SELECT 1; /* missing close")).toThrow(
    "Unterminated",
  );
});

test("ignores trailing comments and comment-only segments", () => {
  expect(splitPostgresStatements("/* info */; SELECT 1; -- end")).toEqual([
    "SELECT 1",
  ]);
});

describe("splitSqliteStatements", () => {
  test("keeps semicolons in strings, quoted identifiers, comments, and trigger bodies", () => {
    expect(
      splitSqliteStatements(
        `SELECT 'a;b', [semi;colon]; -- ignored ;\nCREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO audit VALUES ('one;two'); UPDATE x SET v = CASE WHEN v = 1 THEN 2 ELSE 3 END; END; SELECT 3;`,
      ),
    ).toEqual([
      "SELECT 'a;b', [semi;colon]",
      "-- ignored ;\nCREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO audit VALUES ('one;two'); UPDATE x SET v = CASE WHEN v = 1 THEN 2 ELSE 3 END; END",
      "SELECT 3",
    ]);
  });

  test("keeps trigger bodies intact when comments separate CREATE and TRIGGER", () => {
    expect(
      splitSqliteStatements(
        "CREATE /* comment */ TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO audit VALUES (1); END; SELECT 2;",
      ),
    ).toEqual([
      "CREATE /* comment */ TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO audit VALUES (1); END",
      "SELECT 2",
    ]);
  });

  test("rejects unterminated SQLite literals and comments", () => {
    expect(() => splitSqliteStatements("SELECT 'unfinished")).toThrow(
      "Unterminated",
    );
    expect(() => splitSqliteStatements("SELECT 1; /* missing close")).toThrow(
      "Unterminated",
    );
  });
});
