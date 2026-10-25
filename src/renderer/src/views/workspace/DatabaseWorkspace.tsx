import {
  Plus,
  Play,
  Square,
  Save,
  FileCode2,
  X,
  Download,
  Table2,
  Columns3,
  KeyRound,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  CircleHelp,
  Copy,
  Eye,
  EyeOff,
  List,
  Braces,
} from "lucide-react";
import type { ReactNode } from "react";
import "../../components/query-connection.css";
import type { UiPreferences } from "../../lib/ui-preferences";
import ColumnFilterMenu from "../../components/ColumnFilterMenu";
import {
  applyColumnFilters,
  isColumnFilterActive,
  type ColumnFilter,
  type ColumnFilters,
} from "../../lib/column-filters";
import SqlEditor from "../../components/SqlEditor";
import QueryPlan from "../../components/QueryPlan";
import {
  buildExplainQuery,
  postgresDiagnostics,
} from "../../lib/postgres-tools";
import RowSidePanel, { type RowSource } from "../../components/RowSidePanel";
import ResizeSeparator from "../../components/ResizeSeparator";
import {
  clampLayout,
  loadLayout,
  saveLayout,
} from "../../lib/layout-preferences";
import { isSameRow } from "../../lib/row-editor";
import DocumentResults from "../../components/DocumentResults";
import ConnectionDialog from "./components/ConnectionDialog";
import ConnectionRail from "./components/ConnectionRail";
import DbSwitcher from "./components/DbSwitcher";
import HelpDialog from "./components/HelpDialog";
import MongoBrowser from "./components/MongoBrowser";
import MongoOperationDialog, {
  type MongoOperationFields,
} from "./components/MongoOperationDialog";
import QueryConnectionDialog from "./components/QueryConnectionDialog";
import ResultsTable from "./components/ResultsTable";
import SaveQueryDialog from "./components/SaveQueryDialog";
import TableMetadata from "./components/TableMetadata";
import { useConnections } from "./hooks/useConnections";
import { useQueryRunner, type QueryResultsApi } from "./hooks/useQueryRunner";
import {
  cellSummary,
  columnKinds,
  describeValue,
  effectiveResultsView,
  isNestedKind,
  loadResultsView,
  saveResultsView,
  toRelaxed,
  withoutId,
  type ResultsView,
} from "../../lib/document-view";
import {
  autoFitColumnWidth,
  defaultColumnWidth,
  loadColumnWidths,
  resizedWidth,
  saveColumnWidths,
  type ColumnWidths,
} from "../../lib/column-widths";
import {
  loadQueryWorkspace,
  saveQueryWorkspace,
  makeQueryTab,
  queryConnectionKey,
  exportResultsCsv,
  exportResultsJson,
  downloadText,
  type SavedQuery,
  type QueryHistoryEntry,
} from "../../lib/query-workspace";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PostgresTableDetails,
  PostgresServerInfo,
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionInput,
  PostgresSslMode,
  DatabaseConnectionSummary,
  DatabaseConnectionTestResult,
  DatabaseRow,
  MongoBrowserCollection,
  MongoBrowserDatabase,
  MongoMutationRequest,
  SavedConnectionProfile,
} from "../../../../shared/database";
import {
  detectConnectionStringKind,
  getVirtualRowRange,
  quotePostgresIdentifier,
} from "../../../../shared/database-helpers";
import {
  buildConnectionString,
  CONNECT_MODE_KEY,
  DEFAULT_FORM,
  dialogErrorMessage,
  kindDefaults,
  kindLabel,
  loadConnectStringMode,
  measureText,
  mongoBrowserKey,
  MONGO_DETAILS_KEY,
  parseConnectionStringFields,
  resultId,
  ROW_HEIGHT,
  ROW_INDEX_WIDTH,
  documentOf,
  type MongoOperation,
  type RailView,
  type RunState,
} from "./workspace-helpers";

export default function DatabaseWorkspace({
  search,
  preferences,
  sidebarActions,
  settingsView,
}: {
  search: string;
  preferences: UiPreferences;
  sidebarActions: ReactNode;
  settingsView?: ReactNode;
}): React.JSX.Element {
  const [showConnect, setShowConnect] = useState(false);
  const [showQueryConnection, setShowQueryConnection] = useState(false);
  const queryConnectionTabId = useRef<string | null>(null);
  const [queryConnectionBusy, setQueryConnectionBusy] = useState(false);
  const [queryConnectionError, setQueryConnectionError] = useState("");
  const [queryConnectionServer, setQueryConnectionServer] =
    useState<DatabaseConnectionSummary | null>(null);
  const [queryConnectionDatabases, setQueryConnectionDatabases] = useState<
    DatabaseBrowserDatabase[]
  >([]);
  const [form, setForm] = useState<DatabaseConnectionInput>(DEFAULT_FORM);
  const [saveProfile, setSaveProfile] = useState(true);
  /** The saved profile the connection dialog is editing, or null for a new one. */
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  /** Connection string mode (kind detected from the scheme) or manual details. */
  const [uriMode, setUriMode] = useState(loadConnectStringMode);
  const [revealUri, setRevealUri] = useState(false);
  const [uriCopied, setUriCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  /** Which save action is running: Test & Save, Save without testing, or Save anyway. */
  const [saveBusy, setSaveBusy] = useState<"" | "test" | "save" | "anyway">("");
  /** Error from the last Test & Save attempt; offers Save anyway beside it. */
  const [testFailure, setTestFailure] = useState("");
  const connectBusy = connecting || saveBusy !== "";
  const generatedConnectionString = useMemo(
    () => buildConnectionString(form),
    [form],
  );
  const connectionStringStatus = useMemo((): {
    text: string;
    error: boolean;
  } | null => {
    if (!uriMode) return null;
    const source = (form.connectionString ?? "").trim();
    if (!source)
      return {
        text: "Paste a postgres://, postgresql://, mongodb:// or mongodb+srv:// connection string. The database type is detected from it.",
        error: false,
      };
    const detected = detectConnectionStringKind(source);
    if (!detected)
      return {
        text: "Rowfish can’t tell the database type from this string. Start it with postgres://, postgresql://, mongodb:// or mongodb+srv://.",
        error: true,
      };
    try {
      const parsed = parseConnectionStringFields(detected, source);
      const target = `${parsed.host}:${parsed.port}${parsed.database ? `/${parsed.database}` : ""}`;
      const summary = [
        parsed.username ? `${target} as ${parsed.username}` : target,
        parsed.sslMode
          ? `sslmode ${parsed.sslMode}`
          : parsed.tls
            ? "TLS on"
            : "TLS off",
      ].join(" · ");
      if (parsed.representable) return { text: summary, error: false };
      const extras = parsed.extraOptions.length
        ? `options ${parsed.extraOptions.join(", ")}`
        : "multiple hosts or SRV lookup";
      return {
        text: `${summary}. The ${extras} apply only while connecting with the string.`,
        error: false,
      };
    } catch (error) {
      return {
        text: `${error instanceof Error ? error.message : "This connection string is not valid."} The fields keep their last valid values.`,
        error: true,
      };
    }
  }, [form.connectionString, uriMode]);
  /** The kind the connection string's scheme names, in connection string mode. */
  const detectedKind = uriMode
    ? detectConnectionStringKind(form.connectionString ?? "")
    : null;
  /** Connection string mode cannot continue until the scheme names a kind. */
  const connectionStringBlocked = uriMode && !detectedKind;
  useEffect(() => {
    setTestFailure("");
    setRevealUri(false);
    setUriCopied(false);
  }, [showConnect]);
  const [workspace, setWorkspace] = useState(() => {
    const loaded = loadQueryWorkspace();
    if (!loaded.tabs.length) {
      const tab = makeQueryTab();
      loaded.tabs = [tab];
      loaded.activeTabId = tab.id;
    } else if (!loaded.activeTabId) loaded.activeTabId = loaded.tabs[0]!.id;
    return loaded;
  });
  const activeTab =
    workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ??
    workspace.tabs[0];
  const queryText = activeTab?.query ?? "";
  function setQueryText(query: string): void {
    setWorkspace((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeTabId
          ? { ...tab, query, updatedAt: Date.now() }
          : tab,
      ),
    }));
  }
  const [railView, setRailView] = useState<RailView>("servers");
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try {
      return localStorage.getItem("rowfish.sidebar-hidden") !== "false";
    } catch {
      return true;
    }
  });
  const [layout, setLayout] = useState(loadLayout);
  const resizeLayout = (
    key: "sidebar" | "split" | "rowPanel",
    value: number,
  ): void => {
    setLayout((current) => {
      const next = {
        ...current,
        [key]: clampLayout(
          value,
          key,
          key === "sidebar" || key === "rowPanel"
            ? window.innerWidth
            : undefined,
        ),
      };
      saveLayout(next);
      return next;
    });
  };
  const workspaceRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLElement>(null);
  // Hover peek, like Surffish: resting the pointer on the left edge slides the
  // explorer out over the workspace; leaving it slides it away again. The
  // toggle button still opens it until dismissed.
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPeekTimer = (): void => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = null;
  };
  const revealSidebar = (): void => {
    clearPeekTimer();
    setSidebarPeek(true);
  };
  const scheduleSidebarHide = (): void => {
    clearPeekTimer();
    peekTimer.current = setTimeout(() => {
      peekTimer.current = null;
      const active = document.activeElement;
      // Stay out while typing in the filter, a dialog is up, or mid-resize.
      if (
        (active instanceof HTMLInputElement &&
          railRef.current?.contains(active)) ||
        document.querySelector('[role="dialog"]') ||
        document.querySelector(".explorer-resizer:hover")
      )
        return;
      setSidebarPeek(false);
    }, 220);
  };
  // Collapse the docked explorer (the rail's own button).
  const closeSidebar = (): void => {
    clearPeekTimer();
    setSidebarPeek(false);
    setSidebarHidden(true);
  };
  // Dock the explorer: it takes its own column and the workspace shifts over.
  const dockSidebar = (): void => {
    clearPeekTimer();
    setSidebarPeek(false);
    setSidebarHidden(false);
  };
  // Tuck a hover-peeked explorer away after an action; a docked one stays.
  const dismissPeek = (): void => {
    clearPeekTimer();
    setSidebarPeek(false);
  };
  useEffect(() => clearPeekTimer, []);
  // Leaving Settings returns focus to its gear in the rail footer, so keep the
  // rail peeked out until the pointer moves away or it is dismissed.
  // Layout effect so the rail is out before App's rAF focus lands on the gear.
  const hadSettings = useRef(!!settingsView);
  useLayoutEffect(() => {
    if (hadSettings.current && !settingsView && sidebarHidden) revealSidebar();
    hadSettings.current = !!settingsView;
  }, [settingsView]);
  const railOpen = !sidebarHidden || sidebarPeek;
  useEffect(() => {
    try {
      localStorage.setItem("rowfish.sidebar-hidden", String(sidebarHidden));
    } catch {
      /* storage may be unavailable */
    }
  }, [sidebarHidden]);
  useEffect(() => {
    if (settingsView) return;
    const dismiss = (event: KeyboardEvent): void => {
      if (
        event.key === "Escape" &&
        sidebarPeek &&
        !document.querySelector('[role="dialog"]')
      )
        dismissPeek();
    };
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (
        sidebarPeek &&
        workspaceRef.current &&
        !workspaceRef.current.querySelector(".db-rail")?.contains(target) &&
        !workspaceRef.current
          .querySelector(".sidebar-toggle")
          ?.contains(target) &&
        !(target instanceof Element && target.closest(".layout-resizer")) &&
        !(target instanceof Element && target.closest('[role="dialog"]'))
      )
        dismissPeek();
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outside);
    };
  }, [sidebarPeek, settingsView]);
  const [selectedTable, setSelectedTable] = useState<{
    connectionId: string;
    schema: string;
    name: string;
  } | null>(null);
  const [tableDetails, setTableDetails] = useState<PostgresTableDetails | null>(
    null,
  );
  const [metadataError, setMetadataError] = useState("");
  const [metadataLoading, setMetadataLoading] = useState(false);
  const metadataRequest = useRef(0);
  const [resultView, setResultView] = useState<
    "data" | "structure" | "indexes" | "plan"
  >("data");
  const [serverInfo, setServerInfo] = useState<PostgresServerInfo | null>(null);
  const [saveDialog, setSaveDialog] = useState(false);
  const [queryName, setQueryName] = useState("");
  const [queryFolder, setQueryFolder] = useState("General");
  const [notice, setNotice] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [sort, setSort] = useState<{
    column: string;
    direction: 1 | -1;
  } | null>(null);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const [filterMenu, setFilterMenu] = useState<{
    column: string;
    left: number;
    top: number;
  } | null>(null);
  const [inspectedRow, setInspectedRow] = useState<DatabaseRow | null>(null);
  const [rowSource, setRowSource] = useState<RowSource | null>(null);
  const [rowDirty, setRowDirty] = useState(false);
  const [rowBusy, setRowBusy] = useState(false);
  function closeRowPanel(): boolean {
    if (rowBusy) return false;
    if (rowDirty && !window.confirm("Discard unsaved changes to this row?"))
      return false;
    setInspectedRow(null);
    setRowDirty(false);
    return true;
  }
  function inspectRow(row: DatabaseRow): void {
    if (row === inspectedRow || !closeRowPanel()) return;
    setInspectedRow(row);
  }
  useEffect(() => {
    if (!rowDirty) return;
    const prevent = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [rowDirty]);
  const [rememberQueries, setRememberQueries] = useState(() => {
    try {
      return localStorage.getItem("rowfish.remember-query-history") !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "rowfish.remember-query-history",
        String(rememberQueries),
      );
    } catch {}
  }, [rememberQueries]);
  const workspaceSnapshot = useRef(workspace);
  workspaceSnapshot.current = workspace;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!saveQueryWorkspace(workspace))
        setNotice(
          "Workspace could not be saved locally. Export important SQL before closing.",
        );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [workspace]);
  useEffect(() => {
    const flush = (): void => {
      saveQueryWorkspace(workspaceSnapshot.current);
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
    };
  }, []);
  const [collection, setCollection] = useState("documents");
  const [mongoQueryMode, setMongoQueryMode] = useState<"find" | "aggregate">(
    "find",
  );
  const [maxRows, setMaxRows] = useState(1_000);
  const [mongoOperation, setMongoOperation] = useState<MongoOperation | null>(
    null,
  );
  const [mongoOperationConnection, setMongoOperationConnection] =
    useState<DatabaseConnectionSummary | null>(null);
  const [mongoOperationPrefill, setMongoOperationPrefill] = useState<
    Partial<MongoOperationFields>
  >({});
  const [mongoOperationBusy, setMongoOperationBusy] = useState(false);
  const [mongoOperationError, setMongoOperationError] = useState("");
  const [mongoOperationSummary, setMongoOperationSummary] = useState("");
  /** Indexes, validator and options under the collection bar; folded by default. */
  const [mongoDetailsOpen, setMongoDetailsOpen] = useState(() => {
    try {
      return localStorage.getItem(MONGO_DETAILS_KEY) === "open";
    } catch {
      return false;
    }
  });
  const [mongoMoreOpen, setMongoMoreOpen] = useState(false);
  const mongoMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mongoMoreOpen) return;
    const close = (event: MouseEvent): void => {
      if (!mongoMoreRef.current?.contains(event.target as Node))
        setMongoMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMongoMoreOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [mongoMoreOpen]);
  function toggleMongoDetails(): void {
    setMongoDetailsOpen((open) => {
      try {
        localStorage.setItem(MONGO_DETAILS_KEY, open ? "closed" : "open");
      } catch {
        // Only a display preference.
      }
      return !open;
    });
  }
  const [viewport, setViewport] = useState({ top: 0, height: 480 });
  const scrollElement = useRef<HTMLDivElement>(null);
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());

  // Latest-value refs so the connections hook can reach the runner (created
  // just below) without a circular dependency.
  const runStateRef = useRef<RunState>("idle");
  const queryResultsRef = useRef<QueryResultsApi | null>(null);
  const connectionState = useConnections({
    runStateRef,
    queryResultsRef,
    setQueryText,
    queryText,
    mongoQueryMode,
    setCollection,
    setMongoQueryMode,
    closeRowPanel,
    dismissPeek,
    onConnectionError: setConnectionError,
    onConnected: addConnectedConnection,
  });
  const {
    connections,
    setConnections,
    savedConnections,
    activeId,
    setActiveId,
    activeConnection,
    serverDatabases,
    completionColumns,
    tableLists,
    browserLoading,
    dbSwitcher,
    setDbSwitcher,
    browserErrors,
    setBrowserErrors,
    mongoDatabases,
    setMongoDatabases,
    mongoCollections,
    setMongoCollections,
    expandedMongoDatabases,
    setExpandedMongoDatabases,
    selectedMongoDatabase,
    setSelectedMongoDatabase,
    selectedMongoCollection,
    setSelectedMongoCollection,
    refreshSavedConnections,
    inspectConnection,
    connectSaved,
    deleteSaved,
    openDatabase,
    expandMongoDatabase,
    selectMongoCollection,
    toggleDbSwitcher,
    switchDatabase,
    disconnect,
  } = connectionState;
  const queryRunner = useQueryRunner({
    activeConnection,
    queryText,
    activeTab,
    workspace,
    rememberQueries,
    onWorkspaceChange: setWorkspace,
    onHistoryUpdate: updateHistory,
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
  });
  runStateRef.current = queryRunner.runState;
  queryResultsRef.current = {
    setRows: queryRunner.setRows,
    setColumns: queryRunner.setColumns,
    setQueryError: queryRunner.setQueryError,
    setQuerySummary: queryRunner.setQuerySummary,
    runQuery: queryRunner.runQuery,
  };
  const {
    runState,
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
    tabResults,
    runQuery,
    cancelQuery,
  } = queryRunner;
  const deferredRows = useDeferredValue(rows);
  const autocompleteTables = useMemo(() => {
    const byTable = new Map<string, string[]>();
    for (const column of completionColumns[activeId] ?? []) {
      const key = JSON.stringify([column.schema, column.table]);
      const names = byTable.get(key) ?? [];
      names.push(column.name);
      byTable.set(key, names);
    }
    return (tableLists[activeId] ?? []).map((table) => ({
      ...table,
      columns: byTable.get(JSON.stringify([table.schema, table.name])) ?? [],
    }));
  }, [tableLists, completionColumns, activeId]);
  const mongoCompletion = useMemo(() => {
    const fields = new Set(selectedMongoCollection?.fields ?? []);
    if (activeConnection?.kind === "mongodb")
      for (const column of columns) fields.add(column);
    return {
      mode: mongoQueryMode,
      fields: [...fields],
      collections: activeId
        ? (
            mongoCollections[
              mongoBrowserKey(activeId, selectedMongoDatabase)
            ] ?? []
          ).map((item) => item.name)
        : [],
    };
  }, [
    selectedMongoCollection,
    columns,
    activeConnection?.kind,
    mongoQueryMode,
    mongoCollections,
    activeId,
    selectedMongoDatabase,
  ]);
  const searchedRows = useMemo(
    () =>
      deferredSearch
        ? deferredRows.filter((row) =>
            Object.values(row).some((value) =>
              String(value ?? "")
                .toLocaleLowerCase()
                .includes(deferredSearch),
            ),
          )
        : deferredRows,
    [deferredRows, deferredSearch],
  );
  const filtersActive = Object.values(columnFilters).some(isColumnFilterActive);
  // Rows the open column menu lists values from: every other filter applied.
  const filterMenuRows = useMemo(() => {
    if (!filterMenu) return searchedRows;
    const { [filterMenu.column]: _own, ...others } = columnFilters;
    return applyColumnFilters(searchedRows, others);
  }, [filterMenu, columnFilters, searchedRows]);
  const closeFilterMenu = useCallback(() => setFilterMenu(null), []);
  function toggleSortColumn(column: string): void {
    setSort((current) => ({
      column,
      direction: current?.column === column && current.direction === 1 ? -1 : 1,
    }));
  }
  function toggleFilterMenu(
    column: string,
    position: { left: number; top: number },
  ): void {
    setFilterMenu((current) =>
      current?.column === column ? null : { column, ...position },
    );
  }
  function setColumnFilter(column: string, filter: ColumnFilter): void {
    setColumnFilters((current) => ({ ...current, [column]: filter }));
  }
  function sortColumn(column: string, direction: 1 | -1): void {
    setSort({ column, direction });
  }
  const pickerCollections = useMemo(
    () =>
      activeId && selectedMongoDatabase
        ? (mongoCollections[mongoBrowserKey(activeId, selectedMongoDatabase)] ??
          [])
        : [],
    [activeId, selectedMongoDatabase, mongoCollections],
  );
  const visibleRows = useMemo(() => {
    const filtered = applyColumnFilters(searchedRows, columnFilters);
    if (!sort) return filtered;
    return [...filtered].sort((a, b) => {
      const x = a[sort.column],
        y = b[sort.column];
      if (x === y) return 0;
      if (x == null) return sort.direction;
      if (y == null) return -sort.direction;
      return (
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), undefined, {
              numeric: true,
            })) * sort.direction
      );
    });
  }, [searchedRows, columnFilters, sort]);
  const { start: firstVisible, end: lastVisible } = getVirtualRowRange(
    visibleRows.length,
    viewport.top,
    viewport.height,
    ROW_HEIGHT,
  );
  const windowedRows = visibleRows.slice(firstVisible, lastVisible);
  const deferredQuery = runState !== "idle";

  // Compass-style result views. An explicit pick sticks (localStorage); until
  // then a single MongoDB document opens as a list.
  const [chosenResultsView, setChosenResultsView] =
    useState<ResultsView | null>(loadResultsView);
  const isMongoResult = activeConnection?.kind === "mongodb";
  const resultsView = effectiveResultsView(
    chosenResultsView,
    activeConnection?.kind,
    rows.length,
  );
  function chooseResultsView(view: ResultsView): void {
    setChosenResultsView(view);
    saveResultsView(view);
  }
  const resultsResetKey = `${activeTab?.id ?? ""}:${resultId(rows[0])}`;
  /** Mongo type hint per column, sampled from the first documents. */
  const sampleSize = Math.min(rows.length, 200);
  const mongoColumnKinds = useMemo(
    () =>
      isMongoResult && sampleSize
        ? columnKinds(columns, rows.slice(0, sampleSize).map(documentOf))
        : {},
    // Re-sample only while the first 200 rows are still streaming in.
    [isMongoResult, columns, sampleSize, rows[0]],
  );
  function cellText(row: DatabaseRow, column: string): string {
    if (isMongoResult) {
      const document = documentOf(row);
      if (column in document) {
        const info = describeValue(document[column]);
        if (isNestedKind(info.kind)) return cellSummary(info);
      }
    }
    return String(row[column] ?? "NULL");
  }

  // Resizable columns, remembered per Mongo collection or per Postgres tab.
  const widthScope = isMongoResult
    ? `mongo:${selectedMongoDatabase || activeConnection?.database || ""}/${selectedMongoCollection?.name || collection}`
    : `pg:${activeTab?.id ?? ""}`;
  const [widthState, setWidthState] = useState<{
    scope: string;
    widths: ColumnWidths;
  }>(() => ({ scope: "", widths: {} }));
  useEffect(() => {
    setWidthState({ scope: widthScope, widths: loadColumnWidths(widthScope) });
  }, [widthScope]);
  const columnWidths = widthState.scope === widthScope ? widthState.widths : {};
  const defaultWidths = useMemo(() => {
    const sample = rows.slice(0, 50);
    const out: ColumnWidths = {};
    for (const column of columns)
      out[column] = defaultColumnWidth(
        mongoColumnKinds[column]
          ? `${column} ${mongoColumnKinds[column]}`
          : column,
        sample.map((row) => cellText(row, column)),
      );
    return out;
    // Defaults come from the first batch so widths don't jump while streaming.
  }, [columns, rows[0], mongoColumnKinds]);
  const widthOf = (column: string): number =>
    columnWidths[column] ?? defaultWidths[column] ?? 160;
  const tableWidth =
    ROW_INDEX_WIDTH + columns.reduce((sum, column) => sum + widthOf(column), 0);
  function setColumnWidth(column: string, width: number | null): void {
    setWidthState((current) => {
      const widths = {
        ...(current.scope === widthScope ? current.widths : {}),
      };
      if (width === null) delete widths[column];
      else widths[column] = width;
      saveColumnWidths(widthScope, widths);
      return { scope: widthScope, widths };
    });
  }
  function startColumnResize(
    event: React.PointerEvent<HTMLSpanElement>,
    column: string,
  ): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const header = handle.parentElement;
    const startWidth = header?.getBoundingClientRect().width ?? widthOf(column);
    const startX = event.clientX;
    handle.setPointerCapture(event.pointerId);
    let frame = 0;
    let latest = startWidth;
    const move = (moveEvent: PointerEvent): void => {
      latest = resizedWidth(startWidth, moveEvent.clientX - startX);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setWidthState((current) => ({
          scope: widthScope,
          widths: {
            ...(current.scope === widthScope ? current.widths : {}),
            [column]: latest,
          },
        })),
      );
    };
    const end = (): void => {
      cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (latest !== startWidth) setColumnWidth(column, latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  /** Double-click: fit the header and visible cells; again to reset. */
  function autoFitColumn(
    event: React.MouseEvent<HTMLSpanElement>,
    column: string,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const header = event.currentTarget.parentElement;
    const cell = scrollElement.current?.querySelector(
      "tbody td:not(.db-row-index)",
    );
    const headerFont = header
      ? getComputedStyle(header).font
      : "11px sans-serif";
    const cellFont = cell ? getComputedStyle(cell).font : headerFont;
    const label = mongoColumnKinds[column]
      ? `${column} ${mongoColumnKinds[column]}`
      : column;
    const fitted = autoFitColumnWidth(
      measureText(label, headerFont),
      windowedRows.map((row) => measureText(cellText(row, column), cellFont)),
    );
    setColumnWidth(
      column,
      columnWidths[column] !== undefined &&
        Math.abs(columnWidths[column]! - fitted) <= 2
        ? null
        : fitted,
    );
  }

  // Document actions from the list / JSON views (MongoDB find results only).
  const documentActionsEnabled = isMongoResult && mongoQueryMode === "find";
  function editDocument(row: DatabaseRow): void {
    const document = documentOf(row);
    if (!("_id" in document)) return;
    openMongoOperation("update", undefined, {
      filter: JSON.stringify({ _id: toRelaxed(document._id) }),
      update: JSON.stringify({ $set: toRelaxed(withoutId(document)) }, null, 2),
    });
  }
  function cloneDocument(row: DatabaseRow): void {
    openMongoOperation("insert", undefined, {
      document: JSON.stringify(toRelaxed(withoutId(documentOf(row))), null, 2),
    });
  }
  function deleteDocument(row: DatabaseRow): void {
    const document = documentOf(row);
    if (!("_id" in document)) return;
    openMongoOperation("delete", undefined, {
      filter: JSON.stringify({ _id: toRelaxed(document._id) }),
    });
  }

  function newTab(
    query = "",
    title?: string,
    connection = activeConnection,
    stored?: Pick<SavedQuery, "kind" | "connectionKey">,
  ): void {
    if (runState !== "idle" || !closeRowPanel()) return;
    if (workspace.tabs.length >= 100) {
      setNotice("Close an existing tab before opening more (100 tab limit).");
      return;
    }
    if (stored) dismissPeek();
    const tab = makeQueryTab(
      stored?.kind ?? connection?.kind ?? "postgres",
      stored?.connectionKey ?? queryConnectionKey(connection),
      query,
      title,
    );
    setWorkspace((current) => ({
      ...current,
      tabs: [...current.tabs, tab],
      activeTabId: tab.id,
    }));
  }
  function closeTab(id: string): void {
    if (!closeRowPanel()) return;
    tabResults.current.delete(id);
    setWorkspace((current) => {
      const tabs = current.tabs.filter((tab) => tab.id !== id);
      if (!tabs.length)
        tabs.push(
          makeQueryTab(
            activeConnection?.kind ?? "postgres",
            queryConnectionKey(activeConnection),
          ),
        );
      return {
        ...current,
        tabs,
        activeTabId:
          current.activeTabId === id
            ? tabs[tabs.length - 1]!.id
            : current.activeTabId,
      };
    });
  }
  function updateHistory(id: string, update: Partial<QueryHistoryEntry>): void {
    setWorkspace((current) => ({
      ...current,
      history: current.history.map((entry) =>
        entry.id === id ? { ...entry, ...update } : entry,
      ),
    }));
  }
  function saveCurrentQuery(): void {
    if (!queryText.trim()) return;
    setQueryName(
      activeTab?.title === "Untitled query" ? "" : (activeTab?.title ?? ""),
    );
    setSaveDialog(true);
  }
  function saveQueryToLibrary(title: string): void {
    const item: SavedQuery = {
      id: crypto.randomUUID(),
      title,
      query: queryText,
      kind: activeTab?.kind ?? "postgres",
      connectionKey: activeTab?.connectionKey ?? "",
      folder: queryFolder.trim() || "General",
      updatedAt: Date.now(),
    };
    setWorkspace((current) => ({
      ...current,
      saved: [
        item,
        ...current.saved.filter(
          (entry) => entry.title !== item.title || entry.folder !== item.folder,
        ),
      ].slice(0, 500),
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeTabId ? { ...tab, title } : tab,
      ),
    }));
    setSaveDialog(false);
    setRailView("saved");
  }
  async function formatQuery(): Promise<void> {
    const original = queryText;
    const tabId = workspace.activeTabId;
    try {
      const { format } = await import("sql-formatter");
      const current = workspaceSnapshot.current;
      if (
        current.activeTabId !== tabId ||
        current.tabs.find((tab) => tab.id === tabId)?.query !== original
      )
        return;
      setQueryText(
        format(queryText, { language: "postgresql", keywordCase: "upper" }),
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to format this query.",
      );
    }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key === "F5") {
        event.preventDefault();
        void runQuery();
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        formatQuery();
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveCurrentQuery();
      }
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        newTab();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    queryText,
    activeTab,
    activeConnection,
    rowDirty,
    rowBusy,
    selectedTable,
    tableDetails,
    runState,
  ]);
  useEffect(() => {
    setServerInfo(null);
    if (activeConnection?.kind === "postgres") {
      let cancelled = false;
      void window.api.database
        .getPostgresServerInfo(activeConnection!.id)
        .then((info) => {
          if (!cancelled) setServerInfo(info);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
  }, [activeConnection?.id]);

  useEffect(() => {
    if (!(
      showConnect ||
      showQueryConnection ||
      saveDialog ||
      showHelp ||
      mongoOperation
    ))
      return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    if (showQueryConnection && !queryConnectionBusy)
      modal?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (
        event.key === "Escape" &&
        !connectBusy &&
        !queryConnectionBusy &&
        !mongoOperationBusy
      ) {
        cancelQueryConnection();
        setShowConnect(false);
        setSaveDialog(false);
        setShowHelp(false);
        setMongoOperation(null);
      }
      if (event.key === "Tab" && modal) {
        const items = [
          ...modal.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ];
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [
    showConnect,
    showQueryConnection,
    queryConnectionBusy,
    saveDialog,
    showHelp,
    mongoOperation,
    connectBusy,
    mongoOperationBusy,
  ]);

  // Leaving the dialog ends an edit and restores the remembered input mode,
  // which opening a profile for editing may have switched.
  useEffect(() => {
    if (showConnect) return;
    setEditingProfileId(null);
    setUriMode(loadConnectStringMode());
  }, [showConnect]);

  /** Open the connection dialog prefilled with a saved profile. */
  async function editSaved(profileId: string): Promise<void> {
    if (connectBusy) return;
    setConnectionError("");
    try {
      const input = await window.api.database.getSaved(profileId);
      setTestFailure("");
      setForm({ ...DEFAULT_FORM, ...input });
      setUriMode(Boolean(input.connectionString));
      setRevealUri(false);
      setEditingProfileId(profileId);
      setShowConnect(true);
    } catch (error) {
      setConnectionError(
        dialogErrorMessage(error, "Could not open this saved connection."),
      );
    }
  }

  /** Save the dialog as a new profile, or over the one being edited. */
  async function persistProfile(
    input: DatabaseConnectionInput,
  ): Promise<SavedConnectionProfile> {
    if (!editingProfileId) return window.api.database.saveConnection(input);
    const profile = await window.api.database.updateSaved(
      editingProfileId,
      input,
    );
    setConnections((current) =>
      current.map((connection) =>
        connection.savedConnectionId === profile.id
          ? {
              ...connection,
              name: connection.parentConnectionId
                ? `${profile.name} · ${connection.database}`
                : profile.name,
            }
          : connection,
      ),
    );
    return profile;
  }

  useEffect(() => {
    const unsubscribe = window.api.database.onEvent((event) => {
      if (event.type === "connection:closed") {
        connectionState.handleConnectionClosed(event);
        queryRunner.handleConnectionClosed(event);
        return;
      }
      queryRunner.handleQueryEvent(event);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    setInspectedRow(null);
    setRowSource(null);
    setSelectedMongoCollection(null);
    if (selectedTable?.connectionId !== activeConnection?.id) {
      setSelectedTable(null);
      setTableDetails(null);
      metadataRequest.current += 1;
    }
    setResultView("data");
    setSort(null);
    setColumnFilters({});
    setFilterMenu(null);
    if (activeConnection && !activeConnection!.serverMode) {
      const key = queryConnectionKey(activeConnection);
      setWorkspace((current) => {
        const selected = current.tabs.find(
          (tab) => tab.id === current.activeTabId,
        );
        if (
          selected?.connectionKey === key &&
          selected.kind === activeConnection.kind
        )
          return current;
        if (
          selected &&
          !selected.connectionKey &&
          selected.kind === activeConnection.kind
        )
          return {
            ...current,
            tabs: current.tabs.map((tab) =>
              tab.id === selected.id ? { ...tab, connectionKey: key } : tab,
            ),
          };
        const existing = current.tabs.find(
          (tab) =>
            tab.connectionKey === key && tab.kind === activeConnection?.kind,
        );
        if (existing) return { ...current, activeTabId: existing.id };
        const unbound = current.tabs.find(
          (tab) => !tab.connectionKey && !tab.query,
        );
        if (unbound)
          return {
            ...current,
            activeTabId: unbound.id,
            tabs: current.tabs.map((tab) =>
              tab.id === unbound.id
                ? { ...tab, kind: activeConnection?.kind, connectionKey: key }
                : tab,
            ),
          };
        const tab = makeQueryTab(activeConnection?.kind, key);
        return {
          ...current,
          tabs: [...current.tabs, tab],
          activeTabId: tab.id,
        };
      });
    }
    if (activeConnection?.kind === "mongodb") {
      setCollection("documents");
      setMongoQueryMode("find");
      setSelectedMongoDatabase(activeConnection!.database || "");
      setSelectedMongoCollection(null);
    }
    setRows([]);
    setColumns([]);
    setQueryError("");
    setQueryPlan(null);
    explainPending.current = false;
    setQuerySummary(
      activeConnection
        ? `${activeConnection?.kind !== "mongodb" ? "PostgreSQL" : "MongoDB"} · ${activeConnection!.serverMode ? "server browser" : activeConnection!.database}`
        : "No query run.",
    );
    if (scrollElement.current) scrollElement.current.scrollTop = 0;
  }, [
    activeConnection?.id,
    activeConnection?.kind,
    activeConnection?.database,
    activeConnection?.serverMode,
  ]);

  // Clicking a table opens its SELECT and runs it once the tab, connection
  // and table structure (for row editing) have settled.
  const pendingTableRun = useRef<{
    connectionId: string;
    query: string;
  } | null>(null);
  useEffect(() => {
    const pending = pendingTableRun.current;
    if (!pending || runState !== "idle" || metadataLoading) return;
    if (
      activeConnection?.id !== pending.connectionId ||
      activeTab?.query !== pending.query
    )
      return;
    pendingTableRun.current = null;
    void runQuery({ connection: activeConnection, query: pending.query });
  }, [
    activeConnection,
    activeTab?.id,
    activeTab?.query,
    metadataLoading,
    runState,
    tableDetails,
  ]);

  useEffect(() => {
    const element = scrollElement.current;
    if (!element) return;
    const update = (): void =>
      setViewport({
        top: element.scrollTop,
        height: element.clientHeight || 480,
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [columns.length > 0, resultsView]);

  function cancelQueryConnection(): void {
    queryConnectionTabId.current = null;
    setShowQueryConnection(false);
    setQueryConnectionServer(null);
    setQueryConnectionError("");
  }

  function chooseQueryConnection(): void {
    if (runState !== "idle" || !activeTab || !closeRowPanel()) return;
    queryConnectionTabId.current = activeTab.id;
    setQueryConnectionServer(null);
    setQueryConnectionDatabases([]);
    setQueryConnectionError("");
    setShowQueryConnection(true);
  }

  /** Open the connect dialog prefilled for the active query's kind. */
  function openConnectForQuery(): void {
    setShowQueryConnection(false);
    setConnectionError("");
    setForm({
      ...DEFAULT_FORM,
      kind: activeTab?.kind ?? "postgres",
      ...kindDefaults(activeTab?.kind ?? "postgres"),
    });
    setShowConnect(true);
  }

  function bindQueryConnection(connection: DatabaseConnectionSummary): void {
    const tabId = queryConnectionTabId.current;
    if (!tabId || connection.serverMode) return;
    setWorkspace((current) => ({
      ...current,
      activeTabId: tabId,
      tabs: current.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              connectionKey: queryConnectionKey(connection),
              updatedAt: Date.now(),
            }
          : tab,
      ),
    }));
    cancelQueryConnection();
    setRows([]);
    setColumns([]);
    setQueryError("");
    setQueryPlan(null);
    setNotice(
      "Query connected. Review the selected database, then run when ready.",
    );
  }

  async function selectQueryConnection(
    source: DatabaseConnectionSummary | SavedConnectionProfile,
    saved = false,
    database?: string,
  ): Promise<void> {
    if (queryConnectionBusy || !queryConnectionTabId.current) return;
    setQueryConnectionBusy(true);
    setQueryConnectionError("");
    try {
      let connected = saved
        ? (connections.find(
            (item) =>
              item.savedConnectionId === source.id && !item.parentConnectionId,
          ) ?? (await window.api.database.connectSaved(source.id)))
        : (source as DatabaseConnectionSummary);
      if (database) {
        connected = await window.api.database.openDatabase(
          connected.id,
          database,
        );
      }
      if (connected.serverMode) {
        // Keep the original draft active until an actual database is selected.
        setConnections((current) => [
          ...current.filter((item) => item.id !== connected.id),
          connected,
        ]);
        setQueryConnectionServer(connected);
        setQueryConnectionDatabases(
          await window.api.database.listDatabases(connected.id),
        );
        setShowQueryConnection(true);
      } else {
        addConnectedConnection(connected);
      }
    } catch (error) {
      setQueryConnectionError(
        error instanceof Error
          ? error.message
          : "Could not connect. Try again or choose another connection.",
      );
    } finally {
      setQueryConnectionBusy(false);
    }
  }

  function addConnectedConnection(connection: DatabaseConnectionSummary): void {
    bindQueryConnection(connection);
    setConnections((current) => {
      const withoutDuplicate = current.filter(
        (item) =>
          !(
            item.id === connection.id ||
            (connection.parentConnectionId &&
              item.parentConnectionId === connection.parentConnectionId &&
              item.database === connection.database)
          ),
      );
      return [...withoutDuplicate, connection];
    });
    setActiveId(connection.id);
    void inspectConnection(connection);
  }

  async function connect(): Promise<void> {
    if (runState !== "idle" || !closeRowPanel()) return;
    if (queryConnectionTabId.current && form.kind !== activeTab?.kind) {
      setConnectionError(
        "Choose a connection matching this query’s database type.",
      );
      return;
    }
    const input = connectionInput();
    if (!input) return;
    setConnecting(true);
    setConnectionError("");
    setTestFailure("");
    try {
      const connected = await window.api.database.connect(input, saveProfile);
      if (queryConnectionTabId.current && connected.serverMode) {
        await selectQueryConnection(connected);
      } else addConnectedConnection(connected);
      if (saveProfile) await refreshSavedConnections();
      setForm(DEFAULT_FORM);
      setSaveProfile(true);
      setShowConnect(false);
    } catch (error) {
      setConnectionError(
        dialogErrorMessage(error, "Could not connect to the database."),
      );
    } finally {
      setConnecting(false);
    }
  }

  /** The dialog's details as sent to the main process, or null when incomplete. */
  function connectionInput(): DatabaseConnectionInput | null {
    if (uriMode) {
      const connectionString = (form.connectionString ?? "").trim();
      if (!connectionString) {
        setConnectionError("Paste a connection string to continue.");
        return null;
      }
      const kind = detectConnectionStringKind(connectionString);
      if (!kind) {
        setConnectionError(
          "Start the connection string with postgres://, postgresql://, mongodb:// or mongodb+srv://.",
        );
        return null;
      }
      return {
        ...form,
        kind,
        serverMode: kind === "postgres" && form.serverMode,
        connectionString,
      };
    }
    return {
      ...form,
      database: form.serverMode ? "" : form.database,
      connectionString: "",
    };
  }

  /** Close the dialog after a profile was saved from it. */
  async function finishSavedConnection(message: string): Promise<void> {
    await refreshSavedConnections();
    setNotice(message);
    setForm(DEFAULT_FORM);
    setSaveProfile(true);
    setShowConnect(false);
    cancelQueryConnection();
  }

  /** Test & Save: probe the server, save the profile only when it answers. */
  async function testAndSaveConnection(): Promise<void> {
    const input = connectionInput();
    if (!input) return;
    setSaveBusy("test");
    setConnectionError("");
    setTestFailure("");
    try {
      let result: DatabaseConnectionTestResult;
      try {
        result = await window.api.database.testConnection(input);
      } catch (error) {
        setTestFailure(
          dialogErrorMessage(error, "Could not connect to the database."),
        );
        return;
      }
      const tested = [
        "connection succeeded",
        result.serverVersion,
        `${result.latencyMs} ms round trip`,
      ]
        .filter(Boolean)
        .join(" · ");
      try {
        const profile = await persistProfile(input);
        await finishSavedConnection(
          `${editingProfileId ? "Updated" : "Saved"} “${profile.name}”: ${tested}.`,
        );
      } catch (error) {
        setConnectionError(
          `The test passed (${tested}) but the connection was not saved: ${dialogErrorMessage(
            error,
            "unknown error.",
          )}`,
        );
      }
    } finally {
      setSaveBusy("");
    }
  }

  /** Save the profile with no connection attempt (Save without testing / Save anyway). */
  async function saveConnectionWithoutTesting(
    source: "save" | "anyway",
  ): Promise<void> {
    const input = connectionInput();
    if (!input) return;
    setSaveBusy(source);
    setConnectionError("");
    try {
      const profile = await persistProfile(input);
      setTestFailure("");
      await finishSavedConnection(
        editingProfileId
          ? `Updated “${profile.name}”. Reconnect to use the new details.`
          : `Saved “${profile.name}” without testing. Open it from saved connections when the server is reachable.`,
      );
    } catch (error) {
      setConnectionError(
        dialogErrorMessage(error, "Could not save the connection."),
      );
    } finally {
      setSaveBusy("");
    }
  }

  function updateConnectionString(value: string): void {
    setTestFailure("");
    setForm((current) => {
      const detected = detectConnectionStringKind(value);
      const kind = detected ?? current.kind;
      // A new scheme switches the kind; until the rest parses, the fields
      // fall back to that kind's defaults rather than the old kind's port.
      const next: DatabaseConnectionInput =
        kind === current.kind
          ? { ...current, connectionString: value }
          : {
              ...current,
              ...kindDefaults(kind),
              kind,
              serverMode: false,
              connectionString: value,
            };
      if (!detected) return next;
      try {
        const parsed = parseConnectionStringFields(kind, value.trim());
        return {
          ...next,
          host: parsed.host,
          port: parsed.port,
          database:
            kind === "postgres"
              ? parsed.database || parsed.username || "postgres"
              : parsed.database,
          username: parsed.username,
          password: parsed.password,
          tls: parsed.tls,
          ...(parsed.sslMode ? { sslMode: parsed.sslMode } : {}),
        };
      } catch {
        // Keep the last valid fields while the string is being edited.
        return next;
      }
    });
  }

  /** Switch between connection string and manual details, carrying values across. */
  function switchConnectMode(useString: boolean): void {
    if (useString === uriMode) return;
    setUriMode(useString);
    if (!editingProfileId)
      try {
        localStorage.setItem(CONNECT_MODE_KEY, useString ? "string" : "manual");
      } catch {
        // The mode is a convenience; keep working without storage.
      }
    setRevealUri(false);
    setTestFailure("");
    setConnectionError("");
    // Start the string from the current fields; the fields (kind included)
    // already mirror the string when switching back to manual.
    setForm((current) => ({
      ...current,
      connectionString: useString ? buildConnectionString(current) : "",
    }));
  }

  function copyConnectionString(value: string): void {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setUriCopied(true);
        window.setTimeout(() => setUriCopied(false), 1_400);
      })
      .catch(() => setConnectionError("Could not copy the connection string."));
  }
  function closeConnectionDialog(): void {
    setShowConnect(false);
    cancelQueryConnection();
    setForm(DEFAULT_FORM);
    setConnectionError("");
  }

  /** Rail card selection: close the row panel, then activate the connection. */
  function selectRailConnection(
    connection: DatabaseConnectionSummary,
  ): boolean {
    if (!closeRowPanel()) return false;
    setActiveId(connection.id);
    return true;
  }

  function openMongoOperation(
    operation: MongoOperation,
    connectionOverride?: DatabaseConnectionSummary,
    prefill: Partial<MongoOperationFields> = {},
  ): void {
    const operationConnection = connectionOverride ?? activeConnection;
    if (!operationConnection || operationConnection.kind !== "mongodb") return;
    setMongoOperationConnection(operationConnection);
    setMongoOperationPrefill(prefill);
    setMongoOperation(operation);
    setMongoOperationError("");
    setMongoOperationSummary("");
  }

  function createMongoDatabase(connection: DatabaseConnectionSummary): void {
    if (!closeRowPanel()) return;
    setActiveId(connection.id);
    setSelectedMongoDatabase("");
    openMongoOperation("create-collection", connection, {
      databaseName: "",
      createNewDatabase: true,
      collectionName: "",
    });
  }
  function dropMongoDatabase(
    connection: DatabaseConnectionSummary,
    database: MongoBrowserDatabase,
  ): void {
    if (!closeRowPanel()) return;
    setActiveId(connection.id);
    setSelectedMongoDatabase(database.name);
    openMongoOperation("drop-database", connection, {
      databaseName: database.name,
    });
  }
  function createMongoCollection(
    connection: DatabaseConnectionSummary,
    database: MongoBrowserDatabase,
  ): void {
    setSelectedMongoDatabase(database.name);
    if (!closeRowPanel()) return;
    setActiveId(connection.id);
    openMongoOperation("create-collection", connection, {
      databaseName: database.name,
    });
  }

  async function submitMongoOperation(
    fields: MongoOperationFields,
  ): Promise<void> {
    if (
      !activeConnection ||
      activeConnection?.kind !== "mongodb" ||
      !mongoOperation
    )
      return;
    const database = fields.createNewDatabase
      ? fields.databaseName.trim()
      : fields.databaseName.trim() ||
        selectedMongoDatabase ||
        activeConnection!.database;
    const targetCollection =
      fields.collectionName.trim() ||
      (mongoOperation === "create-collection"
        ? ""
        : selectedMongoCollection?.name || collection);
    let request: MongoMutationRequest;
    const base = { connectionId: activeConnection!.id, database };
    if (mongoOperation === "drop-database") {
      request = { ...base, operation: "drop-database" };
    } else if (mongoOperation === "insert") {
      request = {
        ...base,
        operation: "insert",
        collection: targetCollection,
        document: fields.document,
      };
    } else if (mongoOperation === "update") {
      request = {
        ...base,
        operation: "update",
        collection: targetCollection,
        filter: fields.filter,
        update: fields.update,
        many: fields.many,
        upsert: fields.upsert,
      };
    } else if (mongoOperation === "delete") {
      request = {
        ...base,
        operation: "delete",
        collection: targetCollection,
        filter: fields.filter,
        many: fields.many,
      };
    } else if (
      mongoOperation === "create-collection" ||
      mongoOperation === "drop-collection"
    ) {
      request = {
        ...base,
        operation: mongoOperation,
        collection: targetCollection,
      };
    } else if (mongoOperation === "create-index") {
      request = {
        ...base,
        operation: "create-index",
        collection: targetCollection,
        keys: fields.indexKeys,
        unique: fields.uniqueIndex,
      };
    } else {
      request = {
        ...base,
        operation: "drop-index",
        collection: targetCollection,
        indexName: fields.indexName,
      };
    }
    setMongoOperationBusy(true);
    setMongoOperationError("");
    try {
      const result = await window.api.database.mutateMongo(request);
      setMongoOperation(null);
      setQueryError("");
      setQuerySummary(
        result.message +
          (result.affectedCount !== undefined
            ? ` · ${result.affectedCount.toLocaleString()} affected`
            : ""),
      );
      const browserKey = mongoBrowserKey(activeConnection!.id, database);
      if (mongoOperation === "drop-database") {
        try {
          const databases = await window.api.database.listMongoDatabases(
            activeConnection!.id,
          );
          setMongoDatabases((current) => ({
            ...current,
            [activeConnection!.id]: databases,
          }));
        } catch {
          setMongoDatabases((current) => ({
            ...current,
            [activeConnection!.id]: (
              current[activeConnection!.id] ?? []
            ).filter((item) => item.name !== database),
          }));
        }
        setSelectedMongoDatabase("");
        setSelectedMongoCollection(null);
        setRows([]);
        setColumns([]);
        return;
      }

      let collections: MongoBrowserCollection[];
      try {
        collections = await window.api.database.listMongoCollections(
          activeConnection!.id,
          database,
        );
      } catch (error) {
        setBrowserErrors((current) => ({
          ...current,
          [browserKey]:
            error instanceof Error
              ? error.message
              : "The operation succeeded, but collections could not be refreshed.",
        }));
        return;
      }
      setMongoCollections((current) => ({
        ...current,
        [browserKey]: collections,
      }));
      try {
        const databases = await window.api.database.listMongoDatabases(
          activeConnection!.id,
        );
        setMongoDatabases((current) => ({
          ...current,
          [activeConnection!.id]: databases,
        }));
      } catch {
        setMongoDatabases((current) => {
          const known = current[activeConnection!.id] ?? [];
          if (mongoOperation === "drop-collection" && collections.length === 0)
            return {
              ...current,
              [activeConnection!.id]: known.filter(
                (item) => item.name !== database,
              ),
            };
          if (known.some((item) => item.name === database)) return current;
          return {
            ...current,
            [activeConnection!.id]: [...known, { name: database }],
          };
        });
      }
      if (mongoOperation === "drop-collection") {
        setSelectedMongoCollection(null);
        setRows([]);
        setColumns([]);
        return;
      }
      setSelectedMongoDatabase(database);
      setExpandedMongoDatabases((current) => ({
        ...current,
        [browserKey]: true,
      }));
      const found = collections.find((item) => item.name === targetCollection);
      if (!found) return;
      const details = await window.api.database.getMongoCollectionDetails(
        activeConnection!.id,
        database,
        targetCollection,
      );
      setMongoCollections((current) => ({
        ...current,
        [browserKey]: (current[browserKey] ?? []).map((item) =>
          item.name === targetCollection ? details : item,
        ),
      }));
      setSelectedMongoCollection(details);
      if (mongoOperation === "create-collection") {
        setMongoQueryMode("find");
        setQueryText("{}");
        await runQuery({
          connection: activeConnection,
          database,
          collection: targetCollection,
          query: "{}",
          mongoMode: "find",
        });
      } else if (
        mongoOperation === "insert" ||
        mongoOperation === "update" ||
        mongoOperation === "delete"
      ) {
        await runQuery({
          connection: activeConnection,
          database,
          collection: targetCollection,
          query: queryText || "{}",
          mongoMode: mongoQueryMode,
        });
      }
    } catch (error) {
      setMongoOperationError(
        error instanceof Error ? error.message : "MongoDB operation failed.",
      );
    } finally {
      setMongoOperationBusy(false);
    }
  }

  function selectTable(
    connection: DatabaseConnectionSummary,
    table: DatabaseBrowserTable,
  ): void {
    if (runState !== "idle" || !closeRowPanel()) return;
    dismissPeek();
    setActiveId(connection.id);
    const query = `SELECT * FROM ${quotePostgresIdentifier(table.schema)}.${quotePostgresIdentifier(table.name)} LIMIT 100;`;
    pendingTableRun.current = { connectionId: connection.id, query };
    newTab(query, table.name, connection);
    setSelectedTable({
      connectionId: connection.id,
      schema: table.schema,
      name: table.name,
    });
    setTableDetails(null);
    setMetadataError("");
    setMetadataLoading(true);
    const request = ++metadataRequest.current;
    void window.api.database
      .getPostgresTableDetails(connection.id, table.schema, table.name)
      .then((details) => {
        if (metadataRequest.current === request) setTableDetails(details);
      })
      .catch((error) => {
        if (metadataRequest.current === request)
          setMetadataError(
            error instanceof Error
              ? error.message
              : "Could not load table structure.",
          );
      })
      .finally(() => {
        if (metadataRequest.current === request) setMetadataLoading(false);
      });
  }

  function updateForm<K extends keyof DatabaseConnectionInput>(
    key: K,
    value: DatabaseConnectionInput[K],
  ): void {
    setTestFailure("");
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <section
      ref={workspaceRef}
      style={
        {
          ["--sidebar-width"]: `${layout.sidebar}px`,
          ["--editor-percent"]: `${layout.split}%`,
          ["--row-panel-width"]: `${layout.rowPanel}px`,
        } as React.CSSProperties
      }
      onMouseMove={(event) => {
        // Backstop for leaves the rail never saw (e.g. after a resize drag).
        if (!sidebarPeek || !sidebarHidden || peekTimer.current) return;
        const rail = railRef.current?.getBoundingClientRect();
        if (rail && event.clientX > rail.right + 16) scheduleSidebarHide();
      }}
      className={`db-workspace${!railOpen && !settingsView ? " sidebar-hidden" : ""}${!sidebarHidden && !settingsView ? " sidebar-docked" : ""}${settingsView ? " settings-open" : ""}${inspectedRow && !settingsView ? " has-row-panel" : ""}`}
    >
      <aside
        id="db-explorer-sidebar"
        className="db-rail"
        ref={railRef}
        aria-label="Database explorer"
        aria-hidden={!railOpen && !settingsView}
        onMouseEnter={() => {
          if (sidebarPeek) clearPeekTimer();
        }}
        onMouseLeave={() => {
          if (sidebarPeek && sidebarHidden) scheduleSidebarHide();
        }}
      >
        <ConnectionRail
          connections={connections}
          savedConnections={savedConnections}
          savedQueries={workspace.saved}
          history={workspace.history}
          activeId={activeId}
          activeConnection={activeConnection}
          railView={railView}
          runState={runState}
          connectBusy={connectBusy}
          connectionError={connectionError}
          rememberQueries={rememberQueries}
          selectedTable={selectedTable}
          tableLists={tableLists}
          serverDatabases={serverDatabases}
          browserLoading={browserLoading}
          browserErrors={browserErrors}
          mongoDatabases={mongoDatabases}
          mongoCollections={mongoCollections}
          expandedMongoDatabases={expandedMongoDatabases}
          selectedMongoDatabase={selectedMongoDatabase}
          selectedMongoCollection={selectedMongoCollection}
          dbSwitcher={dbSwitcher}
          sidebarHidden={sidebarHidden}
          settingsView={Boolean(settingsView)}
          sidebarActions={sidebarActions}
          onNewConnection={() => {
            setShowConnect(true);
            setConnectionError("");
          }}
          onRailViewChange={setRailView}
          onSelectConnection={selectRailConnection}
          onEditSaved={editSaved}
          onConnectSaved={connectSaved}
          onDeleteSaved={deleteSaved}
          onDisconnect={disconnect}
          onInspectConnection={inspectConnection}
          onOpenDatabase={openDatabase}
          onOpenDbSwitcher={toggleDbSwitcher}
          onDbSwitcherFilterChange={(filter) =>
            setDbSwitcher((current) =>
              current ? { ...current, filter } : current,
            )
          }
          onDbSwitcherClose={() => setDbSwitcher(null)}
          onSwitchDatabase={switchDatabase}
          onExpandMongoDatabase={expandMongoDatabase}
          onSelectMongoCollection={selectMongoCollection}
          onCreateMongoDatabase={createMongoDatabase}
          onDropMongoDatabase={dropMongoDatabase}
          onCreateMongoCollection={createMongoCollection}
          onSelectTable={selectTable}
          onNewTab={(query, title, stored) =>
            newTab(query, title, null, stored)
          }
          onSaveCurrentQuery={saveCurrentQuery}
          onClearHistory={() =>
            setWorkspace((current) => ({ ...current, history: [] }))
          }
          onDeleteSavedQuery={(id) =>
            setWorkspace((current) => ({
              ...current,
              saved: current.saved.filter((entry) => entry.id !== id),
            }))
          }
          onRememberQueriesChange={setRememberQueries}
          onDockSidebar={dockSidebar}
          onCloseSidebar={closeSidebar}
        />
      </aside>
      {!railOpen && !settingsView && (
        <div
          className="rail-reveal-edge"
          aria-hidden="true"
          onMouseEnter={revealSidebar}
          onMouseMove={revealSidebar}
        />
      )}
      {settingsView}
      {railOpen && !settingsView && (
        <ResizeSeparator
          className="explorer-resizer"
          label="Resize explorer sidebar"
          orientation="vertical"
          value={layout.sidebar}
          min={220}
          max={Math.min(520, window.innerWidth - 360)}
          onChange={(v) => resizeLayout("sidebar", v)}
        />
      )}
      <div className="db-main" hidden={!!settingsView}>
        <div className="db-workspace-header">
          <button
            className="db-icon-button sidebar-toggle"
            aria-label={
              sidebarHidden ? "Open explorer sidebar" : "Close explorer sidebar"
            }
            title={sidebarHidden ? "Show explorer" : "Collapse explorer"}
            aria-expanded={railOpen}
            aria-controls="db-explorer-sidebar"
            onClick={sidebarHidden ? dockSidebar : closeSidebar}
          >
            {sidebarHidden ? (
              <PanelLeftOpen size={15} />
            ) : (
              <PanelLeftClose size={15} />
            )}
          </button>
          <div>
            <span className="db-overline">
              {activeConnection?.serverMode ||
              activeConnection?.kind === "mongodb"
                ? "SERVER BROWSER"
                : "QUERY WORKSPACE"}
            </span>
            <h1>
              {activeConnection?.name ?? "SQL workspace"}
              {activeConnection && (
                <span className="connection-badge">Connected</span>
              )}
            </h1>
            <p>
              {activeConnection
                ? `${activeConnection?.kind !== "mongodb" ? "PostgreSQL" : "MongoDB"} · ${activeConnection!.host}:${activeConnection!.port} · ${activeConnection?.kind === "mongodb" ? `browse accessible databases · ${selectedMongoDatabase || activeConnection!.database}` : activeConnection!.serverMode ? "browse databases available to this user" : activeConnection!.database}`
                : "Write, organize, and explore. Connect a server when you’re ready to run."}
            </p>
          </div>
          <button
            className="db-quiet-button help-button"
            aria-label="Keyboard shortcuts"
            onClick={() => setShowHelp(true)}
          >
            <CircleHelp size={16} />
          </button>
          {activeConnection && (
            <button
              className="db-quiet-button"
              disabled={runState !== "idle"}
              onClick={() => void disconnect(activeConnection)}
            >
              Disconnect
            </button>
          )}
        </div>

        {activeConnection?.kind === "mongodb" &&
          selectedMongoCollection &&
          selectedMongoDatabase && (
            <section
              className="db-mongo-details"
              aria-label="MongoDB collection details"
            >
              <div className="db-mongo-details-bar">
                <button
                  type="button"
                  className="db-mongo-details-toggle"
                  aria-expanded={mongoDetailsOpen}
                  onClick={() => toggleMongoDetails()}
                  title={
                    mongoDetailsOpen
                      ? "Hide collection details"
                      : "Show indexes, validator and options"
                  }
                >
                  <ChevronRight
                    size={13}
                    className={mongoDetailsOpen ? "open" : undefined}
                    aria-hidden="true"
                  />
                  <strong>
                    {selectedMongoDatabase}.{selectedMongoCollection.name}
                  </strong>
                  <span>
                    {selectedMongoCollection.type}
                    {selectedMongoCollection.estimatedDocuments !== undefined
                      ? ` · ~${selectedMongoCollection.estimatedDocuments.toLocaleString()} docs`
                      : ""}{" "}
                    · {(selectedMongoCollection.indexes ?? []).length} indexes
                  </span>
                </button>
                <div className="db-mongo-actions">
                  <button
                    className="db-quiet-button"
                    disabled={runState !== "idle" || mongoOperationBusy}
                    onClick={() => openMongoOperation("insert")}
                  >
                    ＋ Insert
                  </button>
                  <button
                    className="db-quiet-button"
                    disabled={runState !== "idle" || mongoOperationBusy}
                    onClick={() => openMongoOperation("update")}
                  >
                    Update
                  </button>
                  <div className="db-mongo-more" ref={mongoMoreRef}>
                    <button
                      className="db-quiet-button"
                      aria-label="More collection actions"
                      aria-haspopup="menu"
                      aria-expanded={mongoMoreOpen}
                      disabled={mongoOperationBusy}
                      onClick={() => setMongoMoreOpen((open) => !open)}
                    >
                      ⋯
                    </button>
                    {mongoMoreOpen && (
                      <div className="db-mongo-more-menu" role="menu">
                        <button
                          role="menuitem"
                          onClick={() => {
                            setMongoMoreOpen(false);
                            openMongoOperation("create-index");
                          }}
                        >
                          ＋ Create index
                        </button>
                        <div className="db-mongo-more-label">Danger zone</div>
                        <button
                          role="menuitem"
                          className="danger"
                          disabled={runState !== "idle"}
                          onClick={() => {
                            setMongoMoreOpen(false);
                            openMongoOperation("delete");
                          }}
                        >
                          Delete documents…
                        </button>
                        <button
                          role="menuitem"
                          className="danger"
                          onClick={() => {
                            setMongoMoreOpen(false);
                            openMongoOperation("drop-collection");
                          }}
                        >
                          Drop collection…
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {mongoDetailsOpen && (
                <>
                  {(selectedMongoCollection.indexes?.length ?? 0) > 0 && (
                    <div className="db-mongo-indexes">
                      {selectedMongoCollection.indexes?.map((index) => (
                        <div className="db-mongo-index" key={index.name}>
                          <span>
                            <b>{index.name}</b>
                            {index.unique ? " · unique" : ""}
                            {index.expireAfterSeconds !== undefined
                              ? ` · TTL ${index.expireAfterSeconds}s`
                              : ""}
                            <code>{index.keys}</code>
                          </span>
                          {index.name !== "_id_" && (
                            <button
                              className="db-inline-add danger"
                              title={`Drop index ${index.name}`}
                              aria-label={`Drop index ${index.name}`}
                              onClick={() => {
                                openMongoOperation("drop-index", undefined, {
                                  indexName: index.name,
                                });
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedMongoCollection.validator && (
                    <details className="db-mongo-validator">
                      <summary>Collection validator</summary>
                      <code>{selectedMongoCollection.validator}</code>
                    </details>
                  )}
                  {selectedMongoCollection.options && (
                    <details className="db-mongo-validator">
                      <summary>Collection options</summary>
                      <code>{selectedMongoCollection.options}</code>
                    </details>
                  )}
                </>
              )}
            </section>
          )}

        {notice && (
          <div className="workspace-notice" role="status">
            {notice}
            <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {!activeConnection?.serverMode && (
          <div className="query-tabbar" role="tablist" aria-label="Query tabs">
            {workspace.tabs.map((tab) => (
              <div
                key={tab.id}
                className={`query-tab${tab.id === activeTab?.id ? " active" : ""}`}
              >
                <button
                  role="tab"
                  aria-selected={tab.id === activeTab?.id}
                  disabled={runState !== "idle"}
                  onClick={() => {
                    if (!closeRowPanel()) return;
                    setRowSource(null);
                    setWorkspace((current) => ({
                      ...current,
                      activeTabId: tab.id,
                    }));
                    setRows([]);
                    setColumns([]);
                    setQueryError("");
                    setQuerySummary("Ready to execute.");
                    setSelectedTable(null);
                    setTableDetails(null);
                    setResultView("data");
                  }}
                >
                  <FileCode2 size={13} />
                  <span>{tab.title}</span>
                  {tab.query.trim() && <i title="Draft autosaved locally" />}
                </button>
                <button
                  disabled={runState !== "idle"}
                  aria-label={`Close ${tab.title}`}
                  onClick={() => closeTab(tab.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              className="new-tab"
              title="New query tab (Ctrl/Cmd T)"
              aria-label="New query tab"
              disabled={runState !== "idle"}
              onClick={() => newTab()}
            >
              <Plus size={15} />
            </button>
          </div>
        )}
        {activeConnection?.serverMode ? (
          <div className="db-empty-workspace db-server-welcome">
            <span className="db-results-glyph">▦</span>
            <b>Choose a database to browse its tables</b>
            <p>
              Rowfish shows databases this PostgreSQL user can connect to. It
              does not grant access the user does not already have.
            </p>
          </div>
        ) : (
          <div className="query-split-layout">
            <div className="db-editor-card">
              <div className="db-editor-topline">
                <div className="db-editor-tabs">
                  <span className="db-editor-tab active">
                    {(activeTab?.kind ?? activeConnection?.kind) !== "mongodb"
                      ? "SQL editor"
                      : mongoQueryMode === "find"
                        ? "Find filter"
                        : "Aggregation pipeline"}
                  </span>
                  <span className="db-editor-language">
                    {(activeTab?.kind ?? activeConnection?.kind) !== "mongodb"
                      ? "POSTGRESQL"
                      : "MONGODB JSON"}
                  </span>
                </div>
                <div className="db-editor-controls">
                  {activeTab?.kind === "mongodb" && (
                    <label className="db-limit-field">
                      <span>Mode</span>
                      <select
                        value={mongoQueryMode}
                        onChange={(event) => {
                          const mode = event.target.value as
                            "find" | "aggregate";
                          setMongoQueryMode(mode);
                          setQueryText(mode === "find" ? "{}" : "[]");
                        }}
                        aria-label="MongoDB query mode"
                      >
                        <option value="find">Find</option>
                        <option value="aggregate">Aggregate</option>
                      </select>
                    </label>
                  )}
                  {activeTab?.kind === "mongodb" &&
                    (pickerCollections.length > 0 &&
                    activeConnection?.kind === "mongodb" ? (
                      <label className="db-collection-field db-collection-picker">
                        <span title={selectedMongoDatabase}>
                          {selectedMongoDatabase} ›
                        </span>
                        <select
                          value={collection}
                          disabled={runState !== "idle"}
                          aria-label="MongoDB collection"
                          onChange={(event) => {
                            const item = pickerCollections.find(
                              (entry) => entry.name === event.target.value,
                            );
                            if (item)
                              void selectMongoCollection(
                                activeConnection,
                                selectedMongoDatabase,
                                item,
                                { keepQuery: true },
                              );
                          }}
                        >
                          {!pickerCollections.some(
                            (entry) => entry.name === collection,
                          ) && <option value={collection}>{collection}</option>}
                          {pickerCollections.map((entry) => (
                            <option key={entry.name} value={entry.name}>
                              {entry.name}
                              {entry.type === "view" ? " (view)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="db-collection-field">
                        <span>Collection</span>
                        <input
                          value={collection}
                          onChange={(event) =>
                            setCollection(event.target.value)
                          }
                          aria-label="MongoDB collection name"
                          maxLength={128}
                        />
                      </label>
                    ))}
                  <label className="db-limit-field">
                    <span>Max rows</span>
                    <select
                      aria-label="Max rows"
                      value={maxRows}
                      onChange={(event) =>
                        setMaxRows(Number(event.target.value))
                      }
                    >
                      <option value={500}>500</option>
                      <option value={1000}>1,000</option>
                      <option value={5000}>5,000</option>
                      <option value={10000}>10,000</option>
                    </select>
                  </label>
                  {runState === "idle" ? (
                    <button
                      className="db-run-button"
                      onClick={() => void runQuery()}
                      disabled={
                        !queryText.trim() &&
                        (activeTab?.kind ?? activeConnection?.kind) !==
                          "mongodb"
                      }
                    >
                      <span>▶</span> Run query
                    </button>
                  ) : (
                    <button
                      className="db-cancel-button"
                      onClick={() => void cancelQuery()}
                      disabled={runState === "cancelling"}
                    >
                      {runState === "cancelling" ? "Cancelling…" : "■ Cancel"}
                    </button>
                  )}
                </div>
              </div>
              <div className="query-actions">
                <span>
                  {activeConnection
                    ? `${activeConnection.database || "server"} / ${activeTab?.title ?? "Query"}`
                    : "OFFLINE DRAFT · connect a server to execute"}
                </span>
                <button
                  onClick={chooseQueryConnection}
                  disabled={runState !== "idle"}
                  title="Select or reconnect a database for this query"
                >
                  {activeConnection
                    ? "Change query connection"
                    : "Select connection"}
                </button>
                <button
                  onClick={formatQuery}
                  disabled={activeTab?.kind === "mongodb" || !queryText.trim()}
                >
                  Format SQL
                </button>
                <button onClick={saveCurrentQuery} disabled={!queryText.trim()}>
                  <Save size={13} />
                  Save
                </button>
                <button
                  title="Export SQL file"
                  aria-label="Export query"
                  onClick={() =>
                    downloadText(
                      `${activeTab?.title ?? "query"}.${activeTab?.kind === "mongodb" ? "json" : "sql"}`,
                      queryText,
                      "text/plain",
                    )
                  }
                >
                  <Download size={13} />
                </button>
              </div>
              {activeConnection?.kind === "postgres" &&
                activeTab?.kind === "postgres" && (
                  <div className="pg-tools-bar">
                    <button
                      type="button"
                      data-testid="explain-query"
                      disabled={
                        !queryText.trim() ||
                        runState !== "idle" ||
                        activeConnection.serverMode
                      }
                      title="Estimate the selected SQL or single-statement draft without ANALYZE"
                      onClick={() => {
                        try {
                          const explain = buildExplainQuery(
                            sqlSelection.trim() || queryText,
                          );
                          void runQuery({ query: explain, explain: true });
                        } catch (error) {
                          setQueryError(
                            error instanceof Error
                              ? error.message
                              : "Could not build EXPLAIN query.",
                          );
                        }
                      }}
                    >
                      Explain (estimated)
                    </button>
                    <label>
                      <span className="pg-tools-label">PostgreSQL tools</span>
                      <select
                        aria-label="PostgreSQL diagnostic query"
                        value=""
                        disabled={
                          runState !== "idle" || activeConnection.serverMode
                        }
                        onChange={(event) => {
                          const item = postgresDiagnostics.find(
                            (entry) => entry.id === event.target.value,
                          );
                          if (item) newTab(item.sql, item.label);
                        }}
                      >
                        <option value="">Open diagnostic…</option>
                        {postgresDiagnostics.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="pg-tools-hint">
                      Opens a draft · run when ready
                    </span>
                  </div>
                )}
              <SqlEditor
                lineWrapping={preferences.lineWrapping}
                lineNumbers={preferences.lineNumbers}
                value={queryText}
                onChange={setQueryText}
                onSelectionChange={setSqlSelection}
                onRun={(selection) =>
                  void runQuery({ query: selection ?? queryText })
                }
                kind={activeTab?.kind ?? activeConnection?.kind ?? "postgres"}
                tables={autocompleteTables}
                mongo={mongoCompletion}
                disabled={runState !== "idle"}
              />
              <div className="db-editor-footer">
                <span>
                  {(activeTab?.kind ?? activeConnection?.kind) !== "mongodb"
                    ? "Ctrl/⌘ Enter: selection or statement · Shift: run all · 120s timeout"
                    : mongoQueryMode === "find"
                      ? "⌘ Enter to run · $where is disabled · maxTimeMS 120 seconds"
                      : "⌘ Enter to run · read-only pipeline · $out, $merge and server-side JavaScript disabled"}
                </span>
                <span>
                  Draft autosaved locally · {maxRows.toLocaleString()} rows / 16
                  MB cap
                </span>
              </div>
            </div>

            <ResizeSeparator
              label="Resize editor and results split"
              orientation="horizontal"
              value={layout.split}
              min={20}
              max={78}
              onChange={(v) => resizeLayout("split", v)}
            />
            <div className="db-results-card">
              <div className="db-results-header">
                <div>
                  <div className="result-tabs">
                    {(queryPlan !== null || resultView === "plan") && (
                      <button
                        className={resultView === "plan" ? "active" : ""}
                        onClick={() => setResultView("plan")}
                      >
                        <FileCode2 size={14} /> Plan
                      </button>
                    )}
                    <button
                      className={resultView === "data" ? "active" : ""}
                      onClick={() => setResultView("data")}
                    >
                      <Table2 size={14} /> Results
                    </button>
                    <button
                      disabled={!selectedTable}
                      className={resultView === "structure" ? "active" : ""}
                      onClick={() => setResultView("structure")}
                    >
                      <Columns3 size={14} /> Structure
                    </button>
                    <button
                      disabled={!selectedTable}
                      className={resultView === "indexes" ? "active" : ""}
                      onClick={() => setResultView("indexes")}
                    >
                      <KeyRound size={14} /> Indexes & constraints
                    </button>
                  </div>
                  <p className="db-results-summary" aria-live="polite">
                    {runState !== "idle"
                      ? `${runState === "cancelling" ? "Cancelling query" : "Query running"} · ${rows.length.toLocaleString()} rows received`
                      : querySummary}
                  </p>
                </div>
                {resultView === "plan" ? (
                  <div className="result-actions">
                    <button
                      disabled={queryPlan === null || runState !== "idle"}
                      onClick={() =>
                        downloadText(
                          "rowfish-plan.json",
                          typeof rows[0]?.["QUERY PLAN"] === "string"
                            ? rows[0]["QUERY PLAN"]
                            : JSON.stringify(queryPlan, null, 2),
                          "application/json",
                        )
                      }
                    >
                      Export plan JSON <Download size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="result-actions">
                    {columns.length > 0 && (
                      <div
                        className="db-view-toggle"
                        role="group"
                        aria-label="Results view"
                      >
                        {(
                          [
                            ["list", List, "List"],
                            ["json", Braces, "JSON"],
                            ["table", Table2, "Table"],
                          ] as const
                        ).map(([view, Icon, label]) => (
                          <button
                            key={view}
                            className={resultsView === view ? "active" : ""}
                            aria-pressed={resultsView === view}
                            aria-label={`${label} view`}
                            title={`${label} view`}
                            onClick={() => chooseResultsView(view)}
                          >
                            <Icon size={12} />
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <span className="db-row-count">
                      {visibleRows.length.toLocaleString()}
                      {deferredSearch || filtersActive
                        ? ` / ${rows.length.toLocaleString()}`
                        : ""}{" "}
                      rows
                    </span>
                    {filtersActive && (
                      <button
                        title="Clear every column filter"
                        onClick={() => setColumnFilters({})}
                      >
                        Clear filters <X size={12} />
                      </button>
                    )}
                    <button
                      disabled={!columns.length || runState !== "idle"}
                      title="Export filtered rows as CSV"
                      onClick={() =>
                        downloadText(
                          "rowfish-results.csv",
                          exportResultsCsv(columns, visibleRows),
                          "text/csv",
                        )
                      }
                    >
                      CSV <Download size={12} />
                    </button>
                    <button
                      disabled={!columns.length || runState !== "idle"}
                      title="Export filtered rows as JSON"
                      onClick={() =>
                        downloadText(
                          "rowfish-results.json",
                          exportResultsJson(visibleRows),
                          "application/json",
                        )
                      }
                    >
                      JSON <Download size={12} />
                    </button>
                  </div>
                )}
              </div>
              {queryError && (
                <div className="db-query-error" role="alert">
                  {queryError}
                </div>
              )}
              {deferredQuery && (
                <div className="db-progress-track">
                  <span />
                </div>
              )}
              {resultView === "plan" ? (
                queryPlan !== null ? (
                  <QueryPlan result={queryPlan} />
                ) : (
                  <div className="metadata-panel">
                    {runState !== "idle"
                      ? "Requesting estimated plan…"
                      : "No estimated plan available."}
                  </div>
                )
              ) : resultView !== "data" ? (
                <div className="metadata-panel">
                  {metadataLoading ? (
                    <p>Loading table metadata…</p>
                  ) : metadataError ? (
                    <div role="alert" className="db-query-error">
                      {metadataError}
                    </div>
                  ) : tableDetails ? (
                    <TableMetadata details={tableDetails} view={resultView} />
                  ) : (
                    <p>
                      Select a table in the explorer to inspect its structure.
                    </p>
                  )}
                </div>
              ) : columns.length > 0 && resultsView !== "table" ? (
                <DocumentResults
                  view={resultsView}
                  rows={visibleRows}
                  documentOf={documentOf}
                  selectedRow={inspectedRow}
                  resetKey={resultsResetKey}
                  onInspect={inspectRow}
                  onEdit={documentActionsEnabled ? editDocument : undefined}
                  onClone={documentActionsEnabled ? cloneDocument : undefined}
                  onDelete={documentActionsEnabled ? deleteDocument : undefined}
                />
              ) : columns.length > 0 ? (
                <ResultsTable
                  columns={columns}
                  windowedRows={windowedRows}
                  firstVisible={firstVisible}
                  lastVisible={lastVisible}
                  visibleRowCount={visibleRows.length}
                  tableWidth={tableWidth}
                  widthOf={widthOf}
                  mongoColumnKinds={mongoColumnKinds}
                  sort={sort}
                  columnFilters={columnFilters}
                  filterMenu={filterMenu}
                  filterMenuRows={filterMenuRows}
                  inspectedRow={inspectedRow}
                  rowSource={rowSource}
                  cellText={cellText}
                  scrollElement={scrollElement}
                  onScroll={setViewport}
                  onSortColumn={toggleSortColumn}
                  onFilterMenuToggle={toggleFilterMenu}
                  onFilterChange={setColumnFilter}
                  onMenuSort={sortColumn}
                  onCloseFilterMenu={closeFilterMenu}
                  onResizeStart={startColumnResize}
                  onAutoFit={autoFitColumn}
                  onInspect={inspectRow}
                />
              ) : (
                <div
                  className={`db-results-empty${runState !== "idle" ? " loading" : ""}`}
                >
                  {runState !== "idle" ? (
                    <>
                      <span className="db-spinner" />
                      <b>Query running</b>
                    </>
                  ) : queryError ? (
                    <>
                      <b>Query stopped</b>
                      <p>Check the error above.</p>
                    </>
                  ) : (
                    <>
                      <span className="db-results-glyph">▤</span>
                      <b>No results</b>
                      <p>Run a query to view rows.</p>
                      <div className="empty-shortcuts">
                        <span>
                          Autocomplete<kbd>Ctrl Space</kbd>
                        </span>
                        <span>
                          Run statement<kbd>Ctrl / ⌘ Enter</kbd>
                        </span>
                        <span>
                          Format SQL<kbd>Ctrl / ⌘ Shift F</kbd>
                        </span>
                        <span>
                          Save to library<kbd>Ctrl / ⌘ S</kbd>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
              {columns.length > 0 && resultView === "data" && (
                <div className="db-grid-footer">
                  <span>{rows.length.toLocaleString()} rows</span>
                  <span>
                    {resultsView === "table"
                      ? "Click a row to inspect / edit · drag header edges to resize"
                      : resultsView === "list"
                        ? "Expand fields with ▸ · hover a document for actions"
                        : "Relaxed EJSON · read only"}{" "}
                    ·{" "}
                    {serverInfo
                      ? `${serverInfo.database} / ${serverInfo.user}`
                      : "Filtered exports"}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {inspectedRow && (
        <>
          <ResizeSeparator
            reverse
            className="row-details-resizer"
            label="Resize row details panel"
            orientation="vertical"
            value={layout.rowPanel}
            min={300}
            max={Math.min(560, window.innerWidth - 360)}
            onChange={(v) => resizeLayout("rowPanel", v)}
          />
          <RowSidePanel
            row={inspectedRow}
            source={rowSource}
            onClose={() => {
              closeRowPanel();
            }}
            onDirtyChange={setRowDirty}
            onBusyChange={setRowBusy}
            onSaved={(updated) => {
              setRows((current) =>
                current.map((row) =>
                  rowSource && isSameRow(rowSource.details, row, inspectedRow)
                    ? updated
                    : row,
                ),
              );
            }}
          />
        </>
      )}

      <SaveQueryDialog
        open={saveDialog}
        name={queryName}
        onNameChange={setQueryName}
        folder={queryFolder}
        onFolderChange={setQueryFolder}
        onSave={saveQueryToLibrary}
        onClose={() => setSaveDialog(false)}
      />
      <HelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
      <QueryConnectionDialog
        server={queryConnectionServer}
        databases={queryConnectionDatabases}
        busy={queryConnectionBusy}
        error={queryConnectionError}
        tabKind={activeTab?.kind}
        tabTitle={activeTab?.title}
        connections={connections}
        savedConnections={savedConnections}
        onSelect={selectQueryConnection}
        onCancel={cancelQueryConnection}
        onServerChange={setQueryConnectionServer}
        onConnectNew={openConnectForQuery}
      />
      <ConnectionDialog
        form={form}
        onFormChange={setForm}
        onUpdateForm={updateForm}
        onTestFailureChange={setTestFailure}
        uriMode={uriMode}
        onSwitchMode={switchConnectMode}
        detectedKind={detectedKind}
        revealUri={revealUri}
        onRevealUriChange={setRevealUri}
        uriCopied={uriCopied}
        onCopyConnectionString={copyConnectionString}
        onConnectionStringChange={updateConnectionString}
        connectionStringStatus={connectionStringStatus}
        generatedConnectionString={generatedConnectionString}
        saveProfile={saveProfile}
        onSaveProfileChange={setSaveProfile}
        editingProfileId={editingProfileId}
        testFailure={testFailure}
        onSaveWithoutTesting={saveConnectionWithoutTesting}
        saveBusy={saveBusy}
        connectionError={connectionError}
        connectBusy={connectBusy}
        connecting={connecting}
        onConnect={() => void connect()}
        onTestAndSave={() => void testAndSaveConnection()}
        onClose={closeConnectionDialog}
        connectionStringBlocked={connectionStringBlocked}
      />
      {mongoOperation &&
        mongoOperationConnection &&
        activeConnection?.kind === "mongodb" && (
          <MongoOperationDialog
            key={`${mongoOperation}:${mongoOperationConnection.id}`}
            operation={mongoOperation}
            connection={mongoOperationConnection}
            activeDatabase={activeConnection!.database}
            selectedDatabase={selectedMongoDatabase}
            selectedCollection={selectedMongoCollection}
            fallbackCollection={collection}
            prefill={mongoOperationPrefill}
            busy={mongoOperationBusy}
            error={mongoOperationError}
            summary={mongoOperationSummary}
            onSubmit={(fields) => void submitMongoOperation(fields)}
            onClose={() => setMongoOperation(null)}
          />
        )}
    </section>
  );
}
