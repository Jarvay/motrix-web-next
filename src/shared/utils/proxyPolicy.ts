import { PROXY_SCOPES } from '@shared/constants'
import type { Aria2EngineOptions, ProxyConfig } from '@shared/types'
import { isValidAria2ProxyUrl } from '@shared/utils/aria2Proxy'

export const ENGINE_PROXY_MODES = ['direct', 'auto', 'manual'] as const
export type EngineProxyMode = (typeof ENGINE_PROXY_MODES)[number]

export const TASK_PROXY_MODES = ['app', ...ENGINE_PROXY_MODES] as const
export type TaskProxyMode = (typeof TASK_PROXY_MODES)[number]

export function normalizeProxyMode(mode: unknown): EngineProxyMode {
  return ENGINE_PROXY_MODES.includes(mode as EngineProxyMode) ? (mode as EngineProxyMode) : 'direct'
}

export function isProxyModeEnabled(mode: EngineProxyMode): boolean {
  return mode !== 'direct'
}

export function proxySwitchValueToMode(enabled: boolean, currentMode: EngineProxyMode): EngineProxyMode {
  if (!enabled) return 'direct'
  return currentMode === 'direct' ? 'auto' : currentMode
}

function hasDownloadScope(proxy: Pick<ProxyConfig, 'scope'>): boolean {
  return Array.isArray(proxy.scope) && proxy.scope.includes(PROXY_SCOPES.DOWNLOAD)
}

export function buildDownloadProxyOptions(proxy: ProxyConfig): Aria2EngineOptions {
  if (!hasDownloadScope(proxy)) return { 'proxy-mode': 'direct' }

  const mode = normalizeProxyMode(proxy.mode)
  if (mode !== 'manual') return { 'proxy-mode': mode }

  const server = proxy.server.trim()
  if (!server) return { 'proxy-mode': 'direct' }

  const options: Aria2EngineOptions = {
    'proxy-mode': 'manual',
    'all-proxy': server,
  }
  if (proxy.bypass?.trim()) options['no-proxy'] = proxy.bypass.trim()
  return options
}

export function buildTaskProxyOptions(
  mode: TaskProxyMode,
  customProxy: string,
  appProxy?: ProxyConfig,
): Aria2EngineOptions {
  if (mode === 'app') return {}
  if (mode !== 'manual') return { 'proxy-mode': mode }

  const server = customProxy.trim()
  if (!server) return { 'proxy-mode': 'direct' }

  const options: Aria2EngineOptions = {
    'proxy-mode': 'manual',
    'all-proxy': server,
  }

  const bypass = appProxy?.bypass?.trim()
  if (bypass) options['no-proxy'] = bypass
  return options
}

export function isManualDownloadProxy(proxy: ProxyConfig): boolean {
  return normalizeProxyMode(proxy.mode) === 'manual' && hasDownloadScope(proxy) && !!proxy.server.trim()
}

export function getDownloadProxy(proxy: ProxyConfig): string | undefined {
  return isManualDownloadProxy(proxy) ? proxy.server : undefined
}

export function getProxyServerFromOptions(options: Aria2EngineOptions): string {
  const proxy = options['all-proxy']
  return typeof proxy === 'string' ? proxy : ''
}

export function hasInvalidManualProxy(options: Aria2EngineOptions): boolean {
  const proxy = getProxyServerFromOptions(options)
  return !!proxy && !isValidAria2ProxyUrl(proxy)
}
