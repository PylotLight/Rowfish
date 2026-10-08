# UI patterns

Rowfish is a PostgreSQL and MongoDB desktop client with a Mac-first shell. The database workspace makes real connections when requested; the quick-capture and Workflow views remain local or illustrative samples unless a section explicitly demonstrates a native Electron API.

## Overview

![Rowfish Overview](images/overview.png)

The Overview is the landing page, with a link to the database client and live platform details returned by the system-info API. The screenshot was captured on Linux, so it shows the CSS fallback rather than macOS window translucency.

## Database client

The database workspace combines a connection rail, focused query editor, explicit row limit and result grid. PostgreSQL uses a cursor; MongoDB uses a `find` filter. Each live connection runs in a dedicated Node worker, streams result chunks of 100 rows, applies row/byte/time bounds, and can be cancelled by terminating its worker and closing that connection. The top-bar search filters rows already received. Passwords are not persisted.

The image below is the earlier local storage-layout study, not a screenshot of a live database session.

![Earlier storage explorer layout study](images/storage-explorer.png)

See [Database client](database-client.md) for setup, safety limits and adapter scope.

## Quick capture sample

The Inkfish-inspired screen uses a low-friction capture composer, inbox list and focused editor. Captures accept plain text or Markdown and can be saved with `⌘ Enter`. Notes exist in React state only; leaving the view resets added notes. There is no vault, database, AI or sync service.

![Quick capture local sample](images/quick-capture.png)

## Shared shell and other examples

The sidebar, title region, translucent panels, compact metadata labels, selected-row treatment and local notification banners use a consistent theme. The **macOS & tray** page is a test lab for native `BrowserWindow` translucency, menu-bar behavior and recoverable hidden windows, with a CSS fallback on other platforms.

The **UI components** page exercises the typed IPC bridge, version reporting, form controls and a sample confirmation dialog. The **Workflow example** shows a visible plan and activity log; it uses actual system-info and notification APIs, while its timed planner steps are illustrative rather than an AI service.

## Keeping heavy work responsive

Keep views focused on rendering and interaction. Validate untrusted renderer payloads at IPC boundaries, expose only a narrow typed API through preload, and move database driver work and result normalization to workers. Stream bounded batches and virtualize the result table rather than rendering an unbounded result in one React update. Credentials are in-memory only. See [Architecture](architecture.md) for the process boundary.
