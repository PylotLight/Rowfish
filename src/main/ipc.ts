import { ipcMain } from 'electron'
import {
  cancelDatabaseQuery,
  connectDatabase,
  connectSavedDatabase,
  disconnectDatabase,
  getMongoCollectionDetails,
  listMongoCollections,
  listMongoDatabases,
  listPostgresDatabases,
  listPostgresTables,
  listSavedDatabaseConnections,
  openPostgresDatabase,
  removeSavedDatabaseConnection,
  runMongoMutation,
  runDatabaseQuery
} from './database'

export function registerIpc(): void {
  ipcMain.handle('database:connect', (event, input: unknown, save: unknown) => connectDatabase(event, input, save as boolean))
  ipcMain.handle('database:saved', (event) => listSavedDatabaseConnections(event))
  ipcMain.handle('database:connect-saved', (event, profileId: unknown) => connectSavedDatabase(event, profileId))
  ipcMain.handle('database:delete-saved', (event, profileId: unknown) => removeSavedDatabaseConnection(event, profileId))
  ipcMain.handle('database:list-databases', (event, connectionId: unknown) => listPostgresDatabases(event, connectionId))
  ipcMain.handle('database:list-tables', (event, connectionId: unknown) => listPostgresTables(event, connectionId))
  ipcMain.handle('database:mongo-databases', (event, connectionId: unknown) => listMongoDatabases(event, connectionId))
  ipcMain.handle('database:mongo-collections', (event, connectionId: unknown, database: unknown) => listMongoCollections(event, connectionId, database))
  ipcMain.handle('database:mongo-collection-details', (event, connectionId: unknown, database: unknown, collection: unknown) => getMongoCollectionDetails(event, connectionId, database, collection))
  ipcMain.handle('database:open-database', (event, connectionId: unknown, database: unknown) => openPostgresDatabase(event, connectionId, database))
  ipcMain.handle('database:mongo-mutate', (event, request: unknown) => runMongoMutation(event, request))
  ipcMain.handle('database:run', (event, request: unknown) => runDatabaseQuery(event, request))
  ipcMain.handle('database:cancel', (event, connectionId: unknown, queryId: unknown) =>
    cancelDatabaseQuery(event, connectionId, queryId)
  )
  ipcMain.handle('database:disconnect', (event, connectionId: unknown) => disconnectDatabase(event, connectionId))
}
