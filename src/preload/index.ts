import { contextBridge, ipcRenderer } from 'electron'
import type { DatabaseBrowserDatabase, DatabaseBrowserTable, DatabaseConnectionInput, DatabaseConnectionSummary, DatabaseEvent, DatabaseQueryRequest, MongoBrowserCollection, MongoBrowserDatabase, MongoMutationRequest, MongoMutationResult, SavedConnectionProfile } from '../shared/database'

const api = {
  database: {
    connect: (input: DatabaseConnectionInput, save: boolean): Promise<DatabaseConnectionSummary> =>
      ipcRenderer.invoke('database:connect', input, save),
    saved: (): Promise<SavedConnectionProfile[]> => ipcRenderer.invoke('database:saved'),
    connectSaved: (profileId: string): Promise<DatabaseConnectionSummary> => ipcRenderer.invoke('database:connect-saved', profileId),
    deleteSaved: (profileId: string): Promise<boolean> => ipcRenderer.invoke('database:delete-saved', profileId),
    listDatabases: (connectionId: string): Promise<DatabaseBrowserDatabase[]> => ipcRenderer.invoke('database:list-databases', connectionId),
    listTables: (connectionId: string): Promise<DatabaseBrowserTable[]> => ipcRenderer.invoke('database:list-tables', connectionId),
    listMongoDatabases: (connectionId: string): Promise<MongoBrowserDatabase[]> => ipcRenderer.invoke('database:mongo-databases', connectionId),
    listMongoCollections: (connectionId: string, database: string): Promise<MongoBrowserCollection[]> => ipcRenderer.invoke('database:mongo-collections', connectionId, database),
    getMongoCollectionDetails: (connectionId: string, database: string, collection: string): Promise<MongoBrowserCollection> => ipcRenderer.invoke('database:mongo-collection-details', connectionId, database, collection),
    openDatabase: (connectionId: string, database: string): Promise<DatabaseConnectionSummary> => ipcRenderer.invoke('database:open-database', connectionId, database),
    mutateMongo: (request: MongoMutationRequest): Promise<MongoMutationResult> => ipcRenderer.invoke('database:mongo-mutate', request),
    run: (request: DatabaseQueryRequest): Promise<{ queryId: string }> =>
      ipcRenderer.invoke('database:run', request),
    cancel: (connectionId: string, queryId: string): Promise<boolean> =>
      ipcRenderer.invoke('database:cancel', connectionId, queryId),
    disconnect: (connectionId: string): Promise<boolean> =>
      ipcRenderer.invoke('database:disconnect', connectionId),
    onEvent: (handler: (event: DatabaseEvent) => void): (() => void) => {
      const listener = (_ipcEvent: Electron.IpcRendererEvent, event: DatabaseEvent): void => handler(event)
      ipcRenderer.on('database:event', listener)
      return () => ipcRenderer.removeListener('database:event', listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}

export type PreloadAPI = typeof api
