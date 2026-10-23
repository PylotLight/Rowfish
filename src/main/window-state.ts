import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { WINDOW } from "../shared/config";
import {
  restorableBounds,
  parseWindowState,
  type WindowState,
} from "../shared/window-state";

const FILE_NAME = "window-state.json";
const SAVE_DELAY_MS = 400;

function statePath(): string {
  return join(app.getPath("userData"), FILE_NAME);
}

/** Last saved window state, or null on first launch / unreadable file. */
export function loadWindowState(): WindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(statePath(), "utf8")));
  } catch {
    return null;
  }
}

/**
 * Bounds to open the window with: the saved ones when they still land on a
 * connected display, otherwise the default size centred by Electron.
 */
export function initialBounds(
  state: WindowState | null,
): Partial<Rectangle> & { width: number; height: number } {
  const fallback = { width: WINDOW.width, height: WINDOW.height };
  if (!state) return fallback;
  return (
    restorableBounds(
      state.bounds,
      screen.getAllDisplays().map((display) => display.workArea),
      { width: WINDOW.minWidth, height: WINDOW.minHeight },
    ) ?? fallback
  );
}

function writeState(state: WindowState): void {
  try {
    const file = statePath();
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(state));
    renameSync(temp, file);
  } catch {
    /* Window placement is a convenience; never fail the app over it. */
  }
}

/** Saves size, position, maximised and full-screen state as the window changes. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const snapshot = (): WindowState | null => {
    if (win.isDestroyed() || win.isMinimized()) return null;
    return {
      // getNormalBounds keeps the un-maximised size, so restoring a
      // maximised window and then un-maximising lands somewhere sensible.
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
    };
  };
  const save = (): void => {
    clearTimeout(timer);
    const state = snapshot();
    if (state) writeState(state);
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };
  for (const event of [
    "resize",
    "move",
    "maximize",
    "unmaximize",
    "enter-full-screen",
    "leave-full-screen",
  ] as const)
    win.on(event as "resize", schedule);
  win.on("close", save);
}
