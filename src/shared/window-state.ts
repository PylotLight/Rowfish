export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: WindowBounds;
  maximized: boolean;
  fullScreen: boolean;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// Electron's native window geometry is backed by signed 32-bit coordinates.
const MIN_WINDOW_COORDINATE = -(2 ** 31);
const MAX_WINDOW_COORDINATE = 2 ** 31 - 1;

/** Validates a stored window state; anything malformed is ignored. */
export function parseWindowState(value: unknown): WindowState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const bounds = record.bounds as Record<string, unknown> | undefined;
  if (
    !bounds ||
    !isFiniteNumber(bounds.x) ||
    !isFiniteNumber(bounds.y) ||
    !isFiniteNumber(bounds.width) ||
    !isFiniteNumber(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return null;
  const parsedBounds = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
  if (
    !Object.values(parsedBounds).every(Number.isSafeInteger) ||
    parsedBounds.x < MIN_WINDOW_COORDINATE ||
    parsedBounds.y < MIN_WINDOW_COORDINATE ||
    parsedBounds.x + parsedBounds.width > MAX_WINDOW_COORDINATE ||
    parsedBounds.y + parsedBounds.height > MAX_WINDOW_COORDINATE ||
    parsedBounds.width <= 0 ||
    parsedBounds.height <= 0
  )
    return null;
  return {
    bounds: parsedBounds,
    maximized: record.maximized === true,
    fullScreen: record.fullScreen === true,
  };
}

/** Minimum visible strip (px) of the title bar needed to keep a position. */
const MIN_VISIBLE = 80;

/**
 * Fits saved bounds to the displays connected now. Keeps the saved position
 * when enough of the window's top edge sits on a display, shrinks it to fit
 * that display, and returns size-only bounds (centred by Electron) when the
 * display it was on is gone.
 */
export function restorableBounds(
  saved: WindowBounds,
  workAreas: WindowBounds[],
  min: { width: number; height: number },
): WindowBounds | { width: number; height: number } | null {
  if (workAreas.length === 0) return null;
  const host = workAreas.find((area) => {
    const overlapX =
      Math.min(saved.x + saved.width, area.x + area.width) -
      Math.max(saved.x, area.x);
    const topInside =
      saved.y >= area.y - 1 && saved.y < area.y + area.height - MIN_VISIBLE / 2;
    return overlapX >= MIN_VISIBLE && topInside;
  });
  const area = host ?? workAreas[0]!;
  const width = Math.max(min.width, Math.min(saved.width, area.width));
  const height = Math.max(min.height, Math.min(saved.height, area.height));
  if (!host) return { width, height };
  const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}
