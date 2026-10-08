# Database client

Rowfish opens live PostgreSQL and MongoDB connections only after you enter connection details and choose **Connect**.

## Connect

Provide a display name, host, port, database, and optional username/password. The TLS checkbox enables certificate-verified TLS. PostgreSQL defaults to port `5432`; MongoDB defaults to `27017`.

Credentials are passed through the typed Electron bridge and held in application/worker memory only. Rowfish does not write them to disk or restore connections after the app restarts. Closing a connection, closing the window, or quitting the app terminates its worker and releases the in-memory credentials. Rowfish supports up to **8 active database connections**.

## Run queries

- **PostgreSQL:** enter one SQL statement. Rowfish uses a PostgreSQL cursor to fetch rows in batches of 100; SQL parameters and multi-statement scripts are not exposed in this first query editor.
- **MongoDB:** enter a JSON document filter and a collection name. This uses `find`; aggregation pipelines are not yet exposed. The `$where` JavaScript filter operator is disabled.
- Use `⌘ Enter` (or `Ctrl+Enter`) to run the query. The top-bar search filters rows already received; it does not issue another query to the server.

Each database connection runs in its own Node worker thread rather than on the React renderer or Electron main thread. The worker has a 256 MB old-generation heap cap. Query output is sent to the app in small batches; the renderer holds no more than 10,000 rows and limits the normalized result payload to **16 MB**. Cells are truncated at 8,192 characters, and the grid virtualizes its visible rows. The default result limit is 1,000 rows; choose up to 10,000 in the workspace.

PostgreSQL connections set a 120-second `statement_timeout`. MongoDB queries use `maxTimeMS(120000)`. **Cancel** terminates the worker, which drops the database connection so the in-flight server operation is interrupted; Rowfish closes that connection and asks you to reconnect before running another query on it.

## Limits and current scope

- Connections are entered manually; there is no saved-connection vault, connection-string import, SSH tunnel, custom CA picker, or connection sync yet.
- TLS certificate verification is enabled when **Require TLS** is checked. Self-signed certificates need a trusted certificate available to the operating system; there is no per-connection CA file field yet.
- The PostgreSQL editor supports one statement at a time and does not accept query parameters yet. Use care when entering write statements; Rowfish executes the SQL you submit.
- The MongoDB editor currently supports JSON `find` filters, not aggregation, update, or delete operations.
- A row limit is not a full export workflow. Results beyond the configured row or 16 MB cap are not retained in the grid.
- Builds and unit tests cover type contracts, filter restrictions, bounds, and worker startup/error handling. A successful database session still needs testing with a reachable PostgreSQL or MongoDB server and valid credentials.

## Test locally

1. Start the app with `bun run dev`.
2. Open Rowfish and add a PostgreSQL or MongoDB server that is reachable from this computer.
3. Choose **Connect**, run a small query/filter, and check that results appear in batches.
4. Try a result limit and local result search, then choose **Cancel**. Cancellation closes that connection; reconnect before running another query.

See [Architecture](architecture.md) for the renderer/main/worker boundary and [Mac testing](mac-testing.md) for the platform checklist.
