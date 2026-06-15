/**
 * Browser-compatible mock for @tauri-apps/api/webview.
 */

export function getCurrentWebview() {
  /** No-op unlisten function returned by listener registrations. */
  const noopUnlisten = async () => {}

  return {
    label: 'main',
    show: async () => {},
    hide: async () => {},
    close: async () => {},
    setPosition: async () => {},
    setSize: async () => {},
    /** Drag-drop is not available in the browser; returns a no-op unlistener. */
    onDragDropEvent: (_handler: (...args: unknown[]) => unknown) => Promise.resolve(noopUnlisten),
  }
}

export function getAllWebviews() {
  return [getCurrentWebview()]
}
