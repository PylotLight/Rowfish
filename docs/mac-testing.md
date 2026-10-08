# Mac testing checklist

Use a physical or virtual macOS machine for these checks. Linux builds validate types and bundles but cannot validate AppKit translucency, macOS permissions, Dock behavior or the menu bar.

## Launch and identity

- [ ] `bun install` completes and downloads Electron.
- [ ] `bun run dev` launches Rowfish without a white/opaque window or console errors.
- [ ] Rowfish appears in the Dock with its own icon; the menu-bar icon adapts to light and dark menu bars.
- [ ] A second launch focuses the existing window rather than spawning a second app window.
- [ ] Close the window, restore it from the tray menu, then quit from the tray menu.

## Both client UI samples

- [ ] **Storage explorer:** sidebar and object selection work, global search filters objects, the connect dialog opens and closes, and local connect/upload notices appear.
- [ ] **Quick capture:** search filters the sample inbox, selecting a note updates the editor, blank captures are rejected, and `⌘ Enter` saves a capture for the current session.
- [ ] Resize to the minimum window size and confirm both sample layouts remain readable.
- [ ] Quit and relaunch; confirm sample data resets because it is intentionally in memory only.

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
