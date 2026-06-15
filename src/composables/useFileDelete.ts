/** @fileoverview Composable for deleting download task files and associated artifacts from disk.
 *
 * All deletions are **permanent** — files are NOT moved to the OS trash/recycle bin.
 *
 * `removePath()` permanently deletes files via the Rust `remove_file` command.
 * Used for:
 * - User-downloaded content and user-imported .torrent files
 * - `.aria2` control files (piece bitmap + checksums)
 * - hex40-named `.torrent` metadata (bt-save-metadata / rpc-save-upload-metadata)
 *
 * Folder detection reuses the existing `resolveOpenTarget` + `check_path_is_dir`
 * infrastructure so folder downloads are deleted in a single OS call (one sound).
 */
import { logger } from '@shared/logger'
import { resolveOpenTarget } from '@shared/utils'
import { cleanupAria2MetadataFiles } from '@/composables/useDownloadCleanup'
import { checkPathExists, checkPathIsDir, trashFile, removeFile } from '@/api/aria2'
import type { Aria2Task } from '@shared/types'

/**
 * Move a file or directory to the OS trash / recycle bin.
 *
 * Silent no-op when the path is empty, doesn't exist, or the operation fails.
 * Returns `true` if the item was successfully trashed.
 */
export async function trashPath(path: string): Promise<boolean> {
  if (!path) return false
  try {
    const exists = await checkPathExists(path)
    if (!exists) return false
    await trashFile(path)
    return true
  } catch (e) {
    logger.debug('trashPath', `Failed to trash ${path}: ${e}`)
    return false
  }
}

/**
 * Permanently delete a file from disk (NOT move to trash).
 *
 * Used exclusively for internal aria2 metadata files:
 * - `.aria2` control files (piece bitmap + checksum — no user value)
 * - hex40-named `.torrent` metadata (aria2 bt-save-metadata / rpc-save-upload-metadata cache)
 *
 * Silent no-op when the path is empty, doesn't exist, or fails.
 * Returns `true` if the file was successfully removed.
 *
 * SAFETY: Never use this for user-downloaded content — use trashPath() instead.
 */
export async function removePath(path: string): Promise<boolean> {
  if (!path) return false
  try {
    const exists = await checkPathExists(path)
    if (!exists) return false
    await removeFile(path)
    return true
  } catch (e) {
    logger.debug('removePath', `Failed to remove ${path}: ${e}`)
    return false
  }
}

/**
 * Clean up `.aria2` control files for a completed/stopped P2P task.
 *
 * BT can have an infoHash-named control file in the download directory.
 * BT and ED2K can also have companion control files next to the target path.
 *
 * Path resolution mirrors `deleteTaskFiles()` for consistency.
 *
 * Safe to call after P2P sharing completes:
 * - From `stopSharing()` (user manually stops)
 * - From `onTaskComplete()` (aria2 auto-stops via seed-time/seed-ratio)
 */
export async function cleanupAria2ControlFiles(task: Aria2Task): Promise<void> {
  try {
    if (task.dir && task.infoHash) {
      await removePath(`${task.dir}/${task.infoHash}.aria2`)
    }

    const target = await resolveOpenTarget(task)

    if (!target || target === task.dir) {
      // Fallback: per-file cleanup
      for (const f of task.files || []) {
        if (f.path) await removePath(f.path + '.aria2')
      }
      return
    }

    await removePath(target + '.aria2')
  } catch (e) {
    logger.debug('cleanupAria2ControlFiles', `cleanup failed: ${e}`)
  }
}

/**
 * Moves all files associated with a download task to the OS trash.
 *
 * Uses `resolveOpenTarget()` to determine the primary target path, then
 * `check_path_is_dir` to detect whether it's a folder or single file:
 *
 * - **Folder download** (BT multi-file): trashes the entire directory in one
 *   OS call — eliminates the N×2 individual trash calls that caused multiple
 *   delete sounds on macOS.  Also trashes the external `.aria2` control file
 *   that sits alongside the directory.
 *
 * - **Single-file download** (HTTP/BT single): trashes the file and its
 *   companion `.aria2` control file.
 *
 * - **Fallback** (no resolvable target): trashes files individually.
 *
 * For BT tasks, also cleans up hex40-named `.torrent` metadata files.
 *
 * Safety: the download directory itself is NEVER trashed — `resolveOpenTarget`
 * returns `dir` only as a fallback, and that case delegates to per-file trash.
 */
export async function deleteTaskFiles(task: Aria2Task): Promise<void> {
  const target = await resolveOpenTarget(task)

  // Fallback: resolveOpenTarget returned the bare download directory,
  // meaning no specific file/folder could be resolved — delete individually.
  if (!target || target === task.dir) {
    await deleteFilesIndividually(task)
    return
  }

  const isDir = await checkPathIsDir(target)
  if (isDir) {
    // Folder task: delete the entire directory
    await removePath(target)
    // External .aria2 control file sits alongside the folder
    await removePath(target + '.aria2')
  } else {
    // Single-file task: delete the file + companion .aria2 control file
    await removePath(target)
    await removePath(target + '.aria2')
  }

  // BT tasks: clean up the hex40-named .aria2 and .torrent metadata
  if (task.dir && task.infoHash) {
    await removePath(`${task.dir}/${task.infoHash}.aria2`)
    await cleanupAria2MetadataFiles(task.dir, task.infoHash)
  }
}

/**
 * Fallback: delete files one by one.
 * Used when `resolveOpenTarget` cannot determine a specific target
 * (e.g., magnet still resolving metadata, or task with empty file list).
 */
async function deleteFilesIndividually(task: Aria2Task): Promise<void> {
  for (const f of task.files || []) {
    if (!f.path) continue
    await removePath(f.path)
    await removePath(f.path + '.aria2')
  }
}
