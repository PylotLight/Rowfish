import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FileCode2,
  GitBranch,
  History,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Search,
  Server,
  Table2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  AlembicStatus,
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionSummary,
  AlembicModelComparison,
  MongoBrowserCollection,
  MongoBrowserDatabase,
  SavedConnectionProfile,
} from "../../../../../shared/database";
import {
  canSwitchDatabase,
  connectionSubline,
  type RailView,
  type RunState,
} from "../workspace-helpers";
import type {
  QueryHistoryEntry,
  SavedQuery,
} from "../../../lib/query-workspace";
import DbSwitcher from "./DbSwitcher";
import MongoBrowser from "./MongoBrowser";

/**
 * The explorer sidebar content: heading, rail tabs (servers / saved queries /
 * history), object search, the per-connection browser trees and the saved
 * server list. The rail view, the folded connections/schemas and the search
 * text are owned here; everything that talks to the database or to other
 * workspace areas goes through callbacks.
 */
export default function ConnectionRail({
  connections,
  savedConnections,
  savedQueries,
  history,
  activeId,
  activeConnection,
  railView,
  runState,
  connectBusy,
  connectionError,
  rememberQueries,
  selectedTable,
  tableLists,
  serverDatabases,
  browserLoading,
  browserErrors,
  mongoDatabases,
  mongoCollections,
  expandedMongoDatabases,
  selectedMongoDatabase,
  selectedMongoCollection,
  dbSwitcher,
  sidebarHidden,
  settingsView,
  sidebarActions,
  onNewConnection,
  onRailViewChange,
  onSelectConnection,
  onEditSaved,
  onConnectSaved,
  onDeleteSaved,
  onDisconnect,
  onInspectConnection,
  onOpenDatabase,
  onOpenDbSwitcher,
  onDbSwitcherFilterChange,
  onDbSwitcherClose,
  onSwitchDatabase,
  onExpandMongoDatabase,
  onSelectMongoCollection,
  onCreateMongoDatabase,
  onDropMongoDatabase,
  onCreateMongoCollection,
  onSelectTable,
  onNewTab,
  onSaveCurrentQuery,
  onClearHistory,
  onDeleteSavedQuery,
  onRememberQueriesChange,
  onDockSidebar,
  onCloseSidebar,
}: {
  connections: DatabaseConnectionSummary[];
  savedConnections: SavedConnectionProfile[];
  savedQueries: SavedQuery[];
  history: QueryHistoryEntry[];
  activeId: string;
  activeConnection: DatabaseConnectionSummary | null;
  railView: RailView;
  runState: RunState;
  connectBusy: boolean;
  connectionError: string;
  rememberQueries: boolean;
  selectedTable: { connectionId: string; schema: string; name: string } | null;
  tableLists: Record<string, DatabaseBrowserTable[]>;
  serverDatabases: Record<string, DatabaseBrowserDatabase[]>;
  browserLoading: Record<string, boolean>;
  browserErrors: Record<string, string>;
  mongoDatabases: Record<string, MongoBrowserDatabase[]>;
  mongoCollections: Record<string, MongoBrowserCollection[]>;
  expandedMongoDatabases: Record<string, boolean>;
  selectedMongoDatabase: string;
  selectedMongoCollection: MongoBrowserCollection | null;
  dbSwitcher: {
    connectionId: string;
    databases: DatabaseBrowserDatabase[] | null;
    filter: string;
    error: string;
    busy: string;
  } | null;
  sidebarHidden: boolean;
  settingsView: boolean;
  sidebarActions: ReactNode;
  onNewConnection: () => void;
  onRailViewChange: (view: RailView) => void;
  /** Selects the connection (closing the row panel first); false aborts. */
  onSelectConnection: (connection: DatabaseConnectionSummary) => boolean;
  onEditSaved: (profileId: string) => void;
  onConnectSaved: (profile: SavedConnectionProfile) => void;
  onDeleteSaved: (profile: SavedConnectionProfile) => void;
  onDisconnect: (connection: DatabaseConnectionSummary) => void;
  onInspectConnection: (connection: DatabaseConnectionSummary) => void;
  onOpenDatabase: (
    connection: DatabaseConnectionSummary,
    database: DatabaseBrowserDatabase,
  ) => void;
  onOpenDbSwitcher: (connection: DatabaseConnectionSummary) => void;
  onDbSwitcherFilterChange: (filter: string) => void;
  onDbSwitcherClose: () => void;
  onSwitchDatabase: (
    connection: DatabaseConnectionSummary,
    database: DatabaseBrowserDatabase,
  ) => void;
  onExpandMongoDatabase: (
    connection: DatabaseConnectionSummary,
    database: MongoBrowserDatabase,
  ) => void;
  onSelectMongoCollection: (
    connection: DatabaseConnectionSummary,
    database: string,
    item: MongoBrowserCollection,
  ) => void;
  onCreateMongoDatabase: (connection: DatabaseConnectionSummary) => void;
  onDropMongoDatabase: (
    connection: DatabaseConnectionSummary,
    database: MongoBrowserDatabase,
  ) => void;
  onCreateMongoCollection: (
    connection: DatabaseConnectionSummary,
    database: MongoBrowserDatabase,
  ) => void;
  onSelectTable: (
    connection: DatabaseConnectionSummary,
    table: DatabaseBrowserTable,
  ) => void;
  onNewTab: (
    query: string,
    title: string,
    stored: Pick<SavedQuery, "kind" | "connectionKey">,
  ) => void;
  onSaveCurrentQuery: () => void;
  onClearHistory: () => void;
  onDeleteSavedQuery: (id: string) => void;
  onRememberQueriesChange: (value: boolean) => void;
  onDockSidebar: () => void;
  onCloseSidebar: () => void;
}): React.JSX.Element {
  const [collapsedConnections, setCollapsedConnections] = useState<
    Record<string, boolean>
  >({});
  const [objectSearch, setObjectSearch] = useState("");
  const [collapsedSchemas, setCollapsedSchemas] = useState<
    Record<string, boolean>
  >({});
  const [migrationConnectionId, setMigrationConnectionId] = useState("");
  const [migrationDirectory, setMigrationDirectory] = useState("");
  const [migrationStatus, setMigrationStatus] = useState<AlembicStatus | null>(
    null,
  );
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migrationError, setMigrationError] = useState("");
  const [modelConnectionId, setModelConnectionId] = useState("");
  const [modelConfigPath, setModelConfigPath] = useState("");
  const [modelPythonPath, setModelPythonPath] = useState("");
  const [modelComparison, setModelComparison] =
    useState<AlembicModelComparison | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const migrationConnections = connections.filter(
    (connection) =>
      (connection.kind === "postgres" || connection.kind === "sqlite") &&
      !connection.serverMode,
  );
  const selectedMigrationConnection =
    migrationConnections.find(
      (connection) => connection.id === migrationConnectionId,
    ) ??
    migrationConnections.find((connection) => connection.id === activeId) ??
    migrationConnections[0] ??
    null;
  const modelConnections = connections.filter(
    (connection) => connection.kind === "postgres" && !connection.serverMode,
  );
  const selectedModelConnection =
    modelConnections.find(
      (connection) => connection.id === modelConnectionId,
    ) ??
    modelConnections.find((connection) => connection.id === activeId) ??
    modelConnections[0] ??
    null;
  useEffect(() => {
    setMigrationStatus(null);
    setMigrationError("");
  }, [selectedMigrationConnection?.id]);
  useEffect(() => {
    setModelComparison(null);
    setModelError("");
  }, [selectedModelConnection?.id]);
  const orderedMigrationNodes = migrationStatus
    ? [
        ...migrationStatus.graph.topologicalOrder
          .map((revision) =>
            migrationStatus.graph.revisions.find(
              (node) => node.revision === revision,
            ),
          )
          .filter(
            (node): node is AlembicStatus["graph"]["revisions"][number] =>
              node !== undefined,
          ),
        ...migrationStatus.graph.revisions.filter(
          (node) =>
            !migrationStatus.graph.topologicalOrder.includes(node.revision),
        ),
      ]
    : [];

  async function refreshMigrationStatus(
    directory = migrationDirectory,
    connectionId = selectedMigrationConnection?.id,
  ): Promise<void> {
    if (!connectionId) {
      setMigrationError("Connect to PostgreSQL or SQLite first.");
      return;
    }
    if (!directory.trim()) {
      setMigrationError("Select an Alembic versions directory first.");
      return;
    }
    setMigrationLoading(true);
    setMigrationError("");
    try {
      const status = await window.api.database.getAlembicStatus(
        connectionId,
        directory,
      );
      setMigrationStatus(status);
    } catch (error) {
      setMigrationStatus(null);
      setMigrationError(
        error instanceof Error
          ? error.message
          : "Could not compare the database with this migration directory.",
      );
    } finally {
      setMigrationLoading(false);
    }
  }

  async function chooseMigrationDirectory(): Promise<void> {
    try {
      const directory = await window.api.app.chooseAlembicDirectory();
      if (!directory) return;
      setMigrationDirectory(directory);
      setMigrationStatus(null);
      await refreshMigrationStatus(directory);
    } catch (error) {
      setMigrationError(
        error instanceof Error
          ? error.message
          : "Could not open the Alembic versions directory picker.",
      );
    }
  }

  async function chooseModelConfig(): Promise<void> {
    try {
      const configPath = await window.api.app.chooseAlembicConfig();
      if (!configPath) return;
      setModelConfigPath(configPath);
      setModelComparison(null);
      setModelError("");
    } catch (error) {
      setModelError(
        error instanceof Error
          ? error.message
          : "Could not open the Alembic configuration picker.",
      );
    }
  }

  async function chooseModelPython(): Promise<void> {
    try {
      const pythonPath = await window.api.app.choosePythonInterpreter();
      if (!pythonPath) return;
      setModelPythonPath(pythonPath);
      setModelComparison(null);
      setModelError("");
    } catch (error) {
      setModelError(
        error instanceof Error
          ? error.message
          : "Could not open the Python interpreter picker.",
      );
    }
  }

  async function compareModelState(): Promise<void> {
    if (!selectedModelConnection) {
      setModelError("Connect to a live PostgreSQL database first.");
      return;
    }
    if (!modelConfigPath.trim()) {
      setModelError("Select an Alembic configuration file first.");
      return;
    }
    const approved = window.confirm(
      "Rowfish will run this repository's Alembic environment and import its SQLAlchemy models to inspect schema differences. The database connection requests a read-only session, and generated SQL is shown for review only—it is never run. Repository Python code can still have local side effects. Continue only if you trust this project.",
    );
    if (!approved) return;
    setModelLoading(true);
    setModelError("");
    setModelComparison(null);
    try {
      const result = await window.api.database.compareAlembicModels(
        selectedModelConnection.id,
        modelConfigPath,
        modelPythonPath,
      );
      setModelComparison(result);
    } catch (error) {
      setModelError(
        error instanceof Error
          ? error.message
          : "Could not compare PostgreSQL with SQLAlchemy model metadata.",
      );
    } finally {
      setModelLoading(false);
    }
  }

  function renderTables(
    connection: DatabaseConnectionSummary,
  ): React.JSX.Element {
    const tables = (tableLists[connection.id] ?? []).filter((table) =>
      `${table.schema}.${table.name}`
        .toLowerCase()
        .includes(objectSearch.toLowerCase()),
    );
    const grouped = tables.reduce<Record<string, DatabaseBrowserTable[]>>(
      (groups, table) => {
        (groups[table.schema] ??= []).push(table);
        return groups;
      },
      {},
    );
    return (
      <div className="db-browser-objects">
        {browserLoading[connection.id] && (
          <div className="db-browser-hint">
            <span className="db-spinner small" /> Loading tables…
          </div>
        )}
        {browserErrors[connection.id] && (
          <div className="db-browser-error">{browserErrors[connection.id]}</div>
        )}
        {Object.entries(grouped).map(([schema, schemaTables]) => (
          <div className="db-browser-schema" key={`${connection.id}:${schema}`}>
            <button
              className="db-browser-schema-name"
              onClick={() =>
                setCollapsedSchemas((current) => ({
                  ...current,
                  [`${connection.id}:${schema}`]:
                    !current[`${connection.id}:${schema}`],
                }))
              }
            >
              {collapsedSchemas[`${connection.id}:${schema}`] ? (
                <ChevronRight size={12} />
              ) : (
                <ChevronDown size={12} />
              )}{" "}
              {schema} <span>{schemaTables.length}</span>
            </button>
            {!collapsedSchemas[`${connection.id}:${schema}`] &&
              schemaTables.map((table) => (
                <button
                  className={`db-browser-object${selectedTable?.connectionId === connection.id && selectedTable.schema === table.schema && selectedTable.name === table.name ? " active" : ""}`}
                  key={`${table.schema}.${table.name}`}
                  title={`${table.kind}: ${table.schema}.${table.name}`}
                  onClick={() => onSelectTable(connection, table)}
                >
                  <Table2 size={13} />
                  <span>{table.name}</span>
                  <small>{table.kind === "view" ? "view" : ""}</small>
                </button>
              ))}
          </div>
        ))}
        {!browserLoading[connection.id] &&
          !browserErrors[connection.id] &&
          tables.length === 0 && (
            <div className="db-browser-hint">No tables or views found.</div>
          )}
      </div>
    );
  }

  return (
    <>
      <div className="db-rail-heading">
        <h2>Explorer</h2>
        {!settingsView && (
          <button
            className="db-icon-button rail-close"
            aria-label={
              sidebarHidden
                ? "Pin explorer sidebar"
                : "Collapse explorer sidebar"
            }
            title={sidebarHidden ? "Keep explorer open" : "Collapse explorer"}
            aria-pressed={!sidebarHidden}
            onClick={sidebarHidden ? onDockSidebar : onCloseSidebar}
          >
            {sidebarHidden ? (
              <PanelLeftOpen size={15} />
            ) : (
              <PanelLeftClose size={15} />
            )}
          </button>
        )}
      </div>
      <button className="db-connect-button" onClick={onNewConnection}>
        <span>＋</span> New connection
      </button>
      <div className="rail-tabs" role="tablist" aria-label="Explorer views">
        {(
          [
            { id: "servers", label: "Servers", Icon: Server },
            { id: "saved", label: "Queries", Icon: BookOpen },
            { id: "history", label: "History", Icon: History },
            { id: "migrations", label: "Migrations", Icon: GitBranch },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            role="tab"
            aria-selected={railView === id}
            key={id}
            className={railView === id ? "active" : ""}
            onClick={() => onRailViewChange(id)}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {railView !== "migrations" && (
        <div className="object-search">
          <Search size={14} />
          <input
            aria-label="Search explorer"
            placeholder={
              railView === "servers"
                ? "Filter tables and schemas…"
                : "Search queries…"
            }
            value={objectSearch}
            onChange={(event) => setObjectSearch(event.target.value)}
          />
          {railView === "servers" && (
            <button
              title="Refresh browser"
              aria-label="Refresh browser"
              disabled={!activeConnection || runState !== "idle"}
              onClick={() =>
                activeConnection && onInspectConnection(activeConnection)
              }
            >
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      )}
      {(railView === "saved" || railView === "history") && (
        <div className="query-library">
          <div className="library-heading">
            <span>
              {railView === "saved" ? "SAVED QUERIES" : "RECENT EXECUTIONS"}
            </span>
            <button
              onClick={() => {
                if (railView === "history") onClearHistory();
                else onSaveCurrentQuery();
              }}
            >
              {railView === "history" ? "Clear" : "+ Save"}
            </button>
          </div>
          {railView === "history" && (
            <label className="history-toggle">
              <input
                type="checkbox"
                checked={rememberQueries}
                onChange={(event) =>
                  onRememberQueriesChange(event.target.checked)
                }
              />{" "}
              Record query text locally
            </label>
          )}
          {railView === "saved"
            ? savedQueries
                .filter((item) =>
                  `${item.title} ${item.query} ${item.folder}`
                    .toLowerCase()
                    .includes(objectSearch.toLowerCase()),
                )
                .map((item) => (
                  <div className="library-item" key={item.id}>
                    <button
                      onClick={() => onNewTab(item.query, item.title, item)}
                    >
                      <span className="library-folder">{item.folder}</span>
                      <b>
                        <FileCode2 size={13} /> {item.title}
                      </b>
                      <code>{item.query.slice(0, 100)}</code>
                    </button>
                    <button
                      className="library-delete"
                      aria-label={`Delete saved query ${item.title}`}
                      onClick={() => onDeleteSavedQuery(item.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))
            : history
                .filter((item) =>
                  `${item.query} ${item.connectionName}`
                    .toLowerCase()
                    .includes(objectSearch.toLowerCase()),
                )
                .map((item) => (
                  <div className="library-item" key={item.id}>
                    <button
                      onClick={() => onNewTab(item.query, "From history", item)}
                    >
                      <span className={`history-status ${item.status}`}>
                        {item.status} · {item.connectionName}
                      </span>
                      <code>{item.query.slice(0, 120)}</code>
                      <small>
                        {new Date(item.startedAt).toLocaleString()}
                        {item.elapsedMs !== undefined
                          ? ` · ${item.elapsedMs} ms`
                          : ""}
                      </small>
                    </button>
                  </div>
                ))}
          {(railView === "saved" ? savedQueries : history).length === 0 && (
            <div className="db-empty-rail">
              <FileCode2 size={26} />
              <b>
                {railView === "saved" ? "Your query library" : "A clean slate"}
              </b>
              <p>
                {railView === "saved"
                  ? "Save useful SQL with a name and folder. Your work stays on this device."
                  : "Executed queries appear here with timing and status. Restore one without running it."}
              </p>
            </div>
          )}
        </div>
      )}
      {railView === "migrations" && (
        <section className="db-migration-panel" aria-label="Alembic migrations">
          <div className="db-migration-heading">
            <b>ALEMBIC STATUS</b>
            <span>READ ONLY</span>
          </div>
          <label className="db-migration-field">
            <span>Live database</span>
            <select
              value={selectedMigrationConnection?.id ?? ""}
              onChange={(event) => {
                setMigrationConnectionId(event.target.value);
                setMigrationStatus(null);
                setMigrationError("");
              }}
              disabled={migrationConnections.length === 0}
            >
              {migrationConnections.length === 0 ? (
                <option value="">No PostgreSQL or SQLite connection</option>
              ) : (
                migrationConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} · {connection.database}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="db-migration-field">
            <span>Alembic versions directory</span>
            <input
              value={migrationDirectory}
              onChange={(event) => {
                setMigrationDirectory(event.target.value);
                setMigrationStatus(null);
              }}
              placeholder="Select a repo's versions folder"
              spellCheck={false}
            />
          </label>
          <div className="db-migration-actions">
            <button
              type="button"
              className="db-quiet-button"
              onClick={() => void chooseMigrationDirectory()}
              disabled={migrationLoading}
            >
              Browse…
            </button>
            <button
              type="button"
              className="db-primary-button"
              onClick={() => void refreshMigrationStatus()}
              disabled={migrationLoading || !selectedMigrationConnection}
            >
              {migrationLoading ? "Checking…" : "Check live status"}
            </button>
          </div>
          {migrationError && (
            <div className="db-migration-warning" role="alert">
              {migrationError}
            </div>
          )}
          {!migrationStatus && !migrationError && (
            <div className="db-browser-hint">
              Compare the default alembic_version rows with migration files in
              this checkout. Select another checkout's versions folder to
              compare a different repo state.
            </div>
          )}
          {migrationStatus && (
            <>
              <div className="db-migration-summary">
                <b>
                  {migrationStatus.database.tableFound
                    ? migrationStatus.database.revisions.length
                      ? `${migrationStatus.database.revisions.length} current revision${migrationStatus.database.revisions.length === 1 ? "" : "s"}`
                      : "Alembic table is empty"
                    : "No alembic_version table"}
                </b>
                {migrationStatus.database.revisions.length > 0 && (
                  <small>
                    {migrationStatus.database.revisions.join(" · ")}
                  </small>
                )}
                {migrationStatus.database.schema && (
                  <small>
                    Version table schema: {migrationStatus.database.schema}
                  </small>
                )}
                <small>
                  Repo heads:{" "}
                  {migrationStatus.graph.heads.join(", ") || "none found"}
                </small>
                {migrationStatus.database.error && (
                  <small className="db-migration-warning">
                    {migrationStatus.database.error}
                  </small>
                )}
              </div>
              {migrationStatus.graph.diagnostics.length > 0 && (
                <div className="db-migration-warning">
                  {migrationStatus.graph.diagnostics.map((message) => (
                    <div key={message}>{message}</div>
                  ))}
                </div>
              )}
              {migrationStatus.comparison.diagnostics.length > 0 && (
                <div className="db-migration-warning">
                  {migrationStatus.comparison.diagnostics.map((message) => (
                    <div key={message}>{message}</div>
                  ))}
                </div>
              )}
              <div className="db-migration-list" aria-label="Migration graph">
                {orderedMigrationNodes.map((node, index) => {
                  const current = migrationStatus.database.revisions.includes(
                    node.revision,
                  );
                  const applied = migrationStatus.comparison.applied.includes(
                    node.revision,
                  );
                  const comparisonUncertain =
                    migrationStatus.comparison.unknown.length > 0 ||
                    migrationStatus.graph.diagnostics.length > 0;
                  const state = current
                    ? "current"
                    : applied
                      ? "applied"
                      : comparisonUncertain
                        ? "unknown"
                        : "pending";
                  return (
                    <div
                      className="db-migration-node"
                      key={`${node.filename}:${index}`}
                    >
                      <span className={`db-migration-dot ${state}`} />
                      <div className="db-migration-node-copy">
                        <b>{node.revision || "Invalid revision"}</b>
                        <small>{node.message || node.filename}</small>
                        {node.downRevisions.length > 0 && (
                          <small>from {node.downRevisions.join(", ")}</small>
                        )}
                        {node.dependsOn.length > 0 && (
                          <small>depends on {node.dependsOn.join(", ")}</small>
                        )}
                        {node.branchLabels.length > 0 && (
                          <small>branch: {node.branchLabels.join(", ")}</small>
                        )}
                      </div>
                      <span className={`db-migration-state ${state}`}>
                        {state}
                      </span>
                    </div>
                  );
                })}
                {orderedMigrationNodes.length === 0 && (
                  <div className="db-browser-hint">
                    No Python revision files found in this directory.
                  </div>
                )}
              </div>
              <small className="db-migration-footnote">
                Pending means the revision is not an ancestor of a known
                database current revision; unknown means the repository graph
                cannot establish its status. This compares revision metadata,
                not model/schema drift, and never generates or applies SQL.
              </small>
            </>
          )}
          <div className="db-model-compare">
            <div className="db-migration-heading">
              <b>SQLALCHEMY MODEL DRIFT</b>
              <span>PREVIEW ONLY</span>
            </div>
            <label className="db-migration-field">
              <span>Live PostgreSQL database</span>
              <select
                value={selectedModelConnection?.id ?? ""}
                onChange={(event) => {
                  setModelConnectionId(event.target.value);
                  setModelComparison(null);
                  setModelError("");
                }}
                disabled={modelConnections.length === 0}
              >
                {modelConnections.length === 0 ? (
                  <option value="">No live PostgreSQL connection</option>
                ) : (
                  modelConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name} · {connection.database}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="db-migration-field">
              <span>Alembic configuration file</span>
              <input
                aria-label="Alembic configuration file"
                value={modelConfigPath}
                onChange={(event) => {
                  setModelConfigPath(event.target.value);
                  setModelComparison(null);
                }}
                placeholder="Path to alembic.ini"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="db-quiet-button db-model-browse"
              onClick={() => void chooseModelConfig()}
              disabled={modelLoading}
            >
              Browse for Alembic config…
            </button>
            <label className="db-migration-field">
              <span>Python interpreter (optional)</span>
              <input
                aria-label="Python interpreter path"
                value={modelPythonPath}
                onChange={(event) => {
                  setModelPythonPath(event.target.value);
                  setModelComparison(null);
                }}
                placeholder="Auto-detect project .venv"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="db-quiet-button db-model-browse"
              onClick={() => void chooseModelPython()}
              disabled={modelLoading}
            >
              Choose Python interpreter…
            </button>
            <div className="db-migration-warning">
              Comparison runs the repository’s Alembic environment and model
              imports. The database session requests read-only mode, but project
              Python code can have local side effects. Only compare code you
              trust. Generated SQL is for review and is never run.
            </div>
            <button
              type="button"
              className="db-primary-button db-model-compare-button"
              onClick={() => void compareModelState()}
              disabled={
                modelLoading ||
                !selectedModelConnection ||
                !modelConfigPath.trim()
              }
            >
              {modelLoading ? "Comparing…" : "Compare live DB with models"}
            </button>
            {modelError && (
              <div className="db-migration-warning" role="alert">
                {modelError}
              </div>
            )}
            {modelComparison && (
              <div className="db-model-results" aria-live="polite">
                <div className="db-migration-summary">
                  <b>
                    {modelComparison.operations.length === 0
                      ? "No model/schema differences detected"
                      : `${modelComparison.operations.length} difference${modelComparison.operations.length === 1 ? "" : "s"} found`}
                  </b>
                  <small>
                    Alembic {modelComparison.alembicVersion} · SQLAlchemy{" "}
                    {modelComparison.sqlalchemyVersion}
                  </small>
                </div>
                {modelComparison.diagnostics.map((message) => (
                  <div className="db-migration-warning" key={message}>
                    {message}
                  </div>
                ))}
                {modelComparison.operations.length > 0 && (
                  <div
                    className="db-model-operation-list"
                    aria-label="Model differences"
                  >
                    {modelComparison.operations.map((operation, index) => (
                      <div
                        className="db-model-operation"
                        key={`${operation.kind}:${index}`}
                      >
                        <small>{operation.kind.replaceAll("-", " ")}</small>
                        <span>{operation.description}</span>
                      </div>
                    ))}
                  </div>
                )}
                {modelComparison.sqlPreview ? (
                  <details className="db-model-sql">
                    <summary>Generated SQL preview · not executed</summary>
                    <pre>{modelComparison.sqlPreview}</pre>
                  </details>
                ) : modelComparison.operations.length > 0 ? (
                  <div className="db-migration-warning">
                    No complete SQL preview is available. Review the comparison
                    diagnostics before taking any action.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>
      )}
      <div
        className="db-connection-list"
        style={{ display: railView === "servers" ? undefined : "none" }}
        aria-label="Database server browser"
      >
        {connections
          .filter((connection) => !connection.parentConnectionId)
          .map((connection) => (
            <div className="db-browser-server" key={connection.id}>
              <div
                className={`db-connection${activeId === connection.id ? " selected" : ""}${canSwitchDatabase(connection) ? " switchable" : ""}${connection.savedConnectionId && !connection.parentConnectionId ? " editable" : ""}`}
              >
                <button
                  className="db-connection-select"
                  disabled={runState !== "idle"}
                  aria-expanded={!collapsedConnections[connection.id]}
                  title={
                    activeId === connection.id
                      ? collapsedConnections[connection.id]
                        ? "Expand"
                        : "Collapse"
                      : undefined
                  }
                  onClick={() => {
                    // A second click on the selected card folds its tree.
                    if (activeId === connection.id) {
                      setCollapsedConnections((current) => ({
                        ...current,
                        [connection.id]: !current[connection.id],
                      }));
                      return;
                    }
                    if (!onSelectConnection(connection)) return;
                    setCollapsedConnections((current) => ({
                      ...current,
                      [connection.id]: false,
                    }));
                  }}
                >
                  <ChevronRight
                    size={12}
                    className={`db-connection-chevron${collapsedConnections[connection.id] ? "" : " open"}`}
                    aria-hidden="true"
                  />
                  <span
                    className={`db-engine-mark ${connection.kind}`}
                    aria-hidden="true"
                  >
                    {connection.kind === "postgres"
                      ? "P"
                      : connection.kind === "mongodb"
                        ? "M"
                        : "S"}
                  </span>
                  <span className="db-connection-copy">
                    <b>{connection.name}</b>
                    <small>{connectionSubline(connection)}</small>
                  </span>
                  <span className="db-live-dot" aria-label="Connected" />
                </button>
                {canSwitchDatabase(connection) && (
                  <button
                    className={`db-db-switch${dbSwitcher?.connectionId === connection.id ? " open" : ""}`}
                    title="Switch database"
                    aria-label={`Switch database on ${connection.name}`}
                    aria-expanded={dbSwitcher?.connectionId === connection.id}
                    disabled={runState !== "idle"}
                    onClick={() => onOpenDbSwitcher(connection)}
                  >
                    <ChevronsUpDown size={13} />
                  </button>
                )}
                {connection.savedConnectionId &&
                  !connection.parentConnectionId && (
                    <button
                      className="db-edit-connection"
                      title={`Edit ${connection.name}`}
                      aria-label={`Edit ${connection.name}`}
                      disabled={connectBusy}
                      onClick={() => onEditSaved(connection.savedConnectionId!)}
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                <button
                  className="db-disconnect"
                  title={`Disconnect ${connection.name}`}
                  aria-label={`Disconnect ${connection.name}`}
                  onClick={() => onDisconnect(connection)}
                >
                  ×
                </button>
              </div>
              {dbSwitcher?.connectionId === connection.id && (
                <DbSwitcher
                  connection={connection}
                  state={dbSwitcher}
                  onFilterChange={onDbSwitcherFilterChange}
                  onSwitch={(database) =>
                    onSwitchDatabase(connection, database)
                  }
                  onClose={onDbSwitcherClose}
                />
              )}
              {!collapsedConnections[connection.id] && (
                <>
                  {connection.kind === "postgres" && connection.serverMode && (
                    <div className="db-browser-objects db-browser-databases">
                      <div className="db-browser-section-title">
                        SERVER BROWSER
                      </div>
                      {browserLoading[connection.id] && (
                        <div className="db-browser-hint">
                          <span className="db-spinner small" /> Loading
                          databases…
                        </div>
                      )}
                      {browserErrors[connection.id] && (
                        <div className="db-browser-error">
                          {browserErrors[connection.id]}
                        </div>
                      )}
                      {(serverDatabases[connection.id] ?? []).map(
                        (database) => {
                          const child = connections.find(
                            (item) =>
                              item.parentConnectionId === connection.id &&
                              item.database === database.name,
                          );
                          const loadingKey = `${connection.id}:${database.name}`;
                          return (
                            <div
                              className="db-browser-database-group"
                              key={database.name}
                            >
                              <button
                                className="db-browser-database"
                                disabled={
                                  !database.canConnect ||
                                  browserLoading[loadingKey]
                                }
                                title={
                                  database.canConnect
                                    ? `Open ${database.name}`
                                    : `No CONNECT permission for ${database.name}`
                                }
                                onClick={() =>
                                  onOpenDatabase(connection, database)
                                }
                              >
                                <span aria-hidden="true">
                                  {child ? "▾" : "›"}
                                </span>
                                <span>{database.name}</span>
                                {browserLoading[loadingKey] && (
                                  <span className="db-spinner small" />
                                )}
                              </button>
                              {child && (
                                <button
                                  className="db-child-close"
                                  title={`Close ${database.name} session`}
                                  aria-label={`Close ${database.name} session`}
                                  onClick={() => onDisconnect(child)}
                                >
                                  ×
                                </button>
                              )}
                              {!database.canConnect && (
                                <div className="db-browser-hint db-browser-indent">
                                  No CONNECT permission
                                </div>
                              )}
                              {child && renderTables(child)}
                              {browserErrors[loadingKey] && (
                                <div className="db-browser-error db-browser-indent">
                                  {browserErrors[loadingKey]}
                                </div>
                              )}
                            </div>
                          );
                        },
                      )}
                      {!browserLoading[connection.id] &&
                        serverDatabases[connection.id]?.length === 0 && (
                          <div className="db-browser-hint">
                            No databases were returned.
                          </div>
                        )}
                    </div>
                  )}
                  {(connection.kind === "postgres" ||
                    connection.kind === "sqlite") &&
                    !connection.serverMode &&
                    renderTables(connection)}
                  {connection.kind === "mongodb" && (
                    <MongoBrowser
                      connection={connection}
                      databases={mongoDatabases[connection.id] ?? []}
                      collections={mongoCollections}
                      expanded={expandedMongoDatabases}
                      selectedDatabase={selectedMongoDatabase}
                      selectedCollection={selectedMongoCollection}
                      activeId={activeId}
                      loading={browserLoading}
                      errors={browserErrors}
                      onExpand={onExpandMongoDatabase}
                      onSelectCollection={onSelectMongoCollection}
                      onCreateDatabase={onCreateMongoDatabase}
                      onDropDatabase={onDropMongoDatabase}
                      onCreateCollection={onCreateMongoCollection}
                    />
                  )}
                </>
              )}
            </div>
          ))}
        {connections.length === 0 && (
          <div className="db-empty-rail">
            {savedConnections.length > 0 ? (
              <>
                <b>Not connected</b>
                <p>Pick a saved server to connect.</p>
              </>
            ) : (
              <>
                <b>No connections</b>
                <p>Add a PostgreSQL, MongoDB, or SQLite connection.</p>
              </>
            )}
          </div>
        )}
        {savedConnections.length > 0 && (
          <div className="db-saved-connections">
            <div className="db-browser-section-title">SAVED SERVERS</div>
            {savedConnections
              .filter((profile) =>
                `${profile.name} ${profile.host} ${profile.database}`
                  .toLowerCase()
                  .includes(objectSearch.toLowerCase()),
              )
              .map((profile) => {
                const active = connections.some(
                  (connection) =>
                    connection.savedConnectionId === profile.id &&
                    !connection.parentConnectionId,
                );
                const loading = browserLoading[`saved:${profile.id}`];
                return (
                  <div
                    className={`db-saved-profile${active ? " active" : ""}`}
                    key={profile.id}
                  >
                    <button
                      className="db-saved-connect"
                      disabled={loading}
                      onClick={() => onConnectSaved(profile)}
                    >
                      <span
                        className={`db-engine-mark ${profile.kind}`}
                        aria-hidden="true"
                      >
                        {profile.kind === "postgres"
                          ? "P"
                          : profile.kind === "mongodb"
                            ? "M"
                            : "S"}
                      </span>
                      <span className="db-connection-copy">
                        <b>{profile.name}</b>
                        <small>
                          {profile.serverMode
                            ? `${profile.host}:${profile.port} · all databases`
                            : `${profile.kind === "postgres" ? "PostgreSQL" : profile.kind === "mongodb" ? "MongoDB" : "SQLite"} · ${profile.database}`}
                        </small>
                      </span>
                      {loading && <span className="db-spinner small" />}
                    </button>
                    <button
                      className="db-disconnect db-edit-saved"
                      title={`Edit ${profile.name}`}
                      aria-label={`Edit ${profile.name}`}
                      onClick={() => onEditSaved(profile.id)}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      className="db-disconnect db-delete-saved"
                      title={`Forget ${profile.name}`}
                      aria-label={`Forget ${profile.name}`}
                      onClick={() => onDeleteSaved(profile)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
          </div>
        )}
      </div>
      {connectionError && (
        <div className="db-query-error db-rail-error" role="alert">
          {connectionError}
        </div>
      )}
      <div className="db-rail-footer">
        <span
          className="db-security-note"
          title="Saved passwords are encrypted by your operating system."
        >
          <KeyRound size={13} className="db-security-mark" />
          Keychain encrypted
        </span>
        {sidebarActions}
      </div>
    </>
  );
}
