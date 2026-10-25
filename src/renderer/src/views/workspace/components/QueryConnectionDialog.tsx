import { Database, RefreshCw } from "lucide-react";
import type {
  DatabaseBrowserDatabase,
  DatabaseConnectionSummary,
  DatabaseKind,
  SavedConnectionProfile,
} from "../../../../../shared/database";

/**
 * The "choose a query connection" dialog. Presentational: the workspace
 * owns the dialog state and the select/cancel/bind handlers (selecting is
 * also used by the connect dialog's server-mode flow); this component
 * renders the dialog and reports interactions back through its props.
 */
export default function QueryConnectionDialog({
  server,
  databases,
  busy,
  error,
  tabKind,
  tabTitle,
  connections,
  savedConnections,
  onSelect,
  onCancel,
  onServerChange,
  onConnectNew,
}: {
  server: DatabaseConnectionSummary | null;
  databases: DatabaseBrowserDatabase[];
  busy: boolean;
  error: string;
  tabKind: DatabaseKind | undefined;
  tabTitle: string | undefined;
  connections: DatabaseConnectionSummary[];
  savedConnections: SavedConnectionProfile[];
  onSelect: (
    source: DatabaseConnectionSummary | SavedConnectionProfile,
    saved?: boolean,
    database?: string,
  ) => void;
  onCancel: () => void;
  onServerChange: (server: DatabaseConnectionSummary | null) => void;
  onConnectNew: () => void;
}): React.JSX.Element {
  return (
    <div
      className="db-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (!busy) onCancel();
      }}
    >
      <section
        className="db-modal compact-modal query-connection-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a query connection"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="db-modal-head">
          <h2>Choose a query connection</h2>
          <button
            className="db-icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={onCancel}
          >
            ×
          </button>
        </div>
        <p className="db-modal-copy">
          Select a {tabKind === "mongodb" ? "MongoDB" : "PostgreSQL"} connection
          for {tabTitle ?? "this query"}. Your draft stays intact. Connecting
          does not run the query.
        </p>
        <div className="query-connection-options">
          {server ? (
            <>
              <b>{server.name} · choose a database</b>
              {databases
                .filter((database) => database.canConnect)
                .map((database) => (
                  <button
                    key={database.name}
                    disabled={busy}
                    aria-label={`Use database ${database.name}`}
                    onClick={() => void onSelect(server, false, database.name)}
                  >
                    <Database size={15} /> {database.name}
                  </button>
                ))}
              {!databases.some((database) => database.canConnect) && !busy && (
                <p>
                  No accessible databases found. Choose another connection or
                  retry.
                </p>
              )}
              <button disabled={busy} onClick={() => void onSelect(server)}>
                Refresh databases
              </button>
              <button disabled={busy} onClick={() => onServerChange(null)}>
                Other connections
              </button>
            </>
          ) : (
            <>
              {connections
                .filter((connection) => connection.kind === tabKind)
                .map((connection) => (
                  <button
                    key={connection.id}
                    disabled={busy}
                    aria-label={`Use ${connection.name}`}
                    onClick={() => void onSelect(connection)}
                  >
                    <Database size={15} /> {connection.name} ·{" "}
                    {connection.database || "choose database"} · connected
                  </button>
                ))}
              {savedConnections
                .filter((profile) => profile.kind === tabKind)
                .map((profile) => (
                  <button
                    key={profile.id}
                    disabled={busy}
                    aria-label={`Reconnect ${profile.name}`}
                    onClick={() => void onSelect(profile, true)}
                  >
                    <RefreshCw size={15} /> {profile.name} ·{" "}
                    {profile.database || "choose database"} · saved
                  </button>
                ))}
              {!connections.some((connection) => connection.kind === tabKind) &&
                !savedConnections.some(
                  (profile) => profile.kind === tabKind,
                ) && (
                  <p>
                    No matching connections yet. Add a connection to use this
                    draft.
                  </p>
                )}
            </>
          )}
        </div>
        {busy && <p role="status">Connecting…</p>}
        {error && (
          <div className="db-query-error" role="alert">
            {error}
          </div>
        )}
        <div className="db-modal-actions">
          <button
            className="db-quiet-button"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="db-run-button"
            disabled={busy}
            onClick={onConnectNew}
          >
            New connection
          </button>
        </div>
      </section>
    </div>
  );
}
