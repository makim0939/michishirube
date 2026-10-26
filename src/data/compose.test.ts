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

import { checkClips, composeClips } from './compose'

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
