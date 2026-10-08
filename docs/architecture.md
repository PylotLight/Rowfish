# Architecture

The React renderer communicates with Electron through a narrow typed preload bridge. Database driver work runs in a Node worker thread for each live connection.

```text
React renderer → preload bridge → Electron IPC → connection manager → Node worker → PostgreSQL or MongoDB
```

- `src/renderer/` contains the query workspace, connection list, editor and virtualized result grid.
- `src/preload/index.ts` exposes the typed database bridge with `contextBridge`.
- `src/main/ipc.ts` validates and dispatches renderer requests.
- `src/main/database.ts` owns active connections and enforces sender ownership, connection/query limits and cancellation.
- `src/main/database-worker.ts` opens driver connections, reads cursors and normalizes result rows off the UI thread.
- `src/shared/` contains database types, validation helpers and app configuration.

## Query path

Each connection owns one worker; the app supports up to eight concurrent connections. PostgreSQL uses `pg-cursor`, and MongoDB uses a `find` cursor. Workers send rows in batches of 100 and stop at the requested row limit or the 16 MB normalized-result cap. Each query has a 120-second server timeout. The renderer retains at most 10,000 rows and virtualizes the visible table window.

Workers have a 256 MB old-generation heap cap. If a query is cancelled, Rowfish terminates its worker and closes that connection to interrupt server-side work. Closing the app also terminates active workers. Credentials remain in memory and are not persisted.

## Process boundaries

1. Renderer code does not import main-process modules. Type-only imports from `src/shared/` are erased at build time.
2. The main process validates database inputs before starting driver work.
3. Driver work and result normalization stay off the Electron main thread.
4. Renderer capabilities are limited to methods exposed through `src/preload/index.ts`.
