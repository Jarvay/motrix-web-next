/**
 * Browser-compatible mock for @tauri-apps/plugin-log.
 *
 * All log functions return a resolved promise so that `.catch(() => {})`
 * chains from logger.ts work without throwing.
 */

export function error(message: string): Promise<void> {
  console.error(message)
  return Promise.resolve()
}

export function warn(message: string): Promise<void> {
  console.warn(message)
  return Promise.resolve()
}

export function info(message: string): Promise<void> {
  console.info(message)
  return Promise.resolve()
}

export function debug(message: string): Promise<void> {
  console.debug(message)
  return Promise.resolve()
}

export function trace(message: string): Promise<void> {
  console.debug(message)
  return Promise.resolve()
}
