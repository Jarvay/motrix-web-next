/**
 * Browser-compatible mock for tauri-plugin-locale-api.
 *
 * Uses navigator.language for locale detection.
 */

export async function getLocale(): Promise<string | null> {
  return navigator.language || 'en-US'
}
