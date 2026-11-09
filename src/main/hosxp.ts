import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { HosxpState } from '../shared/ipc'

let child: ChildProcess | null = null
let current: HosxpState = { running: false, hn: null }

export function getHosxpState(): HosxpState {
  return current
}

/**
 * HOSxP draws its editor text (DevExpress), so the HN cannot be read with
 * WM_GETTEXT. A small PowerShell helper reads it through MSAA and prints one
 * JSON line whenever the value changes.
 */
export function startHosxpWatcher(onChange: (state: HosxpState) => void): void {
  if (process.platform !== 'win32') return

  const script = app.isPackaged
    ? join(process.resourcesPath, 'hosxp-hn.ps1')
    : join(app.getAppPath(), 'resources', 'hosxp-hn.ps1')

  child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true
  })

  let buffer = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')

    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (!line) continue

      try {
        const parsed = JSON.parse(line) as { running?: boolean; hn?: string | null }
        const next: HosxpState = { running: Boolean(parsed.running), hn: parsed.hn ?? null }
        if (next.running !== current.running || next.hn !== current.hn) {
          current = next
          onChange(current)
        }
      } catch {
        // ignore malformed output
      }
    }
  })

  child.on('exit', () => {
    child = null
    if (current.running || current.hn) {
      current = { running: false, hn: null }
      onChange(current)
    }
  })
}

export function stopHosxpWatcher(): void {
  child?.kill()
  child = null
}
