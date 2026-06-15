/**
 * @fileoverview Aria2 API — dual transport layer.
 *
 * In Tauri (desktop) mode, calls go through `invoke()` to the Rust backend.
 * In web mode, calls use axios to hit the REST API at `/api/*`.
 *
 * The transport is selected at module load time based on `__TAURI__`.
 */
import { invoke } from '@tauri-apps/api/core'
import httpClient from '@/api/httpClient'
import { changeKeysToCamelCase, formatOptionsForEngine } from '@shared/utils'
import type {
  Aria2Task,
  Aria2RawGlobalStat,
  Aria2Peer,
  Aria2EngineOptions,
  Aria2File,
  AppConfig,
  Ed2kSearchOptions,
  Ed2kSearchResults,
} from '@shared/types'
import { formatLogFields, logger } from '@shared/logger'
import { resolveDownloadDir } from '@shared/utils/fileCategory'
import { sanitizeAria2OutHint } from '@shared/utils/batchHelpers'
import { summarizeAria2Options, summarizeExternalInput } from '@shared/utils/externalInputDiagnostics'

/**
 * Engine readiness state.
 * With the Rust backend transport, readiness is determined by the engine
 * lifecycle commands — the Aria2Client is always available once credentials
 * are set by `on_engine_ready`.
 */
let engineReady = false

/** Returns true when the aria2 engine has started and is accepting RPC. */
export function isEngineReady(): boolean {
  return engineReady
}

/** Marks the engine as ready/unready. */
export function setEngineReady(ready: boolean): void {
  engineReady = ready
}

// ════════════════════════════════════════════════════════════════════
// ── Transport selection ────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

const isWebMode: boolean =
  import.meta.env.VITE_WEB_MODE === '1' || import.meta.env.VITE_WEB_MODE === 'true'
    ? true
    : typeof __TAURI__ !== 'undefined'
      ? !__TAURI__
      : typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
        ? false
        : false

async function rpc<Args extends Record<string, unknown> | undefined, Ret>(
  tauriCmd: string,
  httpCall: () => Promise<Ret>,
  args?: Args,
): Promise<Ret> {
  if (isWebMode) {
    return httpCall()
  }
  if (args === undefined) {
    return invoke<Ret>(tauriCmd)
  }
  return invoke<Ret>(tauriCmd, args)
}

function withBtSafetyOptions(options: Aria2EngineOptions): Aria2EngineOptions {
  return {
    ...options,
    'check-integrity': options['check-integrity'] ?? 'true',
    'force-save': options['force-save'] ?? 'true',
  }
}

/** Retrieves aria2 engine version and list of enabled features. */
export async function getVersion(): Promise<{ version: string; enabledFeatures: string[] }> {
  return rpc('aria2_get_version', async () => {
    const { data } = await httpClient.get('/api/version')
    return data
  })
}

/** Fetches all global aria2 configuration options as camelCase keys. */
export async function getGlobalOption(): Promise<Record<string, string>> {
  const data = await rpc('aria2_get_global_option', async () => {
    const { data } = await httpClient.get('/api/options')
    return data
  })
  return changeKeysToCamelCase(data) as Record<string, string>
}

/** Fetches aggregated download/upload statistics from aria2. */
export async function getGlobalStat(): Promise<Aria2RawGlobalStat> {
  return rpc('aria2_get_global_stat', async () => {
    const { data } = await httpClient.get('/api/status')
    return data
  })
}

/** Updates aria2 global configuration at runtime. */
export async function changeGlobalOption(options: Partial<AppConfig>): Promise<void> {
  const engineOptions = formatOptionsForEngine(options)
  logger.debug('aria2.changeGlobalOption', engineOptions)
  return rpc(
    'aria2_change_global_option',
    async () => {
      await httpClient.put('/api/options', engineOptions)
    },
    { options: engineOptions },
  )
}

/** Fetches the option set for a specific download task as camelCase keys. */
export async function getOption(params: { gid: string }): Promise<Record<string, string>> {
  const data = await rpc(
    'aria2_get_option',
    async () => {
      const { data } = await httpClient.get(`/api/tasks/${params.gid}/options`)
      return data
    },
    { gid: params.gid },
  )
  return changeKeysToCamelCase(data) as Record<string, string>
}

/** Modifies options for a specific download task at runtime. */
export async function changeOption(params: { gid: string; options: Aria2EngineOptions }): Promise<void> {
  const engineOptions = formatOptionsForEngine(params.options)
  return rpc(
    'aria2_change_option',
    async () => {
      await httpClient.put(`/api/tasks/${params.gid}/options`, engineOptions)
    },
    { gid: params.gid, options: engineOptions },
  )
}

/** Retrieves the file list for a download task by GID. */
export async function getFiles(params: { gid: string }): Promise<Aria2File[]> {
  const data = await rpc(
    'aria2_get_files',
    async () => {
      const { data } = await httpClient.get(`/api/tasks/${params.gid}/files`)
      return data
    },
    { gid: params.gid },
  )
  return (Array.isArray(data)
    ? data.map((f: Record<string, unknown>) => changeKeysToCamelCase(f))
    : []) as unknown as Aria2File[]
}

/** Fetches only active tasks (no waiting). */
export async function fetchActiveTaskList(): Promise<Aria2Task[]> {
  return rpc('aria2_fetch_active_task_list', async () => {
    const { data } = await httpClient.get('/api/tasks/active')
    return data
  })
}

/** Fetches task list by status type: active+waiting or stopped. */
export async function fetchTaskList(params: { type: string; limit?: number }): Promise<Aria2Task[]> {
  return rpc(
    'aria2_fetch_task_list',
    async () => {
      const { data } = await httpClient.get('/api/tasks', {
        params: { type: params.type, limit: params.limit },
      })
      return data
    },
    {
      type: params.type,
      limit: params.limit ?? null,
    },
  )
}

/** Fetches a single task's full status by GID. */
export async function fetchTaskItem(params: { gid: string }): Promise<Aria2Task> {
  return rpc(
    'aria2_fetch_task_item',
    async () => {
      const { data } = await httpClient.get(`/api/tasks/${params.gid}`)
      return data
    },
    { gid: params.gid },
  )
}

/** Fetches a single task's status along with its peer list (for BT tasks). */
export async function fetchTaskItemWithPeers(params: { gid: string }): Promise<Aria2Task & { peers: Aria2Peer[] }> {
  return rpc(
    'aria2_fetch_task_item_with_peers',
    async () => {
      const { data } = await httpClient.get(`/api/tasks/${params.gid}/peers`)
      return data
    },
    { gid: params.gid },
  )
}

/** Adds one or more URI downloads with per-URI output filename overrides. */
export async function addUri(params: {
  uris: string[]
  outs: string[]
  options: Aria2EngineOptions
  fileCategory?: { enabled: boolean; categories: import('@shared/types').FileCategory[] }
}): Promise<string[]> {
  const { uris, outs, options, fileCategory } = params
  const engineOptions = formatOptionsForEngine(options)

  // Each URI gets its own aria2 task with optional per-URI overrides
  const tasks = uris.map(async (uri, index) => {
    const opts: Record<string, string> = { ...engineOptions }
    if (outs[index]) opts.out = outs[index]

    // Defense-in-depth: sanitize out for filesystem safety (#261, #264).
    // Rust sanitize_out_option is the authoritative boundary; this is belt-and-suspenders.
    if (opts.out) opts.out = sanitizeAria2OutHint(opts.out)
    if (!opts.out) delete opts.out

    // Smart file classification: resolve per-URI download directory
    if (fileCategory?.enabled && fileCategory.categories.length > 0) {
      opts.dir = resolveDownloadDir(opts.out || uri, opts.dir || '', true, fileCategory.categories)
    }

    return rpc(
      'aria2_add_uri',
      async () => {
        const { data } = await httpClient.post('/api/tasks/uri', { uris: [uri], options: opts })
        return data as string
      },
      { uris: [uri], options: opts },
    )
  })

  const gids = await Promise.all(tasks)
  logger.info(
    'aria2.addUri',
    formatLogFields({
      added: gids.length,
      gids: `[${gids.join(',')}]`,
      first: uris[0] ? summarizeExternalInput(uris[0]) : 'none',
      ...summarizeAria2Options(engineOptions),
    }),
  )
  return gids
}

/**
 * Adds a single download with all URIs as mirrors (alternative sources).
 */
export async function addUriAtomic(params: { uris: string[]; options: Record<string, string> }): Promise<string> {
  const { uris, options } = params
  const engineOptions = formatOptionsForEngine(options)
  const gid = await rpc(
    'aria2_add_uri',
    async () => {
      const { data } = await httpClient.post('/api/tasks/uri', { uris, options: engineOptions })
      return data as string
    },
    { uris, options: engineOptions },
  )
  logger.debug('aria2.addUriAtomic', `gid=${gid} mirrors=${uris.length}`)
  return gid
}

/** Adds a torrent download from a base64-encoded .torrent file. */
export async function addTorrent(params: { torrent: string; options: Aria2EngineOptions }): Promise<string> {
  const engineOptions = formatOptionsForEngine(withBtSafetyOptions(params.options))
  const gid = await rpc(
    'aria2_add_torrent',
    async () => {
      const { data } = await httpClient.post('/api/tasks/torrent', {
        torrent: params.torrent,
        options: engineOptions,
      })
      return data as string
    },
    { torrent: params.torrent, options: engineOptions },
  )
  logger.info('aria2.addTorrent', `gid=${gid}`)
  return gid
}

/** Starts an ED2K search and returns the search GID. */
export async function ed2kSearch(params: { keyword: string; options?: Ed2kSearchOptions }): Promise<string> {
  return rpc(
    'aria2_ed2k_search',
    async () => {
      const { data } = await httpClient.post('/api/tasks/ed2k-search', {
        keyword: params.keyword,
        options: params.options ?? {},
      })
      return data as string
    },
    {
      keyword: params.keyword,
      options: params.options ?? {},
    },
  )
}

/** Fetches ED2K search results by search GID. */
export async function getEd2kSearchResults(params: { gid: string }): Promise<Ed2kSearchResults> {
  return rpc(
    'aria2_get_ed2k_search_results',
    async () => {
      const { data } = await httpClient.get(`/api/tasks/ed2k-results/${params.gid}`)
      return data
    },
    { gid: params.gid },
  )
}

/** Cleans up an internal ED2K search task and its temporary files. */
export async function cleanupEd2kSearch(params: { gid: string }): Promise<void> {
  return rpc(
    'aria2_cleanup_ed2k_search',
    async () => {
      await httpClient.post(`/api/tasks/ed2k-cleanup/${params.gid}`)
    },
    { gid: params.gid },
  )
}

/** Forcefully removes a download task by GID. */
export async function removeTask(params: { gid: string }): Promise<string> {
  return rpc(
    'aria2_force_remove',
    async () => {
      const { data } = await httpClient.delete(`/api/tasks/${params.gid}`)
      return data as string
    },
    { gid: params.gid },
  )
}

/** Forcefully pauses a download task by GID. */
export async function forcePauseTask(params: { gid: string }): Promise<string> {
  return rpc(
    'aria2_force_pause',
    async () => {
      const { data } = await httpClient.post(`/api/tasks/${params.gid}/force-pause`)
      return data as string
    },
    { gid: params.gid },
  )
}

/** Pauses a download task by GID (graceful). */
export async function pauseTask(params: { gid: string }): Promise<string> {
  return rpc(
    'aria2_pause',
    async () => {
      const { data } = await httpClient.post(`/api/tasks/${params.gid}/pause`)
      return data as string
    },
    { gid: params.gid },
  )
}

/** Resumes a paused download task by GID. */
export async function resumeTask(params: { gid: string }): Promise<string> {
  return rpc(
    'aria2_unpause',
    async () => {
      const { data } = await httpClient.post(`/api/tasks/${params.gid}/unpause`)
      return data as string
    },
    { gid: params.gid },
  )
}

/** Pauses all active downloads (graceful). */
export async function pauseAllTask(): Promise<string> {
  return rpc('aria2_pause_all', async () => {
    const { data } = await httpClient.post('/api/tasks/pause-all')
    return data as string
  })
}

/** Forcefully pauses all active downloads. */
export async function forcePauseAllTask(): Promise<string> {
  return rpc('aria2_force_pause_all', async () => {
    const { data } = await httpClient.post('/api/tasks/force-pause-all')
    return data as string
  })
}

/** Resumes all paused downloads. */
export async function resumeAllTask(): Promise<string> {
  return rpc('aria2_unpause_all', async () => {
    const { data } = await httpClient.post('/api/tasks/unpause-all')
    return data as string
  })
}

/** Saves the current aria2 session to disk. */
export async function saveSession(): Promise<string> {
  return rpc('aria2_save_session', async () => {
    const { data } = await httpClient.post('/api/session/save')
    return data as string
  })
}

/** Removes a completed/errored task record from the download list. */
export async function removeTaskRecord(params: { gid: string }): Promise<string> {
  return rpc(
    'aria2_remove_download_result',
    async () => {
      const { data } = await httpClient.delete(`/api/results/${params.gid}`)
      return data as string
    },
    { gid: params.gid },
  )
}

/** Purges all completed/errored task records from the download list. */
export async function purgeTaskRecord(): Promise<string> {
  return rpc('aria2_purge_download_result', async () => {
    const { data } = await httpClient.delete('/api/results')
    return data as string
  })
}

/** Batch-resumes multiple tasks by GID array via multicall. */
export async function batchResumeTask(params: { gids: string[] }): Promise<unknown[][]> {
  return rpc(
    'aria2_batch_unpause',
    async () => {
      const { data } = await httpClient.post('/api/tasks/batch/unpause', { gids: params.gids })
      return data
    },
    { gids: params.gids },
  )
}

/** Batch-pauses multiple tasks by GID array via multicall (force). */
export async function batchPauseTask(params: { gids: string[] }): Promise<unknown[][]> {
  return rpc(
    'aria2_batch_force_pause',
    async () => {
      const { data } = await httpClient.post('/api/tasks/batch/pause', { gids: params.gids })
      return data
    },
    { gids: params.gids },
  )
}

/** Alias for batchPauseTask — force-pauses multiple tasks. */
export async function batchForcePauseTask(params: { gids: string[] }): Promise<unknown[][]> {
  return batchPauseTask(params)
}

/** Batch-removes multiple tasks by GID array via multicall (force). */
export async function batchRemoveTask(params: { gids: string[] }): Promise<unknown[][]> {
  return rpc(
    'aria2_batch_force_remove',
    async () => {
      const { data } = await httpClient.post('/api/tasks/batch/remove', { gids: params.gids })
      return data
    },
    { gids: params.gids },
  )
}

// ════════════════════════════════════════════════════════════════════
// ── File system operations ─────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

/** Checks whether a file or directory exists at the given path. */
export async function checkPathExists(path: string): Promise<boolean> {
  return rpc(
    'check_path_exists',
    async () => {
      const { data } = await httpClient.post('/api/files/check-path-exists', { path })
      return data
    },
    { path },
  )
}

/** Checks whether the path exists and is a directory. */
export async function checkPathIsDir(path: string): Promise<boolean> {
  return rpc(
    'check_path_is_dir',
    async () => {
      const { data } = await httpClient.post('/api/files/check-path-is-dir', { path })
      return data
    },
    { path },
  )
}

/** Moves a file or directory to the OS trash / recycle bin. */
export async function trashFile(path: string): Promise<void> {
  return rpc(
    'trash_file',
    async () => {
      await httpClient.post('/api/files/trash-file', { path })
    },
    { path },
  )
}

/** Permanently deletes a file from disk (NOT move to trash). */
export async function removeFile(path: string): Promise<void> {
  return rpc(
    'remove_file',
    async () => {
      await httpClient.post('/api/files/remove-file', { path })
    },
    { path },
  )
}

/** Opens the file manager / explorer at the given path. */
export async function showItemInDir(path: string): Promise<void> {
  return rpc(
    'show_item_in_dir',
    async () => {
      await httpClient.post('/api/files/show-item-in-dir', { path })
    },
    { path },
  )
}

/** Opens the file or directory with the system default application. */
export async function openPathNormalized(path: string): Promise<void> {
  return rpc(
    'open_path_normalized',
    async () => {
      await httpClient.post('/api/files/open-path-normalized', { path })
    },
    { path },
  )
}

/** Reads a local file and returns its content as a byte array. */
export async function readLocalFile(path: string): Promise<number[]> {
  return rpc(
    'read_local_file',
    async () => {
      const { data } = await httpClient.post('/api/files/read-local-file', { path })
      return data as number[]
    },
    { path },
  )
}

/** Lists all file/directory names in a directory (basenames only). */
export async function listDirFiles(path: string): Promise<string[]> {
  return rpc(
    'list_dir_files',
    async () => {
      const { data } = await httpClient.post('/api/files/list-dir-files', { path })
      return data as string[]
    },
    { path },
  )
}

const api = {
  getVersion,
  getGlobalOption,
  getGlobalStat,
  changeGlobalOption,
  getOption,
  changeOption,
  getFiles,
  fetchActiveTaskList,
  fetchTaskList,
  fetchTaskItem,
  fetchTaskItemWithPeers,
  addUri,
  addUriAtomic,
  addTorrent,
  ed2kSearch,
  getEd2kSearchResults,
  cleanupEd2kSearch,
  removeTask,
  forcePauseTask,
  pauseTask,
  resumeTask,
  pauseAllTask,
  forcePauseAllTask,
  resumeAllTask,
  saveSession,
  removeTaskRecord,
  purgeTaskRecord,
  batchResumeTask,
  batchPauseTask,
  batchForcePauseTask,
  batchRemoveTask,
}

export default api
