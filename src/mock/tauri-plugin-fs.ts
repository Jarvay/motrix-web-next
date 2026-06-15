/**
 * Browser-compatible mock for @tauri-apps/plugin-fs.
 *
 * File system operations are not available in browser.
 * All methods return false / empty as graceful degradation.
 */

export async function exists(_path: string): Promise<boolean> {
  return false
}

export async function remove(_path: string): Promise<void> {
  // No-op
}

export async function readTextFile(_path: string): Promise<string> {
  return ''
}

export async function readBinaryFile(_path: string): Promise<Uint8Array> {
  return new Uint8Array()
}

export async function writeTextFile(_path: string, _contents: string): Promise<void> {
  // No-op
}

export async function writeBinaryFile(_path: string, _contents: Uint8Array): Promise<void> {
  // No-op
}

export async function mkdir(_path: string): Promise<void> {
  // No-op
}

export async function readDir(_path: string): Promise<Array<{ name: string; path: string }>> {
  return []
}

export async function stat(_path: string): Promise<{ isDirectory: boolean; isFile: boolean }> {
  return { isDirectory: false, isFile: false }
}
