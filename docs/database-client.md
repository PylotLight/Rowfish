# Database client

Rowfish connects to PostgreSQL and MongoDB only after you enter connection details and choose **Connect**. It does not maintain a saved-connection vault.

## Connect

Provide a display name, database type, host, port, database and optional username/password. PostgreSQL defaults to port `5432`; MongoDB defaults to `27017`. The **Require TLS** option enables certificate-verified TLS; certificates must be trusted by the operating system.

Connection details and credentials are passed through the typed Electron bridge and held in application and worker memory only. They are not written to disk or restored after restart. Closing a connection or the app terminates the worker and releases its in-memory credentials. Rowfish allows up to **8 active connections**.

## Run a query

### PostgreSQL

Enter one SQL statement. Rowfish fetches rows through a PostgreSQL cursor in batches of 100. The editor does not provide query parameters or multi-statement scripts.

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

Enter a collection name and a JSON document filter. Rowfish runs `find` and reads documents in batches; the query editor does not expose aggregation pipelines or write operations. The `$where` JavaScript filter operator is disabled.

For the included demo collection, enter `orders` as the collection and use:

```json
{ "status": "ready" }
```

The MongoDB driver returns the matching documents as-is, including each document's `_id` field.

## Results, search and cancellation

Results arrive in batches and are shown in a virtualized grid. Choose a row limit from `500`, `1,000`, `5,000` or `10,000`; the default is `1,000`. The renderer retains no more than 10,000 rows and the normalized result payload is capped at **16 MB**. Individual cells are truncated at 8,192 characters, and the grid displays at most 100 columns.

The top-bar search filters rows already received in the current result set; it does not issue another database query. PostgreSQL statements use a 120-second `statement_timeout`; MongoDB reads use `maxTimeMS(120000)`.

Choosing **Cancel** terminates the worker to interrupt server-side work. Rowfish also closes that connection, so reconnect before running another query on it.

## Current scope

Rowfish does not yet include saved connections, connection-string import, SSH tunnels, a custom CA-file picker, connection sync, result export, PostgreSQL query parameters or multi-statement execution. MongoDB aggregation, update and delete operations are not exposed. The row cap is not a full export workflow.

The checked-in [PostgreSQL seed script](examples/postgres.sql) and [MongoDB seed script](examples/mongodb.js) create matching fictional order examples for local demos. The screenshots in the [README](../README.md) use these same synthetic records; they are interface previews, not live database sessions.

## Test against a database

1. Start the app with `bun run dev`.
2. Connect to a reachable PostgreSQL or MongoDB server using valid credentials.
3. Run a small read query or filter and confirm that rows arrive in batches.
4. Change the row limit, try local result search, then choose **Cancel** and reconnect before another query.

Unit tests and build checks cover contracts, filter restrictions, bounds and worker startup/error handling. A successful live database session still requires a reachable server and valid credentials.
