import { ipcMain } from 'electron'
import { cancelDatabaseQuery, connectDatabase, disconnectDatabase, runDatabaseQuery } from './database'

export function registerIpc(): void {
  ipcMain.handle('database:connect', (event, input: unknown) => connectDatabase(event, input))
  ipcMain.handle('database:run', (event, request: unknown) => runDatabaseQuery(event, request))
  ipcMain.handle('database:cancel', (event, connectionId: unknown, queryId: unknown) =>
    cancelDatabaseQuery(event, connectionId, queryId)
  )
  ipcMain.handle('database:disconnect', (event, connectionId: unknown) => disconnectDatabase(event, connectionId))
}
