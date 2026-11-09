import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  APPBAR_HEIGHT_DIP,
  applyAppBarPosition,
  getAppBarStatus,
  isAppBarRegistered,
  registerAppBar,
  removeAppBar
} from './appbar'
import type { AppBarStatus } from '../shared/ipc'

/** Width of the collapsed handle, in DIP. */
const COLLAPSED_WIDTH_DIP = 132
/** How much of the collapsed window stays on screen, in DIP. */
const COLLAPSED_VISIBLE_DIP = 6

let barWindow: BrowserWindow | null = null
let collapsed = false

export function isCollapsed(): boolean {
  return collapsed
}

export function getBarStatus(): AppBarStatus {
  return { ...getAppBarStatus(), collapsed }
}

/**
 * Collapsed state: a small window centred at the top edge, pushed mostly above
 * the screen so only a thin line stays visible. The desktop space is released
 * while collapsed.
 */
function placeCollapsed(win: BrowserWindow): void {
  const display = screen.getPrimaryDisplay()
  const x = Math.round(display.bounds.x + (display.bounds.width - COLLAPSED_WIDTH_DIP) / 2)

  // Normalise the height first (always the nominal value: passing the clamped
  // height back would let the window grow a pixel or two per DPI round-trip),
  // then read what Windows actually allowed and slide it above the screen edge.
  win.setBounds({ x, y: 0, width: COLLAPSED_WIDTH_DIP, height: APPBAR_HEIGHT_DIP })
  const heightDip = win.getBounds().height

  win.setBounds({
    x,
    y: Math.round(display.bounds.y - (heightDip - COLLAPSED_VISIBLE_DIP)),
    width: COLLAPSED_WIDTH_DIP,
    height: APPBAR_HEIGHT_DIP
  })
}

/** Keep the bar glued to the top edge of the primary display. */
export function positionBar(): void {
  if (!barWindow || barWindow.isDestroyed()) return

  if (collapsed) {
    placeCollapsed(barWindow)
    return
  }

  if (process.platform === 'win32' && isAppBarRegistered()) {
    applyAppBarPosition(barWindow)
    return
  }

  const display = screen.getPrimaryDisplay()
  barWindow.setBounds({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: APPBAR_HEIGHT_DIP
  })
}

/**
 * Collapse the bar into the centre line (or expand it back). Collapsing gives
 * the desktop space back; expanding reserves the top strip again.
 */
export function setCollapsed(next: boolean): AppBarStatus {
  collapsed = next

  const win = barWindow
  if (!win || win.isDestroyed()) return getBarStatus()

  if (collapsed) {
    removeAppBar()
    placeCollapsed(win)
    return getBarStatus()
  }

  const display = screen.getPrimaryDisplay()

  win.setBounds({
    x: Math.round(display.bounds.x),
    y: Math.round(display.bounds.y),
    width: Math.round(display.bounds.width),
    height: APPBAR_HEIGHT_DIP
  })

  if (process.platform === 'win32') {
    registerAppBar(win)
    applyAppBarPosition(win)
  }

  return getBarStatus()
}

export function createBarWindow(): void {
  const display = screen.getPrimaryDisplay()

  const window = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: APPBAR_HEIGHT_DIP,
    frame: false,
    transparent: true,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    backgroundColor: '#00000000',
    title: 'topbar_deepseek',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  barWindow = window
  collapsed = false

  window.once('ready-to-show', () => {
    // Do not steal focus from whatever the user is doing.
    window.showInactive()
  })

  window.on('closed', () => {
    barWindow = null
    removeAppBar()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Escape hatch for a frameless window with no title bar controls.
  window.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      collapsed
        ? { label: 'ขยายแถบ', click: () => setCollapsed(false) }
        : { label: 'ย่อแถบ', click: () => setCollapsed(true) },
      { type: 'separator' },
      { label: 'ปิด topbar_deepseek', click: () => app.quit() },
      { label: 'DevTools', click: () => window.webContents.toggleDevTools() }
    ]).popup({ window })
  })

  // Reserve the top strip of the desktop (Windows AppBar). Other apps and
  // maximized windows are then laid out below the bar.
  if (process.platform === 'win32') {
    registerAppBar(window)
  }
  positionBar()

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
