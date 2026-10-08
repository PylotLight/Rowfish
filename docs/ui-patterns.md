# UI patterns

Rowfish combines reusable desktop layout ideas from the neighboring **Blobfish** and **Inkfish** apps while keeping their product logic out of this starter.

## Storage explorer sample

The Blobfish-inspired screen uses an account/quick-access rail beside a focused object browser. Search, breadcrumbs, metadata and explicit selection keep navigation scannable. A connect dialog demonstrates the visual flow without asking for credentials. Connect/upload feedback is a placeholder: this sample has no storage SDK and makes no service requests.

## Quick capture sample

The Inkfish-inspired screen uses a low-friction capture composer, inbox list and focused editor. Captures accept plain text or Markdown and can be saved with `⌘ Enter`. Notes exist in React state only; closing the app discards them. There is no vault, database, AI or sync service.

## Shared shell

The sidebar, title region, translucent panels, compact metadata labels, selected-row treatment and local notification banners use a consistent theme. The Mac & tray page composes common macOS conventions—translucent `BrowserWindow`, inset traffic lights, a status-bar item and recoverable hidden windows—into one isolated test lab.

## Replacing a sample with a real client

Keep view components focused on rendering and interaction. Add service operations to Electron's main process, validate untrusted renderer payloads at IPC boundaries, and expose only a narrow typed API through the preload bridge. Never put account keys, SAS tokens or other secrets in renderer state. The Connect sample dialog has no credential field by design.
