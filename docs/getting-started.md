# Getting started

Rowfish is a desktop client for PostgreSQL and MongoDB.

## Run the app

Requirements: Bun 1.x.

```bash
bun install
bun run dev
```

## Connect and query

1. Choose **New connection**.
2. Select PostgreSQL or MongoDB and enter the host, port, database, and credentials.
3. Choose **Connect**. Credentials remain in memory and are not saved to disk.
4. Enter a SQL statement or MongoDB JSON filter, then choose **Run query**. `⌘ Enter` (or `Ctrl+Enter`) also runs it.
5. Filter received rows with the search field. It searches the current result locally and does not send another query.

Queries run in worker threads. Results are limited by the selected row cap and a 16 MB payload cap. See [Database client](database-client.md) for supported operations and limits.

## Verify

```bash
bun run test
bun run typecheck
bun run build
```
