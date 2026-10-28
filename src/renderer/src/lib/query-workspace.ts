import {
  postgresStatementRanges,
  sqliteStatementRanges,
} from "../../../shared/sql-statements";
import type {
  DatabaseConnectionSummary,
  DatabaseKind,
} from "../../../shared/database";

export type QueryKind = DatabaseKind;

export interface QueryTab {
  id: string;
  title: string;
  query: string;
  kind: QueryKind;
  connectionKey: string;
  updatedAt: number;
}

export interface SavedQuery {
  id: string;
  title: string;
  query: string;
  kind: QueryKind;
  connectionKey: string;
  folder: string;
  updatedAt: number;
}

export interface QueryHistoryEntry {
  id: string;
  query: string;
  kind: QueryKind;
  connectionKey: string;
  connectionName: string;
  startedAt: number;
  elapsedMs?: number;
  rowCount?: number;
  status: "running" | "success" | "error" | "cancelled";
  error?: string;
}

export interface QueryWorkspaceState {
  tabs: QueryTab[];
  activeTabId: string | null;
  saved: SavedQuery[];
  history: QueryHistoryEntry[];
}

const STORAGE_KEY = "rowfish.query-workspace.v1";
const LIMITS = { tabs: 100, saved: 500, history: 1_000, text: 1_000_000 };
const EMPTY_STATE: QueryWorkspaceState = {
  tabs: [],
  activeTabId: null,
  saved: [],
  history: [],
};
type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem">;

function getStorage(storage?: ReadStorage): ReadStorage | undefined {
  if (storage) return storage;
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validKind(value: unknown): value is QueryKind {
  return value === "postgres" || value === "mongodb";
}
type CommonRecord = Record<string, unknown> & {
  id: string;
  title: string;
  query: string;
  kind: QueryKind;
  connectionKey: string;
  updatedAt: number;
};
function validCommon(value: unknown): value is CommonRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.query === "string" &&
    value.query.length <= LIMITS.text &&
    validKind(value.kind) &&
    typeof value.connectionKey === "string" &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt)
  );
}
function sanitizeTab(value: unknown): QueryTab | null {
  if (!validCommon(value)) return null;
  return {
    id: value.id.slice(0, 256),
    title: value.title.slice(0, 500),
    query: value.query,
    kind: value.kind,
    connectionKey: value.connectionKey.slice(0, 2_000),
    updatedAt: value.updatedAt,
  };
}
function sanitizeSaved(value: unknown): SavedQuery | null {
  if (!validCommon(value) || typeof value.folder !== "string") return null;
  return {
    id: value.id.slice(0, 256),
    title: value.title.slice(0, 500),
    query: value.query,
    kind: value.kind,
    connectionKey: value.connectionKey.slice(0, 2_000),
    folder: value.folder.slice(0, 500),
    updatedAt: value.updatedAt,
  };
}
function sanitizeHistory(value: unknown): QueryHistoryEntry | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.query !== "string" ||
    value.query.length > LIMITS.text ||
    !validKind(value.kind) ||
    typeof value.connectionKey !== "string" ||
    typeof value.connectionName !== "string" ||
    typeof value.startedAt !== "number" ||
    !Number.isFinite(value.startedAt) ||
    !["running", "success", "error", "cancelled"].includes(
      String(value.status),
    ) ||
    (value.elapsedMs !== undefined &&
      (typeof value.elapsedMs !== "number" ||
        !Number.isFinite(value.elapsedMs))) ||
    (value.rowCount !== undefined &&
      (typeof value.rowCount !== "number" || !Number.isFinite(value.rowCount)))
  )
    return null;
  return {
    id: value.id.slice(0, 256),
    query: value.query,
    kind: value.kind,
    connectionKey: value.connectionKey.slice(0, 2_000),
    connectionName: value.connectionName.slice(0, 500),
    startedAt: value.startedAt,
    ...(typeof value.elapsedMs === "number"
      ? { elapsedMs: value.elapsedMs }
      : {}),
    ...(typeof value.rowCount === "number" ? { rowCount: value.rowCount } : {}),
    status: value.status as QueryHistoryEntry["status"],
    ...(typeof value.error === "string"
      ? { error: value.error.slice(0, LIMITS.text) }
      : {}),
  };
}

export function loadQueryWorkspace(storage?: ReadStorage): QueryWorkspaceState {
  try {
    const raw = getStorage(storage)?.getItem(STORAGE_KEY);
    if (!raw || raw.length > 20_000_000) return { ...EMPTY_STATE };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...EMPTY_STATE };
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
          .slice(0, LIMITS.tabs)
          .map(sanitizeTab)
          .filter((item): item is QueryTab => item !== null)
      : [];
    const saved = Array.isArray(parsed.saved)
      ? parsed.saved
          .slice(0, LIMITS.saved)
          .map(sanitizeSaved)
          .filter((item): item is SavedQuery => item !== null)
      : [];
    const history = Array.isArray(parsed.history)
      ? parsed.history
          .slice(0, LIMITS.history)
          .map(sanitizeHistory)
          .filter((item): item is QueryHistoryEntry => item !== null)
      : [];
    const active =
      typeof parsed.activeTabId === "string" &&
      tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : null;
    return { tabs, activeTabId: active, saved, history };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function saveQueryWorkspace(
  state: QueryWorkspaceState,
  storage?: WriteStorage,
): boolean {
  try {
    const target =
      storage ??
      (typeof localStorage === "undefined" ? undefined : localStorage);
    if (!target) return false;
    target.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: state.tabs.slice(0, LIMITS.tabs),
        activeTabId: state.activeTabId,
        saved: state.saved.slice(0, LIMITS.saved),
        history: state.history.slice(0, LIMITS.history),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function queryConnectionKey(
  connection: DatabaseConnectionSummary | null,
): string {
  if (!connection) return "";
  return [
    connection.savedConnectionId
      ? `profile:${connection.savedConnectionId}`
      : `session:${connection.parentConnectionId ?? connection.id}`,
    connection.kind,
    connection.host.trim().toLocaleLowerCase(),
    connection.port,
    connection.database.trim(),
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join("|");
}

export function makeQueryTab(
  kind: QueryKind = "postgres",
  connectionKey = "",
  query = "",
  title?: string,
): QueryTab {
  const now = Date.now();
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `tab-${now}-${Math.random().toString(36).slice(2)}`,
    title: title ?? `Query ${new Date(now).toLocaleTimeString()}`,
    query,
    kind,
    connectionKey,
    updatedAt: now,
  };
}

function csvCell(value: unknown): string {
  // Spreadsheet formula protection is applied to strings only; values remain intact in JSON export.
  let text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // eslint-disable-next-line no-control-regex -- protect spreadsheet exports after leading control characters
  if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(text))
    text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function exportResultsCsv(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(","),
    ),
  ].join("\r\n");
}
export function exportResultsJson(rows: unknown[]): string {
  return JSON.stringify(rows, null, 2);
}
export function downloadText(
  filename: string,
  content: string,
  type: string,
): void {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof Blob === "undefined"
  )
    return;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Extract the complete statement surrounding a zero-based cursor, ignoring delimiters in quoted/commented text. */
export function getSqlStatement(
  text: string,
  cursor: number,
  kind: "postgres" | "sqlite" = "postgres",
): string {
  const position = Math.max(0, Math.min(text.length, cursor));
  const ranges =
    kind === "sqlite"
      ? sqliteStatementRanges(text, false)
      : postgresStatementRanges(text, false);
  const range =
    ranges.find((item) => item.end >= position && item.start <= position) ??
    (position >= (ranges.at(-1)?.end ?? 0) ? ranges.at(-1) : undefined);
  return range ? text.slice(range.start, range.end).trim() : "";
}
