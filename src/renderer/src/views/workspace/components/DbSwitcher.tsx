import type {
  DatabaseBrowserDatabase,
  DatabaseConnectionSummary,
} from "../../../../../shared/database";

/**
 * The per-connection database switcher popover (PostgreSQL, non-server
 * mode). Presentational: the workspace owns the dbSwitcher state and the
 * list/switch IPC; this component renders the open popover for one
 * connection.
 */
export default function DbSwitcher({
  connection,
  state,
  onFilterChange,
  onSwitch,
  onClose,
}: {
  connection: DatabaseConnectionSummary;
  state: {
    connectionId: string;
    databases: DatabaseBrowserDatabase[] | null;
    filter: string;
    error: string;
    busy: string;
  };
  onFilterChange: (filter: string) => void;
  onSwitch: (database: DatabaseBrowserDatabase) => void;
  onClose: () => void;
}): React.JSX.Element {
  const filter = state.filter.trim().toLowerCase();
  const databases = (state.databases ?? []).filter((database) =>
    database.name.toLowerCase().includes(filter),
  );
  const firstMatch = databases.find((database) => database.canConnect);
  return (
    <div
      className="db-db-switcher"
      role="dialog"
      aria-label="Switch database"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      {(state.databases?.length ?? 0) > 6 && (
        <input
          className="db-db-switcher-filter"
          autoFocus
          placeholder="Filter databases"
          value={state.filter}
          onChange={(event) => onFilterChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && firstMatch) onSwitch(firstMatch);
          }}
        />
      )}
      {state.databases === null && (
        <div className="db-browser-hint">
          <span className="db-spinner small" /> Loading databases…
        </div>
      )}
      {databases.map((database) => {
        const current = database.name === connection.database;
        return (
          <button
            key={database.name}
            className={`db-db-switcher-item${current ? " current" : ""}`}
            disabled={!database.canConnect || Boolean(state.busy)}
            title={
              database.canConnect
                ? current
                  ? `${database.name} (current)`
                  : `Switch to ${database.name}`
                : `No CONNECT permission for ${database.name}`
            }
            onClick={() => onSwitch(database)}
          >
            <span aria-hidden="true">{current ? "✓" : ""}</span>
            <span>{database.name}</span>
            {state.busy === database.name && (
              <span className="db-spinner small" />
            )}
          </button>
        );
      })}
      {state.databases !== null && databases.length === 0 && !state.error && (
        <div className="db-browser-hint">No matching databases.</div>
      )}
      {state.error && <div className="db-browser-error">{state.error}</div>}
    </div>
  );
}
