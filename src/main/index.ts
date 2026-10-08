import { app, BrowserWindow, nativeImage } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID } from '../shared/config'
import { registerIpc } from './ipc'
import { createAppMenu } from './menu'
import { createAppTray, destroyTray } from './tray'
import { createWindow, hideWindow, resolveAppIcon, showWindow } from './window'
import { closeDatabaseConnections } from './database'

// Single instance: a second launch focuses the existing window instead of forking.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_ID)

  // In development Electron uses its own Dock icon; set the app icon explicitly.
  if (process.platform === 'darwin' && !app.isPackaged) {
    const iconPath = resolveAppIcon()
    if (iconPath) app.dock?.setIcon(nativeImage.createFromPath(iconPath))
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  createAppMenu()
  createWindow()
  createAppTray({
    onShow: showWindow,
    onHide: hideWindow,
    onQuit: () => app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => showWindow())

// On macOS the app stays alive in the tray after the window closes.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => destroyTray())
app.on('will-quit', () => {
  void closeDatabaseConnections()
})
