# Architecture

The renderer communicates with the Electron main process through a narrow typed preload bridge. Database work runs in one Node worker per connection.

```text
renderer (React) ──invoke──▶ preload (contextBridge) ──IPC──▶ main (Electron)
                                                           └──▶ database worker ──▶ PostgreSQL / MongoDB
```

- `src/renderer/` — database workspace, connection list, query editor, and results grid.
- `src/preload/index.ts` — typed renderer bridge for database operations and app visibility.
- `src/main/ipc.ts` — validates the renderer/main boundary and dispatches database operations.
- `src/main/database.ts` — owns live connections and enforces sender ownership, connection/query limits, and cancellation.
- `src/main/database-worker.ts` — performs driver connection and cursor work off the Electron main thread. Workers have a 256 MB old-generation heap cap.
- `src/shared/` — database types, validation helpers, and app configuration.

## Database query path

Each connection owns one worker, with at most eight active connections. PostgreSQL uses `pg-cursor`; MongoDB uses a `find` cursor. Results are sent in batches of 100 and stop at the requested row limit or a 16 MB normalized-result cap. Each query has a 120-second server timeout. The renderer keeps at most 10,000 rows and virtualizes the visible table window.

Cancelling a query terminates its worker and closes that connection; reconnect before running another query on it. Closing the app also terminates active workers. Credentials are held in memory only and are not persisted.

## Boundaries

1. Renderer code does not import main-process modules. Type-only imports from `src/shared/` are erased at build time.
2. Database inputs are validated in the main process before driver work starts.
3. Driver work and large result normalization/rendering stay off the UI thread.
4. Renderer capabilities are limited to methods exposed through `src/preload/index.ts`.
