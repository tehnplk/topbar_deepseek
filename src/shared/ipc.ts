/**
 * Types and channel names shared by the main, preload and renderer processes.
 */

export const IPC = {
  ping: 'app:ping',
  toggleDevTools: 'app:toggle-devtools',
  quit: 'app:quit',
  appBarStatus: 'appbar:status',
  appBarStatusChanged: 'appbar:status-changed',
  setCollapsed: 'bar:set-collapsed',
  hosxpState: 'hosxp:state',
  ptInfo: 'patient:info'
} as const

export interface PingResult {
  ok: boolean
  message: string
  timestamp: string
  appVersion: string
  electron: string
}

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface AppBarStatus {
  /** `win32`, `darwin`, `linux`, … */
  platform: string
  /** true when the OS accepted the reserved top strip (Windows AppBar) */
  reserved: boolean
  /** true when the bar is minimised to the centre line */
  collapsed: boolean
  /** reserved height in DIP */
  heightDip: number
  /** primary display size in DIP */
  screen: { width: number; height: number }
  /** current desktop work area in DIP, excluding the reserved strip */
  workArea: WorkArea
  scaleFactor: number
}

export interface HosxpState {
  /** HOSxP client process found */
  running: boolean
  /** HN of the patient open in the active screen, when readable */
  hn: string | null
}

export interface PtAge {
  y: number
  m: number
  d: number
}

export interface PtInfo {
  hn: string
  fullname: string
  /** 'ชาย' or 'หญิง' */
  sex: string
  age: PtAge
  /** years-months-days, e.g. 33-10-8 */
  ageYmd: string
}

export interface RendererApi {
  ping: () => Promise<PingResult>
  toggleDevTools: () => void
  quit: () => void
  appBarStatus: () => Promise<AppBarStatus>
  onAppBarStatus: (callback: (status: AppBarStatus) => void) => () => void
  setCollapsed: (collapsed: boolean) => Promise<AppBarStatus>
  hosxpState: () => Promise<HosxpState>
  onHosxpState: (callback: (state: HosxpState) => void) => () => void
  ptInfo: (hn: string) => Promise<PtInfo | null>
}
