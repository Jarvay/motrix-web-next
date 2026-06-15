/**
 * Browser-compatible mock for @tauri-apps/plugin-clipboard-manager.
 *
 * Uses the Web Clipboard API (navigator.clipboard) when available.
 */

export async function readText(): Promise<string> {
  try {
    return (await navigator.clipboard.readText()) || ''
  } catch {
    return ''
  }
}

export async function writeText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard API may require a secure context (HTTPS) or user gesture
  }
}
