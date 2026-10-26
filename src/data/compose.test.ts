import { describe, expect, it } from 'vitest'
import { checkClips } from './compose'

const source = { file: 'media/a.mp4' }

describe('つなぐ動画の区間の確認', () => {
  it('動画が 1 本も無ければ断る', () => {
    expect(() => checkClips([])).toThrow()
  })

  it('始めが負・終わりが始めより前・0.3 秒より短い範囲は断る', () => {
    expect(() => checkClips([{ source, start: -1 }])).toThrow()
    expect(() => checkClips([{ source, start: 5, end: 4 }])).toThrow()
    expect(() => checkClips([{ source, start: 5, end: 5.2 }])).toThrow()
  })

  it('終わりを省くと動画の終わりまでとして通す', () => {
    expect(() => checkClips([{ source, start: 0 }, { source, start: 1.5, end: 3 }])).not.toThrow()
  })
})
