/**
 * Browser-compatible mock for @tauri-apps/api/core.
 *
 * In web mode, `invoke()` delegates to the Rust Axum REST API via axios
 * for known commands.  Unknown commands are stubbed with sensible defaults
 * so the UI renders gracefully.
 */
import httpClient from '@/api/httpClient'

const invokeLog = new Set<string>()

/**
 * Invoke a backend command.
 *
 * In web mode, Tauri commands are mapped to REST API endpoints.
 * This replaces the Tauri IPC bridge with HTTP calls.
 */
export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!invokeLog.has(cmd)) {
    invokeLog.add(cmd)
    console.debug(`[web-ipc] invoke("${cmd}") → REST API`)
  }

  try {
    const result = await dispatchInvoke(cmd, args)
    return result as T
  } catch (err) {
    console.error(`[web-ipc] invoke("${cmd}") failed:`, err)
    throw err
  }
}

/** REST endpoint mapping for Tauri commands. */
async function dispatchInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    // ── Engine lifecycle ────────────────────────────────────────────
    case 'wait_for_engine': {
      const { data } = await httpClient.get('/api/engine/wait-ready')
      return data
    }
    case 'engine_status': {
      const { data } = await httpClient.get('/api/engine/status')
      return data
    }
    case 'start_engine_command':
    case 'restart_engine_command': {
      const { data } = await httpClient.post('/api/engine/restart')
      return data
    }
    case 'stop_engine_command':
      // Engine is managed by the web server process — no-op
      return undefined as unknown

    // ── Config ──────────────────────────────────────────────────────
    case 'get_system_config': {
      const { data } = await httpClient.get('/api/config/system')
      return data
    }
    case 'save_system_config': {
      await httpClient.post('/api/config/system', args?.config)
      return undefined as unknown
    }
    case 'factory_reset': {
      await httpClient.post('/api/config/factory-reset')
      return undefined as unknown
    }

    // ── Server info ─────────────────────────────────────────────────
    case 'get_server_info': {
      const { data } = await httpClient.get('/api/info')
      return data
    }

    // ── Desktop-only commands (stubbed in web mode) ─────────────────
    case 'check_path_exists':
    case 'check_path_is_dir':
      return false as unknown
    case 'is_autostart_launch':
    case 'is_system_proxy_launch':
    case 'peek_pending_deep_links_silent':
    case 'peek_pending_external_inputs_silent':
      return false as unknown
    case 'take_pending_deep_links':
    case 'take_pending_external_inputs':
    case 'take_pending_frontend_actions':
      return undefined as unknown
    case 'get_ed2k_bootstrap_status':
      return { serverMetModified: 0, nodesDatModified: 0 } as unknown
    case 'start_upnp_mapping':
    case 'fetch_tracker_sources':
    case 'check_for_update':
    case 'sync_ed2k_bootstrap_files':
    case 'minimize_to_tray':
    case 'refresh_runtime_config':
      return undefined as unknown

    default:
      console.warn(`[web-ipc] unknown command "${cmd}" — returning undefined`)
      return undefined as unknown
  }
}

export function convertFileSrc(filePath: string): string {
  return filePath
}
