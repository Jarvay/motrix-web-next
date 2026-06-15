/**
 * Browser-compatible mock for @tauri-apps/api/window.
 *
 * Returns a stub window object whose methods are safe no-ops.
 */

let focused = true
const focusListeners = new Set<(payload: { payload: boolean }) => void>()

// Listen to the real page visibility for focus simulation
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    focused = document.visibilityState === 'visible'
    focusListeners.forEach((fn) => fn({ payload: focused }))
  })
}

function createStubWindow(label: string) {
  return {
    label,
    setTitle: async (_title: string) => {},
    show: async () => {},
    hide: async () => {},
    close: async () => {},
    minimize: async () => {},
    maximize: async () => {},
    unmaximize: async () => {},
    isMaximized: async () => false,
    isMinimized: async () => false,
    isVisible: async () => true,
    isFocused: async () => focused,
    setFocus: async () => {},
    center: async () => {},
    setSize: async (_size: { width: number; height: number }) => {},
    setPosition: async (_position: { x: number; y: number }) => {},
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      focusListeners.add(handler)
      return () => focusListeners.delete(handler)
    },
    onCloseRequested: async (_handler: () => void) => {
      return () => {}
    },
    onResized: async (_handler: () => void) => {
      return () => {}
    },
    onMoved: async (_handler: () => void) => {
      return () => {}
    },
  }
}

const mainWindow = createStubWindow('main')

export function getCurrentWindow() {
  return mainWindow
}

export function getAllWindows() {
  return [mainWindow]
}
