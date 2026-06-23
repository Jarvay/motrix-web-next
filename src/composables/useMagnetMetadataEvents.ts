import { listen } from '@tauri-apps/api/event'
import { logger } from '@shared/logger'
import {
  getResolvedMagnetSelection,
  parseFilesForSelection,
  type MagnetFileItem,
  type MagnetSelectionResolution,
} from '@/composables/useMagnetFlow'
import type { Aria2Task } from '@shared/types'

export interface MagnetMetadataState {
  pendingGids: string[]
  visible: boolean
  files: MagnetFileItem[]
  session: MagnetSelectionResolution | null
  name: string
}

export interface MagnetMetadataDeps {
  state: MagnetMetadataState
  fetchTaskStatus: (gid: string) => Promise<Aria2Task>
  getFiles: (gid: string) => Promise<Aria2Task['files']>
  fallbackName: () => string
}

export async function resolvePendingMagnetMetadata(deps: MagnetMetadataDeps, gid: string): Promise<boolean> {
  const { state } = deps
  if (state.visible) return false
  if (!state.pendingGids.includes(gid)) return false

  try {
    const metadataTask = await deps.fetchTaskStatus(gid)
    const resolved = getResolvedMagnetSelection(metadataTask)
    if (!resolved) return false

    const task = await deps.fetchTaskStatus(resolved.downloadGid)
    const files = await deps.getFiles(resolved.downloadGid)
    const realFiles = files.filter((file) => Number(file.length) > 0)
    if (realFiles.length === 0) return false

    state.pendingGids = state.pendingGids.filter((pendingGid) => pendingGid !== gid)
    const parsed = parseFilesForSelection(realFiles)
    state.files = parsed
    state.session = resolved
    state.name = task.bittorrent?.info?.name || parsed[0]?.name || deps.fallbackName()
    state.visible = true
    return true
  } catch (e) {
    logger.debug('MagnetMetadata.resolve', `gid=${gid} metadata query skipped: ${e}`)
    return false
  }
}

export async function resolveNextPendingMagnetMetadata(deps: MagnetMetadataDeps): Promise<void> {
  if (deps.state.visible) return
  for (const gid of [...deps.state.pendingGids]) {
    if (await resolvePendingMagnetMetadata(deps, gid)) return
  }
}

export async function listenForAria2DownloadComplete(
  onComplete: (gid: string) => unknown | Promise<unknown>,
): Promise<() => void> {
  return listen<{ gid: string }>('aria2-event:download-complete', (event) => {
    void onComplete(event.payload.gid)
  })
}
