/**
 * Browser-compatible mock for @tauri-apps/api/app.
 */

export async function getVersion(): Promise<string> {
  return '3.9.5-web'
}

export async function getName(): Promise<string> {
  return 'Motrix Next'
}
