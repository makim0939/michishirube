import { describe, expect, it, vi } from 'vitest'
import type { Media } from '../domain/types'
import { db } from './db'

// YouTube で再生できるかを確かめるあいだに、ほかのことが起きる様子を作る
const youtube = vi.hoisted(() => ({ onCheck: async () => {} }))
vi.mock('./youtube', () => ({
  youtubePlayable: async () => {
    await youtube.onCheck()
    return true
  },
}))
// サムネイルは、もうあることにして作らない（動画を読めない環境なので）
vi.mock('./mediaPrep', () => ({ inMemory: async (b: Blob) => b, makePoster: async () => undefined }))

const { tidyVideos } = await import('./tidy')

const DAY = 24 * 60 * 60 * 1000
const now = 100 * DAY
const video: Media = {
  id: 'm1',
  recordId: 'r1',
  skillId: 's1',
  type: 'video/mp4',
  size: 3,
  createdAt: 1,
  updatedAt: 1,
  contentAt: 1,
  upload: 'done',
  youtubeId: 'yt1',
  blob: new Blob(['old'], { type: 'video/mp4' }),
  poster: new Blob(['p'], { type: 'image/jpeg' }),
  posterEnd: true,
}

describe('YouTube に上げ終えた動画の整理', () => {
  it('上げ終えて日がたった動画は、端末から消す', async () => {
    youtube.onCheck = async () => {}
    await db.media.add(video)
    expect((await tidyVideos(now)).count).toBe(1)
    expect((await db.media.get('m1'))?.blob).toBeUndefined()
  })

  it('確かめているあいだに切り取って差し替えた動画は、消さない（新しい中身はまだ上げていない）', async () => {
    youtube.onCheck = async () => {
      await db.media.update('m1', { blob: new Blob(['new'], { type: 'video/mp4' }), contentAt: now, upload: 'pending', youtubeId: undefined })
    }
    await db.media.add(video)
    expect((await tidyVideos(now)).count).toBe(0)
    expect(await (await db.media.get('m1'))?.blob?.text()).toBe('new')
  })
})
