import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => ({
  composeVideoFiles: vi.fn(),
  deleteDir: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  readBlobFile: vi.fn(),
  writeBlobFile: vi.fn(async () => {}),
  usesFiles: true,
}))
vi.mock('./files', () => files)

import { canSplitAt, checkClips, composeClips, totalSeconds } from './compose'

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

  it('ちょうど 0.3 秒の範囲は、引き算の誤差で弾かない', () => {
    expect(() => checkClips([{ source, start: 5, end: 5.3 }])).not.toThrow()
  })
})

describe('動画をつなぐ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    files.readBlobFile.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' }))
    files.composeVideoFiles.mockResolvedValue({ size: 3, duration: 1 })
  })

  it('メモリの動画は一時ファイルに書いて渡し、ファイルの動画はその場所のまま渡し、終わりを省いた区間は end を送らない', async () => {
    await composeClips(
      [
        { source: { blob: new Blob(['x'], { type: 'video/mp4' }) }, start: 1, end: 2 },
        { source: { file: 'media/b.mp4' }, start: 0 },
      ],
      'standard',
      'cup.mp4',
    )
    expect(files.writeBlobFile).toHaveBeenCalledTimes(1)
    const [clips] = files.composeVideoFiles.mock.calls[0] as [{ input: string; start: number; end?: number }[]]
    expect(clips[0].input).toMatch(/^compose\/.+\/in-0\.mp4$/)
    expect(clips[0]).toMatchObject({ start: 1, end: 2 })
    expect(clips[1]).toEqual({ input: 'media/b.mp4', start: 0 })
  })

  it('できた動画は「-edit.mp4」の名前の File で返し、一時ファイルとフォルダを片付ける', async () => {
    const file = await composeClips([{ source: { blob: new Blob(['x'], { type: 'video/webm' }) }, start: 0 }], 'high', 'cup-edit.mov')
    expect(file.name).toBe('cup-edit.mp4')
    expect(file.type).toBe('video/mp4')
    expect(files.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/in-0\.webm$/))
    expect(files.deleteDir).toHaveBeenCalledTimes(1)
  })

  it('書き出しに失敗しても、一時ファイルとフォルダを片付けて、失敗を投げる', async () => {
    files.composeVideoFiles.mockRejectedValue(new Error('boom'))
    await expect(composeClips([{ source: { blob: new Blob(['x']) }, start: 0 }], 'standard', 'a.mp4')).rejects.toThrow('boom')
    expect(files.deleteDir).toHaveBeenCalledTimes(1)
  })
})

describe('同じ動画から何区間も切り出す（分割）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    files.readBlobFile.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' }))
    files.composeVideoFiles.mockResolvedValue({ size: 3, duration: 1 })
  })

  it('メモリの動画は、一度だけ一時ファイルに書き、区間ごとに同じ入力を渡す', async () => {
    const blob = new Blob(['x'], { type: 'video/mp4' })
    await composeClips(
      [
        { source: { blob }, start: 0, end: 2 },
        { source: { blob }, start: 4, end: 6 },
      ],
      'standard',
      'a.mp4',
    )
    expect(files.writeBlobFile).toHaveBeenCalledTimes(1)
    const clips = files.composeVideoFiles.mock.calls[0][0] as { input: string; start: number; end?: number }[]
    expect(clips).toHaveLength(2)
    expect(clips[0].input).toBe(clips[1].input)
    expect(clips.map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [4, 6],
    ])
  })

  it('別々の動画は、それぞれ書く', async () => {
    await composeClips(
      [
        { source: { blob: new Blob(['a']) }, start: 0 },
        { source: { blob: new Blob(['b']) }, start: 0 },
      ],
      'standard',
      'a.mp4',
    )
    expect(files.writeBlobFile).toHaveBeenCalledTimes(2)
  })
})

describe('BGM つきで書き出す', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    files.readBlobFile.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' }))
    files.composeVideoFiles.mockResolvedValue({ size: 3, duration: 1 })
  })

  it('メモリの BGM は一時ファイルに書いて渡し、全体の長さと音量（0〜1 に収める）を添える', async () => {
    await composeClips(
      [
        { source: { file: 'media/a.mp4' }, start: 1, end: 3, duration: 5 },
        { source: { file: 'media/b.mp4' }, start: 0, duration: 4 },
      ],
      'standard',
      'a.mp4',
      { source: { blob: new Blob(['x']) }, volume: 1.7, extension: 'mp3' },
    )
    const bgm = files.composeVideoFiles.mock.calls[0][3] as { input: string; volume: number; totalSeconds: number }
    expect(bgm.input).toMatch(/\/bgm\.mp3$/)
    expect(bgm.volume).toBe(1)
    expect(bgm.totalSeconds).toBe(6)
    expect(files.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/bgm\.mp3$/))
  })

  it('BGM が無ければ、ネイティブに BGM を渡さない', async () => {
    await composeClips([{ source: { file: 'media/a.mp4' }, start: 0 }], 'standard', 'a.mp4')
    expect(files.composeVideoFiles.mock.calls[0][3]).toBeUndefined()
  })
})

describe('元の動画の音', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    files.readBlobFile.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' }))
    files.composeVideoFiles.mockResolvedValue({ size: 3, duration: 1 })
  })

  it('音を消すと、ネイティブに muteOriginal を渡す', async () => {
    await composeClips([{ source: { file: 'media/a.mp4' }, start: 0 }], 'standard', 'a.mp4', undefined, true)
    expect(files.composeVideoFiles.mock.calls[0][4]).toBe(true)
  })

  it('既定では、元の音を残す', async () => {
    await composeClips([{ source: { file: 'media/a.mp4' }, start: 0 }], 'standard', 'a.mp4')
    expect(files.composeVideoFiles.mock.calls[0][4]).toBeFalsy()
  })
})

describe('区間を分けられるか', () => {
  it('分けたどちらも最短（0.3 秒）以上あれば分けられる', () => {
    expect(canSplitAt(1, 5, 3)).toBe(true)
    expect(canSplitAt(1, 5, 1.3)).toBe(true)
    expect(canSplitAt(1, 5, 4.7)).toBe(true)
  })

  it('始め・終わりに近すぎる位置、範囲の外では分けられない', () => {
    expect(canSplitAt(1, 5, 1)).toBe(false)
    expect(canSplitAt(1, 5, 1.2)).toBe(false)
    expect(canSplitAt(1, 5, 4.8)).toBe(false)
    expect(canSplitAt(1, 5, 0)).toBe(false)
    expect(canSplitAt(1, 5, 9)).toBe(false)
  })
})

describe('つないだ全体の長さ', () => {
  it('終わりを省いた区間は、動画の長さまで数える', () => {
    expect(totalSeconds([{ source: { file: 'a' }, start: 1, duration: 4 }, { source: { file: 'b' }, start: 0, end: 2.5 }])).toBe(5.5)
  })

  it('長さが分からない区間があれば 0（BGM の終わりを小さくしない）', () => {
    expect(totalSeconds([{ source: { file: 'a' }, start: 1 }])).toBe(0)
  })
})
