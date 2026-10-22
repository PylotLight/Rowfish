import { app, ipcMain } from 'electron'
import { getMainWindow } from './window'
import {
  cancelDatabaseQuery,
  connectDatabase,
  connectSavedDatabase,
  disconnectDatabase,
  getMongoCollectionDetails,
  getPostgresServerInfo,
  getPostgresTableDetails,
  getPostgresRow,
  updatePostgresRow,
  listMongoCollections,
  listMongoDatabases,
  listPostgresDatabases,
  listPostgresColumns,
  listPostgresTables,
  listSavedDatabaseConnections,
  openPostgresDatabase,
  removeSavedDatabaseConnection,
  runMongoMutation,
  runDatabaseQuery
} from './database'

export function registerIpc(): void {
  const assertAppSender = (event: Electron.IpcMainInvokeEvent): void => {
    const win = getMainWindow()
    if (
      !win ||
      event.sender.isDestroyed() ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error(
        'Application controls are available only to the Rowfish window.'
      )
  }
  ipcMain.handle('app:quit', (event) => {
    assertAppSender(event)
    app.quit()
  })
  ipcMain.handle('app:set-blur', (event, enabled: unknown) => {
    assertAppSender(event)
    if (typeof enabled !== 'boolean')
      throw new Error('Invalid blur preference.')
    if (process.platform === 'darwin')
      getMainWindow()?.setVibrancy(enabled ? 'fullscreen-ui' : null)
  })
  ipcMain.handle('database:connect', (event, input: unknown, save: unknown) =>
    connectDatabase(event, input, save as boolean)
  )
  ipcMain.handle('database:saved', (event) =>
    listSavedDatabaseConnections(event)
  )
  ipcMain.handle('database:connect-saved', (event, profileId: unknown) =>
    connectSavedDatabase(event, profileId)
  )
  ipcMain.handle('database:delete-saved', (event, profileId: unknown) =>
    removeSavedDatabaseConnection(event, profileId)
  )
  ipcMain.handle('database:list-databases', (event, connectionId: unknown) =>
    listPostgresDatabases(event, connectionId)
  )
  ipcMain.handle('database:list-tables', (event, connectionId: unknown) =>
    listPostgresTables(event, connectionId)
  )
  ipcMain.handle(
    'database:postgres-table-details',
    (event, connectionId: unknown, schema: unknown, table: unknown) =>
      getPostgresTableDetails(event, connectionId, schema, table)
  )
  ipcMain.handle(
    'database:postgres-server-info',
    (event, connectionId: unknown) => getPostgresServerInfo(event, connectionId)
  )
  ipcMain.handle('database:postgres-columns', (event, connectionId: unknown) =>
    listPostgresColumns(event, connectionId)
  )
  ipcMain.handle('database:mongo-databases', (event, connectionId: unknown) =>
    listMongoDatabases(event, connectionId)
  )
  ipcMain.handle(
    'database:mongo-collections',
    (event, connectionId: unknown, database: unknown) =>
      listMongoCollections(event, connectionId, database)
  )
  ipcMain.handle(
    'database:mongo-collection-details',
    (event, connectionId: unknown, database: unknown, collection: unknown) =>
      getMongoCollectionDetails(event, connectionId, database, collection)
  )
  ipcMain.handle(
    'database:open-database',
    (event, connectionId: unknown, database: unknown) =>
      openPostgresDatabase(event, connectionId, database)
  )
  ipcMain.handle('database:mongo-mutate', (event, request: unknown) =>
    runMongoMutation(event, request)
  )
  ipcMain.handle('database:postgres-row-get', (event, request: unknown) =>
    getPostgresRow(event, request)
  )
  ipcMain.handle('database:postgres-row-update', (event, request: unknown) =>
    updatePostgresRow(event, request)
  )
  ipcMain.handle('database:run', (event, request: unknown) =>
    runDatabaseQuery(event, request)
  )
  ipcMain.handle(
    'database:cancel',
    (event, connectionId: unknown, queryId: unknown) =>
      cancelDatabaseQuery(event, connectionId, queryId)
  )
  ipcMain.handle('database:disconnect', (event, connectionId: unknown) =>
    disconnectDatabase(event, connectionId)
  )
}
