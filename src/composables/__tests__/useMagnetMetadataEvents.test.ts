import { describe, expect, it, vi } from 'vitest'
import { resolvePendingMagnetMetadata, type MagnetMetadataState } from '@/composables/useMagnetMetadataEvents'
import type { Aria2Task } from '@shared/types'

vi.mock('@shared/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}))

function makeTask(gid: string, extra: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid,
    status: 'complete',
    totalLength: '0',
    completedLength: '0',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    dir: '/downloads',
    files: [],
    ...extra,
  }
}

describe('useMagnetMetadataEvents', () => {
  it('opens file selection immediately when a pending metadata gid completes', async () => {
    const state: MagnetMetadataState = {
      pendingGids: ['metadata-gid'],
      visible: false,
      files: [],
      session: null,
      name: '',
    }
    const fetchTaskStatus = vi.fn(async (gid: string) => {
      if (gid === 'metadata-gid') return makeTask(gid, { followedBy: ['download-gid'] })
      return makeTask(gid, { bittorrent: { info: { name: 'Ubuntu ISO' } } })
    })
    const getFiles = vi.fn().mockResolvedValue([
      {
        index: '1',
        path: '/downloads/Ubuntu/ubuntu.iso',
        length: '1024',
        completedLength: '0',
        selected: 'true',
        uris: [],
      },
    ])

    const resolved = await resolvePendingMagnetMetadata(
      {
        state,
        fetchTaskStatus,
        getFiles,
        fallbackName: () => 'Magnet task',
      },
      'metadata-gid',
    )

    expect(resolved).toBe(true)
    expect(state.pendingGids).toEqual([])
    expect(state.visible).toBe(true)
    expect(state.session).toEqual({ metadataGid: 'metadata-gid', downloadGid: 'download-gid' })
    expect(state.name).toBe('Ubuntu ISO')
    expect(state.files).toEqual([
      {
        index: 1,
        name: 'ubuntu.iso',
        path: '/downloads/Ubuntu/ubuntu.iso',
        length: 1024,
      },
    ])
    expect(fetchTaskStatus).toHaveBeenCalledWith('metadata-gid')
    expect(fetchTaskStatus).toHaveBeenCalledWith('download-gid')
    expect(getFiles).toHaveBeenCalledWith('download-gid')
  })

  it('ignores completion events for non-pending gids', async () => {
    const state: MagnetMetadataState = {
      pendingGids: ['metadata-gid'],
      visible: false,
      files: [],
      session: null,
      name: '',
    }
    const fetchTaskStatus = vi.fn()

    const resolved = await resolvePendingMagnetMetadata(
      {
        state,
        fetchTaskStatus,
        getFiles: vi.fn(),
        fallbackName: () => 'Magnet task',
      },
      'other-gid',
    )

    expect(resolved).toBe(false)
    expect(fetchTaskStatus).not.toHaveBeenCalled()
    expect(state.pendingGids).toEqual(['metadata-gid'])
  })
})
