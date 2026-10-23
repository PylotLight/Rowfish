# Database client

Rowfish connects to PostgreSQL and MongoDB when you enter connection details and choose **Connect**. The connection dialog saves profiles by default so they remain available between app sessions. Saved profiles are not live sockets: after a restart, choose a saved server in the sidebar to reconnect.

## Save and reconnect

The dialog has two modes, chosen with the **Connection string | Manual** toggle at the top. It reopens in whichever mode you used last (connection string the first time).

- **Connection string**: paste a URI and Rowfish works out the database type from its scheme: `postgres://` or `postgresql://` is PostgreSQL, `mongodb://` or `mongodb+srv://` is MongoDB. There is no type dropdown; a small badge shows what was detected (for example _Detected: PostgreSQL_). An empty string or an unknown scheme shows an inline hint and keeps **Connect**, **Test & Save** and **Save without testing** disabled until the scheme is recognised.
- **Manual**: choose the database type, then fill in host, port, database and optional username/password, with a live preview of the matching connection string. PostgreSQL defaults to port `5432`; MongoDB defaults to `27017`. PostgreSQL has an **SSL mode** picker with the libpq modes; MongoDB has a **Require TLS** toggle (certificate-verified, trusted by the operating system).

Switching modes carries the values across: going to **Connection string** starts from a string built from the fields, and going back to **Manual** keeps the type, host, port, database and credentials parsed from the string. When a pasted string changes the type, the port and database fall back to that type's defaults until the rest of the string parses.

Profile metadata is stored in Rowfish's app-specific user-data directory. If you save a password, Electron `safeStorage` encrypts it using the operating system credential store. Rowfish does not fall back to plaintext password storage; if secure storage is unavailable, turn off **Save this connection** to connect for the current session only. Choosing **Forget** removes the saved profile but does not disconnect an already-open session.

For a quick MongoDB connection, choose **Connection string**, paste a standard `mongodb://` or `mongodb+srv://` URI, enter a display name, and choose **Connect**. The URI is passed to the MongoDB driver intact so options such as replica sets, Atlas SRV discovery, authentication source and TLS settings are retained. When saving is enabled, the full URI is encrypted as a secret and is never returned to the renderer after connection.

PostgreSQL works the same way: paste a `postgres://` or `postgresql://` URI. Query options such as `application_name` or `connect_timeout` are passed to node-postgres as written (TLS options are handled by Rowfish, see below), and the string is saved as an encrypted secret like a MongoDB URI. While you edit the regular fields, the dialog shows the matching connection string (password hidden, **Copy** copies the real value); switching to **Connection string** starts from that string, and editing or pasting a string fills the fields back in. An invalid string shows an inline hint and leaves the fields at their last valid values. Options the fields cannot express (extra query options, SRV lookup, multiple MongoDB hosts) apply only while connecting with the string.

The dialog footer has three ways to finish:

- **Connect** opens the connection now; with **Save this connection** ticked it also saves the profile once connected. A failed Connect just shows the error.
- **Test & Save** opens a throwaway connection, runs `SELECT 1` (PostgreSQL) or `ping` (MongoDB) and closes it again. If the server answers, the profile is saved (password or connection string encrypted with the OS credential store) and the dialog closes with the server version and round trip; nothing is added to the workspace. If the test fails, the error appears inline with **Save anyway**, which saves the profile as entered.
- **Save without testing** saves the profile straight away with no connection attempt, for a server that is not reachable yet (VPN down, staging not up). Open it later from saved connections.

Each live connection uses a worker. Rowfish supports up to **8 active connections**, including PostgreSQL server-browser and opened database sessions.

## Edit, rename and collapse

Hover a saved server (or a live card opened from one) and click the pencil to edit it. The dialog opens as **Edit connection** with every field filled in, password or connection string included, in the mode it was saved with. **Save** writes the changes over the same profile; **Test & Save** checks the server first. A rename shows up on open sessions straight away; host, credential or TLS changes apply the next time you connect.

Click a connection card to select it; click the selected card again to fold its tables or databases away, and again to unfold them.

## PostgreSQL server browser

To browse multiple databases on one PostgreSQL server, choose **Browse all databases on this server** instead of entering a database name. Rowfish uses the `postgres` maintenance database to list databases and indicates which ones the current PostgreSQL user can connect to. Select an accessible database in the sidebar to open a separate session; Rowfish then lists its tables and views by schema.

This mode does not grant database access or bypass PostgreSQL permissions. It depends on being able to connect to the server's `postgres` maintenance database; if that is unavailable, connect directly to a database you can access instead. A direct PostgreSQL connection also shows its tables and views in the sidebar. Select a table to place a schema-qualified `SELECT * ... LIMIT 100` starter query in the editor; review it before running.

## PostgreSQL TLS (sslmode)

Rowfish follows libpq's `sslmode` rules, in the SSL mode picker or as `?sslmode=` in a connection string:

- **Prefer** (default, and what you get with no `sslmode`): tries TLS first without checking the certificate, and falls back to a plain connection if the server has TLS turned off. Same as `psql`.
- **Require**: always encrypts, doesn't check the certificate. With `sslrootcert` it checks the chain like Verify CA.
- **Verify CA**: encrypts and checks the certificate chain against the OS trust store or `sslrootcert`, but not the host name. Handy for servers reached by IP.
- **Verify full**: also checks the host name.
- **Disable**: never encrypts.

`sslrootcert`, `sslcert` and `sslkey` in a connection string are read as local file paths. `allow` is treated as prefer, and node-postgres's `no-verify` / `ssl=no-verify` as require. Profiles saved before this used a single TLS toggle: on now means Verify full, off now means Prefer, so servers that only allow encrypted connections work without re-saving. TLS-related connection errors (for example `pg_hba.conf … no encryption` or a self-signed certificate) come with a hint about which mode to pick.

## Switch databases on a PostgreSQL connection

A normal (single-database) PostgreSQL connection has a switcher on its sidebar card. Hover the card and click the ⇅ button to open the database list under the card. It shows every database on the server, marks the current one with ✓ and greys out ones the user lacks CONNECT on. Lists over six get a filter box (Enter picks the first match, Escape closes). Picking one opens a new session on that database with the same credentials and saved profile, then closes the old one, so a failed switch leaves you where you were. Each database keeps its own query tab, so flipping back brings your old draft back. Switching is blocked while a query is running.

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

Pick the collection from the **database › collection** dropdown in the editor toolbar (it lists the collections of the database open in the sidebar; switching keeps your query and reruns it there), or click one in the sidebar. An empty editor runs as `{}` in Find (the whole collection) or `[]` in Aggregate.

The editor takes strict JSON or mongosh-style syntax: unquoted keys, single quotes, trailing commas, `//` comments, `ObjectId("…")`, `ISODate("…")` / `new Date("…")`, `NumberLong`, `NumberInt`, `NumberDecimal`, `UUID` and `/regex/i`. Extended JSON (`{"$oid": "…"}`, `{"$date": "…"}`) works too, so filtering by `_id` or a date matches real BSON values.

Autocomplete knows where the cursor is: field names (sampled from the collection plus the current results) and query operators in Find and `$match`, operators like `$gt`/`$in` under a field, pipeline stages at the top of an Aggregate (with templates for `$lookup`, `$group` and friends), accumulators inside `$group` outputs, `"$field"` paths in expressions, collection names for `$lookup.from`, and value helpers like `{ "$in": [] }` or `ObjectId("…")`. Ctrl-Space opens it anywhere.

The collection bar above the tabs shows the collection, its type, rough document count and index count; click it to unfold indexes, validator and options (folded by default, remembered). **Insert** and **Update** sit beside it; **Create index**, **Delete documents** and **Drop collection** live in the ⋯ menu, and each destructive one still needs its own confirmation (a review tick, or typing the collection name).

For the included demo collection, enter `orders` as the collection and use:

```json
{ "status": "ready" }
```

The MongoDB driver returns matching documents, including each document's `_id` field. Insert, update, delete, index and collection operations are available through the collection toolbar; updates use MongoDB update operators such as `$set` or `$inc`.

## Results, search and cancellation

Results arrive in batches and are shown in a virtualized grid. Choose a row limit from `500`, `1,000`, `5,000` or `10,000`; the default is `1,000`. The renderer retains no more than 10,000 rows and the normalized result payload is capped at **16 MB**. Individual cells are truncated at 8,192 characters, and the grid displays at most 100 columns.

The top-bar search filters rows already received in the current result set; it does not issue another database query. Each column header also has a filter button (Excel-style): sort either way, type a condition (plain text means contains; `>10`, `<=2026-01-01`, `!=ready`, `=null` compare), and tick or untick values from the list of distinct values with their counts. Filters combine across columns and with the search, the row count shows filtered / total, and **Clear filters** resets them. CSV/JSON export uses the filtered rows. A new query clears the filters. PostgreSQL statements use a 120-second `statement_timeout`; MongoDB reads use `maxTimeMS(120000)`.

Choosing **Cancel** terminates the worker to interrupt server-side work. Rowfish also closes that connection, so reconnect before running another query on it.

## Quick row edits

Select a PostgreSQL table in the explorer and run its unmodified generated `SELECT * ... LIMIT 100;` query. Click a result row to open the side panel beside the grid. It shows column types, nullability, defaults and primary keys alongside the row's values. Supported fields can be edited in place; **Set NULL** is separate from an empty string. **Save changes** writes the modified fields and refreshes that row in the grid. **Discard** restores the loaded values; **Reload** fetches the current database row. Unsaved edits prompt before closing the panel or moving to another result.

Edits require a real PostgreSQL table with a complete, safely represented primary key. Primary keys, generated/identity columns and unsupported column types are read only. Views, tables without a primary key, arbitrary SQL results (including joins/aliases) and MongoDB results remain inspectable but read only in this panel. Select the table and run the generated query again to enable safe editing; changing the query intentionally makes it read only.

The panel fetches full textual values separately rather than saving truncated grid values. Saves use parameterized SQL, database permissions, a transaction and a row-version check. If another session changes or deletes the row, the save fails without overwriting it; reload and review before trying again. Database validation errors leave your draft in the panel. Oversized values are rejected rather than silently truncated.

## Current scope

The query workspace provides persistent in-app tabs, draft autosave, a named query library with folder labels, searchable execution history, formatting, and schema-aware table/column autocomplete. No external SQL file is needed. The [UI review](ui-review.md) summarizes the comparison and boundaries.

Drafts, saved queries and history are stored in local application storage, not encrypted. Disable history recording in the History tab to stop recording subsequent query text; existing entries remain until cleared. Restoring a query never runs it automatically. Select a table to inspect its structure, indexes and constraints in the results pane.

Result headings support local sorting; click a row (or focus it and press Enter) to open its data and column schema in a side panel. CSV and JSON buttons export the currently filtered, already-fetched rows. CSV escapes spreadsheet formulas; JSON retains value types. Exports still obey row/cell/byte caps and are not full-database backups.

The window reopens at its last size and position (and maximised or full screen if you left it that way), saved to `window-state.json` in the app data folder. If the display it was on is unplugged it opens centred on the main one instead.

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
