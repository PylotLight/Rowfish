import { describe, expect, test } from "bun:test";
import {
  assertCompletePrimaryKey,
  buildRowUpdate,
  quoteIdentifier,
  validateRowRequest,
} from "./postgres-row-edit";

describe("PostgreSQL row-edit request helpers", () => {
  test("requires exact complete non-null primary keys", () => {
    expect(() =>
      assertCompletePrimaryKey({ id: "1" }, ["id", "tenant"]),
    ).toThrow();
    expect(() => assertCompletePrimaryKey({ id: null }, ["id"])).toThrow();
    expect(() =>
      assertCompletePrimaryKey({ id: "1", extra: "x" }, ["id"]),
    ).toThrow();
    expect(() => assertCompletePrimaryKey({ id: "1" }, ["id"])).not.toThrow();
  });
  test("quotes identifiers and emits xmin concurrency SQL", () => {
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
    expect(buildRowUpdate("s", "t", ["id"], ["value"])).toContain(
      "xmin::text = $3",
    );
  });
  test("validates request objects and rejects malformed cells", () => {
    expect(
      validateRowRequest({
        connectionId: "c",
        schema: "s",
        table: "t",
        key: { id: "1" },
      }),
    ).toMatchObject({ schema: "s" });
    expect(() =>
      validateRowRequest({
        connectionId: "c",
        schema: "s",
        table: "t",
        key: { id: {} },
      }),
    ).toThrow();
    expect(() =>
      validateRowRequest(
        {
          connectionId: "c",
          schema: "s",
          table: "t",
          key: { id: "1" },
          version: "bad",
          changes: { x: 1 },
        },
        true,
      ),
    ).toThrow();
  });
});
