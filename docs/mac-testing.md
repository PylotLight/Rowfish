# Mac testing checklist

Use a physical or virtual macOS machine for these checks. Linux builds validate types and bundles but cannot validate AppKit translucency, macOS permissions, Dock behavior or the menu bar.

## Launch and identity

- [ ] `bun install` completes and downloads Electron.
- [ ] `bun run dev` launches Rowfish without a white/opaque window or console errors.
- [ ] Rowfish appears in the Dock with its own icon; the menu-bar icon adapts to light and dark menu bars.
- [ ] A second launch focuses the existing window rather than spawning a second app window.
- [ ] Close the window, restore it from the tray menu, then quit from the tray menu.

## Database client and quick capture

- [ ] **Database client:** connect to a reachable PostgreSQL server with `SELECT 1 AS ok;`; verify the live connection appears in the rail.
- [ ] Connect to a reachable MongoDB server, enter a collection and `{}` filter, then verify returned documents appear in the grid.
- [ ] Run `SELECT generate_series(1, 5000) AS row_id;`; confirm rows arrive in batches, the UI remains responsive, and only visible rows are rendered.
- [ ] Change row limits and search received results in the top bar; confirm search is local and does not launch another database query.
- [ ] Start `SELECT pg_sleep(10);`, press **Cancel**, verify the query stops, the connection closes, and reconnecting restores query ability.
- [ ] Submit malformed MongoDB JSON and a nested `$where` filter; verify both are rejected safely with readable errors.
- [ ] Switch away from the Database client and back during a query; confirm the connection/results remain available and the rest of the app stays responsive.
- [ ] Open a connection with unreachable host/port; verify timeout/error feedback appears without locking the app. Confirm passwords are not displayed or persisted.
- [ ] Check that the 10,000-row / 16 MB output bounds, 120-second server timeout and 8-connection ceiling are enforced.
- [ ] **Quick capture:** search filters the sample inbox, selecting a note updates the editor, blank captures are rejected, and `⌘ Enter` saves a capture while the view remains open.
- [ ] Add a capture, leave the section and return; confirm added notes reset because the sample has no persistence.
- [ ] Resize to the minimum window size and confirm the workspace remains readable.
- [ ] Quit and relaunch; confirm the database connection list is empty and no credentials are restored.

## Workflow and component samples

- [ ] **Workflow example:** run the staged sample, confirm system details appear in the log, and verify notification behavior (macOS notification settings may suppress banners).
- [ ] Cancel a workflow while a simulated step is running and confirm it stops cleanly.
- [ ] **UI components:** send the IPC ping and verify `pong`; exercise the controls and dismiss the sample confirmation dialog.

## Native Mac behavior

- [ ] Red/yellow/green controls are inset and do not overlap the sidebar brand.
- [ ] Change vibrancy materials and inspect the window over light and dark desktop backgrounds.
- [ ] Turn vibrancy off and on; renderer text and controls remain legible.
- [ ] Send a notification and confirm macOS delivers it (notification settings may suppress banners).
- [ ] Set and clear a Dock badge.
- [ ] Hide the window, hide the app, and enter tray-only mode; use tray **Show window** to restore each case.
- [ ] Use `⌘H` and Quit to check expected macOS conventions.
- [ ] Open DevTools and check for preload/IPC errors; restart after preload edits.

## Build both Mac architectures

On macOS:

```bash
bun run test
bun run typecheck
bun run build
bun run dist:mac
ls -lh release/Rowfish-*-mac-*.{dmg,zip}
```

The targets are Apple Silicon (`arm64`) and Intel (`x64`). Run the arm64 artifact on Apple Silicon; run x64 on Intel or under Rosetta when available. Packages are unsigned and not notarized. Signing, notarization and release publishing require the app owner's own Apple Developer setup.
