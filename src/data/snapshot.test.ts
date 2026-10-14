import { describe, expect, it } from 'vitest'
import type { Media } from '../domain/types'
import { parseSnapshot, toSnapshot } from './snapshot'

describe('記録の写し', () => {
  const media: Media = {
    id: 'm1',
    recordId: 'r1',
    skillId: 's1',
    type: 'video/mp4',
    size: 10,
    createdAt: 1,
    updatedAt: 1,
    blob: new Blob(['v']),
    poster: new Blob(['p']),
    file: 'media/m1-1.mp4',
  }

  it('動画・写真の中身とサムネイルは入れず、ファイルの場所は残す', () => {
    const s = toSnapshot({ domains: [], skills: [], records: [], media: [media], meta: [] }, 5)
    expect(s.media[0]).not.toHaveProperty('blob')
    expect(s.media[0]).not.toHaveProperty('poster')
    expect(s.media[0].file).toBe('media/m1-1.mp4')
    expect(parseSnapshot(JSON.stringify(s))?.media[0].file).toBe('media/m1-1.mp4')
  })

  it('壊れた写し・違う形の写しは使わない', () => {
    expect(parseSnapshot(undefined)).toBeUndefined()
    expect(parseSnapshot('{')).toBeUndefined()
    expect(parseSnapshot(JSON.stringify({ version: 2, domains: [], records: [] }))).toBeUndefined()
  })
})
