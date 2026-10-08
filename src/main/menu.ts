import { Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { APP_NAME } from '../shared/config'

const isMac = process.platform === 'darwin'

/** Keep the native app menu predictable on macOS and useful on other platforms. */
export function createAppMenu(): void {
  const macTemplate: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `About ${APP_NAME}` },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Rowfish on GitHub',
          click: () => void shell.openExternal('https://github.com/PylotLight/rowfish')
        }
      ]
    }
  ]

  const otherTemplate: MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [{ role: 'close' }, { type: 'separator' }, { role: 'quit' }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Rowfish on GitHub',
          click: () => void shell.openExternal('https://github.com/PylotLight/rowfish')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(isMac ? macTemplate : otherTemplate))
}
