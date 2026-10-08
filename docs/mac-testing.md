# Mac testing checklist

Use macOS to verify native window behavior and packaging. Database connection tests require reachable PostgreSQL or MongoDB servers.

## App and database

- [ ] `bun install` and `bun run dev` complete without startup or renderer errors.
- [ ] A second launch focuses the existing window.
- [ ] Connect to PostgreSQL and run `SELECT 1 AS ok;`; verify the connection and result row appear.
- [ ] Connect to MongoDB, enter a collection and `{}` filter, and verify returned documents appear.
- [ ] Run `SELECT generate_series(1, 5000) AS row_id;`; confirm rows stream in batches and the UI stays responsive.
- [ ] Change the row limit and filter received rows; confirm filtering is local.
- [ ] Start `SELECT pg_sleep(10);`, choose **Cancel**, verify the query stops and the connection closes, then reconnect.
- [ ] Submit malformed MongoDB JSON and a nested `$where` filter; verify safe, readable errors.
- [ ] Try an unreachable host/port and confirm an error appears without locking the app. Confirm credentials are not displayed or persisted.
- [ ] Check the 10,000-row / 16 MB bounds, 120-second query timeout, and 8-connection ceiling.
- [ ] Resize the window and verify the connection rail, editor, and results remain usable.
- [ ] Quit and relaunch; confirm connections and credentials are not restored.
- [ ] Verify `⌘H`, window close, and Quit behave as expected.

## Build both Mac architectures

```bash
bun run test
bun run typecheck
bun run build
bun run dist:mac
ls -lh release/Rowfish-*-mac-*.{dmg,zip}
```

The targets are Apple Silicon (`arm64`) and Intel (`x64`). Packages are unsigned and not notarized; signing and notarization require the app owner's Apple Developer setup.
