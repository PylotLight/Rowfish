# Architecture

The React renderer communicates with Electron through a narrow typed preload bridge. Database driver work runs in a Node worker thread for each live connection.

```text
React renderer → preload bridge → Electron IPC → connection manager → Node worker → PostgreSQL, SQLite or MongoDB
```

- `src/renderer/` contains the query workspace, connection list, editor and virtualized result grid.
- `src/preload/index.ts` exposes the typed database bridge with `contextBridge`.
- `src/main/ipc.ts` validates and dispatches renderer requests.
- `src/main/database.ts` owns active connections and enforces sender ownership, connection/query limits and cancellation.
- `src/main/database-worker.ts` opens PostgreSQL, SQLite (`node:sqlite`) or MongoDB connections, reads cursors/results and normalizes rows off the UI thread.
- `src/main/worker/sqlite.js` owns each SQLite file connection, schema inspection and sequential SQL execution; it shares the browser and query-result contracts without using PostgreSQL-only table editing.
- `src/main/alembic-graph.js` reads Alembic revision files without importing project Python code, then compares the revision graph with live `alembic_version` rows.
- `src/main/alembic-model-compare.js` invokes the selected project Python interpreter for SQLAlchemy/Alembic autogenerate comparison. Its helper returns operation summaries and offline-rendered SQL for review; it does not apply upgrades or execute the preview.
- `src/main/saved-connections.ts` stores profile metadata in the app's user-data directory and protects passwords with Electron `safeStorage` backed by the operating system credential store.
- `src/main/ai-query.js` keeps the OpenAI-compatible provider key encrypted with Electron `safeStorage`, sends user-approved prompts from the main process, and validates generated MongoDB filters and pipelines before returning them.
- `src/shared/` contains database types, validation helpers and app configuration.

## Query path

Each connection owns one worker; the app supports up to eight concurrent connections. PostgreSQL uses `pg-cursor`, and MongoDB uses a `find` cursor. Workers send rows in batches of 100 and stop at the requested row limit or the 16 MB normalized-result cap. Each query has a 120-second server timeout. The renderer retains at most 10,000 rows and virtualizes the visible table window.

Workers have a 256 MB old-generation heap cap. If a query is cancelled, Rowfish terminates its worker and closes that connection to interrupt server-side work. Closing the app also terminates active workers. Saved profiles are not live connections: they are listed after restart and reconnect only when selected. A password or MongoDB URI is persisted only as operating-system-encrypted data; Rowfish refuses to save it when secure storage is unavailable.

PostgreSQL catalog inspection runs through the same worker boundary. Server-browser profiles connect to the `postgres` maintenance database to enumerate databases and `CONNECT` privileges; opening a database creates a separate worker. Table and view names are read from PostgreSQL catalogs and quoted as identifiers when Rowfish generates a starter `SELECT` statement.

SQLite connections point to absolute local file paths. `DatabaseSync` stays in the worker, which exposes tables, views, columns, `alembic_version` rows and bounded SQL results to the same renderer bridge. Alembic model comparison is a separate process because it must load the project's Python environment; it requests PostgreSQL `default_transaction_read_only` and replaces Alembic's normal migration-run step with metadata comparison. Loading arbitrary project Python can still have local side effects, so the UI warns and asks before starting it.

## Process boundaries

1. Renderer code does not import main-process modules. Type-only imports from `src/shared/` are erased at build time.
2. The main process validates database inputs before starting driver work.
3. Driver work and result normalization stay off the Electron main thread.
4. Renderer capabilities are limited to methods exposed through `src/preload/index.ts`.
5. AI provider credentials and HTTP requests stay in the main process. AI generation is opt-in; each request requires a renderer consent check, sends field/index metadata but no document values, and returns a query draft that is never executed automatically.
