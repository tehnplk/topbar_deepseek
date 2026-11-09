import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC,
  type AppBarStatus,
  type HosxpState,
  type PingResult,
  type PtInfo,
  type RendererApi
} from '../shared/ipc'

// Custom APIs for renderer
const api: RendererApi = {
  ping: () => ipcRenderer.invoke(IPC.ping) as Promise<PingResult>,
  toggleDevTools: () => ipcRenderer.send(IPC.toggleDevTools),
  quit: () => ipcRenderer.send(IPC.quit),
  appBarStatus: () => ipcRenderer.invoke(IPC.appBarStatus) as Promise<AppBarStatus>,
  onAppBarStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AppBarStatus): void =>
      callback(status)
    ipcRenderer.on(IPC.appBarStatusChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC.appBarStatusChanged, listener)
    }
  },
  setCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke(IPC.setCollapsed, collapsed) as Promise<AppBarStatus>,
  hosxpState: () => ipcRenderer.invoke(IPC.hosxpState) as Promise<HosxpState>,
  onHosxpState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: HosxpState): void => callback(state)
    ipcRenderer.on(IPC.hosxpState, listener)
    return () => {
      ipcRenderer.removeListener(IPC.hosxpState, listener)
    }
  },
  ptInfo: (hn: string) => ipcRenderer.invoke(IPC.ptInfo, hn) as Promise<PtInfo | null>
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
