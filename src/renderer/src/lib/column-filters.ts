import type { DatabaseCell, DatabaseRow } from "../../../shared/database";

/**
 * Excel-style per-column filters for the results grid: a condition
 * (contains, or a comparison like `>10`, `<=2026-01-01`, `!=ready`, `=x`)
 * plus a set of unticked values to hide.
 */
export interface ColumnFilter {
  condition: string;
  /** Value keys (see cellFilterKey) the user unticked. */
  excluded: string[];
}

export type ColumnFilters = Record<string, ColumnFilter>;

const NULL_KEY = "\u0000null";

export function cellFilterKey(value: DatabaseCell | undefined): string {
  return value === null || value === undefined ? NULL_KEY : String(value);
}

export function cellFilterLabel(key: string): string {
  if (key === NULL_KEY) return "(null / missing)";
  if (key === "") return "(empty)";
  return key;
}

export function isColumnFilterActive(
  filter: ColumnFilter | undefined,
): boolean {
  return Boolean(filter && (filter.condition.trim() || filter.excluded.length));
}

type Predicate = (value: DatabaseCell | undefined) => boolean;

function comparable(value: string): number | string {
  const number = Number(value);
  if (value.trim() !== "" && Number.isFinite(number)) return number;
  return value;
}

function compare(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Builds a matcher for a condition; empty means everything matches. */
export function conditionPredicate(condition: string): Predicate {
  const text = condition.trim();
  if (!text) return () => true;
  const match = /^(>=|<=|!=|<>|>|<|=)\s*(.*)$/.exec(text);
  if (!match) {
    const needle = text.toLocaleLowerCase();
    return (value) =>
      value !== null &&
      value !== undefined &&
      String(value).toLocaleLowerCase().includes(needle);
  }
  const [, op, rawTarget] = match as unknown as [string, string, string];
  const target = rawTarget.trim();
  const targetIsNull = /^null$/i.test(target);
  if (op === "=" || op === "!=" || op === "<>") {
    const equal: Predicate = (value) =>
      targetIsNull
        ? value === null || value === undefined
        : value !== null &&
          value !== undefined &&
          (String(value).toLocaleLowerCase() === target.toLocaleLowerCase() ||
            (typeof comparable(target) === "number" &&
              Number(value) === comparable(target)));
    return op === "=" ? equal : (value) => !equal(value);
  }
  const wanted = comparable(target);
  return (value) => {
    if (value === null || value === undefined || target === "") return false;
    const difference = compare(comparable(String(value)), wanted);
    if (op === ">") return difference > 0;
    if (op === ">=") return difference >= 0;
    if (op === "<") return difference < 0;
    return difference <= 0;
  };
}

export function applyColumnFilters(
  rows: DatabaseRow[],
  filters: ColumnFilters,
): DatabaseRow[] {
  const active = Object.entries(filters).filter(([, filter]) =>
    isColumnFilterActive(filter),
  );
  if (!active.length) return rows;
  const checks = active.map(([column, filter]) => {
    const condition = conditionPredicate(filter.condition);
    const excluded = new Set(filter.excluded);
    return (row: DatabaseRow) =>
      !excluded.has(cellFilterKey(row[column])) && condition(row[column]);
  });
  return rows.filter((row) => checks.every((check) => check(row)));
}

export interface DistinctValue {
  key: string;
  label: string;
  count: number;
}

/** Distinct values of a column, most common first, capped at `limit`. */
export function distinctColumnValues(
  rows: readonly DatabaseRow[],
  column: string,
  limit = 500,
): { values: DistinctValue[]; truncated: boolean } {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = cellFilterKey(row[column]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts]
    .map(([key, count]) => ({ key, label: cellFilterLabel(key), count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
  return { values: values.slice(0, limit), truncated: values.length > limit };
}
