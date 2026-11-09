import { app, BrowserWindow, Menu, screen } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpcHandlers, broadcastAppBarStatus, broadcastHosxpState } from './ipc'
import { createBarWindow, positionBar } from './bar'
import { onAppBarStatusChange, removeAppBar } from './appbar'
import { startHosxpWatcher, stopHosxpWatcher } from './hosxp'

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => positionBar())

  app.whenReady().then(() => {
    // No menu bar: this is a 30 DIP strip, not a regular window.
    Menu.setApplicationMenu(null)
    electronApp.setAppUserModelId('com.topbar.deepseek')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    onAppBarStatusChange(() => broadcastAppBarStatus())
    startHosxpWatcher((state) => broadcastHosxpState(state))
    createBarWindow()

    // Re-reserve and re-position when the display layout changes (resolution,
    // scale factor, monitor added/removed, taskbar docked elsewhere).
    const handleDisplayChange = (): void => {
      positionBar()
      broadcastAppBarStatus()
    }
    screen.on('display-metrics-changed', handleDisplayChange)
    screen.on('display-added', handleDisplayChange)
    screen.on('display-removed', handleDisplayChange)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createBarWindow()
    })
  })

  // Give the desktop work area back before exiting.
  app.on('will-quit', () => {
    stopHosxpWatcher()
    removeAppBar()
  })

  app.on('window-all-closed', () => app.quit())
}
