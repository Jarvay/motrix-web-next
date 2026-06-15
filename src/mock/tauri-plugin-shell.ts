/**
 * Browser-compatible mock for @tauri-apps/plugin-shell.
 */

export function open(_path: string): Promise<void> {
  return Promise.resolve()
}

export const Command = {
  create: () => ({
    execute: async () => ({ code: 0, stdout: '', stderr: '', signal: null }),
    spawn: async () => ({ code: 0, stdout: '', stderr: '', signal: null }),
  }),
}
