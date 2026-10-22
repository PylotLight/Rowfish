# Database client

Rowfish connects to PostgreSQL and MongoDB when you enter connection details and choose **Connect**. The connection dialog saves profiles by default so they remain available between app sessions. Saved profiles are not live sockets: after a restart, choose a saved server in the sidebar to reconnect.

## Save and reconnect

Provide a display name, database type, host, port, database and optional username/password. PostgreSQL defaults to port `5432`; MongoDB defaults to `27017`. The **Require TLS** option enables certificate-verified TLS; certificates must be trusted by the operating system.

Profile metadata is stored in Rowfish's app-specific user-data directory. If you save a password, Electron `safeStorage` encrypts it using the operating system credential store. Rowfish does not fall back to plaintext password storage; if secure storage is unavailable, turn off **Save this connection** to connect for the current session only. Choosing **Forget** removes the saved profile but does not disconnect an already-open session.

For a quick MongoDB connection, choose MongoDB, enable **Connect with a connection string**, paste a standard `mongodb://` or `mongodb+srv://` URI, enter a display name, and choose **Connect**. The URI is passed to the MongoDB driver intact so options such as replica sets, Atlas SRV discovery, authentication source and TLS settings are retained. When saving is enabled, the full URI is encrypted as a secret and is never returned to the renderer after connection.

Each live connection uses a worker. Rowfish supports up to **8 active connections**, including PostgreSQL server-browser and opened database sessions.

## PostgreSQL server browser

To browse multiple databases on one PostgreSQL server, choose **Browse all databases on this server** instead of entering a database name. Rowfish uses the `postgres` maintenance database to list databases and indicates which ones the current PostgreSQL user can connect to. Select an accessible database in the sidebar to open a separate session; Rowfish then lists its tables and views by schema.

This mode does not grant database access or bypass PostgreSQL permissions. It depends on being able to connect to the server's `postgres` maintenance database; if that is unavailable, connect directly to a database you can access instead. A direct PostgreSQL connection also shows its tables and views in the sidebar. Select a table to place a schema-qualified `SELECT * ... LIMIT 100` starter query in the editor; review it before running.

## MongoDB server browser

Every live MongoDB connection lists the databases visible to its credentials and lets you expand a database to browse its collections and views. Selecting a collection loads its documents and shows its type, estimated document count, validator (when present), and index definitions. The browser respects the MongoDB user's permissions; server-side authorization remains authoritative.

From a selected collection you can insert a document, update one or many documents with update operators, delete one or many matching documents, create/drop indexes, and create/drop collections. Creating a database creates its first collection. Dropping a collection or database requires typing its exact name; dropping a database also drops all of its collections. Built-in `admin`, `config` and `local` databases cannot be dropped from Rowfish. Delete and update operations require a non-empty filter.

## Run a query

### PostgreSQL

Use the SQL editor for one statement, a selected fragment, or a script. Ctrl/⌘ Enter runs the selection or current statement; Ctrl/⌘ Shift Enter and the Run query button run the whole editor. Statements execute sequentially on the same session and stop at the first error. Only the final statement’s result is displayed, fetched through a cursor in bounded batches. Earlier statements are not automatically rolled back: use explicit BEGIN/COMMIT/ROLLBACK when appropriate. Query parameters are not provided.

For the included fictional dataset, run:

```sql
SELECT order_id, customer, status, total_usd, ordered_at
FROM public.orders
WHERE status IN ('ready', 'processing')
ORDER BY ordered_at DESC, order_id DESC
LIMIT 8;
```

Rowfish executes the SQL you submit, including write statements. Review a statement before running it against a database that contains data you care about.

### MongoDB

Choose a collection in the sidebar, then enter a JSON filter for `find` or switch the query mode to **Aggregate** and enter a JSON array of pipeline stages. Rowfish reads documents in batches and keeps the configured row and byte limits. `$where`, `$function`, `$accumulator`, `$out` and `$merge` are blocked; aggregation pipelines cannot write data or invoke server-side JavaScript.

For the included demo collection, enter `orders` as the collection and use:

```json
{ "status": "ready" }
```

The MongoDB driver returns matching documents, including each document's `_id` field. Insert, update, delete, index and collection operations are available through the collection toolbar; updates use MongoDB update operators such as `$set` or `$inc`.

## Results, search and cancellation

Results arrive in batches and are shown in a virtualized grid. Choose a row limit from `500`, `1,000`, `5,000` or `10,000`; the default is `1,000`. The renderer retains no more than 10,000 rows and the normalized result payload is capped at **16 MB**. Individual cells are truncated at 8,192 characters, and the grid displays at most 100 columns.

The top-bar search filters rows already received in the current result set; it does not issue another database query. PostgreSQL statements use a 120-second `statement_timeout`; MongoDB reads use `maxTimeMS(120000)`.

Choosing **Cancel** terminates the worker to interrupt server-side work. Rowfish also closes that connection, so reconnect before running another query on it.

## Quick row edits

Select a PostgreSQL table in the explorer and run its unmodified generated `SELECT * ... LIMIT 100;` query. Click a result row to open the side panel beside the grid. It shows column types, nullability, defaults and primary keys alongside the row's values. Supported fields can be edited in place; **Set NULL** is separate from an empty string. **Save changes** writes the modified fields and refreshes that row in the grid. **Discard** restores the loaded values; **Reload** fetches the current database row. Unsaved edits prompt before closing the panel or moving to another result.

Edits require a real PostgreSQL table with a complete, safely represented primary key. Primary keys, generated/identity columns and unsupported column types are read only. Views, tables without a primary key, arbitrary SQL results (including joins/aliases) and MongoDB results remain inspectable but read only in this panel. Select the table and run the generated query again to enable safe editing; changing the query intentionally makes it read only.

The panel fetches full textual values separately rather than saving truncated grid values. Saves use parameterized SQL, database permissions, a transaction and a row-version check. If another session changes or deletes the row, the save fails without overwriting it; reload and review before trying again. Database validation errors leave your draft in the panel. Oversized values are rejected rather than silently truncated.

## Current scope

The query workspace provides persistent in-app tabs, draft autosave, a named query library with folder labels, searchable execution history, formatting, and schema-aware table/column autocomplete. No external SQL file is needed. The [UI review](ui-review.md) summarizes the comparison and boundaries.

Drafts, saved queries and history are stored in local application storage, not encrypted. Disable history recording in the History tab to stop recording subsequent query text; existing entries remain until cleared. Restoring a query never runs it automatically. Select a table to inspect its structure, indexes and constraints in the results pane.


Result headings support local sorting; click a row (or focus it and press Enter) to open its data and column schema in a side panel. CSV and JSON buttons export the currently filtered, already-fetched rows. CSV escapes spreadsheet formulas; JSON retains value types. Exports still obey row/cell/byte caps and are not full-database backups.

Saved-profile sync, SSH tunnels, a custom CA-file picker, PostgreSQL query parameters and transaction-control buttons are not included.

The checked-in [PostgreSQL seed script](examples/postgres.sql) and [MongoDB seed script](examples/mongodb.js) create matching fictional order examples for local demos. The [README](../README.md) previews use synthetic local records. Its PostgreSQL screenshot comes from the live disposable smoke-test fixture; no production database is used.

## Test against a database

1. Start the app with `bun run dev`.
2. Connect to a reachable PostgreSQL or MongoDB server using valid credentials; leave **Save this connection** enabled to test profile persistence.
3. For PostgreSQL, try both a direct database connection and **Browse all databases on this server**. Open an accessible database, select a table in the sidebar, and run the generated query.
4. Quit and relaunch. Confirm the saved profile remains visible, reconnect works, and live sessions are not automatically reopened.
5. Run a small read query or filter, change the row limit, try local result search, then choose **Cancel** and reconnect before another query.

Run `bun test`, `bun run typecheck` and `bun run build` for automated checks. `bun run test:smoke` launches the actual Electron app and expects the isolated local fixture described below. A successful live database session requires a reachable server and valid credentials.

## Repeat the desktop smoke test

The fixture must be a disposable **local** PostgreSQL database. Create login `rowfish_test` with password `rowfish_local_fixture`, and database `rowfish_fixture` owned by that login, then apply `scripts/smoke-fixture.sql` to that database. Do not use a production database.

Run `bun run test:smoke` on a desktop, or `xvfb-run -a bun run test:smoke` on Linux CI with Xvfb. The test uses a fresh temporary app profile and does not read personal saved connections. Test output and screenshots go to ignored `artifacts/`. Native macOS/Windows packaging and live MongoDB operations need their own platform checks.
