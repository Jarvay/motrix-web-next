/**
 * Browser-compatible mock for @tauri-apps/plugin-store.
 *
 * Uses localStorage as the backing store, keyed by filename.
 */

const PREFIX = 'motrix-store:'

export async function load(filename: string) {
  const key = PREFIX + filename.replace(/\.json$/, '')

  return {
    get: async <T>(storeKey: string): Promise<T | null> => {
      try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const data = JSON.parse(raw) as Record<string, unknown>
        const value = storeKey ? data[storeKey] : data
        return (value ?? null) as T | null
      } catch {
        return null
      }
    },
    set: async (storeKey: string, value: unknown): Promise<void> => {
      try {
        const raw = localStorage.getItem(key)
        const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        data[storeKey] = value
        localStorage.setItem(key, JSON.stringify(data))
      } catch {
        // localStorage may be full or unavailable
      }
    },
    save: async (): Promise<void> => {
      // No-op: localStorage is written immediately
    },
    keys: async (): Promise<string[]> => {
      try {
        const raw = localStorage.getItem(key)
        if (!raw) return []
        const data = JSON.parse(raw) as Record<string, unknown>
        return Object.keys(data)
      } catch {
        return []
      }
    },
  }
}
