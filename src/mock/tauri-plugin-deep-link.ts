/**
 * Browser-compatible mock for @tauri-apps/plugin-deep-link.
 */

export async function getCurrent(_url: string): Promise<string[]> {
  return []
}

export async function onOpenUrl(_handler: (urls: string[]) => void): Promise<() => void> {
  return () => {}
}
