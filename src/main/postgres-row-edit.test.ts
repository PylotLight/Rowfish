import { describe, expect, test } from "bun:test";
import {
  assertCompletePrimaryKey,
  buildRowUpdate,
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
    expect(() => assertCompletePrimaryKey({ id: "1" }, [])).toThrow(
      "requires a primary key",
    );
    expect(() => assertCompletePrimaryKey({ id: "1" }, ["id"])).not.toThrow();
  });
  test("quotes identifiers and orders composite-key, change, and version parameters", () => {
    expect(
      buildRowUpdate(
        'odd"schema',
        'audit"table',
        ["tenant id", 'row"id'],
        ["display", "value"],
      ),
    ).toBe(
      'UPDATE "odd""schema"."audit""table" SET "display" = $3, "value" = $4 WHERE "tenant id" = $1 AND "row""id" = $2 AND xmin::text = $5 RETURNING xmin::text AS "__rowfish_xmin"',
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
