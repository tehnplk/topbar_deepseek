import type { RendererApi } from '../shared/ipc'
import type { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: RendererApi
  }
}
