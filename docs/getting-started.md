# Getting started

Rowfish is a Bun-managed Electron app starter with a native Mac test page and two in-memory UI samples. The sample client screens are safe to explore: they do not make external service calls or persist demo content.

## Requirements

- macOS 13+ for the native translucency, Dock and tray checks (the CSS UI also runs on Linux and Windows)
- Bun 1.x
- Xcode Command Line Tools on Mac: `xcode-select --install`

## Run the app

```bash
bun install
bun run dev
```

Use the sidebar:

1. **Storage explorer** — inspect a mock account, search objects, open the sample connect dialog and try the upload placeholder.
2. **Quick capture** — search the sample inbox, write a capture, and save it to the current in-memory session (`⌘ Enter`).
3. **macOS & tray** — compare native vibrancy materials, send a notification, set/clear the Dock badge, hide/show the app and test tray recovery.
4. **UI components** — exercise the typed IPC ping and base form/dialog controls.
5. **Workflow example** — run an end-to-end sample that calls real system-info and notification APIs.

## Verify and package

```bash
bun run test       # shared demo logic tests
bun run typecheck  # renderer, preload, main, scripts and config
bun run build      # → out/{main,preload,renderer}/
bun run start      # launch the built application
bun run dist:mac   # unsigned DMG + ZIP, arm64 and x64
```

`bun run dist:mac` should be run on macOS for a native test package. Artifacts are written to `release/`; no signing identity is required for this local build. The resulting app is unsigned and may need the normal first-launch approval or quarantine removal for local testing. Do not distribute it as a signed product until you configure Developer ID signing and notarization.

## Change the starter identity

| File | Update |
|---|---|
| `package.json` | package name, version, description and `build.appId` / `build.productName` |
| `src/shared/config.ts` | `APP_NAME`, tagline, bundle id and window geometry |
| `src/renderer/index.html` | document title and app metadata |
| `build/` and `assets/` | app icon, menu-bar template icon and platform tray icon |
| `build/entitlements.mac.plist` | only the entitlements the derived app actually needs |

Keep secrets and service SDKs out of the renderer. For any real client, implement operations in `src/main/`, validate arguments at the IPC boundary, and expose only the required methods through `src/preload/index.ts`.

## Scripts

| Script | Purpose |
|---|---|
| `dev` | Wrapped electron-vite development session with terminal cleanup |
| `dev:bare` | Run electron-vite directly |
| `test` | Run Bun tests in `src/` |
| `typecheck` | Check application and build-tool TypeScript |
| `build` | Compile main, preload and renderer into `out/` |
| `start` | Launch the compiled app |
| `assets` | Regenerate the small tray PNGs without an image dependency |
| `dist:mac` | Package DMG and ZIP for Apple Silicon and Intel |
| `clean` | Remove `out/` and `release/` |
