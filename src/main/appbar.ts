import { BrowserWindow, screen, type Display } from 'electron'
import koffi from 'koffi'
import type { AppBarStatus } from '../shared/ipc'

/**
 * Height of the sticky bar, in DIP (device independent pixels, 1/96 inch).
 * The Win32 AppBar reservation is set to the same height so maximized windows
 * start below the bar and nothing overlaps it.
 */
export const APPBAR_HEIGHT_DIP = 30

const ABM_NEW = 0x00000000
const ABM_REMOVE = 0x00000001
const ABM_QUERYPOS = 0x00000002
const ABM_SETPOS = 0x00000003
const ABE_TOP = 0x00000001

/** WM_USER + 1, used by the shell to deliver ABN_* notifications. */
const APPBAR_CALLBACK_MESSAGE = 0x0401
const ABN_POSCHANGED = 0x00000001

const SWP_NOZORDER = 0x0004
const SWP_NOACTIVATE = 0x0010

interface AppBarRect {
  left: number
  top: number
  right: number
  bottom: number
}

interface AppBarData {
  cbSize: number
  hWnd: number
  uCallbackMessage: number
  uEdge: number
  rc: AppBarRect
  lParam: number
}

type SHAppBarMessageFn = (message: number, data: AppBarData) => number
type SetWindowPosFn = (
  hWnd: number,
  insertAfter: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  flags: number
) => number

let shAppBarMessage: SHAppBarMessageFn | null = null
let setWindowPos: SetWindowPosFn | null = null
let appBarDataSize = 0
let registered = false
let windowHandle = 0
let hookedHandle = 0
let lastLayoutKey = ''
let repositionTimer: ReturnType<typeof setTimeout> | null = null
let statusListener: (() => void) | null = null

function loadWin32(): boolean {
  if (process.platform !== 'win32') return false
  if (shAppBarMessage) return true

  try {
    const shell32 = koffi.load('shell32.dll')
    const user32 = koffi.load('user32.dll')

    const RECT = koffi.struct('RECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long'
    })
    const APPBARDATA = koffi.struct('APPBARDATA', {
      cbSize: 'uint32',
      hWnd: 'intptr',
      uCallbackMessage: 'uint32',
      uEdge: 'uint32',
      rc: RECT,
      lParam: 'intptr'
    })

    appBarDataSize = koffi.sizeof(APPBARDATA)
    shAppBarMessage = shell32.func(
      'intptr SHAppBarMessage(uint32 dwMessage, _Inout_ APPBARDATA *pData)'
    ) as unknown as SHAppBarMessageFn
    setWindowPos = user32.func(
      'bool SetWindowPos(intptr hWnd, intptr hWndInsertAfter, int x, int y, int cx, int cy, uint32 uFlags)'
    ) as unknown as SetWindowPosFn
    return true
  } catch (error) {
    console.error('[appbar] cannot load Win32 APIs:', error)
    return false
  }
}

/** Bounds of the primary display, converted from DIP to physical pixels. */
function physicalDisplayRect(display: Display): AppBarRect {
  const scale = display.scaleFactor
  return {
    left: Math.round(display.bounds.x * scale),
    top: Math.round(display.bounds.y * scale),
    right: Math.round((display.bounds.x + display.bounds.width) * scale),
    bottom: Math.round((display.bounds.y + display.bounds.height) * scale)
  }
}

function buildData(rect: AppBarRect): AppBarData {
  return {
    cbSize: appBarDataSize,
    hWnd: windowHandle,
    uCallbackMessage: APPBAR_CALLBACK_MESSAGE,
    uEdge: ABE_TOP,
    rc: rect,
    lParam: 0
  }
}

function notifyStatus(): void {
  statusListener?.()
}

/**
 * Ask the shell for a free strip at the top of the primary display, reserve it
 * and move our window inside it. QUERYPOS keeps the bar clear of other appbars
 * and of the taskbar when the taskbar is docked at the top.
 *
 * The window is deliberately taller than the reserved strip (Windows enforces
 * a minimum frame height), so it is slid up by the difference. The extra part
 * ends up above the display edge and exactly APPBAR_HEIGHT_DIP stays visible.
 */
export function applyAppBarPosition(win: BrowserWindow): boolean {
  if (!registered || !shAppBarMessage || !setWindowPos) return false
  if (win.isDestroyed()) return false

  const display = screen.getPrimaryDisplay()
  const scale = display.scaleFactor
  const screenRect = physicalDisplayRect(display)
  const heightPx = Math.round(APPBAR_HEIGHT_DIP * scale)

  const data = buildData({
    left: screenRect.left,
    top: screenRect.top,
    right: screenRect.right,
    bottom: screenRect.top + heightPx
  })

  shAppBarMessage(ABM_QUERYPOS, data)
  // QUERYPOS may move the edges; the strip height stays ours.
  data.rc.bottom = data.rc.top + heightPx

  // Electron/Chromium refuse to make a window shorter than the system minimum
  // frame height, so the window is a bit taller than the reserved strip. Keep
  // that height and slide it up: the extra part is clipped above the display
  // edge and exactly APPBAR_HEIGHT_DIP stays visible.
  const currentHeightDip = win.getBounds().height
  const windowHeightPx = Math.floor(currentHeightDip * scale)
  const widthPx = data.rc.right - data.rc.left

  const layoutKey = `${data.rc.left}:${data.rc.bottom}:${widthPx}:${windowHeightPx}`
  if (layoutKey !== lastLayoutKey) {
    shAppBarMessage(ABM_SETPOS, data)
    lastLayoutKey = layoutKey
  }

  // When the shell changes the work area, Chromium nudges the window back into
  // it, so the position is re-applied whenever the window has drifted away.
  // Positioning is done in physical pixels: Electron's `setBounds` works in
  // DIP and rounds, which leaves a visible seam on 125% / 150% displays.
  const current = win.getBounds()
  // +1px so the window bottom edge overlaps the work area instead of leaving a
  // hairline seam on fractional DPI scales.
  const targetY = data.rc.bottom - windowHeightPx + 1
  const currentHeightPx = Math.round(current.height * scale)
  const hasDrifted =
    Math.abs(current.x * scale - data.rc.left) > 1 ||
    Math.abs(current.y * scale - targetY) > 1 ||
    Math.abs(current.width * scale - widthPx) > 1

  if (hasDrifted) {
    setWindowPos(
      windowHandle,
      0,
      data.rc.left,
      targetY,
      widthPx,
      currentHeightPx,
      SWP_NOZORDER | SWP_NOACTIVATE
    )
  }

  return true
}

function scheduleReposition(win: BrowserWindow): void {
  if (repositionTimer) return

  // The shell fires ABN_POSCHANGED again after every SETPOS; throttle the
  // follow-up work and skip no-op layouts so the callback cannot bounce back
  // and forth forever.
  repositionTimer = setTimeout(() => {
    repositionTimer = null
    if (!registered || win.isDestroyed()) return
    applyAppBarPosition(win)
    notifyStatus()
  }, 60)
}

/**
 * Register the window as a top-edge AppBar. This reduces the desktop work area,
 * which is what pushes other applications (and maximized windows) down.
 */
export function registerAppBar(win: BrowserWindow): boolean {
  if (!loadWin32() || registered) return registered

  const display = screen.getPrimaryDisplay()
  const scale = display.scaleFactor
  const screenRect = physicalDisplayRect(display)

  windowHandle = Number(win.getNativeWindowHandle().readBigUInt64LE(0))
  const data = buildData({
    left: screenRect.left,
    top: screenRect.top,
    right: screenRect.right,
    bottom: screenRect.top + Math.round(APPBAR_HEIGHT_DIP * scale)
  })

  registered = shAppBarMessage!(ABM_NEW, data) !== 0
  if (!registered) {
    console.error('[appbar] ABM_NEW was rejected by the shell')
    return false
  }

  lastLayoutKey = ''

  if (hookedHandle !== windowHandle) {
    hookedHandle = windowHandle
    win.hookWindowMessage(APPBAR_CALLBACK_MESSAGE, (wParam) => {
      const notification = wParam && wParam.length >= 4 ? wParam.readUInt32LE(0) : 0
      if (notification === ABN_POSCHANGED) scheduleReposition(win)
    })
  }

  applyAppBarPosition(win)
  return true
}

/** Release the reserved strip so the desktop work area returns to normal. */
export function removeAppBar(): void {
  if (repositionTimer) {
    clearTimeout(repositionTimer)
    repositionTimer = null
  }
  if (!registered || !shAppBarMessage) return

  try {
    shAppBarMessage(ABM_REMOVE, buildData({ left: 0, top: 0, right: 0, bottom: 0 }))
  } catch (error) {
    console.error('[appbar] ABM_REMOVE failed:', error)
  } finally {
    registered = false
    windowHandle = 0
    lastLayoutKey = ''
  }
}

export function isAppBarRegistered(): boolean {
  return registered
}

export function onAppBarStatusChange(listener: () => void): void {
  statusListener = listener
}

export function getAppBarStatus(): Omit<AppBarStatus, 'collapsed'> {
  const display = screen.getPrimaryDisplay()

  return {
    platform: process.platform,
    reserved: registered,
    heightDip: APPBAR_HEIGHT_DIP,
    screen: { width: display.bounds.width, height: display.bounds.height },
    workArea: { ...display.workArea },
    scaleFactor: display.scaleFactor
  }
}
