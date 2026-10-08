import { contextBridge, ipcRenderer } from 'electron'
import type { DatabaseConnectionInput, DatabaseConnectionSummary, DatabaseEvent, DatabaseQueryRequest } from '../shared/database'

const api = {
  database: {
    connect: (input: DatabaseConnectionInput): Promise<DatabaseConnectionSummary> =>
      ipcRenderer.invoke('database:connect', input),
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
