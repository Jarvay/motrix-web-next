/**
 * Browser-compatible mock for @tauri-apps/plugin-updater.
 */

export async function check(_options?: {
  headers?: Record<string, string>
}): Promise<{ shouldUpdate: boolean; manifest?: Record<string, unknown> } | null> {
  return null
}

export async function downloadAndInstall(
  _onEvent?: (event: { event: string; data: Record<string, unknown> }) => void,
): Promise<void> {
  // No-op
}
