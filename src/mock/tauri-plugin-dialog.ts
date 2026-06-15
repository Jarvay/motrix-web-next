/**
 * Browser-compatible mock for @tauri-apps/plugin-dialog.
 *
 * In browser mode, file dialogs are not available.  Returns null to
 * indicate cancellation so the UI degrades gracefully.
 */

export interface DialogFilter {
  name: string
  extensions: string[]
}

interface OpenOptions {
  title?: string
  filters?: DialogFilter[]
  multiple?: boolean
  directory?: boolean
  defaultPath?: string
}

interface SaveOptions {
  title?: string
  filters?: DialogFilter[]
  defaultPath?: string
}

export async function open(_options?: OpenOptions): Promise<string | string[] | null> {
  console.debug('[tauri-mock] dialog.open() called — file dialogs not available in browser')
  return null
}

export async function save(_options?: SaveOptions): Promise<string | null> {
  console.debug('[tauri-mock] dialog.save() called — file dialogs not available in browser')
  return null
}

export async function ask(_message: string, _options?: { title?: string; type?: string }): Promise<boolean> {
  return window.confirm(_message)
}
