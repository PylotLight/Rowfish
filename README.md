# Rowfish

Rowfish is a desktop query client for PostgreSQL and MongoDB, built with Electron, React, and TypeScript.

Connect to a database, run SQL or MongoDB filters, and inspect results in a virtualized grid. Connections are opened only when you choose **Connect**; credentials stay in memory for the session and are not saved to disk.

## Run

Requirements: [Bun](https://bun.sh/) 1.x.

```bash
bun install
bun run dev
```

## Query

- **PostgreSQL:** run one SQL statement at a time.
- **MongoDB:** query a collection with a JSON `find` filter.
- Search received rows locally, choose a result limit, and cancel a running query.
- Connections run in isolated workers. Results are bounded to 10,000 rows / 16 MB; queries time out after 120 seconds.

See [Database client](docs/database-client.md) for connection, query, and limit details.

## Verify and package

```bash
bun run test
bun run typecheck
bun run build
bun run start
bun run dist:mac
```

`dist:mac` creates unsigned DMG and ZIP builds for Apple Silicon and Intel. See [Mac testing](docs/mac-testing.md), [Releasing](docs/releasing.md), and [Troubleshooting](docs/troubleshooting.md).

## Project docs

- [Getting started](docs/getting-started.md)
- [Database client](docs/database-client.md)
- [Architecture](docs/architecture.md)
- [Mac testing](docs/mac-testing.md)
- [Releasing](docs/releasing.md)
- [Troubleshooting](docs/troubleshooting.md)

MIT licensed. See [LICENSE](LICENSE).
