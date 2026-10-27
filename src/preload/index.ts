import { contextBridge, ipcRenderer } from "electron";
import type {
  AiQuerySettings,
  AiQuerySettingsInput,
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  DatabaseConnectionTestResult,
  DatabaseEvent,
  AlembicStatus,
  AlembicModelComparison,
  DatabaseQueryRequest,
  MongoBrowserCollection,
  MongoBrowserDatabase,
  MongoAiQueryRequest,
  MongoAiQueryResult,
  MongoMutationRequest,
  MongoMutationResult,
  PostgresServerInfo,
  PostgresTableDetails,
  PostgresRowDetails,
  PostgresRowRequest,
  UpdatePostgresRowRequest,
  SavedConnectionProfile,
} from "../shared/database";

const api = {
  app: {
    quit: (): Promise<void> => ipcRenderer.invoke("app:quit"),
    setBlur: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke("app:set-blur", enabled),
    chooseSqliteFile: (): Promise<string | null> =>
      ipcRenderer.invoke("app:choose-sqlite-file"),
    chooseAlembicDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke("app:choose-alembic-directory"),
    chooseAlembicConfig: (): Promise<string | null> =>
      ipcRenderer.invoke("app:choose-alembic-config"),
    choosePythonInterpreter: (): Promise<string | null> =>
      ipcRenderer.invoke("app:choose-python-interpreter"),
  },
  aiQuery: {
    getSettings: (): Promise<AiQuerySettings> =>
      ipcRenderer.invoke("ai-query:get-settings"),
    saveSettings: (input: AiQuerySettingsInput): Promise<AiQuerySettings> =>
      ipcRenderer.invoke("ai-query:save-settings", input),
    testProvider: (): Promise<{ message: string }> =>
      ipcRenderer.invoke("ai-query:test-provider"),
    generateMongoQuery: (
      request: MongoAiQueryRequest,
    ): Promise<MongoAiQueryResult> =>
      ipcRenderer.invoke("ai-query:generate-mongo", request),
  },
  database: {
    connect: (
      input: DatabaseConnectionInput,
      save: boolean,
    ): Promise<DatabaseConnectionSummary> =>
      ipcRenderer.invoke("database:connect", input, save),
    saveConnection: (
      input: DatabaseConnectionInput,
    ): Promise<SavedConnectionProfile> =>
      ipcRenderer.invoke("database:save-connection", input),
    testConnection: (
      input: DatabaseConnectionInput,
    ): Promise<DatabaseConnectionTestResult> =>
      ipcRenderer.invoke("database:test-connection", input),
    saved: (): Promise<SavedConnectionProfile[]> =>
      ipcRenderer.invoke("database:saved"),
    connectSaved: (profileId: string): Promise<DatabaseConnectionSummary> =>
      ipcRenderer.invoke("database:connect-saved", profileId),
    getSaved: (profileId: string): Promise<DatabaseConnectionInput> =>
      ipcRenderer.invoke("database:get-saved", profileId),
    updateSaved: (
      profileId: string,
      input: DatabaseConnectionInput,
    ): Promise<SavedConnectionProfile> =>
      ipcRenderer.invoke("database:update-saved", profileId, input),
    deleteSaved: (profileId: string): Promise<boolean> =>
      ipcRenderer.invoke("database:delete-saved", profileId),
    listDatabases: (connectionId: string): Promise<DatabaseBrowserDatabase[]> =>
      ipcRenderer.invoke("database:list-databases", connectionId),
    listTables: (connectionId: string): Promise<DatabaseBrowserTable[]> =>
      ipcRenderer.invoke("database:list-tables", connectionId),
    getAlembicStatus: (
      connectionId: string,
      directory: string,
    ): Promise<AlembicStatus> =>
      ipcRenderer.invoke("database:alembic-status", connectionId, directory),
    compareAlembicModels: (
      connectionId: string,
      configPath: string,
      pythonPath: string,
    ): Promise<AlembicModelComparison> =>
      ipcRenderer.invoke(
        "database:alembic-model-compare",
        connectionId,
        configPath,
        pythonPath,
      ),
    getPostgresTableDetails: (
      connectionId: string,
      schema: string,
      table: string,
    ): Promise<PostgresTableDetails> =>
      ipcRenderer.invoke(
        "database:postgres-table-details",
        connectionId,
        schema,
        table,
      ),
    getPostgresRow: (
      request: PostgresRowRequest,
    ): Promise<PostgresRowDetails> =>
      ipcRenderer.invoke("database:postgres-row-get", request),
    updatePostgresRow: (
      request: UpdatePostgresRowRequest,
    ): Promise<PostgresRowDetails> =>
      ipcRenderer.invoke("database:postgres-row-update", request),
    getPostgresServerInfo: (
      connectionId: string,
    ): Promise<PostgresServerInfo> =>
      ipcRenderer.invoke("database:postgres-server-info", connectionId),
    listPostgresColumns: (
      connectionId: string,
    ): Promise<{ schema: string; table: string; name: string }[]> =>
      ipcRenderer.invoke("database:postgres-columns", connectionId),
    listMongoDatabases: (
      connectionId: string,
    ): Promise<MongoBrowserDatabase[]> =>
      ipcRenderer.invoke("database:mongo-databases", connectionId),
    listMongoCollections: (
      connectionId: string,
      database: string,
    ): Promise<MongoBrowserCollection[]> =>
      ipcRenderer.invoke("database:mongo-collections", connectionId, database),
    getMongoCollectionDetails: (
      connectionId: string,
      database: string,
      collection: string,
    ): Promise<MongoBrowserCollection> =>
      ipcRenderer.invoke(
        "database:mongo-collection-details",
        connectionId,
        database,
        collection,
      ),
    openDatabase: (
      connectionId: string,
      database: string,
    ): Promise<DatabaseConnectionSummary> =>
      ipcRenderer.invoke("database:open-database", connectionId, database),
    switchDatabase: (
      connectionId: string,
      database: string,
    ): Promise<DatabaseConnectionSummary> =>
      ipcRenderer.invoke("database:switch-database", connectionId, database),
    mutateMongo: (
      request: MongoMutationRequest,
    ): Promise<MongoMutationResult> =>
      ipcRenderer.invoke("database:mongo-mutate", request),
    run: (request: DatabaseQueryRequest): Promise<{ queryId: string }> =>
      ipcRenderer.invoke("database:run", request),
    cancel: (connectionId: string, queryId: string): Promise<boolean> =>
      ipcRenderer.invoke("database:cancel", connectionId, queryId),
    disconnect: (connectionId: string): Promise<boolean> =>
      ipcRenderer.invoke("database:disconnect", connectionId),
    onEvent: (handler: (event: DatabaseEvent) => void): (() => void) => {
      const listener = (
        _ipcEvent: Electron.IpcRendererEvent,
        event: DatabaseEvent,
      ): void => handler(event);
      ipcRenderer.on("database:event", listener);
      return () => ipcRenderer.removeListener("database:event", listener);
    },
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.api = api;
}

export type PreloadAPI = typeof api;
