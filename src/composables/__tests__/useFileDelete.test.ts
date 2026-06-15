/**
 * @fileoverview Tests for the deleteTaskFiles function.
 *
 * Key behaviors under test:
 * - Folder downloads (BT multi-file): deletes entire directory + external .aria2 in one go
 * - Single-file downloads: deletes file + companion .aria2 control file
 * - BT tasks with infoHash: triggers .torrent metadata cleanup
 * - HTTP tasks without infoHash: skips .torrent cleanup
 * - Fallback: deletes files individually when resolveOpenTarget returns dir
 * - Download directory is NEVER deleted (issue #167)
 * - Silently handles missing files without throwing
 *
 * Also covers:
 * - removePath: permanently deletes files via remove_file command
 * - cleanupAria2ControlFiles: removes .aria2 control files after P2P sharing ends
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Aria2Task } from '@shared/types'

// ── Mock Tauri Core (invoke) ────────────────────────────────────────
const mockCheckPathExists = vi.fn()
const mockCheckPathIsDir = vi.fn()
const mockTrashFile = vi.fn()
const mockRemoveFile = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'check_path_exists') return mockCheckPathExists(args)
    if (cmd === 'check_path_is_dir') return mockCheckPathIsDir(args)
    if (cmd === 'trash_file') return mockTrashFile(args)
    if (cmd === 'remove_file') return mockRemoveFile(args)
    return Promise.reject(new Error(`Unexpected invoke: ${cmd}`))
  },
}))

// ── Mock resolveOpenTarget ──────────────────────────────────────────
const mockResolveOpenTarget = vi.fn()

vi.mock('@shared/utils', () => ({
  resolveOpenTarget: (...args: unknown[]) => mockResolveOpenTarget(...args),
}))

// ── Mock cleanupAria2MetadataFiles ──────────────────────────────────
const mockCleanupTorrentMetadata = vi.fn()

vi.mock('@/composables/useDownloadCleanup', () => ({
  cleanupAria2MetadataFiles: (...args: unknown[]) => mockCleanupTorrentMetadata(...args),
}))

// ── Mock Tauri path ─────────────────────────────────────────────────
vi.mock('@tauri-apps/api/path', () => ({
  join: (...parts: string[]) => Promise.resolve(parts.join('/')),
}))

import { deleteTaskFiles, removePath, cleanupAria2ControlFiles } from '../useFileDelete'

function makeTask(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: 'abc123',
    status: 'complete',
    totalLength: '1000',
    completedLength: '1000',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    dir: '/downloads',
    files: [],
    ...overrides,
  }
}

describe('deleteTaskFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPathExists.mockResolvedValue(true)
    mockTrashFile.mockResolvedValue(undefined)
    mockRemoveFile.mockResolvedValue(undefined)
    mockCleanupTorrentMetadata.mockResolvedValue(true)
  })

  // ── Folder download (BT multi-file) ───────────────────────────────

  it('deletes entire folder + external .aria2 for multi-file BT task', async () => {
    const task = makeTask({
      bittorrent: { info: { name: 'My Torrent' } },
      infoHash: 'abcdef1234567890abcdef1234567890abcdef12',
      files: [
        {
          index: '1',
          path: '/downloads/My Torrent/file1.mp4',
          length: '500',
          completedLength: '500',
          selected: 'true',
          uris: [],
        },
        {
          index: '2',
          path: '/downloads/My Torrent/file2.srt',
          length: '100',
          completedLength: '100',
          selected: 'true',
          uris: [],
        },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads/My Torrent')
    mockCheckPathIsDir.mockResolvedValue(true)

    await deleteTaskFiles(task)

    // Folder + external .aria2
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/My Torrent' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/My Torrent.aria2' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/abcdef1234567890abcdef1234567890abcdef12.aria2' })
    // .torrent metadata cleanup triggered
    expect(mockCleanupTorrentMetadata).toHaveBeenCalledWith('/downloads', 'abcdef1234567890abcdef1234567890abcdef12')
  })

  // ── Single-file download ─────────────────────────────────────────

  it('deletes file + .aria2 for single-file HTTP download', async () => {
    const task = makeTask({
      files: [
        {
          index: '1',
          path: '/downloads/movie.mp4',
          length: '1000',
          completedLength: '1000',
          selected: 'true',
          uris: [],
        },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads/movie.mp4')
    mockCheckPathIsDir.mockResolvedValue(false)

    await deleteTaskFiles(task)

    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/movie.mp4' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/movie.mp4.aria2' })
    // No infoHash → no .torrent cleanup
    expect(mockCleanupTorrentMetadata).not.toHaveBeenCalled()
  })

  // ── Single-file BT (torrent with one file) ───────────────────────

  it('deletes file + .aria2 + .torrent for single-file BT task', async () => {
    const task = makeTask({
      bittorrent: { info: { name: 'movie.mkv' } },
      infoHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      files: [
        {
          index: '1',
          path: '/downloads/movie.mkv',
          length: '1000',
          completedLength: '1000',
          selected: 'true',
          uris: [],
        },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads/movie.mkv')
    mockCheckPathIsDir.mockResolvedValue(false)

    await deleteTaskFiles(task)

    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/movie.mkv' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/movie.mkv.aria2' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef.aria2' })
    expect(mockCleanupTorrentMetadata).toHaveBeenCalledWith('/downloads', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
  })

  // ── Fallback: resolveOpenTarget returns dir ───────────────────────

  it('falls back to per-file delete when resolveOpenTarget returns dir', async () => {
    const task = makeTask({
      dir: '/downloads',
      files: [
        { index: '1', path: '/downloads/file1.zip', length: '500', completedLength: '500', selected: 'true', uris: [] },
        { index: '2', path: '/downloads/file2.zip', length: '500', completedLength: '500', selected: 'true', uris: [] },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads')

    await deleteTaskFiles(task)

    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/file1.zip' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/file1.zip.aria2' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/file2.zip' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/file2.zip.aria2' })
    // Fallback does NOT invoke check_path_is_dir
    expect(mockCheckPathIsDir).not.toHaveBeenCalled()
  })

  // ── Download directory is NEVER deleted (issue #167) ──────────────

  it('never deletes the download directory itself', async () => {
    const task = makeTask({
      dir: '/downloads',
      files: [
        {
          index: '1',
          path: '/downloads/only-file.zip',
          length: '100',
          completedLength: '100',
          selected: 'true',
          uris: [],
        },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads/only-file.zip')
    mockCheckPathIsDir.mockResolvedValue(false)

    await deleteTaskFiles(task)

    // Only the file and its .aria2 are deleted — download dir untouched
    const deletedPaths = mockRemoveFile.mock.calls.map((c) => (c[0] as Record<string, unknown>)?.path)
    expect(deletedPaths).not.toContain('/downloads')
    expect(deletedPaths).toContain('/downloads/only-file.zip')
  })

  // ── Edge cases ────────────────────────────────────────────────────

  it('silently handles missing files without throwing', async () => {
    const task = makeTask({
      files: [
        { index: '1', path: '/downloads/gone.zip', length: '100', completedLength: '100', selected: 'true', uris: [] },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads/gone.zip')
    mockCheckPathIsDir.mockResolvedValue(false)
    mockCheckPathExists.mockResolvedValue(false)

    await expect(deleteTaskFiles(task)).resolves.toBeUndefined()
  })

  it('handles tasks with no files gracefully', async () => {
    const task = makeTask({ files: [] })
    mockResolveOpenTarget.mockResolvedValue('/downloads')

    await deleteTaskFiles(task)

    expect(mockRemoveFile).not.toHaveBeenCalled()
  })

  it('handles empty resolveOpenTarget result', async () => {
    const task = makeTask({
      files: [
        { index: '1', path: '/downloads/file.zip', length: '100', completedLength: '100', selected: 'true', uris: [] },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('')

    await deleteTaskFiles(task)

    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/file.zip' })
  })

  it('skips files with empty path in fallback mode', async () => {
    const task = makeTask({
      files: [
        { index: '1', path: '', length: '0', completedLength: '0', selected: 'true', uris: [] },
        { index: '2', path: '/downloads/valid.zip', length: '100', completedLength: '100', selected: 'true', uris: [] },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads')

    await deleteTaskFiles(task)

    const deletedPaths = mockRemoveFile.mock.calls.map((c) => (c[0] as Record<string, unknown>)?.path)
    expect(deletedPaths).not.toContain('')
    expect(deletedPaths).toContain('/downloads/valid.zip')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// removePath — permanent deletion of internal aria2 metadata
// ═══════════════════════════════════════════════════════════════════════

describe('removePath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPathExists.mockResolvedValue(true)
    mockRemoveFile.mockResolvedValue(undefined)
  })

  it('permanently deletes an existing file via remove_file command', async () => {
    const result = await removePath('/downloads/movie.mkv.aria2')

    expect(result).toBe(true)
    expect(mockCheckPathExists).toHaveBeenCalledWith({ path: '/downloads/movie.mkv.aria2' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/movie.mkv.aria2' })
  })

  it('does NOT use trash_file (must permanently delete)', async () => {
    await removePath('/downloads/test.aria2')

    expect(mockRemoveFile).toHaveBeenCalled()
    expect(mockTrashFile).not.toHaveBeenCalled()
  })

  it('returns false for empty path', async () => {
    const result = await removePath('')

    expect(result).toBe(false)
    expect(mockCheckPathExists).not.toHaveBeenCalled()
    expect(mockRemoveFile).not.toHaveBeenCalled()
  })

  it('returns false when file does not exist', async () => {
    mockCheckPathExists.mockResolvedValue(false)

    const result = await removePath('/downloads/gone.aria2')

    expect(result).toBe(false)
    expect(mockRemoveFile).not.toHaveBeenCalled()
  })

  it('returns false and does not throw on remove_file error', async () => {
    mockRemoveFile.mockRejectedValue(new Error('permission denied'))

    const result = await removePath('/downloads/locked.aria2')

    expect(result).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// cleanupAria2ControlFiles — .aria2 cleanup after P2P sharing ends
// ═══════════════════════════════════════════════════════════════════════

describe('cleanupAria2ControlFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPathExists.mockResolvedValue(true)
    mockRemoveFile.mockResolvedValue(undefined)
  })

  it('removes infohash .aria2 for single-file BT task', async () => {
    const task = makeTask({
      bittorrent: { info: { name: 'movie.mkv' } },
      infoHash: 'deadbeef'.repeat(5),
      files: [
        {
          index: '1',
          path: '/downloads/movie.mkv',
          length: '1000',
          completedLength: '1000',
          selected: 'true',
          uris: [],
        },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads/movie.mkv')

    await cleanupAria2ControlFiles(task)

    expect(mockRemoveFile).toHaveBeenCalledWith({ path: `/downloads/${task.infoHash}.aria2` })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/movie.mkv.aria2' })
    // Must use remove_file, not trash_file
    expect(mockTrashFile).not.toHaveBeenCalled()
  })

  it('removes infohash .aria2 for folder BT task', async () => {
    const task = makeTask({
      bittorrent: { info: { name: 'My Torrent' } },
      infoHash: 'abcdef12'.repeat(5),
      files: [
        {
          index: '1',
          path: '/downloads/My Torrent/file1.mp4',
          length: '500',
          completedLength: '500',
          selected: 'true',
          uris: [],
        },
        {
          index: '2',
          path: '/downloads/My Torrent/file2.srt',
          length: '100',
          completedLength: '100',
          selected: 'true',
          uris: [],
        },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads/My Torrent')

    await cleanupAria2ControlFiles(task)

    expect(mockRemoveFile).toHaveBeenCalledWith({ path: `/downloads/${task.infoHash}.aria2` })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/My Torrent.aria2' })
  })

  it('removes companion .aria2 for ED2K sharing tasks', async () => {
    const task = makeTask({
      ed2k: { name: 'file.zip', hash: 'ed2khash' },
      files: [
        {
          index: '1',
          path: '/downloads/file.zip',
          length: '1000',
          completedLength: '1000',
          selected: 'true',
          uris: [],
        },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads/file.zip')

    await cleanupAria2ControlFiles(task)

    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/file.zip.aria2' })
    expect(mockTrashFile).not.toHaveBeenCalled()
  })

  it('falls back to per-file .aria2 cleanup when resolveOpenTarget returns dir', async () => {
    const task = makeTask({
      bittorrent: { info: { name: 'Task' } },
      dir: '/downloads',
      infoHash: 'deadbeef'.repeat(5),
      files: [
        { index: '1', path: '/downloads/file1.mp4', length: '500', completedLength: '500', selected: 'true', uris: [] },
        { index: '2', path: '/downloads/file2.mp4', length: '500', completedLength: '500', selected: 'true', uris: [] },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads')

    await cleanupAria2ControlFiles(task)

    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef.aria2' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/file1.mp4.aria2' })
    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/file2.mp4.aria2' })
  })

  it('falls back to per-file cleanup when resolveOpenTarget returns empty', async () => {
    const task = makeTask({
      bittorrent: { info: { name: 'Task' } },
      files: [
        {
          index: '1',
          path: '/downloads/only.mp4',
          length: '1000',
          completedLength: '1000',
          selected: 'true',
          uris: [],
        },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('')

    await cleanupAria2ControlFiles(task)

    expect(mockRemoveFile).toHaveBeenCalledWith({ path: '/downloads/only.mp4.aria2' })
  })

  it('silently handles errors without throwing', async () => {
    const task = makeTask({
      bittorrent: { info: { name: 'movie.mkv' } },
      files: [
        {
          index: '1',
          path: '/downloads/movie.mkv',
          length: '1000',
          completedLength: '1000',
          selected: 'true',
          uris: [],
        },
      ],
    })
    mockResolveOpenTarget.mockRejectedValue(new Error('resolve failed'))

    await expect(cleanupAria2ControlFiles(task)).resolves.toBeUndefined()
  })

  it('skips files with empty path in fallback', async () => {
    const task = makeTask({
      bittorrent: { info: { name: 'Task' } },
      dir: '/downloads',
      files: [
        { index: '1', path: '', length: '0', completedLength: '0', selected: 'true', uris: [] },
        { index: '2', path: '/downloads/valid.mp4', length: '500', completedLength: '500', selected: 'true', uris: [] },
      ],
    })
    mockResolveOpenTarget.mockResolvedValue('/downloads')

    await cleanupAria2ControlFiles(task)

    const removedPaths = mockRemoveFile.mock.calls.map((c) => (c[0] as Record<string, unknown>)?.path)
    expect(removedPaths).not.toContain('.aria2')
    expect(removedPaths).toContain('/downloads/valid.mp4.aria2')
  })
})
