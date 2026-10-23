import { describe, expect, test } from "bun:test";
import {
  applyColumnFilters,
  cellFilterKey,
  conditionPredicate,
  distinctColumnValues,
} from "./column-filters";

import type { DatabaseRow } from "../../../shared/database";

const rows: DatabaseRow[] = [
  { status: "ready", total: 12, note: null },
  { status: "shipped", total: 5, note: "fragile" },
  { status: "ready", total: 40, note: "" },
  { status: "cancelled", total: 0 } as DatabaseRow,
];

describe("column filters", () => {
  test("contains is case-insensitive and skips nulls", () => {
    const match = conditionPredicate("RE");
    expect(match("ready")).toBe(true);
    expect(match(null)).toBe(false);
  });

  test("comparisons are numeric when both sides are numbers", () => {
    expect(conditionPredicate(">10")(12)).toBe(true);
    expect(conditionPredicate(">10")(9)).toBe(false);
    expect(conditionPredicate("<= 5")(5)).toBe(true);
    expect(conditionPredicate(">2026-01-01")("2026-03-04T00:00:00Z")).toBe(
      true,
    );
    expect(conditionPredicate("!=ready")("ready")).toBe(false);
    expect(conditionPredicate("=null")(null)).toBe(true);
    expect(conditionPredicate("=12")(12)).toBe(true);
  });

  test("unticked values and conditions combine across columns", () => {
    expect(
      applyColumnFilters(rows, {
        status: { condition: "", excluded: ["cancelled"] },
        total: { condition: ">=10", excluded: [] },
      }),
    ).toEqual([rows[0]!, rows[2]!]);
    expect(
      applyColumnFilters(rows, {
        note: { condition: "", excluded: [cellFilterKey(null)] },
      }),
    ).toEqual([rows[1]!, rows[2]!]);
  });

  test("distinct values are counted, most common first", () => {
    const { values, truncated } = distinctColumnValues(rows, "status");
    expect(values[0]).toEqual({ key: "ready", label: "ready", count: 2 });
    expect(values).toHaveLength(3);
    expect(truncated).toBe(false);
    expect(
      distinctColumnValues(rows, "note").values.map((v) => v.label),
    ).toContain("(null / missing)");
    expect(distinctColumnValues(rows, "status", 1).truncated).toBe(true);
  });
});
