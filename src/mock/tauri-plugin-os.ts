/**
 * Browser-compatible mock for @tauri-apps/plugin-os.
 *
 * Detects OS from navigator.userAgent / navigator.platform.
 */

function detectPlatform(): string {
  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  if (platform.startsWith('Mac')) return 'macos'
  if (platform.startsWith('Win')) return 'windows'
  if (/Linux/.test(platform) || /Linux/.test(ua)) return 'linux'
  return 'linux'
}

function detectArch(): string {
  const ua = navigator.userAgent || ''
  if (/arm|aarch64/i.test(ua)) return 'aarch64'
  if (/x86_64|amd64|win64|x64/i.test(ua)) return 'x86_64'
  if (/i[3-6]86/i.test(ua)) return 'x86'
  return 'x86_64'
}

export function platform(): string {
  return detectPlatform()
}

export function arch(): string {
  return detectArch()
}

export function version(): string {
  return '0.0.0'
}

export function type(): string {
  return 'Linux'
}
