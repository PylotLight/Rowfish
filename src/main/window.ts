import { BrowserWindow, app, shell, dialog } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { WINDOW } from "../shared/config";
import {
  initialBounds,
  loadWindowState,
  trackWindowState,
} from "./window-state";

const isMac = process.platform === "darwin";

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** electron-vite emits out/preload/index.js or index.mjs depending on config — accept both. */
function resolvePreload(): string {
  const base = join(__dirname, "../preload/index");
  if (existsSync(`${base}.cjs`)) return `${base}.cjs`;
  if (existsSync(`${base}.js`)) return `${base}.js`;
  return `${base}.mjs`;
}

/** App icon resolves from both out/main during development and app.asar when packaged. */
export function resolveAppIcon(): string | undefined {
  const iconPath = join(__dirname, "../../build/icon.png");
  return existsSync(iconPath) ? iconPath : undefined;
}

export function createWindow(): BrowserWindow {
  const savedState = loadWindowState();
  const win = new BrowserWindow({
    ...initialBounds(savedState),
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    show: false,
    autoHideMenuBar: true,
    icon: resolveAppIcon(),
    // macOS glass: native vibrancy + transparent window + inset traffic lights.
    // The renderer MUST stay translucent (see index.css) or the blur is covered up.
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    transparent: isMac,
    vibrancy: isMac ? "fullscreen-ui" : undefined,
    visualEffectState: isMac ? "active" : undefined,
    backgroundColor: isMac ? "#00000000" : "#101418",
    webPreferences: {
      preload: resolvePreload(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  trackWindowState(win);

  win.on("ready-to-show", () => {
    // maximize() also shows the window, so restore it here to avoid a flash.
    if (savedState?.maximized) win.maximize();
    win.show();
    if (savedState?.fullScreen) win.setFullScreen(true);
  });
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Keep editing", "Discard changes"],
      defaultId: 0,
      cancelId: 0,
      title: "Unsaved row changes",
      message: "Discard unsaved row changes and leave Rowfish?",
      detail:
        "Your query drafts are saved automatically. Unsaved row edits will be lost.",
    });
    // Electron uses preventDefault here to allow the unload to continue.
    if (choice === 1) event.preventDefault();
  });

  win.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith("https://"))
      void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  mainWindow = win;
  return win;
}

export function showWindow(): void {
  // app.hide() on macOS also requires re-showing the application.
  if (isMac) app.show();
  const win = mainWindow;
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
