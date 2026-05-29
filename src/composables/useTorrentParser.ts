/** @fileoverview Torrent metadata parsing adapter. */
import { parseTorrentMeta, type TorrentMeta, type TorrentFile } from '@shared/utils/torrentMeta'

export type { TorrentMeta, TorrentFile }

/** Parse a .torrent file into typed metadata with SHA-1 infoHash and files. */
export async function parseTorrentBuffer(uint8: Uint8Array): Promise<TorrentMeta | null> {
  return parseTorrentMeta(uint8)
}

/** Converts a Uint8Array to a base64 string for transmission. */
export function uint8ToBase64(uint8: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i])
  }
  return btoa(binary)
}
