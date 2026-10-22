import type {
  DatabaseRow,
  PostgresTableDetails,
} from "../../../shared/database";
import { DATABASE_LIMITS } from "../../../shared/database-helpers";

// The grid normalizes values for display. Only use keys whose display form is
// lossless: never derive a write target from a timestamp, binary preview or cut text.
export function getSafeRowKey(
  details: PostgresTableDetails,
  row: DatabaseRow,
): DatabaseRow {
  const primary = details.columns.filter((column) => column.isPrimaryKey);
  if (!primary.length) throw new Error("Editing requires a primary key.");
  const key: DatabaseRow = Object.create(null);
  for (const column of primary) {
    const value = row[column.name];
    if (
      value == null ||
      !/^(smallint|integer|bigint|numeric(?:\(.*\))?|decimal(?:\(.*\))?|text|character varying(?:\(.*\))?|character(?:\(.*\))?|uuid|boolean|real|double precision)$/.test(
        column.dataType,
      ) ||
      (typeof value === "string" &&
        value.length >= DATABASE_LIMITS.maxCellChars) ||
      (typeof value === "number" &&
        Number.isInteger(value) &&
        !Number.isSafeInteger(value))
    ) {
      throw new Error(
        "This primary key cannot be safely identified from the displayed result. Use SQL to edit this row.",
      );
    }
    key[column.name] = value;
  }
  return key;
}

export function isSameRow(
  details: PostgresTableDetails,
  left: DatabaseRow,
  right: DatabaseRow,
): boolean {
  const primary = details.columns.filter((column) => column.isPrimaryKey);
  return (
    primary.length > 0 &&
    primary.every(
      (column) =>
        left[column.name] != null &&
        right[column.name] != null &&
        String(left[column.name]) === String(right[column.name]),
    )
  );
}

export function getRowChanges(
  original: DatabaseRow,
  draft: DatabaseRow,
  columns: { name: string; editable: boolean }[],
): DatabaseRow {
  const changes: DatabaseRow = Object.create(null);
  for (const column of columns) {
    if (column.editable && draft[column.name] !== original[column.name])
      changes[column.name] = draft[column.name] ?? null;
  }
  return changes;
}
