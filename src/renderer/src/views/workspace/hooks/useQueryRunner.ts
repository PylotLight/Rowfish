import { startTransition, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type {
  DatabaseConnectionSummary,
  DatabaseEvent,
  DatabaseRow,
  PostgresTableDetails,
} from "../../../../../shared/database";
import {
  DATABASE_LIMITS,
  quotePostgresIdentifier,
} from "../../../../../shared/database-helpers";
import type { RowSource } from "../../../components/RowSidePanel";
import {
  queryConnectionKey,
  type QueryHistoryEntry,
  type QueryTab,
  type QueryWorkspaceState,
} from "../../../lib/query-workspace";
import type { ColumnFilters } from "../../../lib/column-filters";
import {
  MAX_CACHED_TAB_RESULTS,
  typedDocuments,
  type ResultViewMode,
  type RunState,
  type TabResultSnapshot,
} from "../workspace-helpers";

export interface QueryRunnerOverrides {
  connection?: DatabaseConnectionSummary;
  database?: string;
  collection?: string;
  query?: string;
  mongoMode?: "find" | "aggregate";
  explain?: boolean;
}

/**
 * The query-runner surface other hooks need: the connections hook resets
 * results and re-runs queries through it (both via a latest-value ref,
 * since the runner is created after the connections hook).
 */
export interface QueryResultsApi {
  setRows: Dispatch<SetStateAction<DatabaseRow[]>>;
  setColumns: Dispatch<SetStateAction<string[]>>;
  setQueryError: Dispatch<SetStateAction<string>>;
  setQuerySummary: Dispatch<SetStateAction<string>>;
  runQuery: (overrides?: QueryRunnerOverrides) => Promise<void>;
}

/**
 * Query execution state: run state, streamed rows/columns, error, plan and
 * summary, plus the per-tab result cache. The workspace keeps the
 * presentation state this talks to (sort, filters, result view, row panel,
 * metadata) and passes it in; tab and workspace state arrive the same way.
 */
export function useQueryRunner({
  activeConnection,
  queryText,
  activeTab,
  workspace,
  rememberQueries,
  onWorkspaceChange,
  onHistoryUpdate,
  closeRowPanel,
  setRowSource,
  dismissPeek,
  selectedTable,
  tableDetails,
  chooseQueryConnection,
  collection,
  mongoQueryMode,
  maxRows,
  selectedMongoDatabase,
  resultView,
  sort,
  rowSource,
  setResultView,
  setSort,
  setColumnFilters,
  setFilterMenu,
  setSelectedTable,
  setTableDetails,
  scrollElement,
}: {
  activeConnection: DatabaseConnectionSummary | null;
  queryText: string;
  activeTab: QueryTab | undefined;
  workspace: QueryWorkspaceState;
  rememberQueries: boolean;
  onWorkspaceChange: Dispatch<SetStateAction<QueryWorkspaceState>>;
  onHistoryUpdate: (id: string, update: Partial<QueryHistoryEntry>) => void;
  closeRowPanel: () => boolean;
  setRowSource: Dispatch<SetStateAction<RowSource | null>>;
  dismissPeek: () => void;
  selectedTable: { connectionId: string; schema: string; name: string } | null;
  tableDetails: PostgresTableDetails | null;
  chooseQueryConnection: () => void;
  collection: string;
  mongoQueryMode: "find" | "aggregate";
  maxRows: number;
  selectedMongoDatabase: string;
  resultView: ResultViewMode;
  sort: { column: string; direction: 1 | -1 } | null;
  rowSource: RowSource | null;
  setResultView: Dispatch<SetStateAction<ResultViewMode>>;
  setSort: Dispatch<
    SetStateAction<{ column: string; direction: 1 | -1 } | null>
  >;
  setColumnFilters: Dispatch<SetStateAction<ColumnFilters>>;
  setFilterMenu: Dispatch<
    SetStateAction<{ column: string; left: number; top: number } | null>
  >;
  setSelectedTable: Dispatch<
    SetStateAction<{
      connectionId: string;
      schema: string;
      name: string;
    } | null>
  >;
  setTableDetails: Dispatch<SetStateAction<PostgresTableDetails | null>>;
  scrollElement: RefObject<HTMLDivElement | null>;
}): {
  runState: RunState;
  setRunState: Dispatch<SetStateAction<RunState>>;
  rows: DatabaseRow[];
  setRows: Dispatch<SetStateAction<DatabaseRow[]>>;
  columns: string[];
  setColumns: Dispatch<SetStateAction<string[]>>;
  queryError: string;
  setQueryError: Dispatch<SetStateAction<string>>;
  queryPlan: unknown;
  setQueryPlan: Dispatch<SetStateAction<unknown>>;
  sqlSelection: string;
  setSqlSelection: Dispatch<SetStateAction<string>>;
  explainPending: { current: boolean };
  querySummary: string;
  setQuerySummary: Dispatch<SetStateAction<string>>;
  activeQuery: { current: { id: string; connectionId: string } | null };
  tabResults: { current: Map<string, TabResultSnapshot> };
  runQuery: (overrides?: QueryRunnerOverrides) => Promise<void>;
  cancelQuery: () => Promise<void>;
  handleConnectionClosed: (event: DatabaseEvent) => void;
  handleQueryEvent: (event: DatabaseEvent) => void;
} {
  const [runState, setRunState] = useState<RunState>("idle");
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [queryError, setQueryError] = useState("");
  const [queryPlan, setQueryPlan] = useState<unknown>(null);
  const [sqlSelection, setSqlSelection] = useState("");
  const explainPending = useRef(false);
  const [querySummary, setQuerySummary] = useState("No query run.");
  const activeQuery = useRef<{ id: string; connectionId: string } | null>(null);

  // Each tab keeps its last result in memory, so switching back shows it
  // without re-running. Capped so a pile of tabs can't hold unbounded rows.
  const tabResults = useRef(new Map<string, TabResultSnapshot>());
  const resultsTabId = useRef<string>(workspace.activeTabId ?? "");
  const skipResultSave = useRef(false);
  useEffect(() => {
    const tabId = workspace.activeTabId ?? "";
    if (resultsTabId.current === tabId) return;
    resultsTabId.current = tabId;
    skipResultSave.current = true;
    const saved = tabResults.current.get(tabId);
    setRows(saved?.rows ?? []);
    setColumns(saved?.columns ?? []);
    setQueryError(saved?.queryError ?? "");
    setQueryPlan(saved?.queryPlan ?? null);
    setSqlSelection("");
    setColumnFilters({});
    setFilterMenu(null);
    setRowSource(saved?.rowSource ?? null);
    setQuerySummary(saved?.querySummary ?? "Ready to execute.");
    explainPending.current = false;
    if (saved) {
      setResultView(saved.resultView);
      setSort(saved.sort);
      setSelectedTable(saved.selectedTable);
      setTableDetails(saved.tableDetails);
    }
  }, [workspace.activeTabId]);
  useEffect(() => {
    if (runState !== "idle") return;
    if (skipResultSave.current) {
      skipResultSave.current = false;
      return;
    }
    const id = resultsTabId.current;
    const cache = tabResults.current;
    cache.delete(id);
    if (!rows.length && !columns.length && !queryError && !queryPlan) return;
    cache.set(id, {
      rows,
      columns,
      queryError,
      queryPlan,
      querySummary,
      resultView,
      sort,
      rowSource,
      selectedTable,
      tableDetails,
    });
    while (cache.size > MAX_CACHED_TAB_RESULTS)
      cache.delete(cache.keys().next().value!);
  }, [
    rows,
    columns,
    queryError,
    queryPlan,
    querySummary,
    resultView,
    sort,
    rowSource,
    selectedTable,
    tableDetails,
    runState,
  ]);

  async function runQuery(overrides: QueryRunnerOverrides = {}): Promise<void> {
    const target = overrides.connection ?? activeConnection;
    const rawQuery = overrides.query ?? queryText;
    // An empty MongoDB query reads the whole collection, like {} / [].
    const query =
      !rawQuery.trim() && (activeTab?.kind ?? target?.kind) === "mongodb"
        ? (overrides.mongoMode ?? mongoQueryMode) === "aggregate"
          ? "[]"
          : "{}"
        : rawQuery;
    const targetCollection = overrides.collection ?? collection;
    if (runState !== "idle" || !query.trim()) return;
    if (
      !target ||
      target.serverMode ||
      (!overrides.connection &&
        (activeTab?.kind !== target.kind ||
          (activeTab?.connectionKey &&
            activeTab.connectionKey !== queryConnectionKey(target))))
    ) {
      chooseQueryConnection();
      return;
    }
    if (!closeRowPanel()) return;
    dismissPeek();
    const tableQuery = selectedTable
      ? `SELECT * FROM ${quotePostgresIdentifier(selectedTable.schema)}.${quotePostgresIdentifier(selectedTable.name)} LIMIT 100;`
      : "";
    setRowSource(
      target.kind === "postgres" &&
        selectedTable?.connectionId === target.id &&
        tableDetails &&
        tableDetails.schema === selectedTable.schema &&
        tableDetails.name === selectedTable.name &&
        query.trim() === tableQuery
        ? {
            connectionId: target.id,
            schema: selectedTable.schema,
            table: selectedTable.name,
            details: tableDetails,
          }
        : null,
    );
    const queryId = window.crypto.randomUUID();
    activeQuery.current = { id: queryId, connectionId: target.id };
    if (rememberQueries)
      onWorkspaceChange((current) => ({
        ...current,
        history: [
          {
            id: queryId,
            query,
            kind: target.kind,
            connectionKey: queryConnectionKey(target),
            connectionName: target.name,
            startedAt: Date.now(),
            status: "running" as const,
          },
          ...current.history,
        ].slice(0, 200),
      }));
    setResultView(overrides.explain ? "plan" : "data");
    setQueryPlan(null);
    explainPending.current = overrides.explain === true;
    setSort(null);
    setColumnFilters({});
    setFilterMenu(null);
    setRows([]);
    setColumns([]);
    setQueryError("");
    setQuerySummary("Starting query…");
    setRunState("running");
    if (scrollElement.current) scrollElement.current.scrollTop = 0;
    try {
      await window.api.database.run({
        connectionId: target.id,
        queryId,
        query,
        maxRows,
        ...(target.kind === "mongodb"
          ? {
              collection: targetCollection,
              database:
                overrides.database ??
                (selectedMongoDatabase || target.database),
              mongoMode: overrides.mongoMode ?? mongoQueryMode,
            }
          : {}),
      });
    } catch (error) {
      if (activeQuery.current?.id === queryId) activeQuery.current = null;
      setRunState("idle");
      setQueryError(
        error instanceof Error ? error.message : "Could not start the query.",
      );
      setQuerySummary("Query was not started.");
      onHistoryUpdate(queryId, {
        status: "error",
        error: error instanceof Error ? error.message : "Could not start query",
      });
    }
  }

  async function cancelQuery(): Promise<void> {
    const current = activeQuery.current;
    if (!current) return;
    setRunState("cancelling");
    try {
      await window.api.database.cancel(current.connectionId, current.id);
    } catch (error) {
      setRunState("idle");
      setQueryError(
        error instanceof Error ? error.message : "Could not cancel the query.",
      );
    }
  }

  /** The query-side half of a connection:closed event. */
  function handleConnectionClosed(event: DatabaseEvent): void {
    if (event.type !== "connection:closed") return;
    if (activeQuery.current?.connectionId === event.connectionId) {
      onHistoryUpdate(activeQuery.current.id, {
        status: "cancelled",
        error: event.message,
      });
      activeQuery.current = null;
      setRunState("idle");
    }
    if (event.message) setQuerySummary(event.message);
  }

  /** The query:* halves of the database event stream. */
  function handleQueryEvent(event: DatabaseEvent): void {
    if (event.type === "connection:closed") return;
    if (event.type === "query:cancelled") {
      if (activeQuery.current?.id !== event.queryId) return;
      onHistoryUpdate(event.queryId, { status: "cancelled" });
      activeQuery.current = null;
      setRunState("idle");
      setQuerySummary(
        "Query cancelled. The connection was closed to stop server-side work.",
      );
      return;
    }

    if (activeQuery.current?.id !== event.queryId) return;
    if (event.type === "query:rows") {
      if (event.documents)
        event.rows.forEach((row, index) =>
          typedDocuments.set(row, event.documents![index] ?? null),
        );
      if (explainPending.current && event.rows.length)
        setQueryPlan(event.rows[0]);
      startTransition(() => {
        setRows((current) =>
          current.length >= DATABASE_LIMITS.maxRows
            ? current
            : [...current, ...event.rows].slice(0, DATABASE_LIMITS.maxRows),
        );
        setColumns((current) =>
          [...new Set([...current, ...event.columns])].slice(
            0,
            DATABASE_LIMITS.maxColumns,
          ),
        );
      });
      return;
    }
    if (event.type === "query:complete") {
      onHistoryUpdate(event.queryId, {
        status: "success",
        elapsedMs: event.elapsedMs,
        rowCount: event.receivedRows,
      });
      activeQuery.current = null;
      setRunState("idle");
      setQueryError("");
      setQuerySummary(
        explainPending.current
          ? `Estimated plan · ${(event.elapsedMs / 1_000).toFixed(2)} s · no ANALYZE`
          : `${event.receivedRows.toLocaleString()} rows${event.affectedRows ? ` · ${event.affectedRows.toLocaleString()} affected` : ""}${(event.statementCount ?? 1) > 1 ? ` · ${event.statementCount} statements (last result shown)` : ""} · ${(event.elapsedMs / 1_000).toFixed(2)} s${event.truncated ? " · result capped (row or 16 MB limit)" : ""}`,
      );
      return;
    }
    if (event.type === "query:error") {
      onHistoryUpdate(event.queryId, {
        status: "error",
        error: event.message,
      });
      activeQuery.current = null;
      setRunState("idle");
      setQueryError(event.message);
      setQuerySummary("Query failed.");
    }
  }

  return {
    runState,
    setRunState,
    rows,
    setRows,
    columns,
    setColumns,
    queryError,
    setQueryError,
    queryPlan,
    setQueryPlan,
    sqlSelection,
    setSqlSelection,
    explainPending,
    querySummary,
    setQuerySummary,
    activeQuery,
    tabResults,
    runQuery,
    cancelQuery,
    handleConnectionClosed,
    handleQueryEvent,
  };
}
