import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC, type HosxpState } from '../shared/ipc'
import { getBarStatus, setCollapsed } from './bar'
import { getHosxpState } from './hosxp'
import { getPtInfo } from './db'

/**
 * All IPC handlers of the main process live here, so the renderer surface of
 * the app is easy to audit from one file.
 */
export function registerIpcHandlers(): void {
  // Round-trip handshake used by the renderer to prove the bridge works.
  ipcMain.handle(IPC.ping, () => ({
    ok: true,
    message: 'pong',
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion(),
    electron: process.versions.electron
  }))

  // Fired from the renderer toolbar button.
  ipcMain.on(IPC.toggleDevTools, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.webContents.toggleDevTools()
  })

  ipcMain.on(IPC.quit, () => app.quit())

  ipcMain.handle(IPC.appBarStatus, () => getBarStatus())

  ipcMain.handle(IPC.hosxpState, () => getHosxpState())

  ipcMain.handle(IPC.ptInfo, async (_event, hn: unknown) => {
    const value = typeof hn === 'string' ? hn.trim() : ''
    if (!/^\d{1,9}$/.test(value)) return null
    try {
      return await getPtInfo(value)
    } catch (error) {
      console.error('[db] getPtInfo failed:', error)
      return null
    }
  })

  ipcMain.handle(IPC.setCollapsed, (_event, next: unknown) => {
    const status = setCollapsed(Boolean(next))
    broadcastAppBarStatus()
    return status
  })
}

/** Push the HOSxP patient state to every renderer. */
export function broadcastHosxpState(state: HosxpState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.hosxpState, state)
  }
}

/** Push the current reservation state to every renderer. */
export function broadcastAppBarStatus(): void {
  const status = getBarStatus()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.appBarStatusChanged, status)
    }
  }
}
