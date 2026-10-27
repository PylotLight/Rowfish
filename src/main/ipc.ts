import { app, dialog, ipcMain } from "electron";
import { getMainWindow } from "./window";
import {
  generateMongoQueryWithAi,
  generateSqlQueryWithAi,
  getAiQuerySettings,
  saveAiQuerySettings,
  testAiQueryProvider,
} from "./ai-query.js";
import {
  cancelDatabaseQuery,
  connectDatabase,
  connectSavedDatabase,
  getSavedDatabaseConnection,
  disconnectDatabase,
  getMongoCollectionDetails,
  getPostgresServerInfo,
  getPostgresTableDetails,
  getPostgresRow,
  getAlembicStatus,
  compareAlembicModels,
  updatePostgresRow,
  listMongoCollections,
  listMongoDatabases,
  listPostgresDatabases,
  listPostgresColumns,
  listPostgresTables,
  listSavedDatabaseConnections,
  openPostgresDatabase,
  switchPostgresDatabase,
  removeSavedDatabaseConnection,
  updateSavedDatabaseConnection,
  runMongoMutation,
  runDatabaseQuery,
  saveDatabaseConnection,
  testDatabaseConnection,
} from "./database";

export function registerIpc(): void {
  const assertAppSender = (event: Electron.IpcMainInvokeEvent): void => {
    const win = getMainWindow();
    if (
      !win ||
      event.sender.isDestroyed() ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error(
        "Application controls are available only to the Rowfish window.",
      );
  };
  ipcMain.handle("ai-query:get-settings", (event) => {
    assertAppSender(event);
    return getAiQuerySettings(event);
  });
  ipcMain.handle("ai-query:save-settings", (event, input: unknown) => {
    assertAppSender(event);
    return saveAiQuerySettings(event, input);
  });
  ipcMain.handle("ai-query:test-provider", (event) => {
    assertAppSender(event);
    return testAiQueryProvider(event);
  });
  ipcMain.handle("ai-query:generate-mongo", (event, request: unknown) => {
    assertAppSender(event);
    return generateMongoQueryWithAi(event, request);
  });
  ipcMain.handle("ai-query:generate-sql", (event, request: unknown) => {
    assertAppSender(event);
    return generateSqlQueryWithAi(event, request);
  });
  ipcMain.handle("app:quit", (event) => {
    assertAppSender(event);
    app.quit();
  });
  ipcMain.handle("app:set-blur", (event, enabled: unknown) => {
    assertAppSender(event);
    if (typeof enabled !== "boolean")
      throw new Error("Invalid blur preference.");
    if (process.platform === "darwin")
      getMainWindow()?.setVibrancy(enabled ? "fullscreen-ui" : null);
  });
  ipcMain.handle("app:choose-sqlite-file", async (event) => {
    assertAppSender(event);
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "Open SQLite database",
      properties: ["openFile"],
      filters: [
        { name: "SQLite databases", extensions: ["db", "sqlite", "sqlite3"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("app:choose-alembic-directory", async (event) => {
    assertAppSender(event);
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "Select Alembic versions directory",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("app:choose-alembic-config", async (event) => {
    assertAppSender(event);
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "Select Alembic configuration",
      properties: ["openFile"],
      filters: [
        { name: "Alembic configuration", extensions: ["ini"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("app:choose-python-interpreter", async (event) => {
    assertAppSender(event);
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "Select Python interpreter",
      properties: ["openFile"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("database:connect", (event, input: unknown, save: unknown) =>
    connectDatabase(event, input, save as boolean),
  );
  ipcMain.handle("database:save-connection", (event, input: unknown) =>
    saveDatabaseConnection(event, input),
  );
  ipcMain.handle("database:test-connection", (event, input: unknown) =>
    testDatabaseConnection(event, input),
  );
  ipcMain.handle("database:saved", (event) =>
    listSavedDatabaseConnections(event),
  );
  ipcMain.handle("database:connect-saved", (event, profileId: unknown) =>
    connectSavedDatabase(event, profileId),
  );
  ipcMain.handle("database:get-saved", (event, profileId: unknown) =>
    getSavedDatabaseConnection(event, profileId),
  );
  ipcMain.handle(
    "database:update-saved",
    (event, profileId: unknown, input: unknown) =>
      updateSavedDatabaseConnection(event, profileId, input),
  );
  ipcMain.handle("database:delete-saved", (event, profileId: unknown) =>
    removeSavedDatabaseConnection(event, profileId),
  );
  ipcMain.handle("database:list-databases", (event, connectionId: unknown) =>
    listPostgresDatabases(event, connectionId),
  );
  ipcMain.handle("database:list-tables", (event, connectionId: unknown) =>
    listPostgresTables(event, connectionId),
  );
  ipcMain.handle(
    "database:alembic-status",
    (event, connectionId: unknown, directory: unknown) =>
      getAlembicStatus(event, connectionId, directory),
  );
  ipcMain.handle(
    "database:alembic-model-compare",
    (event, connectionId: unknown, configPath: unknown, pythonPath: unknown) =>
      compareAlembicModels(event, connectionId, configPath, pythonPath),
  );
  ipcMain.handle(
    "database:postgres-table-details",
    (event, connectionId: unknown, schema: unknown, table: unknown) =>
      getPostgresTableDetails(event, connectionId, schema, table),
  );
  ipcMain.handle(
    "database:postgres-server-info",
    (event, connectionId: unknown) =>
      getPostgresServerInfo(event, connectionId),
  );
  ipcMain.handle("database:postgres-columns", (event, connectionId: unknown) =>
    listPostgresColumns(event, connectionId),
  );
  ipcMain.handle("database:mongo-databases", (event, connectionId: unknown) =>
    listMongoDatabases(event, connectionId),
  );
  ipcMain.handle(
    "database:mongo-collections",
    (event, connectionId: unknown, database: unknown) =>
      listMongoCollections(event, connectionId, database),
  );
  ipcMain.handle(
    "database:mongo-collection-details",
    (event, connectionId: unknown, database: unknown, collection: unknown) =>
      getMongoCollectionDetails(event, connectionId, database, collection),
  );
  ipcMain.handle(
    "database:open-database",
    (event, connectionId: unknown, database: unknown) =>
      openPostgresDatabase(event, connectionId, database),
  );
  ipcMain.handle(
    "database:switch-database",
    (event, connectionId: unknown, database: unknown) =>
      switchPostgresDatabase(event, connectionId, database),
  );
  ipcMain.handle("database:mongo-mutate", (event, request: unknown) =>
    runMongoMutation(event, request),
  );
  ipcMain.handle("database:postgres-row-get", (event, request: unknown) =>
    getPostgresRow(event, request),
  );
  ipcMain.handle("database:postgres-row-update", (event, request: unknown) =>
    updatePostgresRow(event, request),
  );
  ipcMain.handle("database:run", (event, request: unknown) =>
    runDatabaseQuery(event, request),
  );
  ipcMain.handle(
    "database:cancel",
    (event, connectionId: unknown, queryId: unknown) =>
      cancelDatabaseQuery(event, connectionId, queryId),
  );
  ipcMain.handle("database:disconnect", (event, connectionId: unknown) =>
    disconnectDatabase(event, connectionId),
  );
}
