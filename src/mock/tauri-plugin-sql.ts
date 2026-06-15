/**
 * Browser-compatible mock for @tauri-apps/plugin-sql.
 *
 * Provides a stub Database that returns empty arrays for all queries.
 */

interface QueryResult {
  lastInsertId?: number
  rowsAffected: number
}

const stubDb = {
  select: async <T>(_query: string, _bindings?: unknown[]): Promise<T[]> => {
    return [] as T[]
  },
  execute: async (_query: string, _bindings?: unknown[]): Promise<QueryResult> => {
    return { rowsAffected: 0 }
  },
  close: async (): Promise<void> => {},
}

async function load(_url: string): Promise<typeof stubDb> {
  console.debug('[tauri-mock] Database.load() called — SQLite not available in browser')
  return stubDb
}

const Database = { load }

export default Database
