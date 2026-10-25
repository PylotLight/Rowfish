import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FileCode2,
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
import { useState } from "react";
import type { ReactNode } from "react";
import type {
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionSummary,
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
      {railView !== "servers" && (
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
                    {connection.kind === "postgres" ? "P" : "M"}
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
                  {connection.kind === "postgres" &&
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
                <p>Add a PostgreSQL or MongoDB connection.</p>
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
                        {profile.kind === "postgres" ? "P" : "M"}
                      </span>
                      <span className="db-connection-copy">
                        <b>{profile.name}</b>
                        <small>
                          {profile.serverMode
                            ? `${profile.host}:${profile.port} · all databases`
                            : `${profile.kind === "postgres" ? "PostgreSQL" : "MongoDB"} · ${profile.database}`}
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
