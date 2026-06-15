/**
 * Browser-compatible mock for @tauri-apps/plugin-notification.
 */

export async function sendNotification(_options: { title: string; body: string }): Promise<void> {
  // Use the Web Notification API if available
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(_options.title, { body: _options.body })
  }
}

export async function requestPermission(): Promise<string> {
  if ('Notification' in window) {
    return await Notification.requestPermission()
  }
  return 'denied'
}

export async function isPermissionGranted(): Promise<boolean> {
  if ('Notification' in window) {
    return Notification.permission === 'granted'
  }
  return false
}
