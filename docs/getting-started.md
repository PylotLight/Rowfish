# Getting started

Rowfish is a desktop query client for PostgreSQL and MongoDB. You can run it against a local database or a server you already have access to.

## Run the app

Install [Bun](https://bun.sh/) 1.x, then from the repository root run:

```bash
bun install
bun run dev
```

## Try the synthetic demo data

The repository includes eight fictional orders in both database formats. The seed scripts add their sample table or documents without dropping other tables or collections. Use a disposable local database if you want to keep the demo isolated.

For PostgreSQL, create a database and load the rows:

```bash
createdb rowfish_demo
psql -d rowfish_demo -f docs/examples/postgres.sql
```

For MongoDB, load the matching documents into `rowfish_demo.orders`:

```bash
mongosh 'mongodb://localhost:27017' --file docs/examples/mongodb.js
```

If your local server requires authentication, use the credentials for that server when connecting in Rowfish; the sample files do not include credentials.

## Connect and run a query

1. Choose **New connection**, then select PostgreSQL or MongoDB.
2. Enter your server host and port, the database name `rowfish_demo`, and any credentials required by your local server. The usual ports are `5432` for PostgreSQL and `27017` for MongoDB.
3. Choose **Connect**. Rowfish keeps the connection details and credentials in memory for the current session; it does not save or restore connections.
4. In PostgreSQL, query the `orders` table. In MongoDB, set the collection to `orders` and enter a JSON `find` filter, such as `{ "status": "ready" }`.
5. Choose **Run query** or press `⌘ Enter` (`Ctrl+Enter` on Windows/Linux). Use the top-bar field to filter rows already received; it does not send a new query to the server.

See [Database client](database-client.md) for query behavior, limits and current scope. [Architecture](architecture.md) describes how database work is isolated from the renderer.

## Verify a change

```bash
bun run test
bun run typecheck
bun run build
```
