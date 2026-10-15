import { describe, expect, it, vi } from 'vitest'
import type { Media } from '../domain/types'
import { db } from './db'

// iPhone のアプリとして動かす（動画を作り直す部品が呼ばれたかを覚える）
const calls = vi.hoisted(() => ({ transcoded: 0 }))
vi.mock('../platform', () => ({
  isNativeApp: true,
  isAndroidApp: false,
  isIosApp: true,
  isIosDevice: () => true,
}))
vi.mock('./files', () => ({
  usesFiles: true,
  ContentUnavailableError: class extends Error {},
  writeBlobFile: async () => {},
  readBlobFile: async () => new Blob(['from file']),
  deleteFile: async () => {},
  listContentFiles: async () => [],
  transcodeVideoFile: async () => {
    calls.transcoded++
    throw new Error('iPhone は WebM を読めない')
  },
  deleteAllContentFiles: async () => {},
}))

const { optimizeVideos } = await import('./content')

function video(over: Partial<Media>): Media {
  return { id: 'm1', recordId: 'r1', skillId: 's1', type: 'video/webm', size: 50, createdAt: 1, updatedAt: 1, file: 'media/m1-1.webm', ...over }
}

describe('iPhone のアプリで、動画の画質をそろえる', () => {
  it('WebM は作り直さず、そのまま使う印を付ける（YouTube に上げるのを、ずっと待たないように）', async () => {
    await db.media.add(video({}))
    await optimizeVideos()
    expect(calls.transcoded).toBe(0)
    expect((await db.media.get('m1'))?.optimized).toBeDefined()
  })

  it('MP4 は、これまでどおり作り直しを試す', async () => {
    await db.media.add(video({ id: 'm2', type: 'video/mp4', file: 'media/m2-1.mp4' }))
    await optimizeVideos()
    expect(calls.transcoded).toBe(1)
  })
})
