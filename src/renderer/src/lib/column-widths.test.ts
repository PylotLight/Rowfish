import { describe, expect, test } from "bun:test";
import {
  AUTO_FIT_MAX,
  COLUMN_WIDTH_MAX,
  COLUMN_WIDTH_MIN,
  DEFAULT_WIDTH_MAX,
  DEFAULT_WIDTH_MIN,
  autoFitColumnWidth,
  clampColumnWidth,
  defaultColumnWidth,
  loadColumnWidths,
  resizedWidth,
  saveColumnWidths,
} from "./column-widths";

function memory(): Pick<Storage, "getItem" | "setItem"> & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("column width maths", () => {
  test("clamps to bounds and rounds", () => {
    expect(clampColumnWidth(10)).toBe(COLUMN_WIDTH_MIN);
    expect(clampColumnWidth(99_999)).toBe(COLUMN_WIDTH_MAX);
    expect(clampColumnWidth(150.6)).toBe(151);
    expect(clampColumnWidth(Number.NaN)).toBe(COLUMN_WIDTH_MIN);
  });

  test("defaults stay inside the classic grid range", () => {
    expect(defaultColumnWidth("id", ["1", "2"])).toBe(DEFAULT_WIDTH_MIN);
    expect(defaultColumnWidth("notes", ["x".repeat(500)])).toBe(
      DEFAULT_WIDTH_MAX,
    );
    const mid = defaultColumnWidth("email", ["someone@example.com.au.long"]);
    expect(mid).toBeGreaterThan(DEFAULT_WIDTH_MIN);
    expect(mid).toBeLessThan(DEFAULT_WIDTH_MAX);
    // Header text alone must fit (bold label + sort/filter chrome).
    expect(defaultColumnWidth("customer_id", ["2"])).toBeGreaterThan(150);
  });

  test("auto-fit uses the widest of header and cells", () => {
    expect(autoFitColumnWidth(40, [10, 200, 30])).toBe(222);
    expect(autoFitColumnWidth(300, [10])).toBe(380);
    expect(autoFitColumnWidth(5_000, [])).toBe(AUTO_FIT_MAX);
    expect(autoFitColumnWidth(0, [])).toBe(COLUMN_WIDTH_MIN + 24);
  });

  test("drag deltas clamp", () => {
    expect(resizedWidth(200, 35)).toBe(235);
    expect(resizedWidth(200, -500)).toBe(COLUMN_WIDTH_MIN);
  });
});

describe("column width storage", () => {
  test("saves and loads per scope", () => {
    const storage = memory();
    saveColumnWidths("mongo:app/users", { name: 220 }, storage);
    saveColumnWidths("pg:tab-1", { id: 90 }, storage);
    expect(loadColumnWidths("mongo:app/users", storage)).toEqual({
      name: 220,
    });
    expect(loadColumnWidths("pg:tab-1", storage)).toEqual({ id: 90 });
    expect(loadColumnWidths("missing", storage)).toEqual({});
  });

  test("empty widths remove the scope", () => {
    const storage = memory();
    saveColumnWidths("a", { x: 100 }, storage);
    saveColumnWidths("a", {}, storage);
    expect(loadColumnWidths("a", storage)).toEqual({});
  });

  test("keeps only the most recent scopes", () => {
    const storage = memory();
    for (let index = 0; index < 70; index += 1)
      saveColumnWidths(`s${index}`, { c: 100 + index }, storage);
    expect(loadColumnWidths("s0", storage)).toEqual({});
    expect(loadColumnWidths("s69", storage)).toEqual({ c: 169 });
    const stored = JSON.parse(storage.data.values().next().value!);
    expect(stored.order).toHaveLength(60);
  });

  test("ignores corrupt storage and bad values", () => {
    const storage = memory();
    storage.data.set("rowfish.column-widths.v1", "{not json");
    expect(loadColumnWidths("a", storage)).toEqual({});
    storage.data.set(
      "rowfish.column-widths.v1",
      JSON.stringify({ order: ["a"], widths: { a: { x: "wide", y: 5 } } }),
    );
    expect(loadColumnWidths("a", storage)).toEqual({ y: COLUMN_WIDTH_MIN });
  });
});
