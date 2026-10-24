import type { DatabaseCell, DatabaseRow } from "../../../shared/database";

/**
 * Helpers for the Compass-style list / JSON result views. Documents arrive as
 * canonical EJSON (`{"$oid": …}`, `{"$numberInt": "1"}`…) so BSON types
 * survive the trip from the worker; plain JSON values from the flat row cells
 * are understood too, so Postgres rows and older results still render.
 */

export type ValueKind =
  | "ObjectId"
  | "String"
  | "Int32"
  | "Int64"
  | "Double"
  | "Decimal128"
  | "Boolean"
  | "Date"
  | "Null"
  | "Undefined"
  | "Object"
  | "Array"
  | "Binary"
  | "UUID"
  | "RegExp"
  | "Timestamp"
  | "MinKey"
  | "MaxKey"
  | "Code"
  | "Symbol";

export interface ValueInfo {
  kind: ValueKind;
  /** Display text for leaf values, shell style (`ObjectId('…')`, `"text"`). */
  text: string;
  /** Child count for objects and arrays. */
  count?: number;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const WRAPPER_KEYS = new Set([
  "$oid",
  "$date",
  "$numberInt",
  "$numberLong",
  "$numberDouble",
  "$numberDecimal",
  "$binary",
  "$uuid",
  "$regularExpression",
  "$timestamp",
  "$minKey",
  "$maxKey",
  "$undefined",
  "$symbol",
  "$code",
]);

/** The EJSON type wrapper key of a value, if it is one. */
function wrapperKey(value: JsonObject): string | null {
  const keys = Object.keys(value);
  if (keys.length === 1 && WRAPPER_KEYS.has(keys[0]!)) return keys[0]!;
  if (keys.length === 2 && "$code" in value && "$scope" in value)
    return "$code";
  return null;
}

function base64ToHex(base64: string): string {
  try {
    const binary = atob(base64);
    let hex = "";
    for (let index = 0; index < binary.length; index += 1)
      hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
    return hex;
  } catch {
    return "";
  }
}

function uuidFromHex(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Milliseconds since the epoch for an EJSON `$date` payload. */
function dateMillis(payload: Json): number | null {
  if (typeof payload === "string") {
    const time = Date.parse(payload);
    return Number.isFinite(time) ? time : null;
  }
  if (typeof payload === "number") return payload;
  if (isObject(payload) && typeof payload.$numberLong === "string") {
    const time = Number(payload.$numberLong);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function isoDate(payload: Json): string {
  const time = dateMillis(payload);
  if (time === null) return String(payload);
  try {
    return new Date(time).toISOString();
  } catch {
    return String(time);
  }
}

const MAX_TEXT = 2_000;

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/** Classifies one (EJSON or plain JSON) value for display. */
export function describeValue(value: unknown): ValueInfo {
  if (value === null) return { kind: "Null", text: "null" };
  if (value === undefined) return { kind: "Undefined", text: "undefined" };
  if (typeof value === "string")
    return { kind: "String", text: `"${clip(value)}"` };
  if (typeof value === "boolean")
    return { kind: "Boolean", text: String(value) };
  if (typeof value === "number")
    return {
      kind: Number.isInteger(value) ? "Int32" : "Double",
      text: String(value),
    };
  if (Array.isArray(value))
    return { kind: "Array", text: "", count: value.length };
  if (!isObject(value)) return { kind: "String", text: clip(String(value)) };
  const key = wrapperKey(value);
  const payload = key ? value[key]! : null;
  switch (key) {
    case "$oid":
      return { kind: "ObjectId", text: `ObjectId('${String(payload)}')` };
    case "$date":
      return { kind: "Date", text: isoDate(payload) };
    case "$numberInt":
      return { kind: "Int32", text: String(payload) };
    case "$numberLong":
      return { kind: "Int64", text: String(payload) };
    case "$numberDouble":
      return { kind: "Double", text: String(payload) };
    case "$numberDecimal":
      return { kind: "Decimal128", text: String(payload) };
    case "$uuid":
      return { kind: "UUID", text: `UUID('${String(payload)}')` };
    case "$binary": {
      const base64 = isObject(payload) ? String(payload.base64 ?? "") : "";
      const subType = isObject(payload) ? String(payload.subType ?? "00") : "";
      const hex = base64ToHex(base64);
      if ((subType === "04" || subType === "03") && hex.length === 32)
        return { kind: "UUID", text: `UUID('${uuidFromHex(hex)}')` };
      return {
        kind: "Binary",
        text: `Binary('${clip(base64)}', ${parseInt(subType, 16) || 0})`,
      };
    }
    case "$regularExpression": {
      const pattern = isObject(payload) ? String(payload.pattern ?? "") : "";
      const options = isObject(payload) ? String(payload.options ?? "") : "";
      return { kind: "RegExp", text: `/${clip(pattern)}/${options}` };
    }
    case "$timestamp": {
      const t = isObject(payload) ? payload.t : 0;
      const i = isObject(payload) ? payload.i : 0;
      return { kind: "Timestamp", text: `Timestamp({ t: ${t}, i: ${i} })` };
    }
    case "$minKey":
      return { kind: "MinKey", text: "MinKey()" };
    case "$maxKey":
      return { kind: "MaxKey", text: "MaxKey()" };
    case "$undefined":
      return { kind: "Undefined", text: "undefined" };
    case "$symbol":
      return { kind: "Symbol", text: `Symbol('${clip(String(payload))}')` };
    case "$code":
      return { kind: "Code", text: `Code('${clip(String(payload))}')` };
    default:
      return { kind: "Object", text: "", count: Object.keys(value).length };
  }
}

export function isNestedKind(kind: ValueKind): kind is "Object" | "Array" {
  return kind === "Object" || kind === "Array";
}

/** Children of an object or array as [key, value] pairs (no wrappers). */
export function childEntries(value: unknown): [string, unknown][] {
  if (Array.isArray(value))
    return value.map((item, index) => [String(index), item]);
  if (isObject(value) && !wrapperKey(value)) return Object.entries(value);
  return [];
}

/** Tree label for a nested value, as Compass shows it: `Object (3)`. */
export function treeSummary(info: ValueInfo): string {
  return `${info.kind} (${info.count ?? 0})`;
}

/** Compact table-cell text for a nested value: `{} 3 fields`, `[] 4 items`. */
export function cellSummary(info: ValueInfo): string {
  const count = info.count ?? 0;
  return info.kind === "Array"
    ? `[] ${count} ${count === 1 ? "item" : "items"}`
    : `{} ${count} ${count === 1 ? "field" : "fields"}`;
}

/** Parses a cell that holds serialized JSON (object or array), else undefined. */
export function parseJsonCell(cell: DatabaseCell | undefined): unknown {
  if (typeof cell !== "string") return undefined;
  const first = cell.trimStart()[0];
  if (first !== "{" && first !== "[") return undefined;
  try {
    const parsed: unknown = JSON.parse(cell);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Builds a document from flat row cells, expanding JSON-looking cells. */
export function rowAsDocument(row: DatabaseRow): Record<string, unknown> {
  const document: Record<string, unknown> = {};
  for (const [key, cell] of Object.entries(row)) {
    const nested = parseJsonCell(cell);
    document[key] = nested === undefined ? cell : nested;
  }
  return document;
}

/** Typed document for a row: its canonical EJSON when known, else its cells. */
export function documentFor(
  row: DatabaseRow,
  ejson: string | null | undefined,
): Record<string, unknown> {
  if (ejson) {
    try {
      const parsed: unknown = JSON.parse(ejson);
      if (isObject(parsed)) return parsed;
    } catch {}
  }
  return rowAsDocument(row);
}

/**
 * Relaxed EJSON (what mongosh / Compass copy): plain numbers where they are
 * safe, `{"$date": "ISO"}`, wrappers kept for everything else. Parseable by
 * Rowfish's insert / update dialogs.
 */
export function toRelaxed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toRelaxed);
  if (!isObject(value)) return value;
  const key = wrapperKey(value);
  if (!key) {
    const out: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(value))
      out[name] = toRelaxed(child);
    return out;
  }
  const payload = value[key]!;
  if (key === "$numberInt") return Number(payload);
  if (key === "$numberDouble") {
    const number = Number(payload);
    return Number.isFinite(number) ? number : value;
  }
  if (key === "$numberLong") {
    const number = Number(payload);
    return Number.isSafeInteger(number) ? number : value;
  }
  if (key === "$date") {
    const time = dateMillis(payload);
    const year = time === null ? NaN : new Date(time).getUTCFullYear();
    return year >= 1970 && year <= 9999
      ? { $date: new Date(time!).toISOString() }
      : value;
  }
  return value;
}

/** Plain JSON for pasting elsewhere: ids as hex, dates as ISO strings. */
export function toPlain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPlain);
  if (!isObject(value)) return value;
  const key = wrapperKey(value);
  if (!key) {
    const out: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(value))
      out[name] = toPlain(child);
    return out;
  }
  const payload = value[key]!;
  switch (key) {
    case "$oid":
    case "$numberDecimal":
    case "$symbol":
    case "$uuid":
      return String(payload);
    case "$date":
      return isoDate(payload);
    case "$numberInt":
    case "$numberDouble":
    case "$numberLong": {
      const number = Number(payload);
      return Number.isFinite(number) ? number : String(payload);
    }
    case "$undefined":
      return null;
    case "$code":
      return String(payload);
    case "$timestamp":
      return payload;
    default: {
      // Binary, regex, min/max keys read best as their shell text.
      const info = describeValue(value);
      return info.kind === "UUID" ? info.text.slice(6, -2) : info.text;
    }
  }
}

export function formatDocument(
  document: unknown,
  format: "ejson" | "json",
): string {
  return JSON.stringify(
    format === "ejson" ? toRelaxed(document) : toPlain(document),
    null,
    2,
  );
}

/** Document with `_id` removed, for cloning into an insert. */
export function withoutId(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const { _id: _ignored, ...rest } = document;
  return rest;
}

/**
 * The type hint per column, from up to `sample` documents: the single kind
 * seen (nulls ignored), `Mixed` when several, or nothing when unknown.
 */
export function columnKinds(
  columns: readonly string[],
  documents: readonly Record<string, unknown>[],
  sample = 200,
): Record<string, string> {
  const seen = new Map<string, Set<ValueKind>>();
  for (const document of documents.slice(0, sample)) {
    for (const column of columns) {
      if (!(column in document)) continue;
      const { kind } = describeValue(document[column]);
      if (kind === "Null" || kind === "Undefined") continue;
      const kinds = seen.get(column) ?? new Set<ValueKind>();
      kinds.add(kind);
      seen.set(column, kinds);
    }
  }
  const out: Record<string, string> = {};
  for (const column of columns) {
    const kinds = seen.get(column);
    if (!kinds?.size) continue;
    // Whole numbers parsed from plain JSON can't tell Int32 from Double.
    if (kinds.size === 2 && kinds.has("Int32") && kinds.has("Double"))
      out[column] = "Double";
    else out[column] = kinds.size === 1 ? [...kinds][0]! : "Mixed";
  }
  return out;
}

export type ResultsView = "table" | "list" | "json";
const RESULTS_VIEW_KEY = "rowfish.results-view";

export function loadResultsView(
  storage?: Pick<Storage, "getItem">,
): ResultsView | null {
  try {
    const value = (
      storage ??
      (typeof localStorage === "undefined" ? undefined : localStorage)
    )?.getItem(RESULTS_VIEW_KEY);
    return value === "table" || value === "list" || value === "json"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function saveResultsView(
  view: ResultsView,
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    (
      storage ??
      (typeof localStorage === "undefined" ? undefined : localStorage)
    )?.setItem(RESULTS_VIEW_KEY, view);
  } catch {}
}

/**
 * The view to show: the user's explicit choice wins; until they make one a
 * single MongoDB document opens as a list and everything else as a table.
 */
export function effectiveResultsView(
  chosen: ResultsView | null,
  kind: string | undefined,
  rowCount: number,
): ResultsView {
  if (chosen) return chosen;
  return kind === "mongodb" && rowCount === 1 ? "list" : "table";
}

export interface JsonToken {
  text: string;
  type?: "key" | "string" | "number" | "literal";
}

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Splits pretty JSON into coloured tokens: keys, strings, numbers, literals. */
export function jsonTokens(text: string): JsonToken[] {
  const out: JsonToken[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    const [whole, string, colon, literal, number] = match;
    if (string !== undefined) {
      out.push({ text: string, type: colon ? "key" : "string" });
      if (colon) out.push({ text: colon });
    } else if (literal !== undefined)
      out.push({ text: literal, type: "literal" });
    else if (number !== undefined) out.push({ text: number, type: "number" });
    last = at + whole.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
