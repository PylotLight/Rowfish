# Architecture

Three process roles, one narrow bridge, one shared contract layer. Database work runs in a dedicated Node worker per connection.

```
renderer (React) ──invoke──▶ preload (contextBridge) ──IPC──▶ main (Electron)
                                                           └──▶ database worker ──▶ PostgreSQL / MongoDB
```

- `src/main/index.ts` — app lifecycle only: single-instance lock, `whenReady` wiring,
  quit handling. No business logic.
- `src/main/window.ts` — `BrowserWindow` creation, `showWindow`/`hideWindow`, vibrancy state.
- `src/main/tray.ts` — system tray + context menu. Left-click pops the menu; it never
  auto-shows the window.
- `src/main/ipc.ts` — every renderer→main call. Sections mirror the preload bridge.
- `src/main/database.ts` — validates and owns live connection workers; enforces sender ownership, connection/query limits and cancellation.
- `src/main/database-worker.ts` — performs driver connection and cursor work off the Electron main thread; each worker is bounded by a 256 MB old-generation heap limit.
- `src/preload/index.ts` — typed `window.api`. Nothing here but forwarding.
- `src/shared/config.ts` — runtime values safe to import anywhere (app name, id, geometry).
- `src/shared/types.ts` — type-only contracts (`SysInfo`, `GlassState`, `VibrancyName`).
- `src/renderer/` — React shell (`App.tsx`: sidebar + top bar) and example views in `views/`.

The **Workflow example** view is `src/renderer/src/views/Agent.tsx`. Its timed plan steps
are a UI demo; the system-info and notification steps call real APIs exposed through the
preload bridge. The **Database client** uses real PostgreSQL and MongoDB drivers through
the worker boundary described below.

## Rules

1. **Renderer never imports main-process modules.** Type-only imports from `src/shared/`
   are allowed and erased at build time.
2. **New IPC tool = 3 edits:** `ipcMain.handle` in `src/main/ipc.ts`, expose in
   `src/preload/index.ts`, call via `window.api`. Shared payload types go in
   `src/shared/`. The bridge is typed end-to-end, so the renderer sees the new
   call immediately.
3. **New section:** add a view in `src/renderer/src/views/`, extend the `Tab` type and
   `TABS` array, then render the view in `App.tsx`. Nav, layout, and glass styling come free.
4. **Tray items** go in the menu template in `src/main/tray.ts`; window actions reuse the
   helpers in `src/main/window.ts`.
5. **Agent tools** use the same IPC boundary, with visible plan and activity states in the
   Agent view. Add a tool via rule 2, then add its UI state and plan step. Keep slow or
   blocking work out of the renderer thread.
6. **Database work** is validated in `src/main/database.ts`, passed to a worker created with
   electron-vite's `?nodeWorker` import, and streamed back as bounded events. Never run
   database driver work, large result normalization, or large result rendering on the UI
   thread. Cancellation terminates the worker and its connection; the renderer must show
   that the connection needs to be reopened.

## Database query path

Each connection owns one worker, with at most eight active connections in the app. The
worker uses `pg-cursor` or a MongoDB `find` cursor, sends batches of 100 rows, and stops at
the requested row limit or a 16 MB normalized result cap. Each database query has a
120-second server timeout; the renderer stores at most 10,000 rows and virtualizes the
visible table window. Closing the window or quitting the app terminates the associated
workers. Credentials are session-memory only and are not persisted.

## Layout model

The app shell is locked to the viewport (`.shell { height: 100vh; overflow: hidden }`).
Sidebar and top bar are fixed; only `.view` scrolls. Keep it that way — any opaque
full-window background also kills the native vibrancy (see vibrancy doc).
