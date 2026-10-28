/**
 * Resizable result columns: width maths plus a small localStorage store keyed
 * by result scope (a Mongo collection, or a query tab for Postgres).
 */

export const COLUMN_WIDTH_MIN = 56;
export const COLUMN_WIDTH_MAX = 1_200;
/** Default (unsized) columns stay in the range the grid always used. */
export const DEFAULT_WIDTH_MIN = 130;
export const DEFAULT_WIDTH_MAX = 300;
/** Double-click auto-fit may go wider than a default, but not absurdly. */
export const AUTO_FIT_MAX = 640;
/** Horizontal padding plus room for the sort and filter affordances. */
export const HEADER_CHROME = 80;
export const CELL_PADDING = 22;

const KEY = "rowfish.column-widths.v1";
const MAX_SCOPES = 60;

export type ColumnWidths = Record<string, number>;

export function clampColumnWidth(
  width: number,
  min = COLUMN_WIDTH_MIN,
  max = COLUMN_WIDTH_MAX,
): number {
  if (!Number.isFinite(width)) return min;
  return Math.round(Math.max(min, Math.min(max, width)));
}

/** Rough text width for monospace-ish grid text, without touching the DOM. */
export function estimateTextWidth(text: string, charWidth = 7): number {
  return Math.min(text.length, 400) * charWidth;
}

/** Width a column gets before anyone resizes it. */
export function defaultColumnWidth(
  header: string,
  samples: readonly string[],
  charWidth = 7,
): number {
  // Headers are bold, so they run a little wider per character.
  let widest = estimateTextWidth(header, charWidth * 1.12) + HEADER_CHROME;
  for (const sample of samples)
    widest = Math.max(
      widest,
      estimateTextWidth(sample, charWidth) + CELL_PADDING,
    );
  return clampColumnWidth(widest, DEFAULT_WIDTH_MIN, DEFAULT_WIDTH_MAX);
}

/** Auto-fit from measured pixel widths of the header and visible cells. */
export function autoFitColumnWidth(
  headerWidth: number,
  cellWidths: readonly number[],
): number {
  let widest = headerWidth + HEADER_CHROME;
  for (const width of cellWidths)
    widest = Math.max(widest, width + CELL_PADDING);
  return clampColumnWidth(widest, COLUMN_WIDTH_MIN + 24, AUTO_FIT_MAX);
}

/** Width after dragging a header edge by `delta` pixels. */
export function resizedWidth(startWidth: number, delta: number): number {
  return clampColumnWidth(startWidth + delta);
}

type Store = { order: string[]; widths: Record<string, ColumnWidths> };

function readStore(storage?: Pick<Storage, "getItem">): Store {
  try {
    const raw = (
      storage ??
      (typeof localStorage === "undefined" ? undefined : localStorage)
    )?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return { order: [], widths: {} };
    const data = parsed as Partial<Store>;
    const widths: Record<string, ColumnWidths> = {};
    for (const [scope, columns] of Object.entries(data.widths ?? {})) {
      if (!columns || typeof columns !== "object") continue;
      const clean: ColumnWidths = {};
      for (const [column, width] of Object.entries(columns))
        if (typeof width === "number" && Number.isFinite(width))
          clean[column] = clampColumnWidth(width);
      widths[scope] = clean;
    }
    const order = Array.isArray(data.order)
      ? data.order.filter((scope): scope is string => scope in widths)
      : Object.keys(widths);
    return { order, widths };
  } catch {
    return { order: [], widths: {} };
  }
}

export function loadColumnWidths(
  scope: string,
  storage?: Pick<Storage, "getItem">,
): ColumnWidths {
  return readStore(storage).widths[scope] ?? {};
}

/** Saves one scope's widths, keeping only the most recent scopes. */
export function saveColumnWidths(
  scope: string,
  widths: ColumnWidths,
  storage?: Pick<Storage, "getItem" | "setItem">,
): void {
  try {
    const target =
      storage ??
      (typeof localStorage === "undefined" ? undefined : localStorage);
    if (!target) return;
    const store = readStore(target);
    store.order = store.order.filter((item) => item !== scope);
    if (Object.keys(widths).length) {
      store.widths[scope] = widths;
      store.order.push(scope);
    } else delete store.widths[scope];
    while (store.order.length > MAX_SCOPES) {
      const oldest = store.order.shift()!;
      delete store.widths[oldest];
    }
    target.setItem(KEY, JSON.stringify(store));
  } catch {
    // Column widths are an optional preference; unavailable storage is ignored.
  }
}
