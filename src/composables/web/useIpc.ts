/** @fileoverview Composable providing typed web API client using axios. */
import httpClient from '@/api/httpClient'
import type { UnlistenFn } from '@tauri-apps/api/event'

export function useWebIpc() {
  async function call<T = unknown>(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<T> {
    const url = `/api/${path}`
    if (method === 'GET') {
      const { data } = await httpClient.get(url)
      return data as T
    }
    if (method === 'POST' || method === 'PUT') {
      const { data } = method === 'POST' ? await httpClient.post(url, body) : await httpClient.put(url, body)
      return data as T
    }
    if (method === 'DELETE') {
      const { data } = await httpClient.delete(url, { data: body })
      return data as T
    }
    throw new Error(`Unsupported HTTP method: ${method}`)
  }

  async function on<T = unknown>(_event: string, _handler: (payload: T) => void): Promise<UnlistenFn> {
    console.warn('[web-ipc] listen called — no web socket support yet, ignoring')
    return () => {}
  }

  async function startEngine(): Promise<void> {
    return call('engine/restart', 'POST')
  }

  async function stopEngine(): Promise<void> {
    console.warn('[web-ipc] stopEngine called, but engine is managed by the web server')
  }

  async function restartEngine(): Promise<void> {
    return call('engine/restart', 'POST')
  }

  async function factoryReset(): Promise<void> {
    return call('config/factory-reset', 'POST')
  }

  async function getSystemConfig(): Promise<Record<string, unknown>> {
    return call('config/system', 'GET')
  }

  async function saveSystemConfig(config: Record<string, unknown>): Promise<void> {
    return call('config/system', 'POST', config)
  }

  return {
    call,
    on,
    startEngine,
    stopEngine,
    restartEngine,
    factoryReset,
    getSystemConfig,
    saveSystemConfig,
  }
}
