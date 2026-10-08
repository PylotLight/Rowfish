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
2. Enter your server host and port, the database name `rowfish_demo`, and any credentials required by your local server. The usual ports are `5432` for PostgreSQL and `27017` for MongoDB. For PostgreSQL servers with multiple databases, select **Browse all databases on this server** instead of entering a database name.
3. Leave **Save this connection** selected if you want the profile available after restarting Rowfish. Passwords are stored only when the operating system credential store can encrypt them; otherwise, turn saving off for a session-only connection.
4. Choose **Connect**. In server-browser mode, select an accessible database from the sidebar. Rowfish lists its tables and views; choose a table to prepare a starter SQL query. A direct PostgreSQL connection also lists its tables.
5. In MongoDB, set the collection to `orders` and enter a JSON `find` filter, such as `{ "status": "ready" }`.
6. Choose **Run query** or press `⌘ Enter` (`Ctrl+Enter` on Windows/Linux). Use the top-bar field to filter rows already received; it does not send a new query to the server.

See [Database client](database-client.md) for query behavior, limits and current scope. [Architecture](architecture.md) describes how database work is isolated from the renderer.

## Verify a change

```bash
bun run test
bun run typecheck
bun run build
```
