import type {
  DatabaseConnectionSummary,
  MongoBrowserCollection,
  MongoBrowserDatabase,
} from "../../../../../shared/database";
import { mongoBrowserKey } from "../workspace-helpers";

/**
 * The MongoDB database/collection tree shown in the rail for each MongoDB
 * connection. Presentational: the workspace owns the browser state and the
 * expand/select/open-operation handlers; this component renders one
 * connection's tree.
 */
export default function MongoBrowser({
  connection,
  databases,
  collections,
  expanded,
  selectedDatabase,
  selectedCollection,
  activeId,
  loading,
  errors,
  onExpand,
  onSelectCollection,
  onCreateDatabase,
  onDropDatabase,
  onCreateCollection,
}: {
  connection: DatabaseConnectionSummary;
  databases: MongoBrowserDatabase[];
  collections: Record<string, MongoBrowserCollection[]>;
  expanded: Record<string, boolean>;
  selectedDatabase: string;
  selectedCollection: MongoBrowserCollection | null;
  activeId: string;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
  onExpand: (
    connection: DatabaseConnectionSummary,
    database: MongoBrowserDatabase,
  ) => void;
  onSelectCollection: (
    connection: DatabaseConnectionSummary,
    database: string,
    item: MongoBrowserCollection,
  ) => void;
  onCreateDatabase: (connection: DatabaseConnectionSummary) => void;
  onDropDatabase: (
    connection: DatabaseConnectionSummary,
    database: MongoBrowserDatabase,
  ) => void;
  onCreateCollection: (
    connection: DatabaseConnectionSummary,
    database: MongoBrowserDatabase,
  ) => void;
}): React.JSX.Element {
  return (
    <div className="db-browser-objects db-browser-databases">
      <div className="db-browser-section-title">
        DATABASES{" "}
        <button
          className="db-inline-add"
          title="Create a database"
          aria-label="Create a database"
          onClick={() => onCreateDatabase(connection)}
        >
          ＋
        </button>
      </div>
      {loading[connection.id] && (
        <div className="db-browser-hint">
          <span className="db-spinner small" /> Loading databases…
        </div>
      )}
      {errors[connection.id] && (
        <div className="db-browser-error">{errors[connection.id]}</div>
      )}
      {databases.map((database) => {
        const key = mongoBrowserKey(connection.id, database.name);
        const isExpanded = Boolean(expanded[key]);
        const items = collections[key] ?? [];
        return (
          <div className="db-browser-database-group" key={database.name}>
            <button
              className={`db-browser-database${selectedDatabase === database.name && activeId === connection.id ? " active" : ""}`}
              title={`${database.name}${database.sizeOnDisk !== undefined ? ` · ${database.sizeOnDisk.toLocaleString()} bytes` : ""}`}
              onClick={() => void onExpand(connection, database)}
            >
              <span aria-hidden="true">{isExpanded ? "▾" : "›"}</span>
              <span>{database.name}</span>
              {database.sizeOnDisk !== undefined && (
                <small className="db-browser-size">
                  {database.sizeOnDisk >= 1024 * 1024
                    ? `${(database.sizeOnDisk / (1024 * 1024)).toFixed(1)} MB`
                    : `${Math.ceil(database.sizeOnDisk / 1024)} KB`}
                </small>
              )}
            </button>
            {!["admin", "config", "local"].includes(database.name) && (
              <button
                className="db-child-close"
                title={`Drop database ${database.name}`}
                aria-label={`Drop database ${database.name}`}
                onClick={() => onDropDatabase(connection, database)}
              >
                ×
              </button>
            )}
            {isExpanded && (
              <div className="db-browser-mongo-collections">
                <div className="db-browser-collection-actions">
                  <span>
                    {items.length}{" "}
                    {items.length === 1 ? "collection" : "collections"}
                  </span>
                  <button
                    className="db-inline-add"
                    title={`Create collection in ${database.name}`}
                    aria-label={`Create collection in ${database.name}`}
                    onClick={() => onCreateCollection(connection, database)}
                  >
                    ＋
                  </button>
                </div>
                {loading[key] && (
                  <div className="db-browser-hint">
                    <span className="db-spinner small" /> Loading collections…
                  </div>
                )}
                {errors[key] && (
                  <div className="db-browser-error">{errors[key]}</div>
                )}
                {items.map((item) => (
                  <button
                    className={`db-browser-object${selectedCollection?.name === item.name && selectedDatabase === database.name ? " active" : ""}`}
                    key={item.name}
                    title={`${item.type}: ${database.name}.${item.name}`}
                    onClick={() =>
                      void onSelectCollection(connection, database.name, item)
                    }
                  >
                    <span aria-hidden="true">
                      {item.type === "view" ? "◉" : "▤"}
                    </span>
                    <span>{item.name}</span>
                  </button>
                ))}
                {!loading[key] && !errors[key] && items.length === 0 && (
                  <div className="db-browser-hint">No collections yet.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!loading[connection.id] &&
        !errors[connection.id] &&
        databases.length === 0 && (
          <div className="db-browser-hint">No accessible databases found.</div>
        )}
    </div>
  );
}
