import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type {
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionSummary,
  DatabaseEvent,
  MongoBrowserCollection,
  MongoBrowserDatabase,
  SavedConnectionProfile,
} from "../../../../../shared/database";
import { mongoBrowserKey, type RunState } from "../workspace-helpers";
import type { QueryResultsApi } from "./useQueryRunner";

/** The per-connection database switcher popover state (PostgreSQL). */
export type DbSwitcherState = {
  connectionId: string;
  databases: DatabaseBrowserDatabase[] | null;
  filter: string;
  error: string;
  busy: string;
};

/**
 * Connection and browser state: live and saved connections, the active
 * connection, and the per-connection browser data (databases, tables,
 * columns, MongoDB databases and collections) plus the handlers that fill
 * it. The query runner is created after this hook, so run-state guards and
 * result resets go through the latest-value refs the workspace passes in.
 */
export function useConnections({
  runStateRef,
  queryResultsRef,
  setQueryText,
  queryText,
  mongoQueryMode,
  setCollection,
  setMongoQueryMode,
  closeRowPanel,
  dismissPeek,
  onConnectionError,
  onConnected,
}: {
  runStateRef: RefObject<RunState>;
  queryResultsRef: RefObject<QueryResultsApi | null>;
  setQueryText: (query: string) => void;
  queryText: string;
  mongoQueryMode: "find" | "aggregate";
  setCollection: (collection: string) => void;
  setMongoQueryMode: (mode: "find" | "aggregate") => void;
  closeRowPanel: () => boolean;
  dismissPeek: () => void;
  onConnectionError: (message: string) => void;
  onConnected: (connection: DatabaseConnectionSummary) => void;
}) {
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>(
    [],
  );
  const [savedConnections, setSavedConnections] = useState<
    SavedConnectionProfile[]
  >([]);
  const [activeId, setActiveId] = useState("");
  const [serverDatabases, setServerDatabases] = useState<
    Record<string, DatabaseBrowserDatabase[]>
  >({});
  const [completionColumns, setCompletionColumns] = useState<
    Record<string, { schema: string; table: string; name: string }[]>
  >({});
  const [tableLists, setTableLists] = useState<
    Record<string, DatabaseBrowserTable[]>
  >({});
  const [browserLoading, setBrowserLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [dbSwitcher, setDbSwitcher] = useState<DbSwitcherState | null>(null);
  const [browserErrors, setBrowserErrors] = useState<Record<string, string>>(
    {},
  );
  const [mongoDatabases, setMongoDatabases] = useState<
    Record<string, MongoBrowserDatabase[]>
  >({});
  const [mongoCollections, setMongoCollections] = useState<
    Record<string, MongoBrowserCollection[]>
  >({});
  const [expandedMongoDatabases, setExpandedMongoDatabases] = useState<
    Record<string, boolean>
  >({});
  const [selectedMongoDatabase, setSelectedMongoDatabase] = useState("");
  const [selectedMongoCollection, setSelectedMongoCollection] =
    useState<MongoBrowserCollection | null>(null);

  const activeConnection =
    connections.find((connection) => connection.id === activeId) ?? null;

  async function refreshSavedConnections(): Promise<void> {
    setSavedConnections(await window.api.database.saved());
  }

  useEffect(() => {
    void refreshSavedConnections().catch((error: unknown) => {
      onConnectionError(
        error instanceof Error
          ? error.message
          : "Could not load saved connections.",
      );
    });
  }, []);

  async function inspectConnection(
    connection: DatabaseConnectionSummary,
  ): Promise<void> {
    setBrowserLoading((current) => ({ ...current, [connection.id]: true }));
    setBrowserErrors((current) => ({ ...current, [connection.id]: "" }));
    try {
      if (connection.kind === "mongodb") {
        let databases: MongoBrowserDatabase[];
        try {
          databases = await window.api.database.listMongoDatabases(
            connection.id,
          );
        } catch (error) {
          databases = connection.database
            ? [{ name: connection.database }]
            : [];
          if (connection.database)
            setBrowserErrors((current) => ({
              ...current,
              [connection.id]: `Could not list all databases; showing the connected database only. ${error instanceof Error ? error.message : ""}`,
            }));
          else throw error;
        }
        if (databases.length === 0 && connection.database) {
          databases = [{ name: connection.database }];
          setBrowserErrors((current) => ({
            ...current,
            [connection.id]:
              "The server returned no database list; showing the connected database only.",
          }));
        }
        setMongoDatabases((current) => ({
          ...current,
          [connection.id]: databases,
        }));
        const preferred = databases.some(
          (database) => database.name === connection.database,
        )
          ? connection.database
          : (databases[0]?.name ?? "");
        if (preferred) {
          const key = mongoBrowserKey(connection.id, preferred);
          const collections = await window.api.database.listMongoCollections(
            connection.id,
            preferred,
          );
          setMongoCollections((current) => ({
            ...current,
            [key]: collections,
          }));
          setExpandedMongoDatabases((current) => ({
            ...current,
            [key]: true,
          }));
          setSelectedMongoDatabase(preferred);
        }
      } else if (connection.serverMode) {
        const databases = await window.api.database.listDatabases(
          connection.id,
        );
        setServerDatabases((current) => ({
          ...current,
          [connection.id]: databases,
        }));
      } else {
        const tables = await window.api.database.listTables(connection.id);
        setTableLists((current) => ({ ...current, [connection.id]: tables }));
        try {
          const columns = await window.api.database.listPostgresColumns(
            connection.id,
          );
          setCompletionColumns((current) => ({
            ...current,
            [connection.id]: columns,
          }));
        } catch {
          /* Table browsing remains available when column metadata is restricted. */
        }
      }
    } catch (error) {
      setBrowserErrors((current) => ({
        ...current,
        [connection.id]:
          error instanceof Error
            ? error.message
            : "Could not load the PostgreSQL browser.",
      }));
    } finally {
      setBrowserLoading((current) => ({ ...current, [connection.id]: false }));
    }
  }

  async function connectSaved(profile: SavedConnectionProfile): Promise<void> {
    if (runStateRef.current !== "idle" || !closeRowPanel()) return;
    onConnectionError("");
    const existing = connections.find(
      (connection) =>
        connection.savedConnectionId === profile.id &&
        !connection.parentConnectionId,
    );
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    setBrowserLoading((current) => ({
      ...current,
      [`saved:${profile.id}`]: true,
    }));
    try {
      const connected = await window.api.database.connectSaved(profile.id);
      onConnected(connected);
    } catch (error) {
      onConnectionError(
        error instanceof Error
          ? error.message
          : `Could not connect to ${profile.name}.`,
      );
    } finally {
      setBrowserLoading((current) => ({
        ...current,
        [`saved:${profile.id}`]: false,
      }));
    }
  }

  async function deleteSaved(profile: SavedConnectionProfile): Promise<void> {
    try {
      await window.api.database.deleteSaved(profile.id);
      setSavedConnections((current) =>
        current.filter((item) => item.id !== profile.id),
      );
    } catch (error) {
      onConnectionError(
        error instanceof Error
          ? error.message
          : "Could not remove the saved connection.",
      );
    }
  }

  async function openDatabase(
    server: DatabaseConnectionSummary,
    database: DatabaseBrowserDatabase,
  ): Promise<void> {
    if (runStateRef.current !== "idle" || !closeRowPanel()) return;
    if (!database.canConnect || browserLoading[`${server.id}:${database.name}`])
      return;
    const loadingKey = `${server.id}:${database.name}`;
    setBrowserLoading((current) => ({ ...current, [loadingKey]: true }));
    setBrowserErrors((current) => ({ ...current, [loadingKey]: "" }));
    try {
      const connected = await window.api.database.openDatabase(
        server.id,
        database.name,
      );
      setConnections((current) => [
        ...current.filter(
          (item) =>
            item.id !== connected.id &&
            !(
              item.parentConnectionId === connected.parentConnectionId &&
              item.database === connected.database
            ),
        ),
        connected,
      ]);
      setActiveId(connected.id);
      await inspectConnection(connected);
    } catch (error) {
      setBrowserErrors((current) => ({
        ...current,
        [loadingKey]:
          error instanceof Error
            ? error.message
            : `Could not open ${database.name}.`,
      }));
    } finally {
      setBrowserLoading((current) => ({ ...current, [loadingKey]: false }));
    }
  }

  async function expandMongoDatabase(
    connection: DatabaseConnectionSummary,
    database: MongoBrowserDatabase,
  ): Promise<void> {
    if (runStateRef.current !== "idle" || !closeRowPanel()) return;
    if (selectedMongoDatabase !== database.name) {
      setSelectedMongoCollection(null);
      queryResultsRef.current?.setRows([]);
      queryResultsRef.current?.setColumns([]);
    }
    setActiveId(connection.id);
    setSelectedMongoDatabase(database.name);
    const key = mongoBrowserKey(connection.id, database.name);
    if (expandedMongoDatabases[key]) {
      setExpandedMongoDatabases((current) => ({ ...current, [key]: false }));
      return;
    }
    setExpandedMongoDatabases((current) => ({ ...current, [key]: true }));
    if (mongoCollections[key]) return;
    setBrowserLoading((current) => ({ ...current, [key]: true }));
    setBrowserErrors((current) => ({ ...current, [key]: "" }));
    try {
      const collections = await window.api.database.listMongoCollections(
        connection.id,
        database.name,
      );
      setMongoCollections((current) => ({ ...current, [key]: collections }));
    } catch (error) {
      setBrowserErrors((current) => ({
        ...current,
        [key]:
          error instanceof Error
            ? error.message
            : "Could not load MongoDB collections.",
      }));
    } finally {
      setBrowserLoading((current) => ({ ...current, [key]: false }));
    }
  }

  async function selectMongoCollection(
    connection: DatabaseConnectionSummary,
    database: string,
    item: MongoBrowserCollection,
    { keepQuery = false } = {},
  ): Promise<void> {
    if (runStateRef.current !== "idle" || !closeRowPanel()) return;
    dismissPeek();
    const mode =
      activeConnection?.id === connection.id ? mongoQueryMode : "find";
    const query =
      keepQuery && queryText.trim()
        ? queryText
        : mode === "aggregate"
          ? "[]"
          : "{}";
    setActiveId(connection.id);
    setSelectedMongoDatabase(database);
    setSelectedMongoCollection(item);
    setCollection(item.name);
    setMongoQueryMode(mode);
    setQueryText(query);
    queryResultsRef.current?.setQueryError("");
    queryResultsRef.current?.setQuerySummary(
      `Loading ${database}.${item.name}…`,
    );
    queryResultsRef.current?.setRows([]);
    queryResultsRef.current?.setColumns([]);
    const key = mongoBrowserKey(connection.id, database);
    try {
      const details = await window.api.database.getMongoCollectionDetails(
        connection.id,
        database,
        item.name,
      );
      setMongoCollections((current) => ({
        ...current,
        [key]: (current[key] ?? []).map((entry) =>
          entry.name === item.name ? details : entry,
        ),
      }));
      setSelectedMongoCollection(details);
    } catch (error) {
      queryResultsRef.current?.setQueryError(
        error instanceof Error
          ? error.message
          : "Could not inspect this collection.",
      );
    }
    await queryResultsRef.current?.runQuery({
      connection,
      database,
      collection: item.name,
      query,
      mongoMode: mode,
    });
  }

  async function toggleDbSwitcher(
    connection: DatabaseConnectionSummary,
  ): Promise<void> {
    if (dbSwitcher?.connectionId === connection.id) {
      setDbSwitcher(null);
      return;
    }
    setDbSwitcher({
      connectionId: connection.id,
      databases: null,
      filter: "",
      error: "",
      busy: "",
    });
    try {
      const databases = await window.api.database.listDatabases(connection.id);
      setDbSwitcher((current) =>
        current?.connectionId === connection.id
          ? { ...current, databases }
          : current,
      );
    } catch (error) {
      setDbSwitcher((current) =>
        current?.connectionId === connection.id
          ? {
              ...current,
              databases: [],
              error:
                error instanceof Error
                  ? error.message
                  : "Could not list databases on this server.",
            }
          : current,
      );
    }
  }

  async function switchDatabase(
    connection: DatabaseConnectionSummary,
    database: DatabaseBrowserDatabase,
  ): Promise<void> {
    if (database.name === connection.database) {
      setDbSwitcher(null);
      return;
    }
    if (
      !database.canConnect ||
      runStateRef.current !== "idle" ||
      !closeRowPanel()
    )
      return;
    setDbSwitcher((current) =>
      current ? { ...current, busy: database.name, error: "" } : current,
    );
    try {
      const next = await window.api.database.switchDatabase(
        connection.id,
        database.name,
      );
      setConnections((current) =>
        current.map((item) => (item.id === connection.id ? next : item)),
      );
      setTableLists((current) => {
        const copy = { ...current };
        delete copy[connection.id];
        return copy;
      });
      setCompletionColumns((current) => {
        const copy = { ...current };
        delete copy[connection.id];
        return copy;
      });
      setActiveId(next.id);
      setDbSwitcher(null);
      void inspectConnection(next);
    } catch (error) {
      setDbSwitcher((current) =>
        current
          ? {
              ...current,
              busy: "",
              error:
                error instanceof Error
                  ? error.message
                  : `Could not switch to ${database.name}.`,
            }
          : current,
      );
    }
  }

  async function disconnect(
    connection: DatabaseConnectionSummary,
  ): Promise<void> {
    if (runStateRef.current !== "idle" || !closeRowPanel()) return;
    try {
      await window.api.database.disconnect(connection.id);
      setDbSwitcher((current) =>
        current?.connectionId === connection.id ? null : current,
      );
      setConnections((current) =>
        current.filter(
          (item) =>
            item.id !== connection.id &&
            item.parentConnectionId !== connection.id,
        ),
      );
      if (
        activeId === connection.id ||
        connections.some(
          (item) =>
            item.id === activeId && item.parentConnectionId === connection.id,
        )
      )
        setActiveId("");
      setTableLists((current) => {
        const next = { ...current };
        delete next[connection.id];
        for (const item of connections)
          if (item.parentConnectionId === connection.id) delete next[item.id];
        return next;
      });
      setServerDatabases((current) => {
        const next = { ...current };
        delete next[connection.id];
        return next;
      });
    } catch (error) {
      queryResultsRef.current?.setQueryError(
        error instanceof Error
          ? error.message
          : "Could not close the connection.",
      );
    }
  }

  /** The connection-side half of a connection:closed event. */
  function handleConnectionClosed(event: DatabaseEvent): void {
    if (event.type !== "connection:closed") return;
    setConnections((current) =>
      current.filter(
        (connection) =>
          connection.id !== event.connectionId &&
          connection.parentConnectionId !== event.connectionId,
      ),
    );
    setActiveId((current) => (current === event.connectionId ? "" : current));
    setTableLists((current) => {
      const next = { ...current };
      delete next[event.connectionId];
      return next;
    });
    setServerDatabases((current) => {
      const next = { ...current };
      delete next[event.connectionId];
      return next;
    });
    setMongoDatabases((current) => {
      const next = { ...current };
      delete next[event.connectionId];
      return next;
    });
    setMongoCollections((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !key.startsWith(`${event.connectionId}::`),
        ),
      ),
    );
  }

  return {
    connections,
    setConnections,
    savedConnections,
    setSavedConnections,
    activeId,
    setActiveId,
    activeConnection,
    serverDatabases,
    setServerDatabases,
    completionColumns,
    setCompletionColumns,
    tableLists,
    setTableLists,
    browserLoading,
    setBrowserLoading,
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
    handleConnectionClosed,
  };
}
