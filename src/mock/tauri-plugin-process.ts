/**
 * Browser-compatible mock for @tauri-apps/plugin-process.
 */

export async function relaunch(): Promise<void> {
  window.location.reload()
}

export async function exit(_exitCode?: number): Promise<void> {
  // No-op: cannot exit the browser tab
}
