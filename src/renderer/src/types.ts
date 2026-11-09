import type { PingResult } from '../../shared/ipc'

export type Theme = 'dark' | 'light'

export type PingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: PingResult; elapsedMs: number }
  | { status: 'error'; message: string }
