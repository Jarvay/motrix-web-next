/**
 * Browser-compatible mock for @tauri-apps/plugin-opener.
 *
 * Uses window.open() for external URLs.
 */

export async function openUrl(url: string): Promise<void> {
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    // Silently fail
  }
}
