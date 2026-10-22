# A clearer, more capable Rowfish

Rowfish pairs a quiet Mac-inspired workspace with practical PostgreSQL tools. This update adds a true-black AMOLED appearance, more readable typography, and query-plan inspection without giving up the existing tabs, schema explorer, query history, or safe table-row editor.

## Appearance that works for long sessions

**Glass** keeps the native macOS translucent window and uses restrained mint accents, layered surfaces, and clear borders. **AMOLED** replaces the main working surfaces with opaque black; it is not simply a darker blue theme. Appearance preferences stay on this device and restore when the app opens.

Controls, metadata, tabs, and result text are larger than the previous compact workbench. Comfortable and compact text settings let you choose readability or density. Focus indicators, reduced-motion support, and reduced-transparency handling remain part of the design. Platform-native vibrancy still needs a real macOS check: Linux Electron testing cannot establish how macOS composites the window.

## Understand a PostgreSQL query before running it

The **Explain** action requests a PostgreSQL estimated plan using `EXPLAIN (FORMAT JSON)`, without `ANALYZE`. The plan viewer shows the operator hierarchy, relations, estimated row counts, and planner costs, with raw JSON available for inspection. Planner cost is not a measured time, and estimated rows are not actual rows.

Explain handles one supported statement at a time. It does not run the editor as a script, accept an existing `EXPLAIN ANALYZE`, or change your SQL draft. Ordinary SQL execution still uses the connected user's permissions; Explain is a planning aid, not a security sandbox or a guarantee against effects from unusual server-side planning functions.

## Useful PostgreSQL starting points

PostgreSQL diagnostic shortcuts open SQL drafts for active sessions, table and index sizes, index usage, and blocking locks. They do **not** run automatically. Review the SQL and use Run when ready. Visibility depends on your PostgreSQL version and role privileges; missing statistics or restricted query text are not client errors.

## Keep the good foundations

The existing workbench already provides persistent query tabs, table/column autocomplete, SQL formatting, current-statement or selected-text execution, saved queries, searchable execution history, a searchable schema explorer, column/index/constraint metadata, bounded streaming results, filtering, sorting, CSV/JSON export, and cancellation. MongoDB browsing and guarded mutation tools remain available.

Single-click a result row to inspect it beside the grid. Rows opened from the exact table-browser query can be edited when the table has a suitable primary key. Updates use an optimistic concurrency check; arbitrary query results remain read-only. NULL and an empty string stay distinct.

## What inspired the changes

[pgAdmin's Query Tool](https://www.pgadmin.org/docs/pgadmin4/latest/query_tool.html) brings SQL execution, history, result inspection, and explain plans into one workflow. Rowfish adopts the estimated-plan inspection pattern without adding automatic `ANALYZE` execution.

[Beekeeper Studio](https://www.beekeeperstudio.io/) emphasizes an approachable editor, many tabs, schema completion, saved work, and easy data browsing. These remain core Rowfish interactions rather than separate admin screens.

[TablePro](https://tablepro.app/compare/beekeeper-studio) emphasizes a Mac-native presentation, dark mode, and direct data interaction. Its performance comparisons are vendor claims, not measurements of Rowfish. Rowfish remains an Electron application, not a SwiftUI rewrite.

[Queryline](https://queryline.dev/) is a PostgreSQL-capable client with a focused editor, schema browser, query history, virtual scrolling, and multiple export formats. Its emphasis on getting out of the way informed the restrained chrome. Its large-result performance claims are not Rowfish benchmarks.

## Boundaries

This update does not add SSH tunneling, backup/restore, a schema migration designer, ER diagrams, Vim mode, AI SQL generation, or transaction-control buttons. Results remain bounded to 10,000 rows and 16 MB, with a 120-second query timeout. Cancellation currently closes the active database session.

SQL drafts, saved queries, and history are local data and **not encrypted secrets**. Connection passwords keep the existing OS-encrypted storage path, and TLS certificate verification stays enabled. Do not put credentials or sensitive literals in query history. SQL writes are not automatically rolled back.
