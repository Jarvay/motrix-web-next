/**
 * Browser-compatible mock for @tauri-apps/api/path.
 *
 * Returns sensible browser-compatible paths.
 */

const sep = '/'

export async function homeDir(): Promise<string> {
  return '/home'
}

export async function downloadDir(): Promise<string> {
  return '/home/Downloads'
}

export async function appDataDir(): Promise<string> {
  return '/home/.local/share/com.motrix.next'
}

export async function appLogDir(): Promise<string> {
  return '/home/.local/share/com.motrix.next/logs'
}

export async function tempDir(): Promise<string> {
  return '/tmp'
}

export async function join(...paths: string[]): Promise<string> {
  return paths
    .map((p) => p.replace(/\/+$/, ''))
    .filter(Boolean)
    .join(sep)
}

export async function dirname(path: string): Promise<string> {
  const parts = path.replace(/\/+$/, '').split('/')
  parts.pop()
  return parts.join(sep) || sep
}

export function sepStr(): string {
  return sep
}
