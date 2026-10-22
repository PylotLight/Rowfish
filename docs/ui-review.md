# A more capable Rowfish workbench

This sweep takes its cues from the user’s Beekeeper Studio reference: a searchable object tree, a real editor with inline completion, and query text that stays in the app between sessions.

## What changed

- **Electron 45.0.0.** Context isolation stays enabled and Node integration is disabled. A CommonJS preload supports Chromium sandboxing.
- **Persistent query tabs.** Draft text, tab names, and the active tab restore locally. SQL files are optional exports, not a prerequisite for keeping work.
- **A real code editor.** CodeMirror provides syntax highlighting, line numbers, bracket matching, undo, autocomplete, statement/selection execution, and whole-editor execution. SQL formatting is built in.
- **Query management.** An internal library stores named queries with folder labels. Searchable history records execution status, timing, and connection context. History recording can be disabled and history cleared.
- **An explorer rather than a flat connection list.** Saved servers, PostgreSQL databases, schemas, tables/views, object filtering, refresh, and collapsible schemas stay close to the editor. Existing MongoDB database/collection workflows remain available.
- **PostgreSQL inspection.** Tables expose columns, types, defaults, nullability, primary keys, indexes, and constraints. Metadata requests retain connection ownership checks and bounded worker timeouts.
- **Usable result tools.** Virtualized rows, local filtering and sorting, CSV/JSON exports, distinct NULL styling, and a double-click row inspector improve everyday analysis.
- **Responsive editing.** Autosave writes are debounced and flushed when leaving, autocomplete indexes columns once per catalog refresh, and formatter code loads on demand. Database work stays off the UI thread.
- **Denser layout.** Compact chrome, a hideable sidebar, a vertically resizable editor, clear result sections, visible focus, and reduced-motion handling give more space to SQL and data.

## References behind the choices

[Beekeeper Studio’s editor](https://docs.beekeeperstudio.io/user_guide/sql_editor/editor/) documents table/column completion, run contexts, and query history. Those are the core interaction patterns for this sweep—not a pixel-for-pixel clone.

[TablePlus history](https://docs.tableplus.com/query-editor/query-history) demonstrates searchable connection-context execution history and reuse in an editor rather than silently executing an old query.

[Postico 2](https://eggerapps.at/postico/) emphasizes persistent query work, formatting, and a table-centric workspace. Rowfish keeps drafts internally rather than requiring an external SQL file.

[DBeaver’s navigator](https://dbeaver.com/docs/dbeaver/Database-Navigator/) provides the hierarchy/filter/refresh model for exploring servers and database objects.

## Important boundaries

Query text, saved SQL, and history are local application data, **not encrypted secrets**. Do not put passwords or sensitive literal values in them. Connection passwords continue to use the existing OS-encrypted storage path; TLS certificate verification stays enabled.

The current grid is a query result viewer, not a PostgreSQL row editor. This sweep does not claim SSH tunneling, import/backup tooling, graphical schema modification, an ER diagram editor, an AI assistant, production connection protections, or a transaction-control UI. SQL executes with the connected user’s permissions; it is not automatically read-only or automatically rolled back. Cancellation currently closes the active database session.

Native title-bar and packaging behavior still need macOS and Windows validation; the available desktop verification environment is Linux. Saved queries use folder labels, not a drag-and-drop filesystem.
