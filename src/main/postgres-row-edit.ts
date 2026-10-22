import type { DatabaseRow, PostgresColumnDetails } from "../shared/database";

export interface EditableColumn extends PostgresColumnDetails {
  editable: boolean;
}

export interface PostgresRowDetails {
  row: DatabaseRow;
  columns: EditableColumn[];
  key: DatabaseRow;
  version: string;
}

export interface PostgresRowRequest {
  connectionId: string;
  schema: string;
  table: string;
  key: DatabaseRow;
}

export interface UpdatePostgresRowRequest extends PostgresRowRequest {
  version: string;
  changes: DatabaseRow;
}

export function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function validateRowRequest(
  value: unknown,
  update = false,
): PostgresRowRequest | UpdatePostgresRowRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid PostgreSQL row request.");
  const request = value as Record<string, unknown>;
  const text = (v: unknown, label: string, max: number): string => {
    if (
      typeof v !== "string" ||
      !v.trim() ||
      v.length > max ||
      v.includes("\0")
    )
      throw new Error(`${label} is invalid.`);
    return v;
  };
  const row = (v: unknown, label: string): DatabaseRow => {
    if (!v || typeof v !== "object" || Array.isArray(v))
      throw new Error(`${label} must be an object.`);
    const result: DatabaseRow = Object.create(null);
    const entries = Object.entries(v);
    if (!entries.length || entries.length > 256)
      throw new Error(`${label} is empty or too large.`);
    for (const [k, cell] of entries) {
      text(k, `${label} column`, 128);
      if (
        cell !== null &&
        typeof cell !== "string" &&
        typeof cell !== "number" &&
        typeof cell !== "boolean"
      )
        throw new Error(`${label} contains an invalid value.`);
      if (typeof cell === "number" && !Number.isFinite(cell))
        throw new Error(`${label} contains an invalid number.`);
      if (typeof cell === "string" && cell.length > 1_000_000)
        throw new Error(`${label} value is too large.`);
      result[k] = cell as DatabaseRow[string];
    }
    return result;
  };
  const base: PostgresRowRequest = {
    connectionId: text(request.connectionId, "Connection id", 80),
    schema: text(request.schema, "Schema", 128),
    table: text(request.table, "Table", 128),
    key: row(request.key, "Key"),
  };
  if (!update) return base;
  const version = text(request.version, "Row version", 128);
  if (!/^\d+$/.test(version)) throw new Error("Row version is invalid.");
  return { ...base, version, changes: row(request.changes, "Changes") };
}

export function assertCompletePrimaryKey(
  key: DatabaseRow,
  primaryKeys: string[],
): void {
  if (!primaryKeys.length) throw new Error("Editing requires a primary key.");
  if (
    Object.keys(key).length !== primaryKeys.length ||
    primaryKeys.some((name) => !(name in key) || key[name] === null)
  )
    throw new Error(
      "The row key must contain every non-null primary-key column and no other columns.",
    );
}

export function buildRowUpdate(
  schema: string,
  table: string,
  primaryKeys: string[],
  changeColumns: string[],
): string {
  const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const sets = changeColumns
    .map(
      (name, i) => `${quoteIdentifier(name)} = $${primaryKeys.length + i + 1}`,
    )
    .join(", ");
  const where = primaryKeys
    .map((name, i) => `${quoteIdentifier(name)} = $${i + 1}`)
    .join(" AND ");
  return `UPDATE ${relation} SET ${sets} WHERE ${where} AND xmin::text = $${primaryKeys.length + changeColumns.length + 1} RETURNING xmin::text AS "__rowfish_xmin"`;
}
