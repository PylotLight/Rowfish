# Rowfish

A reusable **Bun + Electron + React + TypeScript** desktop foundation, tuned for testing a polished macOS window and two proven client layouts: a Blobfish-style storage explorer and an Inkfish-style quick-capture inbox.

The Explorer and Capture sections are **UI samples only**. They use mock data in the renderer and do not connect to Azure, read a vault, or save notes to disk. Native controls in the Mac & tray section are real Electron calls.

## Quick start

Requirements: macOS 13+ for the native Mac checks, [Bun](https://bun.sh/), and Xcode Command Line Tools. From a checkout:

```bash
bun install
bun run dev
```

Open the sidebar's **Storage explorer** and **Quick capture** entries to test the two sample client patterns. Use **macOS & tray** to verify vibrancy, the menu-bar icon, Dock actions, notifications, and hiding/restoring the window. See [docs/mac-testing.md](docs/mac-testing.md) for the full checklist.

## Verify and package

```bash
bun run test
bun run typecheck
bun run build
bun run dist:mac
```

`dist:mac` creates unsigned `.dmg` and `.zip` packages for **Apple Silicon (`arm64`) and Intel (`x64`)** in `release/`. Unsigned local builds may be blocked by Gatekeeper; signing and notarization are intentionally left to the app owner. This repository was built and checked in a Linux environment, so run the native launch/permission checks on your Mac.

## Included foundation

- Translucent macOS BrowserWindow with live Electron vibrancy switching; CSS fallback elsewhere
- Menu-bar tray, Dock badge/hide/restore, notification and window lifecycle examples
- Typed `contextBridge`/IPC surface, single-instance lock, secure renderer defaults
- Explorer and capture layouts inspired by the reusable UI patterns in **Blobfish** and **Inkfish**
- Local-only sample workflows, responsive layouts, smoke tests, and CI
- Mac packaging configuration for both supported Mac architectures

## Make Rowfish yours

Update `package.json`, `src/shared/config.ts`, `src/renderer/index.html`, the app/tray icons in `build/` and `assets/`, plus the macOS bundle identifier before distributing a derived app. Add real service logic only in the main process and expose the narrowest required API from the preload bridge.

## Documentation

- [Getting started](docs/getting-started.md)
- [Mac test checklist](docs/mac-testing.md)
- [Mac packaging and releases](docs/releasing.md)
- [UI pattern notes](docs/ui-patterns.md)
- [Architecture](docs/architecture.md)
- [Vibrancy and tray behavior](docs/vibrancy-and-tray.md)
- [Troubleshooting](docs/troubleshooting.md)

MIT licensed. See [LICENSE](LICENSE).
