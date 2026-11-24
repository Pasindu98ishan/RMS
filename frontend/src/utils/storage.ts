/** localStorage helpers that never throw (private mode, blocked storage). */
export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: the value lives in memory only */
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export const STORAGE_KEYS = {
  /** This device's terminal registration (terminalId + deviceToken). */
  terminal: 'rms.terminal',
  /** Tokens of the logged-in session (survives a reload so KDS screens stay logged in). */
  session: 'rms.session',
} as const
