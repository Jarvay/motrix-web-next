/**
 * Browser-compatible mock for @tauri-apps/plugin-autostart.
 */

export async function isEnabled(): Promise<boolean> {
  return false
}

export async function enable(): Promise<void> {
  // No-op
}

export async function disable(): Promise<void> {
  // No-op
}
